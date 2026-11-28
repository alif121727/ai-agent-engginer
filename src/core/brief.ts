import { z } from 'zod';
import type { Brief } from '../core/types.ts';

export const BriefSchema = z.object({
  model: z.string().min(1, 'model wajib diisi'),
  tagline: z.string().optional(),
  durasi: z.number().positive().optional(),
  rasio: z.enum(['16:9', '9:16', '1:1']).optional(),
  keunggulan: z.array(z.string()).optional(),
  gaya: z.string().optional(),
  referensi: z.array(z.string()).optional(),
  jadwalPublish: z.string().optional(),
  deadlineMenit: z.number().positive().optional(),
  /** Template yang dipilih pengguna; menentukan resep scene. */
  templateId: z.string().optional(),
  /**
   * Model video yang dipilih di UI (mis. `veo-3.1`). Menentukan apakah tahap
   * visual meminta klip video atau masih memakai foto.
   */
  modelId: z.string().optional(),
  /**
   * Nada suara narasi. Boleh kosong: kalau tidak diisi, nada dipilih otomatis
   * dari jenis mobil supaya pengguna tidak perlu memikirkan istilah teknis.
   */
  suaraTone: z.enum(['energik', 'sinematik', 'hangat', 'tegas']).optional(),
  /** Penjelasan sebagai teks saja (bawaan) atau dibacakan sebagai narasi. */
  narasiSuara: z.boolean().optional(),
  /** Tema buatan AI yang dipilih pengguna, disimpan apa adanya di brief. */
  temaAi: z
    .object({
      id: z.string(),
      palette: z.object({ primary: z.string(), secondary: z.string(), accent: z.string() }),
      mood: z.string(),
      grade: z.object({ contrast: z.number(), saturation: z.number(), temperature: z.number() }),
      cameraLanguage: z.string(),
      lighting: z.string(),
      descriptor: z.string(),
      keywords: z.array(z.string()).optional(),
    })
    .partial()
    .optional(),
});

export class BriefError extends Error {}

export interface ResolvedBrief {
  brief: Brief;
  durationSec: number;
  bumped: boolean;
  originalDuration: number | null;
}

/**
 * A brief shorter than the configured minimum is bumped to the minimum and
 * reported, never rendered shorter than allowed.
 */
export function resolveDuration(brief: Brief, minDurasi: number, maxDurasi: number): ResolvedBrief {
  const requested = typeof brief.durasi === 'number' ? brief.durasi : null;
  const base = requested ?? minDurasi;
  const clampedHigh = Math.min(base, maxDurasi);
  const durationSec = Math.max(minDurasi, Math.round(clampedHigh));
  return {
    brief: { ...brief, durasi: durationSec },
    durationSec,
    bumped: requested !== null && requested < minDurasi,
    originalDuration: requested,
  };
}

export function parseBrief(raw: string): Brief {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    data = parseMarkdownBrief(raw);
  }
  const parsed = BriefSchema.safeParse(data);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.') || 'brief'}: ${i.message}`);
    throw new BriefError(`Brief tidak valid — ${issues.join('; ')}`);
  }
  return parsed.data as Brief;
}

/** `key: value` lines, `keunggulan:` starts a bullet list. */
export function parseMarkdownBrief(raw: string): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const lines = raw.split(/\r?\n/);
  let listKey: string | null = null;
  for (const line of lines) {
    const bullet = line.match(/^\s*[-*]\s+(.*)$/);
    if (bullet && listKey) {
      (out[listKey] as string[]).push(bullet[1].trim());
      continue;
    }
    const kv = line.match(/^\s*([A-Za-z_][\w]*)\s*:\s*(.*)$/);
    if (!kv) continue;
    const [, key, value] = kv;
    const normalized = key.toLowerCase();
    if (value.trim() === '') {
      listKey = normalized;
      out[normalized] = [];
      continue;
    }
    listKey = null;
    if (normalized === 'durasi' || normalized === 'deadlinemenit') {
      const num = Number(value.replace(/[^\d.]/g, ''));
      out[normalized] = Number.isFinite(num) ? num : undefined;
    } else if (normalized === 'keunggulan' || normalized === 'referensi') {
      out[normalized] = value
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
    } else {
      out[normalized] = value.trim();
    }
  }
  if (Array.isArray(out.keunggulan) && (out.keunggulan as string[]).length === 0) delete out.keunggulan;
  return out;
}
