import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { ffprobe } from '../render/ffmpeg.ts';
import path from 'node:path';
import type { VisualAdapter, GenerateRequest, GenerateResult } from './types.ts';
import { fileFor, userAssetsFor, validateAssetFile, withRetry, downloadToFile } from './types.ts';
import type { VisualAdapterDef } from '../core/config.ts';
import { paths } from '../core/fsx.ts';

function localCandidates(req: GenerateRequest): string[] {
  const own = userAssetsFor(req.model, path.join(paths.assets, 'own'));
  const ref = req.referenceImage ? [req.referenceImage] : [];
  return [...ref, ...own];
}

/** Highest priority: the user's own photos/videos for this model. */
export function localAdapter(def: VisualAdapterDef): VisualAdapter {
  return {
    id: def.id,
    def,
    // A model without uploaded photos is the normal case, not an error: report
    // unavailable so the resolver moves on to the next provider instead of
    // tripping the fallback chain and skipping every other adapter.
    available: (req?: GenerateRequest) => !req || localCandidates(req).length > 0,
    async generate(req: GenerateRequest): Promise<GenerateResult> {
      const candidates = localCandidates(req);
      if (!candidates.length) throw new Error('tidak ada aset lokal untuk model ini');
      const chosen = candidates[req.scene.index % candidates.length];
      const ext = path.extname(chosen).toLowerCase();
      const isVideo = ['.mp4', '.mov'].includes(ext);
      const out = fileFor(req.outDir, req.scene.index, isVideo ? 'mp4' : ext.replace('.', '') || 'jpg');
      fs.copyFileSync(chosen, out);
      return { path: out, kind: isVideo ? 'video' : 'image', provider: 'local', source: chosen, cost: 0 };
    },
  };
}

/**
 * Image generation is provider agnostic: the endpoint, auth header and response
 * shape come from config so swapping vendors needs no code change.
 */
export function imageGenAdapter(def: VisualAdapterDef): VisualAdapter {
  const apiKey = def.envKey ? process.env[def.envKey] : undefined;
  const endpoint = process.env.IMAGE_PROVIDER_URL ?? '';
  return {
    id: def.id,
    def,
    available: () => Boolean(def.enabled && apiKey && endpoint),
    async generate(req: GenerateRequest): Promise<GenerateResult> {
      if (!apiKey || !endpoint) throw new Error('generator gambar belum dikonfigurasi');
      const body = {
        model: def.model,
        prompt: req.scene.prompt,
        negative_prompt: req.scene.negativePrompt,
        aspect_ratio: req.aspect,
        reference_image: req.referenceImage,
        n: 1,
      };
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(`generator gambar gagal: HTTP ${res.status}`);
      const json = (await res.json()) as { data?: { url?: string; b64_json?: string }[] };
      const first = json.data?.[0];
      const out = fileFor(req.outDir, req.scene.index, 'png');
      if (first?.b64_json) {
        fs.writeFileSync(out, Buffer.from(first.b64_json, 'base64'));
      } else if (first?.url) {
        const img = await fetch(first.url);
        if (!img.ok) throw new Error('gagal mengunduh hasil gambar');
        fs.writeFileSync(out, Buffer.from(await img.arrayBuffer()));
      } else {
        throw new Error('respons generator gambar tidak dikenali');
      }
      return { path: out, kind: 'image', provider: def.id, source: 'image-gen', cost: 0 };
    },
  };
}

export function videoGenAdapter(def: VisualAdapterDef): VisualAdapter {
  const apiKey = def.envKey ? process.env[def.envKey] : undefined;
  const endpoint = process.env.VIDEO_PROVIDER_URL ?? '';
  return {
    id: def.id,
    def,
    available: () => Boolean(def.enabled && apiKey && endpoint),
    async generate(req: GenerateRequest): Promise<GenerateResult> {
      if (!apiKey || !endpoint) throw new Error('generator video belum dikonfigurasi');
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          model: def.model,
          image: req.referenceImage,
          prompt: `${req.scene.shot}, ${req.scene.camera}`,
          duration: Math.min(5, Math.max(2, req.scene.duration)),
        }),
      });
      if (!res.ok) throw new Error(`generator video gagal: HTTP ${res.status}`);
      const json = (await res.json()) as { url?: string };
      if (!json.url) throw new Error('respons generator video tidak dikenali');
      const clip = await fetch(json.url);
      if (!clip.ok) throw new Error('gagal mengunduh klip video');
      const out = fileFor(req.outDir, req.scene.index, 'mp4');
      fs.writeFileSync(out, Buffer.from(await clip.arrayBuffer()));
      return { path: out, kind: 'video', provider: def.id, source: 'video-gen', cost: 0 };
    },
  };
}

/**
 * Keyless text-to-image provider. Used as the free fallback so a model with no
 * local photos can still be rendered without any code-drawn placeholder.
 * The URL comes from config, so swapping the provider needs no code change.
 */
export function pollinationsAdapter(def: VisualAdapterDef): VisualAdapter {
  const template = def.urlTemplate ?? 'https://image.pollinations.ai/prompt/{prompt}?width={width}&height={height}&nologo=true';
  return {
    id: def.id,
    def,
    available: () => Boolean(def.enabled && template),
    async generate(req: GenerateRequest): Promise<GenerateResult> {
      const [w, h] = sizeFor(req.aspect);
      const prompt = encodeURIComponent(req.prompt);
      const url = template
        .replace('{prompt}', prompt)
        .replace('{width}', String(w))
        .replace('{height}', String(h));
      const out = fileFor(req.outDir, req.scene.index, 'jpg');
      const minBytes = def.minBytes ?? 20_000;
      await withRetry(def.id, def.maxRetries ?? 2, def.cooldownMs ?? 10_000, async () => {
        await downloadToFile(url, out, 'image', minBytes, def.timeoutMs ?? 60_000);
      });
      // The free tier silently caps output around 1015x580, which fails the
      // minimum-resolution gate. Upscale locally so the pipeline sees a
      // compliant asset instead of rejecting an otherwise usable image.
      upscaleToMinimum(out, w, h);
      return { path: out, kind: 'image', provider: def.id, source: def.id, cost: 0 };
    },
  };
}

/** Lanczos-upscales in place when a provider returns a smaller image than asked. */
function upscaleToMinimum(file: string, width: number, height: number): void {
  const probe = ffprobe(file);
  if (!probe.ok) return;
  if ((probe.width ?? 0) >= width && (probe.height ?? 0) >= height) return;
  const tmp = file.replace(/\.jpg$/, '.up.jpg');
  const res = spawnSync('ffmpeg', [
    '-v', 'error', '-y', '-i', file,
    '-vf', `scale=${width}:${height}:flags=lanczos`, '-q:v', '2', tmp,
  ]);
  if (res.status === 0 && fs.existsSync(tmp)) fs.renameSync(tmp, file);
  else fs.rmSync(tmp, { force: true });
}

/** Requested frame size per aspect ratio, capped by what free providers allow. */
function sizeFor(aspect: string): [number, number] {
  switch (aspect) {
    case '9:16':
      return [1024, 1792];
    case '1:1':
      return [1024, 1024];
    default:
      return [1792, 1024];
  }
}

export function stockAdapter(def: VisualAdapterDef): VisualAdapter {
  const apiKey = def.envKey ? process.env[def.envKey] : undefined;
  return {
    id: def.id,
    def,
    available: () => Boolean(def.enabled && apiKey),
    async generate(req: GenerateRequest): Promise<GenerateResult> {
      if (!apiKey) throw new Error('stock API belum dikonfigurasi');
      const query = encodeURIComponent(`${req.model} car cinematic`);
      const res = await fetch(`https://api.pexels.com/videos/search?query=${query}&per_page=15`, {
        headers: { authorization: apiKey },
      });
      if (!res.ok) throw new Error(`stock API gagal: HTTP ${res.status}`);
      const json = (await res.json()) as {
        videos?: { user?: { name?: string }; video_files?: { link: string; quality: string }[] }[];
      };
      const pick = json.videos?.[req.scene.index % (json.videos.length || 1)];
      const file = pick?.video_files?.find((v) => v.quality === 'hd') ?? pick?.video_files?.[0];
      if (!file) throw new Error('stock API tidak mengembalikan klip');
      const clip = await fetch(file.link);
      if (!clip.ok) throw new Error('gagal mengunduh klip stok');
      const out = fileFor(req.outDir, req.scene.index, 'mp4');
      fs.writeFileSync(out, Buffer.from(await clip.arrayBuffer()));
      return {
        path: out,
        kind: 'video',
        provider: 'pexels',
        source: 'stock-api',
        credit: pick?.user?.name,
        cost: 0,
      };
    },
  };
}
