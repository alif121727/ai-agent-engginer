import { logger } from '../core/log.ts';
import { bus, recordEvent, setConnection } from '../core/bus.ts';
import { ConnectionMonitor } from '../net/monitor.ts';
import { loadDefaults } from '../core/config.ts';
import {
  claimNextJob,
  getJob,
  listActiveJobs,
  listStages,
  nextPendingStage,
  pauseAllOffline,
  resumeAllOffline,
  setStageStatus,
  updateJob,
  dailyCost,
  addDailyCost,
} from '../db/repo.ts';
import { runStage } from '../agents/runner.ts';
import { isStageComplete, clearCheckpoint } from '../pipeline/checkpoint.ts';
import type { Brief, ConnectionStatus } from '../core/types.ts';
import { bus as _bus } from '../core/bus.ts';

export interface WorkerOptions {
  pollIntervalMs?: number;
  monitor?: ConnectionMonitor;
}

export class Worker {
  #monitor: ConnectionMonitor;
  #pollMs: number;
  #running = false;
  #busy = false;
  #timer: NodeJS.Timeout | null = null;
  #stopping = false;

  constructor(opts: WorkerOptions = {}) {
    const defaults = loadDefaults();
    this.#monitor =
      opts.monitor ??
      new ConnectionMonitor({
        probeUrls: defaults.connection.probeUrls,
        probeIntervalMs: defaults.connection.probeIntervalMs,
        probeTimeoutMs: defaults.connection.probeTimeoutMs,
        failuresToOffline: defaults.connection.failuresToOffline,
        successesToOnline: defaults.connection.successesToOnline,
      });
    this.#pollMs = opts.pollIntervalMs ?? 1500;
    this.#monitor.on('change', async ({ to, reason }: { to: ConnectionStatus; reason: string }) => {
      setConnection(to, reason);
      if (to === 'PAUSED_OFFLINE') {
        const paused = await pauseAllOffline();
        await recordEvent({
          level: 'warn',
          scope: 'net',
          message: `internet putus: ${paused.length} job dijeda`,
          data: { jobs: paused, reason },
        });
      } else {
        const resumed = await resumeAllOffline();
        await recordEvent({
          level: 'info',
          scope: 'net',
          message: `internet kembali: ${resumed.length} job dilanjutkan`,
          data: { jobs: resumed },
        });
      }
    });
  }

  get monitor(): ConnectionMonitor {
    return this.#monitor;
  }

  async start(): Promise<void> {
    this.#running = true;
    this.#monitor.start();
    const loop = async () => {
      if (!this.#running) return;
      if (!this.#busy) {
        this.#busy = true;
        try {
          await this.tick();
        } catch (err) {
          logger('worker').error('tick gagal', err);
        } finally {
          this.#busy = false;
        }
      }
      if (this.#running) this.#timer = setTimeout(loop, this.#pollMs);
    };
    this.#timer = setTimeout(loop, 0);
    logger('worker').info('worker berjalan');
  }

  async stop(): Promise<void> {
    this.#running = false;
    this.#monitor.stop();
    if (this.#timer) clearTimeout(this.#timer);
    this.#timer = null;
    this.#stopping = true;
  }

  isOffline(): boolean {
    return this.#monitor.status === 'PAUSED_OFFLINE';
  }

  /** Process at most one queued job; exported so tests can drive it. */
  async tick(): Promise<void> {
    if (this.isOffline()) return;
    const job = await claimNextJob();
    if (!job) return;
    await this.runJob(job.id);
  }

  async runJob(jobId: string): Promise<void> {
    const job = await getJob(jobId);
    if (!job) return;
    const defaults = loadDefaults();
    const brief = JSON.parse(job.brief_json) as Brief;

    // Cost gate: nothing renders until the user approves an over-budget job.
    if (job.cost_estimate > defaults.cost.maxCostPerJob) {
      await updateJob(job.id, { status: 'awaiting_cost_approval' });
      await recordEvent({
        jobId: job.id,
        level: 'warn',
        scope: 'cost',
        message: `estimasi ${job.cost_estimate} melewati batas ${defaults.cost.maxCostPerJob}, menunggu persetujuan`,
      });
      return;
    }
    const spent = await dailyCost();
    if (spent + job.cost_estimate > defaults.cost.maxCostPerHari) {
      await updateJob(job.id, { status: 'awaiting_cost_approval' });
      await recordEvent({
        jobId: job.id,
        level: 'warn',
        scope: 'cost',
        message: `biaya hari ini ${spent.toFixed(2)} + estimasi ${job.cost_estimate} melewati batas harian`,
      });
      return;
    }

    try {
      for (;;) {
        if (this.isOffline()) {
          await updateJob(job.id, { status: 'paused_offline' });
          return;
        }
        const stage = await nextPendingStage(job.id);
        if (!stage) break;

        if (isStageComplete(job.id, stage.name) && stage.status === 'pending') {
          await setStageStatus(stage.id, 'done', { progress: 100, message: 'dari checkpoint' });
          continue;
        }

        await setStageStatus(stage.id, 'running', { incrementAttempts: true });
        await updateJob(job.id, { checkpoint_stage: stage.name });
        _bus.emitEvent({
          type: 'stage',
          at: new Date().toISOString(),
          jobId: job.id,
          agentId: stage.agent_id,
          data: { stage: stage.name, status: 'running' },
        });

        const outcome = await runStage({
          jobId: job.id,
          agentId: stage.agent_id,
          brief,
          isOffline: () => this.isOffline(),
          setStageMessage: async (msg) => setStageStatus(stage.id, 'running', { message: msg }),
          setStageProgress: async (pct) => {
            await setStageStatus(stage.id, 'running', { progress: pct });
            const stages = await listStages(job.id);
            const total = stages.reduce((sum, s) => sum + (s.status === 'done' ? 100 : s.progress), 0);
            const progress = Math.round(total / Math.max(1, stages.length));
            await updateJob(job.id, { progress });
            _bus.emitEvent({
              type: 'stage',
              at: new Date().toISOString(),
              jobId: job.id,
              agentId: stage.agent_id,
              data: { stage: stage.name, status: 'running', progress: pct, jobProgress: progress },
            });
          },
        });

        if (outcome.offline) {
          await setStageStatus(stage.id, 'pending', { message: 'dijeda: internet putus' });
          await updateJob(job.id, { status: 'paused_offline' });
          return;
        }
        if (outcome.costApproval) {
          await setStageStatus(stage.id, 'pending', { message: 'menunggu persetujuan biaya' });
          await updateJob(job.id, { status: 'awaiting_cost_approval' });
          return;
        }
        if (!outcome.ok) {
          const stages = await listStages(job.id);
          const current = stages.find((s) => s.id === stage.id);
          if (outcome.permanent || (current?.attempts ?? 0) >= 3) {
            await setStageStatus(stage.id, 'failed', { message: outcome.error ?? 'gagal' });
            await updateJob(job.id, { status: 'failed', error: outcome.error ?? 'tahap gagal' });
            await recordEvent({
              jobId: job.id,
              level: 'error',
              scope: 'worker',
              message: `job gagal di tahap ${stage.name} setelah 3 percobaan`,
            });
            return;
          }
          await setStageStatus(stage.id, 'failed', { message: outcome.error ?? 'gagal' });
          await recordEvent({
            jobId: job.id,
            level: 'warn',
            scope: 'worker',
            message: `tahap ${stage.name} gagal, akan dicoba ulang`,
            data: { error: outcome.error, attempts: current?.attempts },
          });
          continue;
        }

        await setStageStatus(stage.id, 'done', { progress: 100 });
        await recordEvent({
          jobId: job.id,
          level: 'info',
          scope: 'worker',
          message: `tahap ${stage.name} selesai`,
        });
      }

      const stages = await listStages(job.id);
      const failed = stages.filter((s) => s.status === 'failed');
      if (failed.length) {
        await updateJob(job.id, { status: 'failed', error: 'ada tahap gagal' });
        return;
      }
      await updateJob(job.id, { status: 'done', progress: 100, checkpoint_stage: 'selesai' });
      await addDailyCost(job.cost_actual || job.cost_estimate);
      await recordEvent({ jobId: job.id, level: 'info', scope: 'worker', message: 'job selesai' });
      _bus.emitEvent({
        type: 'job',
        at: new Date().toISOString(),
        jobId: job.id,
        data: { status: 'done' },
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await updateJob(job.id, { status: 'failed', error: message });
      await recordEvent({ jobId: job.id, level: 'error', scope: 'worker', message: `job gagal: ${message}` });
    }
  }

  /** Resume a paused job after the user approves its cost. */
  async approveCost(jobId: string): Promise<void> {
    const job = await getJob(jobId);
    if (!job) throw new Error('job tidak ada');
    await updateJob(job.id, { status: 'queued' });
    await recordEvent({
      jobId: job.id,
      level: 'info',
      scope: 'cost',
      message: 'biaya disetujui pengguna, job masuk antrean lagi',
    });
  }
}

export { bus };
