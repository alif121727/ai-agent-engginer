import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { jobDir } from '../core/fsx.ts';
import type { ScenePlan, Theme } from '../core/types.ts';

/**
 * Music is synthesised with ffmpeg instead of shipped as a binary asset: the
 * repo stays small, there is no licensing to track, and each theme gets a
 * different key/tempo so videos do not all sound identical.
 */
interface TrackSpec {
  rootHz: number;
  tempo: number;
  brightness: number;
}

const KEYS: Record<string, TrackSpec> = {
  balap: { rootHz: 110.0, tempo: 132, brightness: 1.0 },
  sport: { rootHz: 98.0, tempo: 112, brightness: 0.8 },
  klasik: { rootHz: 87.31, tempo: 92, brightness: 0.55 },
  luxury: { rootHz: 103.83, tempo: 96, brightness: 0.7 },
  offroad: { rootHz: 82.41, tempo: 104, brightness: 0.75 },
  ev: { rootHz: 130.81, tempo: 108, brightness: 0.9 },
};

function specFor(theme: Theme, model: string): TrackSpec {
  const key = `${theme.id} ${model}`.toLowerCase();
  if (/klasik|classic|f40|countach|240z|ae86|e30|300sl|r34|rx-7|22b|stratos|e-type|mustang|rs 2\.7/.test(key)) {
    return KEYS.klasik;
  }
  if (/taycan|ev|electric|nsx|296/.test(key)) return KEYS.ev;
  if (/gt3|sto|765|pista|black series|nismo|z06|gt\b/.test(key)) return KEYS.balap;
  return theme.grade.saturation > 1.05 ? KEYS.sport : KEYS.luxury;
}

/**
 * Builds an ambient bed: a sustained root chord plus a pulsing fifth, then a
 * gentle low-pass. It is intentionally simple — a real music provider can
 * replace this file without touching the render pipeline.
 */
export function buildMusicBed(input: {
  jobId: string;
  durationSec: number;
  theme: Theme;
  model: string;
}): string | null {
  const dir = path.join(jobDir(input.jobId), 'audio');
  fs.mkdirSync(dir, { recursive: true });
  const out = path.join(dir, 'music.m4a');
  const spec = specFor(input.theme, input.model);
  const dur = Math.max(1, input.durationSec);
  const beat = (60 / spec.tempo).toFixed(3);
  const fifth = (spec.rootHz * 1.5).toFixed(2);
  const root = spec.rootHz.toFixed(2);

  // Two detuned saws for width, a sine sub for weight, and a filtered pulse
  // that follows the tempo.
  const filter = [
    `sine=frequency=${root}:duration=${dur}`,
    `sine=frequency=${fifth}:duration=${dur}`,
    `sine=frequency=${(spec.rootHz * 2).toFixed(2)}:duration=${dur}`,
  ].join('|');

  const graph = [
    `[0:a]volume=0.30,lowpass=f=900[a0]`,
    `[1:a]volume=0.16,lowpass=f=1600,tremolo=f=1/${beat}:d=0.35[a1]`,
    `[2:a]volume=0.06,lowpass=f=3200[a2]`,
    `[a0][a1][a2]amix=inputs=3:duration=longest,` +
      `afade=t=in:st=0:d=1.5,afade=t=out:st=${Math.max(0, dur - 2).toFixed(2)}:d=2,` +
      `loudnorm=I=-18:TP=-2:LRA=9[aout]`,
  ].join(';');

  const args = ['-v', 'error', '-y'];
  for (const src of filter.split('|')) args.push('-f', 'lavfi', '-i', src);
  args.push('-filter_complex', graph, '-map', '[aout]', '-c:a', 'aac', '-b:a', '128k', '-t', String(dur), out);

  const res = spawnSync('ffmpeg', args, { encoding: 'utf8' });
  if (res.status !== 0 || !fs.existsSync(out)) return null;
  return out;
}

/**
 * Muxes the bed under the picture and normalises to the configured loudness.
 * `-shortest` keeps audio from stretching the video past its intended length.
 */
export function muxAudio(videoFile: string, musicFile: string, outFile: string, loudnessLufs: number): boolean {
  const tmp = outFile.replace(/\.mp4$/, '.mux.mp4');
  const res = spawnSync(
    'ffmpeg',
    [
      '-v', 'error', '-y',
      '-i', videoFile,
      '-i', musicFile,
      '-filter_complex', `[1:a]loudnorm=I=${loudnessLufs}:TP=-1.5:LRA=11[a]`,
      '-map', '0:v', '-map', '[a]',
      '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k',
      '-shortest', '-movflags', '+faststart',
      tmp,
    ],
    { encoding: 'utf8' },
  );
  if (res.status !== 0 || !fs.existsSync(tmp)) {
    fs.rmSync(tmp, { force: true });
    return false;
  }
  fs.renameSync(tmp, outFile);
  return true;
}

/** Scene timing map used to place sound effects against the picture. */
export function sceneCues(scenes: ScenePlan[]): { at: number; kind: string }[] {
  return scenes
    .filter((s) => ['action', 'hook', 'cta'].includes(s.key))
    .map((s) => ({ at: s.start, kind: s.key === 'action' ? 'engine' : 'impact' }));
}
