import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { jobDir } from '../core/fsx.ts';

/**
 * Video vendors (Seedance) fetch reference frames themselves and reject base64
 * and `asset://` URLs, so a still has to be reachable over public HTTPS. The
 * repo's own assets sit behind a login, so a short-lived signed URL is issued
 * instead of making the whole job directory public.
 *
 * The signature covers the job id as well as the file name, so a valid link for
 * one job can never be replayed against another.
 */
const MAX_AGE_MS = 1000 * 60 * 60 * 2;

function secret(): string | undefined {
  return process.env.SESSION_SECRET || process.env.MEDIA_SIGNING_SECRET;
}

export function signMediaName(jobId: string, name: string, expiresAt?: number): string | undefined {
  const key = secret();
  if (!key) return undefined;
  const exp = expiresAt ?? Date.now() + MAX_AGE_MS;
  const payload = `${jobId}/${name}/${exp}`;
  const mac = crypto.createHmac('sha256', key).update(payload).digest('base64url');
  return `${exp}.${mac}`;
}

/** Returns the failure reason instead of a bare boolean so the route can explain itself. */
export function verifyMediaSignature(jobId: string, name: string, sig: string | undefined): string | null {
  const key = secret();
  if (!key) return 'penandatanganan media tidak dikonfigurasi';
  if (!sig) return 'tanda tangan tidak ada';
  const dot = sig.indexOf('.');
  if (dot < 1) return 'tanda tangan rusak';
  const exp = Number(sig.slice(0, dot));
  if (!Number.isFinite(exp)) return 'tanda tangan rusak';
  if (Date.now() > exp) return 'tautan kedaluwarsa';
  const expected = crypto.createHmac('sha256', key).update(`${jobId}/${name}/${exp}`).digest('base64url');
  const a = Buffer.from(expected);
  const b = Buffer.from(sig.slice(dot + 1));
  if (a.length !== b.length) return 'tanda tangan tidak cocok';
  return crypto.timingSafeEqual(a, b) ? null : 'tanda tangan tidak cocok';
}

/**
 * Copies a still into the job's `media/` folder and returns its public URL.
 * Only that folder is ever served, so a signed link can never expose the
 * rendered video or another artifact of the job.
 */
export function publishMedia(jobId: string, file: string): string {
  const base = process.env.APP_URL ?? process.env.SITE_URL;
  if (!base || !/^https:\/\//.test(base)) {
    throw new Error('APP_URL https belum diisi, URL media publik tidak bisa dibuat');
  }
  const name = path.basename(file);
  const dir = path.join(jobDir(jobId), 'media');
  fs.mkdirSync(dir, { recursive: true });
  const dest = path.join(dir, name);
  if (!fs.existsSync(dest)) fs.copyFileSync(file, dest);
  const sig = signMediaName(jobId, name);
  if (!sig) throw new Error('SESSION_SECRET belum diisi, URL media publik tidak bisa ditandatangani');
  return `${base.replace(/\/$/, '')}/api/jobs/${jobId}/media/${encodeURIComponent(name)}?sig=${sig}`;
}
