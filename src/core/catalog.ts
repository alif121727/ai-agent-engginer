import path from 'node:path';
import { paths, readJson } from './fsx.ts';

export interface CatalogModel {
  slug: string;
  merk: string;
  model: string;
  seri: string;
  tahun: string;
  kategori: 'balap' | 'sport' | 'klasik' | 'modifikasi';
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

/**
 * Nicknames people actually type. The model name alone misses these: "r34"
 * never appears in "Nissan Skyline GT-R", so photo lookup silently failed and
 * the job fell back to a generator that invents a different car.
 */
const ALIASES: Record<string, string[]> = {
  'nissan-gt-r-nismo': ['r35', 'gt-r r35', 'gtr r35', 'godzilla'],
  'nissan-skyline-r34-gtr': ['r34', 'skyline r34', 'r34 gtr', 'bayside blue'],
  'nissan-r34-gtr-z-tune': ['z-tune', 'z tune', 'r34 z-tune', 'nismo z-tune'],
  'toyota-ae86': ['hachiroku', 'trueno', 'levin', 'corolla ae86'],
  'mazda-rx7-fd': ['rx7', 'rx 7', 'fd3s'],
  'subaru-impreza-22b': ['22b', 'impreza 22b', '22b sti'],
  'mercedes-300sl-gullwing': ['gullwing', '300 sl gullwing', 'w198'],
  'lamborghini-countach-lp400': ['countach', 'lp400'],
  'porsche-911-carrera-rs-27': ['carrera rs', 'rs 2.7', '911 rs'],
  'ford-mustang-1967-fastback': ['mustang 67', '1967 mustang', 'mustang fastback'],
  'honda-nsx-2016': ['nsx', 'nc1'],
  'bmw-e30-m3': ['e30', 'm3 e30'],
  // Ambiguous single words resolve to the road car people mean by default.
  'bmw-m4-competition-g82': ['m4', 'm4 competition'],
  'lamborghini-huracan-evo': ['huracan', 'huracán', 'huracan evo'],
  'toyota-gr-supra': ['supra', 'mk5', 'a90'],
  'porsche-911-gt3-rs-992': ['gt3', 'gt3 rs', '992'],
};

export interface ModelMatch {
  model: CatalogModel;
  /** 0..1; 1 means the query named the model exactly. */
  score: number;
  exact: boolean;
}

/** Below this a query is treated as a different car, not a typo. */
const MATCH_THRESHOLD = 0.7;

function tokensOf(s: string): string[] {
  return normalize(s).split(' ').filter(Boolean);
}

function scoreAgainst(query: string, qTokens: string[], qCompact: string, name: string, slug: string): number {
  const nTokens = tokensOf(name);
  const nCompact = nTokens.join('');
  if (!nCompact) return 0;

  if (qCompact === nCompact) return 1;
  if (qCompact === slug.replace(/-/g, '')) return 1;

  // Prefix ("Porsche 911 GT3" -> "Porsche 911 GT3 RS") beats a loose token hit,
  // but the more extra words it drags in, the weaker it gets.
  if (nCompact.startsWith(qCompact)) {
    return 0.95 - (0.15 * (nCompact.length - qCompact.length)) / Math.max(1, nCompact.length);
  }
  if (nCompact.includes(qCompact)) {
    return 0.8 - (0.1 * (nCompact.length - qCompact.length)) / Math.max(1, nCompact.length);
  }

  const matched = qTokens.filter((qt) => nTokens.some((nt) => nt === qt || nt.startsWith(qt) || qt.startsWith(nt)));
  if (!matched.length) return 0;

  // Extra model words are allowed (the user may say "Nissan GT-R" for the
  // Nismo), but each one costs a little so the closest name wins.
  const extra = Math.max(0, nTokens.length - qTokens.length);
  let score = 0.75 * (matched.length / qTokens.length) - 0.02 * extra;
  if (nTokens.slice(0, qTokens.length).join(' ') === qTokens.join(' ')) score += 0.12;
  return score;
}

function scoreModel(query: string, m: CatalogModel): number {
  const qTokens = tokensOf(query);
  const qCompact = qTokens.join('');
  if (!qCompact) return 0;
  const names = [m.model, m.seri, m.slug.replace(/-/g, ' '), ...(ALIASES[m.slug] ?? [])];
  return names.reduce((best, name) => Math.max(best, scoreAgainst(query, qTokens, qCompact, name, m.slug)), 0);
}

/** Ranked candidates so the UI can show what it recognised instead of guessing. */
export function searchModels(query: string, limit = 8): ModelMatch[] {
  const q = query.trim();
  if (!q) return [];
  return loadCatalog()
    .models.map((model) => {
      const score = scoreModel(q, model);
      return { model, score, exact: score >= 1 };
    })
    .filter((m) => m.score >= MATCH_THRESHOLD)
    .sort((a, b) => b.score - a.score || a.model.model.length - b.model.model.length)
    .slice(0, limit);
}

/**
 * A model the user typed may be a nickname ("r34", "gtr", "huracan"). Resolving
 * it to a catalog entry is what makes the right photos and the right engine
 * sound follow the choice; an unknown car must stay unresolved rather than
 * borrow another car's assets.
 */
export function findModel(name: string): CatalogModel | undefined {
  return searchModels(name, 1)[0]?.model;
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
