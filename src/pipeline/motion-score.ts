/**
 * Motion critic — mengukur gerakan dari piksel, bukan dari niat prompt.
 *
 * Beda piksel mentah ternyata mengukur kontras, bukan gerakan: menambahkan
 * `vignette` menurunkan skor 0.418 -> 0.308 padahal geometri gerakannya sama
 * persis. Jadi skor sekarang dinormalkan terhadap detail frame:
 *
 *   displacement = rata-rata |cur - prev| / rata-rata |gradien spasiyal|
 *
 * Filter yang menggelapkan atau mengontraskan seluruh frame menskala pembilang
 * dan penyebut bersama-sama, sehingga skor hanya berubah kalau ada piksel yang
 * benar-benar berpindah. Satuannya kira-kira piksel per frame.
 */
import { spawnSync } from 'node:child_process';

export interface MotionScore {
  /** Perpindahan ternormalisasi (piksel/frame), dijepit 0..1. */
  score: number;
  /** Gerakan menyeluruh (kamera). */
  globalMotion: number;
  /** Gerakan lokal tak merata (subjek bergerak di dalam frame). */
  localMotion: number;
  /** localMotion/globalMotion — tinggi berarti ada objek bergerak, bukan hanya kamera. */
  localRatio: number;
  frames: number;
  passed: boolean;
}

const SAMPLE_FPS = 8;
const W = 96;
const H = 54;
const GRID_X = 8;
const GRID_Y = 6;
/** Perpindahan (piksel/frame) yang dianggap gerakan penuh. */
const FULL_SCALE = 0.9;

/**
 * Rata-rata gradien horizontal+vertikal, skala 0..255. Dipakai sebagai
 * penyebut: frame yang lebih detail butuh perpindahan lebih besar untuk
 * menghasilkan beda piksel yang sama.
 */
function spatialDetail(frame: Buffer): number {
  let sum = 0;
  let count = 0;
  for (let y = 0; y < H; y++) {
    const row = y * W;
    for (let x = 0; x < W; x++) {
      const v = frame[row + x];
      if (x + 1 < W) {
        sum += Math.abs(frame[row + x + 1] - v);
        count++;
      }
      if (y + 1 < H) {
        sum += Math.abs(frame[row + W + x] - v);
        count++;
      }
    }
  }
  return count ? sum / count : 0;
}

export function measureMotion(file: string, minScore: number): MotionScore {
  const res = spawnSync(
    'ffmpeg',
    ['-v', 'error', '-i', file, '-vf', `fps=${SAMPLE_FPS},scale=${W}:${H}`, '-f', 'rawvideo', '-pix_fmt', 'gray', '-'],
    { maxBuffer: 256 * 1024 * 1024 },
  );
  if (res.status !== 0) throw new Error(`motion critic: ffmpeg gagal (${(res.stderr ?? '').toString().slice(0, 200)})`);

  const buf = res.stdout as Buffer;
  const n = W * H;
  const frames = Math.floor(buf.length / n);
  if (frames < 2) {
    return { score: 0, globalMotion: 0, localMotion: 0, localRatio: 0, frames, passed: false };
  }

  const cw = Math.floor(W / GRID_X);
  const ch = Math.floor(H / GRID_Y);
  const cellDiffs: number[][] = [];
  const globals: number[] = [];

  // Detail frame: rata-rata |gradien spasiyal| pada frame pertama. Ini pengukur
  // kontras/ketajaman yang membagi beda antar-frame, sehingga filter global
  // (vignette, eq, noise) tidak lagi menggeser skor.
  const detail = spatialDetail(buf.subarray(0, n));

  for (let i = 1; i < frames; i++) {
    const prev = buf.subarray((i - 1) * n, i * n);
    const cur = buf.subarray(i * n, (i + 1) * n);
    const cells: number[] = [];
    for (let gy = 0; gy < GRID_Y; gy++) {
      for (let gx = 0; gx < GRID_X; gx++) {
        let sum = 0;
        for (let y = gy * ch; y < (gy + 1) * ch; y++) {
          const row = y * W;
          for (let x = gx * cw; x < (gx + 1) * cw; x++) {
            sum += Math.abs(prev[row + x] - cur[row + x]);
          }
        }
        cells.push(sum / (cw * ch));
      }
    }
    cellDiffs.push(cells);
    globals.push(cells.reduce((a, b) => a + b, 0) / cells.length);
  }

  const globalDiff = globals.reduce((a, b) => a + b, 0) / globals.length;
  const globalMotion = detail > 0.5 ? globalDiff / detail : 0;
  let localSum = 0;
  for (const cells of cellDiffs) {
    const mean = cells.reduce((a, b) => a + b, 0) / cells.length;
    localSum += cells.reduce((a, v) => a + Math.abs(v - mean), 0) / cells.length;
  }
  const localMotion = detail > 0.5 ? localSum / cellDiffs.length / detail : 0;
  const score = Math.min(1, globalMotion / FULL_SCALE);

  return {
    score: Math.round(score * 1000) / 1000,
    globalMotion: Math.round(globalMotion * 1000) / 1000,
    localMotion: Math.round(localMotion * 1000) / 1000,
    localRatio: Math.round((localMotion / Math.max(globalMotion, 0.001)) * 1000) / 1000,
    frames,
    passed: score >= minScore,
  };
}
