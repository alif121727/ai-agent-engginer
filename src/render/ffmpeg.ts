import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

export interface ProbeInfo {
  ok: boolean;
  width?: number;
  height?: number;
  durationSec?: number;
  codec?: string;
  error?: string;
}

export function ffprobe(file: string): ProbeInfo {
  if (!fs.existsSync(file)) return { ok: false, error: 'file tidak ada' };
  const res = spawnSync(
    'ffprobe',
    ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', file],
    { encoding: 'utf8' },
  );
  if (res.status !== 0) return { ok: false, error: res.stderr?.slice(0, 400) ?? 'ffprobe gagal' };
  try {
    const json = JSON.parse(res.stdout) as {
      format?: { duration?: string };
      streams?: { codec_type?: string; width?: number; height?: number; codec_name?: string }[];
    };
    const video = json.streams?.find((s) => s.codec_type === 'video');
    return {
      ok: Boolean(video),
      width: video?.width,
      height: video?.height,
      durationSec: json.format?.duration ? Number(json.format.duration) : undefined,
      codec: video?.codec_name,
    };
  } catch {
    return { ok: false, error: 'output ffprobe tidak bisa dibaca' };
  }
}

export function ffmpegAvailable(): boolean {
  const res = spawnSync('ffmpeg', ['-version'], { encoding: 'utf8' });
  return res.status === 0;
}

/** Laplacian-ish sharpness proxy from a single grey frame dump. */
export function frameSharpness(file: string, atSec = 1): number {
  const tmp = path.join('/tmp', `sharp-${process.pid}-${Date.now()}.raw`);
  const res = spawnSync('ffmpeg', [
    '-v', 'error', '-y', '-ss', String(atSec), '-i', file,
    '-frames:v', '1', '-vf', 'scale=160:90,format=gray', '-f', 'rawvideo', tmp,
  ]);
  if (res.status !== 0 || !fs.existsSync(tmp)) return 0;
  const buf = fs.readFileSync(tmp);
  fs.rmSync(tmp, { force: true });
  if (buf.length < 160 * 90) return 0;
  let sum = 0;
  for (let y = 1; y < 89; y++) {
    for (let x = 1; x < 159; x++) {
      const c = buf[y * 160 + x];
      const l = buf[y * 160 + x - 1];
      const u = buf[(y - 1) * 160 + x];
      sum += Math.abs(c - l) + Math.abs(c - u);
    }
  }
  return Math.round(sum / (159 * 89));
}

/** 64-bit average hash, used to prove consecutive scenes differ. */
export function perceptualHash(file: string, atSec = 0.5): string {
  const tmp = path.join('/tmp', `hash-${process.pid}-${Date.now()}.raw`);
  const res = spawnSync('ffmpeg', [
    '-v', 'error', '-y', '-ss', String(atSec), '-i', file,
    '-frames:v', '1', '-vf', 'scale=8:8,format=gray', '-f', 'rawvideo', tmp,
  ]);
  if (res.status !== 0 || !fs.existsSync(tmp)) return '0'.repeat(16);
  const buf = fs.readFileSync(tmp);
  fs.rmSync(tmp, { force: true });
  if (buf.length < 64) return '0'.repeat(16);
  const avg = buf.subarray(0, 64).reduce((a, b) => a + b, 0) / 64;
  let bits = '';
  for (let i = 0; i < 64; i++) bits += buf[i] > avg ? '1' : '0';
  let hex = '';
  for (let i = 0; i < 64; i += 4) hex += parseInt(bits.slice(i, i + 4), 2).toString(16);
  return hex;
}

export function hamming(a: string, b: string): number {
  let diff = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    let x = parseInt(a[i], 16) ^ parseInt(b[i], 16);
    while (x) {
      diff += x & 1;
      x >>= 1;
    }
  }
  return diff;
}

/** OCR check: any detected word means a stray label slipped into the frame. */
export function detectText(file: string, atSec = 1): { hasText: boolean; text: string } {
  const res = spawnSync('which', ['tesseract'], { encoding: 'utf8' });
  if (res.status !== 0) return { hasText: false, text: 'ocr-tidak-tersedia' };
  const tmp = path.join('/tmp', `ocr-${process.pid}-${Date.now()}`);
  const grab = spawnSync('ffmpeg', [
    '-v', 'error', '-y', '-ss', String(atSec), '-i', file, '-frames:v', '1', `${tmp}.png`,
  ]);
  if (grab.status !== 0) return { hasText: false, text: '' };
  const ocr = spawnSync('tesseract', [`${tmp}.png`, 'stdout'], { encoding: 'utf8' });
  fs.rmSync(`${tmp}.png`, { force: true });
  const text = (ocr.stdout ?? '').trim();
  return { hasText: text.replace(/\s/g, '').length > 2, text };
}

/** Contact sheet of every scene, one row per 3 scenes. */
export function contactSheet(images: string[], outFile: string, cols = 3): string | null {
  const existing = images.filter((f) => fs.existsSync(f));
  if (!existing.length) return null;
  const args: string[] = ['-v', 'error', '-y'];
  for (const img of existing) args.push('-i', img);
  const scaled = existing
    .map((_, i) => `[${i}:v]scale=640:360:force_original_aspect_ratio=decrease,pad=640:360:(ow-iw)/2:(oh-ih)/2:color=0x141414[s${i}]`)
    .join(';');
  const rows = Math.ceil(existing.length / cols);
  let layout = '';
  for (let i = 0; i < rows * cols; i++) {
    const col = i % cols;
    const row = Math.floor(i / cols);
    layout += `${col * 640}_${row * 360}|`;
  }
  const pads = existing.map((_, i) => `[s${i}]`).join('');
  const filter = `${scaled};${pads}xstack=inputs=${existing.length}:layout=${layout.slice(0, -1)}:fill=0x141414`;
  const res = spawnSync('ffmpeg', [...args, '-filter_complex', filter, '-frames:v', '1', outFile]);
  return res.status === 0 ? outFile : null;
}
