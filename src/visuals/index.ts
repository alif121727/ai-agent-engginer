import type { VisualAdapter, GenerateRequest, GenerateResult } from './types.ts';
import { localAdapter, imageGenAdapter, videoGenAdapter, stockAdapter, pollinationsAdapter } from './adapters.ts';
import type { VisualAdapterDef } from '../core/config.ts';

export function buildAdapter(def: VisualAdapterDef): VisualAdapter | null {
  switch (def.kind) {
    case 'local':
      return localAdapter(def);
    case 'image-gen':
      return def.requiresKey ? imageGenAdapter(def) : pollinationsAdapter(def);
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
 *
 * When `fallback` is supplied, an adapter that fails skips ahead to the
 * providers listed for it, so a broken paid provider never blocks a scene.
 */
export async function resolveSceneAsset(input: {
  order: string[];
  defs: Record<string, VisualAdapterDef>;
  request: GenerateRequest;
  fallback?: Record<string, string[]>;
}): Promise<ResolveOutcome> {
  const attempts: { adapter: string; error?: string }[] = [];
  const skipped = new Set<string>();

  const tryOne = async (id: string): Promise<GenerateResult | null> => {
    if (skipped.has(id)) return null;
    const def = input.defs[id];
    if (!def) {
      attempts.push({ adapter: id, error: 'adapter tidak dikenal' });
      return null;
    }
    if (!def.enabled) {
      attempts.push({ adapter: id, error: 'adapter dimatikan di config' });
      return null;
    }
    const adapter = buildAdapter(def);
    if (!adapter) {
      attempts.push({ adapter: id, error: `jenis adapter ${def.kind} tidak didukung` });
      return null;
    }
    if (!adapter.available(input.request)) {
      attempts.push({ adapter: id, error: 'belum dikonfigurasi' });
      return null;
    }
    try {
      return await adapter.generate(input.request);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      attempts.push({ adapter: id, error: message });
      const chain = input.fallback?.[id];
      if (chain?.length) for (const next of chain) skipped.add(next);
      return null;
    }
  };

  for (const id of input.order) {
    const result = await tryOne(id);
    if (result) return { result, attempts };
  }
  return { result: null, attempts };
}
