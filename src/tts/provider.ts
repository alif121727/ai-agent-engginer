/**
 * Sintesis suara narasi (TTS).
 *
 * Sebelum modul ini ada, `synthesize_speech` hanya mengembalikan teks dan
 * narasi tidak pernah masuk ke video. Audio yang dirender hanyalah mesin +
 * musik, sehingga penonton tidak mendengar satu kata pun. Itulah sebab utama
 * keluhan "suara tidak jelas".
 *
 * Penyedia utama ElevenLabs (suara paling natural). Bila tidak ada kunci API,
 * modul ini memakai Piper — mesin saraf lokal yang gratis — sehingga narasi
 * tetap ada pada instalasi tanpa anggaran TTS. Bila keduanya tidak tersedia,
 * pemanggilan melaporkan `skipped` dan pipeline berjalan tanpa narasi: lebih
 * baik video tanpa VO daripada audio palsu.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

export type VoiceTone = 'energik' | 'sinematik' | 'hangat' | 'tegas';

export interface VoiceChoice {
  tone: VoiceTone;
  voiceId: string;
  label: string;
  /** Kenapa voice ini dipilih, ditampilkan di UI agar user paham. */
  karakter: string;
}

/**
 * Voice bawaan ElevenLabs. Id-nya stabil, jadi aman disimpan di konfigurasi;
 * berbeda dari nama yang bisa berubah kapan saja.
 */
const VOICES: Record<VoiceTone, VoiceChoice> = {
  energik: {
    tone: 'energik',
    voiceId: 'IKne3meq5aSn9XLyUdCD',
    label: 'Charlie',
    karakter: 'dalam, percaya diri, energik — cocok untuk sport car dan EV',
  },
  sinematik: {
    tone: 'sinematik',
    voiceId: 'nPczCjzI2devNBz1zQrb',
    label: 'Brian',
    karakter: 'dalam dan bergema — cocok untuk dokumenter dan film pendek',
  },
  hangat: {
    tone: 'hangat',
    voiceId: 'JBFqnCBsd6RMkjVDRZzb',
    label: 'George',
    karakter: 'hangat, bercerita — cocok untuk SUV keluarga dan review',
  },
  tegas: {
    tone: 'tegas',
    voiceId: 'pNInz6obpgDQGcFmaJgB',
    label: 'Adam',
    karakter: 'tegas dan berwibawa — cocok untuk mobil mewah dan klasik',
  },
};

export const TONES = Object.keys(VOICES) as VoiceTone[];

export function isVoiceTone(value: unknown): value is VoiceTone {
  return typeof value === 'string' && (TONES as string[]).includes(value);
}

export function voiceForTone(tone: VoiceTone): VoiceChoice {
  return VOICES[tone];
}

/** Nada default diturunkan dari jenis mobil, supaya user tidak perlu memilih. */
export function toneForModel(model: string): VoiceTone {
  const m = model.toLowerCase();
  if (/taycan|ev|electric|listrik|ioniq|model [3sy]/.test(m)) return 'energik';
  if (/gt3|sto|765|pista|black series|nismo|z06|gt\b|supra|type r/.test(m)) return 'energik';
  if (/f40|countach|240z|ae86|e30|300 ?sl|stratos|e-type|mustang|klasik|classic/.test(m)) return 'tegas';
  if (/fortuner|pajero|rush|terios|suv|family|keluarga/.test(m)) return 'hangat';
  return 'sinematik';
}

/**
 * Parameter yang dipakai untuk setiap permintaan.
 *
 * `eleven_multilingual_v2` dipilih, bukan `turbo`: kualitasnya lebih tinggi dan
 * bahasa Indonesia termasuk yang didukung. Model turbo memang lebih murah,
 * tetapi justru menghasilkan suara datar — persis keluhan yang sedang
 * diperbaiki.
 *
 * `mp3_44100_192` bukan default API (`mp3_44100_128`). Bitrate 128 kbps
 * terdengar "tertutup" pada narasi pria berfrekuensi rendah.
 */
export const TTS_MODEL = 'eleven_multilingual_v2';
export const TTS_OUTPUT_FORMAT = 'mp3_44100_192';

export const VOICE_SETTINGS = {
  stability: 0.5,
  similarity_boost: 0.75,
  style: 0.3,
  use_speaker_boost: true,
} as const;

export interface SynthResult {
  ok: boolean;
  /** Berkas mp3 hasil sintesis. */
  file?: string;
  provider: string;
  model?: string;
  voiceId?: string;
  error?: string;
  /** true bila tidak ada kunci API; bukan kegagalan, hanya tidak tersedia. */
  skipped?: boolean;
}

function apiKey(): string | null {
  const key = process.env.TTS_API_KEY ?? process.env.ELEVENLABS_API_KEY ?? '';
  return key.trim() ? key.trim() : null;
}

/**
 * Mesin TTS lokal (Piper). Dipakai bila tidak ada kunci API, supaya narasi
 * tetap berbunyi tanpa biaya. Keberadaannya dideteksi sekali saat modul dimuat.
 */
export function piperBinary(): string | null {
  const explicit = process.env.PIPER_BIN;
  if (explicit && fs.existsSync(explicit)) return explicit;
  const kandidat = [
    path.join(process.env.HOME ?? '', '.local/bin/piper'),
    '/usr/local/bin/piper',
    '/usr/bin/piper',
  ];
  for (const p of kandidat) {
    if (p && fs.existsSync(p)) return p;
  }
  return null;
}

/** Berkas model Piper untuk bahasa tertentu. */
export function piperModel(lang = 'id'): string | null {
  const explicit = process.env.PIPER_MODEL;
  if (explicit && fs.existsSync(explicit)) return explicit;
  const root = path.join(process.cwd(), 'assets', 'tts');
  if (!fs.existsSync(root)) return null;
  const cocok = fs
    .readdirSync(root)
    .filter((f) => f.endsWith('.onnx') && f.startsWith(lang === 'id' ? 'id_' : 'en_'));
  if (cocok.length === 0) return null;
  return path.join(root, cocok[0]);
}

/** true bila narasi bisa dibuat, entah lewat API berbayar atau mesin lokal. */
export function ttsAvailable(): boolean {
  return apiKey() !== null || (piperBinary() !== null && piperModel() !== null);
}

/** Nama penyedia yang akan dipakai, untuk log dan UI. */
export function ttsProviderName(): 'elevenlabs' | 'piper' | 'tidak-ada' {
  if (apiKey()) return 'elevenlabs';
  if (piperBinary() && piperModel()) return 'piper';
  return 'tidak-ada';
}

/**
 * Menyintesis satu potong teks menjadi berkas mp3.
 *
 * Dipanggil per scene, bukan sekali untuk seluruh naskah, karena tiap scene
 * punya jendela waktu sendiri di timeline. Menggabungkan semua narasi jadi satu
 * berkas akan membuat narasi scene terakhir berbunyi di awal video.
 */
export async function synthesize(
  text: string,
  opts: { tone?: VoiceTone; outFile: string; timeoutMs?: number },
): Promise<SynthResult> {
  const kalimat = text.trim();
  if (!kalimat) return { ok: false, provider: 'elevenlabs', error: 'teks kosong' };

  const key = apiKey();
  if (!key) {
    // Tanpa kunci API, coba mesin lokal. Ini yang membuat narasi tetap ada
    // pada instalasi tanpa anggaran TTS.
    const lokal = synthesizeLocal(kalimat, opts);
    if (lokal) return lokal;
    return {
      ok: false,
      provider: 'tidak-ada',
      skipped: true,
      error: 'TTS_API_KEY belum diisi dan mesin TTS lokal tidak tersedia',
    };
  }

  const voice = voiceForTone(opts.tone ?? 'sinematik');
  // Basis URL bisa ditimpa untuk pengujian atau proxy perusahaan; defaultnya
  // endpoint resmi.
  const base = (process.env.TTS_BASE_URL ?? 'https://api.elevenlabs.io').replace(/\/$/, '');
  const url = `${base}/v1/text-to-speech/${voice.voiceId}?output_format=${TTS_OUTPUT_FORMAT}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 60_000);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'xi-api-key': key,
        'content-type': 'application/json',
        accept: 'audio/mpeg',
      },
      body: JSON.stringify({
        text: kalimat,
        model_id: TTS_MODEL,
        voice_settings: VOICE_SETTINGS,
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      const detail = (await res.text()).slice(0, 300);
      return {
        ok: false,
        provider: 'elevenlabs',
        model: TTS_MODEL,
        voiceId: voice.voiceId,
        error: `HTTP ${res.status}: ${detail}`,
      };
    }

    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.byteLength < 1024) {
      return { ok: false, provider: 'elevenlabs', error: 'respons audio kosong' };
    }

    fs.mkdirSync(path.dirname(opts.outFile), { recursive: true });
    fs.writeFileSync(opts.outFile, buf);
    return {
      ok: true,
      file: opts.outFile,
      provider: 'elevenlabs',
      model: TTS_MODEL,
      voiceId: voice.voiceId,
    };
  } catch (err) {
    return {
      ok: false,
      provider: 'elevenlabs',
      model: TTS_MODEL,
      error: err instanceof Error ? err.message : String(err),
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Sintesis dengan Piper, mesin saraf lokal.
 *
 * Piper menulis WAV mono 22 kHz. Berkas itu lalu dikonversi ke mp3 192 kbps
 * stereo 44,1 kHz supaya bentuk keluarannya sama dengan jalur ElevenLabs —
 * pemanggil tidak perlu tahu penyedia mana yang dipakai.
 *
 * Mengembalikan null bila mesin tidak ada, sehingga pemanggil bisa melaporkan
 * "tidak tersedia" alih-alih gagal.
 */
function synthesizeLocal(
  text: string,
  opts: { tone?: VoiceTone; outFile: string; timeoutMs?: number },
): SynthResult | null {
  const bin = piperBinary();
  const model = piperModel();
  if (!bin || !model) return null;

  const tmpWav = opts.outFile.replace(/\.mp3$/i, '') + '.piper.wav';
  fs.mkdirSync(path.dirname(opts.outFile), { recursive: true });

  const args = ['-m', model, '-f', tmpWav];
  // Panjang jeda antar kalimat; tanpa ini Piper berbicara terlalu rapat.
  if (process.env.PIPER_SENTENCE_SILENCE) {
    args.push('--sentence-silence', process.env.PIPER_SENTENCE_SILENCE);
  }

  const run = spawnSync(bin, args, {
    input: text,
    encoding: 'utf8',
    timeout: opts.timeoutMs ?? 120_000,
  });
  if (run.status !== 0 || !fs.existsSync(tmpWav)) {
    fs.rmSync(tmpWav, { force: true });
    return {
      ok: false,
      provider: 'piper',
      error: `piper gagal: ${(run.stderr ?? '').slice(0, 200) || `kode ${run.status}`}`,
    };
  }

  const enc = spawnSync(
    'ffmpeg',
    [
      '-hide_banner', '-loglevel', 'error', '-y',
      '-i', tmpWav,
      '-af', 'aresample=44100',
      '-ar', '44100', '-ac', '2',
      '-c:a', 'libmp3lame', '-b:a', '192k',
      opts.outFile,
    ],
    { encoding: 'utf8', timeout: 60_000 },
  );
  fs.rmSync(tmpWav, { force: true });

  if (enc.status !== 0 || !fs.existsSync(opts.outFile)) {
    return {
      ok: false,
      provider: 'piper',
      error: `encode gagal: ${(enc.stderr ?? '').slice(0, 200)}`,
    };
  }

  return {
    ok: true,
    file: opts.outFile,
    provider: 'piper',
    model: path.basename(model),
    voiceId: path.basename(model, '.onnx'),
  };
}
