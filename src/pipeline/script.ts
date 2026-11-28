/**
 * Penulisan narasi per scene.
 *
 * Dua jalur, dan urutannya disengaja:
 *
 * 1. LLM (bila `LLM_BASE_URL` + `LLM_API_KEY` + `LLM_MODEL` diisi) menulis
 *    narasi yang menyesuaikan diri dengan brief dan riset.
 * 2. Tanpa LLM, dipakai penyusun kalimat deterministik yang memvariasikan
 *    pola antar scene.
 *
 * Jalur kedua tetap ada karena studio harus bisa merender tanpa anggaran API.
 * Yang penting, kedua jalur tunduk pada batas panjang yang sama: narasi yang
 * kepanjangan akan terpotong di timeline dan terdengar seperti kalimat yang
 * putus di tengah.
 */
import { z } from 'zod';
import type { Brief, ScenePlan } from '../core/types.ts';

/** Rata-rata kecepatan bicara Piper Indonesia, diukur dari 80 karakter = 6,9 dtk. */
export const CHARS_PER_SECOND = 11.5;

/** Sisakan ruang agar klip TTS tidak menabrak scene berikutnya. */
export function maxCharsFor(durationSec: number): number {
  return Math.max(24, Math.floor(durationSec * CHARS_PER_SECOND * 0.92));
}

/**
 * Penjelasan hanya boleh jadi teks layar, jadi kalimat panjang dipendekkan ke
 * satu baris caption. Memotong di tengah kata membuat caption terbaca rusak.
 */
export function ringkasUntukLayar(teks: string, maks = 68): string {
  const bersih = teks.replace(/\s+/g, ' ').trim();
  if (bersih.length <= maks) return bersih;
  const potong = bersih.slice(0, maks);
  const spasi = potong.lastIndexOf(' ');
  return `${(spasi > 24 ? potong.slice(0, spasi) : potong).replace(/[,;:\-]$/, '')}`;
}

/** Narasi suara hanya dibuat kalau pengguna memintanya secara eksplisit. */
export function inginNarasi(brief: Brief): boolean {
  return brief.narasiSuara === true;
}

export interface ScriptLine {
  sceneIndex: number;
  onScreenText: string;
  voiceover: string;
}

export interface ScriptDraft {
  model: string;
  tagline: string;
  lines: ScriptLine[];
  /** Dari mana naskah berasal; dipakai log job dan panel artefak. */
  sumber: 'llm' | 'lokal';
  catatan?: string;
}

export interface SpecLine {
  text: string;
}

export interface CarDetail {
  merk: string;
  seri: string;
  tahun: string;
  mesin: string;
  tenaga: string;
  nol100: string;
  vmax?: string;
  layout?: string;
}

export interface ScriptInput {
  brief: Brief;
  scenes: ScenePlan[];
  specs: SpecLine[];
  detail: CarDetail | null;
}

// ------------------------------------------------------------ jalur LLM

export const LlmScriptSchema = z.object({
  lines: z
    .array(
      z.object({
        sceneIndex: z.number().int().nonnegative(),
        voiceover: z.string().min(8),
        onScreenText: z.string().optional(),
      }),
    )
    .min(1),
});

export interface LlmConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
}

export function llmConfig(): LlmConfig | null {
  const baseUrl = (process.env.LLM_BASE_URL ?? '').replace(/\/$/, '');
  const apiKey = process.env.LLM_API_KEY ?? '';
  const model = process.env.LLM_MODEL ?? '';
  if (!baseUrl || !apiKey || !model) return null;
  return { baseUrl, apiKey, model };
}

export function llmTersedia(): boolean {
  return llmConfig() !== null;
}

/**
 * Batas karakter per scene diteruskan ke prompt, bukan hanya dipotong setelah
 * jadi. Model yang tahu batasnya menulis kalimat utuh; pemotongan setelahnya
 * selalu menghasilkan kalimat pincang.
 */
export function buildScriptPrompt(input: ScriptInput): string {
  const { brief, scenes, specs, detail } = input;
  const daftarScene = scenes.map((s) => {
    const batas = maxCharsFor(s.duration);
    return [
      `- Scene ${s.index} (${s.duration} dtk, maks ${batas} karakter)`,
      `  peran: ${s.label} (${s.key})`,
      `  visual: ${s.shot}`,
      `  teks layar saat ini: ${s.onScreenText || '(kosong)'}`,
    ].join('\n');
  });

  const fakta = [
    `Model: ${brief.model}`,
    brief.tagline ? `Tagline: ${brief.tagline}` : '',
    detail ? `Data: ${detail.merk} ${detail.seri} ${detail.tahun}, mesin ${detail.mesin}, ${detail.tenaga}, 0-100 ${detail.nol100}` : '',
    brief.keunggulan?.length ? `Keunggulan yang disebut brief: ${brief.keunggulan.join('; ')}` : '',
    specs.length ? `Spesifikasi dari riset: ${specs.map((s) => s.text).join('; ')}` : '',
    brief.gaya ? `Gaya: ${brief.gaya}` : '',
  ]
    .filter(Boolean)
    .join('\n');

  return [
    'Kamu penulis naskah voice-over video otomotif berbahasa Indonesia.',
    '',
    'Aturan wajib:',
    '1. Satu kalimat per scene. Padat, konkret, tanpa basa-basi.',
    '2. Jangan mengarang angka. Hanya pakai angka yang ada di data di bawah.',
    '3. Jangan mengulang kalimat yang sama antar scene.',
    '4. Tulis angka dengan ejaan yang mudah dibaca mesin suara.',
    '5. Patuhi batas karakter tiap scene. Kalau tidak muat, ringkas.',
    '6. Tanpa tanda kutip, tanpa emoji, tanpa tanda hubung ganda.',
    '',
    'Data:',
    fakta,
    '',
    'Scene:',
    daftarScene.join('\n'),
    '',
    'Balas JSON: {"lines":[{"sceneIndex":0,"voiceover":"..."}]} untuk SETIAP scene.',
  ].join('\n');
}

/**
 * Memanggil LLM sekali dan memvalidasi hasilnya.
 *
 * Kegagalan apa pun (jaringan, HTTP, JSON rusak, skema tidak cocok) membuat
 * fungsi ini mengembalikan null supaya pemanggil bisa memakai jalur lokal.
 * Render tidak boleh gagal hanya karena LLM sedang bermasalah.
 */
export interface LlmAttempt {
  draft: ScriptDraft | null;
  /** Alasan kegagalan yang bisa ditampilkan ke pengguna, bukan pesan kabur. */
  alasan?: string;
}

export async function generateScriptWithLlm(
  input: ScriptInput,
  opts: { timeoutMs?: number } = {},
): Promise<LlmAttempt> {
  const cfg = llmConfig();
  if (!cfg) return { draft: null, alasan: 'LLM belum dikonfigurasi' };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 60_000);
  try {
    const res = await fetch(`${cfg.baseUrl}/chat/completions`, {
      method: 'POST',
      signal: controller.signal,
      headers: { 'content-type': 'application/json', authorization: `Bearer ${cfg.apiKey}` },
      body: JSON.stringify({
        model: cfg.model,
        temperature: 0.8,
        messages: [
          { role: 'system', content: 'Kamu penulis naskah video otomotif. Balas hanya JSON valid.' },
          { role: 'user', content: buildScriptPrompt(input) },
        ],
      }),
    });
    if (!res.ok) {
      // 402 = saldo habis, 401 = kunci salah. Dua hal ini butuh tindakan
      // berbeda, jadi jangan disamarkan menjadi "LLM gagal".
      const pesan =
        res.status === 402
          ? 'saldo LLM habis (HTTP 402)'
          : res.status === 401 || res.status === 403
            ? 'kunci LLM ditolak (HTTP ' + res.status + ')'
            : `LLM membalas HTTP ${res.status}`;
      return { draft: null, alasan: pesan };
    }

    const data = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const mentah = data.choices?.[0]?.message?.content ?? '';
    const json = extractJson(mentah);
    if (!json) return { draft: null, alasan: 'balasan LLM bukan JSON' };

    const parsed = LlmScriptSchema.safeParse(json);
    if (!parsed.success) return { draft: null, alasan: 'balasan LLM tidak sesuai skema' };

    const byIndex = new Map(parsed.data.lines.map((l) => [l.sceneIndex, l]));
    const lines: ScriptLine[] = input.scenes.map((scene) => {
      const dari = byIndex.get(scene.index);
      const batas = maxCharsFor(scene.duration);
      return {
        sceneIndex: scene.index,
        onScreenText: dari?.onScreenText?.trim() || scene.onScreenText,
        voiceover: clampSentence(dari?.voiceover?.trim() ?? '', batas),
      };
    });

    if (lines.some((l) => l.voiceover.length < 8)) {
      return { draft: null, alasan: 'ada scene tanpa narasi dari LLM' };
    }

    return {
      draft: {
        model: input.brief.model,
        tagline: input.brief.tagline ?? '',
        lines,
        sumber: 'llm',
      },
    };
  } catch (err) {
    const alasan =
      err instanceof Error && err.name === 'AbortError'
        ? 'LLM melewati batas waktu'
        : `LLM tidak dapat dihubungi: ${err instanceof Error ? err.message : String(err)}`;
    return { draft: null, alasan };
  } finally {
    clearTimeout(timer);
  }
}

/** Mengambil objek JSON dari balasan yang mungkin berpagar ```json. */
function extractJson(text: string): unknown {
  const bersih = text.trim();
  const pagar = bersih.match(/```(?:json)?\s*([\s\S]*?)```/);
  const isi = pagar ? pagar[1] : bersih;
  const awal = isi.indexOf('{');
  const akhir = isi.lastIndexOf('}');
  if (awal < 0 || akhir <= awal) return null;
  try {
    return JSON.parse(isi.slice(awal, akhir + 1));
  } catch {
    return null;
  }
}

/**
 * Memotong kalimat di batas kata terdekat, bukan di tengah kata.
 *
 * Dipakai hanya sebagai jaring pengaman; prompt sudah meminta model mematuhi
 * batas yang sama.
 */
export function clampSentence(text: string, maxChars: number): string {
  const kalimat = text.replace(/\s+/g, ' ').trim();
  if (kalimat.length <= maxChars) return kalimat;
  const potong = kalimat.slice(0, maxChars);
  const spasi = potong.lastIndexOf(' ');
  const rapi = spasi > maxChars * 0.6 ? potong.slice(0, spasi) : potong;
  return rapi.replace(/[,;:\-–—]$/, '').trim() + '.';
}

// ---------------------------------------------------------- jalur lokal

/** Variasi pembuka agar narasi tidak terasa berulang antar scene. */
const PEMBUKA: Record<string, string[]> = {
  hook: ['{model}.', 'Ini {model}.', '{model}, dalam satu tarikan napas.'],
  exterior: ['Dari setiap sudut, {model} tidak ingin dilupakan.', 'Garis bodinya bukan kebetulan.'],
  features: ['Salah satu andalannya: {spec}.', 'Inilah yang membuatnya berbeda: {spec}.'],
  detail_engine: ['Jantungnya {mesin}.', 'Di balik kap mesin: {mesin}.'],
  interior: ['Kabinnya dibangun untuk pengemudi.', 'Semua kontrol ada di tempat yang benar.'],
  action: ['Di jalan, {tenaga}.', 'Saat jalanan terbuka, karakter aslinya muncul.'],
  cta: ['{model}.', 'Sampai jumpa di jalan.'],
};

function pilih<T>(arr: T[], seed: number): T {
  return arr[Math.abs(seed) % arr.length];
}

/**
 * Memilih kandidat kalimat pertama yang muat, bukan memotong yang pertama.
 *
 * Memotong paksa menghasilkan kerusakan yang terlihat jelas di video:
 * tagline "Presisi tanpa kompromi" menjadi "Presisi.", dan nama mesin
 * "naturally aspirated" menjadi "naturally". Karena itu kandidat diuji
 * utuh-utuhnya, dan hanya kalau semuanya kepanjangan dipakai versi terpendek
 * yang dipotong di batas kata.
 */
function pilihYangMuat(kandidat: string[], maxChars: number): string {
  const rapi = kandidat
    .map((k) => k.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .map((k) => (/[.!?]$/.test(k) ? k : `${k}.`));
  if (!rapi.length) return '';
  const muat = rapi.filter((k) => k.length <= maxChars);
  if (muat.length) return muat[0];
  // Semua kepanjangan: ambil yang paling pendek agar kerusakannya paling kecil.
  const terpendek = rapi.reduce((a, b) => (a.length <= b.length ? a : b));
  return clampSentence(terpendek, maxChars);
}

/** Membuang ekor teknis yang menggantung tanpa arti bila dipotong. */
function rapikanSpec(teks: string): string {
  return teks
    .split(/[·(]/)[0]
    .replace(/\b(naturally|aspirated|turbocharged|supercharged)\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Penyusun kalimat tanpa LLM.
 *
 * Tujuannya bukan menggantikan LLM, tapi memastikan narasi tetap utuh, tidak
 * berulang, dan muat di durasi scene saat tidak ada kunci API.
 */
export function localVoiceoverFor(
  key: string,
  brief: Brief,
  specs: SpecLine[],
  index: number,
  detail: CarDetail | null,
  maxChars: number,
): string {
  const specMentah = specs[index % Math.max(1, specs.length)]?.text ?? '';
  const spec = rapikanSpec(specMentah);
  const keunggulan = brief.keunggulan?.[index % Math.max(1, brief.keunggulan.length)] ?? '';
  const pola = PEMBUKA[key] ?? ['{spec}', 'Detail {model}.'];
  const isi = (p: string) =>
    p
      .replace('{model}', brief.model)
      .replace('{spec}', spec || keunggulan || `detail ${brief.model}`)
      .replace('{mesin}', detail?.mesin ?? 'mesin yang tenang')
      .replace('{tenaga}', detail ? `${detail.tenaga} terasa langsung` : 'tenaganya terasa langsung');

  // Tagline dipakai utuh atau tidak sama sekali; memotongnya jadi tidak bermakna.
  // Varian tagline-saja dipakai saat "model + tagline" tidak muat di scene pendek.
  if (brief.tagline && (key === 'cta' || key === 'hook')) {
    return pilihYangMuat(
      [`${brief.model}. ${brief.tagline}`, `${brief.tagline}.`, brief.model],
      maxChars,
    );
  }

  const kandidat = [...pola.map(isi)];
  // Cadangan yang selalu pendek, supaya scene tidak pernah jatuh ke kalimat rusak.
  kandidat.push(`${brief.model}.`, `Detail ${brief.model}.`);
  return pilihYangMuat(kandidat, maxChars);
}

/** Menyusun naskah lengkap tanpa LLM. */
export function buildLocalScript(input: ScriptInput): ScriptDraft {
  const { brief, scenes, specs, detail } = input;
  return {
    model: brief.model,
    tagline: brief.tagline ?? '',
    sumber: 'lokal',
    lines: scenes.map((scene, i) => ({
      sceneIndex: scene.index,
      onScreenText: scene.onScreenText,
      voiceover: localVoiceoverFor(
        scene.key,
        brief,
        specs,
        i,
        detail,
        maxCharsFor(scene.duration),
      ),
    })),
  };
}

/**
 * Titik masuk tunggal: coba LLM, lalu jatuh ke jalur lokal.
 *
 * Tidak pernah melempar error, karena kegagalan menulis naskah tidak boleh
 * menggagalkan seluruh render.
 */
export async function buildScript(
  input: ScriptInput,
  opts: { useLlm?: boolean; timeoutMs?: number } = {},
): Promise<ScriptDraft> {
  if (opts.useLlm !== false && llmTersedia()) {
    const percobaan = await generateScriptWithLlm(input, opts);
    if (percobaan.draft) return percobaan.draft;
    return {
      ...buildLocalScript(input),
      catatan: `${percobaan.alasan ?? 'LLM gagal'}; dipakai naskah lokal`,
    };
  }
  return buildLocalScript(input);
}
