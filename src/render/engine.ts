import type { CatalogModel } from '../core/catalog.ts';
import { findModel } from '../core/catalog.ts';
import { parseEngine } from '../core/engine-spec.ts';

/**
 * Engine sound is derived from the catalog, not from a sample library: the repo
 * ships no audio at all, so every video used to get the same synthetic music
 * bed and no engine note whatsoever.
 *
 * The character of a real engine follows from a few hard facts — cylinder
 * count, firing order, aspiration, redline — and all of those are in the
 * catalog's `mesin` field. Deriving the sound from it keeps the audio tied to
 * the car the user picked, and avoids inventing a spec.
 */
export interface EngineProfile {
  /** Cylinders, 0 for electric. */
  cylinders: number;
  layout: string;
  /** Firing events per crank revolution: 4 for a cross-plane V8, 3 for a V6. */
  firingPerRev: number;
  aspiration: 'na' | 'turbo' | 'supercharged' | 'electric';
  redline: number;
  /** Idle and limiter, in rpm. */
  idle: number;
  /** 0..1 — how much exhaust rasp sits on top of the fundamental. */
  rasp: number;
  /** 0..1 — turbo whistle / supercharger whine level. */
  whine: number;
  /** 0..1 — overall timbre brightness. */
  brightness: number;
  label: string;
}

const DEFAULT: EngineProfile = {
  cylinders: 6,
  layout: 'I6',
  firingPerRev: 3,
  aspiration: 'na',
  redline: 7000,
  idle: 850,
  rasp: 0.35,
  whine: 0.1,
  brightness: 0.5,
  label: 'I6 3.0L naturally aspirated',
};

/** Per-model overrides where the catalog text alone would mislead. */
const OVERRIDES: Record<string, Partial<EngineProfile>> = {
  'porsche-taycan-turbo-s': { aspiration: 'electric', cylinders: 0, firingPerRev: 0, redline: 16000, idle: 0, whine: 0.85, rasp: 0, brightness: 0.85 },
  'honda-nsx-2016': { whine: 0.5, brightness: 0.65 },
  'ferrari-296-gtb': { whine: 0.45, brightness: 0.7 },
  'mazda-rx7-fd': { rasp: 0.6, brightness: 0.7, firingPerRev: 3 },
  'lamborghini-countach-lp400': { rasp: 0.55, brightness: 0.75 },
  'ford-mustang-1967-fastback': { rasp: 0.7, brightness: 0.3, redline: 6000 },
  'mercedes-300sl-gullwing': { rasp: 0.25, brightness: 0.35, redline: 5800 },
  'toyota-ae86': { rasp: 0.45, brightness: 0.6, redline: 7800 },
  'bmw-e30-m3': { rasp: 0.45, brightness: 0.6, redline: 7200 },
  'subaru-impreza-22b': { rasp: 0.55, brightness: 0.45 },
  'nissan-skyline-r34-gtr': { whine: 0.4, rasp: 0.4, redline: 8000 },
  'nissan-r34-gtr-z-tune': { whine: 0.45, rasp: 0.45 },
  'nissan-gt-r-nismo': { whine: 0.4, rasp: 0.4 },
  'toyota-gr-supra': { whine: 0.3, rasp: 0.3 },
  'toyota-gr-supra-gt4': { whine: 0.35, rasp: 0.55, brightness: 0.6 },
  'bmw-m4-gt3': { whine: 0.35, rasp: 0.55, brightness: 0.6 },
  'porsche-911-gt3-rs-992': { rasp: 0.5, brightness: 0.7, redline: 9000 },
  'chevrolet-corvette-c8-z06': { rasp: 0.5, brightness: 0.65, redline: 8600 },
  'lamborghini-huracan-sto': { rasp: 0.5, brightness: 0.8, redline: 8500 },
  'lamborghini-huracan-evo': { rasp: 0.45, brightness: 0.78, redline: 8000 },
  'audi-r8-v10-performance': { rasp: 0.45, brightness: 0.75, redline: 8500 },
  'ferrari-f40': { whine: 0.55, rasp: 0.5, brightness: 0.6 },
  'mclaren-765lt': { whine: 0.45, rasp: 0.45, brightness: 0.62 },
  'mclaren-720s': { whine: 0.4, rasp: 0.4, brightness: 0.6 },
  'ferrari-488-pista': { whine: 0.4, rasp: 0.45, brightness: 0.65 },
  'ford-gt-2017': { whine: 0.5, rasp: 0.4, brightness: 0.55 },
  'mercedes-amg-gt-black-series': { whine: 0.35, rasp: 0.55, brightness: 0.55 },
  'porsche-911-turbo-s-992': { whine: 0.3, rasp: 0.35, brightness: 0.55 },
  'bmw-m4-competition-g82': { whine: 0.3, rasp: 0.4, brightness: 0.5 },
  'datsun-240z': { rasp: 0.4, brightness: 0.5, redline: 6500 },
  'porsche-911-carrera-rs-27': { rasp: 0.45, brightness: 0.55, redline: 7000 },
  'lancia-stratos-hf': { rasp: 0.5, brightness: 0.65, redline: 7500 },
  'jaguar-e-type': { rasp: 0.3, brightness: 0.45, redline: 6000 },
};

/**
 * Deteksi tata letak/aspirasi/redline ada di src/core/engine-spec.ts karena
 * pembuat prompt SFX juga memakainya. Kalau keduanya menebak sendiri-sendiri,
 * prompt bisa menyebut V6 untuk mobil yang suaranya disintesis sebagai V8.
 */
function profileFromSpec(model: CatalogModel): EngineProfile {
  const spec = parseEngine({ mesin: model.mesin, tenaga: model.tenaga, kategori: model.kategori });
  const base: EngineProfile = {
    cylinders: spec.cylinders,
    layout: spec.layout,
    firingPerRev: spec.firingPerRev,
    aspiration: spec.aspiration === 'twin-turbo' ? 'turbo' : spec.aspiration,
    redline: spec.redline,
    idle: spec.idle,
    rasp: spec.aspiration === 'na' ? 0.5 : 0.35,
    whine: spec.aspiration === 'turbo' || spec.aspiration === 'twin-turbo' ? 0.35 : spec.aspiration === 'supercharged' ? 0.45 : 0.08,
    brightness: spec.layout === 'V12' || spec.layout === 'V10' ? 0.75 : spec.layout === 'V8' ? 0.55 : 0.5,
    label: model.mesin,
  };
  return { ...base, ...(OVERRIDES[model.slug] ?? {}) };
}

/** Builds the sound profile for a model name, or a generic one if unknown. */
export function engineProfileFor(modelName: string): EngineProfile {
  const model = findModel(modelName);
  if (!model) return { ...DEFAULT, label: modelName || 'mesin generik' };
  return profileFromSpec(model);
}

/** Human-readable one-liner used in job artifacts and the UI. */
export function describeProfile(p: EngineProfile): string {
  if (p.aspiration === 'electric') return `motor listrik · hingga ${p.redline} rpm ekuivalen`;
  return `${p.layout} · ${p.cylinders} silinder · ${p.aspiration} · redline ${p.redline} rpm`;
}
