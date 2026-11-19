import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { jobDir } from '../core/fsx.ts';
import type { ScenePlan, Theme } from '../core/types.ts';
import { engineProfileFor, type EngineProfile } from './engine.ts';

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
 * How hard the engine is working in each scene, as a fraction of redline. The
 * picture cuts between a static hero shot and a launch, so the audio has to
 * follow: a constant drone sounds like a broken file, not a car.
 */
const SCENE_LOAD: Record<string, number> = {
  hook: 0.62,
  exterior: 0.34,
  features: 0.42,
  interior: 0.46,
  action: 0.96,
  cta: 0.3,
  detail_wheel: 0.24,
  detail_engine: 0.28,
  night: 0.58,
  lifestyle: 0.3,
};

function loadFor(scene: ScenePlan): number {
  return SCENE_LOAD[scene.key.split('_')[0]] ?? SCENE_LOAD[scene.key] ?? 0.4;
}

/**
 * Piecewise rpm curve: each scene gets a target, reached over the first 45% of
 * the scene so the rev lands with the cut instead of drifting through it.
 */
function rpmExpression(scenes: ScenePlan[], p: EngineProfile): string {
  if (!scenes.length) return String(p.idle);
  const span = Math.max(1, p.redline - p.idle);
  const points: { t: number; rpm: number }[] = [{ t: 0, rpm: p.idle }];
  for (const scene of scenes) {
    const target = p.idle + span * loadFor(scene);
    const rise = Math.max(0.35, scene.duration * 0.45);
    points.push({ t: scene.start + rise, rpm: target });
    points.push({ t: scene.start + scene.duration, rpm: target });
  }

  let expr = String(Math.round(points[points.length - 1].rpm));
  for (let i = points.length - 1; i > 0; i--) {
    const a = points[i - 1];
    const b = points[i];
    const dt = Math.max(0.05, b.t - a.t);
    const ramp = `${a.rpm.toFixed(0)}+(${(b.rpm - a.rpm).toFixed(0)})*((t-${a.t.toFixed(2)})/${dt.toFixed(2)})`;
    expr = `if(lt(t\\,${b.t.toFixed(2)})\\,${ramp}\\,${expr})`;
  }
  return expr;
}

/** Fundamental exhaust pulse frequency in Hz for a given rpm. */
function pulseHz(rpmExpr: string, firingPerRev: number): string {
  return `((${rpmExpr})/60)*${Math.max(1, firingPerRev)}`;
}

/**
 * Synthesises the engine note for one model. ffmpeg is used instead of a sample
 * library because the repo ships no audio, and a synthesised note can follow
 * the rev curve scene by scene — something a fixed sample cannot do.
 */
export function buildEngineTrack(input: {
  jobId: string;
  durationSec: number;
  model: string;
  scenes: ScenePlan[];
}): { file: string; profile: EngineProfile } | null {
  const dir = path.join(jobDir(input.jobId), 'audio');
  fs.mkdirSync(dir, { recursive: true });
  const out = path.join(dir, 'engine.m4a');
  const profile = engineProfileFor(input.model);
  const dur = Math.max(1, input.durationSec);
  const rpm = rpmExpression(input.scenes, profile);

  const sources: string[] = [];
  const parts: string[] = [];
  // ffmpeg expressions have no Math.max; bake the constant in once.
  const redline = Math.max(1, profile.redline);

  if (profile.aspiration === 'electric') {
    // An EV has no exhaust: a rising inverter whine plus tyre/air noise.
    const sweep = `300+(${redline}/60*18)*(${rpm}/${redline})`;
    sources.push(`aevalsrc='0.22*sin(2*PI*(${sweep})*t)+0.10*sin(4*PI*(${sweep})*t)':d=${dur}:s=48000`);
    parts.push(`[0:a]volume=0.55,lowpass=f=9000,highpass=f=120[a0]`);
    sources.push(`anoisesrc=color=pink:duration=${dur}:sample_rate=48000:amplitude=0.05`);
    parts.push(`[1:a]lowpass=f=1400,volume=0.35[a1]`);
    parts.push(`[a0][a1]amix=inputs=2:duration=longest:normalize=0[eng]`);
  } else {
    const f = pulseHz(rpm, profile.firingPerRev);
    // Uneven harmonic weights are what separate a V8 burble from an I4 drone.
    const h2 = (0.42 * (1 - profile.brightness * 0.3)).toFixed(3);
    const h3 = (0.26 * profile.brightness + 0.08).toFixed(3);
    const h4 = (0.14 * profile.brightness).toFixed(3);
    sources.push(
      `aevalsrc='0.30*sin(2*PI*(${f})*t)+${h2}*sin(4*PI*(${f})*t)+` +
        `${h3}*sin(6*PI*(${f})*t)+${h4}*sin(8*PI*(${f})*t)':d=${dur}:s=48000`,
    );
    // Exhaust rasp: band-limited noise gated by the pulse, not a steady hiss.
    const raspAmp = (0.16 * profile.rasp).toFixed(3);
    sources.push(
      `aevalsrc='${raspAmp}*(random(0)-0.5)*(0.6+0.4*sin(2*PI*(${f})*t))':d=${dur}:s=48000`,
    );
    parts.push(`[0:a]volume=0.62,lowpass=f=${Math.round(700 + 2600 * profile.brightness)},highpass=f=55[a0]`);
    parts.push(`[1:a]bandpass=f=1800:w=2200,volume=0.5[a1]`);

    // Turbo whistle and supercharger whine sit above the exhaust note.
    if (profile.whine > 0.12) {
      const whistle = profile.aspiration === 'supercharged' ? 2400 : 5200;
      const mod = `(0.35+0.65*(${rpm})/${redline})`;
      sources.push(
        `aevalsrc='${(0.10 * profile.whine).toFixed(3)}*sin(2*PI*(${whistle}+${(profile.redline * 0.28).toFixed(0)}*(${rpm})/${redline})*t)*(${mod})':d=${dur}:s=48000`,
      );
      parts.push(`[2:a]highpass=f=1800,volume=0.5[a2]`);
      parts.push(`[a0][a1][a2]amix=inputs=3:duration=longest:normalize=0[eng]`);
    } else {
      parts.push(`[a0][a1]amix=inputs=2:duration=longest:normalize=0[eng]`);
    }
  }

  // Loudness is normalised per track so a V12 and an I4 differ in character,
  // not in volume; otherwise one model's video is inaudible next to another's.
  parts.push(
    `[eng]afade=t=in:st=0:d=0.6,afade=t=out:st=${Math.max(0, dur - 1.2).toFixed(2)}:d=1.2,` +
      `loudnorm=I=-16:TP=-1.5:LRA=7[engout]`,
  );

  const args = ['-v', 'error', '-y'];
  for (const src of sources) args.push('-f', 'lavfi', '-i', src);
  args.push(
    '-filter_complex', parts.join(';'),
    '-map', '[engout]',
    '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-t', String(dur), out,
  );

  const res = spawnSync('ffmpeg', args, { encoding: 'utf8' });
  if (res.status !== 0 || !fs.existsSync(out)) return null;
  return { file: out, profile };
}

/**
 * Muxes the bed under the picture and normalises to the configured loudness.
 * `-shortest` keeps audio from stretching the video past its intended length.
 */
export function muxAudio(
  videoFile: string,
  musicFile: string | null,
  outFile: string,
  loudnessLufs: number,
  engineFile?: string | null,
): boolean {
  const tmp = outFile.replace(/\.mp4$/, '.mux.mp4');
  const inputs = ['-i', videoFile];
  if (engineFile) inputs.push('-i', engineFile);
  if (musicFile) inputs.push('-i', musicFile);

  // The engine is the subject of the video, so it leads; the music bed sits
  // underneath and is side-chain ducked by the engine so the two never fight.
  let filter: string;
  let audioMap: string;
  // A filter output label may only be consumed once, so the engine is split:
  // one copy is the audible bed, the other only keys the ducker.
  const fmt = 'aformat=sample_rates=48000:channel_layouts=stereo';
  if (engineFile && musicFile) {
    filter =
      `[1:a]${fmt},loudnorm=I=${loudnessLufs - 2}:TP=-1.5:LRA=7,asplit=2[eng][engkey];` +
      `[2:a]${fmt},volume=0.30,loudnorm=I=${loudnessLufs - 12}:TP=-6:LRA=9[bed];` +
      `[bed][engkey]sidechaincompress=threshold=0.03:ratio=8:attack=8:release=260[ducked];` +
      `[eng][ducked]amix=inputs=2:duration=first:normalize=0,` +
      `loudnorm=I=${loudnessLufs}:TP=-1.5:LRA=11[a]`;
    audioMap = '[a]';
  } else if (engineFile) {
    filter = `[1:a]${fmt},loudnorm=I=${loudnessLufs}:TP=-1.5:LRA=9[a]`;
    audioMap = '[a]';
  } else {
    filter = `[1:a]${fmt},loudnorm=I=${loudnessLufs}:TP=-1.5:LRA=11[a]`;
    audioMap = '[a]';
  }

  const res = spawnSync(
    'ffmpeg',
    [
      '-v', 'error', '-y',
      ...inputs,
      '-filter_complex', filter,
      '-map', '0:v', '-map', audioMap,
      '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-ar', '48000',
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
