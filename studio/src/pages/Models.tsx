import React from 'react';
import { useStudio } from '../state/store';
import { Icon } from '../components/ui';
import { VIDEO_MODELS } from '../data/models';

export function Models() {
  const { settings, saveSettings, toast } = useStudio();
  return (
    <div className="page stack" style={{ gap: 18 }}>
      <div>
        <div className="eyebrow">Model AI</div>
        <h1 style={{ marginTop: 4 }}>Mesin video</h1>
        <p className="muted small" style={{ marginTop: 4, maxWidth: '70ch' }}>
          Hanya satu model yang benar-benar tersambung di lingkungan ini. Sisanya disiapkan sebagai adaptor:
          antarmukanya ada, tapi butuh kunci API dan app review dari vendor masing-masing sebelum bisa dipakai.
        </p>
      </div>

      <div className="note note--warn">
        <span className="note__icon"><Icon.Warn size={14} /></span>
        <span>
          Studio ini <strong>tidak</strong> akan mengaku bisa memanggil Veo/Kling/Seedance tanpa kredensial.
          Kalau Anda memilih model yang belum siap, tahap render otomatis memakai Studio Render lokal dan UI memberi tahu Anda.
        </span>
      </div>

      <div className="stack" style={{ gap: 12 }}>
        {VIDEO_MODELS.map((m) => (
          <div key={m.id} className="card" style={{ borderColor: settings.defaultModel === m.id ? 'var(--accent)' : undefined }}>
            <div className="row row--between row--wrap" style={{ alignItems: 'flex-start', gap: 12 }}>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div className="row" style={{ gap: 8, marginBottom: 4 }}>
                  <h3>{m.name}</h3>
                  {m.ready ? <span className="chip chip--ok"><span className="dot" /> siap dipakai</span> : <span className="chip chip--warn">butuh API key</span>}
                  {settings.defaultModel === m.id && <span className="chip chip--accent">default</span>}
                </div>
                <div className="dim tiny" style={{ marginBottom: 8 }}>{m.vendor} · {m.strength}</div>
                <p className="small muted">{m.detail}</p>
                <div className="row row--wrap" style={{ gap: 6, marginTop: 10 }}>
                  <span className="chip">kecepatan: {m.speed}</span>
                  <span className="chip">maks klip {m.maxDur}s</span>
                  <span className="chip">cocok: {m.best}</span>
                </div>
              </div>
              <button
                className={`btn btn--sm${settings.defaultModel === m.id ? '' : ' btn--primary'}`}
                disabled={settings.defaultModel === m.id}
                onClick={() => { saveSettings({ defaultModel: m.id }); toast({ title: `${m.name} jadi default`, kind: 'ok' }); }}
              >
                {settings.defaultModel === m.id ? 'Sedang dipakai' : 'Jadikan default'}
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function Settings() {
  const { settings, saveSettings, toast, user } = useStudio();
  return (
    <div className="page stack" style={{ gap: 18, maxWidth: 780 }}>
      <div>
        <div className="eyebrow">Pengaturan</div>
        <h1 style={{ marginTop: 4 }}>Preferensi studio</h1>
      </div>

      <div className="card stack">
        <h2>Default produksi</h2>
        <div className="field">
          <span className="field__label">Model video default</span>
          <select className="select" value={settings.defaultModel} onChange={(e) => saveSettings({ defaultModel: e.target.value })}>
            {VIDEO_MODELS.map((m) => <option key={m.id} value={m.id}>{m.name}{m.ready ? '' : ' (butuh API key)'}</option>)}
          </select>
        </div>
        <div className="field">
          <span className="field__label">Bahasa naskah</span>
          <div className="seg">
            {([['id', 'Indonesia'], ['en', 'Inggris']] as const).map(([k, l]) => (
              <button key={k} aria-pressed={settings.language === k} onClick={() => saveSettings({ language: k })}>{l}</button>
            ))}
          </div>
        </div>
        <div className="field">
          <span className="field__label">Kualitas ekspor default</span>
          <div className="seg">
            {(['1080p', '4K'] as const).map((r) => <button key={r} aria-pressed={settings.exportQuality === r} onClick={() => saveSettings({ exportQuality: r })}>{r}</button>)}
          </div>
          <span className="field__hint">Sumber asli 1080p. Ekspor 4K akan di-upscale, bukan detail baru.</span>
        </div>
      </div>

      <div className="card stack">
        <div className="row row--between">
          <h2>Koneksi platform</h2>
          <span className="chip chip--warn">belum tersambung</span>
        </div>
        <p className="small muted">
          Auto-publish ke TikTok, Instagram, dan YouTube butuh OAuth resmi plus app review dari tiap platform
          (TikTok Content Posting API, Meta App Review, YouTube Data API). Tanpa kredensial itu, studio tidak
          berpura-pura bisa memposting — tombolnya dinonaktifkan.
        </p>
        {[
          { n: 'TikTok', d: 'Content Posting API · scope video.publish', need: 'App review TikTok 1–4 minggu' },
          { n: 'Instagram', d: 'Meta Graph API · butuh akun Business/Creator', need: 'Meta App Review' },
          { n: 'YouTube', d: 'Data API v3 · youtube.upload', need: 'Kuota 10.000 unit/hari (≈6 upload)' },
        ].map((p) => (
          <div key={p.n} className="row row--between" style={{ padding: '10px 0', borderTop: '1px solid var(--border)' }}>
            <div>
              <div className="small" style={{ fontWeight: 600 }}>{p.n}</div>
              <div className="dim tiny">{p.d}</div>
              <div className="dim tiny">Syarat: {p.need}</div>
            </div>
            <button className="btn btn--sm" disabled title="Butuh kredensial OAuth platform">Hubungkan</button>
          </div>
        ))}
        <div className="note">
          <span className="note__icon"><Icon.Info size={14} /></span>
          <span>Kalau Anda memberi kunci API, saya bisa mengaktifkan adaptor platform di backend dengan mode <span className="mono">PUBLISHER_MODE=mock</span> dulu agar aman diuji tanpa benar-benar mengunggah.</span>
        </div>
      </div>

      <div className="card stack">
        <h2>Akun</h2>
        <div className="row row--between">
          <div>
            <div className="small" style={{ fontWeight: 600 }}>{user?.name}</div>
            <div className="dim tiny">{user?.email}</div>
          </div>
          <span className="chip">sesi lokal</span>
        </div>
        <div className="note note--warn">
          <span className="note__icon"><Icon.Warn size={14} /></span>
          <span>
            Akun di sini disimpan di peramban Anda (localStorage), bukan server. Jangan pakai kata sandi yang
            Anda pakai di tempat lain — memang tidak ada kata sandi yang dikirim ke mana pun.
          </span>
        </div>
      </div>
    </div>
  );
}
