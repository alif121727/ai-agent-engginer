import { EventEmitter } from 'node:events';
import { addLogSink } from '../core/log.ts';
import { insertEvent } from '../db/repo.ts';
import type { ConnectionStatus } from '../core/types.ts';

export interface BusEvent {
  type: 'log' | 'job' | 'stage' | 'connection' | 'agent' | 'studio' | 'cost';
  at: string;
  jobId?: string | null;
  agentId?: string | null;
  data: Record<string, unknown>;
}

class Bus extends EventEmitter {
  emitEvent(event: BusEvent): void {
    this.emit('event', event);
  }

  subscribe(fn: (e: BusEvent) => void): () => void {
    this.on('event', fn);
    return () => this.off('event', fn);
  }
}

export const bus = new Bus();
bus.setMaxListeners(200);

let connectionStatus: ConnectionStatus = 'ONLINE';

export function currentConnection(): ConnectionStatus {
  return connectionStatus;
}

export function setConnection(next: ConnectionStatus, reason: string): void {
  if (connectionStatus === next) return;
  connectionStatus = next;
  bus.emitEvent({
    type: 'connection',
    at: new Date().toISOString(),
    data: { status: next, reason },
  });
}

/** Bridge logger + persisted events + live SSE into one stream. */
export function wireBus(): void {
  addLogSink((entry) => {
    bus.emitEvent({
      type: 'log',
      at: entry.ts,
      data: { level: entry.level, scope: entry.scope, msg: entry.msg, data: entry.data },
    });
  });
}

export async function recordEvent(input: {
  jobId?: string | null;
  level: 'debug' | 'info' | 'warn' | 'error';
  scope: string;
  agentId?: string | null;
  message: string;
  data?: unknown;
}): Promise<void> {
  await insertEvent(input);
  bus.emitEvent({
    type: 'log',
    at: new Date().toISOString(),
    jobId: input.jobId ?? null,
    agentId: input.agentId ?? null,
    data: {
      level: input.level,
      scope: input.scope,
      msg: input.message,
      data: input.data,
    },
  });
}
