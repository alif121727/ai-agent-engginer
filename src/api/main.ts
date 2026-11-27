import '../core/env.ts';
import { spawn, type ChildProcess } from 'node:child_process';
import { createApp } from './server.ts';
import { logger } from '../core/log.ts';
import { Worker } from '../worker/worker.ts';
import { loadDefaults } from '../core/config.ts';

const port = Number(process.env.PORT ?? 8080);
const defaults = loadDefaults();
const worker = new Worker({
  monitor: undefined,
  pollIntervalMs: defaults.connection.probeIntervalMs,
});

const { app } = createApp({ worker });
const server = app.listen(port, () => {
  logger('api').info(`API + UI berjalan di http://localhost:${port}`);
});

// Host satu container (Railway, Fly) memakai WORKER_IN_PROCESS=1, tetapi
// worker-nya dijalankan sebagai PROSES ANAK, bukan di proses API ini. Alasannya
// keras: render memakai spawnSync, yang memblokir seluruh event loop. Saat
// worker masih in-process, API berhenti menjawab selama render berjalan —
// health check Fly gagal, UI kehilangan progres, dan job 30 detik di mesin
// 2 vCPU terlihat seperti "macet". Dua proses berbagi /data dan SQLite (WAL),
// jadi tidak ada duplikasi state.
// Default mati supaya `npm run api` + `npm run worker` tetap terpisah saat
// pengembangan (worker terpisah bisa di-restart tanpa memutus sesi pengguna).
const spawnWorker = process.env.WORKER_IN_PROCESS === '1';
let workerChild: ChildProcess | null = null;
let berhenti = false;

function jalankanWorker(): void {
  workerChild = spawn(process.execPath, ['--experimental-strip-types', 'src/worker/main.ts'], {
    stdio: 'inherit',
    env: process.env,
  });
  workerChild.on('exit', (code, signal) => {
    workerChild = null;
    if (berhenti) return;
    logger('worker').warn(`proses worker berhenti (${code ?? signal}), dijalankan ulang`);
    setTimeout(() => {
      if (!berhenti) jalankanWorker();
    }, 2000);
  });
}

if (spawnWorker) {
  jalankanWorker();
  logger('worker').info('worker berjalan sebagai proses anak');
}

const shutdown = async () => {
  berhenti = true;
  workerChild?.kill('SIGTERM');
  server.close(() => process.exit(0));
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
