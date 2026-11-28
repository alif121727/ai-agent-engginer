import fs from 'node:fs';
import { measureMotion } from '../pipeline/motion-score.ts';
import { spawnSync } from 'node:child_process';
import { ffprobe } from '../render/ffmpeg.ts';
import path from 'node:path';
import type { VisualAdapter, GenerateRequest, GenerateResult } from './types.ts';
import { fileFor, userAssetsFor, validateAssetFile, withRetry, downloadToFile } from './types.ts';
import { publishMedia } from './media-sign.ts';
import type { VisualAdapterDef } from '../core/config.ts';
import { paths } from '../core/fsx.ts';
import { i2vPrompt } from '../pipeline/scenes.ts';

/**
 * Rotates the user's own photos across scenes. `referenceImage` is one of `own`
 * whenever image-to-video reuses a still; prepending it would add a duplicate
 * that shifts the rotation by one and makes consecutive scenes render the same
 * photo. Only a reference from outside `own` is added.
 */
export function localCandidateOrder(
  own: string[],
  referenceImage?: string,
): string[] {
  const ref = referenceImage && !own.includes(referenceImage) ? [referenceImage] : [];
  return [...ref, ...own];
}

/** Hanya unggahan pengguna: berkas inilah yang paling dipercaya. */
function localCandidates(req: GenerateRequest): string[] {
  const own = userAssetsFor(req.model, paths.uploads);
  return localCandidateOrder(own, req.referenceImage);
}

/** Foto contoh yang ikut di image. Statis, jadi selalu dicoba paling akhir. */
function bundledCandidates(req: GenerateRequest): string[] {
  return userAssetsFor(req.model, path.join(paths.assets, 'own'));
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
      const isVideo = ['.mp4', '.mov', '.webm'].includes(ext);
      const out = fileFor(req.outDir, req.scene.index, isVideo ? (ext === '.webm' ? 'webm' : 'mp4') : ext.replace('.', '') || 'jpg');
      fs.copyFileSync(chosen, out);
      return { path: out, kind: isVideo ? 'video' : 'image', provider: 'local', source: chosen, cost: 0 };
    },
  };
}

/**
 * Foto contoh bawaan untuk sebuah model. Sebelum ini adapter `local` ikut
 * menyajikan foto bawaan, sehingga selalu menang atas klip video dan semua
 * video keluar sebagai foto yang digerakkan. Sekarang foto bawaan punya
 * adapter sendiri yang ditaruh setelah sumber klip.
 */
export function catalogAdapter(def: VisualAdapterDef): VisualAdapter {
  return {
    id: def.id,
    def,
    available: (req?: GenerateRequest) => !req || bundledCandidates(req).length > 0,
    async generate(req: GenerateRequest): Promise<GenerateResult> {
      const candidates = bundledCandidates(req);
      if (!candidates.length) throw new Error('tidak ada foto contoh untuk model ini');
      const chosen = candidates[req.scene.index % candidates.length];
      const ext = path.extname(chosen).toLowerCase();
      const out = fileFor(req.outDir, req.scene.index, ext.replace('.', '') || 'jpg');
      fs.copyFileSync(chosen, out);
      return { path: out, kind: 'image', provider: 'katalog', source: chosen, cost: 0 };
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
 * Seedance 2.0 accepts 4-15s per clip, so a scene longer than 15s is requested
 * at the ceiling and the caller trims the excess. A value below 4 is a hard 400.
 */
export function seedanceDurationForTest(wanted: number): number {
  return seedanceDuration(wanted);
}

function seedanceDuration(wanted: number): number {
  const rounded = Math.round(wanted);
  return Math.min(15, Math.max(4, rounded));
}

/**
 * The public Seedance API only reads media from public HTTPS URLs; base64 and
 * `asset://` are rejected. The repo keeps stills on local disk behind a login,
 * so image-to-video needs a signed URL the vendor can fetch. Without a usable
 * URL the adapter falls back to text-to-video instead of sending one the vendor
 * would reject, which would fail the scene after the credits were reserved.
 */
function publicMediaUrl(file: string, jobId: string | undefined): string | undefined {
  if (!jobId) return undefined;
  try {
    return publishMedia(jobId, file);
  } catch {
    return undefined;
  }
}

/**
 * Seedance bills the key owner's personal balance, so a missing key must fail
 * loudly here instead of silently spending nothing and returning a fake asset.
 */
export function seedanceVideoAdapter(def: VisualAdapterDef): VisualAdapter {
  const apiKey = def.envKey ? process.env[def.envKey] : undefined;
  const base = (def.apiBase ?? 'https://www.seedance2ai.io/api/v1').replace(/\/$/, '');
  return {
    id: def.id,
    def,
    available: () => Boolean(def.enabled && apiKey),
    async generate(req: GenerateRequest): Promise<GenerateResult> {
      if (!apiKey) throw new Error('kunci Seedance belum diisi');
      const headers = { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` };
      const imageUrl = req.referenceImage ? publicMediaUrl(req.referenceImage, req.jobId) : undefined;
      const body: Record<string, unknown> = {
        mode: imageUrl ? 'image-to-video' : 'text-to-video',
        quality_tier: process.env.SEEDANCE_QUALITY ?? 'standard',
        prompt: i2vPrompt(req.scene),
        aspect_ratio: req.aspect,
        duration: String(seedanceDuration(req.scene.duration)),
        resolution: process.env.SEEDANCE_RESOLUTION ?? '1080p',
        // Assembly strips clip audio and lays its own engine/music track on top,
        // so a generated soundtrack would only cost credits and be discarded.
        generate_audio: false,
      };
      if (imageUrl) body.image_url = imageUrl;

      const created = await fetch(`${base}/video/seedance2`, {
        method: 'POST',
        headers: { ...headers, 'idempotency-key': `${req.jobId ?? 'job'}-scene-${req.scene.index + 1}` },
        body: JSON.stringify(body),
      });
      const createdJson = (await created.json().catch(() => ({}))) as {
        id?: string;
        error?: { code?: string; message?: string };
      };
      if (!created.ok) {
        const code = createdJson.error?.code;
        const detail = createdJson.error?.message ?? `HTTP ${created.status}`;
        throw new Error(`Seedance ${code ?? created.status}: ${detail}`);
      }
      const taskId = createdJson.id;
      if (!taskId) throw new Error('Seedance tidak mengembalikan id tugas');

      const deadline = Date.now() + (def.timeoutMs ?? 600_000);
      let output: string | undefined;
      while (Date.now() < deadline) {
        await wait(5_000);
        const poll = await fetch(`${base}/tasks/${taskId}`, { headers });
        const json = (await poll.json().catch(() => ({}))) as {
          status?: string;
          result_urls?: string[];
          output?: { video_url?: string };
          error?: string | null;
        };
        if (json.status === 'completed') {
          output = json.result_urls?.[0] ?? json.output?.video_url;
          break;
        }
        if (json.status === 'failed') {
          throw new Error(`Seedance gagal: ${json.error ?? 'tanpa alasan'}`);
        }
      }
      if (!output) throw new Error('Seedance tidak selesai sebelum batas waktu');

      const out = fileFor(req.outDir, req.scene.index, 'mp4');
      await downloadToFile(output, out, 'video', def.minBytes ?? 100_000, def.timeoutMs ?? 600_000);
      return { path: out, kind: 'video', provider: def.id, source: `seedance:${def.model ?? 'seedance2'}`, cost: 0 };
    },
  };
}

/**
 * Balance is the difference between "key works" and "render will work":
 * reporting only key presence promised renders the vendor then refused with 402.
 */
export async function seedanceCredits(): Promise<number | null> {
  const key = process.env.SEEDANCE_API_KEY;
  if (!key) return null;
  try {
    const base = (process.env.SEEDANCE_API_BASE ?? 'https://www.seedance2ai.io/api/v1').replace(/\/$/, '');
    const res = await fetch(`${base}/balance`, {
      headers: { authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { credits?: number };
    return typeof json.credits === 'number' ? json.credits : null;
  } catch {
    return null;
  }
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

/**
 * Pexels: klip jalanan NYATA (bukan foto yang digerakkan). Ini satu-satunya
 * sumber gratis yang memberi mobil benar-benar melaju di jalan.
 *
 * Nama model hampir selalu tidak punya klip ("Toyota GR Supra" -> 0 hasil),
 * jadi pencarian model hanya percobaan pertama dan selalu ada cadangan
 * generik. Tanpa cadangan, adapter ini "berhasil" tapi mengembalikan nol
 * video, lalu pipeline jatuh ke foto diam.
 */
const STOK_QUERY_CADANGAN = [
  'car driving highway cinematic',
  'sports car driving road',
  'car overtaking highway',
  'car driving city night',
];

function stokQueries(model: string): string[] {
  const bersih = (model ?? '').replace(/\s+/g, ' ').trim();
  return bersih ? [`${bersih} driving`, ...STOK_QUERY_CADANGAN] : [...STOK_QUERY_CADANGAN];
}

interface PexelsVideoFile {
  link: string;
  width: number;
  height: number;
  quality?: string;
  file_type?: string;
}

interface PexelsVideo {
  id: number;
  duration: number;
  user?: { name?: string };
  video_files?: PexelsVideoFile[];
}

/**
 * Berkas terbaik yang tidak membuat unduhan membengkak (1080p, mp4).
 * Batas bawah 1280x720 wajib: QA menolak scene di bawah 720p, dan Pexels
 * sering menyertakan berkas 480p untuk klip yang sama.
 */
function fileTerbaik(v: PexelsVideo): PexelsVideoFile | undefined {
  const mp4 = (v.video_files ?? []).filter((f) => (f.file_type ?? '').includes('mp4'));
  const layak = mp4.filter((f) => f.width >= 1280 && f.height >= 720);
  const pas = layak.filter((f) => f.width <= 1920);
  return pas.sort((a, b) => b.width - a.width)[0] ?? layak.sort((a, b) => b.width - a.width)[0];
}

export function stockAdapter(def: VisualAdapterDef): VisualAdapter {
  const apiKey = def.envKey ? process.env[def.envKey] : undefined;
  /** Klip yang sudah dipakai per job, supaya scene berurutan tidak kembar. */
  const dipakai = new Map<string, Set<number>>();
  return {
    id: def.id,
    def,
    available: () => Boolean(def.enabled && apiKey),
    async generate(req: GenerateRequest): Promise<GenerateResult> {
      if (!apiKey) throw new Error('stock API belum dikonfigurasi');
      const butuhDetik = Math.max(3, Math.ceil(req.scene.duration));
      const orientasi = req.aspect === '9:16' ? 'portrait' : 'landscape';
      const sudah = dipakai.get(req.outDir) ?? new Set<number>();
      dipakai.set(req.outDir, sudah);
      let gagal = '';
      for (const query of stokQueries(req.model)) {
        const url =
          'https://api.pexels.com/videos/search?query=' +
          encodeURIComponent(query) +
          `&per_page=15&orientation=${orientasi}&size=medium`;
        const res = await fetch(url, { headers: { authorization: apiKey } });
        if (res.status === 401 || res.status === 403) {
          throw new Error('kunci API Pexels ditolak (401/403) — periksa STOCK_API_KEY');
        }
        if (!res.ok) {
          gagal = `HTTP ${res.status}`;
          continue;
        }
        const json = (await res.json()) as { videos?: PexelsVideo[] };
        const kandidat = (json.videos ?? []).filter(
          (v) => v.duration >= butuhDetik && !sudah.has(v.id) && Boolean(fileTerbaik(v)),
        );
        if (!kandidat.length) {
          gagal = `"${query}" tidak punya klip >= ${butuhDetik} dtk`;
          continue;
        }
        const pilih = kandidat[req.scene.index % kandidat.length];
        const file = fileTerbaik(pilih)!;
        const clip = await fetch(file.link);
        if (!clip.ok) {
          gagal = `unduh klip HTTP ${clip.status}`;
          continue;
        }
        const out = fileFor(req.outDir, req.scene.index, 'mp4');
        fs.writeFileSync(out, Buffer.from(await clip.arrayBuffer()));
        sudah.add(pilih.id);
        return {
          path: out,
          kind: 'video',
          provider: 'pexels',
          source: 'stock-api',
          credit: pilih.user?.name,
          cost: 0,
        };
      }
      throw new Error(`stock API tidak menemukan klip jalanan (${gagal || 'hasil kosong'})`);
    },
  };
}

/**
 * Wikimedia Commons: sumber klip NYATA yang tidak butuh akun sama sekali.
 * Dipakai sebagai jaring terakhir sebelum pipeline jatuh ke foto diam.
 *
 * Berkas aslinya bisa 100 MB–2 GB, jadi yang diunduh adalah versi transkode
 * 1080p/480p dari `videoinfo.derivatives`, bukan `url` aslinya.
 * Lisensi: CC BY / CC BY-SA — nama pembuat dan lisensi WAJIB ikut di `credit`.
 */
/** Wikimedia memblokir (429) permintaan tanpa UA yang memuat kontak. */
const WIKI_UA = 'ai-agent-engginer/1.0 (https://github.com/alif121727/ai-agent-engginer)';

// Urutan ini sengaja dibuat beragam: QA menolak scene yang tampak sama dengan
// scene sebelumnya, dan tiga klip "road traffic" bisa berasal dari jalan yang
// sama. Tiap scene mulai mencari dari kata kunci yang berbeda.
const WIKI_QUERY = [
  'rally car driving',
  'rally car',
  'cars driving at night',
  'cars in traffic',
  'street traffic',
  'motorway traffic',
  'highway aerial',
  'city traffic night',
];

/** Judul yang jelas bukan mobil melaju (komedi, kejar-kejaran, dsb.). */
const WIKI_TOLAK =
  /bumper|autoscooter|police|deputy|sheriff|trooper|patrol|bodycam|felon|apprehend|maneuver|dashcam stop|crash|accident|collision|chase|flee|arrest|thief|dui|k-9|protest|demonstrat|toy|lego|animation|logo|test drive|repair|parking|court|news|report|prank|comedy|fail|earth from orbit|wikipedia|trump|outage|closure|pothole|signal|display|uglycar|campaign/i;

/** Judul harus benar-benar tentang mobil yang melaju, bukan sekadar "car". */
const WIKI_MIN_SKOR = 2;

/** Judul yang menyebut berkendara di jalan lebih dulu daripada yang sekadar "car". */
function skorJudul(judul: string): number {
  const t = judul.toLowerCase();
  let skor = 0;
  // Klip reli/balap menampilkan mobil yang benar-benar melaju kencang, jadi
  // diberi prioritas tertinggi untuk video otomotif.
  if (/rally|rali|racing|race|circuit|hill ?climb/.test(t)) skor += 4;
  if (/driving|drive|drives/.test(t)) skor += 3;
  if (/highway|motorway|freeway|road|street/.test(t)) skor += 2;
  if (/car|auto|vehicle/.test(t)) skor += 1;
  if (/night|rain|sunset|aerial|pov|dashcam/.test(t)) skor += 1;
  return skor;
}

interface WikiDerivative {
  src?: string;
  width?: number;
  height?: number;
  transcodekey?: string;
}

interface WikiPage {
  title?: string;
  videoinfo?: {
    url?: string;
    mime?: string;
    duration?: number;
    derivatives?: WikiDerivative[];
    extmetadata?: Record<string, { value?: string }>;
  }[];
}

function bersihkanHtml(teks: string): string {
  return teks.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
}

function transkodeTerbaik(v: NonNullable<WikiPage['videoinfo']>[number]): WikiDerivative | undefined {
  const der = (v.derivatives ?? []).filter((d) => (d.width ?? 0) >= 1280 && (d.height ?? 0) >= 720);
  const ambil = (kunci: string) => der.find((d) => (d.transcodekey ?? '').startsWith(kunci));
  // QA menolak scene di bawah 720p, jadi varian 480p/360p tidak ditawarkan.
  // Klip panjang dipangkas ke 720p supaya unduhan tidak puluhan MB.
  const panjang = (v.duration ?? 0) > 20;
  return panjang
    ? ambil('720p') ?? ambil('1080p')
    : ambil('1080p') ?? ambil('720p');
}

/** Nama seri = judul tanpa angka, supaya 6 klip dari satu syuting dikenali. */
function seriKlip(judul: string): string {
  return judul.replace(/\d+/g, '').replace(/[^a-z ]/gi, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
}

export function wikimediaAdapter(def: VisualAdapterDef): VisualAdapter {
  return {
    id: def.id,
    def,
    available: () => Boolean(def.enabled),
    async generate(req: GenerateRequest): Promise<GenerateResult> {
      const butuhDetik = Math.max(3, Math.ceil(req.scene.duration));
      const kandidat = await kolamWikimedia(butuhDetik);
      if (!kandidat.length) throw new Error('Wikimedia tidak punya klip jalanan yang cocok');
      // Scene dijalankan di proses terpisah, jadi penanda "sudah dipakai" di
      // memori tidak berlaku. Klaim dilakukan lewat berkas di folder aset:
      // hanya satu scene yang boleh memakai satu klip.
      const klaimDir = path.join(req.outDir, '.klaim');
      fs.mkdirSync(klaimDir, { recursive: true });
      const klaimPath = (judul: string) =>
        path.join(klaimDir, judul.replace(/[^a-z0-9]+/gi, '_').slice(0, 120));
      const klaim = (judul: string): boolean => {
        try {
          fs.writeFileSync(klaimPath(judul), String(process.pid), { flag: 'wx' });
          return true;
        } catch {
          return false;
        }
      };
      const lepas = (judul: string) => fs.rmSync(klaimPath(judul), { force: true });
      let gagal = '';
      for (let n = 0; n < kandidat.length; n++) {
        const pilih = kandidat[(req.scene.index * 1 + n) % kandidat.length];
        if (!klaim(pilih.judul)) continue;
        const v = pilih.v!;
        const kode = transkodeTerbaik(v)!;
        const klip = await fetch(kode.src!, { headers: { 'user-agent': WIKI_UA } });
        if (!klip.ok) {
          lepas(pilih.judul);
          gagal = `unduh klip HTTP ${klip.status}`;
          continue;
        }
        const ext = (kode.src!.match(/\.(webm|ogv|mp4|mov)$/i)?.[1] ?? 'webm').toLowerCase();
        const out = fileFor(req.outDir, req.scene.index, ext);
        fs.writeFileSync(out, Buffer.from(await klip.arrayBuffer()));
        // Klip "jalan lengang" bisa lolos resolusi tapi praktis beku; QA
        // menolaknya, jadi saring sekarang dan coba kandidat berikutnya.
        const gerak = measureMotion(out, 0).score;
        if (gerak < 0.2) {
          fs.rmSync(out, { force: true });
          lepas(pilih.judul);
          gagal = `klip ${pilih.judul.replace(/^File:/, '').slice(0, 30)} nyaris beku (gerak ${gerak})`;
          continue;
        }
        const penulis = bersihkanHtml(v.extmetadata?.Artist?.value ?? 'tanpa nama');
        const lisensi = bersihkanHtml(v.extmetadata?.LicenseShortName?.value ?? 'CC');
        return {
          path: out,
          kind: 'video',
          provider: 'wikimedia',
          source: 'stock-api',
          credit: `${penulis} — ${lisensi} (Wikimedia Commons: ${pilih.judul.replace(/^File:/, '')})`,
          cost: 0,
        };
      }
      throw new Error(`Wikimedia gagal mengunduh klip (${gagal || 'hasil kosong'})`);
    },
  };
}

interface KandidatWiki {
  judul: string;
  v?: NonNullable<WikiPage['videoinfo']>[number];
}

async function kolamWikimedia(butuhDetik: number): Promise<KandidatWiki[]> {
  const hasil: KandidatWiki[] = [];
  const terlihat = new Set<string>();
  for (const q of WIKI_QUERY) {
    const url =
      'https://commons.wikimedia.org/w/api.php?action=query&format=json&generator=search' +
      `&gsrsearch=${encodeURIComponent(`filetype:video ${q}`)}` +
      '&gsrnamespace=6&gsrlimit=20&prop=videoinfo&viprop=url|size|mime|derivatives|extmetadata';
    const res = await fetch(url, { headers: { 'user-agent': WIKI_UA } });
    if (!res.ok) continue;
    const json = (await res.json()) as { query?: { pages?: Record<string, WikiPage> } };
    const halaman = Object.values(json.query?.pages ?? {});
    for (const p of halaman) {
      const judul = p.title ?? '';
      const v = p.videoinfo?.[0];
      if (!v || !/^video\//.test(v.mime ?? '')) continue;
      if (terlihat.has(judul) || WIKI_TOLAK.test(judul)) continue;
      if (skorJudul(judul) < WIKI_MIN_SKOR) continue;
      const dur = v.duration ?? 0;
      if (dur < butuhDetik || dur > 240) continue;
      if (!transkodeTerbaik(v)?.src) continue;
      terlihat.add(judul);
      hasil.push({ judul, v });
    }
  }
  const urut = hasil.sort((a, b) => skorJudul(b.judul) - skorJudul(a.judul));
  // Sebar per seri (round-robin) supaya scene berurutan tidak memakai jalan
  // yang sama; QA menolak scene yang tampak mirip dengan scene sebelumnya.
  const perSeri = new Map<string, KandidatWiki[]>();
  for (const c of urut) {
    const k = seriKlip(c.judul);
    const arr = perSeri.get(k) ?? [];
    arr.push(c);
    perSeri.set(k, arr);
  }
  const sebar: KandidatWiki[] = [];
  for (let lanjut = true; lanjut; ) {
    lanjut = false;
    for (const arr of perSeri.values()) {
      const c = arr.shift();
      if (c) {
        sebar.push(c);
        lanjut = true;
      }
    }
  }
  return sebar;
}

/**
 * Pixabay: klip stok nyata dengan kunci API gratis (tanpa kartu kredit),
 * kualitasnya sebanding Pexels. Dipakai sebagai sumber kedua supaya pengguna
 * punya pilihan: cukup salah satu kunci yang diisi.
 */
export function pixabayAdapter(def: VisualAdapterDef): VisualAdapter {
  const apiKey = def.envKey ? process.env[def.envKey] : undefined;
  const dipakai = new Map<string, Set<number>>();
  return {
    id: def.id,
    def,
    available: () => Boolean(def.enabled && apiKey),
    async generate(req: GenerateRequest): Promise<GenerateResult> {
      if (!apiKey) throw new Error('kunci Pixabay belum diisi');
      const butuhDetik = Math.max(3, Math.ceil(req.scene.duration));
      const orientasi = req.aspect === '9:16' ? 'vertical' : 'horizontal';
      const sudah = dipakai.get(req.outDir) ?? new Set<number>();
      dipakai.set(req.outDir, sudah);
      let gagal = '';
      for (const q of stokQueries(req.model)) {
        const url =
          'https://pixabay.com/api/videos/?key=' +
          encodeURIComponent(apiKey) +
          `&q=${encodeURIComponent(q)}&per_page=20&video_type=film&orientation=${orientasi}&safesearch=true`;
        const res = await fetch(url);
        if (res.status === 400 || res.status === 401) {
          throw new Error('kunci API Pixabay ditolak — periksa PIXABAY_API_KEY');
        }
        if (!res.ok) {
          gagal = `HTTP ${res.status}`;
          continue;
        }
        const json = (await res.json()) as {
          hits?: {
            id: number;
            duration: number;
            user?: string;
            videos?: Record<string, { url: string; width: number; height: number }>;
          }[];
        };
        const kandidat = (json.hits ?? []).filter((h) => h.duration >= butuhDetik && !sudah.has(h.id));
        if (!kandidat.length) {
          gagal = `"${q}" tidak punya klip >= ${butuhDetik} dtk`;
          continue;
        }
        const pilih = kandidat[req.scene.index % kandidat.length];
        // Ambil varian terdekat ke 1920 px: klip 4K memperlambat decode dan
        // menghabiskan memori tanpa menambah kualitas akhir (keluaran 1080p).
        const varian = ['large', 'medium', 'small', 'tiny']
          .map((k) => pilih.videos?.[k])
          .filter((v): v is { url: string; width: number; height: number } => Boolean(v?.url))
          .sort((a, b) => Math.abs(a.width - 1920) - Math.abs(b.width - 1920));
        const berkas = varian[0];
        if (!berkas?.url) {
          gagal = `klip ${pilih.id} tanpa berkas mp4`;
          continue;
        }
        const klip = await fetch(berkas.url);
        if (!klip.ok) {
          gagal = `unduh klip HTTP ${klip.status}`;
          continue;
        }
        const out = fileFor(req.outDir, req.scene.index, 'mp4');
        fs.writeFileSync(out, Buffer.from(await klip.arrayBuffer()));
        sudah.add(pilih.id);
        return {
          path: out,
          kind: 'video',
          provider: 'pixabay',
          source: 'stock-api',
          credit: pilih.user ? `${pilih.user} (Pixabay)` : 'Pixabay',
          cost: 0,
        };
      }
      throw new Error(`Pixabay tidak menemukan klip (${gagal || 'hasil kosong'})`);
    },
  };
}
