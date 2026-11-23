import React from 'react';
import { useStudio } from '../state/store';
import { Icon } from '../components/ui';
import { VIDEO_MODELS } from '../data/models';
import { LINKS } from '../links';
import { APP_VERSION } from '../version';
import { probeBackend, saveBackend, savedBackend, type ProviderState } from '../services/api';

export function Models() {
  const { settings, saveSettings, toast, isModelReady, readiness } = useStudio();
  return (
    <div className="page stack" style={{ gap: 18 }}>
      <div>
        <div className="eyebrow">Model AI</div>
        <h1 style={{ marginTop: 4 }}>Mesin video</h1>
        <p className="muted small" style={{ marginTop: 4, maxWidth: '70ch' }}>
          Status di bawah dibaca langsung dari server: hijau berarti kunci API ada dan saldo kredit cukup,
          jadi render benar-benar bisa jalan. Model yang belum siap tetap bisa dipilih, tapi hasilnya memakai
          Studio Render lokal.
        </p>
      </div>

      {readiness && (
        <div className={`note ${(Object.values(readiness.providers) as ProviderState[]).some((p) => p.note) ? 'note--warn' : 'note--ok'}`}>
          <span className="note__icon"><Icon.Info size={14} /></span>
          <span>
            {(Object.entries(readiness.providers) as Array<[string, ProviderState]>)
              .filter(([, p]) => p.note)
              .map(([name, p]) => `${name}: ${p.note}${typeof p.credits === 'number' ? ` (${p.credits} kredit)` : ''}`)
              .join(' · ') || 'Semua kunci API aktif dan saldo cukup.'}
          </span>
        </div>
      )}

      <div className="stack" style={{ gap: 12 }}>
        {VIDEO_MODELS.map((m) => (
          <div key={m.id} className="card" style={{ borderColor: settings.defaultModel === m.id ? 'var(--accent)' : undefined }}>
            <div className="row row--between row--wrap" style={{ alignItems: 'flex-start', gap: 12 }}>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div className="row" style={{ gap: 8, marginBottom: 4 }}>
                  <h3>{m.name}</h3>
                  {isModelReady(m.id) ? <span className="chip chip--ok"><span className="dot" /> siap dipakai</span> : <span className="chip chip--warn">butuh API key</span>}
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

/**
 * Lets the visitor point the static site at a live backend. Without this the
 * only way out of demo mode was rebuilding with STUDIO_URL, which the user
 * cannot do from the deployed site.
 */
function BackendForm({ onConnected }: { onConnected(): void }) {
  const { toast, api } = useStudio();
  const [url, setUrl] = React.useState(savedBackend() || LINKS.studio);
  const [busy, setBusy] = React.useState(false);

  async function connect() {
    const clean = url.trim().replace(/\/$/, '');
    if (!/^https?:\/\//.test(clean)) {
      toast({ title: 'Alamat tidak valid', body: 'Mulai dengan http:// atau https://', kind: 'info' });
      return;
    }
    setBusy(true);
    const ok = await probeBackend(clean);
    setBusy(false);
    if (!ok) {
      toast({ title: 'Backend tidak menjawab', body: `${clean}/api/health gagal. Pastikan server hidup.`, kind: 'info' });
      return;
    }
    saveBackend(clean);
    toast({ title: 'Backend tersambung', body: 'Memuat ulang studio dengan server nyata.', kind: 'ok' });
    onConnected();
  }

  return (
    <div className="stack" style={{ gap: 10 }}>
      <div className="field">
        <span className="field__label">Alamat backend</span>
        <input
          className="input mono"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://studio-anda.onrender.com"
          spellCheck={false}
        />
        <span className="field__hint">
          Diisi otomatis dengan alamat studio yang tercatat di aplikasi ini. Ganti kalau backend pindah host.
        </span>
      </div>
      <div className="row row--wrap" style={{ gap: 8 }}>
        <button className="btn btn--accent btn--sm" onClick={connect} disabled={busy}>
          {busy ? 'Memeriksa…' : 'Sambungkan'}
        </button>
        {api.kind === 'http' && (
          <button
            className="btn btn--ghost btn--sm"
            onClick={() => {
              saveBackend('');
              window.location.reload();
            }}
          >
            Lupakan backend
          </button>
        )}
      </div>
    </div>
  );
}

const LINK_ROWS: Array<{ key: keyof typeof LINKS; label: string; note: string }> = [
  { key: 'studio', label: 'Studio lengkap', note: 'Backend nyata: render ffmpeg, worker, QA sungguhan.' },
  { key: 'pages', label: 'GitHub Pages', note: 'Salinan statis; bisa dibuka tanpa backend.' },
  { key: 'netlify', label: 'Netlify', note: 'Deploy dari repo yang sama.' },
  { key: 'repo', label: 'Repositori', note: 'Kode sumber dan riwayat perubahan.' },
];

export function Settings() {
  const { settings, saveSettings, toast, user, api, isModelReady } = useStudio();

  async function copy(url: string, label: string) {
    // navigator.clipboard butuh HTTPS + izin; kalau ditolak, pakai textarea
    // sementara supaya penyalinan tetap berhasil di peramban lama.
    let ok = false;
    try {
      await navigator.clipboard.writeText(url);
      ok = true;
    } catch {
      try {
        const ta = document.createElement('textarea');
        ta.value = url;
        ta.setAttribute('readonly', '');
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        ok = document.execCommand('copy');
        document.body.removeChild(ta);
      } catch {
        ok = false;
      }
    }
    toast(
      ok
        ? { title: 'Tautan disalin', body: label, kind: 'ok' }
        : { title: 'Tidak bisa menyalin otomatis', body: 'Salin manual dari teks di atas.', kind: 'info' },
    );
  }
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
            {VIDEO_MODELS.map((m) => <option key={m.id} value={m.id}>{m.name}{isModelReady(m.id) ? '' : ' (butuh API key)'}</option>)}
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
        <div className="row row--between">
          <h2>Koneksi backend</h2>
          <span className={`chip ${api.kind === 'http' ? 'chip--ok' : 'chip--warn'}`}>
            {api.kind === 'http' ? 'tersambung' : 'mode demo'}
          </span>
        </div>
        <p className="small muted" style={{ margin: 0 }}>
          Mode demo hanya menyimpan proyek di peramban ini dan tidak menjalankan ffmpeg. Sambungkan ke
          backend studio agar job benar-benar dirender dan proyek tersimpan di server.
        </p>
        <BackendForm onConnected={() => window.location.reload()} />
      </div>

      <div className="card stack">
        <h2>Tautan</h2>
        <p className="small muted" style={{ margin: 0 }}>
          Alamat studio yang bisa dibagikan. Semuanya juga tercetak di <span className="mono">tautan.html</span>,
          jadi tetap bisa dibuka walau JavaScript gagal dimuat.
        </p>
        {LINK_ROWS.map((l) => (
          <div key={l.key} className="row row--between" style={{ padding: '10px 0', borderTop: '1px solid var(--border)' }}>
            <div style={{ minWidth: 0 }}>
              <div className="small" style={{ fontWeight: 600 }}>{l.label}</div>
              <a
                className="dim tiny mono"
                href={LINKS[l.key]}
                target="_blank"
                rel="noreferrer"
                style={{ overflowWrap: 'anywhere' }}
              >
                {LINKS[l.key]}
              </a>
              <div className="dim tiny">{l.note}</div>
            </div>
            <div className="row" style={{ gap: 6, flexShrink: 0 }}>
              <button className="btn btn--sm" onClick={() => copy(LINKS[l.key], l.label)}>Salin</button>
              <a className="btn btn--ghost btn--sm" href={LINKS[l.key]} target="_blank" rel="noreferrer">
                Buka <Icon.ChevronR size={11} />
              </a>
            </div>
          </div>
        ))}
        <div className="note">
          <span className="note__icon"><Icon.Info size={14} /></span>
          <span>
            Alamat sandbox hanya hidup selama sesi kerja ini berjalan. Kalau nanti mati, buka
            <span className="mono"> tautan.html</span> untuk melihat alamat yang masih aktif.
          </span>
        </div>
      </div>

      <div className="card stack">
        <h2>Tentang</h2>
        <div className="row row--between">
          <div>
            <div className="small" style={{ fontWeight: 600 }}>Agent Studio AI Otomotif</div>
            <div className="dim tiny">
              Rilis {APP_VERSION} · {api.kind === 'http' ? 'backend aktif' : 'mode demo statis'}
            </div>
          </div>
          <span className="chip chip--accent">v{APP_VERSION}</span>
        </div>
        <p className="small muted" style={{ margin: 0 }}>
          Sembilan tahap pipeline, artefak per agen, dan QA yang benar-benar memeriksa hasil.
          Spesifikasi mobil hanya diambil dari katalog terverifikasi — tidak ada angka yang dikarang.
        </p>
      </div>

      <div className="card stack">
        <h2>Akun</h2>
        <div className="row row--between">
          <div>
            <div className="small" style={{ fontWeight: 600 }}>{user?.name}</div>
            <div className="dim tiny">{user?.email}</div>
          </div>
          <span className="chip">{api.kind === 'http' ? 'sesi server' : 'sesi lokal'}</span>
        </div>
        <div className="note note--warn">
          <span className="note__icon"><Icon.Warn size={14} /></span>
          <span>
            {api.kind === 'http'
              ? 'Sesi disimpan sebagai cookie HttpOnly dan diverifikasi server setiap kali halaman dibuka. Keluar akan menghapus sesi di server juga.'
              : 'Akun di sini disimpan di peramban Anda (localStorage), bukan server. Jangan pakai kata sandi yang Anda pakai di tempat lain — memang tidak ada kata sandi yang dikirim ke mana pun.'}
          </span>
        </div>
      </div>
    </div>
  );
}
