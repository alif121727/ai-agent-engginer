import '../core/env.ts';
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

// Satu container tidak bisa menjalankan dua proses, jadi host seperti Railway
// atau Fly cukup memakai satu container kalau worker ikut di proses ini.
// Default mati supaya `npm run api` + `npm run worker` tetap terpisah saat
// pengembangan (worker terpisah bisa di-restart tanpa memutus sesi pengguna).
const inProcessWorker = process.env.WORKER_IN_PROCESS === '1';
if (inProcessWorker) {
  await worker.start();
  logger('worker').info('worker berjalan di dalam proses API');
}

const shutdown = async () => {
  if (inProcessWorker) await worker.stop();
  server.close(() => process.exit(0));
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
