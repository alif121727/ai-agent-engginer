import { getJob } from '../db/repo.ts';
import { recordEvent } from '../core/bus.ts';

export { getJob };

export async function recordEventSafe(
  jobId: string | null,
  level: 'info' | 'warn' | 'error',
  scope: string,
  message: string,
): Promise<void> {
  try {
    await recordEvent({ jobId, level, scope, message });
  } catch {
    // Publishing must not fail because the audit log is unavailable.
  }
}
