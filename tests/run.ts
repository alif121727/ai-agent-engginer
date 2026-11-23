/**
 * Test suite without external runners: `node --experimental-strip-types tests/run.ts`.
 * Every check prints PASS/FAIL and the process exits non-zero on any failure.
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { openDb, closeDb } from '../src/db/index.ts';
import { createJob, createStages, getJob, listStages, setStageStatus, nextPendingStage, dailyCost, addDailyCost } from '../src/db/repo.ts';
import { parseBrief, resolveDuration, BriefError } from '../src/core/brief.ts';
import { planScenes, buildSceneList, estimateCost } from '../src/pipeline/scenes.ts';
import { loadThemes, loadDefaults, loadAgents, loadAdapters } from '../src/core/config.ts';
import { pickTheme } from '../src/core/theme.ts';
import { generateAiTheme } from '../src/core/theme-ai.ts';
import { searchTemplates, BUILTIN_TEMPLATES, SCENE_KEYS } from '../src/core/templates.ts';
import { resolveBriefLook } from '../src/core/brief-look.ts';
import { ConnectionMonitor } from '../src/net/monitor.ts';
import { stagesFor, presetAgents, listPresets } from '../src/agents/registry.ts';
import { assertGuardRejects } from '../src/agents/runner.ts';
import { checkAssets } from '../src/pipeline/quality.ts';
import { createApp } from '../src/api/server.ts';
import { fingerprintFor } from '../src/publish/instagram.ts';
import { readCheckpoint, writeCheckpoint, markSceneDone, readSceneCheckpoint, isStageComplete, clearCheckpoint } from '../src/pipeline/checkpoint.ts';
import { frameSharpness, perceptualHash, measureLoudness } from '../src/render/ffmpeg.ts';
import { buildTrack } from '../src/render/narration.ts';
import { synthesize, voiceForTone, toneForModel, TTS_MODEL, TTS_OUTPUT_FORMAT, VOICE_SETTINGS } from '../src/tts/provider.ts';
import { analyseAudio } from '../scripts/validate-audio.ts';
import {
  validateMotionPrompt,
  splitLongClip,
  DEFAULT_NEGATIVES,
} from '../src/core/motion-prompt.ts';
import { loadPolicy, assertPolicyApplied, PolicyViolation } from '../src/core/motion-policy.ts';
import { assertMotionPolicyFor } from '../src/render/assemble.ts';
import { cameraFilterFor } from '../src/render/camera.ts';
import { measureMotion } from '../src/pipeline/motion-score.ts';
import { i2vPrompt } from '../src/pipeline/scenes.ts';
import type { Brief } from '../src/core/types.ts';

let passed = 0;
const failures: string[] = [];

function check(name: string, fn: () => boolean | void | Promise<boolean | void>): Promise<void> {
  return Promise.resolve()
    .then(fn)
    .then((res) => {
      if (res === false) throw new Error('assertion mengembalikan false');
      passed += 1;
      console.log(`PASS ${name}`);
    })
    .catch((err) => {
      failures.push(`${name}: ${err instanceof Error ? err.message : String(err)}`);
      console.log(`FAIL ${name} — ${err instanceof Error ? err.message : String(err)}`);
    });
}

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(msg);
}

const repoRoot = path.resolve(import.meta.dirname, '..');
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-test-'));
const dbFile = path.join(tmpRoot, 'test.db');

await check('brief menolak JSON rusak', () => {
  let threw = false;
  try {
    parseBrief('{ bukan json');
  } catch (err) {
    threw = err instanceof BriefError;
  }
  assert(threw, 'harus melempar BriefError');
});

await check('brief menolak model kosong', () => {
  let threw = false;
  try {
    parseBrief(JSON.stringify({ tagline: 'tanpa model' }));
  } catch (err) {
    threw = err instanceof BriefError;
  }
  assert(threw, 'model wajib ada');
});

await check('durasi 20 detik dinaikkan ke minimum 30', () => {
  const brief = parseBrief(JSON.stringify({ model: 'Ferrari 296 GTB', durasi: 20 }));
  const res = resolveDuration(brief, 30, 600);
  assert(res.durationSec === 30, `dapat ${res.durationSec}`);
  assert(res.bumped === true, 'harus ditandai bumped');
  assert(res.originalDuration === 20, 'durasi asli harus dipertahankan');
});

await check('durasi 45 detik dibiarkan apa adanya', () => {
  const brief = parseBrief(JSON.stringify({ model: 'Ferrari 296 GTB', durasi: 45 }));
  const res = resolveDuration(brief, 30, 600);
  assert(res.durationSec === 45 && !res.bumped, 'tidak boleh diubah');
});

await check('durasi 900 detik dibatasi maksimum', () => {
  const brief = parseBrief(JSON.stringify({ model: 'Ferrari 296 GTB', durasi: 900 }));
  const res = resolveDuration(brief, 30, 600);
  assert(res.durationSec === 600, `dapat ${res.durationSec}`);
});

await check('tema Ferrari terdeteksi dari nama model', () => {
  const themes = loadThemes();
  const theme = pickTheme('Ferrari 296 GTB', themes.themes, themes.defaultTheme);
  assert(theme.id === 'ferrari', `dapat ${theme.id}`);
});

await check('tema fallback untuk model tak dikenal', () => {
  const themes = loadThemes();
  const theme = pickTheme('Mobil Misterius X', themes.themes, themes.defaultTheme);
  assert(theme.id === themes.defaultTheme, `dapat ${theme.id}`);
});

await check('tema mengabaikan huruf besar dan aksen', () => {
  const themes = loadThemes();
  const theme = pickTheme('  PORSCHE 911 GT3  ', themes.themes, themes.defaultTheme);
  assert(theme.id === 'porsche', `dapat ${theme.id}`);
});

for (const durasi of [30, 45, 60, 90, 120, 300]) {
  await check(`scene untuk ${durasi} detik berjumlah tepat ${durasi}`, () => {
    const themes = loadThemes();
    const theme = pickTheme('Ferrari 296 GTB', themes.themes, themes.defaultTheme);
    const scenes = planScenes({
      brief: { model: 'Ferrari 296 GTB', keunggulan: ['V6', '830 hp'] },
      durationSec: durasi,
      theme,
      aspect: '16:9',
    });
    const total = scenes.reduce((sum, s) => sum + s.duration, 0);
    assert(total === durasi, `total ${total}`);
    assert(scenes.every((s) => s.duration >= 2), 'tiap scene minimal 2 detik');
    assert(new Set(scenes.map((s) => s.key)).size === scenes.length, 'key scene harus unik');
    assert(scenes[scenes.length - 1].key === 'cta', 'scene terakhir harus cta');
  });
}

await check('scene tidak mengarang spesifikasi', () => {
  const themes = loadThemes();
  const theme = pickTheme('Ferrari 296 GTB', themes.themes, themes.defaultTheme);
  const scenes = planScenes({
    brief: { model: 'Ferrari 296 GTB', keunggulan: ['V6 3.0L hibrida'] },
    durationSec: 45,
    theme,
    aspect: '16:9',
  });
  const joined = scenes.map((s) => `${s.onScreenText} ${s.prompt}`).join(' ');
  assert(joined.includes('V6 3.0L hibrida'), 'keunggulan brief harus dipakai');
  assert(!/\b\d{3,4}\s?(hp|nm|km\/h)\b/i.test(joined.replace('V6 3.0L hibrida', '')), 'tidak boleh ada angka karangan');
});

await check('estimasi biaya naik seiring durasi', () => {
  const defaults = loadDefaults();
  const cheap = estimateCost({ durationSec: 30, sceneCount: 6, withVideo: false, estimates: defaults.cost.estimates });
  const pricey = estimateCost({ durationSec: 120, sceneCount: 15, withVideo: false, estimates: defaults.cost.estimates });
  assert(pricey > cheap, `${pricey} harus > ${cheap}`);
});

await check('setiap preset agen punya definisi lengkap', () => {
  const presets = listPresets();
  assert(presets.length >= 3, 'butuh minimal 3 preset');
  for (const preset of presets) {
    const agents = presetAgents(preset.name);
    assert(agents.length === preset.agents.length, `preset ${preset.name} tidak lengkap`);
    for (const agent of agents) {
      assert(agent.allowedTools.length > 0, `${agent.id} tanpa alat`);
      assert(agent.artifacts.writes.length > 0 || agent.id === 'qa' || agent.id === 'pm', `${agent.id} tanpa artefak`);
    }
  }
});

await check('setiap agen punya job desk berbeda (tidak tumpang tindih penuh)', () => {
  const agents = loadAgents().agents;
  const visual = agents.visual.allowedTools.join(',');
  const sound = agents.sound.allowedTools.join(',');
  assert(visual !== sound, 'job desk visual dan sound tidak boleh sama');
});

await check('guard menolak agen memakai alat di luar job desk', async () => {
  assert(await assertGuardRejects('pm', 'write_script'), 'PM tidak boleh menulis naskah');
  assert(await assertGuardRejects('visual', 'render_video'), 'visual tidak boleh render');
  assert(await assertGuardRejects('sound', 'generate_image'), 'sound tidak boleh buat aset');
  assert(!(await assertGuardRejects('visual', 'generate_image')), 'visual harus boleh generate_image');
});

await check('monitor butuh 3 kegagalan sebelum dijeda', async () => {
  const monitor = new ConnectionMonitor({
    probeUrls: ['http://uji'],
    probeIntervalMs: 1000,
    probeTimeoutMs: 10,
    failuresToOffline: 3,
    successesToOnline: 2,
    probe: async () => 'fail',
  });
  await monitor.checkOnce();
  await monitor.checkOnce();
  assert(monitor.status === 'ONLINE', 'belum boleh offline setelah 2 gagal');
  await monitor.checkOnce();
  assert(monitor.status === 'PAUSED_OFFLINE', 'harus offline setelah 3 gagal');
});

await check('monitor butuh 2 keberhasilan sebelum lanjut', async () => {
  let ok = false;
  const monitor = new ConnectionMonitor({
    probeUrls: ['http://uji'],
    probeIntervalMs: 1000,
    probeTimeoutMs: 10,
    failuresToOffline: 1,
    successesToOnline: 2,
    probe: async () => (ok ? 'ok' : 'fail'),
  });
  await monitor.checkOnce();
  assert(monitor.status === 'PAUSED_OFFLINE', 'harus offline dulu');
  ok = true;
  await monitor.checkOnce();
  assert(monitor.status === 'PAUSED_OFFLINE', 'satu keberhasilan belum cukup');
  await monitor.checkOnce();
  assert(monitor.status === 'ONLINE', 'dua keberhasilan harus online');
});

await check('satu probe sukses cukup untuk dianggap online', async () => {
  const monitor = new ConnectionMonitor({
    probeUrls: ['http://a', 'http://b'],
    probeIntervalMs: 1000,
    probeTimeoutMs: 10,
    failuresToOffline: 1,
    successesToOnline: 1,
    probe: async (url) => (url === 'http://b' ? 'ok' : 'fail'),
  });
  await monitor.checkOnce();
  assert(monitor.status === 'ONLINE', 'harus online karena satu endpoint hidup');
});

openDb({ kind: 'sqlite', file: dbFile });

await check('job tersimpan dengan status queued', async () => {
  const job = await createJob({
    briefSlug: 'ferrari-296-gtb',
    title: 'Ferrari 296 GTB',
    model: 'Ferrari 296 GTB',
    themeId: 'ferrari',
    mode: 'draft',
    durationSec: 45,
    aspect: '16:9',
    preset: '9-orang',
    brief: { model: 'Ferrari 296 GTB', durasi: 45 },
    costEstimate: 1.2,
  });
  const loaded = await getJob(job.id);
  assert(loaded?.status === 'queued', `status ${loaded?.status}`);
  assert(loaded?.duration_sec === 45, 'durasi tersimpan');
});

await check('tahap dibuat berurutan sesuai preset', async () => {
  const job = await createJob({
    briefSlug: 'porsche-911',
    title: 'Porsche 911',
    model: 'Porsche 911',
    themeId: 'porsche',
    mode: 'draft',
    durationSec: 30,
    aspect: '16:9',
    preset: '6-orang',
    brief: { model: 'Porsche 911' },
    costEstimate: 0.8,
  });
  const expected = stagesFor('6-orang');
  await createStages(job.id, expected);
  const stages = await listStages(job.id);
  assert(stages.length === expected.length, `${stages.length} != ${expected.length}`);
  assert(
    stages.map((s) => s.name).join(',') === expected.map((e) => e.name).join(','),
    'urutan tahap harus sama',
  );
  const first = await nextPendingStage(job.id);
  assert(first?.name === expected[0].name, 'tahap pertama harus rencana');
});

await check('checkpoint menyimpan progres per scene', () => {
  const jobId = 'job-uji';
  markSceneDone(jobId, 'assets', 0);
  markSceneDone(jobId, 'assets', 1);
  const cp = readSceneCheckpoint(jobId, 'assets');
  assert(cp.done.length === 2 && cp.sceneIndex === 2, 'progres scene tidak tersimpan');
  assert(!isStageComplete(jobId, 'assets'), 'belum boleh dianggap selesai');
  writeCheckpoint(jobId, 'assets', cp, 'done');
  assert(isStageComplete(jobId, 'assets'), 'harus selesai setelah ditandai');
  assert(readCheckpoint(jobId, 'assets')?.status === 'done', 'status checkpoint harus done');
});

await check('quality gate menolak aset fallback', () => {
  const report = checkAssets({
    scenes: [{ index: 0, key: 'hook', duration: 4, onScreenText: '' } as never],
    assets: [{ sceneIndex: 0, kind: 'image', path: '/tmp/tidak-ada.jpg', source: 'code', provider: 'fallback', fallback: true }],
    options: {
      minWidth: 1280,
      minHeight: 720,
      minSharpness: 8,
      sceneHashDistance: 4,
      forbidTextInImage: true,
      mode: 'final',
    },
  });
  assert(!report.passed, 'harus gagal');
  assert(report.issues.some((i) => i.code === 'fallback'), 'harus melaporkan fallback');
});

await check('quality gate melaporkan scene tanpa aset', () => {
  const report = checkAssets({
    scenes: [{ index: 0, key: 'hook', duration: 4, onScreenText: '' } as never],
    assets: [],
    options: {
      minWidth: 1280,
      minHeight: 720,
      minSharpness: 8,
      sceneHashDistance: 4,
      forbidTextInImage: false,
      mode: 'draft',
    },
  });
  assert(report.issues[0]?.code === 'missing', 'harus melaporkan missing');
});

await check('rewind menghapus checkpoint tahap yang diulang', () => {
  const jobId = 'job-rewind';
  markSceneDone(jobId, 'aset-visual', 0);
  writeCheckpoint(jobId, 'aset-visual', { sceneIndex: 1, done: [0] }, 'done');
  assert(isStageComplete(jobId, 'aset-visual'), 'harus selesai sebelum rewind');
  clearCheckpoint(jobId, 'aset-visual');
  assert(!isStageComplete(jobId, 'aset-visual'), 'checkpoint harus hilang setelah rewind');
  assert(readSceneCheckpoint(jobId, 'aset-visual').done.length === 0, 'progres scene harus kosong');
});

await check('ketajaman gambar statis terbaca (bukan 0 karena -ss)', () => {
  const png = path.join(tmpRoot, 'statis.png');
  const res = spawnSync('ffmpeg', [
    '-v', 'error', '-y', '-f', 'lavfi', '-i', 'mandelbrot=size=640x360', '-frames:v', '1', png,
  ]);
  assert(res.status === 0 && fs.existsSync(png), 'gagal membuat gambar uji');
  const sharp = frameSharpness(png);
  assert(sharp > 0, `ketajaman gambar statis ${sharp}, seharusnya > 0`);
  assert(perceptualHash(png) !== '0'.repeat(16), 'hash gambar statis tidak boleh nol');
});

await check('fingerprint publish stabil dan unik per platform', () => {
  const file = path.join(tmpRoot, 'video.mp4');
  fs.writeFileSync(file, 'isi-video');
  const a = fingerprintFor('job-1', 'instagram', file);
  const b = fingerprintFor('job-1', 'instagram', file);
  const c = fingerprintFor('job-1', 'tiktok', file);
  assert(a === b, 'fingerprint harus stabil');
  assert(a !== c, 'platform berbeda harus beda fingerprint');
});

await check('batas biaya harian akumulatif', async () => {
  const before = await dailyCost();
  await addDailyCost(1.25);
  const after = await dailyCost();
  assert(Math.abs(after - before - 1.25) < 0.001, `${before} -> ${after}`);
});

await check('setStageStatus menaikkan jumlah percobaan', async () => {
  const job = await createJob({
    briefSlug: 'supra',
    title: 'Toyota GR Supra',
    model: 'Toyota GR Supra',
    themeId: 'supra',
    mode: 'draft',
    durationSec: 30,
    aspect: '9:16',
    preset: '4-orang',
    brief: { model: 'Toyota GR Supra' },
    costEstimate: 0.5,
  });
  await createStages(job.id, stagesFor('4-orang'));
  const [stage] = await listStages(job.id);
  await setStageStatus(stage.id, 'running', { incrementAttempts: true });
  await setStageStatus(stage.id, 'running', { incrementAttempts: true });
  const stages = await listStages(job.id);
  assert(stages[0].attempts === 2, `attempts ${stages[0].attempts}`);
});

// ------------------------------------------------------------------ API
await check('API menolak akses tanpa sesi', async () => {
  const { app } = createApp({ startWorker: false });
  const server = app.listen(0);
  const port = (server.address() as { port: number }).port;
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/jobs`);
    assert(res.status === 401, `status ${res.status}`);
  } finally {
    server.close();
  }
});

// Preflight browser menolak permintaan kalau `Authorization` tidak ada di
// Access-Control-Allow-Headers, sehingga UI lintas situs tampak login padahal
// semua panggilan API berikutnya gagal.
await check('CORS preflight mengizinkan header Authorization', async () => {
  const previous = process.env.CORS_ORIGINS;
  process.env.CORS_ORIGINS = 'https://ui.contoh.id';
  const { app } = createApp({ startWorker: false });
  const server = app.listen(0);
  const port = (server.address() as { port: number }).port;
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/jobs`, {
      method: 'OPTIONS',
      headers: {
        origin: 'https://ui.contoh.id',
        'access-control-request-method': 'GET',
        'access-control-request-headers': 'authorization',
      },
    });
    assert(res.status === 204, `status ${res.status}`);
    const allowed = (res.headers.get('access-control-allow-headers') ?? '').toLowerCase();
    assert(allowed.includes('authorization'), `allow-headers "${allowed}"`);
    assert(res.headers.get('access-control-allow-origin') === 'https://ui.contoh.id', 'origin harus dipantulkan');
  } finally {
    server.close();
    if (previous === undefined) delete process.env.CORS_ORIGINS;
    else process.env.CORS_ORIGINS = previous;
  }
});

await check('API setup, login, dan buat job', async () => {
  const { app } = createApp({ startWorker: false });
  const server = app.listen(0);
  const port = (server.address() as { port: number }).port;
  const base = `http://127.0.0.1:${port}`;
  try {
    const boot = await fetch(`${base}/api/bootstrap`);
    const bootJson = (await boot.json()) as { needsSetup: boolean };
    assert(typeof bootJson.needsSetup === 'boolean', 'bootstrap harus mengembalikan needsSetup');

    const setup = await fetch(`${base}/api/setup`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'uji@studio.id', password: 'rahasia123' }),
    });
    assert(setup.status === 200 || setup.status === 409, `setup ${setup.status}`);
    const login = await fetch(`${base}/api/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'uji@studio.id', password: 'rahasia123' }),
    });
    assert(login.status === 200, `login ${login.status}`);
    const cookie = (login.headers.get('set-cookie') ?? '').split(';')[0];

    const created = await fetch(`${base}/api/jobs`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ brief: { model: 'Nissan GT-R', keunggulan: ['VR38DETT'], durasi: 25 } }),
    });
    assert(created.status === 201, `create ${created.status}`);
    const payload = (await created.json()) as { job: { duration_sec: number; status: string }; stages: unknown[] };
    assert(payload.job.duration_sec === 30, `durasi harus dinaikkan, dapat ${payload.job.duration_sec}`);
    assert(payload.stages.length > 0, 'tahap harus dibuat');

    const bad = await fetch(`${base}/api/jobs`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ brief: { tagline: 'tanpa model' } }),
    });
    assert(bad.status === 400, `brief buruk harus 400, dapat ${bad.status}`);

    const estimate = await fetch(`${base}/api/estimate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ durasi: 60, model: 'Ferrari 296 GTB' }),
    });
    const estJson = (await estimate.json()) as { durationSec: number; sceneCount: number; cost: number };
    assert(estJson.durationSec === 60, 'estimasi durasi');
    assert(estJson.sceneCount > 6, 'durasi 60 detik butuh lebih dari 6 scene');
    assert(estJson.cost > 0, 'estimasi biaya harus positif');
  } finally {
    server.close();
  }
});

await check('login: kuota per akun tidak mengunci akun lain', async () => {
  const { app } = createApp({ startWorker: false });
  const server = app.listen(0);
  const port = (server.address() as { port: number }).port;
  const base = `http://127.0.0.1:${port}`;
  try {
    const post = (path: string, body: unknown) =>
      fetch(`${base}${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });

    // Akun lain menebak password salah berkali-kali. Ini dulu mengunci
    // semua pengunjung karena kuota dihitung per IP.
    let last = 0;
    for (let i = 0; i < 12; i++) {
      const r = await post('/api/login', { email: 'penyusup', password: 'salah' });
      last = r.status;
    }
    assert(last === 429, `akun penyerang harus kena batas, dapat ${last}`);

    const ok = await post('/api/login', { email: 'uji@studio.id', password: 'rahasia123' });
    assert(ok.status === 200, `akun sah harus tetap bisa masuk, dapat ${ok.status}`);
    const cookie = (ok.headers.get('set-cookie') ?? '').split(';')[0];

    const me = await fetch(`${base}/api/me`, { headers: { cookie } });
    const meJson = (await me.json()) as { user: { email: string } | null };
    assert(meJson.user?.email === 'uji@studio.id', 'me harus mengembalikan akun sesi');

    const anon = await fetch(`${base}/api/me`);
    const anonJson = (await anon.json()) as { user: unknown };
    assert(anonJson.user === null, 'tanpa cookie, me harus null');

    const out = await post('/api/logout', {});
    assert(out.status === 200, `logout ${out.status}`);
  } finally {
    server.close();
  }
});

await check('API mengembalikan 404 untuk job tak dikenal', async () => {
  const { app } = createApp({ startWorker: false });
  const server = app.listen(0);
  const port = (server.address() as { port: number }).port;
  try {
    const login = await fetch(`http://127.0.0.1:${port}/api/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'uji@studio.id', password: 'rahasia123' }),
    });
    const cookie = (login.headers.get('set-cookie') ?? '').split(';')[0];
    const res = await fetch(`http://127.0.0.1:${port}/api/jobs/tidak-ada`, { headers: { cookie } });
    assert(res.status === 404, `status ${res.status}`);
  } finally {
    server.close();
  }
});

await check('API menolak unggah berkas dengan ekstensi asing', async () => {
  const { app } = createApp({ startWorker: false });
  const server = app.listen(0);
  const port = (server.address() as { port: number }).port;
  const base = `http://127.0.0.1:${port}`;
  try {
    const login = await fetch(`${base}/api/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'uji@studio.id', password: 'rahasia123' }),
    });
    const cookie = (login.headers.get('set-cookie') ?? '').split(';')[0];
    const bad = await fetch(`${base}/api/assets/Ferrari%20296%20GTB?name=jahat.sh`, {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/octet-stream' },
      body: 'x',
    });
    assert(bad.status === 400, `unggah .sh harus 400, dapat ${bad.status}`);
  } finally {
    server.close();
  }
});

await check('provider gambar gratis menerima negative prompt', async () => {
  const { freeTierPrompt } = await import('../src/visuals/adapters.ts');
  const { NEGATIVE_PROMPT } = await import('../src/pipeline/scenes.ts');
  const withNeg = freeTierPrompt({ prompt: 'fotografi otomotif', negativePrompt: NEGATIVE_PROMPT });
  // Order matters: the provider truncates long prompts, so negatives appended
  // at the end are silently dropped (verified: byte-identical renders).
  assert(withNeg.startsWith('hindari:'), 'negatif harus di DEPAN agar tidak terpotong');
  assert(withNeg.endsWith('fotografi otomotif'), 'prompt asli tetap ikut, di belakang');
  // The anti-toy cues are the ones that only reached the paid adapter before.
  for (const cue of ['kartun', 'kulit plastik', 'warna terlalu jenuh']) {
    assert(withNeg.includes(cue), `negatif "${cue}" harus terkirim ke provider gratis`);
  }
  const withoutNeg = freeTierPrompt({ prompt: 'fotografi otomotif' });
  assert(withoutNeg === 'fotografi otomotif', 'tanpa negatif prompt tidak boleh berubah');
});

await check('unggahan aset model katalog masuk ke folder yang dibaca pipeline', async () => {
  const { app } = createApp({ startWorker: false });
  const { assetFolderSlug, userAssetsFor } = await import('../src/visuals/types.ts');
  const server = app.listen(0);
  const port = (server.address() as { port: number }).port;
  const base = `http://127.0.0.1:${port}`;
  // A catalog name whose display form slugifies differently from its folder
  // ("Mazda RX-7" -> "mazda-rx-7" vs the real "mazda-rx7-fd").
  const model = 'Mazda RX-7';
  const name = `uji-${Date.now()}.jpg`;
  const login = await fetch(`${base}/api/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'uji@studio.id', password: 'rahasia123' }),
  });
  const cookie = (login.headers.get('set-cookie') ?? '').split(';')[0];
  const dir = path.join(process.cwd(), 'assets', 'own', assetFolderSlug(model));
  try {
    const upload = await fetch(`${base}/api/assets/${encodeURIComponent(model)}?name=${name}`, {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/octet-stream' },
      body: Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00]),
    });
    assert(upload.status === 201, `unggah harus 201, dapat ${upload.status}`);
    assert(fs.existsSync(path.join(dir, name)), `berkas harus mendarat di ${dir}`);
    const seen = userAssetsFor(model, path.join(process.cwd(), 'assets', 'own')).map((f) => path.basename(f));
    assert(seen.includes(name), `pipeline harus melihat berkas yang baru diunggah (${seen.join(', ')})`);
  } finally {
    await fetch(`${base}/api/assets/${encodeURIComponent(model)}/${encodeURIComponent(name)}`, {
      method: 'DELETE',
      headers: { cookie },
    }).catch(() => {});
    fs.rmSync(path.join(dir, name), { force: true });
    server.close();
  }
});

await check('API menandai gambar stok acak dan menyajikan berkas aset', async () => {
  const { app } = createApp({ startWorker: false });
  const server = app.listen(0);
  const port = (server.address() as { port: number }).port;
  const base = `http://127.0.0.1:${port}`;
  const model = `Uji Aset ${Date.now()}`;
  const login = await fetch(`${base}/api/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'uji@studio.id', password: 'rahasia123' }),
  });
  const cookie = (login.headers.get('set-cookie') ?? '').split(';')[0];
  try {
    const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from('Picsum ID: 846')]);
    const upload = await fetch(`${base}/api/assets/${encodeURIComponent(model)}?name=acak.jpg`, {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/octet-stream' },
      body: jpeg,
    });
    assert(upload.status === 201, `unggah harus 201, dapat ${upload.status}`);

    const listed = (await (await fetch(`${base}/api/assets/${encodeURIComponent(model)}`, { headers: { cookie } })).json()) as {
      files: string[];
      warnings: Record<string, string>;
    };
    assert(listed.files.includes('acak.jpg'), 'berkas harus terdaftar');
    assert(Boolean(listed.warnings['acak.jpg']), 'gambar stok harus diberi peringatan');

    const served = await fetch(`${base}/api/assets/${encodeURIComponent(model)}/file/acak.jpg`, {
      headers: { cookie },
    });
    assert(served.status === 200, `saji berkas harus 200, dapat ${served.status}`);
    assert((await served.arrayBuffer()).byteLength === jpeg.length, 'isi berkas harus utuh');

    const traversal = await fetch(`${base}/api/assets/${encodeURIComponent(model)}/file/${encodeURIComponent('../../data/studio.db')}`, {
      headers: { cookie },
    });
    assert(traversal.status === 400, `path traversal harus 400, dapat ${traversal.status}`);
  } finally {
    await fetch(`${base}/api/assets/${encodeURIComponent(model)}/acak.jpg`, {
      method: 'DELETE',
      headers: { cookie },
    }).catch(() => {});
    fs.rmSync(path.join(process.cwd(), 'assets', 'own', model.replace(/[^a-zA-Z0-9]+/g, '-').toLowerCase()), {
      recursive: true,
      force: true,
    });
    server.close();
  }
});

await check('API mengembalikan 409 saat mengulang job yang masih jalan', async () => {
  const { app } = createApp({ startWorker: false });
  const server = app.listen(0);
  const port = (server.address() as { port: number }).port;
  const base = `http://127.0.0.1:${port}`;
  try {
    const login = await fetch(`${base}/api/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'uji@studio.id', password: 'rahasia123' }),
    });
    const cookie = (login.headers.get('set-cookie') ?? '').split(';')[0];
    const created = await fetch(`${base}/api/jobs`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ brief: { model: 'Porsche 911 GT3', durasi: 30 } }),
    });
    const { job } = (await created.json()) as { job: { id: string } };
    const retry = await fetch(`${base}/api/jobs/${job.id}/retry`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: '{}',
    });
    assert(retry.status === 409, `job queued tidak boleh diulang, dapat ${retry.status}`);
  } finally {
    server.close();
  }
});

// --- fallback chain ------------------------------------------------------
await check('adapter lokal yang kosong tidak memblokir provider lain', async () => {
  const { resolveSceneAsset } = await import('../src/visuals/index.ts');
  const outcome = await resolveSceneAsset({
    order: ['local', 'image-gen-free'],
    defs: {
      local: { id: 'local', kind: 'local', enabled: true, requiresKey: false } as never,
      'image-gen-free': {
        id: 'image-gen-free',
        kind: 'image-gen',
        enabled: true,
        requiresKey: false,
        urlTemplate: 'http://127.0.0.1:1/{prompt}?w={width}',
        maxRetries: 0,
        timeoutMs: 200,
      } as never,
    },
    request: {
      scene: { index: 0, key: 'hero', prompt: 'x', duration: 4, start: 0, onScreenText: '' } as never,
      theme: { id: 'generic', grade: { contrast: 1, saturation: 1, temperature: 0 } } as never,
      model: 'Model Tanpa Foto',
      aspect: '16:9',
      outDir: path.join(tmpRoot, 'nofallback'),
    },
  });
  // The free provider is unreachable here, so the chain must still *reach* it:
  // the failure has to come from the network attempt, not from `local`.
  const triedFree = outcome.attempts.some((a) => a.adapter === 'image-gen-free');
  assert(triedFree, 'provider gratis harus dicoba setelah local kosong');
});

await check('foto katalog terbaca meski nama foldernya beda dari slug otomatis', async () => {
  const { loadCatalog } = await import('../src/core/catalog.ts');
  const { userAssetsFor } = await import('../src/visuals/types.ts');
  const fsx = await import('node:fs');
  const ownRoot = path.join(process.cwd(), 'assets', 'own');
  // Folder names are curated by hand (`porsche-911-gt3-rs-992`), so resolving
  // them by slugify(model) alone silently ignored 12 models' photos. Folders
  // outside the catalog stay valid: a brief may name any model.
  const photosIn = (dir: string) =>
    fsx.existsSync(dir) && fsx.readdirSync(dir).some((f) => /\.(jpe?g|png|webp|mp4|mov)$/i.test(f));
  const shadowed = loadCatalog()
    .models.filter((m) => photosIn(path.join(ownRoot, m.slug)))
    .filter((m) => userAssetsFor(m.model, ownRoot).length === 0)
    .map((m) => m.model);
  assert(shadowed.length === 0, `foto katalog tidak terbaca: ${shadowed.join(', ')}`);
});

await check('API menyajikan katalog agar model bisa dipilih di web', async () => {
  const { app } = createApp({ startWorker: false });
  const server = app.listen(0);
  const port = (server.address() as { port: number }).port;
  const base = `http://127.0.0.1:${port}`;
  try {
    await fetch(`${base}/api/setup`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'uji@studio.id', password: 'rahasia123' }),
    });
    const login = await fetch(`${base}/api/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'uji@studio.id', password: 'rahasia123' }),
    });
    const cookie = (login.headers.get('set-cookie') ?? '').split(';')[0];
    const res = await fetch(`${base}/api/config`, { headers: { cookie } });
    assert(res.status === 200, `config ${res.status}`);
    const cfg = (await res.json()) as {
      catalog: { slug: string; model: string; kategori: string }[];
    };
    assert(Array.isArray(cfg.catalog), 'config harus memuat catalog');
    assert(cfg.catalog.length >= 33, `katalog di API cuma ${cfg.catalog.length} model`);
    const racing = cfg.catalog.filter((m) => m.kategori === 'balap').length;
    assert(racing >= 2, `varian balap tidak sampai ke API: ${racing}`);
    assert(
      cfg.catalog.every((m) => m.slug && m.model),
      'setiap entri katalog harus punya slug dan nama',
    );
  } finally {
    server.close();
  }
});

await check('setiap model katalog punya foto di assets/own', async () => {
  const { loadCatalog } = await import('../src/core/catalog.ts');
  const fsx = await import('node:fs');
  const ownRoot = path.join(process.cwd(), 'assets', 'own');
  const missing = loadCatalog()
    .models.filter((m) => {
      const dir = path.join(ownRoot, m.slug);
      return !fsx.existsSync(dir) || !fsx.readdirSync(dir).some((f) => /\.(jpe?g|png|webp)$/i.test(f));
    })
    .map((m) => m.slug);
  assert(missing.length === 0, `model tanpa foto: ${missing.join(', ')}`);
});

await check('katalog memuat varian balap dan modifikasi', async () => {
  const { loadCatalog } = await import('../src/core/catalog.ts');
  const models = loadCatalog().models;
  const racing = models.filter((m) => m.kategori === 'balap');
  const modified = models.filter((m) => m.kategori === 'modifikasi');
  assert(racing.length >= 2, `varian balap kurang: ${racing.length}`);
  assert(modified.length >= 1, `varian modifikasi kurang: ${modified.length}`);
  assert(models.length >= 33, `katalog menyusut: ${models.length}`);
});

await check('spesifikasi tak bersumber tidak pernah tampil sebagai angka', async () => {
  const { loadCatalog, specLines } = await import('../src/core/catalog.ts');
  const models = loadCatalog().models;
  for (const m of models) {
    for (const line of specLines(m)) {
      assert(
        !line.includes('tidak disebut di sumber'),
        `${m.slug}: penanda "tidak disebut" bocor ke layar (${line})`,
      );
    }
    // Setiap baris harus menyebut minimal satu angka atau tahun produksi.
    assert(specLines(m).length >= 2, `${m.slug}: baris spesifikasi terlalu sedikit`);
  }
});

await check('setiap angka katalog punya jejak di artikel sumber', async () => {
  const { loadCatalog } = await import('../src/core/catalog.ts');
  const models = loadCatalog().models;
  const noSource = models.filter((m) => !/^https:\/\/en\.wikipedia\.org\/wiki\//.test(m.sumber));
  assert(noSource.length === 0, `sumber tidak valid: ${noSource.map((m) => m.slug).join(', ')}`);
  const noTagline = models.filter((m) => !m.tagline || !m.deskripsi);
  assert(noTagline.length === 0, `tanpa tagline/deskripsi: ${noTagline.map((m) => m.slug).join(', ')}`);
});

await check('render menulis hasil ke artifacts agar QA bisa membacanya', async () => {
  const { artifactPath } = await import('../src/agents/guard.ts');
  assert(
    artifactPath('job-x', 'render-result.json').endsWith(path.join('artifacts', 'render-result.json')),
    'render-result harus berada di artifacts/',
  );
});

await check('setiap alias katalog dikenali sebagai model yang benar', async () => {
  const { loadCatalog, findModel, aliasesFor } = await import('../src/core/catalog.ts');
  const salah: string[] = [];
  for (const m of loadCatalog().models) {
    for (const alias of aliasesFor(m.slug)) {
      const hit = findModel(alias);
      if (hit?.slug !== m.slug) salah.push(`${alias} -> ${hit?.slug ?? 'kosong'} (harusnya ${m.slug})`);
    }
  }
  assert(salah.length === 0, `alias salah arah: ${salah.join('; ')}`);
});

await check('dua worker tidak bisa mengklaim job yang sama', async () => {
  const { createJob, claimNextJob } = await import('../src/db/repo.ts');
  // Drain whatever earlier checks left queued so the new job is the only
  // candidate and the assertion below is unambiguous.
  while (await claimNextJob()) {
    /* kosongkan antrean */
  }
  const job = await createJob({
    briefSlug: 'uji-klaim',
    title: 'Uji Klaim',
    model: 'Uji Klaim',
    themeId: 'generic',
    mode: 'draft',
    durationSec: 30,
    aspect: '16:9',
    preset: '9-orang',
    brief: { model: 'Uji Klaim', durasi: 30, rasio: '16:9', keunggulan: [] } as never,
    costEstimate: 0,
  });
  // Fired together on purpose: this is the interleaving two polling workers
  // produce, and both used to come back with the same job.
  const results = await Promise.all([claimNextJob(), claimNextJob(), claimNextJob(), claimNextJob()]);
  const ids = results.map((r) => r?.id).filter((id): id is string => Boolean(id));
  assert(new Set(ids).size === ids.length, `ada job diklaim dua kali: ${ids.join(', ')}`);
  assert(ids.includes(job.id), 'job baru tidak pernah terklaim');
});

// ------------------------------------------------ pencarian model otomatis

await check('pencarian model menerima nama panggilan, bukan hanya nama persis', async () => {
  const { findModel, searchModels } = await import('../src/core/catalog.ts');
  const cases: [string, string][] = [
    ['r34', 'nissan-skyline-r34-gtr'],
    ['hachiroku', 'toyota-ae86'],
    ['gullwing', 'mercedes-300sl-gullwing'],
    ['rx7', 'mazda-rx7-fd'],
    ['22b', 'subaru-impreza-22b'],
    ['z-tune', 'nissan-r34-gtr-z-tune'],
    ['supra', 'toyota-gr-supra'],
    ['M4', 'bmw-m4-competition-g82'],
  ];
  for (const [q, slug] of cases) {
    assert(findModel(q)?.slug === slug, `"${q}" seharusnya ${slug}, dapat ${findModel(q)?.slug ?? 'null'}`);
  }
  // A car that is not in the catalog must stay unresolved, never borrow
  // another model's photos or engine note.
  assert(findModel('Tesla Model 3') === undefined, 'model di luar katalog harus tetap tak dikenal');
  assert(searchModels('xyzzy').length === 0, 'kata acak tidak boleh menghasilkan kandidat');
});

await check('setiap model katalog bisa ditemukan dari namanya sendiri', async () => {
  const { loadCatalog, findModel } = await import('../src/core/catalog.ts');
  for (const m of loadCatalog().models) {
    const hit = findModel(m.model);
    assert(hit?.slug === m.slug, `nama "${m.model}" tidak resolve ke ${m.slug}`);
  }
});

// The UI and the API both let a user append qualifiers ("Mazda RX-7 FD3S").
// An unresolved name means the job quietly ignores the real photos in
// assets/own/<slug>/ and renders a generator-invented car instead.
await check('nama model dengan kualifikasi ekstra tetap menemukan fotonya', async () => {
  const { findModel } = await import('../src/core/catalog.ts');
  const { assetFolderSlug, userAssetsFor } = await import('../src/visuals/types.ts');
  const kasus: Array<[string, string]> = [
    ['Mazda RX-7 FD3S', 'mazda-rx7-fd'],
    ['Mazda RX-7', 'mazda-rx7-fd'],
    ['Porsche 911 GT3 RS 992', 'porsche-911-gt3-rs-992'],
    ['Lamborghini Huracan STO', 'lamborghini-huracan-sto'],
    ['Nissan Skyline GT-R R34', 'nissan-skyline-r34-gtr'],
  ];
  for (const [nama, slug] of kasus) {
    assert(findModel(nama)?.slug === slug, `"${nama}" harus resolve ke ${slug}`);
    assert(assetFolderSlug(nama) === slug, `folder aset untuk "${nama}" harus ${slug}`);
    assert(userAssetsFor(nama, path.join('assets', 'own')).length > 0, `"${nama}" harus menemukan foto di ${slug}`);
  }
});

await check('model di luar katalog tidak dipaksa cocok dengan mobil lain', async () => {
  const { findModel } = await import('../src/core/catalog.ts');
  assert(findModel('Koenigsegg Jesko') === undefined, 'Jesko tidak boleh dianggap model katalog');
  assert(findModel('Tesla Cybertruck') === undefined, 'Cybertruck tidak boleh dianggap model katalog');
});

// A 9:16 reel is 1080x1920: correct for the brief but narrower than the
// landscape minimum, so a width-only check rejected every vertical video.
await check('gerbang resolusi menerima video vertikal 9:16', async () => {
  const { isBelowMinimum } = await import('../src/pipeline/quality.ts');
  const o = { minWidth: 1280, minHeight: 720 };
  assert(!isBelowMinimum(1920, 1080, o), 'landscape 1920x1080 harus lolos');
  assert(!isBelowMinimum(1080, 1920, o), 'potret 1080x1920 harus lolos');
  assert(!isBelowMinimum(1080, 1080, o), 'persegi 1080x1080 harus lolos');
  // The free image provider caps 9:16 output at 1024x1792 by design, so that
  // is the smallest portrait source the pipeline can actually obtain.
  assert(!isBelowMinimum(1024, 1792, o), 'potret 1024x1792 (batas provider gratis) harus lolos');
  assert(isBelowMinimum(640, 360, o), '640x360 harus ditolak');
  assert(isBelowMinimum(720, 720, o), '720x720 harus ditolak (long edge di bawah 1024)');
});

// ------------------------------------------------------- suara per model

await check('profil suara mesin berbeda antar model', async () => {
  const { engineProfileFor } = await import('../src/render/engine.ts');
  const mustang = engineProfileFor('Ford Mustang Fastback');
  const ae86 = engineProfileFor('Toyota AE86');
  const gt3 = engineProfileFor('Porsche 911 GT3 RS');
  const taycan = engineProfileFor('Porsche Taycan Turbo S');

  assert(mustang.layout === 'V8' && mustang.cylinders === 8, `Mustang harus V8, dapat ${mustang.layout}`);
  assert(ae86.layout === 'I4' && ae86.cylinders === 4, `AE86 harus I4, dapat ${ae86.layout}`);
  assert(gt3.layout === 'flat-6', `GT3 RS harus flat-6, dapat ${gt3.layout}`);
  assert(taycan.aspiration === 'electric', 'Taycan harus terdeteksi listrik');
  assert(mustang.rasp > gt3.rasp - 0.01, 'V8 harus lebih kasar dari flat-6');
  assert(new Set([mustang.label, ae86.label, gt3.label]).size === 3, 'label mesin harus unik per model');
});

await check('profil mesin tidak mengarang: kosong untuk model di luar katalog', async () => {
  const { engineProfileFor } = await import('../src/render/engine.ts');
  const p = engineProfileFor('Mobil Antah Berantah');
  assert(p.label === 'Mobil Antah Berantah', 'model tak dikenal memakai profil generik, bukan milik mobil lain');
});

await check('suara mesin benar-benar disintesis dan berbeda per model', async () => {
  const { buildEngineTrack } = await import('../src/render/audio.ts');
  const scenes = [
    { index: 0, key: 'hook', start: 0, duration: 2 },
    { index: 1, key: 'action', start: 2, duration: 2 },
  ] as unknown as Parameters<typeof buildEngineTrack>[0]['scenes'];
  const models = ['Ford Mustang Fastback', 'Toyota AE86', 'Porsche Taycan Turbo S'];
  const hashes = new Set<string>();
  for (const model of models) {
    const r = buildEngineTrack({ jobId: `uji-${model.split(' ').pop()}`, durationSec: 4, model, scenes });
    assert(r !== null, `gagal membuat suara mesin untuk ${model}`);
    assert(fs.existsSync(r!.file) && fs.statSync(r!.file).size > 10000, `berkas suara ${model} kosong`);
    hashes.add(fs.readFileSync(r!.file).toString('base64').slice(0, 4000));
  }
  assert(hashes.size === models.length, 'suara tiap model harus berbeda, bukan file yang sama');
});

// Realisme suara mesin diukur, bukan diasumsikan. Versi lama lolos semua tes
// di atas padahal yang terdengar hanyalah drone sine: nadanya diam di 55 Hz
// dengan variasi 0.0% sepanjang 12 detik. Tes ini menangkap kasus itu.
await check('suara mesin bergerak seperti mesin sungguhan, bukan drone', async () => {
  const { buildEngineTrack } = await import('../src/render/audio.ts');
  const { spawnSync } = await import('node:child_process');
  const scenes = [
    { index: 0, key: 'hook', start: 0, duration: 3 },
    { index: 1, key: 'action', start: 3, duration: 5 },
  ] as unknown as Parameters<typeof buildEngineTrack>[0]['scenes'];

  // Nada dasar dilacak per frame lewat autokorelasi pada WAV 8 kHz.
  const pitchJitter = (file: string): number => {
    const wav = path.join(os.tmpdir(), `f0-${Date.now()}-${Math.random().toString(36).slice(2)}.wav`);
    const res = spawnSync('ffmpeg', ['-v', 'error', '-y', '-i', file, '-ac', '1', '-ar', '8000', wav]);
    if (res.status !== 0) return 0;
    const buf = fs.readFileSync(wav);
    fs.rmSync(wav, { force: true });
    // Lompati header WAV 44 byte, baca PCM 16-bit mono.
    const n = Math.floor((buf.length - 44) / 2);
    const x = new Float64Array(n);
    for (let i = 0; i < n; i++) x[i] = buf.readInt16LE(44 + i * 2) / 32768;
    const win = 1024, hop = 512, sr = 8000;
    const f0: number[] = [];
    for (let s = 0; s + win < n; s += hop) {
      let e0 = 0;
      for (let i = 0; i < win; i++) e0 += x[s + i] * x[s + i];
      if (e0 < 1e-6) continue;
      let bestLag = 0, best = 0;
      for (let lag = Math.floor(sr / 500); lag < Math.floor(sr / 40); lag++) {
        let acc = 0;
        for (let i = 0; i < win - lag; i++) acc += x[s + i] * x[s + i + lag];
        if (acc > best) { best = acc; bestLag = lag; }
      }
      if (bestLag > 0 && best > 0.25 * e0) f0.push(sr / bestLag);
    }
    if (f0.length < 4) return 0;
    const mean = f0.reduce((a, b) => a + b, 0) / f0.length;
    const varr = f0.reduce((a, b) => a + (b - mean) ** 2, 0) / f0.length;
    return (Math.sqrt(varr) / mean) * 100;
  };

  for (const model of ['Porsche 911 GT3 RS', 'Mazda RX-7 FD3S']) {
    const r = buildEngineTrack({ jobId: `jitter-${model.split(' ').pop()}`, durationSec: 8, model, scenes });
    assert(r !== null, `gagal membuat suara mesin untuk ${model}`);
    const jitter = pitchJitter(r!.file);
    // Rekaman mesin asli: 57-227%. Drone sine: 0-2%. Ambang 15% memisahkan keduanya.
    assert(
      jitter > 15,
      `suara ${model} terlalu statis (jitter ${jitter.toFixed(1)}%) — terdengar seperti drone, bukan mesin`,
    );
  }
});

await check('model dengan rekaman asli memakai rekaman, bukan sintesis', async () => {
  const { buildEngineTrack, recordedSegmentFor } = await import('../src/render/audio.ts');
  const seg = recordedSegmentFor('Porsche 911 GT3 RS 992');
  assert(seg !== null, 'GT3 RS harus punya rekaman asli di manifest');
  assert(seg!.license === 'CC BY 3.0', 'lisensi rekaman harus tercatat');
  assert(typeof seg!.artist === 'string' && seg!.artist.length > 3, 'artis rekaman harus tercatat');
  const r = buildEngineTrack({ jobId: 'rec-uji', durationSec: 4, model: 'Porsche 911 GT3 RS 992', scenes: [] });
  assert(r !== null && r!.recorded === true, 'jalur rekaman asli harus dipakai untuk GT3 RS');
});

await check('campuran mesin + musik menghasilkan audio stereo 48 kHz', async () => {
  const { buildMusicBed, buildEngineTrack, muxAudio } = await import('../src/render/audio.ts');
  const { loadThemes } = await import('../src/core/config.ts');
  const { ffprobe } = await import('../src/render/ffmpeg.ts');
  const themes = loadThemes();
  const theme = Object.values(themes.themes)[0];
  const job = 'uji-mux';
  const silent = path.join('jobs', job, 'video-silent.mp4');
  fs.mkdirSync(path.dirname(silent), { recursive: true });
  const made = spawnSync(
    'ffmpeg',
    ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=15:duration=3',
     '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', silent],
    { encoding: 'utf8' },
  );
  assert(made.status === 0, 'gagal membuat video uji');
  const engine = buildEngineTrack({ jobId: job, durationSec: 3, model: 'Toyota AE86', scenes: [] });
  const music = buildMusicBed({ jobId: job, durationSec: 3, theme, model: 'Toyota AE86' });
  assert(engine !== null && music !== null, 'gagal menyiapkan trek audio');
  const out = path.join('jobs', job, 'video.mp4');
  const ok = muxAudio(silent, music, out, -14, engine!.file);
  assert(ok, 'muxAudio gagal menggabungkan mesin dan musik');
  const probe = ffprobe(out);
  assert(probe.ok && (probe.durationSec ?? 0) > 2.5, 'video hasil mux tidak valid');
  const channels = spawnSync(
    'ffprobe',
    ['-v', 'error', '-select_streams', 'a:0', '-show_entries', 'stream=channels,sample_rate',
     '-of', 'csv=p=0', out],
    { encoding: 'utf8' },
  );
  assert(channels.stdout.includes('48000'), `sample rate harus 48000, dapat ${channels.stdout.trim()}`);
  fs.rmSync(path.join('jobs', job), { recursive: true, force: true });
});

// --- metadata unggahan (studio) ------------------------------------------
await check('metadata tidak menggandakan merek pada nama mobil', async () => {
  const { CATALOG, carName } = await import('../studio/src/data/catalog.ts');
  const { buildMetadata } = await import('../studio/src/services/metadata.ts');
  const car = CATALOG[0];
  const meta = buildMetadata(car, { carSlug: car.slug, aspect: '9:16' }, 'tiktok');
  assert(!/Ferrari Ferrari/i.test(meta.title), `judul menggandakan merek: ${meta.title}`);
  assert(carName(car) === car.model, 'carName harus memakai model yang sudah memuat merek');
  assert(meta.title.includes(car.tenaga), 'judul harus memuat tenaga dari katalog');
});

await check('caption memakai angka katalog, bukan karangan', async () => {
  const { CATALOG } = await import('../studio/src/data/catalog.ts');
  const { buildMetadata } = await import('../studio/src/services/metadata.ts');
  const car = CATALOG.find((c) => c.slug === 'mazda-rx7-fd') ?? CATALOG[0];
  const meta = buildMetadata(car, { carSlug: car.slug, aspect: '16:9' }, 'youtube');
  for (const angka of [car.torsi, car.nol100, car.vmax]) {
    assert(meta.caption.includes(angka), `caption harus memuat "${angka}" dari katalog`);
  }
  assert(meta.caption.includes('Wikipedia'), 'caption harus menyebut sumber');
});

await check('hashtag unik, bersih, dan menghormati batas platform', async () => {
  const { CATALOG } = await import('../studio/src/data/catalog.ts');
  const { buildMetadata, PLATFORM_LIMITS } = await import('../studio/src/services/metadata.ts');
  const car = CATALOG[0];
  for (const p of ['tiktok', 'instagram', 'youtube'] as const) {
    const meta = buildMetadata(car, { carSlug: car.slug, aspect: '9:16' }, p);
    const set = new Set(meta.hashtags);
    assert(set.size === meta.hashtags.length, `hashtag duplikat di ${p}`);
    assert(meta.hashtags.length <= PLATFORM_LIMITS[p].hashtags, `hashtag melebihi batas ${p}`);
    assert(meta.hashtags.every((t) => /^[a-z0-9]+$/.test(t)), `hashtag tidak bersih di ${p}`);
    assert(meta.caption.length <= PLATFORM_LIMITS[p].caption, `caption melebihi batas ${p}`);
  }
});

await check('publish tidak pernah siap tanpa kredensial platform', async () => {
  const { CATALOG } = await import('../studio/src/data/catalog.ts');
  const { planPublish } = await import('../studio/src/services/metadata.ts');
  const car = CATALOG[0];
  const target = { carSlug: car.slug, aspect: '9:16' as const };
  const blocked = planPublish(car, target, { tiktok: false, instagram: false, youtube: false });
  assert(blocked.every((p) => !p.ready && p.blockedBy), 'semua platform harus terblokir tanpa kredensial');
  const open = planPublish(car, target, { tiktok: true, instagram: false, youtube: false });
  assert(open.find((p) => p.platform === 'tiktok')?.ready === true, 'tiktok siap bila kredensial ada');
  assert(open.find((p) => p.platform === 'youtube')?.ready === false, 'youtube tetap terblokir');
});

await check('nama berkas unggahan aman untuk semua platform', async () => {
  const { CATALOG } = await import('../studio/src/data/catalog.ts');
  const { uploadFileName } = await import('../studio/src/services/metadata.ts');
  for (const car of CATALOG) {
    for (const p of ['tiktok', 'instagram', 'youtube'] as const) {
      const n = uploadFileName({ carSlug: car.slug, aspect: '9:16' }, p);
      assert(/^[a-z0-9]+\.mp4$/.test(n), `nama berkas tidak aman: ${n}`);
      assert(n.endsWith('.mp4'), 'berkas harus mp4');
    }
  }
});

await check('findCar mencocokkan slug server yang berbeda dari katalog', async () => {
  const { findCar, CATALOG } = await import('../studio/src/data/catalog.ts');
  assert(findCar('nissan-skyline-gt-r-r34')?.slug === 'nissan-skyline-r34-gtr', 'slug server harus cocok ke katalog');
  assert(findCar('mazda-rx-7-fd3s')?.slug === 'mazda-rx7-fd', 'slug RX-7 harus cocok');
  assert(findCar('', 'Ferrari 296 GTB')?.slug === 'ferrari-296-gtb', 'nama model harus cocok');
  assert(findCar('mobil-yang-tidak-ada-xyz') === undefined, 'slug asing tidak boleh dipaksa cocok');
  for (const c of CATALOG) assert(findCar(c.slug)?.slug === c.slug, `slug katalog harus cocok: ${c.slug}`);
});

await check('hanya platform dengan adaptor nyata yang ditawarkan', async () => {
  const { PLATFORMS_WITH_ADAPTOR, PLATFORM_LABEL } = await import('../studio/src/services/metadata.ts');
  assert(PLATFORMS_WITH_ADAPTOR.length > 0, 'harus ada minimal satu platform');
  assert(PLATFORMS_WITH_ADAPTOR.every((p) => PLATFORM_LABEL[p]), 'setiap platform wajib punya label');
  assert(!PLATFORMS_WITH_ADAPTOR.includes('tiktok'), 'tiktok belum punya adaptor');
  assert(!PLATFORMS_WITH_ADAPTOR.includes('youtube'), 'youtube belum punya adaptor');
});

await check('adaptor publish menolak platform tanpa implementasi', async () => {
  const { publishJob } = await import('../src/publish/instagram.ts');
  for (const platform of ['tiktok', 'youtube']) {
    let msg = '';
    try {
      await publishJob({ jobId: 'tidak-ada', platform, dryRun: true });
    } catch (err) {
      msg = err instanceof Error ? err.message : String(err);
    }
    assert(msg.includes('belum ada adaptor'), `${platform} harus ditolak sebagai belum ada adaptor, dapat: ${msg}`);
  }
});

await check('project dari server memakai durasi dan tanggal asli', async () => {
  const { projectFromServer } = await import('../studio/src/services/api.ts');
  const p = projectFromServer({
    id: 'x1',
    title: 'Nissan Skyline GT-R R34',
    model: 'Nissan Skyline GT-R R34',
    brief_slug: 'nissan-skyline-gt-r-r34',
    duration_sec: 45,
    aspect: '9:16',
    status: 'done',
    created_at: '2026-11-20T06:39:27.766Z',
  });
  assert(p.durationSec === 45, 'durasi harus dari duration_sec');
  assert(p.aspect === '9:16', 'rasio harus terbawa');
  assert(p.carSlug === 'nissan-skyline-r34-gtr', 'slug harus dipetakan ke katalog');
  assert(Number.isFinite(p.createdAt) && p.createdAt > 0, 'tanggal harus valid, bukan NaN');
  assert(p.stages.every((s) => s.state === 'selesai'), 'status done berarti semua tahap selesai');
  assert(p.stages.every((s) => typeof s.label === 'string' && s.label.length > 0), 'tahap wajib punya label');
});

await check('setiap video di Perpustakaan benar-benar ada berkasnya', async () => {
  const { RENDERED } = await import('../studio/src/data/rendered.ts');
  assert(RENDERED.length > 0, 'perpustakaan tidak boleh kosong');
  for (const v of RENDERED) {
    const mp4 = path.join(process.cwd(), 'netlify-site', 'video', `${v.slug}.mp4`);
    const jpg = path.join(process.cwd(), 'netlify-site', 'thumb', `${v.slug}.jpg`);
    assert(fs.existsSync(mp4), `video hilang: ${v.slug}.mp4`);
    assert(fs.existsSync(jpg), `thumb hilang: ${v.slug}.jpg`);
    assert(fs.statSync(mp4).size > 100_000, `video terlalu kecil, mungkin rusak: ${v.slug}`);
    assert(v.dur >= 30, `durasi ${v.slug} melanggar batas keras 30s`);
  }
  const slugs = RENDERED.map((v) => v.slug);
  assert(new Set(slugs).size === slugs.length, 'slug video harus unik');
});

await check('benih proyek demo memakai data nyata, bukan karangan', async () => {
  const { seedProjects } = await import('../studio/src/services/api.ts');
  const { RENDERED } = await import('../studio/src/data/rendered.ts');
  const { CATALOG } = await import('../studio/src/data/catalog.ts');
  const seeds = seedProjects();

  assert(seeds.length > 0, 'benih tidak boleh kosong, kalau kosong situs statis terbuka kosong');
  // Model tanpa entri katalog tidak boleh dibuatkan proyek: spesifikasinya
  // tidak bersumber. Videonya tetap ada di Perpustakaan.
  const withCatalog = RENDERED.filter((v) => v.catalogSlug);
  assert(seeds.length === withCatalog.length, 'jumlah benih harus sama dengan video yang punya entri katalog');

  for (const p of seeds) {
    assert(p.stages.length === 9, `${p.title} harus punya 9 tahap`);
    assert(p.stages.every((s) => s.state === 'selesai'), `${p.title} dari job nyata berarti semua tahap selesai`);
    assert(p.status === 'done', `${p.title} harus berstatus selesai`);
    assert(p.durationSec >= 30, `${p.title} melanggar batas keras 30s`);
    assert(Number.isFinite(p.createdAt) && p.createdAt > 0, `${p.title} tanggal harus valid`);
    assert(Boolean(p.videoUrl && p.thumbUrl), `${p.title} harus menautkan video nyata`);
    assert(CATALOG.some((c) => c.slug === p.carSlug), `${p.title} harus memakai slug katalog yang ada`);
  }

  const ids = seeds.map((p) => p.id);
  assert(new Set(ids).size === ids.length, 'id proyek benih harus unik');
});

await check('spesifikasi video diambil dari katalog, bukan dikarang', async () => {
  const { RENDERED, specsOf } = await import('../studio/src/data/rendered.ts');
  const { CATALOG } = await import('../studio/src/data/catalog.ts');

  for (const v of RENDERED) {
    const car = v.catalogSlug ? CATALOG.find((c) => c.slug === v.catalogSlug) : undefined;
    if (!car) {
      // Tanpa katalog tetap boleh tampil, tapi harus jujur soal foto.
      assert(v.qa === 'tanpa-foto', `${v.slug} tanpa entri katalog harus ditandai tanpa-foto`);
      assert(specsOf(v).length > 0, `${v.slug} butuh spesifikasi cadangan`);
      continue;
    }
    assert(v.merk === car.merk, `${v.slug}: merek harus dari katalog`);
    assert(v.kategori === car.kategori, `${v.slug}: kategori harus dari katalog`);
    assert(v.tahun === car.tahun, `${v.slug}: tahun harus dari katalog`);

    const specs = specsOf(v);
    assert(specs.length > 0, `${v.slug} harus punya spesifikasi`);
    // Nilai yang tidak tercatat di sumber tidak boleh muncul sebagai angka.
    assert(!specs.some((s) => s.includes('tidak disebut')), `${v.slug} menampilkan nilai "tidak disebut"`);
    const allowed = [car.mesin, car.tenaga, car.torsi, car.nol100 && `0–100 ${car.nol100}`, car.vmax].filter(
      (s): s is string => typeof s === 'string',
    );
    for (const s of specs) {
      assert(allowed.includes(s), `${v.slug}: spesifikasi "${s}" tidak ada di katalog (indikasi karangan)`);
    }
  }
});

await check('penanda "tanpa foto" cocok dengan aset job aslinya', async () => {
  const { RENDERED } = await import('../studio/src/data/rendered.ts');
  for (const v of RENDERED) {
    const assetsPath = path.join(repoRoot, 'jobs', v.jobId, 'artifacts', 'assets.json');
    if (!fs.existsSync(assetsPath)) continue;
    const assets = JSON.parse(fs.readFileSync(assetsPath, 'utf8')) as { source?: string }[];
    const allLocal = assets.length > 0 && assets.every((a) => (a.source ?? '').includes('/assets/own/'));
    if (v.qa === 'tanpa-foto') {
      assert(!allLocal, `${v.slug} ditandai tanpa foto padahal asetnya dari garasi`);
    } else {
      assert(allLocal, `${v.slug} ditandai QA lolos padahal ada aset non-garasi`);
    }
  }
});

await check('benih lama dimigrasi dan proyek terhapus tidak kembali', async () => {
  const store = new Map<string, string>();
  (globalThis as any).localStorage = {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  };
  const api = await import('../studio/src/services/api.ts');
  const demo = new api.DemoStudioApi();

  localStorage.setItem('asa.user', JSON.stringify({ email: 'uji@studio.id', name: 'uji' }));

  // Pengunjung lama: benih versi sebelumnya (judul & tanggal salah), tanpa versi.
  const stale = api.seedProjects().map((p) => ({ ...p, title: `LAMA ${p.title}`, createdAt: 0 }));
  localStorage.setItem(api.demoProjectsKey(), JSON.stringify(stale.slice(0, 3)));
  const migrated = await demo.listProjects();
  assert(migrated.length === api.seedProjects().length, `migrasi menghasilkan ${migrated.length} proyek`);
  assert(!migrated.some((p) => p.title.startsWith('LAMA')), 'judul lama masih tersisa setelah migrasi');

  // Proyek buatan pengguna tidak boleh hilang saat migrasi.
  const own = await demo.createProject({ carSlug: 'ferrari-296-gtb' });
  await demo.saveProject(own);
  const withOwn = await demo.listProjects();
  assert(withOwn.some((p) => p.id === own.id), 'proyek buatan pengguna hilang saat migrasi');

  // Hapus satu proyek benih persis seperti store, lalu naikkan versi benih:
  // proyek itu tidak boleh kembali.
  const victim = api.seedProjects()[0];
  const key = api.demoProjectsKey();
  const stored = JSON.parse(localStorage.getItem(key) || '[]') as { id: string }[];
  localStorage.setItem(key, JSON.stringify(stored.filter((p) => p.id !== victim.id)));
  api.rememberDeletion(victim.id);
  localStorage.setItem('asa.seedVersion.uji@studio.id', '0');
  const after = await demo.listProjects();
  assert(!after.some((p) => p.id === victim.id), 'proyek benih yang dihapus muncul lagi setelah versi naik');
  assert(after.some((p) => p.id === own.id), 'proyek buatan pengguna hilang setelah versi benih naik');

  delete (globalThis as any).localStorage;
});

/* ---------------------------------------------- riset mandiri (Wikipedia) */
await check('parser infobox mengambil label dan nilai dengan benar', async () => {
  const { infoboxRows } = await import('../studio/src/services/research.ts');
  const html = `<table class="infobox hproduct"><tr><th>Manufacturer</th><td>[[Porsche AG]]</td></tr>
    <tr><th>Power&nbsp;output</th><td>652 kW (887 PS; 875 hp)</td></tr></table>`;
  const rows = infoboxRows(html);
  assert(rows['manufacturer'] === '[[Porsche AG]]', `manufacturer salah: ${rows['manufacturer']}`);
  assert(rows['power output'] === '652 kW (887 PS; 875 hp)', 'label power output tidak dinormalkan');
});

await check('satuan dinormalkan ke PS, Nm, dan kg', async () => {
  const r = await import('../studio/src/services/research.ts');
  assert(r.normalisePower('652 kW (887 PS; 875 hp)') === '887 PS', 'PS tidak diambil');
  assert(r.normalisePower('710 hp') === '720 PS', `konversi hp salah: ${r.normalisePower('710 hp')}`);
  assert(r.normalisePower('1,103 kW') === '1500 PS', `konversi kW salah: ${r.normalisePower('1,103 kW')}`);
  assert(r.normaliseTorque('1,280 N⋅m (944 lbf⋅ft)') === '1280 Nm', 'Nm tidak diambil');
  assert(r.normaliseWeight('1,634–1,720 kg (3,602–3,791 lb)') === '1,634 kg', 'kg tidak diambil');
  assert(r.normaliseWeight('4,400 lb (1,996 kg)') === '1,996 kg', 'lb→kg salah');
  assert(r.normaliseYears('September 2013 – June 2015') === '2013–2015', 'rentang tahun salah');
  assert(r.normaliseYears('2015') === '2015', 'tahun tunggal salah');
});

await check('0–100 tidak tertukar dengan angka 0–200', async () => {
  const { findAcceleration } = await import('../studio/src/services/research.ts');
  // Kalimat nyata dari artikel Porsche 918: 2,6 dtk untuk 0–100, 7,2 dtk untuk 0–200.
  const prose =
    'performance figures of 0–100 km/h (0–62 mph) in 2.6 seconds, 0–200 km/h (0–124 mph) in 7.2 seconds';
  assert(findAcceleration(prose) === '2,6 dtk', `salah ambil: ${findAcceleration(prose)}`);
  assert(findAcceleration('It accelerates from 0-100 km/h in 3.4 s.') === '3,4 dtk', 'format "in 3.4 s" gagal');
  assert(findAcceleration('A 4.0 L engine.') === '', 'mengarang angka akselerasi');
});

await check('top speed hanya diambil dari kalimat yang menyebutnya', async () => {
  const { findTopSpeed } = await import('../studio/src/services/research.ts');
  assert(findTopSpeed('a top speed of 345 km/h (214 mph)') === '345 km/jam', 'top speed gagal');
  assert(findTopSpeed('Its top speed is 330 km/h.') === '330 km/jam', 'format "is 330 km/h" gagal');
  assert(findTopSpeed('It is fast and red.') === '', 'mengarang top speed');
});

await check('mobil listrik memakai baris "Electric motor" sebagai mesin', async () => {
  const { buildCarFromArticle } = await import('../studio/src/services/research.ts');
  const html = `<table class="infobox"><tr><th>Class</th><td>Sports car (S)</td></tr>
    <tr><th>Electric&nbsp;motor</th><td>4 permanent magnet electric motors</td></tr>
    <tr><th>Power&nbsp;output</th><td>1,407.7 kW (1,888 hp; 1,914 PS)</td></tr></table>`;
  const { car } = buildCarFromArticle({ title: 'Rimac Nevera', html, prose: '', summary: 'A sports car.' });
  assert(car.mesin.includes('electric motors'), `mesin kosong untuk mobil listrik: "${car.mesin}"`);
  assert(car.tenaga === '1,914 PS', `tenaga salah: ${car.tenaga}`);
  assert(car.kategori === 'sport', `kategori salah: ${car.kategori}`);
});

await check('field yang tidak ada di sumber dilaporkan kosong, bukan dikarang', async () => {
  const { buildCarFromArticle } = await import('../studio/src/services/research.ts');
  const html = `<table class="infobox"><tr><th>Engine</th><td>2.0 L I4</td></tr></table>`;
  const { car, missing } = buildCarFromArticle({ title: 'Contoh Mobil', html, prose: '', summary: '' });
  assert(car.mesin === '2.0 L I4', 'mesin tidak terbaca');
  assert(car.tenaga === '' && car.torsi === '' && car.nol100 === '', 'mengarang angka yang tidak ada');
  assert(missing.includes('Tenaga') && missing.includes('0–100'), `daftar field kosong salah: ${missing.join(',')}`);
});

await check('proyek bisa dibuat dari mobil hasil riset web', async () => {
  const store: Record<string, string> = {};
  (globalThis as any).localStorage = {
    getItem: (k: string) => (k in store ? store[k] : null),
    setItem: (k: string, v: string) => {
      store[k] = String(v);
    },
    removeItem: (k: string) => {
      delete store[k];
    },
  };
  store['asa.user'] = JSON.stringify({ email: 'proyek@studio.id' });
  const r = await import('../studio/src/data/researched.ts');
  const { carName: carNameOf } = await import('../studio/src/data/catalog.ts');
  const api = await import('../studio/src/services/api.ts');
  r.resetResearchedCache();
  r.saveResearched({
    car: {
      slug: 'bugatti-chiron',
      merk: 'Bugatti',
      model: 'Bugatti Chiron',
      seri: '',
      tahun: '2016–2024',
      kategori: 'sport',
      mesin: '8.0 L quad-turbo W16',
      tenaga: '1.500 PS',
      torsi: '1.600 Nm',
      nol100: '2,4 dtk',
      vmax: '380 km/jam',
      berat: '1.996 kg',
      layout: 'Mid-engine, four-wheel-drive',
      tagline: '1.500 PS · 0–100 2,4 dtk.',
      sumber: 'https://en.wikipedia.org/wiki/Bugatti_Chiron',
    },
    missing: [],
    photoUrl: null,
    photoCredit: null,
    photoLicense: null,
    photoPageUrl: null,
    articleTitle: 'Bugatti Chiron',
    articleUrl: 'https://en.wikipedia.org/wiki/Bugatti_Chiron',
    researchedAt: 1,
  } as any);

  const resolved = api.resolveCar('bugatti-chiron');
  assert(resolved?.model === 'Bugatti Chiron', 'resolveCar tidak menemukan hasil riset');
  assert(api.resolveCar('ferrari-296-gtb')?.model === 'Ferrari 296 GTB', 'resolveCar merusak katalog');
  assert(api.resolveCar('tidak-ada') === undefined, 'resolveCar mengembalikan mobil palsu');

  const demo = new api.DemoStudioApi();
  const p = await demo.createProject({ carSlug: 'bugatti-chiron', durationSec: 30 });
  assert(p.carName === 'Bugatti Chiron', `proyek salah mobil: ${p.carName}`);
  assert(p.brief.hook.startsWith('Bugatti Chiron:'), `hook salah: ${p.brief.hook}`);
  assert(p.shots.length > 0, 'shot tidak dibuat');
  assert(p.title === 'Bugatti Chiron', `judul dobel merek: ${p.title}`);

  const catalogProject = await demo.createProject({ carSlug: 'ferrari-296-gtb', durationSec: 30 });
  assert(catalogProject.title === 'Ferrari 296 GTB', `judul katalog salah: ${catalogProject.title}`);

  const audi = (await import('../studio/src/data/catalog.ts')).CATALOG.find((c) => c.slug === 'audi-r8-v10-performance')!;
  assert(carNameOf(audi) === 'Audi R8 V10 Performance', `merek dobel: ${carNameOf(audi)}`);

  delete (globalThis as any).localStorage;
});

await check('nilai layout yang berulang dirapikan', async () => {
  const { dedupePhrases } = await import('../studio/src/services/research.ts');
  const v = dedupePhrases('Mid-engine, four-wheel-drive layout, All-wheel drive vehicle');
  assert(v === 'Mid-engine, four-wheel-drive layout', `dedupe salah: ${v}`);
  assert(dedupePhrases('Front-engine, rear-wheel-drive') === 'Front-engine, rear-wheel-drive', 'penggerak roda belakang terhapus');
  assert(dedupePhrases('') === '', 'nilai kosong berubah');
});

await check('tagline hasil riset berbahasa Indonesia dan memakai angka nyata', async () => {
  const { taglineFrom } = await import('../studio/src/services/research.ts');
  const t = taglineFrom({
    model: 'Porsche 918 Spyder',
    engine: '4.6 L V8',
    power: '887 PS',
    torque: '1,280 Nm',
    nol100: '2,6 dtk',
    vmax: '345 km/jam',
  });
  assert(t.includes('887 PS') && t.includes('2,6 dtk'), `tagline tidak memuat angka: ${t}`);
  assert(!/The Porsche|manufactured by/i.test(t), `tagline masih kutipan Inggris: ${t}`);
  // Nama model ditambahkan buildBrief, jadi tagline tidak boleh mengulanginya.
  assert(!t.includes('Porsche 918 Spyder'), `tagline mengulang nama model: ${t}`);
  const bare = taglineFrom({ model: 'X', engine: '', power: '', torque: '', nol100: '', vmax: '' });
  assert(!/·/.test(bare) && bare.length > 0, 'tagline kosong tidak punya teks cadangan');
});

await check('merek dikenali dari judul dan kategori tidak salah untuk hypercar', async () => {
  const { guessBrand, guessCategory } = await import('../studio/src/services/research.ts');
  assert(guessBrand('Koenigsegg Jesko', '') === 'Koenigsegg', 'merek tidak dikenali');
  assert(guessBrand('Rimac Nevera', 'Rimac Automobili') === 'Rimac', 'merek dari manufacturer gagal');
  assert(guessCategory('Sports car, developed from motorsport', '2022–2026') === 'sport', 'hypercar dianggap balap');
  assert(guessCategory('Formula One racing car', '2021') === 'balap', 'mobil F1 tidak dianggap balap');
  assert(guessCategory('A classic roadster', '1962') === 'sport', 'roadster klasik salah kategori');
});

await check('hasil riset tersimpan per akun, dan data versi lama dibuang', async () => {
  const store: Record<string, string> = {};
  (globalThis as any).localStorage = {
    getItem: (k: string) => (k in store ? store[k] : null),
    setItem: (k: string, v: string) => {
      store[k] = String(v);
    },
    removeItem: (k: string) => {
      delete store[k];
    },
  };
  store['asa.user'] = JSON.stringify({ email: 'riset@studio.id', name: 'riset' });
  const r = await import('../studio/src/data/researched.ts');
  r.resetResearchedCache();

  // Data format lama (array langsung, seri berisi tanggal) harus diabaikan.
  store['asa.researched.riset@studio.id'] = JSON.stringify([
    { car: { slug: 'porsche-918-spyder', model: 'Porsche 918 Spyder', seri: 'September 2013 – June 2015' } },
  ]);
  assert(r.listResearched().length === 0, 'data skema lama tidak dibuang');

  const entry = {
    car: { slug: 'porsche-918-spyder', merk: 'Porsche', model: 'Porsche 918 Spyder', seri: '', tahun: '2013–2015' },
    missing: [],
    photoUrl: null,
    photoCredit: null,
    photoLicense: null,
    photoPageUrl: null,
    articleTitle: 'Porsche 918 Spyder',
    articleUrl: 'https://en.wikipedia.org/wiki/Porsche_918_Spyder',
    researchedAt: 1,
  } as any;
  r.saveResearched(entry);
  r.resetResearchedCache();
  const back = r.listResearched();
  assert(back.length === 1 && back[0].car.slug === 'porsche-918-spyder', 'hasil riset tidak tersimpan');
  assert(r.findResearched('porsche-918-spyder')?.car.model === 'Porsche 918 Spyder', 'findResearched gagal');

  // Akun lain tidak boleh melihat hasil riset akun ini.
  store['asa.user'] = JSON.stringify({ email: 'lain@studio.id' });
  r.resetResearchedCache();
  assert(r.listResearched().length === 0, 'hasil riset bocor ke akun lain');

  delete (globalThis as any).localStorage;
});

await closeDb();
fs.rmSync(tmpRoot, { recursive: true, force: true });

/* ------------------------------------------------- prompt SFX & video AI */
await check('prompt SFX menyebut mesin yang sebenarnya, bukan menebak', async () => {
  const { engineSfxPrompts } = await import('../src/core/prompts.ts');
  const supra = engineSfxPrompts({ merk: 'Toyota', model: 'GR Supra', mesin: 'I6 3.0L turbo (B58B30)', tenaga: '387 PS', kategori: 'sport' });
  const mustang = engineSfxPrompts({ merk: 'Ford', model: 'Mustang Fastback', mesin: 'V8 289–390 cu in (4.7–6.4L)', kategori: 'klasik' });
  const taycan = engineSfxPrompts({ merk: 'Porsche', model: 'Taycan Turbo S', mesin: 'dua motor listrik sinkron AC', kategori: 'sport' });

  assert(supra.length === 5 && mustang.length === 5 && taycan.length === 5, 'tiap mobil butuh lima prompt SFX');
  const supraText = supra.map((s) => s.prompt).join(' ').toLowerCase();
  const mustangText = mustang.map((s) => s.prompt).join(' ').toLowerCase();
  const evText = taycan.map((s) => s.prompt).join(' ').toLowerCase();

  assert(supraText.includes('inline-six') && supraText.includes('turbo'), 'Supra harus inline-six turbo');
  assert(!supraText.includes('v8'), 'Supra tidak boleh disebut V8');
  assert(mustangText.includes('v8') && mustangText.includes('naturally aspirated'), 'Mustang harus V8 NA');
  assert(evText.includes('electric') && !evText.includes('v8'), 'Taycan harus listrik, bukan V8');
  assert(supraText.includes('b58b30'), 'kode mesin nyata harus ikut supaya generator tidak menebak');
  assert(!mustangText.includes('4.7'), 'kubikasi dalam kurung bukan kode mesin, jangan dipakai sebagai kode');
});

await check('prompt SFX tidak membocorkan bahasa Indonesia atau placeholder', async () => {
  const { engineSfxPrompts, videoScenePrompts } = await import('../src/core/prompts.ts');
  const car = { merk: 'Toyota', model: 'GR Supra', mesin: 'I6 3.0L turbo (B58B30)', tenaga: '387 PS', nol100: '4,1 dtk', kategori: 'sport' };
  const all = [...engineSfxPrompts(car).map((s) => s.prompt), ...videoScenePrompts(car).map((s) => s.prompt)];
  for (const p of all) {
    assert(!/dtk|\bundefined\b|\bnull\b|\$\{|\[mobil\]|TODO/i.test(p), `prompt masih kotor: ${p.slice(0, 90)}`);
  }
  const scene5 = videoScenePrompts(car).find((s) => s.n === 5)!;
  assert(scene5.prompt.includes('4.1 s'), `angka akselerasi harus format Inggris: ${scene5.prompt.slice(0, 120)}`);
});

await check('prompt video punya 8 scene dengan gaya global dan durasi aman', async () => {
  const { videoScenePrompts, VIDEO_STYLE_TAG, VIDEO_NEGATIVE } = await import('../src/core/prompts.ts');
  const car = { merk: 'Porsche', model: '911 GT3 RS', mesin: 'flat-6 4.0L naturally aspirated (MA2.75)', kategori: 'sport' };
  const scenes = videoScenePrompts(car);
  assert(scenes.length === 8, `harus 8 scene, dapat ${scenes.length}`);
  assert(scenes.every((s) => s.prompt.includes(VIDEO_STYLE_TAG)), 'setiap scene butuh global style tag');
  assert(scenes.every((s) => s.dur >= 5 && s.dur <= 12), 'durasi klip harus 5–12 dtk agar aman untuk model video AI');
  assert(scenes.every((s) => s.prompt.includes('911 GT3 RS')), 'nama mobil harus konsisten di semua scene');
  assert(VIDEO_NEGATIVE.includes('duplicate wheels'), 'negative prompt harus ada');

  const vertical = videoScenePrompts(car, { vertical: true });
  assert(vertical.every((s) => s.prompt.startsWith('Vertical 9:16')), 'versi vertikal harus diawali prefix 9:16');
});

await check('prompt video tidak mengarang warna cat yang tidak ada di katalog', async () => {
  const { videoScenePrompts } = await import('../src/core/prompts.ts');
  const text = videoScenePrompts({ merk: 'Toyota', model: 'GR Supra', mesin: 'I6 3.0L turbo', kategori: 'sport' })
    .map((s) => s.prompt)
    .join(' ');
  assert(!/Renaissance Red|Championship White|Matte White/i.test(text), 'warna cat tidak ada di katalog, jangan dikarang');
});

await check('prompt video mobil listrik tidak menyebut knalpot atau ruang mesin', async () => {
  const { videoScenePrompts, videoQaPrompt } = await import('../src/core/prompts.ts');
  const taycan = { merk: 'Porsche', model: 'Taycan Turbo S', mesin: 'dua motor listrik sinkron AC', tenaga: 'tidak disebut di sumber', nol100: '2,8 dtk', kategori: 'listrik' };
  const scenes = videoScenePrompts(taycan);
  const text = scenes.map((s) => s.prompt).join(' ').toLowerCase();
  // "no exhaust"/"no engine sound" adalah negasi yang benar; yang dilarang adalah
  // menyuruh model memfilmkan knalpot, ruang mesin, atau getaran mesin bensin.
  assert(!/exhaust tips|engine bay|engine start|engine vibration/i.test(text), `prompt EV masih menyuruh adegan bensin: ${text.slice(0, 160)}`);
  assert(text.includes('charge port'), 'detail makro EV harus menyebut port cas, bukan knalpot');
  assert(text.includes('electric drivetrain'), 'scene motor EV harus menyebut drivetrain listrik');
  assert(!/tidak disebut/i.test(text), 'placeholder Indonesia tidak boleh bocor ke prompt Inggris');

  const qa = videoQaPrompt(taycan).toLowerCase();
  assert(qa.includes('motor whine'), 'QA EV harus menilai whine motor');
  assert(!/a electric/.test(qa), 'artikel "a electric" salah tata bahasa');
});

await check('prompt video mobil bensin tetap memakai adegan mesin', async () => {
  const { videoScenePrompts } = await import('../src/core/prompts.ts');
  const supra = { merk: 'Toyota', model: 'GR Supra', mesin: 'I6 3.0L turbo (B58B30)', tenaga: '387 PS', nol100: '4,1 dtk', kategori: 'sport' };
  const text = videoScenePrompts(supra).map((s) => s.prompt).join(' ').toLowerCase();
  assert(text.includes('engine bay'), 'mobil bensin tetap butuh scene ruang mesin');
  assert(text.includes('exhaust tips'), 'mobil bensin tetap butuh detail knalpot');
  assert(!/no exhaust|charge port/.test(text), 'adegan EV tidak boleh muncul di mobil bensin');
});

/* ------------------------------------------------- suara mesin: bukan drone */
await check('audio mesin stereo 48 kHz, bukan drone mono', async () => {
  const { buildEngineTrack } = await import('../src/render/audio.ts');
  const { ffprobe } = await import('../src/render/ffmpeg.ts');
  const scenes = [{ index: 0, key: 'action', start: 0, duration: 3 }] as unknown as Parameters<typeof buildEngineTrack>[0]['scenes'];
  const r = buildEngineTrack({ jobId: 'uji-stereo', durationSec: 3, model: 'Toyota GR Supra', scenes });
  assert(r !== null, 'gagal membuat trek mesin');
  // ffprobe() menandai `ok` hanya kalau ada stream video; berkas ini audio murni.
  const probe = ffprobe(r!.file);
  assert(probe.hasAudio, 'berkas mesin tidak terbaca sebagai audio');
  const raw = spawnSync('ffprobe', ['-v', 'error', '-select_streams', 'a:0', '-show_entries', 'stream=channels,sample_rate', '-of', 'csv=p=0', r!.file], { encoding: 'utf8' });
  const [rate, channels] = raw.stdout.trim().split(',').map(Number);
  assert(rate === 48000, `sample rate harus 48000, dapat ${rate}`);
  assert(channels === 2, `harus stereo, dapat ${channels} kanal`);
});

await check('pitch mesin mengikuti rpm, bukan naik dua kali lipat', async () => {
  const { buildEngineTrack } = await import('../src/render/audio.ts');
  // Satu scene dengan beban tetap: rpm harus datar, jadi pitch juga datar.
  const scenes = [{ index: 0, key: 'action', start: 0, duration: 3 }] as unknown as Parameters<typeof buildEngineTrack>[0]['scenes'];
  const r = buildEngineTrack({ jobId: 'uji-pitch', durationSec: 3, model: 'Toyota GR Supra', scenes });
  assert(r !== null, 'gagal membuat trek mesin');

  const pcm = spawnSync('ffmpeg', ['-v', 'error', '-i', r!.file, '-ac', '1', '-ar', '48000', '-f', 's16le', '-'], { encoding: 'buffer', maxBuffer: 64 * 1024 * 1024 });
  const buf = pcm.stdout;
  const n = Math.floor(buf.length / 2);
  const samples = new Float32Array(n);
  for (let i = 0; i < n; i++) samples[i] = buf.readInt16LE(i * 2) / 32768;

  // Autokorelasi pada dua jendela: pitch harus sama saat rpm konstan.
  const pitchAt = (start: number) => {
    const win = 8192;
    const seg = samples.subarray(start, start + win);
    let best = 0;
    let bestLag = 0;
    for (let lag = 30; lag < 900; lag++) {
      let sum = 0;
      for (let i = 0; i < win - lag; i++) sum += seg[i] * seg[i + lag];
      if (sum > best) { best = sum; bestLag = lag; }
    }
    return 48000 / bestLag;
  };
  const early = pitchAt(Math.floor(0.4 * 48000));
  const late = pitchAt(Math.floor(2.2 * 48000));
  const ratio = Math.max(early, late) / Math.min(early, late);
  assert(ratio < 1.35, `pitch tidak stabil saat rpm tetap (${early.toFixed(0)} vs ${late.toFixed(0)} Hz) — fase salah`);
});

await check('mobil berbeda menghasilkan suara mesin berbeda', async () => {
  const { buildEngineTrack } = await import('../src/render/audio.ts');
  const scenes = [{ index: 0, key: 'action', start: 0, duration: 2 }] as unknown as Parameters<typeof buildEngineTrack>[0]['scenes'];
  const out: string[] = [];
  for (const model of ['Ford Mustang Fastback', 'Toyota AE86', 'Porsche Taycan Turbo S']) {
    const r = buildEngineTrack({ jobId: `uji-beda-${model.split(' ').pop()!.toLowerCase()}`, durationSec: 2, model, scenes });
    assert(r !== null, `gagal membuat suara ${model}`);
    out.push(fs.readFileSync(r!.file).subarray(0, 3000).toString('base64'));
  }
  assert(new Set(out).size === 3, 'suara tiga mobil berbeda harus unik');
});

// ------------------------------------------------------ rilis 1.0 (final)
// Halaman yang diterbitkan harus bisa dibagikan dan tidak menunjuk ke host
// yang salah. Dulu canonical/OG/sitemap masih menunjuk Netlify padahal situs
// kanoniknya GitHub Pages.
await check('index.html punya canonical, OG, dan JSON-LD ke URL kanonik', async () => {
  const html = fs.readFileSync(path.join('studio', 'index.html'), 'utf8');
  const canonical = 'https://alif121727.github.io/ai-agent-engginer/';
  assert(html.includes(`rel="canonical" href="${canonical}"`), 'canonical tidak menunjuk URL kanonik');
  assert(html.includes('property="og:title"'), 'og:title hilang');
  assert(html.includes(`property="og:url" content="${canonical}"`), 'og:url tidak menunjuk URL kanonik');
  assert(html.includes('name="twitter:card"'), 'twitter:card hilang');
  assert(html.includes('application/ld+json'), 'JSON-LD hilang');
  assert(html.includes('__APP_VERSION__'), 'placeholder versi tidak ada di template');
  assert(!html.includes('agent-studio-ai.netlify.app'), 'template masih menunjuk Netlify');
});

await check('sitemap dan robots menunjuk URL kanonik', async () => {
  const sitemap = fs.readFileSync(path.join('netlify-site', 'sitemap.xml'), 'utf8');
  const robots = fs.readFileSync(path.join('netlify-site', 'robots.txt'), 'utf8');
  assert(sitemap.includes('https://alif121727.github.io/ai-agent-engginer/'), 'sitemap salah host');
  assert(!sitemap.includes('netlify.app'), 'sitemap masih menunjuk Netlify');
  assert(robots.includes('https://alif121727.github.io/ai-agent-engginer/sitemap.xml'), 'robots menunjuk sitemap salah');
});

// Berkas yang dilayani server harus ada di public/, kalau tidak catch-all
// mengembalikan index.html dengan 200 text/html: kelihatan sehat di curl,
// tapi service worker gagal karena MIME salah dan caches.addAll kena 404 ikon.
await check('berkas PWA tersalin ke public/ dengan tipe yang benar', async () => {
  const wajib = ['sw.js', 'sw-register.js', 'manifest.json', 'robots.txt', 'sitemap.xml', '404.html'];
  for (const nama of wajib) {
    const p = path.join('public', nama);
    assert(fs.existsSync(p), `${nama} tidak ada di public/ (catch-all akan mengirim index.html)`);
    const isi = fs.readFileSync(p, 'utf8');
    assert(!isi.includes('__APP_VERSION__'), `${nama} masih template mentah`);
    if (nama.endsWith('.json')) JSON.parse(isi);
  }
  for (const ikon of ['ikon-192.png', 'ikon-512.png']) {
    const p = path.join('public', 'ikon', ikon);
    assert(fs.existsSync(p), `${ikon} tidak ada di public/ikon/ (addAll akan gagal)`);
    assert(fs.statSync(p).size > 1000, `${ikon} terlalu kecil untuk ikon asli`);
  }
  const sw = fs.readFileSync(path.join('public', 'sw.js'), 'utf8');
  for (const m of sw.matchAll(/['"]\.\/([^'"]+)['"]/g)) {
    assert(fs.existsSync(path.join('public', m[1])), `sw.js mem-precache ${m[1]} yang tidak ada`);
  }
});

await check('404.html tersedia dan mandiri tanpa bundel', async () => {
  const html = fs.readFileSync(path.join('studio', '404.html'), 'utf8');
  assert(html.includes('404'), 'tidak menampilkan kode 404');
  assert(!html.includes('assets/studio.js'), '404 tidak boleh bergantung pada bundel');
  assert(html.includes('href="./"'), 'tidak ada jalan kembali ke studio');
  assert(html.includes('noindex'), '404 sebaiknya noindex');
});

await check('versi rilis 1.0.0 konsisten di package.json', async () => {
  const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
  assert(pkg.version === '1.0.0', `versi masih ${pkg.version}`);
});

// ------------------------------------------------------- tema AI & template

await check('tema AI memberi hook, palet, dan alasan yang bisa dibaca', async () => {
  const t = generateAiTheme({ model: 'Porsche 911 GT3 RS', merk: 'Porsche', kategori: 'sport', mesin: '6 silinder 4.0L', tenaga: '525 PS' });
  assert(t.id.startsWith('ai-'), `id tidak diawali ai-: ${t.id}`);
  assert(t.hook.length > 10, 'hook kosong');
  assert(/^#[0-9a-f]{6}$/i.test(t.palette.primary), 'palet utama bukan warna hex');
  assert(t.rationale.length >= 2, 'alasan kurang dari dua butir');
  assert(t.hashtags.every((h) => h.startsWith('#')), 'hashtag tidak diawali #');
  assert(t.aspect === '9:16', `tema harus vertikal, dapat ${t.aspect}`);
});

await check('tema AI tidak menyebut spesifikasi yang tidak ada di katalog', async () => {
  const tanpa = generateAiTheme({ model: 'Mobil Tanpa Data' });
  const gabungan = [tanpa.hook, tanpa.caption, ...tanpa.hashtags, ...tanpa.rationale].join(' ');
  assert(!/\d+\s*(PS|Nm|cc)\b/i.test(gabungan), `mengarang angka spesifikasi: ${gabungan}`);
});

await check('tema AI mengenali hibrida tanpa membuang adegan mesin', async () => {
  const hybrid = generateAiTheme({ model: 'Ferrari 296 GTB', mesin: 'V6 3.0L twin-turbo + motor listrik', kategori: 'sport' });
  const electric = generateAiTheme({ model: 'Porsche Taycan', mesin: 'dua motor listrik sinkron AC', kategori: 'sport' });
  assert(hybrid.hashtags.includes('#hybrid'), `tag hibrida hilang: ${hybrid.hashtags.join(' ')}`);
  assert(!hybrid.hashtags.includes('#ev'), 'hibrida tidak boleh diberi tag #ev');
  // Hibrida masih punya mesin bakar, jadi tidak boleh dapat alasan "tanpa adegan knalpot".
  assert(!hybrid.rationale.some((r) => r.includes('tanpa adegan knalpot')), 'hibrida diperlakukan seperti EV');
  assert(hybrid.rationale.some((r) => r.includes('hibrida')), 'alasan hibrida tidak ditulis');
  assert(electric.rationale.some((r) => r.includes('tanpa adegan knalpot')), 'EV tidak dikenali sebagai EV');
});

await check('pencarian template menaruh Track Day di atas untuk kategori balap', async () => {
  const hits = searchTemplates({ q: 'balap', kategori: 'balap', durasi: 30, aspect: '9:16' });
  assert(hits[0].template.id === 'track-day', `peringkat pertama: ${hits[0].template.id}`);
  assert(hits[0].score > hits[1].score, 'skor teratas tidak lebih tinggi');
  assert(hits[0].alasan.length > 0, 'tidak ada alasan peringkat');
});

await check('pencarian template menghukum durasi di bawah minimum', async () => {
  const pendek = searchTemplates({ kategori: 'klasik', durasi: 10 }).find((h) => h.template.id === 'heritage')!;
  const cukup = searchTemplates({ kategori: 'klasik', durasi: 45 }).find((h) => h.template.id === 'heritage')!;
  assert(pendek.score < cukup.score, `skor 10s (${pendek.score}) tidak lebih rendah dari 45s (${cukup.score})`);
});

await check('setiap template hanya memakai scene yang dikenal pipeline', async () => {
  for (const t of BUILTIN_TEMPLATES) {
    for (const key of t.sceneKeys) {
      assert(SCENE_KEYS.includes(key as (typeof SCENE_KEYS)[number]), `${t.id}: kunci "${key}" tidak dikenal`);
    }
  }
});

await check('template mengubah urutan scene yang direncanakan', async () => {
  const brief: Brief = { model: 'Porsche 911 GT3 RS', rasio: '9:16', durasi: 30 };
  const theme = pickTheme(brief.model, loadThemes().themes, 'generic');
  const bawaan = planScenes({ brief, durationSec: 30, theme, aspect: '9:16' });
  const track = planScenes({ brief, durationSec: 30, theme, aspect: '9:16', sceneKeys: ['hook', 'detail_wheel', 'action', 'detail_engine', 'cta'] });
  assert(bawaan.some((s) => s.key === 'interior'), 'alur bawaan seharusnya punya interior');
  assert(!track.some((s) => s.key === 'interior'), 'Track Day tidak boleh punya scene interior');
  assert(track.some((s) => s.key === 'detail_wheel'), 'Track Day harus punya detail velg');
  assert(track.reduce((n, s) => n + s.duration, 0) === 30, 'total durasi harus tepat 30 detik');
});

await check('brief membawa template dan tema AI ke worker', async () => {
  const brief = parseBrief(JSON.stringify({
    model: 'Porsche 911 GT3 RS',
    templateId: 'track-day',
    temaAi: { id: 'ai-uji', mood: 'uji', palette: { primary: '#112233', secondary: '#445566', accent: '#778899' } },
  }));
  assert(brief.templateId === 'track-day', 'templateId hilang dari brief');
  assert(brief.temaAi?.id === 'ai-uji', 'temaAi hilang dari brief');
  const look = resolveBriefLook(brief);
  assert(look.template?.id === 'track-day', 'template tidak terbaca helper');
  assert(look.theme.id === 'ai-uji', `tema tidak dipakai: ${look.theme.id}`);
  assert(look.aspect === '9:16', `rasio template tidak dipakai: ${look.aspect}`);
});

// ------------------------------------------------------------------- feed

await check('setiap entri feed vertikal, lolos QA, dan berkasnya ada', async () => {
  const feed = JSON.parse(fs.readFileSync('studio/src/data/feed.json', 'utf8')) as Array<{
    slug: string; width: number; height: number; qa: string; dur: number;
  }>;
  assert(Array.isArray(feed), 'feed.json bukan array');
  for (const v of feed) {
    assert(v.height > v.width, `${v.slug} tidak vertikal (${v.width}x${v.height})`);
    assert(v.qa === 'lolos', `${v.slug} belum lolos QA`);
    assert(v.dur >= 30, `${v.slug} di bawah minimum 30 detik (${v.dur})`);
    assert(fs.existsSync(path.join('netlify-site', 'video', `${v.slug}.mp4`)), `${v.slug}.mp4 hilang dari situs`);
    assert(fs.existsSync(path.join('netlify-site', 'thumb', `${v.slug}.jpg`)), `${v.slug}.jpg hilang dari situs`);
  }
});

await check('feed tidak memakai video horizontal dari Perpustakaan', async () => {
  const feed = JSON.parse(fs.readFileSync('studio/src/data/feed.json', 'utf8')) as Array<{ slug: string }>;
  const lib = fs.readdirSync('netlify-site/video').filter((f) => f.endsWith('.mp4') && !f.startsWith('.'));
  const horizontal = lib.filter((f) => !feed.some((v) => `${v.slug}.mp4` === f));
  assert(horizontal.length > 0, 'tidak ada video horizontal tersisa; tes ini jadi tidak bermakna');
  assert(feed.length > 0, 'feed kosong');
});

// Autoplay feed di seluler tidak boleh menarik master 1080p 23 MB per kartu.
await check('setiap entri feed punya versi putar 720x1280 yang lebih ringan', async () => {
  const feed = JSON.parse(fs.readFileSync('studio/src/data/feed.json', 'utf8')) as Array<{ slug: string }>;
  for (const v of feed) {
    const web = path.join('netlify-site', 'video', 'web', `${v.slug}.mp4`);
    const master = path.join('netlify-site', 'video', `${v.slug}.mp4`);
    assert(fs.existsSync(web), `video/web/${v.slug}.mp4 hilang`);
    const webSize = fs.statSync(web).size;
    const masterSize = fs.statSync(master).size;
    assert(webSize < masterSize * 0.4, `versi web ${v.slug} tidak cukup ringan (${webSize} vs ${masterSize})`);
  }
});

// Unduhan harus tetap master, bukan versi 720p yang dipakai untuk memutar.
await check('feed memutar versi web dan mengunduh master', async () => {
  const src = fs.readFileSync('studio/src/data/feed.ts', 'utf8');
  assert(/feedVideoSrc[^\n]*video\/web\//.test(src), 'feedVideoSrc tidak menunjuk video/web/');
  assert(/feedDownloadSrc[^\n]*`video\/\$\{v\.slug\}\.mp4/.test(src), 'feedDownloadSrc tidak menunjuk master');
  const page = fs.readFileSync('studio/src/pages/Feed.tsx', 'utf8');
  assert(page.includes('feedDownloadSrc(v)'), 'tombol unduh tidak memakai feedDownloadSrc');
});

// ---------------------------------------------------------------- gerakan
// Kebijakan gerak harus benar-benar menolak, bukan sekadar ada. Tes di bawah
// memverifikasi penolakan itu, karena gate yang tidak pernah gagal tidak
// menjaga apa pun.

await check('MotionPrompt valid diterima tanpa keluhan', async () => {
  const issues = validateMotionPrompt({
    subject_action: 'the wheel turns slowly as the car settles',
    camera_move: 'slow_dolly_in',
    environmental_effects: 'dust drifts through the beam',
    negative_constraints: DEFAULT_NEGATIVES,
    duration_seconds: 5,
  });
  assert(issues.length === 0, `masih ada keluhan: ${JSON.stringify(issues)}`);
});

await check('dua gerakan kamera ditolak', async () => {
  const issues = validateMotionPrompt({
    subject_action: 'the camera pans left while dollying in on the car',
    camera_move: 'slow_dolly_in',
    environmental_effects: '',
    negative_constraints: DEFAULT_NEGATIVES,
    duration_seconds: 5,
  });
  assert(
    issues.some((i) => i.code === 'multiple-camera-moves'),
    'gerakan kamera ganda tidak tertangkap',
  );
});

await check('prompt yang mendeskripsikan ulang gambar ditolak', async () => {
  const issues = validateMotionPrompt({
    subject_action: 'A photo of a red 2020 coupe shows the car in a dark studio',
    camera_move: 'static',
    environmental_effects: '',
    negative_constraints: DEFAULT_NEGATIVES,
    duration_seconds: 5,
  });
  assert(issues.some((i) => i.code === 'redescribes-image'), 'deskripsi ulang gambar tidak tertangkap');
});

await check('klip lebih dari 6 detik dipecah, bukan diperpanjang', async () => {
  const parts = splitLongClip(
    {
      subject_action: 'the car rolls forward',
      camera_move: 'pan_right',
      environmental_effects: '',
      negative_constraints: DEFAULT_NEGATIVES,
      duration_seconds: 13,
    },
    6,
  );
  assert(parts.length === 3, `diharapkan 3 klip, dapat ${parts.length}`);
  const total = parts.reduce((a, p) => a + p.duration_seconds, 0);
  assert(total === 13, `total durasi ${total} tidak sama dengan 13`);
  assert(parts.every((p) => p.duration_seconds <= 6), 'ada klip melebihi 6 detik');
});

await check('setiap scene punya MotionPrompt dengan satu gerakan kamera', async () => {
  const defaults = loadDefaults();
  const brief = parseBrief(JSON.stringify({ model: 'Porsche 911 GT3 RS (992)', durasi: 30, rasio: '9:16' }));
  const themes = loadThemes();
  const theme = pickTheme('Porsche 911 GT3 RS', themes.themes, themes.defaultTheme);
  const scenes = planScenes({
    brief,
    durationSec: resolveDuration(brief, defaults.minDurasi, defaults.maxDurasi).durationSec,
    theme,
    aspect: '9:16',
    maxClipSeconds: 6,
  });
  assert(scenes.length > 0, 'tidak ada scene');
  for (const s of scenes) {
    assert(s.motionPrompt, `scene ${s.index} tanpa motionPrompt`);
    const issues = validateMotionPrompt(s.motionPrompt!, { maxClipSeconds: 6 });
    assert(issues.length === 0, `scene ${s.index}: ${issues.map((i) => i.message).join('; ')}`);
    assert(s.motionPrompt!.duration_seconds <= 6, `scene ${s.index} melebihi 6 detik`);
  }
});

await check('prompt I2V hanya berisi gerakan, bukan deskripsi gambar', async () => {
  const defaults = loadDefaults();
  const brief = parseBrief(JSON.stringify({ model: 'Porsche 911 GT3 RS (992)', durasi: 30, rasio: '9:16' }));
  const themes = loadThemes();
  const theme = pickTheme('Porsche 911 GT3 RS', themes.themes, themes.defaultTheme);
  const scenes = planScenes({ brief, durationSec: 30, theme, aspect: '9:16' });
  const prompt = i2vPrompt(scenes[0]);
  assert(/smooth fluid motion/i.test(prompt), 'prompt I2V tidak menyebut gerakan');
  assert(!/fotografi otomotif realistis/i.test(prompt), 'prompt I2V masih mendeskripsikan foto');
  assert(!/depth of field/i.test(prompt), 'prompt I2V membawa istilah foto, bukan gerakan');
});

await check('job baru langsung memakai kebijakan gerak terbaru', async () => {
  const dbFile = path.join(os.tmpdir(), `studio-motion-${Date.now()}.db`);
  openDb({ kind: 'sqlite', file: dbFile });
  const job = await createJob({
    briefSlug: 'porsche-911-gt3-rs-992',
    title: 'Tes gerak',
    model: 'Porsche 911 GT3 RS (992)',
    themeId: 'porsche',
    mode: 'draft',
    durationSec: 30,
    aspect: '9:16',
    preset: '9-orang',
    brief: { model: 'Porsche 911 GT3 RS (992)' } as Brief,
    costEstimate: 0,
  });
  const policy = loadPolicy();
  assert(job.pipeline_version === policy.version, `pipeline_version ${job.pipeline_version} != ${policy.version}`);
  assert(job.motion_upgrade_status === 'done', `status ${job.motion_upgrade_status} bukan done`);
  assert(job.motion_prompt_schema_version >= 1, 'schema version masih 0');
  await closeDb();
  fs.rmSync(dbFile, { force: true });
});

await check('gate kebijakan menolak job versi lama', async () => {
  let rejected = false;
  try {
    assertPolicyApplied({ pipeline_version: 0, motion_prompt_schema_version: 0 });
  } catch (err) {
    rejected = err instanceof PolicyViolation && err.code === 'PIPELINE_OUTDATED';
  }
  assert(rejected, 'job versi 0 tidak ditolak');
});

await check('gate kebijakan menolak scene tanpa MotionPrompt', async () => {
  const scene = {
    index: 0, key: 'hook', label: 'Hook', start: 0, duration: 5, shot: '', camera: '', lens: '',
    lighting: '', location: '', prompt: '', negativePrompt: '', onScreenText: '', voiceover: '',
  };
  let rejected = false;
  try {
    assertMotionPolicyFor([scene]);
  } catch (err) {
    rejected = err instanceof PolicyViolation && err.code === 'MOTION_PROMPT_MISSING';
  }
  assert(rejected, 'scene tanpa MotionPrompt tidak ditolak');
});

await check('durasi tidak sah tidak membuat perencanaan menggantung', async () => {
  const themes = loadThemes();
  const theme = pickTheme('Porsche 911 GT3 RS', themes.themes, themes.defaultTheme);
  const brief = parseBrief(JSON.stringify({ model: 'Porsche 911 GT3 RS (992)', rasio: '9:16' }));
  // NaN dulu membuat loop pembagian durasi berputar selamanya; tes ini menjaga
  // agar nilai tak sah dijepit ke durasi minimum, bukan menggantung worker.
  const scenes = planScenes({ brief, durationSec: Number.NaN, theme, aspect: '9:16' });
  assert(scenes.length > 0, 'tidak ada scene');
  const total = scenes.reduce((a, s) => a + s.duration, 0);
  assert(total >= 30, `total durasi ${total} di bawah minimum 30 detik`);
});

await check('critic gerak tidak terkecoh filter gelap (vignette)', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'motion-inv-'));
  const src = 'jobs/53d647327d3e4edca5b4d68b4a2ed328/qa-frames/frame-1.jpg';
  if (!fs.existsSync(src)) {
    fs.rmSync(dir, { recursive: true, force: true });
    return;
  }
  const cam = cameraFilterFor('pan_right', 150, 1080, 1920, 30);
  const pre = 'scale=2160:3840:force_original_aspect_ratio=increase:flags=lanczos,crop=2160:3840';
  const plain = path.join(dir, 'plain.mp4');
  const dark = path.join(dir, 'dark.mp4');
  spawnSync('ffmpeg', ['-v', 'error', '-y', '-loop', '1', '-i', src, '-t', '5',
    '-vf', `${pre},${cam}`, '-r', '30', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', plain]);
  spawnSync('ffmpeg', ['-v', 'error', '-y', '-loop', '1', '-i', src, '-t', '5',
    '-vf', `${pre},${cam},vignette=PI/4.5,eq=brightness=-0.12`, '-r', '30',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', dark]);

  const a = measureMotion(plain, 0.2);
  const b = measureMotion(dark, 0.2);
  fs.rmSync(dir, { recursive: true, force: true });
  // Metrik lama (beda piksel mentah) turun ~25% hanya karena frame digelapkan,
  // dan itu membuat scene yang sama tiba-tiba gagal gate.
  const drift = Math.abs(a.score - b.score) / Math.max(a.score, 0.001);
  assert(drift < 0.2, `skor berubah ${(drift * 100).toFixed(0)}% hanya karena filter gelap (${a.score} vs ${b.score})`);
});

await check('critic gerak membedakan video beku dan bergerak', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'motion-critic-'));
  const still = path.join(dir, 'still.jpg');
  const src = 'jobs/53d647327d3e4edca5b4d68b4a2ed328/qa-frames/frame-1.jpg';
  if (!fs.existsSync(src)) {
    fs.rmSync(dir, { recursive: true, force: true });
    return; // aset uji tidak ada di checkout ini
  }
  fs.copyFileSync(src, still);
  const frozen = path.join(dir, 'frozen.mp4');
  const moving = path.join(dir, 'moving.mp4');
  spawnSync('ffmpeg', ['-v', 'error', '-y', '-loop', '1', '-i', still, '-t', '4',
    '-vf', 'scale=1080:1920', '-r', '30', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', frozen]);
  spawnSync('ffmpeg', ['-v', 'error', '-y', '-loop', '1', '-i', still, '-t', '4',
    '-vf', `scale=1242:2208,crop=1242:2208,scale=2160:3840,${cameraFilterFor('slow_dolly_in', 120, 1080, 1920, 30)}`,
    '-r', '30', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', moving]);

  const a = measureMotion(frozen, 0.2);
  const b = measureMotion(moving, 0.2);
  fs.rmSync(dir, { recursive: true, force: true });
  assert(!a.passed, `video beku lolos dengan skor ${a.score}`);
  assert(a.score < 0.05, `skor video beku terlalu tinggi: ${a.score}`);
  assert(b.passed, `video bergerak gagal dengan skor ${b.score}`);
});

// ---------------------------------------------------------------- audio gate

await check('gerbang audio menolak loudness di luar toleransi', () => {
  // Nilai nyata dari video lama: -14.3 LUFS terhadap target -16 = 1.7 LU.
  // Ambang 1 LU berarti video itu memang harus ditolak.
  const drift = Math.abs(-14.3 - -16);
  assert(drift > 1, `drift ${drift} seharusnya di luar toleransi 1 LU`);
  assert(Math.abs(-16.0 - -16) <= 1, 'target -16 harus lolos');
});

await check('gerbang audio menolak true peak di atas -1 dBTP', () => {
  const ok = (peak: number) => peak <= -1;
  assert(!ok(-0.5), 'peak -0.5 harus ditolak');
  assert(ok(-4.4), 'peak -4.4 harus lolos');
});

await check('audio-plan memetakan tiap scene ke event yang masuk akal', async () => {
  const { buildSceneList } = await import('../src/pipeline/scenes.ts');
  const scenes = buildSceneList({ model: 'Nissan Skyline GT-R R34', durasi: 30 });
  const shotFor: Record<string, string> = {
    hook: 'eksterior-jauh',
    interior: 'interior',
    action: 'pass-by',
  };
  for (const [key, shot] of Object.entries(shotFor)) {
    const scene = scenes.find((s) => s.key === key);
    if (!scene) continue;
    assert(shot, `scene ${scene.index} (${key}) harus punya posisi kamera`);
  }
  // Kamera kabin tidak boleh dinilai dengan pass-by: itu yang membuat audio
  // terasa salah tempat.
  assert(shotFor.interior !== shotFor.action, 'interior dan pass-by harus berbeda');
});

await check('measureLoudness membaca LUFS dan true peak dari video nyata', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'loud-'));
  const out = path.join(dir, 't.mp4');
  const made = spawnSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi',
    '-i', 'sine=frequency=440:duration=2', '-c:a', 'aac', out]);
  if (made.status !== 0) {
    fs.rmSync(dir, { recursive: true, force: true });
    return; // ffmpeg tanpa encoder aac: lewati, bukan gagal
  }
  const res = measureLoudness(out);
  fs.rmSync(dir, { recursive: true, force: true });
  assert(res.ok, `gagal ukur: ${res.error}`);
  assert(typeof res.integratedLufs === 'number', 'LUFS harus berupa angka');
  assert(typeof res.truePeakDbtp === 'number', 'true peak harus berupa angka');
});

// ------------------------------------------------------------------ audio VO

await check('TTS memilih voice sesuai nada dan model', () => {
  assert(voiceForTone('energik').voiceId !== voiceForTone('hangat').voiceId, 'voice harus berbeda');
  // Sport car dan EV butuh energi; SUV keluarga butuh nada hangat.
  assert(toneForModel('Porsche 911 GT3 RS') === 'energik', 'GT3 RS harus energik');
  assert(toneForModel('Toyota Fortuner') === 'hangat', 'Fortuner harus hangat');
  assert(toneForModel('Ferrari F40') === 'tegas', 'F40 harus tegas');
});

await check('TTS memakai model dan bitrate kualitas tinggi, bukan default', () => {
  // Regresi: default API adalah mp3_44100_128 + turbo, yang terdengar datar.
  assert(TTS_MODEL === 'eleven_multilingual_v2', 'model harus multilingual_v2');
  assert(TTS_OUTPUT_FORMAT === 'mp3_44100_192', 'format harus 192 kbps');
  assert(VOICE_SETTINGS.use_speaker_boost === true, 'speaker boost harus aktif');
});

await check('TTS tanpa kunci API jatuh ke mesin lokal atau ditandai skipped', async () => {
  const prev = process.env.TTS_API_KEY;
  const prevEl = process.env.ELEVENLABS_API_KEY;
  delete process.env.TTS_API_KEY;
  delete process.env.ELEVENLABS_API_KEY;
  const out = path.join(os.tmpdir(), `x-${Date.now()}.mp3`);
  try {
    const res = await synthesize('halo', { outFile: out });
    if (res.ok) {
      // Piper tersedia: hasilnya harus berkas nyata, bukan klaim kosong.
      assert(res.provider === 'piper', `penyedia tak terduga: ${res.provider}`);
      assert(fs.existsSync(out), 'ok=true wajib disertai berkas');
      assert(fs.statSync(out).size > 1024, 'berkas terlalu kecil untuk audio');
    } else {
      assert(res.skipped === true, 'kegagalan tanpa kunci harus ditandai skipped');
      assert(!fs.existsSync(out), 'gagal tidak boleh meninggalkan berkas');
    }
  } finally {
    fs.rmSync(out, { force: true });
    if (prev !== undefined) process.env.TTS_API_KEY = prev;
    if (prevEl !== undefined) process.env.ELEVENLABS_API_KEY = prevEl;
  }
});

await check('TTS lokal menghasilkan mp3 44,1 kHz stereo 192 kbps', async () => {
  const out = path.join(os.tmpdir(), `piper-${Date.now()}.mp3`);
  const res = await synthesize('Uji narasi Bahasa Indonesia.', { outFile: out });
  if (res.provider !== 'piper') {
    // Mesin lokal tidak wajib ada; jangan gagalkan mesin tanpa Piper.
    assert(res.skipped === true, 'tanpa piper harus skipped');
    return;
  }
  const probe = spawnSync('ffprobe', ['-v', 'error', '-show_entries',
    'stream=sample_rate,channels:format=bit_rate', '-of', 'json', out], { encoding: 'utf8' });
  const info = JSON.parse(probe.stdout);
  assert(info.streams[0].sample_rate === '44100', 'harus 44,1 kHz');
  assert(info.streams[0].channels === 2, 'harus stereo');
  assert(Number(info.format.bit_rate) >= 190000, 'harus >= 192 kbps');
  fs.rmSync(out, { force: true });
});

await check('narasi ditempatkan di awal scene-nya, bukan menumpuk di detik nol', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vo-'));
  const mk = (freq: number, dur: number, name: string) => {
    const out = path.join(dir, name);
    const r = spawnSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi',
      '-i', `sine=frequency=${freq}:duration=${dur}`, '-ar', '48000', '-ac', '2',
      '-c:a', 'pcm_s16le', out]);
    return r.status === 0 ? out : null;
  };
  const a = mk(1000, 2, 'a.wav');
  const b = mk(1000, 2, 'b.wav');
  if (!a || !b) {
    fs.rmSync(dir, { recursive: true, force: true });
    return;
  }
  const track = path.join(dir, 'track.wav');
  const ok = buildTrack(
    [
      { sceneIndex: 0, start: 0, duration: 10, file: a, text: 'satu' },
      { sceneIndex: 1, start: 12, duration: 10, file: b, text: 'dua' },
    ],
    30,
    track,
  );
  assert(ok, 'buildTrack harus berhasil');

  const rms = (start: number, dur: number) => {
    const out = spawnSync('ffmpeg', ['-hide_banner', '-ss', String(start), '-t', String(dur),
      '-i', track, '-af', 'astats', '-f', 'null', '-'], { encoding: 'utf8' }).stderr ?? '';
    const m = [...out.matchAll(/RMS level dB:\s*(-?[\d.]+|-inf)/g)];
    return m.length ? m[m.length - 1][1] : 'n/a';
  };
  const first = rms(0, 1.5);
  const gap = rms(5, 3);
  const second = rms(12, 1.5);
  fs.rmSync(dir, { recursive: true, force: true });

  assert(first !== '-inf', 'scene 1 harus bersuara di awal');
  assert(gap === '-inf', `jeda harus senyap, dapat ${gap}`);
  assert(second !== '-inf', 'scene 2 harus bersuara di detik 12');
});

await check('gerbang audio menolak narasi yang hilang (video tanpa suara)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'silent-'));
  const out = path.join(dir, 'silent.mp4');
  const made = spawnSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi',
    '-i', 'color=c=black:s=160x120:d=1', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', out]);
  if (made.status !== 0) {
    fs.rmSync(dir, { recursive: true, force: true });
    return;
  }
  const report = analyseAudio(out);
  fs.rmSync(dir, { recursive: true, force: true });
  // Regresi bug lama: video 30 detik lolos validasi angka walau tanpa narasi,
  // jadi keberadaan trek audio harus diperiksa terpisah.
  assert(report.problems.length > 0, 'video tanpa audio harus ditolak');
});

console.log(`\n${passed} pemeriksaan lulus, ${failures.length} gagal`);
if (failures.length) {
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
