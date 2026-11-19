import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { db, uuid, now } from '../db/index.ts';
import { getJob, recordEventSafe } from './helpers.ts';
import { jobDir } from '../core/fsx.ts';
import { loadDefaults } from '../core/config.ts';

export interface PublishInput {
  jobId: string;
  platform: string;
  dryRun: boolean;
  caption?: string;
  scheduledAt?: string | null;
}

export interface PublishResult {
  id: string;
  status: string;
  remoteId: string | null;
  dryRun: boolean;
  fingerprint: string;
  duplicate?: boolean;
  note?: string;
}

export function fingerprintFor(jobId: string, platform: string, file: string): string {
  const hash = crypto.createHash('sha256');
  hash.update(jobId);
  hash.update(platform);
  if (fs.existsSync(file)) hash.update(fs.readFileSync(file));
  return hash.digest('hex').slice(0, 32);
}

function defaultCaption(model: string, tagline?: string): string {
  const base = tagline ? `${model} — ${tagline}` : model;
  return `${base}\n\nVideo dibuat dengan bantuan AI. #otomotif`;
}

/**
 * Instagram publishing follows the official Reels flow (create container,
 * poll, publish). Dry run is the default so nothing goes live by accident,
 * and a fingerprint stops the same video being posted twice.
 */
export async function publishJob(input: PublishInput): Promise<PublishResult> {
  const job = await getJob(input.jobId);
  if (!job) throw new Error('job tidak ditemukan');
  if (job.status !== 'done') throw new Error('job belum selesai, tidak bisa dipublikasikan');

  const defaults = loadDefaults();
  const dryRun = input.dryRun ?? defaults.publish.dryRun;
  const file = path.join(jobDir(job.id), 'video.mp4');
  if (!fs.existsSync(file)) throw new Error('berkas video tidak ada');

  const brief = JSON.parse(job.brief_json) as { tagline?: string };
  const caption = input.caption ?? defaultCaption(job.model, brief.tagline);
  const fingerprint = fingerprintFor(job.id, input.platform, file);

  const existing = await db().get<{ id: string }>('SELECT id FROM publications WHERE fingerprint = ?', [
    fingerprint,
  ]);
  if (existing) {
    return {
      id: existing.id,
      status: 'duplicate',
      remoteId: null,
      dryRun,
      fingerprint,
      duplicate: true,
      note: 'video ini sudah pernah dipublikasikan',
    };
  }

  const id = uuid();
  const ts = now();
  const token = process.env.IG_ACCESS_TOKEN;
  const igUserId = process.env.IG_USER_ID;

  if (dryRun || !token || !igUserId) {
    await db().run(
      `INSERT INTO publications (id, job_id, platform, status, caption, dry_run, fingerprint, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?)`,
      [id, job.id, input.platform, 'dry_run', caption, 1, fingerprint, ts, ts],
    );
    await recordEventSafe(job.id, 'info', 'publish', `dry run: ${job.model} tidak diunggah`);
    return {
      id,
      status: 'dry_run',
      remoteId: null,
      dryRun: true,
      fingerprint,
      note: token ? 'dryRun aktif' : 'kredensial Instagram belum diset',
    };
  }

  const base = 'https://graph.instagram.com/v21.0';
  const create = await fetch(`${base}/${igUserId}/media`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      media_type: 'REELS',
      video_url: `${process.env.APP_URL}/api/jobs/${job.id}/file/video.mp4`,
      caption,
      access_token: token,
    }),
  });
  if (!create.ok) {
    const text = await create.text();
    await db().run(
      `INSERT INTO publications (id, job_id, platform, status, caption, dry_run, fingerprint, error, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
      [id, job.id, input.platform, 'failed', caption, 0, fingerprint, text.slice(0, 500), ts, ts],
    );
    throw new Error(`gagal membuat container Instagram: ${text.slice(0, 200)}`);
  }
  const container = (await create.json()) as { id: string };

  for (let attempt = 0; attempt < 20; attempt++) {
    const statusRes = await fetch(
      `${base}/${container.id}?fields=status_code&access_token=${encodeURIComponent(token)}`,
    );
    const status = (await statusRes.json()) as { status_code?: string };
    if (status.status_code === 'FINISHED') break;
    if (status.status_code === 'ERROR') throw new Error('Instagram menolak video');
    await new Promise((r) => setTimeout(r, 3000));
  }

  const publish = await fetch(`${base}/${igUserId}/media_publish`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ creation_id: container.id, access_token: token }),
  });
  if (!publish.ok) throw new Error(`publish Instagram gagal: ${(await publish.text()).slice(0, 200)}`);
  const published = (await publish.json()) as { id: string };

  await db().run(
    `INSERT INTO publications (id, job_id, platform, status, remote_id, caption, dry_run, fingerprint, published_at, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    [id, job.id, input.platform, 'published', published.id, caption, 0, fingerprint, now(), ts, ts],
  );
  await recordEventSafe(job.id, 'info', 'publish', `terunggah ke Instagram: ${published.id}`);
  return { id, status: 'published', remoteId: published.id, dryRun: false, fingerprint };
}

export async function listPublications(): Promise<Record<string, unknown>[]> {
  return db().all('SELECT * FROM publications ORDER BY created_at DESC LIMIT 50');
}
