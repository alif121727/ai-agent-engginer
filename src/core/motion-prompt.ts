/**
 * MotionPrompt — kontrak gerak untuk image-to-video.
 *
 * Akar masalah video "berkedip": prompt I2V biasanya mendeskripsikan ulang isi
 * gambar (subjek, warna, latar). Model lalu menganggap tugasnya meniru foto,
 * bukan menggerakkannya, sehingga gerakan melemah dan gambar melayang (drift).
 * Gambar referensi sudah mendefinisikan subjek; prompt hanya boleh berbicara
 * tentang gerakan. Empat lapis di bawah memaksa itu.
 */

export const CAMERA_MOVES = [
  'slow_dolly_in',
  'dolly_out',
  'pan_left',
  'pan_right',
  'orbit_clockwise',
  'crane_up',
  'zoom_in',
  'zoom_out',
  'static',
] as const;

export type CameraMove = (typeof CAMERA_MOVES)[number];

/** Satu gerakan kamera per klip; lebih dari itu membuat model mengarang morphing. */
export const MAX_CLIP_SECONDS = 6;
export const MIN_CLIP_SECONDS = 3;

export const DEFAULT_NEGATIVES =
  'morphing, warping, distortion, face deformation, flickering, jittering, sudden cuts, teleporting objects';

export interface MotionPrompt {
  /** Satu frasa verba konkret: apa yang bergerak dan bagaimana. */
  subject_action: string;
  camera_move: CameraMove;
  environmental_effects: string;
  negative_constraints: string;
  duration_seconds: number;
}

/**
 * Kata kunci yang menandakan prompt sedang mendeskripsikan ulang gambar.
 * Ini yang harus ditolak: menyebut subjek/warna/latar menggeser fokus model
 * dari gerakan ke peniruan.
 */
const REDESCRIBE_PATTERNS: { re: RegExp; why: string }[] = [
  { re: /\b(foto|photo|photograph|gambar|image|still|frame)\s+(of|dari|menunjukkan)\b/i, why: 'menyebut "foto/gambar dari"' },
  { re: /\b(shows|menampilkan|memperlihatkan|terlihat|terlihat seperti)\b/i, why: 'mendeskripsikan isi gambar ("menampilkan/terlihat")' },
  { re: /\b(a|an|sebuah|sebuah mobil)\s+(red|blue|black|white|silver|merah|biru|hitam|putih|perak)\b/i, why: 'menyebut warna subjek' },
  { re: /\b(background|latar belakang|background-nya)\s+(is|adalah|berupa)\b/i, why: 'mendeskripsikan latar belakang' },
  { re: /\b(the car|mobil ini|mobil tersebut)\s+(is|adalah|berwarna)\b/i, why: 'mendeskripsikan keadaan mobil' },
  { re: /\b\d{4}\b.*\b(coupe|sedan|suv|hatchback)\b/i, why: 'menyebut tipe/model kendaraan' },
];

/** Frasa gerakan kamera yang dikenali di dalam teks bebas. */
const MOVE_WORDS: { re: RegExp; move: CameraMove }[] = [
  { re: /\b(dolly(ing)?\s*in|push(ing)?\s*in|maju|mendekat)\b/i, move: 'slow_dolly_in' },
  { re: /\b(dolly(ing)?\s*out|pull(ing)?\s*out|mundur|menjauh)\b/i, move: 'dolly_out' },
  { re: /\bpan(s|ning)?\s*(ke\s*)?kiri\b|\bpan(s|ning)?\s*left\b/i, move: 'pan_left' },
  { re: /\bpan(s|ning)?\s*(ke\s*)?kanan\b|\bpan(s|ning)?\s*right\b/i, move: 'pan_right' },
  { re: /\borbit(s|ing)?\b/i, move: 'orbit_clockwise' },
  { re: /\b(crane|craning|tilt\s*naik|naik)\b/i, move: 'crane_up' },
  { re: /\bzoom(s|ing)?\s*in\b/i, move: 'zoom_in' },
  { re: /\bzoom(s|ing)?\s*out\b/i, move: 'zoom_out' },
  { re: /\bstatic\b|\bdiam\b/i, move: 'static' },
];

/** Gerakan kamera yang disebut di dalam teks, unik per jenis. */
export function detectCameraMoves(text: string): CameraMove[] {
  const found = new Set<CameraMove>();
  for (const { re, move } of MOVE_WORDS) if (re.test(text)) found.add(move);
  return [...found];
}

export interface MotionIssue {
  field: 'subject_action' | 'camera_move' | 'environmental_effects' | 'negative_constraints' | 'duration_seconds';
  code: 'empty' | 'multiple-camera-moves' | 'redescribes-image' | 'duration-out-of-range' | 'clip-too-long' | 'missing-negatives';
  message: string;
}

/**
 * Validasi yang dipakai gate sebelum render. Mengembalikan daftar pelanggaran;
 * kosong berarti prompt boleh dikirim ke model.
 */
export function validateMotionPrompt(
  prompt: MotionPrompt,
  options: { maxClipSeconds?: number } = {},
): MotionIssue[] {
  const issues: MotionIssue[] = [];
  const maxClip = options.maxClipSeconds ?? MAX_CLIP_SECONDS;

  const action = (prompt.subject_action ?? '').trim();
  if (!action) {
    issues.push({ field: 'subject_action', code: 'empty', message: 'aksi subjek kosong; model tidak punya alasan untuk bergerak' });
  }

  for (const { re, why } of REDESCRIBE_PATTERNS) {
    if (re.test(action)) {
      issues.push({ field: 'subject_action', code: 'redescribes-image', message: `prompt mendeskripsikan ulang gambar: ${why}` });
      break;
    }
  }

  // Gerakan kamera ganda adalah penyebab paling umum morphing: model mencoba
  // memenuhi dua instruksi yang saling bertabrakan dalam satu klip.
  const inAction = detectCameraMoves(action);
  const inEnv = detectCameraMoves(prompt.environmental_effects ?? '');
  const moves = new Set<CameraMove>([...inAction, ...inEnv]);
  if (prompt.camera_move !== 'static') moves.add(prompt.camera_move);
  if (moves.size > 1) {
    issues.push({
      field: 'camera_move',
      code: 'multiple-camera-moves',
      message: `lebih dari satu gerakan kamera (${[...moves].join(', ')}); pakai satu per klip`,
    });
  }

  if (!CAMERA_MOVES.includes(prompt.camera_move)) {
    issues.push({ field: 'camera_move', code: 'empty', message: `camera_move tidak dikenal: ${String(prompt.camera_move)}` });
  }

  const dur = prompt.duration_seconds;
  if (!Number.isFinite(dur) || dur < MIN_CLIP_SECONDS || dur > 10) {
    issues.push({ field: 'duration_seconds', code: 'duration-out-of-range', message: `durasi ${dur}s di luar 3-10s` });
  } else if (dur > maxClip) {
    issues.push({ field: 'duration_seconds', code: 'clip-too-long', message: `durasi ${dur}s melebihi batas ${maxClip}s; pecah jadi beberapa klip` });
  }

  const neg = (prompt.negative_constraints ?? '').trim();
  if (!neg) {
    issues.push({ field: 'negative_constraints', code: 'missing-negatives', message: 'negative_constraints wajib diisi' });
  } else {
    for (const must of ['morphing', 'warping', 'flicker']) {
      if (!neg.toLowerCase().includes(must)) {
        issues.push({ field: 'negative_constraints', code: 'missing-negatives', message: `negatif wajib memuat "${must}"` });
        break;
      }
    }
  }

  return issues;
}

/**
 * Format 4 bagian: aksi, kamera, lingkungan, tempo. "smooth fluid motion at
 * moderate speed" memberi model isyarat tempo yang biasanya hilang, dan itu
 * yang membuat hasil terasa seperti kamera bergerak, bukan foto bergeser.
 */
export function toPromptString(prompt: MotionPrompt): string {
  const parts = [
    prompt.subject_action.trim(),
    prompt.camera_move.replace(/_/g, ' '),
    prompt.environmental_effects?.trim(),
    'smooth fluid motion at moderate speed',
  ].filter(Boolean);
  return parts.join(', ');
}

/**
 * Klip lebih dari 6 detik dipecah, bukan diperpanjang: satu gerakan kamera
 * panjang memaksa model mengarang lintasan, dan di situlah wajah/bodi mobil
 * mulai berubah bentuk.
 */
export function splitLongClip(prompt: MotionPrompt, maxClipSeconds = MAX_CLIP_SECONDS): MotionPrompt[] {
  const total = Math.max(0, Math.round(prompt.duration_seconds));
  if (total <= maxClipSeconds) return [prompt];
  const count = Math.ceil(total / maxClipSeconds);
  const base = Math.floor(total / count);
  const remainder = total - base * count;
  return Array.from({ length: count }, (_, i) => ({
    ...prompt,
    duration_seconds: base + (i < remainder ? 1 : 0),
  }));
}
