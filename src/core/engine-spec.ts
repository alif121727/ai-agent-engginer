/**
 * Membaca karakter mesin dari satu baris katalog ("V8 4.0L twin-turbo
 * flat-plane (M178 LS2)"). Dipakai dua tempat yang harus sepakat:
 * sintesis suara (src/render/audio.ts) dan pembuat prompt SFX
 * (src/core/prompts.ts). Kalau keduanya menebak sendiri-sendiri, prompt bisa
 * menyebut "V6" untuk mobil yang suaranya disintesis sebagai V8.
 */

export type Aspiration = 'na' | 'turbo' | 'twin-turbo' | 'supercharged' | 'electric';

export interface EngineSpec {
  /** V8, V10, V12, I4, I6, flat-4, flat-6, rotary, electric. */
  layout: string;
  /** 0 untuk mobil listrik murni. */
  cylinders: number;
  /** Ledakan per putaran poros engkol; menentukan frekuensi dasar knalpot. */
  firingPerRev: number;
  aspiration: Aspiration;
  /** Ada paksaan udara (turbo/kompresor). */
  forced: boolean;
  rotary: boolean;
  electric: boolean;
  redline: number;
  idle: number;
}

const FIRING: Record<string, number> = {
  // V8 cross-plane berdenyut 4 kali/putaran; flat-plane 8 impuls setengah
  // orde, itulah sebabnya keduanya terdengar sangat berbeda.
  V8: 4,
  V10: 5,
  V12: 6,
  V6: 3,
  I6: 3,
  'flat-6': 3,
  I4: 2,
  'flat-4': 2,
  rotary: 3,
  electric: 0,
};

const WORD_NUM: Record<string, number> = { two: 2, three: 3, four: 4, five: 5, six: 6, eight: 8, ten: 10, twelve: 12 };

function layoutOf(engine: string): { layout: string; cylinders: number } {
  const e = engine.toLowerCase();
  // Hibrida menyebut mesin bakarnya lebih dulu; hanya EV murni tanpa V/I/flat.
  const hasCombustion = /\bv\d|\bi\d\b|inline|flat-\d|rotary/.test(e);
  if (!hasCombustion && /electric|motor listrik|listrik/.test(e)) return { layout: 'electric', cylinders: 0 };

  const flat = e.match(/flat-(\d)/);
  if (flat) return { layout: `flat-${flat[1]}`, cylinders: Number(flat[1]) };

  const v = e.match(/^v(\d+)/) ?? e.match(/\bv(\d+)\b/);
  if (v) return { layout: `V${v[1]}`, cylinders: Number(v[1]) };

  const inline = e.match(/inline-?(two|three|four|five|six|eight|\d)/);
  if (inline) {
    const n = WORD_NUM[inline[1]] ?? Number(inline[1]);
    return { layout: `I${n}`, cylinders: n };
  }

  const i = e.match(/\bi(\d)\b/);
  if (i) return { layout: `I${i[1]}`, cylinders: Number(i[1]) };

  if (/rotary|13b|wankel/.test(e)) return { layout: 'rotary', cylinders: 2 };
  return { layout: 'I6', cylinders: 6 };
}

function aspirationOf(engine: string, electric: boolean): Aspiration {
  if (electric) return 'electric';
  const e = engine.toLowerCase();
  if (/supercharg|kompresor/.test(e)) return 'supercharged';
  if (/twin-?turbo|biturbo|twinturbo/.test(e)) return 'twin-turbo';
  if (/turbo/.test(e)) return 'turbo';
  return 'na';
}

function redlineOf(input: { engine: string; tenaga: string; kategori: string; layout: string }): number {
  const text = `${input.engine} ${input.tenaga}`.toLowerCase();
  if (input.layout === 'electric') return 16000;
  if (/rotary|13b/.test(text)) return 8000;
  if (/gt3|gt4|balap/.test(text) && input.kategori === 'balap') return 8500;
  if (input.layout === 'V12') return 8000;
  if (input.layout === 'V10') return 8500;
  if (input.layout === 'flat-6') return 8200;
  if (input.layout === 'I4') return 7500;
  if (input.kategori === 'klasik') return 6200;
  if (input.kategori === 'balap') return 8000;
  return 7000;
}

export function parseEngine(input: {
  mesin: string;
  tenaga?: string;
  kategori?: string;
}): EngineSpec {
  const engine = input.mesin ?? '';
  const kategori = input.kategori ?? '';
  const { layout, cylinders } = layoutOf(engine);
  const electric = layout === 'electric';
  const aspiration = aspirationOf(engine, electric);
  const rotary = layout === 'rotary';

  return {
    layout,
    cylinders,
    firingPerRev: FIRING[layout] ?? Math.max(2, Math.round(cylinders / 2)),
    aspiration,
    forced: aspiration === 'turbo' || aspiration === 'twin-turbo' || aspiration === 'supercharged',
    rotary,
    electric,
    redline: redlineOf({ engine, tenaga: input.tenaga ?? '', kategori, layout }),
    idle: electric ? 0 : kategori === 'balap' ? 1100 : 850,
  };
}
