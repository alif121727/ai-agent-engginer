/**
 * Sintesis suara narasi (TTS).
 *
 * Sebelum modul ini ada, `synthesize_speech` hanya mengembalikan teks dan
 * narasi tidak pernah masuk ke video. Audio yang dirender hanyalah mesin +
 * musik, sehingga penonton tidak mendengar satu kata pun. Itulah sebab utama
 * keluhan "suara tidak jelas".
 *
 * Penyedia utama ElevenLabs. Tanpa kunci API, pemanggilan mengembalikan null
 * dan pipeline tetap jalan tanpa narasi — lebih baik video tanpa VO daripada
 * audio palsu.
 */
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

export function ttsAvailable(): boolean {
  return apiKey() !== null;
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
    return {
      ok: false,
      provider: 'elevenlabs',
      skipped: true,
      error: 'TTS_API_KEY belum diisi',
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
