/**
 * Narasi: sintesis per scene, pasca-proses, lalu penempatan di timeline.
 *
 * Tiga hal yang membuat narasi sulit didengar, dan bagaimana masing-masing
 * ditangani di sini:
 *
 * 1. Tidak ada narasi sama sekali (bug lama: TTS hanya mengembalikan teks).
 * 2. Tiap klip TTS punya level berbeda, jadi volume naik-turun antar scene.
 *    Di sini setiap klip dinormalisasi ke -16 LUFS sebelum digabung.
 * 3. Narasi harus mulai di awal scene-nya, bukan menumpuk di detik nol.
 *    Karena itu klip diberi jeda (`adelay`) sesuai `scene.start`.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { jobDir } from '../core/fsx.ts';
import type { ScenePlan } from '../core/types.ts';
import { synthesize, toneForModel, type VoiceTone } from '../tts/provider.ts';

/**
 * Rantai pasca-proses untuk narasi.
 *
 * Urutannya penting: high-pass dulu membuang rumble yang akan memicu
 * kompresor, baru EQ membentuk karakter, kompresor meratakan, dan loudnorm
 * menaruh level akhir. Kalau loudnorm ditaruh lebih awal, kompresor sesudahnya
 * akan mengubah level yang baru saja distabilkan.
 */
export const NARRATION_FILTER =
  'highpass=f=80,' +
  'equalizer=f=200:t=q:w=1:g=-2,' +
  'equalizer=f=3000:t=q:w=1:g=3,' +
  'equalizer=f=5000:t=q:w=1:g=2,' +
  'acompressor=threshold=-12dB:ratio=3:attack=5:release=50,' +
  'loudnorm=I=-16:TP=-1.5:LRA=11';

export interface NarrationClip {
  sceneIndex: number;
  start: number;
  duration: number;
  file: string;
  text: string;
  /** Durasi audio setelah diproses; dipakai untuk memperingatkan overdub. */
  audioDuration?: number;
}

export interface NarrationResult {
  ok: boolean;
  clips: NarrationClip[];
  /** Satu berkas berisi semua narasi yang sudah ditempatkan di timeline. */
  trackFile?: string;
  tone: VoiceTone;
  skipped?: boolean;
  errors: string[];
}

function ffmpeg(args: string[]): { ok: boolean; err: string } {
  const res = spawnSync('ffmpeg', args, { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
  return { ok: res.status === 0, err: (res.stderr ?? '').slice(-400) };
}

function probeDuration(file: string): number | null {
  const res = spawnSync(
    'ffprobe',
    ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', file],
    { encoding: 'utf8' },
  );
  const v = Number((res.stdout ?? '').trim());
  return Number.isFinite(v) && v > 0 ? v : null;
}

/**
 * Memproses satu klip TTS: bentuk karakter, ratakan, normalisasi, lalu simpan
 * sebagai wav 48 kHz. Wav dipilih di tahap ini supaya penggabungan berikutnya
 * tidak menumpuk dua kali kompresi lossy.
 */
export function processClip(input: string, output: string): boolean {
  return ffmpeg([
    '-v', 'error', '-y',
    '-i', input,
    '-af', NARRATION_FILTER,
    '-ar', '48000', '-ac', '2',
    '-c:a', 'pcm_s16le',
    output,
  ]).ok;
}

/**
 * Menggabungkan klip narasi ke satu trek sesuai posisi scene.
 *
 * `adelay` dipakai alih-alih `-itsoffset` karena semua input digabung dalam
 * satu filter graph: dengan `amix`, setiap klip tetap mulai di detik nol kecuali
 * digeser secara eksplisit. `apad` + `atrim` memastikan panjang total tepat
 * sama dengan durasi video, sehingga `-shortest` tidak memotong musik.
 */
export function buildTrack(clips: NarrationClip[], durationSec: number, out: string): boolean {
  if (!clips.length) return false;
  const dur = Math.max(1, durationSec);
  const inputs = clips.flatMap((c) => ['-i', c.file]);

  const parts: string[] = [];
  const labels: string[] = [];
  clips.forEach((clip, i) => {
    const delayMs = Math.round(clip.start * 1000);
    parts.push(`[${i}:a]adelay=${delayMs}|${delayMs}[n${i}]`);
    labels.push(`[n${i}]`);
  });
  parts.push(
    `${labels.join('')}amix=inputs=${clips.length}:duration=longest:normalize=0,` +
      `apad,atrim=0:${dur.toFixed(3)},` +
      `loudnorm=I=-16:TP=-1.5:LRA=11[aout]`,
  );

  return ffmpeg([
    '-v', 'error', '-y',
    ...inputs,
    '-filter_complex', parts.join(';'),
    '-map', '[aout]',
    '-ar', '48000', '-ac', '2', '-c:a', 'pcm_s16le', '-t', String(dur),
    out,
  ]).ok;
}

/**
 * Menyiapkan seluruh narasi untuk satu job.
 *
 * Semua klip scene disintesis lebih dulu, lalu diproses, baru digabung. Kalau
 * satu scene gagal (misalnya kuota API habis), scene lain tetap dipakai:
 * narasi sebagian jauh lebih berguna daripada tidak ada narasi sama sekali.
 */
export async function buildNarration(input: {
  jobId: string;
  scenes: ScenePlan[];
  model: string;
  tone?: VoiceTone;
  durationSec: number;
}): Promise<NarrationResult> {
  const tone = input.tone ?? toneForModel(input.model);
  const dir = path.join(jobDir(input.jobId), 'audio', 'narration');
  fs.mkdirSync(dir, { recursive: true });

  const errors: string[] = [];
  const clips: NarrationClip[] = [];
  let skipped = false;

  for (const scene of input.scenes) {
    const text = (scene.voiceover ?? '').trim();
    if (!text) continue;

    const raw = path.join(dir, `scene-${String(scene.index + 1).padStart(2, '0')}.mp3`);
    const done = path.join(dir, `scene-${String(scene.index + 1).padStart(2, '0')}.wav`);

    if (!fs.existsSync(done)) {
      const res = await synthesize(text, { tone, outFile: raw });
      if (!res.ok) {
        if (res.skipped) skipped = true;
        errors.push(`scene ${scene.index + 1}: ${res.error ?? 'gagal'}`);
        continue;
      }
      if (!processClip(raw, done)) {
        errors.push(`scene ${scene.index + 1}: pasca-proses gagal`);
        continue;
      }
      fs.rmSync(raw, { force: true });
    }

    clips.push({
      sceneIndex: scene.index,
      start: scene.start,
      duration: scene.duration,
      file: done,
      text,
      audioDuration: probeDuration(done) ?? undefined,
    });
  }

  if (!clips.length) {
    return { ok: false, clips, tone, skipped, errors };
  }

  const trackFile = path.join(dir, 'narration.wav');
  const ok = buildTrack(clips, input.durationSec, trackFile);
  if (!ok) errors.push('penggabungan trek narasi gagal');
  return { ok, clips, trackFile: ok ? trackFile : undefined, tone, skipped, errors };
}
