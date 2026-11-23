import express, { type NextFunction, type Request, type Response } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { logger } from '../core/log.ts';
import { bus, currentConnection, recordEvent, wireBus } from '../core/bus.ts';
import { loadDefaults, loadAgents, loadAdapters, loadThemes } from '../core/config.ts';
import { parseBrief, resolveDuration, BriefError } from '../core/brief.ts';
import { pickTheme } from '../core/theme.ts';
import { generateAiTheme } from '../core/theme-ai.ts';
import { searchTemplates } from '../core/templates.ts';
import { resolveBriefLook } from '../core/brief-look.ts';
import { loadCatalog, aliasesFor } from '../core/catalog.ts';
import { planScenes, estimateCost } from '../pipeline/scenes.ts';
import { ffmpegAvailable } from '../render/ffmpeg.ts';
import { paths, slugify, jobDir } from '../core/fsx.ts';
import { assetFolderSlug } from '../visuals/types.ts';
import {
  createJob,
  createStages,
  getJob,
  listJobs,
  listStages,
  listEvents,
  resetStage,
  getSetting,
  setSetting,
  updateJob,
  dailyCost,
} from '../db/repo.ts';
import { stagesFor, listPresets } from '../agents/registry.ts';
import {
  authenticate,
  createSession,
  createUser,
  destroySession,
  purgeExpiredSessions,
  sessionUser,
  userCount,
  type User,
} from '../auth/auth.ts';
import { rateLimit } from '../auth/rate-limit.ts';
import { Worker } from '../worker/worker.ts';
import { loadCapability } from '../pipeline/llm.ts';
import { publishJob, listPublications } from '../publish/instagram.ts';
import { userAssetsFor } from '../visuals/types.ts';
import { clearCheckpoint } from '../pipeline/checkpoint.ts';
import { readArtifactFile } from '../agents/guard.ts';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: User;
    }
  }
}

const COOKIE = 'studio_session';
// Dua kuota terpisah: per akun supaya percobaan orang lain tidak mengunci
// akun Anda, dan per IP dengan plafon jauh lebih tinggi karena di balik proxy
// semua pengunjung berbagi satu alamat.
const loginLimiter = rateLimit(10, 60_000);
const ipLoginLimiter = rateLimit(60, 60_000);

export interface AppOptions {
  worker?: Worker;
  /** Disable the background monitor in tests. */
  startWorker?: boolean;
}

/**
 * Job 'done' hanya jujur kalau mp4-nya masih ada. Direktori job bisa hilang
 * (dibersihkan manual, volume baru), dan melaporkannya selesai membuat UI
 * menawarkan unduhan yang 404.
 */
function honestStatus<T extends { id: string; status: string }>(job: T): T {
  if (job.status !== 'done') return job;
  // path.join langsung, bukan jobDir(): jobDir() membuat direktori kosong
  // untuk job yatim dan itu justru menutupi masalahnya.
  const file = path.join(paths.jobs, job.id, 'video.mp4');
  if (fs.existsSync(file)) return job;
  return { ...job, status: 'failed' };
}

export function createApp(opts: AppOptions = {}) {
  wireBus();
  const app = express();
  app.disable('x-powered-by');
  /**
   * Header keamanan dasar. CSP sengaja mengizinkan `'unsafe-inline'` untuk gaya
   * karena React menulis style inline untuk progress bar; skrip tetap hanya dari
   * origin sendiri. `frame-ancestors 'none'` mencegah clickjacking pada panel
   * admin, dan HSTS hanya dikirim saat benar-benar di HTTPS.
   */
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'self'; img-src 'self' data: blob:; media-src 'self' blob:; " +
        "style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; " +
        "font-src 'self' data:; frame-ancestors 'none'; base-uri 'self'",
    );
    if (process.env.APP_URL?.startsWith('https') || process.env.SITE_URL?.startsWith('https')) {
      res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    }
    next();
  });
  /**
   * CORS untuk UI statis (Netlify/Pages) yang memakai backend ini lewat
   * `__STUDIO_API__`. Daftar origin eksplisit lewat env `CORS_ORIGINS`; tanpa
   * env ini tidak ada header CORS sama sekali, jadi sandbox tetap tertutup.
   * `Access-Control-Allow-Credentials` wajib karena sesi memakai cookie.
   */
  const corsOrigins = new Set(
    (process.env.CORS_ORIGINS ?? '')
      .split(',')
      .map((s) => s.trim().replace(/\/$/, ''))
      .filter(Boolean),
  );
  if (corsOrigins.size > 0) {
    app.use((req, res, next) => {
      const origin = (req.headers.origin ?? '').replace(/\/$/, '');
      if (origin && corsOrigins.has(origin)) {
        res.setHeader('Access-Control-Allow-Origin', origin);
        res.setHeader('Vary', 'Origin');
        res.setHeader('Access-Control-Allow-Credentials', 'true');
        res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,DELETE,OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
        res.setHeader('Access-Control-Max-Age', '600');
      }
      if (req.method === 'OPTIONS') {
        res.status(204).end();
        return;
      }
      next();
    });
  }
  app.use(express.json({ limit: '2mb' }));

  const worker = opts.worker;

  // ---- auth helpers ----
  // Cookie pihak ketiga diblokir Chrome/Safari secara default, jadi sesi
  // lintas situs (Netlify/Pages -> backend) memakai Bearer token. Cookie tetap
  // didukung untuk pemakaian satu origin.
  // Tag <video>/<img> tidak bisa mengirim header, jadi untuk GET token juga
  // diterima lewat ?token=. Hanya GET: POST/PATCH tetap wajib header.
  const bearerToken = (req: Request): string | undefined => {
    const h = req.headers.authorization ?? '';
    const m = /^Bearer\s+(.+)$/i.exec(h.trim());
    if (m?.[1]?.trim()) return m[1].trim();
    if (req.method === 'GET') {
      const q = typeof req.query?.token === 'string' ? req.query.token.trim() : '';
      if (q) return q;
    }
    return undefined;
  };

  const readUser = async (req: Request): Promise<User | null> => {
    const token = bearerToken(req) ?? parseCookies(req.headers.cookie ?? '')[COOKIE];
    return sessionUser(token);
  };

  const requireAuth = async (req: Request, res: Response, next: NextFunction) => {
    const user = await readUser(req);
    if (!user) {
      res.status(401).json({ error: 'perlu login' });
      return;
    }
    req.user = user;
    next();
  };

  // ---- public ----
  app.get('/api/health', (_req, res) => {
    res.json({
      ok: true,
      connection: currentConnection(),
      db: process.env.DB_KIND ?? 'sqlite',
      ffmpeg: ffmpegAvailable(),
    });
  });

  app.get('/api/bootstrap', async (_req, res) => {
    const count = await userCount();
    res.json({ needsSetup: count === 0 });
  });

  app.post('/api/setup', async (req, res) => {
    if ((await userCount()) > 0) {
      res.status(409).json({ error: 'setup sudah dilakukan' });
      return;
    }
    const parsed = z
      .object({
        email: z.string().email(),
        password: z.string().min(8),
        username: z.string().trim().min(3).max(32).optional(),
      })
      .safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'email/password tidak valid (password minimal 8 karakter)' });
      return;
    }
    try {
      const user = await createUser(parsed.data.email, parsed.data.password, 'admin', parsed.data.username);
      const token = await createSession(user.id);
      res.setHeader('Set-Cookie', cookieHeader(token));
      res.json({ user });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'gagal membuat akun' });
    }
  });

  app.post('/api/login', async (req, res) => {
    const ip = req.ip ?? 'unknown';
    if (!ipLoginLimiter.allow(ip)) {
      res.status(429).json({ error: 'terlalu banyak percobaan dari jaringan ini, coba lagi nanti' });
      return;
    }
    const parsed = z.object({ email: z.string(), password: z.string() }).safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'username/email dan password wajib' });
      return;
    }
    const account = parsed.data.email.trim().toLowerCase();
    if (!loginLimiter.allow(account)) {
      res.status(429).json({ error: 'terlalu banyak percobaan untuk akun ini, coba lagi nanti' });
      return;
    }
    const user = await authenticate(parsed.data.email, parsed.data.password);
    if (!user) {
      // Hanya percobaan gagal yang dihitung; login yang benar tidak boleh
      // mempercepat kunci akun sendiri.
      loginLimiter.fail(account);
      ipLoginLimiter.fail(ip);
      res.status(401).json({ error: 'username/email atau password salah' });
      return;
    }
    loginLimiter.clear(account);
    await purgeExpiredSessions();
    const token = await createSession(user.id);
    res.setHeader('Set-Cookie', cookieHeader(token));
    // Token juga dikirim di body: UI lintas situs menyimpannya dan memakainya
    // sebagai Bearer, karena cookie pihak ketiga diblokir peramban.
    res.json({ user, token });
  });

  app.post('/api/logout', async (req, res) => {
    const token = bearerToken(req) ?? parseCookies(req.headers.cookie ?? '')[COOKIE];
    if (token) await destroySession(token);
    res.setHeader('Set-Cookie', `${COOKIE}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax`);
    res.json({ ok: true });
  });

  app.get('/api/me', async (req, res) => {
    res.json({ user: await readUser(req) });
  });

  // ---- everything below needs a session ----
  app.use('/api', requireAuth);

  app.get('/api/config', async (_req, res) => {
    const defaults = loadDefaults();
    const themes = loadThemes();
    const agents = loadAgents();
    const adapters = loadAdapters();
    const minDurasi = await getSetting('minDurasi', defaults.minDurasi);
    const workTime = await getSetting('workTime', defaults.workTime);
    res.json({
      minDurasi,
      maxDurasi: defaults.maxDurasi,
      workTime,
      presets: listPresets(),
      agentPreset: await getSetting('agentPreset', defaults.agentPreset),
      themes: Object.values(themes.themes).map((t) => ({
        id: t.id,
        palette: t.palette,
        mood: t.mood,
        keywords: t.keywords,
      })),
      catalog: loadCatalog().models.map((m) => ({
        slug: m.slug,
        merk: m.merk,
        model: m.model,
        seri: m.seri,
        tahun: m.tahun,
        kategori: m.kategori,
        mesin: m.mesin,
        tenaga: m.tenaga,
        torsi: m.torsi,
        tagline: m.tagline,
        alias: aliasesFor(m.slug),
      })),
      adapters: Object.values(adapters.adapters).map((a) => ({
        id: a.id,
        label: a.label,
        kind: a.kind,
        enabled: a.enabled,
        configured: a.requiresKey ? Boolean(a.envKey && process.env[a.envKey]) : true,
      })),
      cost: { maxCostPerJob: defaults.cost.maxCostPerJob, maxCostPerHari: defaults.cost.maxCostPerHari },
      connection: defaults.connection,
      llm: loadCapability(),
      agents: Object.values(agents.agents).map((a) => ({
        id: a.id,
        name: a.name,
        short: a.short,
        role: a.role,
        kind: a.kind,
        allowedTools: a.allowedTools,
      })),
    });
  });

  /**
   * Pencarian template otomatis. Skor dan alasannya dikirim ke UI supaya
   * pengguna melihat kenapa sebuah template muncul di atas, bukan hanya daftar.
   */
  app.get('/api/templates', async (req, res) => {
    const q = typeof req.query.q === 'string' ? req.query.q : '';
    const kategori = typeof req.query.kategori === 'string' ? req.query.kategori : undefined;
    const aspect = typeof req.query.aspect === 'string' ? req.query.aspect : undefined;
    const nada = typeof req.query.nada === 'string' ? req.query.nada : undefined;
    const durasi = Number(req.query.durasi);
    const hits = searchTemplates({
      q,
      kategori,
      aspect,
      nada,
      durasi: Number.isFinite(durasi) && durasi > 0 ? durasi : undefined,
    });
    res.json({
      q,
      total: hits.length,
      hasil: hits.map((h) => ({
        ...h.template,
        score: h.score,
        alasan: h.alasan,
      })),
    });
  });

  /** Tema buatan AI untuk satu model katalog. */
  app.post('/api/tema-ai', async (req, res) => {
    const parsed = z
      .object({
        model: z.string().min(1),
        nada: z.enum(['sinematik', 'energik', 'edukatif', 'nostalgik']).optional(),
        gaya: z.string().optional(),
      })
      .safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'model wajib diisi' });
      return;
    }
    const entry = loadCatalog().models.find(
      (m) => m.slug === parsed.data.model || m.model.toLowerCase() === parsed.data.model.toLowerCase(),
    );
    const theme = generateAiTheme({
      model: entry?.model ?? parsed.data.model,
      merk: entry?.merk,
      kategori: entry?.kategori,
      mesin: entry?.mesin,
      tenaga: entry?.tenaga,
      tahun: entry?.tahun,
      tagline: entry?.tagline,
      nada: parsed.data.nada,
      gaya: parsed.data.gaya,
    });
    // Model di luar katalog tetap dapat tema, tapi UI perlu tahu bahwa
    // tidak ada data katalog yang dipakai (jadi tidak ada klaim spesifikasi).
    res.json({ theme, dariKatalog: Boolean(entry), katalogSlug: entry?.slug ?? null });
  });

  app.post('/api/estimate', async (req, res) => {
    const defaults = loadDefaults();
    const minDurasi = await getSetting('minDurasi', defaults.minDurasi);
    const parsed = z.object({ durasi: z.number().positive(), rasio: z.string().optional(), model: z.string().optional() }).safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'durasi wajib angka positif' });
      return;
    }
    const { durationSec, bumped } = resolveDuration(
      { model: parsed.data.model ?? 'mobil', durasi: parsed.data.durasi },
      minDurasi,
      defaults.maxDurasi,
    );
    const themes = loadThemes();
    const theme = pickTheme(parsed.data.model ?? 'mobil', themes.themes, themes.defaultTheme);
    const scenes = planScenes({
      brief: { model: parsed.data.model ?? 'mobil' },
      durationSec,
      theme,
      aspect: parsed.data.rasio ?? '16:9',
    });
    const adapters = loadAdapters();
    const withVideo = Object.values(adapters.adapters).some(
      (a) => a.kind === 'video-gen' && a.envKey && process.env[a.envKey],
    );
    const cost = estimateCost({
      durationSec,
      sceneCount: scenes.length,
      withVideo,
      estimates: defaults.cost.estimates,
    });
    res.json({
      durationSec,
      bumped,
      sceneCount: scenes.length,
      cost,
      minutes: Math.max(1, Math.round((scenes.length * 20 + durationSec) / 60)),
      themeId: theme.id,
    });
  });

  app.post('/api/jobs', async (req, res) => {
    const defaults = loadDefaults();
    const minDurasi = await getSetting('minDurasi', defaults.minDurasi);
    try {
      const rawBrief = req.body?.brief ?? req.body;
      const brief = typeof rawBrief === 'string' ? parseBrief(rawBrief) : parseBrief(JSON.stringify(rawBrief));
      const { durationSec, bumped } = resolveDuration(brief, minDurasi, defaults.maxDurasi);
      // Template dan tema AI disimpan KE DALAM brief, bukan hanya dipakai di
      // sini. Worker menjalankan tahapnya dari brief, jadi apa pun yang tidak
      // ikut tersimpan akan hilang saat job dikerjakan.
      const templateId = typeof req.body?.templateId === 'string' ? req.body.templateId : '';
      const temaAi = req.body?.theme && typeof req.body.theme === 'object' ? req.body.theme : undefined;
      const briefWithLook = { ...brief, templateId: templateId || undefined, temaAi };
      const look = resolveBriefLook(briefWithLook);
      const { theme, template, aspect } = look;
      const preset = String(req.body?.preset ?? (await getSetting('agentPreset', defaults.agentPreset)));
      const mode = req.body?.mode === 'final' ? 'final' : 'draft';
      const scenes = planScenes({
        brief: briefWithLook,
        durationSec,
        theme,
        aspect,
        sceneKeys: template?.sceneKeys,
      });
      const adapters = loadAdapters();
      const withVideo = Object.values(adapters.adapters).some(
        (a) => a.kind === 'video-gen' && a.envKey && process.env[a.envKey],
      );
      const costEstimate = estimateCost({
        durationSec,
        sceneCount: scenes.length,
        withVideo,
        estimates: defaults.cost.estimates,
      });

      const job = await createJob({
        briefSlug: slugify(brief.model),
        title: brief.model,
        model: brief.model,
        themeId: theme.id,
        mode,
        durationSec,
        aspect,
        preset,
        brief: { ...briefWithLook, durasi: durationSec },
        costEstimate,
        scheduledAt: brief.jadwalPublish ?? null,
      });
      await createStages(job.id, stagesFor(preset));
      await recordEvent({
        jobId: job.id,
        level: 'info',
        scope: 'api',
        message: `template diterima: ${brief.model}`,
        data: { durationSec, bumped, preset, mode },
      });
      if (bumped) {
        await recordEvent({
          jobId: job.id,
          level: 'warn',
          scope: 'api',
          message: `durasi dinaikkan ke minimum ${durationSec} detik`,
        });
      }
      res.status(201).json({ job, stages: await listStages(job.id) });
    } catch (err) {
      if (err instanceof BriefError) {
        res.status(400).json({ error: err.message });
        return;
      }
      logger('api').error('gagal membuat job', err);
      res.status(500).json({ error: err instanceof Error ? err.message : 'gagal membuat job' });
    }
  });

  app.get('/api/jobs', async (req, res) => {
    const limit = Math.min(200, Number(req.query.limit ?? 50));
    const jobs = await listJobs(limit);
    // UI menghitung progres dari status tahap, jadi sertakan tahap di sini;
    // tanpa ini semua proyek tampak "Draf 0%" walau worker sedang bekerja.
    // Job 'done' yang mp4-nya sudah tidak ada di disk dilaporkan gagal:
    // menghitungnya selesai membuat dashboard mengklaim video yang tidak bisa
    // dibuka.
    const withStages = await Promise.all(
      jobs.map(async (j) => ({
        ...honestStatus(j),
        stages: (await listStages(j.id)).map((s) => ({ name: s.name, status: s.status })),
      })),
    );
    res.json({ jobs: withStages });
  });

  app.get('/api/jobs/:id', async (req, res) => {
    const job = await getJob(req.params.id);
    if (!job) {
      res.status(404).json({ error: 'job tidak ditemukan' });
      return;
    }
    res.json({
      job: honestStatus(job),
      stages: await listStages(job.id),
      events: await listEvents(job.id, 200),
      artifacts: listArtifacts(job.id),
    });
  });

  app.post('/api/jobs/:id/approve-cost', async (req, res) => {
    const job = await getJob(req.params.id);
    if (!job) {
      res.status(404).json({ error: 'job tidak ditemukan' });
      return;
    }
    if (worker) await worker.approveCost(job.id);
    else await updateJob(job.id, { status: 'queued' });
    res.json({ ok: true });
  });

  /**
   * Retry a failed job. `from` rewinds to that stage (and everything after it),
   * which is what you want after uploading new assets.
   */
  app.post('/api/jobs/:id/retry', async (req, res) => {
    const job = await getJob(req.params.id);
    if (!job) {
      res.status(404).json({ error: 'job tidak ditemukan' });
      return;
    }
    if (job.status !== 'failed' && job.status !== 'cancelled') {
      res.status(409).json({ error: `job berstatus ${job.status}, tidak bisa diulang` });
      return;
    }
    const stages = await listStages(job.id);
    const from = typeof req.body?.from === 'string' ? req.body.from : null;
    const startOrd = from ? stages.find((s) => s.name === from)?.ord : undefined;
    if (from && startOrd === undefined) {
      res.status(400).json({ error: `tahap ${from} tidak ada` });
      return;
    }
    for (const stage of stages) {
      const rewind = startOrd !== undefined ? stage.ord >= startOrd : stage.status === 'failed';
      if (!rewind) continue;
      await resetStage(stage.id);
      clearCheckpoint(job.id, stage.name);
    }
    await updateJob(job.id, { status: 'queued', error: null, progress: 0 });
    await recordEvent({
      jobId: job.id,
      level: 'info',
      scope: 'worker',
      message: 'job diulang oleh pengguna',
    });
    res.json({ ok: true, assets: userAssetsFor(job.model, path.join(paths.assets, 'own')).length });
  });

  app.post('/api/jobs/:id/cancel', async (req, res) => {
    await updateJob(req.params.id, { status: 'cancelled' });
    res.json({ ok: true });
  });

  app.get('/api/jobs/:id/events', async (req, res) => {
    const level = req.query.level ? String(req.query.level) : undefined;
    res.json({ events: await listEvents(req.params.id, 500, level) });
  });

  app.get('/api/jobs/:id/file/:name', async (req, res) => {
    const name = path.basename(req.params.name);
    const file = path.join(jobDir(req.params.id), name);
    if (!fs.existsSync(file)) {
      res.status(404).json({ error: 'berkas tidak ada' });
      return;
    }
    res.sendFile(file);
  });

  app.get('/api/jobs/:id/artifact/:name', async (req, res) => {
    const name = path.basename(req.params.name);
    const value = readArtifactFile<unknown>(req.params.id, name);
    if (value === null) {
      res.status(404).json({ error: 'artefak tidak ada' });
      return;
    }
    res.json({ name, value });
  });

  app.get('/api/jobs/:id/asset/:scene', async (req, res) => {
    const assets = readArtifactList(req.params.id, 'assets.json');
    const scene = Number(req.params.scene);
    const asset = assets.find((a) => Number(a.sceneIndex) === scene);
    if (!asset || !fs.existsSync(String(asset.path))) {
      res.status(404).json({ error: 'aset tidak ada' });
      return;
    }
    res.sendFile(String(asset.path));
  });

  // ---- own assets (upload from the browser, no extra dependency) ----
  // Must resolve through the catalog: folders are named by hand after the
  // catalog slug, so a naive slug of the display name ("mazda-rx-7") would
  // write uploads where the pipeline never looks.
  const ownDir = (model: string) => path.join(paths.assets, 'own', assetFolderSlug(model));
  const ASSET_EXT = /\.(jpe?g|png|webp|mp4|mov)$/i;

  /**
   * Random stock photos look sharp to the QA stage, so they pass and render a
   * car-less video. Their downloaders leave a marker in the file header; flag
   * those so the UI can warn before a render burns two minutes.
   */
  const STOCK_MARKERS = [/Picsum ID/i, /Lorem Picsum/i, /placeholder\.com/i];
  const assetFlag = (file: string): string | null => {
    let head: Buffer;
    try {
      const fd = fs.openSync(file, 'r');
      head = Buffer.alloc(64 * 1024);
      const read = fs.readSync(fd, head, 0, head.length, 0);
      fs.closeSync(fd);
      head = head.subarray(0, read);
    } catch {
      return null;
    }
    const text = head.toString('latin1');
    return STOCK_MARKERS.some((re) => re.test(text)) ? 'Gambar stok acak, bukan kendaraan' : null;
  };

  app.get('/api/assets/:model', async (req, res) => {
    const dir = ownDir(req.params.model);
    const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => ASSET_EXT.test(f)) : [];
    const warnings: Record<string, string> = {};
    for (const file of files) {
      const flag = assetFlag(path.join(dir, file));
      if (flag) warnings[file] = flag;
    }
    res.json({ model: req.params.model, folder: path.relative(paths.root, dir), files, warnings });
  });

  app.post(
    '/api/assets/:model',
    express.raw({ type: '*/*', limit: '200mb' }),
    async (req, res) => {
      const name = path.basename(String(req.query.name ?? ''));
      if (!name || !ASSET_EXT.test(name)) {
        res.status(400).json({ error: 'nama berkas harus jpg, jpeg, png, webp, mp4, atau mov' });
        return;
      }
      if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
        res.status(400).json({ error: 'isi berkas kosong' });
        return;
      }
      const dir = ownDir(req.params.model);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, name), req.body);
      res.status(201).json({ ok: true, folder: path.relative(paths.root, dir), file: name });
    },
  );

  app.get('/api/assets/:model/file/:name', async (req, res) => {
    const name = path.basename(req.params.name);
    if (!ASSET_EXT.test(name)) {
      res.status(400).json({ error: 'tipe berkas tidak didukung' });
      return;
    }
    const file = path.join(ownDir(req.params.model), name);
    if (!fs.existsSync(file)) {
      res.status(404).json({ error: 'berkas tidak ada' });
      return;
    }
    res.sendFile(file);
  });

  app.delete('/api/assets/:model/:name', async (req, res) => {
    const name = path.basename(req.params.name);
    const file = path.join(ownDir(req.params.model), name);
    if (!fs.existsSync(file)) {
      res.status(404).json({ error: 'berkas tidak ada' });
      return;
    }
    fs.unlinkSync(file);
    res.json({ ok: true });
  });

  app.get('/api/dashboard', async (_req, res) => {
    const jobs = await listJobs(50);
    const active = jobs.find((j) => ['running', 'queued', 'paused_offline', 'awaiting_cost_approval'].includes(j.status));
    const defaults = loadDefaults();
    res.json({
      connection: currentConnection(),
      activeJob: active ?? null,
      activeStages: active ? await listStages(active.id) : [],
      queue: jobs.filter((j) => ['queued', 'awaiting_cost_approval', 'paused_offline'].includes(j.status)).length,
      costToday: await dailyCost(),
      costLimit: defaults.cost.maxCostPerHari,
      jobCostLimit: defaults.cost.maxCostPerJob,
      agents: listPresets(),
      publications: await listPublications(),
    });
  });

  app.get('/api/settings', async (_req, res) => {
    const defaults = loadDefaults();
    res.json({
      minDurasi: await getSetting('minDurasi', defaults.minDurasi),
      workTime: await getSetting('workTime', defaults.workTime),
      agentPreset: await getSetting('agentPreset', defaults.agentPreset),
      visualOrder: await getSetting('visualOrder', defaults.visualAdapters),
      maxCostPerJob: await getSetting('maxCostPerJob', defaults.cost.maxCostPerJob),
      maxCostPerHari: await getSetting('maxCostPerHari', defaults.cost.maxCostPerHari),
      connection: await getSetting('connection', defaults.connection),
      publish: await getSetting('publish', defaults.publish),
      providerConfigured: {
        image: Boolean(process.env.IMAGE_PROVIDER_API_KEY),
        video: Boolean(process.env.VIDEO_PROVIDER_API_KEY),
        stock: Boolean(process.env.STOCK_API_KEY),
        llm: Boolean(process.env.LLM_API_KEY),
        instagram: Boolean(process.env.IG_ACCESS_TOKEN),
      },
    });
  });

  app.put('/api/settings', async (req, res) => {
    const allowed = [
      'minDurasi',
      'workTime',
      'agentPreset',
      'visualOrder',
      'maxCostPerJob',
      'maxCostPerHari',
      'connection',
      'publish',
    ];
    for (const key of allowed) {
      if (req.body?.[key] !== undefined) await setSetting(key, req.body[key]);
    }
    // Secrets are write-only: stored server side, never echoed back.
    for (const [key, env] of Object.entries({
      imageProviderApiKey: 'IMAGE_PROVIDER_API_KEY',
      videoProviderApiKey: 'VIDEO_PROVIDER_API_KEY',
      stockApiKey: 'STOCK_API_KEY',
      llmApiKey: 'LLM_API_KEY',
      igAccessToken: 'IG_ACCESS_TOKEN',
    })) {
      const value = req.body?.[key];
      if (typeof value === 'string' && value.length > 0) {
        process.env[env] = value;
        await setSetting(`secret:${key}`, 'disimpan');
      }
    }
    res.json({ ok: true });
  });

  app.post('/api/publish/:jobId', async (req, res) => {
    try {
      const result = await publishJob({
        jobId: req.params.jobId,
        platform: String(req.body?.platform ?? 'instagram'),
        dryRun: req.body?.dryRun !== false,
        caption: req.body?.caption,
      });
      res.json(result);
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'publish gagal' });
    }
  });

  // ---- SSE ----
  app.get('/api/events', async (req, res) => {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.write(`event: hello\ndata: ${JSON.stringify({ connection: currentConnection() })}\n\n`);
    const unsubscribe = bus.subscribe((event) => {
      res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
    });
    const keepAlive = setInterval(() => res.write(': ping\n\n'), 15_000);
    req.on('close', () => {
      clearInterval(keepAlive);
      unsubscribe();
    });
  });

  // ---- static UI ----
  const publicDir = paths.publicDir;
  const staticMaxAge = process.env.NODE_ENV === 'production' ? '1h' : 0;
  // Galeri studio memakai path relatif `video/...` dan `thumb/...`. Saat studio
  // disajikan backend, berkas itu harus datang dari netlify-site tanpa disalin
  // (159 MB). Dipasang sebelum catch-all index.html di bawah.
  const siteDir = path.join(paths.root, 'netlify-site');
  if (fs.existsSync(path.join(siteDir, 'video'))) {
    app.use('/video', express.static(path.join(siteDir, 'video'), { maxAge: staticMaxAge, etag: true }));
  }
  if (fs.existsSync(path.join(siteDir, 'thumb'))) {
    app.use('/thumb', express.static(path.join(siteDir, 'thumb'), { maxAge: staticMaxAge, etag: true }));
  }
  app.use(express.static(publicDir, { index: false, maxAge: staticMaxAge, etag: true }));
  app.use((req, res, next) => {
    if (req.method !== 'GET') return next();
    if (req.path.startsWith('/api')) return next();
    const index = path.join(publicDir, 'index.html');
    if (!fs.existsSync(index)) {
      res.status(503).send('UI belum dibangun. Jalankan: npm run build:ui');
      return;
    }
    /**
     * Halaman staging tidak boleh masuk indeks mesin pencari: URL sandbox
     * berubah tiap sesi dan akan bersaing dengan domain produksi. `SITE_URL`
     * yang berisi domain produksi mematikan noindex, jadi produksi tetap
     * terindeks tanpa perlu mengubah berkas.
     */
    const html = fs.readFileSync(index, 'utf8');
    if (!productionSite()) {
      res.setHeader('X-Robots-Tag', 'noindex, nofollow');
      // Ganti tag robots yang sudah ada, bukan menambah: dua tag berlawanan
      // membuat mesin pencari memilih yang paling permisif.
      const noindex = '<meta name="robots" content="noindex, nofollow" />';
      const patched = /<meta name="robots"[^>]*>/.test(html)
        ? html.replace(/<meta name="robots"[^>]*>/, noindex)
        : html.replace('<head>', `<head>\n    ${noindex}`);
      res.type('html').send(patched);
      return;
    }
    res.type('html').send(html);
  });

  return { app, worker };
}

/**
 * Domain produksi dianggap sah hanya bila `SITE_URL` diset dan bukan host
 * sandbox. Tanpa itu semua halaman ditandai noindex, sehingga URL pratinjau
 * tidak pernah bersaing dengan situs asli di mesin pencari.
 */
function productionSite(): boolean {
  const url = process.env.SITE_URL?.trim();
  if (!url) return false;
  return !/prod-runtime\.all-hands\.dev|localhost|127\.0\.0\.1/.test(url);
}

function cookieHeader(token: string): string {
  const secure = process.env.APP_URL?.startsWith('https') ? '; Secure' : '';
  // UI statis di domain lain hanya bisa mengirim cookie sesi bila SameSite=None,
  // dan SameSite=None wajib disertai Secure. Hanya aktif saat CORS dibuka.
  const crossSite = Boolean(process.env.CORS_ORIGINS?.trim());
  const sameSite = crossSite ? 'None' : 'Lax';
  const secureCross = crossSite && !secure ? '; Secure' : '';
  return `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=${sameSite}; Max-Age=${60 * 60 * 24 * 7}${secure}${secureCross}`;
}

export function parseCookies(header: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of header.split(';')) {
    const [k, ...rest] = part.trim().split('=');
    if (!k) continue;
    out[k] = decodeURIComponent(rest.join('='));
  }
  return out;
}

function readArtifactList(jobId: string, file: string): Record<string, unknown>[] {
  const target = path.join(jobDir(jobId), 'artifacts', file);
  if (!fs.existsSync(target)) return [];
  try {
    return JSON.parse(fs.readFileSync(target, 'utf8')) as Record<string, unknown>[];
  } catch {
    return [];
  }
}

function listArtifacts(jobId: string): string[] {
  const dir = path.join(jobDir(jobId), 'artifacts');
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir);
}
