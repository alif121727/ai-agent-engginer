import type { VisualAdapter, GenerateRequest, GenerateResult } from './types.ts';
import { localAdapter, imageGenAdapter, videoGenAdapter, stockAdapter } from './adapters.ts';
import type { VisualAdapterDef } from '../core/config.ts';

export function buildAdapter(def: VisualAdapterDef): VisualAdapter | null {
  switch (def.kind) {
    case 'local':
      return localAdapter(def);
    case 'image-gen':
      return imageGenAdapter(def);
    case 'video-gen':
      return videoGenAdapter(def);
    case 'stock-api':
      return stockAdapter(def);
    default:
      return null;
  }
}

export interface ResolveOutcome {
  result: GenerateResult | null;
  attempts: { adapter: string; error?: string }[];
}

/**
 * Walks the configured priority order and returns the first usable asset.
 * There is deliberately no code-drawn fallback here: drawing a car with
 * polygons is banned, so a scene without a real asset stays missing.
 */
export async function resolveSceneAsset(input: {
  order: string[];
  defs: Record<string, VisualAdapterDef>;
  request: GenerateRequest;
}): Promise<ResolveOutcome> {
  const attempts: { adapter: string; error?: string }[] = [];
  for (const id of input.order) {
    const def = input.defs[id];
    if (!def) {
      attempts.push({ adapter: id, error: 'adapter tidak dikenal' });
      continue;
    }
    const adapter = buildAdapter(def);
    if (!adapter) {
      attempts.push({ adapter: id, error: `jenis adapter ${def.kind} tidak didukung` });
      continue;
    }
    if (!adapter.available()) {
      attempts.push({ adapter: id, error: 'belum dikonfigurasi' });
      continue;
    }
    try {
      const result = await adapter.generate(input.request);
      return { result, attempts };
    } catch (err) {
      attempts.push({ adapter: id, error: err instanceof Error ? err.message : String(err) });
    }
  }
  return { result: null, attempts };
}
