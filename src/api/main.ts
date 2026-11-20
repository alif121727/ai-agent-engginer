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
app.listen(port, () => {
  logger('api').info(`API + UI berjalan di http://localhost:${port}`);
});
