import path from 'node:path';
import fs from 'node:fs';

/**
 * Loads `.env` from the project root once. Node does not read it on its own,
 * and both entrypoints (api, worker) rely on it for PORT/DB_PATH/API keys.
 * Real environment variables always win over the file.
 */
const root = path.resolve(new URL('../..', import.meta.url).pathname);
const file = path.join(root, '.env');

try {
  process.loadEnvFile(file);
} catch {
  // No .env is a valid setup: everything falls back to defaults or real env vars.
}

/**
 * Sandbox ini me-reset PATH (dan paket apt) setiap container restart, sehingga
 * `ffmpeg` hilang dari PATH padahal binernya masih ada di disk. Tanpa ffmpeg
 * render tidak bisa jalan dan UI jatuh ke mode demo tanpa penjelasan.
 * Semua kode memanggil `spawnSync('ffmpeg')`, jadi cukup perbaiki PATH di sini
 * sekali agar API dan worker sama-sama menemukannya.
 */
const ffmpegDirs = [
  path.join(root, 'tools', 'bin'),
  '/workspace/tools/bin',
  '/usr/local/bin',
];

const hasFfmpegOnPath = (process.env.PATH ?? '')
  .split(path.delimiter)
  .some((dir) => {
    try {
      fs.accessSync(path.join(dir, 'ffmpeg'), fs.constants.X_OK);
      return true;
    } catch {
      return false;
    }
  });

if (!hasFfmpegOnPath) {
  const found = ffmpegDirs.find((dir) => {
    try {
      fs.accessSync(path.join(dir, 'ffmpeg'), fs.constants.X_OK);
      return true;
    } catch {
      return false;
    }
  });
  if (found) {
    process.env.PATH = `${found}${path.delimiter}${process.env.PATH ?? ''}`;
  }
}
