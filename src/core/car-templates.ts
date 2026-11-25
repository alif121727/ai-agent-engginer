// Baca Car Template System (cartpl) dari templates/cars/ untuk studio.
// Python tetap satu-satunya sumber kebenaran untuk validasi & render; modul
// ini hanya membaca JSON supaya UI bisa menampilkan katalog template.
import fs from 'node:fs';
import path from 'node:path';
import { paths } from './fsx.ts';

export type CarTemplate = {
  name: string;
  displayName: string;
  description: string;
  tags: string[];
  abstract: boolean;
  extends?: string;
  dimensions: {
    lengthM: number;
    widthM: number;
    heightM: number;
    wheelbaseM: number;
    rideHeightM: number;
  };
  wheels: { rimDiameterIn: number; spokes: number };
  wing: string;
  livery: string;
  preview: string;
  variants: string[];
};

const CARS_DIR = path.join(paths.root, 'templates', 'cars');
const VARIANTS_DIR = path.join(paths.root, 'variants');

function readJson(file: string): any | null {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function readAll(dir: string): { file: string; data: any }[] {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => ({ file: path.join(dir, f), data: readJson(path.join(dir, f)) }))
    .filter((e) => e.data !== null);
}

function variantsFor(name: string): string[] {
  return readAll(VARIANTS_DIR)
    .filter((e) => e.data?.variant_of === name)
    .map((e) => String(e.data?.meta?.name ?? path.basename(e.file, '.json')));
}

/** Semua template konkret (mengikuti rantai `extends` untuk field yang kosong). */
export function listCarTemplates(): CarTemplate[] {
  const all = new Map<string, any>();
  for (const e of readAll(CARS_DIR)) {
    const name = e.data?.meta?.name;
    if (typeof name === 'string') all.set(name, e.data);
  }

  const resolve = (name: string, depth = 0): any => {
    const own = all.get(name);
    if (!own || depth > 8) return own ?? {};
    const parent = own.meta?.extends ? resolve(own.meta.extends, depth + 1) : {};
    const merged: any = { ...parent, ...own };
    for (const key of ['dimensions', 'wheels', 'wing', 'geometry', 'colors']) {
      merged[key] = { ...(parent[key] ?? {}), ...(own[key] ?? {}) };
    }
    return merged;
  };

  return [...all.keys()]
    .map((name) => resolve(name))
    .filter((spec) => spec?.meta && spec.meta.abstract !== true)
    .map((spec) => {
      const d = spec.dimensions ?? {};
      const length = Number(d.overhang_front ?? 0) + Number(d.wheelbase ?? 0) + Number(d.overhang_rear ?? 0);
      const rim = Number(spec.wheels?.rim_diameter_m ?? 0);
      return {
        name: String(spec.meta.name),
        displayName: String(spec.meta.display_name ?? spec.meta.name),
        description: String(spec.meta.description ?? ''),
        tags: Array.isArray(spec.meta.tags) ? spec.meta.tags.map(String) : [],
        abstract: false,
        extends: spec.meta.extends ? String(spec.meta.extends) : undefined,
        dimensions: {
          lengthM: Number(length.toFixed(3)),
          widthM: Number((Number(d.body_width_max ?? 0) * 2).toFixed(3)),
          heightM: Number(Number(d.body_height ?? 0).toFixed(3)),
          wheelbaseM: Number(Number(d.wheelbase ?? 0).toFixed(3)),
          rideHeightM: Number(Number(d.ride_height ?? 0).toFixed(3)),
        },
        wheels: { rimDiameterIn: Number((rim / 0.0254).toFixed(1)), spokes: Number(spec.wheels?.spokes ?? 0) },
        wing: String(spec.wing?.type ?? 'none'),
        livery: String(spec.livery?.style ?? 'none'),
        preview: `${spec.meta.name}.png`,
        variants: variantsFor(String(spec.meta.name)),
      } satisfies CarTemplate;
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}
