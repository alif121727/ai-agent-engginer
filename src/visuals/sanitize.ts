import path from 'node:path';
import { paths, readJson } from '../core/fsx.ts';

interface SanitizerConfig {
  brands: Record<string, string>;
  stripPatterns: string[];
  forbidden: string[];
}

let cached: SanitizerConfig | null = null;

export function loadSanitizer(): SanitizerConfig {
  if (cached) return cached;
  cached = readJson<SanitizerConfig>(path.join(paths.config, 'prompt-sanitizer.json'), {
    brands: {},
    stripPatterns: [],
    forbidden: [],
  });
  return cached;
}

/**
 * Image providers render brand names as garbled badges or wrong cars, so the
 * prompt carries a generic body description instead. Local assets are copied
 * byte-for-byte and never go through here.
 */
export function sanitizePrompt(prompt: string, model: string): string {
  const cfg = loadSanitizer();
  const key = model.toLowerCase();
  let out = prompt;

  const brandKeys = Object.keys(cfg.brands).sort((a, b) => b.length - a.length);
  const matched = brandKeys.filter((b) => key.includes(b));
  const descriptor = matched.length ? cfg.brands[matched[0]] : 'sports car';

  // Drop the raw model name wherever it appears, then drop leftover brand words.
  const escaped = model.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  out = out.replace(new RegExp(escaped, 'gi'), descriptor);
  for (const b of brandKeys) {
    out = out.replace(new RegExp(`\\b${b.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'gi'), descriptor);
  }
  for (const p of cfg.stripPatterns) {
    out = out.replace(new RegExp(p, 'g'), '');
  }
  for (const f of cfg.forbidden) {
    out = out.replace(new RegExp(`\\b${f}\\b`, 'gi'), '');
  }
  return out.replace(/\s{2,}/g, ' ').replace(/\s+,/g, ',').trim();
}

/** True when the text still contains any configured brand word. */
export function hasBrandLeak(text: string): string | null {
  const cfg = loadSanitizer();
  const lower = text.toLowerCase();
  for (const b of Object.keys(cfg.brands)) {
    if (lower.includes(b)) return b;
  }
  return null;
}
