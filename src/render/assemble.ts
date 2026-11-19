import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { jobDir } from '../core/fsx.ts';
import { writeArtifactFile } from '../agents/guard.ts';
import { loadDefaults, loadThemes } from '../core/config.ts';
import { pickTheme } from '../core/theme.ts';
import type { AgentContext } from '../agents/guard.ts';
import type { AssetRecord, ScenePlan, Theme } from '../core/types.ts';
import { ffprobe, contactSheet } from './ffmpeg.ts';
import { buildMusicBed, muxAudio } from './audio.ts';

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

function escapeDrawText(text: string): string {
  return text.replace(/\\/g, '\\\\').replace(/:/g, '\\:').replace(/'/g, "\\'").replace(/%/g, '\\%');
}

/**
 * Camera moves are chosen per scene key so consecutive shots never look alike.
 * Without this every clip is a still frame with the same slow push-in, which
 * reads as a slideshow rather than a video.
 */
type CameraMove = 'push-in' | 'pull-out' | 'pan-right' | 'pan-left' | 'tilt-up' | 'orbit' | 'speed-ramp';

function cameraMoveFor(scene: ScenePlan): CameraMove {
  switch (scene.key) {
    case 'hook':
      return 'push-in';
    case 'exterior':
      return 'orbit';
    case 'features':
      return 'pan-right';
    case 'interior':
      return 'tilt-up';
    case 'action':
      return 'speed-ramp';
    case 'cta':
      return 'pull-out';
    case 'detail_wheel':
      return 'pan-left';
    case 'detail_engine':
      return 'tilt-up';
    case 'night':
      return 'pan-right';
    case 'lifestyle':
      return 'push-in';
    default:
      return 'push-in';
  }
}

/**
 * zoompan works on the input frame; the x/y expressions animate the crop
 * window, which is what produces real lateral movement (a pan) instead of a
 * pure zoom. Values stay inside the frame so no black borders appear.
 */
function cameraFilter(move: CameraMove, frames: number, width: number, height: number, fps: number): string {
  const total = Math.max(2, frames);
  const z = {
    'push-in': `min(1+0.14*on/${total},1.14)`,
    'pull-out': `max(1.14-0.14*on/${total},1.0)`,
    orbit: `min(1.06+0.10*on/${total},1.16)`,
    'speed-ramp': `min(1.0+0.22*on/${total},1.22)`,
    'pan-right': '1.12',
    'pan-left': '1.12',
    'tilt-up': '1.12',
  }[move];
  const x = {
    'pan-right': `(iw-iw/zoom)*(on/${total})`,
    'pan-left': `(iw-iw/zoom)*(1-on/${total})`,
    orbit: `(iw-iw/zoom)*(0.5+0.35*sin(on/${total}*PI))`,
    'speed-ramp': `(iw-iw/zoom)*0.5`,
    'tilt-up': `(iw-iw/zoom)*0.5`,
  }[move as string] ?? '(iw-iw/zoom)/2';
  const y = {
    'tilt-up': `(ih-ih/zoom)*(1-on/${total})`,
    'speed-ramp': `(ih-ih/zoom)*0.5`,
    'pan-right': `(ih-ih/zoom)*0.5`,
    'pan-left': `(ih-ih/zoom)*0.5`,
  }[move as string] ?? '(ih-ih/zoom)/2';
  return (
    `zoompan=z='${z}':x='${x}':y='${y}':d=${total}:s=${width}x${height}:fps=${fps}`
  );
}

function gradeFilters(theme: Theme): string[] {
  const contrast = (1 + (theme.grade.contrast - 1) * 0.6).toFixed(3);
  const saturation = (1 + (theme.grade.saturation - 1) * 0.6).toFixed(3);
  const warm = theme.grade.temperature > 0;
  return [
    `eq=contrast=${contrast}:saturation=${saturation}:gamma=0.98`,
    warm ? 'colorbalance=rs=0.04:gs=0.01:bs=-0.04' : 'colorbalance=rs=-0.03:bs=0.05',
    'vignette=PI/5',
    'noise=alls=2:allf=t+u',
    'unsharp=5:5:0.35:5:5:0.0',
  ];
}

/**
 * Renders each scene to a normalized clip, then joins them with cross-fades.
 * Per-scene clips are cached so a resumed job only re-renders missing scenes.
 */
export async function assembleVideo(ctx: AgentContext): Promise<RenderResult> {
  const scenes = (ctx.readArtifact<ScenePlan[]>('storyboard.json') ?? []) as ScenePlan[];
  const assets = (ctx.readArtifact<AssetRecord[]>('assets.json') ?? []) as AssetRecord[];
  const brief = ctx.brief as unknown as { model?: string; rasio?: string };
  const { width, height } = aspectSize(brief.rasio ?? '16:9');
  const defaults = loadDefaults();
  const fps = defaults.render.fps;
  const themes = loadThemes();
  const theme = pickTheme(brief.model ?? '', themes.themes, themes.defaultTheme);
  const clipsDir = path.join(jobDir(ctx.jobId), 'clips');
  fs.mkdirSync(clipsDir, { recursive: true });

  const byScene = new Map(assets.map((a) => [a.sceneIndex, a]));
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
  for (const scene of scenes) {
    ctx.assertOnline();
    const asset = byScene.get(scene.index)!;
    const clip = path.join(clipsDir, `scene-${String(scene.index + 1).padStart(2, '0')}.mp4`);
    clipPaths.push(clip);

    const font = fontFile();
    const text = scene.onScreenText ? escapeDrawText(scene.onScreenText) : '';
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
    const filters = [
      // Overscan first: zoompan needs room to move, otherwise the crop window
      // hits the edge and the frame jitters.
      `scale=${Math.round(width * 1.15)}:${Math.round(height * 1.15)}:force_original_aspect_ratio=increase`,
      `crop=${Math.round(width * 1.15)}:${Math.round(height * 1.15)}`,
      `scale=${width * 2}:${height * 2}`,
      cameraFilter(move, frames, width, height, fps),
      ...gradeFilters(theme),
    ];
    if (text && font) {
      const fontSize = Math.round(width / 22);
      filters.push(
        `drawtext=fontfile=${font}:text='${text}':fontcolor=white:fontsize=${fontSize}:` +
          `x=(w-text_w)/2:y=h-(text_h*2.4):box=1:boxcolor=0x0A0A0A@0.55:boxborderw=${Math.round(fontSize / 2)}`,
      );
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
      '-preset', 'medium',
      '-crf', '20',
      '-maxrate', '12M',
      '-bufsize', '24M',
      '-pix_fmt', 'yuv420p',
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
  const music = buildMusicBed({
    jobId: ctx.jobId,
    durationSec: expectedDuration,
    theme,
    model: brief.model ?? '',
  });
  const withAudio = music
    ? muxAudio(silentFile, music, outFile, defaults.render.loudnessLufs)
    : false;
  if (!withAudio) {
    fs.copyFileSync(silentFile, outFile);
    await ctx.log('warn', 'musik latar gagal dibuat, video dirender tanpa audio');
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

  const res = spawnSync(
    'ffmpeg',
    [...args, '-filter_complex', filters.join(';'), '-map', '[final]',
     '-c:v', 'libx264', '-preset', 'medium', '-crf', '20',
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
