import { db, uuid, now, type Row } from './index.ts';
import type { Brief, JobStatus, StageStatus } from '../core/types.ts';

export interface Job {
  id: string;
  brief_slug: string;
  title: string;
  model: string;
  theme_id: string;
  mode: 'draft' | 'final';
  status: JobStatus;
  progress: number;
  duration_sec: number;
  aspect: string;
  preset: string;
  brief_json: string;
  plan_json: string | null;
  cost_estimate: number;
  cost_actual: number;
  error: string | null;
  checkpoint_stage: string | null;
  scheduled_at: string | null;
  published_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface Stage {
  id: string;
  job_id: string;
  agent_id: string;
  name: string;
  status: StageStatus;
  attempts: number;
  progress: number;
  message: string | null;
  started_at: string | null;
  finished_at: string | null;
  updated_at: string;
}

export async function createJob(input: {
  briefSlug: string;
  title: string;
  model: string;
  themeId: string;
  mode: 'draft' | 'final';
  durationSec: number;
  aspect: string;
  preset: string;
  brief: Brief;
  costEstimate: number;
  scheduledAt?: string | null;
}): Promise<Job> {
  const id = uuid();
  const ts = now();
  await db().run(
    `INSERT INTO jobs (id, brief_slug, title, model, theme_id, mode, status, progress, duration_sec, aspect,
      preset, brief_json, cost_estimate, cost_actual, scheduled_at, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      id,
      input.briefSlug,
      input.title,
      input.model,
      input.themeId,
      input.mode,
      'queued',
      0,
      input.durationSec,
      input.aspect,
      input.preset,
      JSON.stringify(input.brief),
      input.costEstimate,
      0,
      input.scheduledAt ?? null,
      ts,
      ts,
    ],
  );
  return (await getJob(id))!;
}

export async function getJob(id: string): Promise<Job | undefined> {
  return db().get<Job>('SELECT * FROM jobs WHERE id = ?', [id]);
}

export async function listJobs(limit = 50): Promise<Job[]> {
  return db().all<Job>('SELECT * FROM jobs ORDER BY created_at DESC LIMIT ?', [limit]);
}

export async function listActiveJobs(): Promise<Job[]> {
  return db().all<Job>(
    `SELECT * FROM jobs WHERE status IN ('queued','running','paused_offline','awaiting_cost_approval','awaiting_review')
     ORDER BY created_at ASC`,
  );
}

export async function updateJob(id: string, patch: Partial<Job>): Promise<void> {
  const keys = Object.keys(patch).filter((k) => k !== 'id');
  if (!keys.length) return;
  const sets = keys.map((k) => `${k} = ?`).join(', ');
  const values = keys.map((k) => (patch as Row)[k] as string | number | null);
  await db().run(`UPDATE jobs SET ${sets}, updated_at = ? WHERE id = ?`, [...values, now(), id]);
}

/** Atomically claim one queued job. Returns undefined when the queue is empty. */
/**
 * The UPDATE is the claim. Two workers polling at once both read the same
 * `queued` row, so only the worker whose UPDATE changed a row may run the job;
 * the loser retries with the next candidate. Checking the status afterwards
 * instead would let both proceed and interleave writes in the same job folder.
 */
export async function claimNextJob(): Promise<Job | undefined> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const candidate = await db().get<Job>(
      `SELECT * FROM jobs WHERE status = 'queued' ORDER BY created_at ASC LIMIT 1`,
    );
    if (!candidate) return undefined;
    const changed = await db().run(
      `UPDATE jobs SET status = 'running', updated_at = ? WHERE id = ? AND status = 'queued'`,
      [now(), candidate.id],
    );
    if (changed === 1) return getJob(candidate.id);
  }
  return undefined;
}

export async function pauseAllOffline(): Promise<string[]> {
  const active = await db().all<Job>(
    `SELECT id FROM jobs WHERE status IN ('queued','running')`,
  );
  for (const row of active) {
    await db().run(`UPDATE jobs SET status = 'paused_offline', updated_at = ? WHERE id = ?`, [
      now(),
      row.id as string,
    ]);
  }
  return active.map((r) => r.id as string);
}

export async function resumeAllOffline(): Promise<string[]> {
  const paused = await db().all<Job>(`SELECT id FROM jobs WHERE status = 'paused_offline'`);
  for (const row of paused) {
    await db().run(`UPDATE jobs SET status = 'queued', updated_at = ? WHERE id = ?`, [
      now(),
      row.id as string,
    ]);
  }
  return paused.map((r) => r.id as string);
}

// ---------- stages ----------

export async function createStages(
  jobId: string,
  stages: { agentId: string; name: string }[],
): Promise<void> {
  const ts = now();
  let ord = 0;
  for (const stage of stages) {
    await db().run(
      `INSERT INTO job_stages (id, job_id, agent_id, name, ord, status, attempts, progress, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?)`,
      [uuid(), jobId, stage.agentId, stage.name, ord++, 'pending', 0, 0, ts],
    );
  }
}

export async function listStages(jobId: string): Promise<Stage[]> {
  return db().all<Stage>('SELECT * FROM job_stages WHERE job_id = ? ORDER BY ord ASC', [jobId]);
}

export async function setStageStatus(
  stageId: string,
  status: StageStatus,
  patch: { progress?: number; message?: string | null; incrementAttempts?: boolean } = {},
): Promise<void> {
  const ts = now();
  const sets: string[] = ['status = ?', 'updated_at = ?'];
  const values: (string | number | null)[] = [status, ts];
  if (patch.progress !== undefined) {
    sets.push('progress = ?');
    values.push(patch.progress);
  }
  if (patch.message !== undefined) {
    sets.push('message = ?');
    values.push(patch.message);
  }
  if (status === 'running') {
    sets.push('started_at = COALESCE(started_at, ?)');
    values.push(ts);
  }
  if (status === 'done' || status === 'failed' || status === 'skipped') {
    sets.push('finished_at = ?');
    values.push(ts);
  }
  if (patch.incrementAttempts) sets.push('attempts = attempts + 1');
  values.push(stageId);
  await db().run(`UPDATE job_stages SET ${sets.join(', ')} WHERE id = ?`, values);
}

export async function resetStage(stageId: string): Promise<void> {
  await db().run(
    `UPDATE job_stages SET status = 'pending', progress = 0, message = NULL, started_at = NULL,
       finished_at = NULL, updated_at = ? WHERE id = ?`,
    [now(), stageId],
  );
}

export async function nextPendingStage(jobId: string): Promise<Stage | undefined> {
  return db().get<Stage>(
    `SELECT * FROM job_stages WHERE job_id = ? AND status IN ('pending','failed') ORDER BY ord ASC LIMIT 1`,
    [jobId],
  );
}

// ---------- events ----------

export async function insertEvent(input: {
  jobId?: string | null;
  level: string;
  scope: string;
  agentId?: string | null;
  message: string;
  data?: unknown;
}): Promise<void> {
  await db().run(
    `INSERT INTO job_events (id, job_id, level, scope, agent_id, message, data_json, created_at)
     VALUES (?,?,?,?,?,?,?,?)`,
    [
      uuid(),
      input.jobId ?? null,
      input.level,
      input.scope,
      input.agentId ?? null,
      input.message,
      input.data === undefined ? null : JSON.stringify(input.data),
      now(),
    ],
  );
}

export async function listEvents(jobId: string | null, limit = 200, level?: string): Promise<Row[]> {
  if (jobId) {
    const rows = level
      ? await db().all(
          `SELECT * FROM job_events WHERE job_id = ? AND level = ? ORDER BY created_at DESC LIMIT ?`,
          [jobId, level, limit],
        )
      : await db().all(`SELECT * FROM job_events WHERE job_id = ? ORDER BY created_at DESC LIMIT ?`, [
          jobId,
          limit,
        ]);
    return rows.reverse();
  }
  return db().all(`SELECT * FROM job_events ORDER BY created_at DESC LIMIT ?`, [limit]);
}

// ---------- settings & cost ----------

export async function getSetting<T>(key: string, fallback: T): Promise<T> {
  const row = await db().get<{ value: string }>('SELECT value FROM settings WHERE key = ?', [key]);
  if (!row) return fallback;
  try {
    return JSON.parse(row.value) as T;
  } catch {
    return fallback;
  }
}

export async function setSetting(key: string, value: unknown): Promise<void> {
  const ts = now();
  const existing = await db().get<{ key: string }>('SELECT key FROM settings WHERE key = ?', [key]);
  if (existing) {
    await db().run('UPDATE settings SET value = ?, updated_at = ? WHERE key = ?', [
      JSON.stringify(value),
      ts,
      key,
    ]);
  } else {
    await db().run('INSERT INTO settings (key, value, updated_at) VALUES (?,?,?)', [
      key,
      JSON.stringify(value),
      ts,
    ]);
  }
}

export function todayKey(d = new Date()): string {
  return d.toISOString().slice(0, 10);
}

export async function addDailyCost(amount: number): Promise<number> {
  const day = todayKey();
  const row = await db().get<{ amount: number }>('SELECT amount FROM daily_costs WHERE day = ?', [day]);
  if (row) {
    const next = Number(row.amount) + amount;
    await db().run('UPDATE daily_costs SET amount = ? WHERE day = ?', [next, day]);
    return next;
  }
  await db().run('INSERT INTO daily_costs (day, amount) VALUES (?,?)', [day, amount]);
  return amount;
}

export async function dailyCost(day = todayKey()): Promise<number> {
  const row = await db().get<{ amount: number }>('SELECT amount FROM daily_costs WHERE day = ?', [day]);
  return Number(row?.amount ?? 0);
}
