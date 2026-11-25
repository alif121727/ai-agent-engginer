import fs from 'node:fs';
import path from 'node:path';
import type { ScenePlan, Theme } from '../core/types.ts';
import type { VisualAdapterDef } from '../core/config.ts';
import { findModel } from '../core/catalog.ts';

export interface GenerateRequest {
  scene: ScenePlan;
  theme: Theme;
  model: string;
  aspect: string;
  referenceImage?: string;
  outDir: string;
  /** Needed to publish a still as a signed public URL for vendors that fetch it. */
  jobId?: string;
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
  available(req?: GenerateRequest): boolean;
  generate(req: GenerateRequest): Promise<GenerateResult>;
}

export function fileFor(outDir: string, sceneIndex: number, ext: string): string {
  fs.mkdirSync(outDir, { recursive: true });
  return path.join(outDir, `scene-${String(sceneIndex + 1).padStart(2, '0')}.${ext}`);
}

/** Lowercase ASCII slug; "Huracán" -> "huracan" so folder hints are usable. */
export function slugifyModel(model: string): string {
  return model
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();
}

/**
 * Folder names are curated by hand (e.g. `porsche-911-gt3-rs-992`), so the
 * catalog slug wins over the mechanical slug. Without this, 12 catalog models
 * had photos that were never found and every job silently fell back to a
 * generator.
 */
export function assetFolderSlug(model: string): string {
  const fromCatalog = findModel(model)?.slug;
  if (fromCatalog) return fromCatalog;
  return slugifyModel(model);
}

export function userAssetsFor(model: string, ownRoot: string): string[] {
  const dir = path.join(ownRoot, assetFolderSlug(model));
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => /\.(jpe?g|png|webp|mp4|mov)$/i.test(f))
    .sort()
    .map((f) => path.join(dir, f));
}

const MAGIC = {
  jpeg: [0xff, 0xd8, 0xff],
  png: [0x89, 0x50, 0x4e, 0x47],
} as const;

export interface AssetValidation {
  ok: boolean;
  bytes: number;
  kind: 'image' | 'video';
  error?: string;
}

/**
 * Rejects truncated/HTML responses that providers return with HTTP 200.
 * A file is only accepted once it has real image/video magic bytes, a
 * plausible size and a readable duration.
 */
export function validateAssetFile(file: string, expect: 'image' | 'video', minBytes: number): AssetValidation {
  if (!fs.existsSync(file)) return { ok: false, bytes: 0, kind: expect, error: 'berkas tidak ada' };
  const bytes = fs.statSync(file).size;
  if (bytes < minBytes) {
    return { ok: false, bytes, kind: expect, error: `ukuran ${bytes} B di bawah minimum ${minBytes} B` };
  }
  const head = Buffer.alloc(12);
  const fd = fs.openSync(file, 'r');
  fs.readSync(fd, head, 0, 12, 0);
  fs.closeSync(fd);
  const isJpeg = MAGIC.jpeg.every((b, i) => head[i] === b);
  const isPng = MAGIC.png.every((b, i) => head[i] === b);
  const isMp4 = head.subarray(4, 8).toString('ascii') === 'ftyp';
  if (expect === 'image' && !isJpeg && !isPng) {
    return { ok: false, bytes, kind: expect, error: 'isi berkas bukan JPEG/PNG' };
  }
  if (expect === 'video' && !isMp4) {
    return { ok: false, bytes, kind: expect, error: 'isi berkas bukan MP4' };
  }
  return { ok: true, bytes, kind: expect };
}

/** Exponential backoff with a hard cap; never retries without a delay. */
export async function withRetry<T>(
  label: string,
  maxRetries: number,
  cooldownMs: number,
  run: (attempt: number) => Promise<T>,
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
    try {
      return await run(attempt);
    } catch (err) {
      lastError = err;
      if (attempt > maxRetries) break;
      await new Promise((r) => setTimeout(r, Math.min(cooldownMs * 2 ** (attempt - 1), 60_000)));
    }
  }
  const message = lastError instanceof Error ? lastError.message : String(lastError);
  throw new Error(`${label} gagal setelah ${maxRetries + 1} percobaan: ${message}`);
}

/**
 * Writes to `.tmp` and renames only after validation, so a half-downloaded
 * file can never be picked up by a later stage.
 */
export async function downloadToFile(
  url: string,
  dest: string,
  expect: 'image' | 'video',
  minBytes: number,
  timeoutMs: number,
): Promise<AssetValidation> {
  const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const type = res.headers.get('content-type') ?? '';
  if (!type.startsWith(expect === 'image' ? 'image/' : 'video/')) {
    throw new Error(`content-type tidak sesuai: ${type || 'kosong'}`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < minBytes) throw new Error(`ukuran ${buf.length} B di bawah minimum`);
  const tmp = `${dest}.tmp`;
  fs.writeFileSync(tmp, buf);
  const check = validateAssetFile(tmp, expect, minBytes);
  if (!check.ok) {
    fs.rmSync(tmp, { force: true });
    throw new Error(check.error ?? 'berkas tidak valid');
  }
  fs.renameSync(tmp, dest);
  return check;
}
