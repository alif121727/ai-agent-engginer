import fs from 'node:fs';
import path from 'node:path';
import { guardArtifactWrite, guardTool, PermanentError, type AgentContext, type Tool } from './guard.ts';
import { artifactPath } from './guard.ts';
import { loadThemes, loadDefaults, loadAdapters } from '../core/config.ts';
import { pickTheme } from '../core/theme.ts';
import { planScenes, estimateCost } from '../pipeline/scenes.ts';
import { resolveSceneAsset } from '../visuals/index.ts';
import type { AssetRecord, Brief, ScenePlan } from '../core/types.ts';
import { resolveDuration } from '../core/brief.ts';
import { jobDir } from '../core/fsx.ts';
import { checkAssets } from '../pipeline/quality.ts';
import { ffprobe, contactSheet, frameSharpness } from '../render/ffmpeg.ts';
import { markSceneDone, readSceneCheckpoint, markStageComplete } from '../pipeline/checkpoint.ts';

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
  const themes = loadThemes();
  const theme = pickTheme(brief.model, themes.themes, themes.defaultTheme);
  const scenes = planScenes({ brief, durationSec, theme, aspect: brief.rasio ?? '16:9' });
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

tool('write_research', 'Tulis data riset dari brief', async (_args, ctx) => {
  const brief = ctx.brief as unknown as Brief;
  const research = {
    model: brief.model,
    specs: (brief.keunggulan ?? []).map((item) => ({ text: item, source: 'brief' })),
    missing: (brief.keunggulan ?? []).length === 0 ? ['keunggulan kosong di brief'] : [],
    note: 'semua angka berasal dari brief, tidak ada yang dikarang',
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
  const themes = loadThemes();
  const theme = pickTheme(brief.model, themes.themes, themes.defaultTheme);
  const scenes = planScenes({ brief, durationSec, theme, aspect: brief.rasio ?? '16:9' });
  const specs = research?.specs ?? [];
  const script = {
    model: brief.model,
    tagline: brief.tagline ?? '',
    lines: scenes.map((scene, i) => ({
      sceneIndex: scene.index,
      onScreenText: scene.onScreenText,
      voiceover: voiceoverFor(scene.key, brief, specs, i),
    })),
  };
  writeOwned(ctx, 'script.json', script);
  return script;
});

function voiceoverFor(
  key: string,
  brief: Brief,
  specs: { text: string }[],
  index: number,
): string {
  const spec = specs[index % Math.max(1, specs.length)]?.text ?? '';
  switch (key) {
    case 'hook':
      return brief.tagline ? `${brief.model}. ${brief.tagline}.` : `${brief.model}.`;
    case 'exterior':
      return `Ini ${brief.model}, dilihat dari setiap sudut.`;
    case 'features':
      return spec ? `Salah satu andalannya: ${spec}.` : `Detail ${brief.model} yang membuatnya berbeda.`;
    case 'interior':
      return `Masuk ke kabin, semua tersusun untuk pengemudi.`;
    case 'action':
      return spec ? `Di jalan, ${spec}.` : `Saat jalanan terbuka, karakter aslinya terlihat.`;
    case 'cta':
      return brief.tagline ? `${brief.model}. ${brief.tagline}.` : `${brief.model}.`;
    default:
      return spec ? `${spec}.` : `Detail ${brief.model}.`;
  }
}

// -------------------------------------------------------- storyboard tools

tool('read_script', 'Baca naskah', async (_args, ctx) => ctx.readArtifact('script.json'));

tool('write_storyboard', 'Tulis storyboard per scene', async (_args, ctx) => {
  const brief = ctx.brief as unknown as Brief;
  const defaults = loadDefaults();
  const { durationSec } = resolveDuration(brief, defaults.minDurasi, defaults.maxDurasi);
  const themes = loadThemes();
  const theme = pickTheme(brief.model, themes.themes, themes.defaultTheme);
  const scenes = planScenes({ brief, durationSec, theme, aspect: brief.rasio ?? '16:9' });
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
  const themes = loadThemes();
  const theme = pickTheme(brief.model, themes.themes, themes.defaultTheme);
  const outDir = path.join(jobDir(ctx.jobId), 'assets');
  const done = new Set(readSceneCheckpoint(ctx.jobId, 'aset-visual').done);
  const existing = ctx.readArtifact<AssetRecord[]>('assets.json') ?? [];
  // Only keep records whose scene is still checkpointed; a rewind regenerates the rest.
  const assets: AssetRecord[] = existing.filter((a) => done.has(a.sceneIndex));

  const order = wantVideo
    ? ['local', 'video-gen', 'image-gen', 'stock-api']
    : defaults.visualAdapters;

  for (const scene of scenes) {
    if (done.has(scene.index)) continue;
    ctx.assertOnline();
    await ctx.setStageMessage(`scene ${scene.index + 1}/${scenes.length}`);
    const { result, attempts } = await resolveSceneAsset({
      order,
      defs: adapters.adapters,
      request: { scene, theme, model: brief.model, aspect: brief.rasio ?? '16:9', outDir },
    });
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
    await ctx.setStageProgress(Math.round(((done.size + 1) / scenes.length) * 100));
  }
  const missing = scenes.filter((s) => !assets.some((a) => a.sceneIndex === s.index));
  if (missing.length) {
    const configured = defaults.visualAdapters.filter((id) => {
      const def = adapters.adapters[id];
      return def && (!def.envKey || process.env[def.envKey]);
    });
    throw new PermanentError(
      `${missing.length} dari ${scenes.length} scene belum punya aset realistis. ` +
        `Adapter siap: ${configured.join(', ') || 'tidak ada'}. ` +
        `Unggah foto ke assets/own/${brief.model.replace(/[^a-zA-Z0-9]+/g, '-').toLowerCase()}/ ` +
        `atau set kunci API generator di Pengaturan.`,
    );
  }
  markStageComplete(ctx.jobId, 'aset-visual');
  return assets;
}

tool('generate_image', 'Hasilkan keyframe per scene', async (_args, ctx) => generateAssets(ctx, false));
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
  const themes = loadThemes();
  const brief = ctx.brief as unknown as Brief;
  const theme = pickTheme(brief.model, themes.themes, themes.defaultTheme);
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

tool('synthesize_speech', 'Siapkan rencana TTS', async (args, ctx) => {
  const text = String(args.text ?? '');
  return { text, engine: process.env.TTS_ENGINE ?? 'belum-dikonfigurasi' };
});

tool('write_audio_plan', 'Tulis rencana audio dan subtitle', async (_args, ctx) => {
  const script = ctx.readArtifact<{ lines: { sceneIndex: number; voiceover: string; onScreenText: string }[] }>(
    'script.json',
  );
  const scenes = scenesFrom(ctx);
  const plan = {
    loudnessLufs: -14,
    music: { ducking: true, gain: -18 },
    sfx: scenes.map((scene) => ({
      sceneIndex: scene.index,
      bed: scene.key === 'action' ? 'engine-rev' : scene.key === 'interior' ? 'cabin-ambience' : 'studio-room',
    })),
    subtitles: (script?.lines ?? []).map((line) => ({
      sceneIndex: line.sceneIndex,
      text: line.voiceover,
    })),
    ttsAvailable: Boolean(process.env.TTS_API_KEY),
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

tool('approve_job', 'Setujui hasil akhir', async (_args, ctx) => {
  await ctx.log('info', 'QA menyetujui hasil');
  return { approved: true };
});

export { artifactPath, frameSharpness };
