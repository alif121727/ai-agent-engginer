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
 * Fields the source article does not state are marked with this prefix instead
 * of a number. Showing the marker on screen would be nonsense, so lines that
 * depend on it are dropped entirely.
 */
const UNSTATED = 'tidak disebut di sumber';

function stated(...values: string[]): boolean {
  return values.every((v) => v && !v.includes(UNSTATED));
}

/**
 * Spec lines are derived from the catalog, never invented: each one is a field
 * that came from the brief's source article. Order matters — the first three
 * are what the on-screen captions show, so unverifiable fields are skipped
 * rather than printed.
 */
export function specLines(m: CatalogModel): string[] {
  const lines: string[] = [];
  if (stated(m.mesin, m.tenaga)) lines.push(`${m.mesin} · ${m.tenaga}`);
  if (stated(m.torsi, m.layout)) lines.push(`Torsi ${m.torsi} · ${m.layout}`);
  else if (stated(m.layout)) lines.push(m.layout);
  if (stated(m.nol100, m.vmax)) lines.push(`0–100 km/jam ${m.nol100} · top speed ${m.vmax}`);
  else if (stated(m.nol100)) lines.push(`0–100 km/jam ${m.nol100}`);
  else if (stated(m.vmax)) lines.push(`Top speed ${m.vmax}`);
  if (stated(m.berat, m.tahun)) lines.push(`Berat ${m.berat} · produksi ${m.tahun}`);
  else if (stated(m.berat)) lines.push(`Berat ${m.berat}`);
  else lines.push(`Produksi ${m.tahun}`);
  if (m.deskripsi) lines.push(m.deskripsi);
  return lines;
}

export function detailBrief(m: CatalogModel): { tagline: string; keunggulan: string[] } {
  return { tagline: m.tagline, keunggulan: specLines(m) };
}
