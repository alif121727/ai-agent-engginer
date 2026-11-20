import path from 'node:path';

/**
 * Loads `.env` from the project root once. Node does not read it on its own,
 * and both entrypoints (api, worker) rely on it for PORT/DB_PATH/API keys.
 * Real environment variables always win over the file.
 */
const file = path.join(path.resolve(new URL('../..', import.meta.url).pathname), '.env');

try {
  process.loadEnvFile(file);
} catch {
  // No .env is a valid setup: everything falls back to defaults or real env vars.
}
