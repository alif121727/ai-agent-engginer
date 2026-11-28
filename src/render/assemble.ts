import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { jobDir } from '../core/fsx.ts';
import { writeArtifactFile } from '../agents/guard.ts';
import { loadDefaults } from '../core/config.ts';
import { resolveBriefLook } from '../core/brief-look.ts';
import type { AgentContext } from '../agents/guard.ts';
import type { AssetRecord, Brief, ScenePlan, Theme } from '../core/types.ts';
import { ffprobe, contactSheet, ffmpegHasFilter } from './ffmpeg.ts';
import { buildMusicBed, buildEngineTrack, muxAudio } from './audio.ts';
import { buildNarration } from './narration.ts';
import { ttsProviderName } from '../tts/provider.ts';
import { describeProfile } from './engine.ts';
import { cameraFilterFor } from './camera.ts';
import { buildOverlayFilters, parseOverlay, describeOverlay } from './overlay.ts';
import type { CameraMove } from '../core/motion-prompt.ts';
import { assertPolicyApplied, assertMotionAllowed, loadPolicy, PolicyViolation } from '../core/motion-policy.ts';
import { validateMotionPrompt } from '../core/motion-prompt.ts';

export interface RenderResult {
  file: string;
  durationSec: number;
  width: number;
  height: number;
  fps: number;
  codec: string;
  scenes: number;
  preview: string | null;
  hasAudio: boolean;
  bitrateKbps: number;
  transitions: number;
}

/** Duration of the cross-fade between clips, in seconds. */
const XFADE_SEC = 0.5;

function aspectSize(aspect: string): { width: number; height: number } {
  const d = loadDefaults().render;
  switch (aspect) {
    case '9:16':
      return { width: 1080, height: 1920 };
    case '1:1':
      return { width: 1080, height: 1080 };
    default:
      return { width: d.width, height: d.height };
  }
}

function fontFile(): string | null {
  const candidates = [
    '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',
    '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
    '/usr/share/fonts/TTF/DejaVuSans-Bold.ttf',
  ];
  return candidates.find((f) => fs.existsSync(f)) ?? null;
}

/**
 * Fallback caption saat build ffmpeg tanpa libfreetype (tidak ada `drawtext`).
 * libass hampir selalu ikut dikompilasi, jadi caption tetap tampil sebagai
 * berkas .ass alih-alih menggagalkan seluruh render.
 */
function writeAssFile(dir: string, scene: ScenePlan, width: number, height: number): string {
  const fontSize = Math.round(width / 22);
  const marginV = Math.round(height * 0.06);
  const text = (scene.onScreenText ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/\{/g, '(')
    .replace(/\}/g, ')')
    .replace(/\n/g, '\\N');
  const ass = [
    '[Script Info]',
    'ScriptType: v4.00+',
    `PlayResX: ${width}`,
    `PlayResY: ${height}`,
    'WrapStyle: 2',
    'ScaledBorderAndShadow: yes',
    '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    `Style: Caption,DejaVu Sans,${fontSize},&H00FFFFFF,&H00FFFFFF,&H8C000000,&H8C0A0A0A,-1,0,0,0,100,100,0,0,3,${Math.round(fontSize / 3)},0,2,40,40,${marginV},1`,
    '',
    '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
    `Dialogue: 0,0:00:00.00,9:59:59.00,Caption,,0,0,0,,${text}`,
  ].join('\n');
  const file = path.join(dir, `caption-${String(scene.index + 1).padStart(2, '0')}.ass`);
  fs.writeFileSync(file, ass, 'utf8');
  return file;
}

/**
 * Gerakan kamera diambil dari MotionPrompt scene, bukan ditebak dari kunci.
 * Pemetaan kunci lama (hook=push-in, dst.) dihapus karena semua gerakan
 * non-push-in ternyata nyaris beku; sekarang kebijakan yang menentukan.
 */
function cameraMoveFor(scene: ScenePlan): CameraMove {
  return scene.motionPrompt?.camera_move ?? 'slow_dolly_in';
}

/**
 * Gate kebijakan gerak — choke point tunggal untuk semua render.
 *
 * Dipanggil sebelum satu frame pun dirender. Job lama (pipeline_version 0) dan
 * job tanpa MotionPrompt terstruktur ditolak di sini, sehingga tidak ada jalur
 * yang diam-diam menghasilkan video "foto berkedip".
 */
export function assertMotionPolicyFor(scenes: ScenePlan[]): void {
  const policy = loadPolicy();
  for (const scene of scenes) {
    if (!scene.motionPrompt) {
      throw new PolicyViolation(
        `scene ${scene.index + 1} tidak punya MotionPrompt; render video tanpa kontrak gerak ditolak`,
        'MOTION_PROMPT_MISSING',
        { sceneIndex: scene.index, key: scene.key },
      );
    }
    assertMotionAllowed(scene.motionPrompt, policy);
    const issues = validateMotionPrompt(scene.motionPrompt, { maxClipSeconds: policy.maxClipSeconds });
    if (issues.length) {
      throw new PolicyViolation(
        `scene ${scene.index + 1}: ${issues.map((i) => i.message).join('; ')}`,
        'MOTION_PROMPT_INVALID',
        { sceneIndex: scene.index, issues },
      );
    }
  }
}

/**
 * Film-like grade. The old chain was contrast + vignette + a hard unsharp,
 * which is what made stills look like processed JPEGs: over-sharpened edges,
 * flat midtones and no grain structure. S-curve, gentle local contrast, fine
 * animated grain and a barely-there chromatic fringe read as shot footage.
 */
function gradeFilters(theme: Theme): string[] {
  const contrast = (1 + (theme.grade.contrast - 1) * 0.6).toFixed(3);
  const saturation = (1 + (theme.grade.saturation - 1) * 0.6).toFixed(3);
  const warm = theme.grade.temperature > 0;
  return [
    `eq=contrast=${contrast}:saturation=${saturation}:gamma=0.99`,
    // Filmic S-curve: lift the toe, roll off the shoulder, keep midtones open.
    'curves=preset=medium_contrast',
    warm ? 'colorbalance=rs=0.05:gs=0.015:bs=-0.05:rh=0.03:bh=-0.03' : 'colorbalance=rs=-0.04:bs=0.06:rh=-0.02:bh=0.02',
    // Deband before grain: smoothing afterwards would erase the grain that
    // gives the frame its film texture.
    'deband=1thr=0.02:2thr=0.02:3thr=0.02',
    // Local contrast at a wide radius adds depth without haloing.
    'unsharp=7:7:0.28:7:7:0.0',
    // Sub-pixel channel offset mimics lens dispersion on high-contrast edges.
    'rgbashift=rh=1:bh=-1',
    'vignette=PI/4.5',
    // Grain must move per frame or it looks like a dirty sensor.
    'noise=alls=3:allf=t',
  ];
}

/**
 * Renders each scene to a normalized clip, then joins them with cross-fades.
 * Per-scene clips are cached so a resumed job only re-renders missing scenes.
 */
export async function assembleVideo(ctx: AgentContext): Promise<RenderResult> {
  const scenes = (ctx.readArtifact<ScenePlan[]>('storyboard.json') ?? []) as ScenePlan[];
  const assets = (ctx.readArtifact<AssetRecord[]>('assets.json') ?? []) as AssetRecord[];
  const brief = ctx.brief as unknown as Brief;
  const look = resolveBriefLook(brief);
  const { width, height } = aspectSize(look.aspect);
  const defaults = loadDefaults();
  const fps = defaults.render.fps;
  // Grade warna harus ikut tema yang dipilih (termasuk tema buatan AI), bukan
  // tema kata kunci, supaya palet yang dilihat pengguna di UI benar-benar
  // diterapkan ke video.
  const theme = look.theme;
  const clipsDir = path.join(jobDir(ctx.jobId), 'clips');
  fs.mkdirSync(clipsDir, { recursive: true });

  const byScene = new Map(assets.map((a) => [a.sceneIndex, a]));
  // Gate kebijakan gerak: dijalankan sebelum validasi aset, karena job lama
  // harus ditolak lebih awal dengan pesan yang jelas, bukan setelah render.
  assertMotionPolicyFor(scenes);
  const missing = scenes.filter((s) => !byScene.has(s.index));
  if (missing.length) {
    throw new Error(`render ditolak: ${missing.length} scene belum punya aset realistis`);
  }
  const broken = assets.filter((a) => !fs.existsSync(a.path) || fs.statSync(a.path).size === 0);
  if (broken.length) {
    throw new Error(
      `render ditolak: ${broken.length} berkas aset hilang/kosong ` +
        `(scene ${broken.map((b) => b.sceneIndex + 1).join(', ')})`,
    );
  }
  const fallback = assets.filter((a) => a.fallback);
  if (fallback.length) {
    throw new Error('render ditolak: ada aset FALLBACK buatan kode');
  }

  const clipPaths: string[] = [];
  /** Ringkasan overlay per scene, dipakai log job agar gaya bisa diperiksa. */
  const overlayNotes: string[] = [];
  for (const scene of scenes) {
    ctx.assertOnline();
    const asset = byScene.get(scene.index)!;
    const clip = path.join(clipsDir, `scene-${String(scene.index + 1).padStart(2, '0')}.mp4`);
    clipPaths.push(clip);

    const font = fontFile();
    // Each cross-fade eats XFADE_SEC of total runtime, so every clip except the
    // last is rendered that much longer. Without this a 30s brief renders 27.5s.
    const isLast = scene.index === scenes[scenes.length - 1].index;
    const clipDuration = scene.duration + (isLast ? 0 : XFADE_SEC);

    if (fs.existsSync(clip)) {
      const cached = ffprobe(clip).durationSec ?? 0;
      if (Math.abs(cached - clipDuration) <= 0.15) continue;
      fs.rmSync(clip, { force: true });
    }

    const frames = Math.max(2, Math.round(clipDuration * fps));
    const move = cameraMoveFor(scene);
    // Klip nyata sudah bergerak sendiri. Menambahkan zoom/pan di atasnya membuat
    // rekaman asli terasa seperti foto yang digeser-geser, jadi gerak kamera
    // sintetis hanya dipakai untuk aset diam (foto).
    const asetKlip = asset.kind === 'video';
    const dasar = asetKlip
      ? [
          `scale=${width}:${height}:force_original_aspect_ratio=increase:flags=lanczos`,
          `crop=${width}:${height}`,
        ]
      : [
          // Overscan first: zoompan needs room to move, otherwise the crop window
          // hits the edge and the frame jitters.
          `scale=${Math.round(width * 1.15)}:${Math.round(height * 1.15)}:force_original_aspect_ratio=increase:flags=lanczos`,
          `crop=${Math.round(width * 1.15)}:${Math.round(height * 1.15)}`,
          // Cukup 1x: upscale tambahan (dulu 2x = 3840x2160) memperlambat zoompan
          // 2-3x tanpa tambahan ketajaman yang terlihat di keluaran 1080p.
          `scale=${width}:${height}:flags=lanczos`,
          cameraFilterFor(move, frames, width, height, fps, scene.motionStrength ?? 1),
        ];
    const filters = [
      ...dasar,
      ...gradeFilters(theme),
    ];
    if (scene.onScreenText) {
      if (font && ffmpegHasFilter('drawtext')) {
        const spec = parseOverlay(scene.onScreenText, scene.label);
        const tambahan = buildOverlayFilters(spec, {
          durationSec: clipDuration,
          width,
          height,
          fontFile: font,
          fps,
        });
        if (tambahan.length) {
          filters.push(...tambahan);
          overlayNotes.push(`scene ${scene.index}: ${describeOverlay(spec)}`);
        }
      } else if (ffmpegHasFilter('ass')) {
        // drawtext butuh libfreetype; libass tersedia di hampir semua build.
        const ass = writeAssFile(clipsDir, scene, width, height);
        filters.push(`ass=${ass.replace(/([:\\'])/g, '\\$1')}`);
      }
    }
    filters.push('format=yuv420p');

    const inputArgs = asset.kind === 'video'
      ? ['-stream_loop', '-1', '-i', asset.path, '-t', String(clipDuration)]
      : ['-loop', '1', '-i', asset.path, '-t', String(clipDuration)];

    const args = [
      '-v', 'error', '-y',
      ...inputArgs,
      '-vf', filters.join(','),
      '-r', String(fps),
      '-c:v', 'libx264',
      '-preset', 'veryfast',
      '-crf', '20',
      '-maxrate', '12M',
      '-bufsize', '24M',
      '-pix_fmt', 'yuv420p',
      // Batasi thread: mesin 2 vCPU, dan tiap thread menambah frame buffer.
      '-threads', '2',
      '-an',
      clip,
    ];

    const res = spawnSync('ffmpeg', args, { encoding: 'utf8' });
    if (res.status !== 0) {
      throw new Error(`ffmpeg gagal di scene ${scene.index + 1}: ${(res.stderr ?? '').slice(0, 400)}`);
    }
    await ctx.setStageProgress(Math.round(((scene.index + 1) / scenes.length) * 85));
  }

  const outFile = path.join(jobDir(ctx.jobId), 'video.mp4');
  const silentFile = path.join(jobDir(ctx.jobId), 'video-silent.mp4');
  const transitions = await joinClips(clipPaths, silentFile, fps, width, height);

  // Audio is part of "done": a silent mp4 reads as an unfinished render.
  const expectedDuration = scenes.reduce((sum, s) => sum + s.duration, 0);
  const engine = buildEngineTrack({
    jobId: ctx.jobId,
    durationSec: expectedDuration,
    model: brief.model ?? '',
    scenes,
  });
  if (engine) {
    await ctx.log(
      'info',
      engine.recorded
        ? `suara mesin: rekaman asli (${describeProfile(engine.profile)})`
        : `suara mesin: sintesis cadangan (${describeProfile(engine.profile)})`,
    );
  }
  const music = buildMusicBed({
    jobId: ctx.jobId,
    durationSec: expectedDuration,
    theme,
    model: brief.model ?? '',
  });

  if (overlayNotes.length) {
    await ctx.log('info', `teks overlay: ${overlayNotes.join(' · ')}`);
  }

  /**
   * Narasi disintesis di sini, bukan di tahap audio, karena butuh timing scene
   * final setelah klip digabung. Tanpa kunci TTS, `buildNarration` melewati
   * dirinya sendiri dan video tetap punya mesin + musik.
   */
  const narration = await buildNarration({
    jobId: ctx.jobId,
    scenes,
    model: brief.model ?? '',
    tone: brief.suaraTone,
    durationSec: expectedDuration,
  });
  if (narration.ok) {
    await ctx.log(
      'info',
      `narasi: ${narration.clips.length} scene, voice ${narration.tone}`,
    );
    const over = narration.clips.filter(
      (c) => c.audioDuration !== undefined && c.audioDuration > c.duration + 0.5,
    );
    if (over.length) {
      await ctx.log(
        'warn',
        `narasi ${over.length} scene lebih panjang dari durasinya, teks akan terpotong`,
      );
    }
  } else if (narration.skipped) {
    // Tanpa log ini narasi bisa hilang berbulan-bulan tanpa jejak: video tetap
    // "done" dan QA lama tidak memeriksa isi audio. Pernah terjadi saat biner
    // Piper hilang setelah sandbox di-reset.
    await ctx.log(
      'warn',
      `narasi dilewati: tidak ada penyedia TTS (${ttsProviderName()}); ` +
        'isi TTS_API_KEY atau pasang piper. Video akan tanpa suara narasi.',
    );
  } else {
    await ctx.log('warn', `narasi tidak dibuat: ${narration.errors[0] ?? 'tidak diketahui'}`);
  }

  const withAudio = engine || music || narration.trackFile
    ? muxAudio(
        silentFile,
        music,
        outFile,
        defaults.render.loudnessLufs,
        engine?.file ?? null,
        narration.trackFile ?? null,
      )
    : false;
  if (!withAudio) {
    fs.copyFileSync(silentFile, outFile);
    await ctx.log('warn', 'audio gagal dibuat, video dirender tanpa suara');
  }
  fs.rmSync(silentFile, { force: true });

  const probe = ffprobe(outFile);
  if (!probe.ok) throw new Error('hasil render tidak lolos ffprobe');

  const preview = contactSheet(
    scenes.map((s) => byScene.get(s.index)!.path),
    path.join(jobDir(ctx.jobId), 'preview.jpg'),
  );

  const expected = scenes.reduce((sum, s) => sum + s.duration, 0);
  const result: RenderResult = {
    file: outFile,
    durationSec: probe.durationSec ?? 0,
    width: probe.width ?? width,
    height: probe.height ?? height,
    fps,
    codec: probe.codec ?? 'h264',
    scenes: scenes.length,
    preview,
    hasAudio: withAudio,
    bitrateKbps: Math.round(((fs.statSync(outFile).size * 8) / Math.max(1, probe.durationSec ?? 1)) / 1000),
    transitions,
  };

  // The render stage owns this check so a broken file never reaches QA with a
  // misleading "ketajaman 0" message.
  // Cross-fades legitimately shorten the timeline by up to XFADE_SEC per cut;
  // the per-clip compensation keeps that under a frame or two in practice.
  const durationDrift = Math.abs(result.durationSec - expected);
  if (durationDrift > 1.5) {
    throw new Error(
      `render tidak valid: durasi ${result.durationSec.toFixed(1)} dtk, seharusnya ${expected.toFixed(1)} dtk`,
    );
  }
  if (result.bitrateKbps < 2000) {
    throw new Error(`render tidak valid: bitrate ${result.bitrateKbps} kbps terlalu rendah`);
  }

  // Must land in artifacts/, which is where readArtifact looks; writing to the
  // job root made the QA stage report "render.json tidak ada".
  writeArtifactFile(ctx.jobId, 'render-result.json', result);
  await ctx.setStageProgress(100);
  return result;
}

/**
 * Cross-fades clips instead of concatenating them. A hard cut between two
 * stills is the other half of the slideshow look; overlapping by 0.5s keeps
 * motion continuous across scenes.
 */
async function joinClips(
  clips: string[],
  outFile: string,
  fps: number,
  width: number,
  height: number,
): Promise<number> {
  if (clips.length === 1) {
    fs.copyFileSync(clips[0], outFile);
    return 0;
  }
  const durations = clips.map((c) => ffprobe(c).durationSec ?? 0);
  const args: string[] = ['-v', 'error', '-y'];
  for (const clip of clips) args.push('-i', clip);

  const filters: string[] = [];
  clips.forEach((_, i) => {
    filters.push(`[${i}:v]settb=AVTB,fps=${fps},format=yuv420p[v${i}]`);
  });
  // Offsets must be derived from the real clip durations (which include the
  // xfade compensation), otherwise the last transitions land on black frames.
  let lastLabel = 'v0';
  let accumulated = durations[0];
  let offset = accumulated - XFADE_SEC;
  for (let i = 1; i < clips.length; i++) {
    const label = i === clips.length - 1 ? 'vout' : `x${i}`;
    filters.push(
      `[${lastLabel}][v${i}]xfade=transition=fade:duration=${XFADE_SEC}:offset=${Math.max(0.1, offset).toFixed(3)}[${label}]`,
    );
    lastLabel = label;
    accumulated += durations[i] - XFADE_SEC;
    offset = accumulated - XFADE_SEC;
  }
  filters.push(`[${lastLabel}]scale=${width}:${height},format=yuv420p[final]`);

  // `veryfast` khusus pass gabung: isinya klip yang sudah di-encode, dan pass
  // ini yang paling mahal (rantai xfade 6 input). Di 2 vCPU shared, `medium`
  // membuatnya 20 menit lebih; `veryfast` + crf 20 tidak terlihat bedanya
  // setelah satu generasi kompresi.
  const res = spawnSync(
    'ffmpeg',
    [...args, '-filter_complex', filters.join(';'), '-map', '[final]',
     '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20',
     '-pix_fmt', 'yuv420p', '-movflags', '+faststart', outFile],
    { encoding: 'utf8' },
  );
  if (res.status !== 0) {
    // Falling back to a plain concat keeps the job alive; the caller's duration
    // check still guards the result.
    const listFile = path.join(path.dirname(outFile), 'clips', 'list.txt');
    fs.writeFileSync(listFile, clips.map((c) => `file '${c}'`).join('\n'));
    const concat = spawnSync(
      'ffmpeg',
      ['-v', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', listFile, '-c', 'copy',
       '-movflags', '+faststart', outFile],
      { encoding: 'utf8' },
    );
    if (concat.status !== 0) throw new Error(`ffmpeg gabung gagal: ${(concat.stderr ?? '').slice(0, 300)}`);
    return 0;
  }
  return clips.length - 1;
}
