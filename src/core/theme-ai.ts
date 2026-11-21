import { normalize } from './theme.ts';
import type { Theme } from './types.ts';

/**
 * Tema yang dibuat AI, bukan dipilih dari daftar tetap.
 *
 * Tema bawaan (`templates/otomotif/themes.json`) hanya 7 dan dipilih lewat
 * pencocokan kata kunci, jadi Lamborghini dan McLaren selalu tampil sama.
 * Modul ini menyusun tema baru dari sinyal nyata yang kita punya — kategori,
 * mesin, tahun, tenaga — lalu menurunkannya jadi palet, bahasa kamera, dan
 * hook. Tidak ada angka spesifikasi yang dikarang: semuanya masuk ke teks
 * hanya lewat field katalog yang memang ada.
 */

export type AiThemeInput = {
  model: string;
  merk?: string;
  kategori?: string;
  mesin?: string;
  tenaga?: string;
  tahun?: string;
  tagline?: string;
  /** Gaya yang diminta pengguna; menang atas gaya turunan kategori. */
  gaya?: string;
  /** Nada feed: memengaruhi pacing dan panjang hook. */
  nada?: 'sinematik' | 'energik' | 'edukatif' | 'nostalgik';
};

export type AiTheme = Theme & {
  /** Asal tema, supaya UI jujur soal mana yang buatan AI. */
  origin: 'ai';
  /** Ringkasan keputusan, ditampilkan di UI sebagai "kenapa tema ini". */
  rationale: string[];
  /** Kalimat pembuka yang dipakai scene hook. */
  hook: string;
  /** Caption siap tempel untuk feed vertikal. */
  caption: string;
  hashtags: string[];
  /** Detak potongan; dipakai feed untuk memilih tempo musik. */
  pacing: 'lambat' | 'sedang' | 'cepat';
  /** Rasio yang paling cocok untuk tema ini. */
  aspect: '9:16' | '16:9' | '1:1';
};

const PALETTES: Record<string, { primary: string; secondary: string; accent: string }> = {
  balap: { primary: '#D40000', secondary: '#0A0A0A', accent: '#FFC400' },
  klasik: { primary: '#B8860B', secondary: '#1A1410', accent: '#F3E9D8' },
  sport: { primary: '#FF6A1A', secondary: '#0B0F14', accent: '#38E1FF' },
  modifikasi: { primary: '#7B2FF7', secondary: '#0A0A12', accent: '#00F0B5' },
};

const FALLBACK_PALETTE = { primary: '#FF6A1A', secondary: '#0A0A0A', accent: '#F3E9D8' };

/** Kata kunci tema ikut disimpan supaya pickTheme() tetap bisa menemukannya. */
function keywordsFor(input: AiThemeInput): string[] {
  const words = [input.model, input.merk ?? '', input.kategori ?? '']
    .map((w) => normalize(w))
    .filter(Boolean);
  const parts = normalize(input.model).split(' ').filter((w) => w.length > 2);
  return [...new Set([...words, ...parts])];
}

function isManual(mesin?: string): boolean {
  return /manual|6mt|5mt/i.test(mesin ?? '');
}

/**
 * Hibrida harus dicek sebelum listrik: Ferrari 296 GTB punya "motor listrik"
 * di deskripsi mesinnya, tapi tetap punya V6 twin-turbo yang berbunyi. Kalau
 * dicek sebagai EV murni, video-nya kehilangan adegan knalpot dan diberi tag #ev.
 */
function aspiration(mesin?: string): 'turbo' | 'na' | 'electric' | 'hybrid' {
  const text = mesin ?? '';
  const hasCombustion = /v\d|silinder|flat-?\d|rotary|boxer|wankel/i.test(text);
  const hasElectric = /listrik|electric|\bev\b/i.test(text);
  if (hasCombustion && hasElectric) return 'hybrid';
  if (hasElectric) return 'electric';
  return /turbo|supercharg/i.test(text) ? 'turbo' : 'na';
}

/**
 * Nada menentukan pacing dan bahasa kamera. Ini yang membuat video McLaren
 * tidak terasa sama dengan video Jaguar E-Type walau pipeline-nya identik.
 */
function resolveNada(input: AiThemeInput): NonNullable<AiThemeInput['nada']> {
  if (input.nada) return input.nada;
  const kategori = (input.kategori ?? '').toLowerCase();
  if (kategori === 'klasik') return 'nostalgik';
  if (kategori === 'balap') return 'energik';
  if (kategori === 'modifikasi') return 'energik';
  if (aspiration(input.mesin) === 'electric') return 'edukatif';
  return 'sinematik';
}

const NADA_STYLE: Record<
  NonNullable<AiThemeInput['nada']>,
  { pacing: AiTheme['pacing']; camera: string; lighting: string; grade: Theme['grade'] }
> = {
  sinematik: {
    pacing: 'sedang',
    camera: 'orbit sinematik lambat, dolly halus, speed ramp pendek',
    lighting: 'golden hour dengan rim light hangat dan bayangan panjang',
    grade: { contrast: 1.12, saturation: 1.05, temperature: 120 },
  },
  energik: {
    pacing: 'cepat',
    camera: 'whip pan, potongan pendek, tracking rendah, kamera goyang halus',
    lighting: 'kontras tinggi, lampu keras, refleksi tajam di bodi',
    grade: { contrast: 1.24, saturation: 1.16, temperature: -120 },
  },
  edukatif: {
    pacing: 'sedang',
    camera: 'slider stabil, close-up detail, gerak terukur',
    lighting: 'studio bersih dengan softbox dan latar netral',
    grade: { contrast: 1.06, saturation: 1.0, temperature: 0 },
  },
  nostalgik: {
    pacing: 'lambat',
    camera: 'dolly sangat lambat, framing simetris, tanpa gerak cepat',
    lighting: 'cahaya sore lembut, film grain halus, warna hangat',
    grade: { contrast: 1.08, saturation: 0.96, temperature: 260 },
  },
};

/**
 * Menyusun tema dari data katalog. Deterministik: model yang sama dengan input
 * yang sama selalu menghasilkan tema yang sama, jadi render bisa diulang.
 */
export function generateAiTheme(input: AiThemeInput): AiTheme {
  const kategori = (input.kategori ?? 'sport').toLowerCase();
  const nada = resolveNada(input);
  const style = NADA_STYLE[nada];
  const palette = PALETTES[kategori] ?? FALLBACK_PALETTE;
  const asp = aspiration(input.mesin);
  const rationale: string[] = [];

  rationale.push(
    input.kategori
      ? `kategori katalog "${input.kategori}" menentukan palet ${kategori}`
      : 'kategori tidak tercatat, dipakai palet sport netral',
  );
  rationale.push(`nada "${nada}" dipilih dari kategori dan jenis mesin`);

  if (asp === 'electric') {
    rationale.push('mesin listrik murni: tanpa adegan knalpot, tempo edukatif');
  } else if (asp === 'hybrid') {
    rationale.push('hibrida: tetap ada adegan mesin bakar, tag bukan #ev');
  } else if (asp === 'turbo') {
    rationale.push('mesin turbo: aksen dingin dan detail pipa intercooler');
  } else if (isManual(input.mesin)) {
    rationale.push('transmisi manual: tempo nostalgik, fokus ke mesin');
  }

  if (input.tahun) {
    const startYear = Number(String(input.tahun).match(/\d{4}/)?.[0] ?? 0);
    if (startYear && startYear < 1995) {
      rationale.push(`tahun ${input.tahun}: palet hangat dan grain film`);
    }
  }

  // Hook memakai tagline katalog kalau ada, karena itu sudah ditulis manusia
  // dan tidak mengarang angka. Kalau kosong, dipakai kalimat berbasis merk.
  const hook = input.tagline?.trim()
    ? input.tagline.trim()
    : `${input.model}: ${
        asp === 'electric' ? 'tenaga listrik tanpa suara' : 'suara mesin yang tidak bisa didiamkan'
      }.`;

  const hashtags = [
    '#otomotif',
    `#${normalize(input.merk ?? input.model).replace(/\s+/g, '') || 'mobilsport'}`,
    kategori === 'klasik' ? '#classiccar' : kategori === 'balap' ? '#trackday' : '#supercar',
    asp === 'electric' ? '#ev' : asp === 'hybrid' ? '#hybrid' : '#enginesound',
  ];

  const captionBits = [input.model];
  // Hanya field yang benar-benar ada di katalog yang masuk caption.
  if (input.tenaga) captionBits.push(input.tenaga);
  if (input.mesin) captionBits.push(input.mesin.split(',')[0].trim());

  return {
    id: `ai-${normalize(input.model).replace(/\s+/g, '-')}-${nada}`,
    origin: 'ai',
    keywords: keywordsFor(input),
    palette,
    mood: `${nada}, ${kategori}`,
    grade: style.grade,
    cameraLanguage: input.gaya?.trim() || style.camera,
    lighting: style.lighting,
    descriptor:
      `${input.model} dengan cat mengilap, proporsi realistis` +
      (kategori === 'klasik' ? ', detail krom dan garis bodi klasik' : ''),
    rationale,
    hook,
    caption: `${captionBits.join(' · ')}${input.tagline ? ` — ${input.tagline}` : ''}`,
    hashtags,
    pacing: style.pacing,
    // Feed vertikal adalah default studio ini; tema tenang tetap 9:16 supaya
    // satu perpustakaan bisa diputar di satu feed.
    aspect: '9:16',
  };
}

/** Bentuk tema AI menjadi Theme biasa, untuk dipakai pipeline yang sudah ada. */
export function asTheme(theme: AiTheme): Theme {
  return {
    id: theme.id,
    keywords: theme.keywords,
    palette: theme.palette,
    mood: theme.mood,
    grade: theme.grade,
    cameraLanguage: theme.cameraLanguage,
    lighting: theme.lighting,
    descriptor: theme.descriptor,
  };
}
