import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { jobDir, writeJsonAtomic } from '../core/fsx.ts';
import { loadDefaults } from '../core/config.ts';
import type { AgentContext } from '../agents/guard.ts';
import type { AssetRecord, ScenePlan } from '../core/types.ts';
import { ffprobe, contactSheet } from './ffmpeg.ts';

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
}

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
 * Renders each scene to a normalized clip, then concatenates. Per-scene clips
 * are cached so a resumed job only re-renders missing scenes.
 */
export async function assembleVideo(ctx: AgentContext): Promise<RenderResult> {
  const scenes = (ctx.readArtifact<ScenePlan[]>('storyboard.json') ?? []) as ScenePlan[];
  const assets = (ctx.readArtifact<AssetRecord[]>('assets.json') ?? []) as AssetRecord[];
  const job = ctx.brief as unknown as { model?: string; rasio?: string };
  const { width, height } = aspectSize(job.rasio ?? '16:9');
  const defaults = loadDefaults();
  const fps = defaults.render.fps;
  const clipsDir = path.join(jobDir(ctx.jobId), 'clips');
  fs.mkdirSync(clipsDir, { recursive: true });

  const byScene = new Map(assets.map((a) => [a.sceneIndex, a]));
  const missing = scenes.filter((s) => !byScene.has(s.index));
  if (missing.length) {
    throw new Error(`render ditolak: ${missing.length} scene belum punya aset realistis`);
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
    if (fs.existsSync(clip) && (ffprobe(clip).durationSec ?? 0) > 0.5) continue;

    const font = fontFile();
    const text = scene.onScreenText ? escapeDrawText(scene.onScreenText) : '';
    const filters = [
      `scale=${width}:${height}:force_original_aspect_ratio=increase`,
      `crop=${width}:${height}`,
      `zoompan=z='min(zoom+0.0008,1.08)':d=${Math.max(1, Math.round(scene.duration * fps))}:s=${width}x${height}:fps=${fps}`,
      'eq=contrast=1.10:saturation=1.06',
      'noise=alls=3:allf=t',
    ];
    if (text && font) {
      const fontSize = Math.round(width / 22);
      filters.push(
        `drawtext=fontfile=${font}:text='${text}':fontcolor=white:fontsize=${fontSize}:` +
          `x=(w-text_w)/2:y=h-(text_h*2.4):box=1:boxcolor=0x0A0A0A@0.55:boxborderw=${Math.round(fontSize / 2)}`,
      );
    }
    filters.push('format=yuv420p');

    const args = asset.kind === 'video'
      ? ['-v', 'error', '-y', '-stream_loop', '-1', '-i', asset.path, '-t', String(scene.duration)]
      : ['-v', 'error', '-y', '-loop', '1', '-i', asset.path, '-t', String(scene.duration)];

    args.push(
      '-vf', filters.join(','),
      '-r', String(fps),
      '-c:v', 'libx264',
      '-preset', 'veryfast',
      '-crf', '22',
      '-maxrate', '12M',
      '-bufsize', '24M',
      '-pix_fmt', 'yuv420p',
      '-an',
      clip,
    );

    const res = spawnSync('ffmpeg', args, { encoding: 'utf8' });
    if (res.status !== 0) {
      throw new Error(`ffmpeg gagal di scene ${scene.index + 1}: ${(res.stderr ?? '').slice(0, 300)}`);
    }
    await ctx.setStageProgress(Math.round(((scene.index + 1) / scenes.length) * 90));
  }

  const listFile = path.join(clipsDir, 'list.txt');
  fs.writeFileSync(listFile, clipPaths.map((c) => `file '${c}'`).join('\n'));
  const outFile = path.join(jobDir(ctx.jobId), 'video.mp4');
  const concat = spawnSync(
    'ffmpeg',
    ['-v', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', listFile, '-c', 'copy', '-movflags', '+faststart', outFile],
    { encoding: 'utf8' },
  );
  if (concat.status !== 0) {
    throw new Error(`ffmpeg concat gagal: ${(concat.stderr ?? '').slice(0, 300)}`);
  }

  const probe = ffprobe(outFile);
  if (!probe.ok) throw new Error('hasil render tidak lolos ffprobe');

  const preview = contactSheet(
    scenes.map((s) => byScene.get(s.index)!.path),
    path.join(jobDir(ctx.jobId), 'preview.jpg'),
  );

  const result: RenderResult = {
    file: outFile,
    durationSec: probe.durationSec ?? 0,
    width: probe.width ?? width,
    height: probe.height ?? height,
    fps,
    codec: probe.codec ?? 'h264',
    scenes: scenes.length,
    preview,
    hasAudio: false,
  };
  writeJsonAtomic(path.join(jobDir(ctx.jobId), 'render-result.json'), result);
  await ctx.setStageProgress(100);
  return result;
}
