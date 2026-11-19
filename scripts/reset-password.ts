import { hashPassword } from '../src/auth/auth.ts';
import { db } from '../src/db/index.ts';

const [email, password] = process.argv.slice(2);
if (!email || !password) {
  console.error('Pemakaian: node --experimental-strip-types scripts/reset-password.ts <email> <password>');
  process.exit(1);
}
if (password.length < 8) {
  console.error('Password minimal 8 karakter');
  process.exit(1);
}

const hash = hashPassword(password);
const existing = await db().get('SELECT id FROM users WHERE email = ?', [email]);
if (!existing) {
  console.error(`Tidak ada akun dengan email ${email}`);
  process.exit(1);
}

await db().run('UPDATE users SET password_hash = ? WHERE email = ?', [hash, email]);
console.log(`Password untuk ${email} sudah diperbarui`);
