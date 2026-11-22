import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const ROOT = path.resolve(new URL('../..', import.meta.url).pathname);

export function ensureDir(dir: string): string {
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

// Host container memasang disk di luar /app, jadi direktori yang menyimpan data
// pengguna (akun, hasil render) harus bisa dialihkan lewat env. Tanpa ini
// semuanya ditulis ke filesystem container dan hilang setiap deploy.
const dataRoot = process.env.STUDIO_DATA_DIR
  ? path.resolve(process.env.STUDIO_DATA_DIR)
  : ROOT;

export const paths = {
  root: ROOT,
  config: path.join(ROOT, 'config'),
  input: path.join(ROOT, 'input'),
  jobs: process.env.STUDIO_JOBS_DIR ? path.resolve(process.env.STUDIO_JOBS_DIR) : path.join(dataRoot, 'jobs'),
  cache: path.join(ROOT, 'cache'),
  assets: path.join(ROOT, 'assets'),
  data: path.join(dataRoot, 'data'),
  publicDir: path.join(ROOT, 'public'),
  docsUi: path.join(ROOT, 'docs', 'ui'),
};

export function jobDir(jobId: string): string {
  return ensureDir(path.join(paths.jobs, jobId));
}

export function readJson<T>(file: string, fallback: T): T {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')) as T;
  } catch {
    return fallback;
  }
}

/** Write via temp file then rename, so a crash or network drop never leaves a half file. */
export function writeFileAtomic(file: string, contents: string | Buffer): void {
  const dir = ensureDir(path.dirname(file));
  const tmp = path.join(dir, `.${path.basename(file)}.${process.pid}.${Date.now()}.tmp`);
  fs.writeFileSync(tmp, contents);
  fs.renameSync(tmp, file);
}

export function writeJsonAtomic(file: string, value: unknown): void {
  writeFileAtomic(file, JSON.stringify(value, null, 2));
}

export function tmpPath(prefix: string, ext: string): string {
  const dir = ensureDir(path.join(os.tmpdir(), 'studio-tmp'));
  return path.join(dir, `${prefix}-${process.pid}-${Date.now()}${ext}`);
}

export function slugify(input: string): string {
  return input
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'job';
}
