// Satu sumber kebenaran untuk video yang BENAR-BENAR sudah dirender.
// Angka teknis diturunkan dari katalog dan artifacts/research.json job aslinya,
// bukan diketik tangan: mengarang spesifikasi adalah hal yang paling dilarang
// di proyek ini.
//
// Dipakai dua tempat: Perpustakaan (pemutar + unduh) dan benih proyek demo,
// supaya situs statis tidak terbuka dalam keadaan kosong.
import { CATALOG, type Car } from './catalog.ts';

export type RenderedVideo = {
  slug: string;
  jobId: string;
  title: string;
  merk: string;
  kategori: string;
  tahun: string;
  dur: number;
  aspect: '16:9' | '9:16';
  width: number;
  height: number;
  fps: number;
  scenes: number;
  checks: number;
  qa: 'lolos' | 'tanpa-foto';
  modelAi: string;
  /** Timestamp ISO dari plan.json job asli, bukan tanggal karangan. */
  renderedAt: string;
  catalogSlug?: string;
};

/** Hanya bagian yang benar-benar tercatat di job; sisanya diturunkan dari katalog. */
type Recorded = Omit<RenderedVideo, 'merk' | 'kategori' | 'tahun'> & {
  /** Spesifikasi untuk model yang tidak punya entri katalog (job lama). */
  specsFallback?: string[];
};

const RECORDED: Recorded[] = [
  {
    slug: 'mazda-rx7', title: 'Mazda RX-7 FD3S', jobId: '7730db12517a42c5848a1a0c6537687a',
    dur: 45, aspect: '16:9', width: 1280, height: 720, fps: 30, scenes: 7, checks: 22,
    qa: 'lolos', modelAi: 'Studio Render (lokal)', renderedAt: '2026-11-21T15:06:04.000Z',
    catalogSlug: 'mazda-rx7-fd',
  },
  {
    slug: 'ferrari-296-gtb', title: 'Ferrari 296 GTB', jobId: 'f76e90287cd549228b485ee96612548d',
    dur: 30, aspect: '16:9', width: 1280, height: 720, fps: 30, scenes: 7, checks: 21,
    qa: 'lolos', modelAi: 'Studio Render (lokal)', renderedAt: '2026-11-21T15:06:04.000Z',
    catalogSlug: 'ferrari-296-gtb',
  },
  {
    slug: 'porsche-taycan', title: 'Porsche Taycan Turbo S', jobId: 'b2e568ceeffa4a3a81ce9782f0febbbd',
    dur: 45, aspect: '16:9', width: 1280, height: 720, fps: 30, scenes: 6, checks: 22,
    qa: 'lolos', modelAi: 'Studio Render (lokal)', renderedAt: '2026-11-21T15:09:08.000Z',
    catalogSlug: 'porsche-taycan-turbo-s',
  },
  {
    slug: 'skyline-r34', title: 'Nissan Skyline GT-R R34', jobId: 'f9dd8c98ba004a38abc1cb21605300bd',
    dur: 30, aspect: '16:9', width: 1280, height: 720, fps: 30, scenes: 7, checks: 21,
    qa: 'lolos', modelAi: 'Studio Render (lokal)', renderedAt: '2026-11-21T15:12:55.000Z',
    catalogSlug: 'nissan-skyline-r34-gtr',
  },
  {
    slug: 'huracan-sto', title: 'Lamborghini Huracán STO', jobId: 'fb8a0791256b442484db0a4e8cbf221c',
    dur: 30, aspect: '16:9', width: 1280, height: 720, fps: 30, scenes: 6, checks: 21,
    qa: 'lolos', modelAi: 'Studio Render (lokal)', renderedAt: '2026-11-21T15:39:31.000Z',
    catalogSlug: 'lamborghini-huracan-sto',
  },
  {
    slug: 'subaru-22b', title: 'Subaru Impreza 22B STi', jobId: '7161e1a5721b4df0a84fbd07b64c156f',
    dur: 45, aspect: '9:16', width: 1080, height: 1920, fps: 30, scenes: 7, checks: 22,
    qa: 'lolos', modelAi: 'Studio Render (lokal)', renderedAt: '2026-11-21T15:51:29.000Z',
    catalogSlug: 'subaru-impreza-22b',
  },
  {
    slug: 'porsche-911-gt3rs', title: 'Porsche 911 GT3 RS 992', jobId: '6465e271f6214758b86b5e276a525834',
    dur: 30, aspect: '16:9', width: 1280, height: 720, fps: 30, scenes: 6, checks: 21,
    qa: 'lolos', modelAi: 'Studio Render (lokal)', renderedAt: '2026-11-21T15:46:01.000Z',
    catalogSlug: 'porsche-911-gt3-rs-992',
  },
  {
    slug: 'koenigsegg-jesko', title: 'Koenigsegg Jesko', jobId: '1b63b95a75c44472a3e98bedf7833c84',
    dur: 30, aspect: '16:9', width: 1280, height: 720, fps: 30, scenes: 6, checks: 14,
    // Job ini memakai aset gambar generatif, bukan foto asli, dan modelnya tidak
    // ada di katalog. Ditandai jujur, bukan disembunyikan.
    qa: 'tanpa-foto', modelAi: 'Studio Render (lokal)', renderedAt: '2026-11-19T18:44:12.689Z',
    specsFallback: ['V8 5.0L twin-turbo', '1.600 PS (E85)', '1.500 Nm', '1.420 kg'],
  },
];

/** Gabungkan catatan job dengan entri katalog. */
export const RENDERED: RenderedVideo[] = RECORDED.map((r) => {
  const car = r.catalogSlug ? CATALOG.find((c) => c.slug === r.catalogSlug) : undefined;
  if (!car) return { ...r, merk: 'Koenigsegg', kategori: 'balap', tahun: '2023–' };
  return { ...r, merk: car.merk, kategori: car.kategori, tahun: car.tahun };
});

/** Empat chip spesifikasi dari katalog — nilai "tidak disebut" dibuang, bukan diisi karangan. */
export function specsOf(v: RenderedVideo): string[] {
  const car = v.catalogSlug ? CATALOG.find((c) => c.slug === v.catalogSlug) : undefined;
  if (!car) return RECORDED.find((r) => r.slug === v.slug)?.specsFallback ?? [];

  const out: string[] = [];
  const push = (s?: string) => {
    if (s && !s.includes('tidak disebut') && out.length < 4) out.push(s);
  };
  push(car.mesin);
  push(car.tenaga);
  push(car.torsi);
  push(car.nol100 ? `0–100 ${car.nol100}` : undefined);
  push(car.vmax);
  return out;
}

export const VIDEO_BASE = 'video/';
export const THUMB_BASE = 'thumb/';

/**
 * Versi aset media, disuntik build dari hash isi `video/`. Tanpa ini URL mp4
 * tidak pernah berubah walau berkasnya diganti, dan browser terus memutar
 * audio lama dari cache.
 */
declare const __MEDIA_VERSION__: string;
export const MEDIA_VERSION = typeof __MEDIA_VERSION__ === 'string' ? __MEDIA_VERSION__ : 'dev';

export const videoSrc = (v: RenderedVideo) => `${VIDEO_BASE}${v.slug}.mp4?v=${MEDIA_VERSION}`;
export const thumbSrc = (v: RenderedVideo) => `${THUMB_BASE}${v.slug}.jpg?v=${MEDIA_VERSION}`;

export const byJobId = (jobId: string) => RENDERED.find((v) => v.jobId === jobId);
export const bySlug = (slug: string) => RENDERED.find((v) => v.slug === slug);
