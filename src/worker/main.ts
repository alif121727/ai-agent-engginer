import { Worker } from './worker.ts';
import { logger } from '../core/log.ts';
import { wireBus } from '../core/bus.ts';

wireBus();
const worker = new Worker();
await worker.start();
logger('worker').info('worker siap menerima tugas');

const shutdown = async () => {
  logger('worker').info('menghentikan worker…');
  await worker.stop();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
