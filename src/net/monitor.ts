import { EventEmitter } from 'node:events';
import { defaultProbe, type ProbeFn } from './probe.ts';
import { logger } from '../core/log.ts';
import type { ConnectionStatus } from '../core/types.ts';

export interface MonitorOptions {
  probeUrls: string[];
  probeIntervalMs: number;
  probeTimeoutMs: number;
  failuresToOffline: number;
  successesToOnline: number;
  probe?: ProbeFn;
}

export interface MonitorSnapshot {
  status: ConnectionStatus;
  consecutiveFailures: number;
  consecutiveSuccesses: number;
  lastCheckAt: string | null;
  lastOkAt: string | null;
  lastReason: string;
}

/**
 * Hysteresis on purpose: one dropped packet must not pause a 20 minute render,
 * and one lucky reply must not resume work on a flaky link.
 */
export class ConnectionMonitor extends EventEmitter {
  #opts: MonitorOptions;
  #status: ConnectionStatus = 'ONLINE';
  #failures = 0;
  #successes = 0;
  #lastCheckAt: string | null = null;
  #lastOkAt: string | null = null;
  #lastReason = 'mulai';
  #timer: NodeJS.Timeout | null = null;
  #running = false;
  #probe: ProbeFn;

  constructor(opts: MonitorOptions) {
    super();
    this.#opts = opts;
    this.#probe = opts.probe ?? defaultProbe;
  }

  get status(): ConnectionStatus {
    return this.#status;
  }

  snapshot(): MonitorSnapshot {
    return {
      status: this.#status,
      consecutiveFailures: this.#failures,
      consecutiveSuccesses: this.#successes,
      lastCheckAt: this.#lastCheckAt,
      lastOkAt: this.#lastOkAt,
      lastReason: this.#lastReason,
    };
  }

  /** One probe round across all configured endpoints; a single success is enough. */
  async checkOnce(): Promise<ConnectionStatus> {
    const results = await Promise.all(
      this.#opts.probeUrls.map((url) => this.#probe(url, this.#opts.probeTimeoutMs)),
    );
    this.#lastCheckAt = new Date().toISOString();
    const anyOk = results.includes('ok');
    if (anyOk) {
      this.#lastOkAt = this.#lastCheckAt;
      this.#failures = 0;
      this.#successes += 1;
      if (this.#status === 'PAUSED_OFFLINE' && this.#successes >= this.#opts.successesToOnline) {
        this.#transition('ONLINE', `internet kembali (${this.#successes} keberhasilan berturut-turut)`);
      }
    } else {
      this.#successes = 0;
      this.#failures += 1;
      if (this.#status === 'ONLINE' && this.#failures >= this.#opts.failuresToOffline) {
        this.#transition('PAUSED_OFFLINE', `internet putus (${this.#failures} kegagalan berturut-turut)`);
      }
    }
    return this.#status;
  }

  #transition(next: ConnectionStatus, reason: string): void {
    const prev = this.#status;
    this.#status = next;
    this.#lastReason = reason;
    logger('net').warn(`status ${prev} -> ${next}: ${reason}`);
    this.emit('change', { from: prev, to: next, reason });
  }

  start(): void {
    if (this.#running) return;
    this.#running = true;
    const tick = async () => {
      if (!this.#running) return;
      try {
        await this.checkOnce();
      } catch (err) {
        logger('net').error('probe error', err);
      }
      if (this.#running) this.#timer = setTimeout(tick, this.#opts.probeIntervalMs);
    };
    this.#timer = setTimeout(tick, 0);
  }

  stop(): void {
    this.#running = false;
    if (this.#timer) clearTimeout(this.#timer);
    this.#timer = null;
  }

  /** Test hook: force a status without waiting for probes. */
  forceStatus(status: ConnectionStatus, reason = 'dipaksa oleh tes'): void {
    this.#transition(status, reason);
  }
}
