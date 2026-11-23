// Ekspor semua job nyata (DB + artifacts + video) menjadi satu snapshot JSON
// yang bisa dibaca UI statis tanpa server. Dipakai supaya Netlify/Pages
// menampilkan proyek yang benar-benar pernah dirender, bukan benih karangan.
//
// Pakai: node --experimental-strip-types scripts/export-projects.ts [outDir]
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(import.meta.dirname, '..');
const OUT_DIR = process.argv[2] ? path.resolve(process.argv[2]) : path.join(ROOT, 'netlify-site', 'data');

type Row = {
  id: string;
  title: string;
  model: string;
  status: string;
  duration_sec: number;
  aspect: string;
  created_at: string;
  updated_at: string;
  error: string | null;
  brief_json: string | null;
};

type Snapshot = {
  generatedAt: string;
  total: number;
  projects: Array<Record<string, unknown>>;
};

function readJson<T = any>(p: string): T | null {
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8')) as T;
  } catch {
    return null;
  }
}

function jobRows(): Row[] {
  const dbPath = process.env.DB_PATH ?? path.join(ROOT, 'data', 'studio.db');
  if (!fs.existsSync(dbPath)) return [];
  const { DatabaseSync } = require('node:sqlite') as typeof import('node:sqlite');
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    return db
      .prepare(
        `select id,title,model,status,duration_sec,aspect,created_at,updated_at,error,brief_json
         from jobs order by created_at desc`,
      )
      .all() as unknown as Row[];
  } finally {
    db.close();
  }
}

function build(row: Row) {
  const dir = path.join(ROOT, 'jobs', row.id);
  const art = (n: string) => readJson<any>(path.join(dir, 'artifacts', `${n}.json`));
  const videoFile = path.join(dir, 'video.mp4');
  const previewFile = path.join(dir, 'preview.jpg');
  const hasVideo = fs.existsSync(videoFile) && fs.statSync(videoFile).size > 1000;

  const plan = art('plan');
  const qa = art('qa');
  const render = art('render') ?? art('render-result');
  const research = art('research');
  const script = art('script');

  return {
    id: row.id,
    title: row.title,
    model: row.model,
    status: hasVideo ? 'done' : row.status,
    durationSec: render?.durationSec ?? plan?.durationSec ?? row.duration_sec,
    aspect: render?.aspect ?? plan?.aspect ?? row.aspect,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    // Hanya ditandai tersedia bila berkasnya benar-benar ada; UI tidak boleh
    // menawarkan unduhan yang berakhir 404.
    hasVideo,
    videoPath: hasVideo ? `video/${row.id}.mp4` : null,
    thumbPath: fs.existsSync(previewFile) ? `thumb/${row.id}.jpg` : null,
    sizeBytes: hasVideo ? fs.statSync(videoFile).size : 0,
    render: render
      ? { width: render.width, height: render.height, fps: render.fps, codec: render.codec, scenes: render.scenes, bitrateKbps: render.bitrateKbps, hasAudio: render.hasAudio }
      : null,
    qa: qa ? { passed: Boolean(qa.passed), checks: qa.checks?.length ?? 0, failed: (qa.checks ?? []).filter((c: any) => !c.ok).length } : null,
    // research.json menyimpan specs sebagai {text, source}; UI butuh teks saja.
    // Diterima juga bentuk string agar snapshot lama tidak pecah.
    specs: Array.isArray(research?.specs)
      ? research.specs.map((x: any) => (typeof x === 'string' ? x : x?.text)).filter((x: any): x is string => typeof x === 'string')
      : null,
    sceneCount: plan?.sceneCount ?? render?.scenes ?? null,
    themeId: plan?.themeId ?? null,
    scriptTitle: script?.title ?? null,
    error: row.error ?? null,
  };
}

const rows = jobRows();
const projects = rows.map(build);
const snapshot: Snapshot = {
  generatedAt: new Date().toISOString(),
  total: projects.length,
  projects,
};

fs.mkdirSync(OUT_DIR, { recursive: true });
const out = path.join(OUT_DIR, 'projects.json');
fs.writeFileSync(out, JSON.stringify(snapshot));

// Salin media dengan nama id job supaya `videoPath`/`thumbPath` di snapshot
// benar-benar bisa dibuka. Tanpa ini UI menawarkan pemutar yang 404.
const siteDir = path.dirname(OUT_DIR);
const vidDir = path.join(siteDir, 'video');
const thumbDir = path.join(siteDir, 'thumb');
fs.mkdirSync(vidDir, { recursive: true });
fs.mkdirSync(thumbDir, { recursive: true });

let skipped = 0;
let transcoded = 0;

// Video asli 1080p bisa 40 MB per menit. Untuk web cukup 720p CRF 28: rasio
// terukur ~13%, jadi 914 MB menjadi ~120 MB dan masih tajam di layar.
// Berkas asli di jobs/ tidak disentuh — ini hanya salinan untuk situs statis.
const WEB_MAX_BYTES = 8 * 1024 * 1024;

function transcode(src: string, dst: string): boolean {
  const r = spawnSync(
    'ffmpeg',
    ['-y', '-i', src, '-vf', 'scale=-2:720', '-c:v', 'libx264', '-crf', '28', '-preset', 'veryfast', '-c:a', 'aac', '-b:a', '96k', '-movflags', '+faststart', dst],
    { stdio: 'ignore' },
  );
  return r.status === 0 && fs.existsSync(dst) && fs.statSync(dst).size > 1000;
}

for (const p of projects) {
  const id = p.id as string;
  if (p.hasVideo) {
    const src = path.join(ROOT, 'jobs', id, 'video.mp4');
    const dst = path.join(vidDir, `${id}.mp4`);
    // Berkas >8 MB pasti sisa salinan penuh dari ekspor lama: transcode ulang.
    if (!fs.existsSync(dst) || fs.statSync(dst).size > WEB_MAX_BYTES) {
      if (transcode(src, dst)) transcoded++;
    } else {
      skipped++;
    }
    p.videoPath = `video/${id}.mp4`;
    p.sizeBytes = fs.statSync(dst).size;
  }
  const thumbSrc = path.join(ROOT, 'jobs', id, 'preview.jpg');
  if (fs.existsSync(thumbSrc)) {
    const dst = path.join(thumbDir, `${id}.jpg`);
    if (!fs.existsSync(dst)) fs.copyFileSync(thumbSrc, dst);
  }
}

// Ukuran yang dilaporkan harus ukuran berkas web, bukan aslinya.
fs.writeFileSync(out, JSON.stringify(snapshot));

const withVideo = projects.filter((p) => p.hasVideo).length;
console.log(`snapshot: ${projects.length} proyek (${withVideo} punya video) -> ${path.relative(ROOT, out)}`);
console.log(`media: ${transcoded} video di-transcode 720p, ${skipped} sudah siap`);
