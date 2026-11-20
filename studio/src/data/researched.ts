// Mobil hasil riset mandiri disimpan per akun supaya bisa dipakai lagi:
// muncul di daftar pilihan, dan proyek lama tetap bisa menemukan datanya
// setelah halaman dimuat ulang.

import type { Car } from './catalog.ts';

export type ResearchedCar = {
  car: Car;
  /** Label field yang tidak ditemukan di sumber, supaya UI tetap jujur. */
  missing: string[];
  photoUrl: string | null;
  photoCredit: string | null;
  photoLicense: string | null;
  photoPageUrl: string | null;
  articleTitle: string;
  articleUrl: string;
  researchedAt: number;
};

const KEY = 'asa.researched.anon';

/**
 * Naikkan bila bentuk data hasil riset berubah. Entri versi lama dibuang:
 * menyimpannya akan menampilkan spesifikasi yang sudah diperbaiki sebagai
 * data basi (mis. tanggal produksi di kolom seri).
 */
const SCHEMA = 3;

function key(): string {
  try {
    const raw = localStorage.getItem('asa.user');
    const email = raw ? (JSON.parse(raw) as { email?: string }).email : '';
    return `asa.researched.${email || 'anon'}`;
  } catch {
    return KEY;
  }
}

let cache: ResearchedCar[] | null = null;
let cacheKey = '';

export function listResearched(): ResearchedCar[] {
  const k = key();
  if (cache && cacheKey === k) return cache;
  try {
    const raw = localStorage.getItem(k);
    const stored = raw ? (JSON.parse(raw) as { schema?: number; items?: ResearchedCar[] }) : null;
    cache = stored?.schema === SCHEMA ? (stored.items ?? []) : [];
  } catch {
    cache = [];
  }
  cacheKey = k;
  return cache;
}

/** Simpan hasil riset; slug yang sama menimpa entri lama. */
export function saveResearched(entry: ResearchedCar): ResearchedCar[] {
  const k = key();
  const next = [entry, ...listResearched().filter((r) => r.car.slug !== entry.car.slug)].slice(0, 40);
  try {
    localStorage.setItem(k, JSON.stringify({ schema: SCHEMA, items: next }));
  } catch {
    /* kuota penuh: hasil tetap ada di memori untuk sesi ini */
  }
  cache = next;
  cacheKey = k;
  return next;
}

export function findResearched(slug?: string | null): ResearchedCar | undefined {
  const s = (slug ?? '').trim();
  if (!s) return undefined;
  return listResearched().find((r) => r.car.slug === s);
}

export function removeResearched(slug: string): ResearchedCar[] {
  const k = key();
  const next = listResearched().filter((r) => r.car.slug !== slug);
  try {
    localStorage.setItem(k, JSON.stringify({ schema: SCHEMA, items: next }));
  } catch {
    /* abaikan */
  }
  cache = next;
  cacheKey = k;
  return next;
}

/** Hanya untuk tes: lupakan cache memori. */
export function resetResearchedCache(): void {
  cache = null;
  cacheKey = '';
}
