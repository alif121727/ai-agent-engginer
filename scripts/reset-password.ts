import { hashPassword } from '../src/auth/auth.ts';
import { db } from '../src/db/index.ts';

const [account, password, newUsername] = process.argv.slice(2);
if (!account || !password) {
  console.error(
    'Pemakaian: node --experimental-strip-types scripts/reset-password.ts <email|username> <password> [username-baru]',
  );
  process.exit(1);
}
if (password.length < 8) {
  console.error('Password minimal 8 karakter');
  process.exit(1);
}

const key = account.trim().toLowerCase();
const existing = await db().get<{ id: string; email: string }>(
  'SELECT id, email FROM users WHERE email = ? OR username = ?',
  [key, key],
);
if (!existing) {
  console.error(`Tidak ada akun dengan email/username ${account}`);
  process.exit(1);
}

const handle = newUsername?.trim().toLowerCase() || null;
if (handle) {
  const taken = await db().get<{ id: string }>('SELECT id FROM users WHERE username = ? AND id <> ?', [
    handle,
    existing.id,
  ]);
  if (taken) {
    console.error(`Username ${handle} sudah dipakai akun lain`);
    process.exit(1);
  }
}

await db().run('UPDATE users SET password_hash = ? WHERE id = ?', [hashPassword(password), existing.id]);
if (handle) await db().run('UPDATE users SET username = ? WHERE id = ?', [handle, existing.id]);

console.log(`Kredensial diperbarui: ${handle ?? '-'} / ${existing.email}`);
