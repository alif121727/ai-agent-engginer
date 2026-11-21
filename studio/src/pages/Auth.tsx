import React from 'react';
import { useStudio } from '../state/store';
import { Icon } from '../components/ui';

export function Auth() {
  const { login, register } = useStudio();
  const [mode, setMode] = React.useState<'login' | 'register'>('login');
  const { api } = useStudio();
  const [name, setName] = React.useState('');
  const [email, setEmail] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [err, setErr] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    if (mode === 'register') {
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
        setErr('Alamat email tidak valid.');
        return;
      }
      if (name.trim().length < 2) {
        setErr('Nama minimal 2 karakter.');
        return;
      }
      register(name.trim(), email.trim());
      return;
    }
    // Login nyata: backend memverifikasi kredensial lewat cookie sesi.
    if (!email.trim() || password.length < 1) {
      setErr('Username/email dan password wajib diisi.');
      return;
    }
    setBusy(true);
    const res = await login(email.trim(), password);
    setBusy(false);
    if (!res.ok) setErr(res.error ?? 'Gagal masuk.');
  }

  return (
    <div className="auth">
      <div className="auth__card stack" style={{ gap: 18 }}>
        <div className="row" style={{ gap: 10 }}>
          <div className="sidebar__mark" style={{ width: 34, height: 34, flex: '0 0 34px', borderRadius: 10 }}>AS</div>
          <div>
            <div style={{ fontWeight: 700, letterSpacing: '-0.02em' }}>Agent Studio AI</div>
            <div className="dim tiny">Studio video otomotif berbasis data</div>
          </div>
        </div>

        <div>
          <h1 style={{ fontSize: '1.4rem' }}>{mode === 'login' ? 'Masuk ke studio' : 'Buat ruang kerja'}</h1>
          <p className="muted small" style={{ marginTop: 4 }}>
            {mode === 'login'
              ? api.kind === 'http'
                ? 'Masuk dengan akun studio. Sesi diverifikasi server, bukan disimpan di peramban.'
                : 'Mode demo: tidak ada server, jadi kredensial tidak diverifikasi.'
              : 'Tidak perlu kata sandi — ini ruang kerja lokal untuk menyimpan proyek Anda.'}
          </p>
        </div>

        <form className="stack" onSubmit={submit} style={{ gap: 12 }}>
          {mode === 'register' && (
            <div className="field">
              <label className="field__label" htmlFor="nm">Nama</label>
              <input id="nm" className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Nama Anda" autoComplete="name" />
            </div>
          )}
          <div className="field">
            <label className="field__label" htmlFor="em">
              {mode === 'login' ? 'Username atau email' : 'Email'}
            </label>
            <input
              id="em"
              className="input"
              type={mode === 'login' ? 'text' : 'email'}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder={mode === 'login' ? 'admin123 atau nama@contoh.id' : 'nama@contoh.id'}
              autoComplete="username"
              aria-invalid={!!err}
            />
          </div>
          {mode === 'login' && (
            <div className="field">
              <label className="field__label" htmlFor="pw">Password</label>
              <input
                id="pw"
                className="input"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                autoComplete="current-password"
                aria-invalid={!!err}
              />
              {err && <span className="field__error">{err}</span>}
            </div>
          )}
          {mode === 'register' && err && <span className="field__error">{err}</span>}
          <button className="btn btn--primary btn--lg" type="submit" disabled={busy}>
            {busy ? 'Memeriksa…' : mode === 'login' ? 'Masuk' : 'Buat ruang kerja'} <Icon.ChevronR size={15} />
          </button>
        </form>

        <div className="row" style={{ gap: 6, justifyContent: 'center' }}>
          <span className="dim tiny">{mode === 'login' ? 'Belum punya ruang kerja?' : 'Sudah punya?'}</span>
          <button className="btn btn--ghost btn--sm" onClick={() => { setMode(mode === 'login' ? 'register' : 'login'); setErr(null); }}>
            {mode === 'login' ? 'Buat sekarang' : 'Masuk'}
          </button>
        </div>

        {/* Situs statis tidak punya server untuk memverifikasi kredensial, jadi
            gerbang login hanya menghalangi pengunjung. Di backend sungguhan
            tombol ini tidak muncul: login tetap wajib. */}
        {api.kind === 'demo' && (
          <button
            className="btn btn--sm"
            onClick={() => register('Tamu', 'tamu@studio.id')}
            data-testid="masuk-tamu"
          >
            Masuk sebagai tamu <Icon.ChevronR size={14} />
          </button>
        )}

        <div className="note">
          <span className="note__icon"><Icon.Info size={14} /></span>
          <span>
            {api.kind === 'http'
              ? 'Form ini mengirim kredensial ke backend studio di mesin ini. Jangan pakai kata sandi yang Anda pakai di layanan lain.'
              : 'Jangan masukkan kata sandi asli. Situs ini statis: tidak ada server yang memverifikasi, dan yang disimpan hanya nama di peramban Anda.'}
          </span>
        </div>
      </div>
    </div>
  );
}
