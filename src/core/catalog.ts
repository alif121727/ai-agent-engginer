import path from 'node:path';
import { paths, readJson } from './fsx.ts';

export interface CatalogModel {
  slug: string;
  merk: string;
  model: string;
  seri: string;
  tahun: string;
  kategori: 'balap' | 'sport' | 'klasik';
  mesin: string;
  tenaga: string;
  torsi: string;
  layout: string;
  berat: string;
  nol100: string;
  vmax: string;
  tagline: string;
  deskripsi: string;
  sumber: string;
}

interface CatalogFile {
  sumber: string;
  models: CatalogModel[];
}

let cache: CatalogFile | null = null;

export function loadCatalog(): CatalogFile {
  if (!cache) {
    cache = readJson<CatalogFile>(path.join(paths.config, 'catalog.json'), { sumber: '', models: [] });
  }
  return cache;
}

export function findModel(name: string): CatalogModel | undefined {
  const key = normalize(name);
  return loadCatalog().models.find((m) => normalize(m.model) === key || m.slug === slugify(name));
}

function normalize(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function slugify(s: string): string {
  return normalize(s).replace(/\s+/g, '-');
}

/**
 * Spec lines are derived from the catalog, never invented: each one is a field
 * that came from the brief's source article. Order matters — the first three
 * are what the on-screen captions show.
 */
export function specLines(m: CatalogModel): string[] {
  return [
    `${m.mesin} · ${m.tenaga}`,
    `Torsi ${m.torsi} · ${m.layout}`,
    `0–100 km/jam ${m.nol100} · top speed ${m.vmax}`,
    `Berat ${m.berat} · produksi ${m.tahun}`,
    m.deskripsi,
  ];
}

export function detailBrief(m: CatalogModel): { tagline: string; keunggulan: string[] } {
  return { tagline: m.tagline, keunggulan: specLines(m) };
}
