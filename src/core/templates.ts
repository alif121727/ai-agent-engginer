import { normalize } from './theme.ts';

/**
 * Template = resep urutan shot, bukan sekadar label.
 *
 * Template di sini benar-benar mengubah video: `sceneKeys` menentukan urutan
 * dan pilihan scene yang dipakai `planScenes()`. Jadi memilih "Track Day"
 * menghasilkan hook agresif tanpa scene interior, sedangkan "Heritage"
 * membuang scene aksi dan menahan tempo.
 *
 * Pencariannya bukan pencarian teks biasa: setiap template diberi skor dari
 * beberapa sinyal (kata kunci, kategori, durasi, rasio, nada) dan skor itu
 * dijelaskan per komponen, supaya pengguna tahu kenapa sebuah template muncul
 * di atas.
 */

export type Template = {
  id: string;
  name: string;
  desc: string;
  /** Kata kunci untuk pencocokan bebas. */
  tags: string[];
  /** Kategori katalog yang paling cocok; kosong berarti semua. */
  kategori: string[];
  /** Urutan scene. Kunci harus ada di SCENE_KEYS pipeline. */
  sceneKeys: string[];
  aspect: '9:16' | '16:9' | '1:1';
  pacing: 'lambat' | 'sedang' | 'cepat';
  /** Durasi minimum yang masuk akal untuk resep ini. */
  minDurasi: number;
  origin: 'bawaan' | 'ai';
  /** Kalau dibuat AI, ini alasan yang ditulis generator. */
  rationale?: string[];
};

export type SearchHit = {
  template: Template;
  score: number;
  /** Penjelasan per komponen skor, urut dari yang paling berpengaruh. */
  alasan: string[];
};

/** Kunci scene yang benar-benar dikenal `buildSceneList()`. */
export const SCENE_KEYS = [
  'hook',
  'exterior',
  'features',
  'interior',
  'action',
  'cta',
  'detail_wheel',
  'detail_engine',
  'night',
  'lifestyle',
] as const;

export const BUILTIN_TEMPLATES: Template[] = [
  {
    id: 'showroom-30',
    name: 'Showroom 30 detik',
    desc: 'Alur klasik: hook, eksterior, fitur, interior, aksi, penutup. Aman untuk semua model.',
    tags: ['showroom', 'klasik', 'umum', 'standar', 'review', 'dealer'],
    kategori: [],
    sceneKeys: ['hook', 'exterior', 'features', 'interior', 'action', 'cta'],
    aspect: '9:16',
    pacing: 'sedang',
    minDurasi: 30,
    origin: 'bawaan',
  },
  {
    id: 'track-day',
    name: 'Track Day',
    desc: 'Tanpa interior. Fokus ke aksi, velg, dan mesin. Potongan cepat untuk mobil balap.',
    tags: ['balap', 'track', 'sirkuit', 'cepat', 'performa', 'lap'],
    kategori: ['balap', 'sport'],
    sceneKeys: ['hook', 'detail_wheel', 'action', 'detail_engine', 'action', 'cta'],
    aspect: '9:16',
    pacing: 'cepat',
    minDurasi: 30,
    origin: 'bawaan',
  },
  {
    id: 'heritage',
    name: 'Warisan Klasik',
    desc: 'Tempo lambat, tanpa aksi. Menonjolkan garis bodi dan detail krom mobil tua.',
    tags: ['klasik', 'vintage', 'heritage', 'retro', 'kolektor', 'mobil tua'],
    kategori: ['klasik'],
    sceneKeys: ['hook', 'exterior', 'features', 'detail_engine', 'interior', 'cta'],
    aspect: '9:16',
    pacing: 'lambat',
    minDurasi: 30,
    origin: 'bawaan',
  },
  {
    id: 'night-run',
    name: 'Night Run',
    desc: 'Malam kota basah, refleksi neon, tempo cepat. Cocok untuk tuner dan street culture.',
    tags: ['malam', 'night', 'neon', 'tuner', 'street', 'kota', 'basah'],
    kategori: ['modifikasi', 'sport'],
    sceneKeys: ['hook', 'night', 'detail_wheel', 'action', 'night', 'cta'],
    aspect: '9:16',
    pacing: 'cepat',
    minDurasi: 30,
    origin: 'bawaan',
  },
  {
    id: 'garage-story',
    name: 'Cerita Garasi',
    desc: 'Sudut pandang pemilik: gaya hidup, mesin, dan detail. Tempo tenang, terasa personal.',
    tags: ['garasi', 'pemilik', 'lifestyle', 'personal', 'story', 'modifikasi'],
    kategori: ['modifikasi', 'klasik'],
    sceneKeys: ['hook', 'lifestyle', 'detail_engine', 'exterior', 'interior', 'cta'],
    aspect: '9:16',
    pacing: 'sedang',
    minDurasi: 30,
    origin: 'bawaan',
  },
  {
    id: 'ev-explainer',
    name: 'Penjelas EV',
    desc: 'Untuk mobil listrik: tanpa adegan knalpot, fokus fitur dan interior, tempo terukur.',
    tags: ['listrik', 'ev', 'electric', 'edukasi', 'penjelasan', 'teknologi'],
    kategori: ['sport'],
    sceneKeys: ['hook', 'exterior', 'features', 'interior', 'features', 'cta'],
    aspect: '9:16',
    pacing: 'sedang',
    minDurasi: 30,
    origin: 'bawaan',
  },
];

export type SearchOptions = {
  /** Kata kunci bebas dari kotak pencarian. */
  q?: string;
  /** Kategori model yang sedang dipilih. */
  kategori?: string;
  /** Durasi yang diminta. */
  durasi?: number;
  aspect?: string;
  /** Nada yang diminta pengguna. */
  nada?: string;
  /** Kumpulan template tambahan (mis. hasil AI) yang ikut dicari. */
  extra?: Template[];
};

const PACING_WORDS: Record<string, string[]> = {
  cepat: ['cepat', 'energik', 'agresif', 'balap', 'cepat', 'kencang'],
  lambat: ['lambat', 'tenang', 'sinematik', 'klasik', 'halus', 'santai'],
  sedang: ['sedang', 'seimbang', 'netral', 'edukasi'],
};

/**
 * Memberi skor 0..100 pada satu template untuk satu permintaan.
 * Semua komponen dijumlahkan lalu dipotong di 100; tidak ada angka ajaib yang
 * disembunyikan, tiap komponen punya alasan yang bisa dibaca pengguna.
 */
function scoreTemplate(t: Template, opt: SearchOptions): SearchHit {
  let score = 0;
  const alasan: string[] = [];
  const q = normalize(opt.q ?? '');

  if (q) {
    const haystack = normalize([t.name, t.desc, ...t.tags, t.id].join(' '));
    const words = q.split(' ').filter((w) => w.length > 1);
    const hits = words.filter((w) => haystack.includes(w));
    if (hits.length) {
      const pts = Math.min(45, Math.round((hits.length / Math.max(1, words.length)) * 45));
      score += pts;
      alasan.push(`cocok kata kunci "${hits.join(', ')}" (+${pts})`);
    }
    // Nama template yang persis mengandung seluruh kueri lebih kuat.
    if (normalize(t.name).includes(q)) {
      score += 15;
      alasan.push('nama template memuat seluruh kueri (+15)');
    }
  }

  if (opt.kategori) {
    if (t.kategori.includes(opt.kategori.toLowerCase())) {
      score += 25;
      alasan.push(`kategori "${opt.kategori}" memang target template ini (+25)`);
    } else if (t.kategori.length === 0) {
      score += 10;
      alasan.push('template umum, berlaku untuk semua kategori (+10)');
    } else {
      score -= 10;
      alasan.push(`dibuat untuk ${t.kategori.join('/')}, bukan ${opt.kategori} (-10)`);
    }
  }

  if (typeof opt.durasi === 'number') {
    if (opt.durasi >= t.minDurasi) {
      score += 12;
      alasan.push(`durasi ${opt.durasi}s memenuhi minimum ${t.minDurasi}s (+12)`);
    } else {
      const gap = t.minDurasi - opt.durasi;
      score -= Math.min(30, gap);
      alasan.push(`kurang ${gap}s dari minimum template (-${Math.min(30, gap)})`);
    }
  }

  if (opt.aspect) {
    if (opt.aspect === t.aspect) {
      score += 8;
      alasan.push(`rasio ${t.aspect} sama (+8)`);
    } else {
      score -= 5;
      alasan.push(`rasio beda (${t.aspect} vs ${opt.aspect}) (-5)`);
    }
  }

  if (opt.nada) {
    const words = PACING_WORDS[t.pacing] ?? [];
    const match = words.some((w) => normalize(opt.nada ?? '').includes(w));
    if (match) {
      score += 10;
      alasan.push(`tempo "${t.pacing}" cocok dengan nada ${opt.nada} (+10)`);
    }
  }

  return { template: t, score: Math.max(0, Math.min(100, score)), alasan };
}

/**
 * Mengembalikan template terurut dari yang paling cocok.
 * Template dengan skor 0 tetap disertakan di akhir supaya pengguna tidak
 * melihat daftar kosong hanya karena kuerinya tidak lazim.
 */
export function searchTemplates(opt: SearchOptions = {}): SearchHit[] {
  const all = [...BUILTIN_TEMPLATES, ...(opt.extra ?? [])];
  return all.map((t) => scoreTemplate(t, opt)).sort((a, b) => b.score - a.score || a.template.name.localeCompare(b.template.name));
}

export function findTemplate(id: string, extra: Template[] = []): Template | undefined {
  return [...BUILTIN_TEMPLATES, ...extra].find((t) => t.id === id);
}
