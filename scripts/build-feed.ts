/**
 * Menyalin video vertikal hasil render ke situs statis dan menulis feed.json.
 *
 * Semua metadata diturunkan dari artefak job asli (`plan.json`, `qa.json`,
 * `storyboard.json`) dan katalog. Tidak ada judul, tahun, atau spesifikasi yang
 * diketik tangan di sini — itu aturan utama proyek ini.
 *
 * Pakai: node --experimental-strip-types scripts/build-feed.ts <jobId> [...]
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { loadCatalog } from '../src/core/catalog.ts';
import { findTemplate } from '../src/core/templates.ts';
import { openDb, closeDb } from '../src/db/index.ts';
import { getJob } from '../src/db/repo.ts';
import type { Brief } from '../src/core/types.ts';

const OUT_VIDEO = 'netlify-site/video';
const OUT_THUMB = 'netlify-site/thumb';
// Ditulis ke dalam sumber studio supaya ikut ter-bundle esbuild; situs
// statis tidak perlu mengambil JSON terpisah saat runtime.
const FEED_JSON = 'studio/src/data/feed.json';

type FeedEntry = {
  slug: string;
  jobId: string;
  title: string;
  merk: string;
  tahun: string;
  kategori: string;
  dur: number;
  width: number;
  height: number;
  scenes: number;
  templateId: string | null;
  templateName: string | null;
  themeId: string;
  qa: 'lolos' | 'gagal';
  caption: string;
  hashtags: string[];
  renderedAt: string;
};

function readJson<T>(file: string): T | null {
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')) as T;
  } catch {
    return null;
  }
}

function run(cmd: string, args: string[]): void {
  const res = spawnSync(cmd, args, { encoding: 'utf8' });
  if (res.status !== 0) throw new Error(`${cmd} gagal: ${res.stderr?.slice(0, 300)}`);
}

function probe(file: string): { width: number; height: number } {
  const res = spawnSync(
    'ffprobe',
    ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', file],
    { encoding: 'utf8' },
  );
  const [w, h] = String(res.stdout).trim().split(',').map(Number);
  return { width: w, height: h };
}

const jobIds = process.argv.slice(2);
if (jobIds.length === 0) {
  console.error('Pakai: build-feed.ts <jobId> [...]');
  process.exit(1);
}

fs.mkdirSync(OUT_VIDEO, { recursive: true });
fs.mkdirSync(OUT_THUMB, { recursive: true });

openDb();
const catalog = loadCatalog();
const existing = readJson<FeedEntry[]>(FEED_JSON) ?? [];
const byJob = new Map(existing.map((e) => [e.jobId, e]));

for (const jobId of jobIds) {
  const dir = path.join('jobs', jobId);
  const video = path.join(dir, 'video.mp4');
  if (!fs.existsSync(video)) {
    console.error(`lewati ${jobId}: video.mp4 belum ada`);
    continue;
  }

  const plan = readJson<{ aspect?: string; themeId?: string; durationSec?: number; sceneKeys?: string[] }>(
    path.join(dir, 'artifacts', 'plan.json'),
  );
  const qa = readJson<{ passed?: boolean }>(path.join(dir, 'artifacts', 'qa.json'));
  const storyboard = readJson<Array<{ key: string; duration: number }>>(path.join(dir, 'artifacts', 'storyboard.json'));
  // Brief tinggal di database, bukan di artefak; job lama tanpa baris DB
  // dilewati supaya tidak ada metadata karangan.
  const row = await getJob(jobId);
  const brief = row ? (JSON.parse(row.brief_json) as Brief & { temaAi?: { caption?: string; hashtags?: string[] } }) : null;

  const { width, height } = probe(video);
  if (height <= width) {
    console.error(`lewati ${jobId}: bukan vertikal (${width}x${height})`);
    continue;
  }

  const model = brief?.model ?? plan?.themeId ?? jobId;
  const entry = catalog.models.find((m) => m.model.toLowerCase() === model.toLowerCase());
  const template = brief?.templateId ? findTemplate(brief.templateId) : undefined;
  // Slug pendek dan stabil: nama katalog + template, bukan id tema internal.
  const base = (entry?.slug ?? model).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const slug = `${base}-${(brief?.templateId ?? 'studio').toLowerCase()}`;

  fs.copyFileSync(video, path.join(OUT_VIDEO, `${slug}.mp4`));
  // Poster diambil dari detik ke-2, bukan frame 0: frame pertama sering masih
  // fade-in sehingga thumbnail terlihat hitam.
  run('ffmpeg', [
    '-v', 'error', '-y', '-ss', '2', '-i', video, '-frames:v', '1',
    '-vf', 'scale=405:-2', path.join(OUT_THUMB, `${slug}.jpg`),
  ]);

  byJob.set(jobId, {
    slug,
    jobId,
    title: entry?.model ?? model,
    merk: entry?.merk ?? '',
    tahun: entry?.tahun ?? '',
    kategori: entry?.kategori ?? '',
    dur: plan?.durationSec ?? storyboard?.reduce((n, s) => n + s.duration, 0) ?? 0,
    width,
    height,
    scenes: storyboard?.length ?? 0,
    templateId: brief?.templateId ?? null,
    templateName: template?.name ?? null,
    themeId: plan?.themeId ?? 'generic',
    qa: qa?.passed ? 'lolos' : 'gagal',
    caption: brief?.temaAi?.caption ?? '',
    hashtags: brief?.temaAi?.hashtags ?? [],
    renderedAt: fs.statSync(video).mtime.toISOString(),
  });
  console.log(`ok ${slug} ${width}x${height} ${plan?.durationSec ?? '?'}s template=${template?.name ?? '-'}`);
}

const feed = [...byJob.values()].sort((a, b) => b.renderedAt.localeCompare(a.renderedAt));
fs.writeFileSync(FEED_JSON, `${JSON.stringify(feed, null, 2)}\n`);
console.log(`feed.json: ${feed.length} entri`);
closeDb();
