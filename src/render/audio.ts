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
 * Fase kumulatif (radian) dari kurva rpm, dihitung analitis per segmen linear.
 *
 * Ini perbaikan inti: versi lama menulis sin(2*PI*f(t)*t) dengan f yang ikut
 * berubah terhadap t. Perkalian f(t)*t bukan integral frekuensi, jadi pitch
 * naik dua kali lebih cepat dari rpm dan hasilnya terdengar seperti siren,
 * bukan mesin yang merev. Di sini fase = 2*PI*firing/60 * integral(rpm dt).
 */
function phaseExpression(points: { t: number; rpm: number }[], firingPerRev: number): string {
  const w = (2 * Math.PI * Math.max(1, firingPerRev)) / 60;
  // Fase di awal tiap segmen, dari integral trapezoid segmen sebelumnya.
  const starts: number[] = [0];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    starts.push(starts[i - 1] + w * ((a.rpm + b.rpm) / 2) * (b.t - a.t));
  }

  // Bangun dari segmen terakhir ke belakang supaya tiap if() menangkap satu segmen.
  let expr = `${starts[starts.length - 1]}`;
  for (let i = points.length - 1; i > 0; i--) {
    const a = points[i - 1];
    const b = points[i];
    const dt = Math.max(0.05, b.t - a.t);
    const slope = (b.rpm - a.rpm) / dt;
    const local = `${a.rpm.toFixed(2)}*(t-${a.t.toFixed(3)})+${(slope / 2).toFixed(3)}*(t-${a.t.toFixed(3)})*(t-${a.t.toFixed(3)})`;
    expr = `if(lt(t,${b.t.toFixed(3)}),${starts[i - 1].toFixed(4)}+${w.toFixed(6)}*(${local}),${expr})`;
  }
  return expr;
}

/** Kurva rpm: tiap scene punya target, dicapai pada 45% durasi scene. */
function rpmPoints(scenes: ScenePlan[], p: EngineProfile): { t: number; rpm: number }[] {
  if (!scenes.length) return [{ t: 0, rpm: p.idle }, { t: 1, rpm: p.idle }];
  const span = Math.max(1, p.redline - p.idle);
  const points: { t: number; rpm: number }[] = [{ t: 0, rpm: p.idle }];
  for (const scene of scenes) {
    const target = p.idle + span * loadFor(scene);
    const rise = Math.max(0.35, scene.duration * 0.45);
    points.push({ t: scene.start + rise, rpm: target });
    points.push({ t: scene.start + scene.duration, rpm: target });
  }
  return points;
}

/**
 * Menyintesis satu nada mesin dari profil katalog. Tidak ada sampel audio di
 * repo, dan nada sintetis bisa mengikuti kurva rev per scene — sesuatu yang
 * tidak bisa dilakukan satu berkas sampel tetap.
 *
 * Bentuk gelombangnya meniru mesin, bukan sinyal uji: pulsa knalpot yang tajam
 * lalu meluruh (itu yang memberi "letupan" per silinder), tumpukan harmonisa di
 * atasnya, noise rasp yang digerbangi pulsa, ditambah turbo/kompresor yang
 * mengikuti rpm. Output stereo 48 kHz agar tidak lagi berupa drone mono.
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
  const redline = Math.max(1, profile.redline);
  const points = rpmPoints(input.scenes, profile);
  const theta = phaseExpression(points, profile.firingPerRev);
  // Fraksi siklus 0..1: dasar untuk pulsa per silinder.
  const cycle = `mod((${theta})/6.283185,1)`;
  const rpmExpr = `(${theta})`;

  const sources: string[] = [];
  const parts: string[] = [];

  if (profile.aspiration === 'electric') {
    // EV tidak punya knalpot: desis inverter yang naik + noise ban.
    const sweep = `260+2400*(${rpmExpr})/(6.283185*${(profile.redline / 60) * 1})`;
    const tone =
      `0.20*sin(2*PI*(${sweep})*t)+0.09*sin(4*PI*(${sweep})*t)+0.05*sin(6*PI*(${sweep})*t)`;
    sources.push(`aevalsrc='${tone}|${tone}':d=${dur}:s=48000:c=stereo`);
    parts.push(`[0:a]highpass=f=180,lowpass=f=11000,volume=0.7[a0]`);
    sources.push(`anoisesrc=color=pink:duration=${dur}:sample_rate=48000:amplitude=0.05`);
    parts.push(`[1:a]lowpass=f=1600,volume=0.4,aformat=channel_layouts=stereo[a1]`);
    parts.push(`[a0][a1]amix=inputs=2:duration=longest:normalize=0[eng]`);
  } else {
    // Peluruhan pulsa: makin tinggi rpm makin rapat letupan, jadi konstanta
    // peluruhan diikat ke laju nyala supaya timbre tidak berubah saat merev.
    const decay = (12 + profile.brightness * 6).toFixed(1);
    const pulseL = `0.62*exp(-${decay}*${cycle})`;
    // Kanal kanan bergeser sedikit: memberi lebar stereo tanpa phasing aneh.
    const pulseR = `0.56*exp(-${decay}*mod((${theta})+0.35,6.283185)/6.283185)`;

    const h2 = (0.20 * (1 - profile.brightness * 0.35)).toFixed(3);
    const h3 = (0.13 * profile.brightness + 0.05).toFixed(3);
    const h4 = (0.08 * profile.brightness + 0.02).toFixed(3);
    const h5 = (0.05 * profile.brightness).toFixed(3);
    // Nada setengah orde: sumber "lope" khas V8 cross-plane dan V-twin.
    const halfOrder = profile.layout === 'V8' ? 0.16 : profile.layout === 'V10' || profile.layout === 'V12' ? 0.08 : 0.05;
    const sub = `${halfOrder.toFixed(3)}*sin(0.5*(${theta}))`;
    const harmonics =
      `${h2}*sin(2*(${theta}))+${h3}*sin(3*(${theta}))+${h4}*sin(4*(${theta}))+${h5}*sin(5*(${theta}))`;

    // Rasp: noise yang hanya terbuka saat katup buang membuka.
    const rasp = (0.16 * profile.rasp).toFixed(3);
    const raspSig = `${rasp}*(random(0)-0.5)*(0.25+0.75*exp(-6*${cycle}))`;
    // Intake honk: harmonisa ke-2 yang digeser sedikit -> terdengar "berongga".
    const intake = `0.06*sin(2.02*(${theta}))*(0.25+0.75*(${rpmExpr})/${(2 * Math.PI * profile.firingPerRev * redline) / 60})`;

    sources.push(`aevalsrc='${pulseL}+${sub}+${harmonics}+${raspSig}+${intake}|${pulseR}+${sub}+${harmonics}+${raspSig}+${intake}':d=${dur}:s=48000:c=stereo`);
    parts.push(`[0:a]highpass=f=45,lowpass=f=${Math.round(3200 + 5200 * profile.brightness)},volume=0.8[a0]`);

    // Turbo whistle / supercharger whine: frekuensi hampir tetap, level ikut rpm.
    if (profile.whine > 0.12) {
      const base = profile.aspiration === 'supercharged' ? 2400 : 4200;
      const span = profile.aspiration === 'supercharged' ? 2200 : 3600;
      const mod = `(0.15+0.85*(${rpmExpr})/${(2 * Math.PI * profile.firingPerRev * redline) / 60})`;
      const whistle = `${(0.07 * profile.whine).toFixed(3)}*sin(2*PI*(${base}+${span}*${mod})*t)*${mod}`;
      sources.push(`aevalsrc='${whistle}|${whistle}':d=${dur}:s=48000:c=stereo`);
      parts.push(`[1:a]highpass=f=2000,volume=0.55[a1]`);
      parts.push(`[a0][a1]amix=inputs=2:duration=longest:normalize=0[eng]`);
    } else {
      parts.push(`[a0]anull[eng]`);
    }

    // Overrun: letupan knalpot sporadis, hanya untuk mesin yang memang berisik.
    if (profile.rasp > 0.3) {
      const pops = `${(0.5 * profile.rasp).toFixed(2)}*(random(1)-0.5)*gt(random(2),0.9975)*gt(${rpmExpr},${(2 * Math.PI * profile.firingPerRev * redline * 0.45) / 60})`;
      sources.push(`aevalsrc='${pops}|${pops}':d=${dur}:s=48000:c=stereo`);
      parts.push(`[${sources.length - 1}:a]bandpass=f=1400:w=2400,volume=0.5,aformat=channel_layouts=stereo[pop]`);
      parts.push(`[eng][pop]amix=inputs=2:duration=first:normalize=0[eng3]`);
    }
  }

  const finalLabel = profile.aspiration === 'electric' ? 'eng' : profile.rasp > 0.3 ? 'eng3' : 'eng';
  parts.push(
    `[${finalLabel}]acompressor=threshold=0.12:ratio=3:attack=5:release=140,` +
      `afade=t=in:st=0:d=0.5,afade=t=out:st=${Math.max(0, dur - 1.2).toFixed(2)}:d=1.2,` +
      `loudnorm=I=-16:TP=-1.5:LRA=8[engout]`,
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
