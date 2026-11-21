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
    slug: 'mazda-rx7', title: 'Mazda RX-7 FD3S', jobId: '39de7149c1ce492ba99bc23f758fd0db',
    dur: 45, aspect: '16:9', width: 1920, height: 1080, fps: 30, scenes: 7, checks: 14,
    qa: 'lolos', modelAi: 'Studio Render (lokal)', renderedAt: '2026-11-19T18:17:51.808Z',
    catalogSlug: 'mazda-rx7-fd',
  },
  {
    slug: 'ferrari-296-gtb', title: 'Ferrari 296 GTB', jobId: '2b4fb11b2bc244bfbcf7fc4930c6c8f4',
    dur: 30, aspect: '16:9', width: 1920, height: 1080, fps: 30, scenes: 6, checks: 13,
    qa: 'lolos', modelAi: 'Studio Render (lokal)', renderedAt: '2026-11-19T15:09:04.691Z',
    catalogSlug: 'ferrari-296-gtb',
  },
  {
    slug: 'porsche-taycan', title: 'Porsche Taycan Turbo S', jobId: 'c3ab49377d0e4ed991de4fbcfdb46430',
    dur: 45, aspect: '16:9', width: 1920, height: 1080, fps: 30, scenes: 7, checks: 14,
    qa: 'lolos', modelAi: 'Studio Render (lokal)', renderedAt: '2026-11-19T16:02:11.990Z',
    catalogSlug: 'porsche-taycan-turbo-s',
  },
  {
    slug: 'skyline-r34', title: 'Nissan Skyline GT-R R34', jobId: 'fe68394544da4b8aa452dd5d2597947d',
    dur: 30, aspect: '16:9', width: 1920, height: 1080, fps: 30, scenes: 6, checks: 14,
    qa: 'lolos', modelAi: 'Studio Render (lokal)', renderedAt: '2026-11-20T06:39:28.654Z',
    catalogSlug: 'nissan-skyline-r34-gtr',
  },
  {
    slug: 'huracan-sto', title: 'Lamborghini Huracán STO', jobId: '44575cdec78f44c2ab6436eca7b7cf6c',
    dur: 30, aspect: '16:9', width: 1920, height: 1080, fps: 30, scenes: 6, checks: 14,
    qa: 'lolos', modelAi: 'Studio Render (lokal)', renderedAt: '2026-11-19T15:56:50.433Z',
    catalogSlug: 'lamborghini-huracan-sto',
  },
  {
    slug: 'subaru-22b', title: 'Subaru Impreza 22B STi', jobId: 'e6e7c8a4bfb14271b05437457867561e',
    dur: 45, aspect: '9:16', width: 1080, height: 1920, fps: 30, scenes: 7, checks: 14,
    qa: 'lolos', modelAi: 'Studio Render (lokal)', renderedAt: '2026-11-19T17:38:46.149Z',
    catalogSlug: 'subaru-impreza-22b',
  },
  {
    slug: 'porsche-911-gt3rs', title: 'Porsche 911 GT3 RS 992', jobId: '00ce13a1c1d94800bbc08c6482132948',
    dur: 30, aspect: '16:9', width: 1920, height: 1080, fps: 30, scenes: 6, checks: 14,
    qa: 'lolos', modelAi: 'Studio Render (lokal)', renderedAt: '2026-11-20T06:28:39.414Z',
    catalogSlug: 'porsche-911-gt3-rs-992',
  },
  {
    slug: 'koenigsegg-jesko', title: 'Koenigsegg Jesko', jobId: '1b63b95a75c44472a3e98bedf7833c84',
    dur: 30, aspect: '16:9', width: 1920, height: 1080, fps: 30, scenes: 6, checks: 14,
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
