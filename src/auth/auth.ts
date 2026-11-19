import crypto from 'node:crypto';
import { db, uuid, now } from '../db/index.ts';

const SCRYPT_KEYLEN = 64;
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 7;

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16);
  const derived = crypto.scryptSync(password, salt, SCRYPT_KEYLEN);
  return `scrypt$${salt.toString('hex')}$${derived.toString('hex')}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [scheme, saltHex, hashHex] = stored.split('$');
  if (scheme !== 'scrypt' || !saltHex || !hashHex) return false;
  const derived = crypto.scryptSync(password, Buffer.from(saltHex, 'hex'), SCRYPT_KEYLEN);
  const expected = Buffer.from(hashHex, 'hex');
  if (expected.length !== derived.length) return false;
  return crypto.timingSafeEqual(expected, derived);
}

export interface User {
  id: string;
  email: string;
  username: string | null;
  role: string;
}

export async function userCount(): Promise<number> {
  const row = await db().get<{ c: number }>('SELECT COUNT(*) AS c FROM users');
  return Number(row?.c ?? 0);
}

export async function createUser(email: string, password: string, role = 'admin', username?: string): Promise<User> {
  const normalized = email.trim().toLowerCase();
  if (!normalized.includes('@')) throw new Error('Email tidak valid');
  if (password.length < 8) throw new Error('Password minimal 8 karakter');
  const existing = await db().get<{ id: string }>('SELECT id FROM users WHERE email = ?', [normalized]);
  if (existing) throw new Error('Email sudah terdaftar');
  const handle = username?.trim().toLowerCase() || null;
  if (handle) {
    const taken = await db().get<{ id: string }>('SELECT id FROM users WHERE username = ?', [handle]);
    if (taken) throw new Error('Username sudah dipakai');
  }
  const id = uuid();
  await db().run('INSERT INTO users (id, email, username, password_hash, role, created_at) VALUES (?,?,?,?,?,?)', [
    id,
    normalized,
    handle,
    hashPassword(password),
    role,
    now(),
  ]);
  return { id, email: normalized, username: handle, role };
}

/** Accepts either the username or the email in the same field. */
export async function authenticate(login: string, password: string): Promise<User | null> {
  const key = login.trim().toLowerCase();
  const row = await db().get<{ id: string; email: string; username: string | null; password_hash: string; role: string }>(
    'SELECT * FROM users WHERE username = ? OR email = ?',
    [key, key],
  );
  if (!row) return null;
  if (!verifyPassword(password, row.password_hash)) return null;
  return { id: row.id, email: row.email, username: row.username, role: row.role };
}

export async function createSession(userId: string): Promise<string> {
  const token = crypto.randomBytes(32).toString('base64url');
  const expires = new Date(Date.now() + SESSION_TTL_MS).toISOString();
  await db().run('INSERT INTO sessions (id, user_id, created_at, expires_at) VALUES (?,?,?,?)', [
    token,
    userId,
    now(),
    expires,
  ]);
  return token;
}

export async function sessionUser(token: string | undefined): Promise<User | null> {
  if (!token) return null;
  const row = await db().get<{ user_id: string; expires_at: string }>(
    'SELECT user_id, expires_at FROM sessions WHERE id = ?',
    [token],
  );
  if (!row) return null;
  if (new Date(row.expires_at).getTime() < Date.now()) {
    await db().run('DELETE FROM sessions WHERE id = ?', [token]);
    return null;
  }
  const user = await db().get<User>('SELECT id, email, role FROM users WHERE id = ?', [row.user_id]);
  return user ?? null;
}

export async function destroySession(token: string): Promise<void> {
  await db().run('DELETE FROM sessions WHERE id = ?', [token]);
}

export async function purgeExpiredSessions(): Promise<void> {
  await db().run('DELETE FROM sessions WHERE expires_at < ?', [now()]);
}
