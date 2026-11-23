import fs from 'node:fs';
import path from 'node:path';
import { guardArtifactWrite, guardTool, PermanentError, type AgentContext, type Tool } from './guard.ts';
import { artifactPath } from './guard.ts';
import { loadThemes, loadDefaults, loadAdapters } from '../core/config.ts';
import { pickTheme } from '../core/theme.ts';
import { planScenes, estimateCost } from '../pipeline/scenes.ts';
import { resolveBriefLook } from '../core/brief-look.ts';
import { resolveSceneAsset } from '../visuals/index.ts';
import { routeForModel, wantsVideoClip, withVendorModel } from '../visuals/model-map.ts';
import { assetFolderSlug, userAssetsFor } from '../visuals/types.ts';
import { sanitizePrompt } from '../visuals/sanitize.ts';
import { loadVisuals } from '../core/config.ts';
import { findModel, specLines } from '../core/catalog.ts';
import type { AssetRecord, Brief, ScenePlan } from '../core/types.ts';
import { resolveDuration } from '../core/brief.ts';
import { paths, jobDir } from '../core/fsx.ts';
import { checkAssets, isBelowMinimum } from '../pipeline/quality.ts';
import { measureMotion } from '../pipeline/motion-score.ts';
import { loadPolicy } from '../core/motion-policy.ts';
import {
  ffprobe,
  contactSheet,
  frameSharpness,
  extractFrame,
  perceptualHash,
  measureLoudness,
} from '../render/ffmpeg.ts';
import type { RenderResult } from '../render/assemble.ts';
import { markSceneDone, readSceneCheckpoint, markStageComplete } from '../pipeline/checkpoint.ts';
import { engineSfxPrompts, AUDIO_NEGATIVE } from '../core/prompts.ts';
import { buildScript } from '../pipeline/script.ts';
import { engineProfileFor, describeProfile } from '../render/engine.ts';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const registry = new Map<string, Tool>();

export function tool(name: string, description: string, run: Tool['run']): void {
  registry.set(name, { name, description, run });
}

export function getTool(name: string): Tool | undefined {
  return registry.get(name);
}

/** Every tool call goes through the job desk guard before it runs. */
export async function callTool(name: string, ctx: AgentContext, args: Record<string, unknown> = {}): Promise<unknown> {
  guardTool(ctx.agent, name);
  const impl = registry.get(name);
  if (!impl) throw new Error(`alat ${name} tidak terdaftar`);
  return impl.run(args, ctx);
}

export function writeOwned(ctx: AgentContext, file: string, value: unknown): void {
  guardArtifactWrite(ctx.agent, file);
  ctx.writeArtifact(file, value);
}

function scenesFrom(ctx: AgentContext): ScenePlan[] {
  return (ctx.readArtifact<ScenePlan[]>('storyboard.json') ?? []) as ScenePlan[];
}

// ---------------------------------------------------------------- PM tools

tool('read_brief', 'Baca brief job ini', async (_args, ctx) => ctx.brief);

tool('plan_jobs', 'Susun rencana kerja dari brief', async (_args, ctx) => {
  const defaults = loadDefaults();
  const brief = ctx.brief as unknown as Brief;
  const { durationSec, bumped, originalDuration } = resolveDuration(brief, defaults.minDurasi, defaults.maxDurasi);
  const look = resolveBriefLook(brief);
  const theme = look.theme;
  const scenes = planScenes({
    brief,
    durationSec,
    theme,
    aspect: look.aspect,
    sceneKeys: look.template?.sceneKeys,
  });
  const adapters = loadAdapters();
  const withVideo = Object.values(adapters.adapters).some(
    (a) => a.kind === 'video-gen' && a.enabled && a.envKey && process.env[a.envKey],
  );
  const cost = estimateCost({
    durationSec,
    sceneCount: scenes.length,
    withVideo,
    estimates: defaults.cost.estimates,
  });
  const plan = {
    durationSec,
    bumped,
    originalDuration,
    themeId: theme.id,
    aspect: brief.rasio ?? '16:9',
    sceneCount: scenes.length,
    sceneKeys: scenes.map((s) => s.key),
    costEstimate: cost,
    createdAt: new Date().toISOString(),
  };
  writeOwned(ctx, 'plan.json', plan);
  if (bumped) {
    await ctx.log('warn', `durasi ${originalDuration} dtk dinaikkan ke minimum ${durationSec} dtk`);
  }
  return plan;
});

tool('dispatch_agent', 'Catat agen yang akan dijalankan berikutnya', async (args, ctx) => {
  const target = String(args.agentId ?? '');
  await ctx.log('info', `menugaskan ${target}`);
  return { dispatched: target };
});

tool('read_stage_status', 'Baca status tahap job', async (_args, ctx) => ctx.brief);

tool('fail_job', 'Tandai job gagal beserta alasan', async (args, ctx) => {
  await ctx.log('error', String(args.reason ?? 'job gagal'));
  return { failed: true };
});

// ---------------------------------------------------------- research tools

tool('read_themes', 'Baca tema video yang tersedia', async (_args) => {
  const themes = loadThemes();
  return themes.themes;
});

tool('write_research', 'Tulis data riset dari brief dan katalog', async (_args, ctx) => {
  const brief = ctx.brief as unknown as Brief;
  const fromBrief = (brief.keunggulan ?? []).map((item) => ({ text: item, source: 'brief' }));
  // The catalog only fills gaps; anything the user typed wins.
  const entry = findModel(brief.model);
  const fromCatalog = entry
    ? specLines(entry)
        .filter((line) => !fromBrief.some((b) => b.text === line))
        .map((text) => ({ text, source: 'katalog' }))
    : [];
  const specs = [...fromBrief, ...fromCatalog];
  const research = {
    model: brief.model,
    catalog: entry
      ? {
          merk: entry.merk,
          seri: entry.seri,
          tahun: entry.tahun,
          kategori: entry.kategori,
          mesin: entry.mesin,
          tenaga: entry.tenaga,
          torsi: entry.torsi,
          layout: entry.layout,
          berat: entry.berat,
          nol100: entry.nol100,
          vmax: entry.vmax,
          sumber: entry.sumber,
        }
      : null,
    specs,
    missing: specs.length === 0 ? ['tidak ada data teknis untuk model ini'] : [],
    note: 'angka dari brief didahulukan; sisanya dari katalog yang bersumber Wikipedia',
  };
  writeOwned(ctx, 'research.json', research);
  return research;
});

// ------------------------------------------------------------ script tools

tool('read_research', 'Baca hasil riset', async (_args, ctx) => ctx.readArtifact('research.json'));

tool('write_script', 'Tulis narasi dan teks layar', async (_args, ctx) => {
  const brief = ctx.brief as unknown as Brief;
  const research = ctx.readArtifact<{ specs: { text: string }[] }>('research.json');
  const defaults = loadDefaults();
  const { durationSec } = resolveDuration(brief, defaults.minDurasi, defaults.maxDurasi);
  const look = resolveBriefLook(brief);
  const theme = look.theme;
  const scenes = planScenes({
    brief,
    durationSec,
    theme,
    aspect: look.aspect,
    sceneKeys: look.template?.sceneKeys,
  });
  const specs = research?.specs ?? [];
  const entry = findModel(brief.model);
  const detail = entry
    ? {
        merk: entry.merk,
        seri: entry.seri,
        tahun: entry.tahun,
        mesin: entry.mesin,
        tenaga: entry.tenaga,
        nol100: entry.nol100,
        vmax: entry.vmax,
        layout: entry.layout,
      }
    : null;
  const draft = await buildScript({ brief, scenes, specs, detail });
  const script = {
    model: draft.model,
    tagline: draft.tagline,
    lines: draft.lines,
    sumber: draft.sumber,
    catatan: draft.catatan,
  };
  writeOwned(ctx, 'script.json', script);
  await ctx.log(
    'info',
    `naskah dibuat oleh ${draft.sumber === 'llm' ? 'LLM' : 'penyusun lokal'}` +
      (draft.catatan ? ` (${draft.catatan})` : ''),
  );
  return script;
});

interface ModelDetail {
  merk: string;
  seri: string;
  tahun: string;
  mesin: string;
  tenaga: string;
  nol100: string;
  vmax: string;
  layout: string;
}

// -------------------------------------------------------- storyboard tools

tool('read_script', 'Baca naskah', async (_args, ctx) => ctx.readArtifact('script.json'));

tool('write_storyboard', 'Tulis storyboard per scene', async (_args, ctx) => {
  const brief = ctx.brief as unknown as Brief;
  const defaults = loadDefaults();
  const { durationSec } = resolveDuration(brief, defaults.minDurasi, defaults.maxDurasi);
  const look = resolveBriefLook(brief);
  const theme = look.theme;
  const scenes = planScenes({
    brief,
    durationSec,
    theme,
    aspect: look.aspect,
    sceneKeys: look.template?.sceneKeys,
  });
  const script = ctx.readArtifact<{ lines: { sceneIndex: number; voiceover: string }[] }>('script.json');
  const voByScene = new Map((script?.lines ?? []).map((l) => [l.sceneIndex, l.voiceover]));
  const storyboard = scenes.map((scene) => ({ ...scene, voiceover: voByScene.get(scene.index) ?? '' }));
  writeOwned(ctx, 'storyboard.json', storyboard);
  return storyboard;
});

// ------------------------------------------------------------ visual tools

tool('read_storyboard', 'Baca storyboard', async (_args, ctx) => ctx.readArtifact('storyboard.json'));

tool('list_visual_adapters', 'Lihat urutan adapter visual', async () => {
  const adapters = loadAdapters();
  const defaults = loadDefaults();
  return defaults.visualAdapters.map((id) => ({
    id,
    available: Boolean(
      adapters.adapters[id] && (!adapters.adapters[id].envKey || process.env[adapters.adapters[id].envKey!]),
    ),
  }));
});

async function generateAssets(ctx: AgentContext, wantVideo: boolean): Promise<AssetRecord[]> {
  const brief = ctx.brief as unknown as Brief;
  const scenes = scenesFrom(ctx);
  const defaults = loadDefaults();
  const adapters = loadAdapters();
  const theme = resolveBriefLook(brief).theme;
  const outDir = path.join(jobDir(ctx.jobId), 'assets');
  const done = new Set(readSceneCheckpoint(ctx.jobId, 'aset-visual').done);
  const existing = ctx.readArtifact<AssetRecord[]>('assets.json') ?? [];
  // Only keep records whose scene is still checkpointed; a rewind regenerates the rest.
  const assets: AssetRecord[] = existing.filter((a) => done.has(a.sceneIndex));

  const visuals = loadVisuals();
  const paceMs = Number(process.env.VISUAL_PACE_MS ?? 4000);
  // A paid vendor adapter is only ever called when the user picked that model.
  // Keying off the API key alone would silently bill every job that happens to
  // have a key in the environment.
  const route = routeForModel(brief.modelId);
  const vendorId = route && route.adapterId !== 'local' ? route.adapterId : '';
  const vendorConfigured = Boolean(
    vendorId && adapters.adapters[vendorId]?.envKey && process.env[adapters.adapters[vendorId].envKey!],
  );
  const useVendor = Boolean(vendorId && vendorConfigured);
  if (vendorId && !vendorConfigured) {
    await ctx.log('warn', `model ${brief.modelId} dipilih tapi kuncinya belum diisi; memakai render lokal`, {
      adapter: vendorId,
    });
  }

  const isVendor = (id: string) => Boolean(adapters.adapters[id]?.provider);
  const stills = visuals.order.filter((id) => id !== 'stock-api' && !isVendor(id));
  const baseOrder = (wantVideo || useVendor ? stills.concat('stock-api') : visuals.order.filter((id) => !isVendor(id)));
  // The chosen model goes first: the user asked for it explicitly. Local photos
  // stay right behind it so a provider outage degrades instead of failing.
  const order = useVendor ? [vendorId, ...baseOrder] : baseOrder;
  const defs = { ...adapters.adapters };
  if (useVendor && route) defs[vendorId] = withVendorModel(defs[vendorId], route);

  for (const scene of scenes) {
    if (done.has(scene.index)) continue;
    ctx.assertOnline();
    await ctx.setStageMessage(`scene ${scene.index + 1}/${scenes.length}`);
    // Image-to-video needs a still to animate; reuse the model's own photos.
    const own = userAssetsFor(brief.model, path.join(paths.assets, 'own')).filter((f) => !/\.(mp4|mov)$/i.test(f));
    const { result, attempts } = await resolveSceneAsset({
      order,
      defs,
      fallback: visuals.fallback,
      request: {
        scene: { ...scene, prompt: sanitizePrompt(scene.prompt, brief.model) },
        theme,
        model: brief.model,
        aspect: brief.rasio ?? '16:9',
        referenceImage: useVendor ? own[scene.index % Math.max(1, own.length)] : undefined,
        outDir,
      },
    });
    if (attempts.length) {
      await ctx.log('warn', `scene ${scene.index + 1}: ${attempts.length} adapter dicoba`, { attempts });
    }
    if (!result) {
      await ctx.log('warn', `scene ${scene.index + 1} tidak mendapat aset realistis`, {
        attempts,
      });
      continue;
    }
    const record: AssetRecord = {
      sceneIndex: scene.index,
      kind: result.kind,
      path: result.path,
      source: result.source,
      provider: result.provider,
      credit: result.credit,
    };
    assets.push(record);
    writeOwned(ctx, 'assets.json', assets);
    markSceneDone(ctx.jobId, 'aset-visual', scene.index);
    await ctx.setStageProgress(Math.round((assets.length / scenes.length) * 100));
    // Keyless providers rate-limit hard; spacing requests keeps a 6-scene job
    // from tripping 402 halfway through.
    if (result.provider !== 'local') await sleep(paceMs);
  }
  const missing = scenes.filter((s) => !assets.some((a) => a.sceneIndex === s.index));
  if (missing.length) {
    // Report the adapters that were actually attempted, not just keyed ones:
    // a keyless provider counts as configured.
    const configured = order.filter((id) => {
      const def = adapters.adapters[id];
      if (!def || !def.enabled) return false;
      if (def.requiresKey) return Boolean(def.envKey && process.env[def.envKey]);
      return true;
    });
    throw new PermanentError(
      `${missing.length} dari ${scenes.length} scene belum punya aset. ` +
        `Adapter siap: ${configured.join(', ') || 'tidak ada'}. ` +
        `Unggah foto ke assets/own/${assetFolderSlug(brief.model)}/ ` +
        `atau aktifkan generator gratis (image-gen-free) di Pengaturan.`,
    );
  }
  markStageComplete(ctx.jobId, 'aset-visual');
  return assets;
}

// The stage tool list is fixed, so the "image" tool is the single entry point
// and the brief decides whether it should return stills or clips. Without this
// a job that selected Veo would still ask only for keyframes.
tool('generate_image', 'Hasilkan keyframe per scene', async (_args, ctx) => {
  const brief = ctx.brief as unknown as Brief;
  return generateAssets(ctx, wantsVideoClip(brief.modelId));
});
tool('generate_video', 'Hasilkan klip per scene', async (_args, ctx) => generateAssets(ctx, true));

tool('write_assets', 'Simpan daftar aset', async (_args, ctx) => {
  const assets = ctx.readArtifact<AssetRecord[]>('assets.json') ?? [];
  writeOwned(ctx, 'assets.json', assets);
  return { count: assets.length };
});

// ------------------------------------------------------------ motion tools

tool('read_assets', 'Baca daftar aset', async (_args, ctx) => ctx.readArtifact('assets.json'));

tool('write_motion', 'Tulis parameter animasi dan color grade', async (_args, ctx) => {
  const scenes = scenesFrom(ctx);
  const brief = ctx.brief as unknown as Brief;
  const theme = resolveBriefLook(brief).theme;
  const motion = {
    grade: theme.grade,
    palette: theme.palette,
    scenes: scenes.map((scene) => ({
      sceneIndex: scene.index,
      textAnimation: scene.index === 0 ? 'tracking-in' : 'fade-up',
      transition: scene.key === 'action' ? 'whip-pan' : 'dissolve',
      camera: scene.key === 'action' ? 'speed-ramp' : 'ken-burns',
      parallax: scene.key !== 'hook',
    })),
    grain: 0.06,
    motionBlur: true,
  };
  writeOwned(ctx, 'motion.json', motion);
  return motion;
});

// ------------------------------------------------------------- sound tools

/**
 * Posisi kamera per jenis scene. Dipakai untuk memilih event audio yang masuk
 * akal: kamera di kabin tidak mungkin merekam pass-by, dan close-up roda tidak
 * punya rev exhaust dominan.
 */
const SHOT_FOR_SCENE: Record<string, 'interior' | 'eksterior-dekat' | 'eksterior-jauh' | 'pass-by' | 'onboard'> = {
  hook: 'eksterior-jauh',
  exterior: 'eksterior-dekat',
  detail_engine: 'eksterior-dekat',
  detail_wheel: 'eksterior-dekat',
  interior: 'interior',
  action: 'pass-by',
  night: 'pass-by',
  lifestyle: 'eksterior-jauh',
  features: 'eksterior-dekat',
  cta: 'eksterior-jauh',
};

const EVENT_FOR_SHOT: Record<string, string> = {
  interior: 'idle',
  'eksterior-dekat': 'rev',
  'eksterior-jauh': 'idle',
  'pass-by': 'akselerasi',
  onboard: 'akselerasi',
};

/**
 * Menyintesis satu potong narasi menjadi berkas audio sungguhan.
 *
 * Versi lama hanya mengembalikan teks, sehingga agen audio merasa berhasil
 * padahal tidak ada suara yang pernah dibuat. Sekarang hasilnya berisi berkas
 * dan status yang bisa diperiksa.
 */
tool('synthesize_speech', 'Sintesis narasi jadi audio', async (args, ctx) => {
  const { synthesize, ttsAvailable, toneForModel } = await import('../tts/provider.ts');
  const text = String(args.text ?? '').trim();
  if (!text) return { ok: false, error: 'teks kosong' };
  if (!ttsAvailable()) {
    return {
      ok: false,
      skipped: true,
      error: 'Tidak ada mesin TTS: isi TTS_API_KEY atau pasang Piper (scripts/fetch-tts-model.sh)',
    };
  }
  const brief = ctx.brief as unknown as Brief;
  const dir = path.join(jobDir(ctx.jobId), 'audio', 'narration');
  fs.mkdirSync(dir, { recursive: true });
  const outFile = path.join(dir, `adhoc-${Date.now()}.mp3`);
  const res = await synthesize(text, { outFile, tone: toneForModel(brief.model ?? '') });
  return res;
});

tool('write_audio_plan', 'Tulis rencana audio dan subtitle', async (_args, ctx) => {
  const brief = ctx.brief as unknown as Brief;
  const script = ctx.readArtifact<{ lines: { sceneIndex: number; voiceover: string; onScreenText: string }[] }>(
    'script.json',
  );
  const scenes = scenesFrom(ctx);
  // Suara yang disintesis pipeline ini berasal dari profil mesin di katalog,
  // dan prompt SFX eksternal (Suno/ElevenLabs) dibangun dari sumber yang sama
  // supaya keduanya tidak menyebut mesin yang berbeda.
  const model = findModel(brief.model ?? '');
  const sfxPrompts = model ? engineSfxPrompts(model) : [];
  const profile = engineProfileFor(brief.model ?? '');
  const isElectric = profile.aspiration === 'electric';
  /**
   * Rencana audio per scene. Nilainya diturunkan dari profil mesin katalog, jadi
   * tidak ada jenis penggerak atau event yang dikarang: model di luar katalog
   * memakai profil generik dan ditandai `unknown` pada `sumber`.
   */
  const audioPlan = scenes.map((scene) => {
    const shot = SHOT_FOR_SCENE[scene.key] ?? 'eksterior-jauh';
    return {
      sceneIndex: scene.index,
      sceneKey: scene.key,
      penggerak: isElectric ? 'EV' : 'ICE',
      posisiKamera: shot,
      eventDominan: EVENT_FOR_SHOT[shot],
      permukaan: 'aspal',
      mesin: isElectric
        ? { silinder: 0, firingPerRev: 0, rpm: null, catatan: 'motor listrik, tanpa exhaust' }
        : {
            silinder: profile.cylinders,
            firingPerRev: profile.firingPerRev,
            rpm: shot === 'interior' ? profile.idle : Math.round(profile.redline * 0.55),
            redline: profile.redline,
          },
      sumber: model ? `katalog:${model.slug}` : 'unknown',
    };
  });

  const plan = {
    loudnessLufs: -16,
    truePeakDbtp: -1,
    audioPlan,
    music: { ducking: true, gain: -18 },
    engine: {
      profile: describeProfile(profile),
      synthesizedLocally: true,
      /** Prompt untuk generator SFX eksternal; pipeline lokal tidak memakainya. */
      externalPrompts: sfxPrompts,
      negativePrompt: AUDIO_NEGATIVE,
    },
    sfx: scenes.map((scene) => ({
      sceneIndex: scene.index,
      bed: scene.key === 'action' ? 'engine-rev' : scene.key === 'interior' ? 'cabin-ambience' : 'studio-room',
      /** Prompt yang cocok untuk scene ini, bila ada. */
      promptId: scene.key === 'action' ? 'passby' : scene.key === 'interior' ? 'idle' : scene.key === 'detail_engine' ? 'start' : 'rev',
    })),
    subtitles: (script?.lines ?? []).map((line) => ({
      sceneIndex: line.sceneIndex,
      text: line.voiceover,
    })),
    // Bukan sekadar "ada kunci": mesin lokal juga bisa menyintesis. Nilai ini
    // dipakai UI untuk memutuskan menampilkan peringatan narasi.
    ttsAvailable: (await import('../tts/provider.ts')).ttsAvailable(),
  };
  writeOwned(ctx, 'audio.json', plan);
  return plan;
});

// ------------------------------------------------------------ render tools

tool('read_all_artifacts', 'Baca semua artefak job', async (_args, ctx) => ({
  storyboard: ctx.readArtifact('storyboard.json'),
  assets: ctx.readArtifact('assets.json'),
  motion: ctx.readArtifact('motion.json'),
  audio: ctx.readArtifact('audio.json'),
  render: ctx.readArtifact('render.json'),
  qa: ctx.readArtifact('qa.json'),
}));

tool('probe_video', 'Periksa berkas video dengan ffprobe', async (args) => {
  const file = String(args.path ?? '');
  return ffprobe(file);
});

tool('render_video', 'Rakit video dari aset', async (_args, ctx) => {
  const { assembleVideo } = await import('../render/assemble.ts');
  return assembleVideo(ctx);
});

tool('write_render', 'Simpan hasil render', async (args, ctx) => {
  writeOwned(ctx, 'render.json', args.render);
  return args.render;
});

// ---------------------------------------------------------------- QA tools

tool('inspect_preview', 'Buat dan periksa preview contact sheet', async (_args, ctx) => {
  const assets = ctx.readArtifact<AssetRecord[]>('assets.json') ?? [];
  const scenes = scenesFrom(ctx);
  const defaults = loadDefaults();
  const report = checkAssets({
    scenes,
    assets,
    options: {
      minWidth: defaults.quality.minWidth,
      minHeight: defaults.quality.minHeight,
      minSharpness: defaults.quality.minSharpness,
      minSharpnessGenerated: defaults.quality.minSharpnessGenerated,
      sceneHashDistance: defaults.quality.sceneHashDistance,
      forbidTextInImage: defaults.quality.forbidTextInImage,
      mode: 'draft',
    },
  });
  const sheetPath = path.join(jobDir(ctx.jobId), 'preview.jpg');
  const sheet = contactSheet(
    scenes.map((s) => assets.find((a) => a.sceneIndex === s.index)?.path ?? ''),
    sheetPath,
  );
  const video = path.join(jobDir(ctx.jobId), 'video.mp4');
  const probe = ffprobe(video);
  const expected = scenes.reduce((sum, s) => sum + s.duration, 0);
  const result = {
    ...report,
    preview: sheet,
    sharpness: report.sharpness,
    video: { ...probe, expectedDurationSec: expected },
  };
  writeOwned(ctx, 'qa.json', result);
  if (!report.passed) {
    const first = report.issues[0];
    throw new PermanentError(
      `QA menolak hasil: ${report.issues.length} masalah, misalnya scene ${first.sceneIndex + 1} ${first.reason}`,
    );
  }
  if (!probe.ok) throw new PermanentError(`QA menolak hasil: video tidak terbaca (${probe.error ?? '?'})`);
  if (expected && Math.abs((probe.durationSec ?? 0) - expected) > 1.5) {
    throw new PermanentError(
      `QA menolak hasil: durasi ${probe.durationSec?.toFixed(1)} dtk, seharusnya ${expected.toFixed(1)} dtk`,
    );
  }
  return result;
});

tool('request_fix', 'Minta perbaikan ke agen penanggung jawab', async (args, ctx) => {
  await ctx.log('warn', `perbaikan diminta dari ${String(args.agentId ?? '?')}: ${String(args.note ?? '')}`);
  return { requested: true };
});

/**
 * QA is a gate, not a rubber stamp: the previous version approved every job
 * unconditionally, which is why broken renders reached "done" and why qa.json
 * was sometimes missing entirely.
 */
tool('approve_job', 'Verifikasi hasil akhir lalu setujui atau tolak', async (_args, ctx) => {
  const render = ctx.readArtifact<RenderResult>('render.json');
  const assets = ctx.readArtifact<AssetRecord[]>('assets.json') ?? [];
  const scenes = scenesFrom(ctx);
  const defaults = loadDefaults();
  const checks: { name: string; ok: boolean; detail: string }[] = [];

  if (!render) {
    throw new PermanentError('QA ditolak: render.json tidak ada, video belum pernah dirender');
  }

  const fileOk = fs.existsSync(render.file) && fs.statSync(render.file).size > 100_000;
  checks.push({
    name: 'berkas-video',
    ok: fileOk,
    detail: fileOk ? `${(fs.statSync(render.file).size / 1e6).toFixed(1)} MB` : 'berkas tidak ada atau terlalu kecil',
  });

  const probe = ffprobe(render.file);
  checks.push({
    name: 'terbaca-ffprobe',
    ok: probe.ok && (probe.durationSec ?? 0) > 1,
    detail: probe.ok ? `${probe.codec} ${probe.width}x${probe.height} ${probe.durationSec?.toFixed(1)} dtk` : probe.error ?? 'gagal',
  });

  const expected = scenes.reduce((sum, s) => sum + s.duration, 0);
  const drift = Math.abs((probe.durationSec ?? 0) - expected);
  checks.push({
    name: 'durasi-sesuai',
    ok: drift <= 2,
    detail: `video ${(probe.durationSec ?? 0).toFixed(1)} dtk vs rencana ${expected.toFixed(1)} dtk`,
  });

  checks.push({
    name: 'ada-audio',
    ok: Boolean(probe.hasAudio),
    detail: probe.hasAudio ? `codec ${probe.audioCodec}` : 'video tanpa trek audio',
  });

  const resolutionOk = !isBelowMinimum(probe.width ?? 0, probe.height ?? 0, { minWidth: 1280, minHeight: 720 });
  checks.push({
    name: 'resolusi',
    ok: resolutionOk,
    detail: `${probe.width}x${probe.height}`,
  });

  const withFallback = assets.filter((a) => a.fallback);
  checks.push({
    name: 'tanpa-fallback',
    ok: withFallback.length === 0,
    detail: withFallback.length ? `${withFallback.length} aset fallback` : 'semua aset nyata',
  });

  // --- Gerbang audio (16.5). Rencana audio wajib ada per scene, dan loudness
  // diukur dari video jadi: nilai yang kita niatkan tidak membuktikan apa pun.
  const audioPlan = ctx.readArtifact<{
    loudnessLufs?: number;
    truePeakDbtp?: number;
    audioPlan?: { sceneIndex: number; penggerak: string; eventDominan: string }[];
    engine?: { profile?: string };
  }>('audio.json');

  const planByScene = new Map((audioPlan?.audioPlan ?? []).map((p) => [p.sceneIndex, p]));
  const missingPlan = scenes.filter((s) => !planByScene.has(s.index));
  checks.push({
    name: 'audio-plan-lengkap',
    ok: missingPlan.length === 0,
    detail: missingPlan.length
      ? `scene tanpa audio-plan: ${missingPlan.map((s) => s.index).join(', ')}`
      : `${planByScene.size}/${scenes.length} scene punya rencana audio`,
  });

  const loud = measureLoudness(render.file);
  const target = audioPlan?.loudnessLufs ?? -16;
  const lufsDrift = loud.ok && loud.integratedLufs !== undefined ? Math.abs(loud.integratedLufs - target) : 99;
  checks.push({
    name: 'loudness-sesuai',
    ok: loud.ok && lufsDrift <= 1,
    detail: loud.ok
      ? `${loud.integratedLufs?.toFixed(1)} LUFS vs target ${target} (selisih ${lufsDrift.toFixed(1)} LU)`
      : `gagal ukur: ${loud.error ?? '?'}`,
  });

  const peakOk = loud.ok && (loud.truePeakDbtp ?? 99) <= -1;
  checks.push({
    name: 'true-peak-aman',
    ok: peakOk,
    detail: loud.ok ? `${loud.truePeakDbtp?.toFixed(1)} dBTP (batas -1)` : 'tidak terukur',
  });

  // Mismatch penggerak: EV tidak boleh dinilai dengan profil ICE. Sumbernya
  // profil mesin katalog, jadi perbandingan ini tidak menebak.
  const planKinds = new Set((audioPlan?.audioPlan ?? []).map((p) => p.penggerak));
  const engineProfile = audioPlan?.engine?.profile ?? '';
  const profileIsEv = /listrik/i.test(engineProfile);
  const mismatch = planKinds.size === 1 && !planKinds.has(profileIsEv ? 'EV' : 'ICE');
  checks.push({
    name: 'penggerak-konsisten',
    ok: !mismatch,
    detail: mismatch
      ? `rencana menyebut ${[...planKinds].join('/')} tetapi profil mesin "${engineProfile}"`
      : `profil "${engineProfile || 'tidak ada'}" cocok dengan rencana`,
  });

  // Real frames from the finished video, not the source stills: this catches a
  // render that produced black or frozen output.
  const frameDir = path.join(jobDir(ctx.jobId), 'qa-frames');
  fs.mkdirSync(frameDir, { recursive: true });
  const sampled = Math.min(6, Math.max(2, scenes.length));
  // This gate exists to catch a render that came out black or frozen, so it
  // measures "not blank", not photographic crispness: the per-asset gate
  // already judges sharpness of the source stills.
  const MIN_FRAME_SHARPNESS = 2;
  const sharpness: number[] = [];
  const frameHashes: string[] = [];
  for (let i = 0; i < sampled; i++) {
    const at = ((probe.durationSec ?? 2) * (i + 0.5)) / sampled;
    const frame = path.join(frameDir, `frame-${i + 1}.jpg`);
    const ok = extractFrame(render.file, at, frame);
    if (!ok) {
      checks.push({ name: `frame-${i + 1}`, ok: false, detail: 'gagal ambil frame' });
      continue;
    }
    const sharp = frameSharpness(frame, 0);
    sharpness.push(sharp);
    frameHashes.push(perceptualHash(frame, 0));
    checks.push({
      name: `frame-${i + 1}`,
      ok: sharp >= MIN_FRAME_SHARPNESS,
      detail: `ketajaman ${sharp}`,
    });
  }
  const avgSharp = sharpness.length ? sharpness.reduce((a, b) => a + b, 0) / sharpness.length : 0;
  checks.push({
    name: 'tidak-kosong',
    ok: avgSharp >= MIN_FRAME_SHARPNESS,
    detail: `rata-rata ketajaman ${avgSharp.toFixed(1)}`,
  });

  // Identical sampled frames mean the encoder produced a still image for the
  // whole clip, which a blank-frame check alone would not notice.
  const distinct = new Set(frameHashes).size;
  checks.push({
    name: 'tidak-beku',
    ok: frameHashes.length < 2 || distinct >= Math.max(2, Math.ceil(frameHashes.length / 2)),
    detail: `${distinct} dari ${frameHashes.length} frame berbeda`,
  });

  // Critic gerak: mengukur piksel, bukan niat prompt. Ambang dari kebijakan
  // supaya semua job dinilai dengan bar yang sama.
  //
  // Dua tingkat, dan keduanya wajib. Skor seluruh video saja menyesatkan:
  // satu klip dramatis bisa menutupi beberapa scene yang praktis beku, dan itu
  // persis keluhan "videonya seperti slideshow". Jadi setiap klip diukur juga.
  // Kalibrasi: beku 0.06, gerakan terlemah (dolly) 0.37.
  const policy = loadPolicy();
  let motion: ReturnType<typeof measureMotion> | null = null;
  const perClip: { scene: number; key: string; score: number; passed: boolean }[] = [];
  if (policy.requireMotionCritic) {
    try {
      motion = measureMotion(render.file, policy.minMotionScore);
      checks.push({
        name: 'gerakan-terukur',
        ok: motion.passed,
        detail: `skor ${motion.score} (min ${policy.minMotionScore}), global ${motion.globalMotion}, lokal ${motion.localMotion}`,
      });
    } catch (err) {
      checks.push({ name: 'gerakan-terukur', ok: false, detail: `critic gagal: ${(err as Error).message}` });
    }

    const clipsDir = path.join(jobDir(ctx.jobId), 'clips');
    for (const scene of scenes) {
      const clip = path.join(clipsDir, `scene-${String(scene.index + 1).padStart(2, '0')}.mp4`);
      if (!fs.existsSync(clip)) continue;
      try {
        const m = measureMotion(clip, policy.minSceneMotionScore);
        perClip.push({ scene: scene.index, key: scene.key, score: m.score, passed: m.passed });
        checks.push({
          name: `gerakan-scene-${scene.index + 1}`,
          ok: m.passed,
          detail: `${scene.key}: skor ${m.score} (min ${policy.minSceneMotionScore})`,
        });
      } catch (err) {
        checks.push({
          name: `gerakan-scene-${scene.index + 1}`,
          ok: false,
          detail: `critic gagal: ${(err as Error).message}`,
        });
      }
    }
  }

  const assetReport = checkAssets({
    scenes,
    assets,
    options: {
      minWidth: defaults.quality.minWidth,
      minHeight: defaults.quality.minHeight,
      minSharpness: defaults.quality.minSharpness,
      minSharpnessGenerated: defaults.quality.minSharpnessGenerated,
      sceneHashDistance: defaults.quality.sceneHashDistance,
      forbidTextInImage: defaults.quality.forbidTextInImage,
      mode: 'final',
    },
  });

  const failed = checks.filter((c) => !c.ok);
  const report = {
    passed: failed.length === 0,
    checks,
    assets: { passed: assetReport.passed, issues: assetReport.issues },
    motion,
    motionPerScene: perClip,
    video: {
      file: render.file,
      durationSec: probe.durationSec ?? 0,
      width: probe.width ?? 0,
      height: probe.height ?? 0,
      codec: probe.codec ?? '',
    },
    checkedAt: new Date().toISOString(),
  };
  writeOwned(ctx, 'qa.json', report);

  if (failed.length) {
    throw new PermanentError(
      `QA menolak hasil: ${failed.map((f) => `${f.name} (${f.detail})`).join('; ')}`,
    );
  }
  await ctx.log('info', 'QA menyetujui hasil', { checks: checks.length });
  return report;
});

export { artifactPath, frameSharpness };
