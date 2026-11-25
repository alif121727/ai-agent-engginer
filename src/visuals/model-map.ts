import type { VisualAdapterDef } from '../core/config.ts';

/**
 * Model video yang bisa dipilih di UI, dipetakan ke adapter backend yang
 * benar-benar memanggil vendor. Id di sini harus sama dengan
 * `studio/src/data/models.ts`; kalau tidak, pilihan pengguna tidak berpengaruh.
 */
export type VideoModelRoute = {
  /** Adapter yang dipakai; `local` berarti pipeline foto + ffmpeg repo ini. */
  adapterId: string;
  /** Id model di sisi vendor. Kosong untuk render lokal. */
  vendorModel?: string;
};

export const VIDEO_MODEL_ROUTES: Record<string, VideoModelRoute> = {
  'local-render': { adapterId: 'local' },
  'veo-3.1': { adapterId: 'runway', vendorModel: 'veo3.1' },
  'seedance-2.0': { adapterId: 'seedance', vendorModel: 'seedance2' },
  'runway-gen4': { adapterId: 'runway', vendorModel: 'gen4.5' },
  'kling-3.0': { adapterId: 'kling', vendorModel: 'kling-v3' },
};

export function routeForModel(modelId?: string): VideoModelRoute | null {
  if (!modelId) return null;
  return VIDEO_MODEL_ROUTES[modelId] ?? null;
}

/** Model ini menghasilkan klip video, bukan foto diam. */
export function wantsVideoClip(modelId?: string): boolean {
  const route = routeForModel(modelId);
  return Boolean(route && route.adapterId !== 'local');
}

/**
 * Applies the chosen vendor model onto the adapter definition at call time.
 * The config holds one adapter per vendor, so the model id has to travel with
 * the request instead of being baked into `config/visuals.json`.
 */
export function withVendorModel(def: VisualAdapterDef, route: VideoModelRoute): VisualAdapterDef {
  if (!route.vendorModel) return def;
  return { ...def, model: route.vendorModel };
}
