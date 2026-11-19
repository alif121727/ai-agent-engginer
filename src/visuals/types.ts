import fs from 'node:fs';
import path from 'node:path';
import type { ScenePlan, Theme } from '../core/types.ts';
import type { VisualAdapterDef } from '../core/config.ts';

export interface GenerateRequest {
  scene: ScenePlan;
  theme: Theme;
  model: string;
  aspect: string;
  referenceImage?: string;
  outDir: string;
}

export interface GenerateResult {
  path: string;
  kind: 'image' | 'video';
  provider: string;
  source: string;
  credit?: string;
  cost: number;
}

export interface VisualAdapter {
  id: string;
  def: VisualAdapterDef;
  available(): boolean;
  generate(req: GenerateRequest): Promise<GenerateResult>;
}

export function fileFor(outDir: string, sceneIndex: number, ext: string): string {
  fs.mkdirSync(outDir, { recursive: true });
  return path.join(outDir, `scene-${String(sceneIndex + 1).padStart(2, '0')}.${ext}`);
}

export function userAssetsFor(model: string, ownRoot: string): string[] {
  const dir = path.join(ownRoot, model.replace(/[^a-zA-Z0-9]+/g, '-').toLowerCase());
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => /\.(jpe?g|png|webp|mp4|mov)$/i.test(f))
    .map((f) => path.join(dir, f));
}
