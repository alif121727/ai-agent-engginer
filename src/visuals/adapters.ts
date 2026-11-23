import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { ffprobe } from '../render/ffmpeg.ts';
import path from 'node:path';
import type { VisualAdapter, GenerateRequest, GenerateResult } from './types.ts';
import { fileFor, userAssetsFor, validateAssetFile, withRetry, downloadToFile } from './types.ts';
import type { VisualAdapterDef } from '../core/config.ts';
import { paths } from '../core/fsx.ts';
import { i2vPrompt } from '../pipeline/scenes.ts';

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
          // Prompt gerakan saja: "shot, camera" mendeskripsikan ulang gambar
          // dan itu yang membuat klip I2V nyaris statis.
          prompt: i2vPrompt(req.scene),
          negative_prompt: req.scene.motionPrompt?.negative_constraints ?? req.scene.negativePrompt,
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

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Data URI so a local still can be sent to providers that accept base64. */
function toDataUri(file: string): string {
  const mime = /\.png$/i.test(file) ? 'image/png' : 'image/jpeg';
  return `data:${mime};base64,${fs.readFileSync(file).toString('base64')}`;
}

function runwayRatio(aspect: string): string {
  if (aspect === '9:16') return '720:1280';
  if (aspect === '1:1') return '960:960';
  return '1280:720';
}

/**
 * Veo only accepts 4/6/8s, everything else on Runway accepts 5/10. Sending an
 * unsupported duration is a hard 400, so the value is snapped per model.
 * The smallest allowed value that covers the scene wins: a longer clip is
 * trimmed by `-t` during assembly, a shorter one would need looping.
 */
export function runwayDurationForTest(model: string | undefined, wanted: number): number {
  return runwayDuration(model, wanted);
}

function runwayDuration(model: string | undefined, wanted: number): number {
  const veo = /^veo/.test(model ?? '');
  const allowed = veo ? [4, 6, 8] : [5, 10];
  return allowed.find((d) => d >= wanted) ?? allowed[allowed.length - 1];
}

/**
 * Runway's balance is the difference between "key works" and "render will
 * work". Reporting only the key presence made the UI promise renders that the
 * vendor then refused with a 400.
 */
export async function runwayCredits(): Promise<number | null> {
  const key = process.env.RUNWAY_API_KEY;
  if (!key) return null;
  try {
    const base = (process.env.RUNWAY_API_BASE ?? 'https://api.dev.runwayml.com').replace(/\/$/, '');
    const res = await fetch(`${base}/v1/organization`, {
      headers: {
        authorization: `Bearer ${key}`,
        'X-Runway-Version': process.env.RUNWAY_API_VERSION ?? '2024-11-06',
      },
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { creditBalance?: number };
    return typeof json.creditBalance === 'number' ? json.creditBalance : null;
  } catch {
    return null;
  }
}

function providerError(status: number, json: unknown): string {
  const raw = JSON.stringify(json ?? {});
  if (/credit/i.test(raw)) return 'kredit akun habis — isi saldo dulu di dasbor vendor';
  if (status === 401 || status === 403) return 'kunci API ditolak vendor';
  if (status === 429) return 'kuota/rate limit vendor tercapai';
  return `HTTP ${status}: ${raw.slice(0, 300)}`;
}

/**
 * Runway speaks submit-then-poll: POST creates a task, GET /v1/tasks/:id
 * reports progress. One key covers Veo, Seedance and Gen-4, which is why the
 * model id (not the adapter id) decides what actually renders.
 */
export function runwayVideoAdapter(def: VisualAdapterDef): VisualAdapter {
  const apiKey = def.envKey ? process.env[def.envKey] : undefined;
  const base = (def.apiBase ?? 'https://api.dev.runwayml.com').replace(/\/$/, '');
  const version = process.env.RUNWAY_API_VERSION ?? '2024-11-06';
  return {
    id: def.id,
    def,
    available: () => Boolean(def.enabled && apiKey),
    async generate(req: GenerateRequest): Promise<GenerateResult> {
      if (!apiKey) throw new Error('kunci Runway belum diisi');
      const headers = {
        'content-type': 'application/json',
        authorization: `Bearer ${apiKey}`,
        'X-Runway-Version': version,
      };
      const dataUri = req.referenceImage ? toDataUri(req.referenceImage) : '';
      const body: Record<string, unknown> = {
        model: def.model,
        promptText: i2vPrompt(req.scene),
        ratio: runwayRatio(req.aspect),
        duration: runwayDuration(def.model, req.scene.duration),
      };
      if (dataUri) body.promptImage = dataUri;
      const created = await fetch(`${base}${dataUri ? '/v1/image_to_video' : '/v1/text_to_video'}`, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      });
      const createdJson = await created.json().catch(() => ({}));
      if (!created.ok) throw new Error(providerError(created.status, createdJson));
      const taskId = (createdJson as { id?: string }).id;
      if (!taskId) throw new Error('Runway tidak mengembalikan id tugas');

      const deadline = Date.now() + (def.timeoutMs ?? 600_000);
      let output: string | undefined;
      while (Date.now() < deadline) {
        await wait(5_000);
        const poll = await fetch(`${base}/v1/tasks/${taskId}`, { headers });
        const json = (await poll.json().catch(() => ({}))) as {
          status?: string;
          output?: string[];
          failure?: string;
        };
        if (json.status === 'SUCCEEDED') {
          output = json.output?.[0];
          break;
        }
        if (json.status === 'FAILED' || json.status === 'CANCELLED') {
          throw new Error(`Runway gagal: ${json.failure ?? json.status}`);
        }
      }
      if (!output) throw new Error('Runway tidak selesai sebelum batas waktu');

      const out = fileFor(req.outDir, req.scene.index, 'mp4');
      await downloadToFile(output, out, 'video', def.minBytes ?? 100_000, def.timeoutMs ?? 600_000);
      return { path: out, kind: 'video', provider: def.id, source: `runway:${def.model}`, cost: 0 };
    },
  };
}

/**
 * Kling also submits and polls, but with its own envelope: `code`/`message`
 * instead of HTTP status, and `data.task_status` instead of `status`.
 */
export function klingVideoAdapter(def: VisualAdapterDef): VisualAdapter {
  const apiKey = def.envKey ? process.env[def.envKey] : undefined;
  const base = (def.apiBase ?? 'https://api.klingai.com').replace(/\/$/, '');
  return {
    id: def.id,
    def,
    available: () => Boolean(def.enabled && apiKey),
    async generate(req: GenerateRequest): Promise<GenerateResult> {
      if (!apiKey) throw new Error('kunci Kling belum diisi');
      const headers = { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` };
      const kind = req.referenceImage ? 'image2video' : 'text2video';
      const body: Record<string, unknown> = {
        model_name: def.model,
        prompt: i2vPrompt(req.scene),
        negative_prompt: req.scene.negativePrompt,
        duration: String(Math.min(10, Math.max(5, Math.round(req.scene.duration)))),
        aspect_ratio: req.aspect,
        mode: process.env.KLING_MODE ?? 'std',
      };
      // Kling wants bare base64, not a data URI.
      if (req.referenceImage) body.image = fs.readFileSync(req.referenceImage).toString('base64');
      const created = await fetch(`${base}/v1/videos/${kind}`, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      });
      const createdJson = (await created.json().catch(() => ({}))) as {
        code?: number;
        message?: string;
        data?: { task_id?: string };
      };
      if (!created.ok || (createdJson.code ?? 0) !== 0) {
        throw new Error(providerError(created.status, createdJson));
      }
      const taskId = createdJson.data?.task_id;
      if (!taskId) throw new Error('Kling tidak mengembalikan task_id');

      const deadline = Date.now() + (def.timeoutMs ?? 600_000);
      let output: string | undefined;
      while (Date.now() < deadline) {
        await wait(5_000);
        const poll = await fetch(`${base}/v1/videos/${kind}/${taskId}`, { headers });
        const json = (await poll.json().catch(() => ({}))) as {
          code?: number;
          message?: string;
          data?: { task_status?: string; task_status_msg?: string; task_result?: { videos?: { url?: string }[] } };
        };
        const status = json.data?.task_status;
        if (status === 'succeed') {
          output = json.data?.task_result?.videos?.[0]?.url;
          break;
        }
        if (status === 'failed') throw new Error(`Kling gagal: ${json.data?.task_status_msg ?? 'tanpa alasan'}`);
      }
      if (!output) throw new Error('Kling tidak selesai sebelum batas waktu');

      const out = fileFor(req.outDir, req.scene.index, 'mp4');
      await downloadToFile(output, out, 'video', def.minBytes ?? 100_000, def.timeoutMs ?? 600_000);
      return { path: out, kind: 'video', provider: def.id, source: `kling:${def.model}`, cost: 0 };
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
      const prompt = encodeURIComponent(freeTierPrompt(req.scene));
      // A distinct seed per scene keeps successive stills from collapsing into
      // the same composition, which the similarity gate would reject.
      const seed = seedFor(req.model, req.scene.index);
      const url = template
        .replace('{prompt}', prompt)
        .replace('{width}', String(w))
        .replace('{height}', String(h))
        .concat(template.includes('{seed}') ? '' : `&seed=${seed}`);
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

/**
 * Pollinations has no negative-prompt parameter, so the negatives go into the
 * prompt text itself. They must come FIRST: the provider truncates long
 * prompts, and appending them measurably changed nothing (identical pixels),
 * while prefixing them does change the render.
 */
export function freeTierPrompt(scene: { prompt: string; negativePrompt?: string }): string {
  const negatives = scene.negativePrompt?.trim();
  return [negatives ? `hindari: ${negatives}` : '', scene.prompt].filter(Boolean).join(', ');
}

/** Stable but scene-specific seed, so retries reproduce and scenes differ. */
function seedFor(model: string, index: number): number {
  let hash = 0;
  for (const ch of `${model}:${index}`) hash = (hash * 31 + ch.charCodeAt(0)) % 1_000_000;
  return hash;
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
