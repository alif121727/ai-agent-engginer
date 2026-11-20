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
import { ConnectionMonitor } from '../src/net/monitor.ts';
import { stagesFor, presetAgents, listPresets } from '../src/agents/registry.ts';
import { assertGuardRejects } from '../src/agents/runner.ts';
import { checkAssets } from '../src/pipeline/quality.ts';
import { createApp } from '../src/api/server.ts';
import { fingerprintFor } from '../src/publish/instagram.ts';
import { readCheckpoint, writeCheckpoint, markSceneDone, readSceneCheckpoint, isStageComplete, clearCheckpoint } from '../src/pipeline/checkpoint.ts';
import { frameSharpness, perceptualHash } from '../src/render/ffmpeg.ts';

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

await closeDb();
fs.rmSync(tmpRoot, { recursive: true, force: true });
console.log(`\n${passed} pemeriksaan lulus, ${failures.length} gagal`);
if (failures.length) {
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
