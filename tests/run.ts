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

await closeDb();
fs.rmSync(tmpRoot, { recursive: true, force: true });

console.log(`\n${passed} pemeriksaan lulus, ${failures.length} gagal`);
if (failures.length) {
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
