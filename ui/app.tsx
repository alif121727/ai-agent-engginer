import React, { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';

type Connection = 'ONLINE' | 'PAUSED_OFFLINE';

interface Job {
  id: string;
  title: string;
  model: string;
  status: string;
  progress: number;
  duration_sec: number;
  aspect: string;
  theme_id: string;
  mode: string;
  cost_estimate: number;
  error: string | null;
  created_at: string;
  brief_json: string;
}

interface Stage {
  id: string;
  job_id: string;
  agent_id: string;
  name: string;
  status: string;
  progress: number;
  attempts: number;
  message: string | null;
}

interface AgentInfo {
  id: string;
  name: string;
  short: string;
  role: string;
  kind: string;
  allowedTools: string[];
}

interface CatalogModel {
  slug: string;
  merk: string;
  model: string;
  seri: string;
  tahun: string;
  kategori: string;
  mesin?: string;
  alias?: string[];
  tenaga: string;
  torsi: string;
  tagline: string;
}

/** Satu kartu hasil pencarian; bentuknya sama untuk sumber lokal dan internet. */
interface KartuMobil {
  id: string;
  nama: string;
  merk: string;
  tahun: string;
  ringkas: string;
  gambarUrl: string;
  sumber: 'lokal' | 'internet';
  slug?: string;
  mesin?: string;
  tenaga?: string;
  transmisi?: string;
  generasi?: string;
  deskripsi?: string;
  halamanUrl?: string;
}

interface HasilCari {
  kartu: KartuMobil[];
  sumberDominan: 'lokal' | 'internet' | 'campuran';
  catatan?: string;
  totalKatalog?: number;
}

interface Config {
  minDurasi: number;
  maxDurasi: number;
  presets: { name: string; agents: string[] }[];
  agentPreset: string;
  themes: { id: string; palette: { primary: string; secondary: string; accent: string }; mood: string; keywords: string[] }[];
  catalog: CatalogModel[];
  adapters: { id: string; label: string; kind: string; configured: boolean }[];
  cost: { maxCostPerJob: number; maxCostPerHari: number };
  llm: { supportsImages: boolean; note?: string; model?: string };
  agents: AgentInfo[];
}

const api = {
  async get<T>(path: string): Promise<T> {
    const res = await fetch(`/api${path}`, { credentials: 'same-origin' });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? `HTTP ${res.status}`);
    return res.json() as Promise<T>;
  },
  async send<T>(path: string, body: unknown, method = 'POST'): Promise<T> {
    const res = await fetch(`/api${path}`, {
      method,
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error((json as { error?: string }).error ?? `HTTP ${res.status}`);
    return json as T;
  },
};

function useRoute(): [string, (to: string) => void] {
  const [route, setRoute] = useState(() => window.location.hash.replace(/^#/, '') || '/');
  useEffect(() => {
    const onHash = () => setRoute(window.location.hash.replace(/^#/, '') || '/');
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  const navigate = useCallback((to: string) => {
    window.location.hash = to;
    window.scrollTo({ top: 0 });
  }, []);
  return [route, navigate];
}

function useEventStream(onEvent: (type: string, data: unknown) => void) {
  const ref = useRef(onEvent);
  ref.current = onEvent;
  useEffect(() => {
    const source = new EventSource('/api/events', { withCredentials: true });
    const handler = (type: string) => (ev: MessageEvent) => {
      try {
        ref.current(type, JSON.parse(ev.data));
      } catch {
        /* ignore malformed frames */
      }
    };
    const types = ['log', 'job', 'stage', 'connection', 'studio', 'cost'];
    for (const t of types) source.addEventListener(t, handler(t));
    return () => source.close();
  }, []);
}

// ------------------------------------------------------------------ shared

function StatusChip({ status }: { status: Connection }) {
  const offline = status === 'PAUSED_OFFLINE';
  return (
    <span className="chip" data-status={status} role="status" aria-live="polite">
      <span className="dot" aria-hidden="true" />
      {offline ? 'PAUSED · OFFLINE' : 'ONLINE'}
    </span>
  );
}

function Header({
  route,
  navigate,
  connection,
  onNew,
  user,
  onLogout,
}: {
  route: string;
  navigate: (to: string) => void;
  connection: Connection;
  onNew: () => void;
  user: { email: string; username: string | null };
  onLogout: () => void;
}) {
  const links = [
    ['/', 'Dashboard'],
    ['/studio', 'Ruang Studio'],
    ['/jadwal', 'Jadwal'],
    ['/pengaturan', 'Pengaturan'],
  ];
  return (
    <header className="header">
      <a className="wordmark" href="#/" aria-label="Studio Otomotif, ke dashboard">
        STUDIO<span className="slash">/</span>OTOMOTIF
      </a>
      <nav className="nav-pill" aria-label="Navigasi utama">
        {links.map(([to, label]) => (
          <a key={to} href={`#${to}`} aria-current={route === to ? 'page' : undefined}>
            {label}
          </a>
        ))}
      </nav>
      <div style={{ marginLeft: 'auto', display: 'flex', gap: 12, alignItems: 'center' }}>
        <StatusChip status={connection} />
        <span className="label" title={user.email}>
          {user.username ?? user.email}
        </span>
        <button className="btn btn--ghost" onClick={onLogout}>
          Keluar
        </button>
        <button className="btn btn--primary" onClick={onNew}>
          Template baru <span aria-hidden="true">→</span>
        </button>
      </div>
    </header>
  );
}

function OfflineBanner({ connection }: { connection: Connection }) {
  if (connection !== 'PAUSED_OFFLINE') return null;
  return (
    <div className="banner" role="alert">
      <span aria-hidden="true">■</span>
      Pekerjaan dijeda, akan lanjut otomatis saat internet kembali.
    </div>
  );
}

// --------------------------------------------------------------- dashboard

function Dashboard({ navigate, connection }: { navigate: (to: string) => void; connection: Connection }) {
  const [data, setData] = useState<{
    activeJob: Job | null;
    activeStages: Stage[];
    queue: number;
    costToday: number;
    costLimit: number;
    jobCostLimit: number;
  } | null>(null);
  const [config, setConfig] = useState<Config | null>(null);
  const [jobs, setJobs] = useState<Job[]>([]);

  const load = useCallback(async () => {
    const [dash, cfg, list] = await Promise.all([
      api.get<typeof data>('/dashboard'),
      api.get<Config>('/config'),
      api.get<{ jobs: Job[] }>('/jobs?limit=8'),
    ]);
    setData(dash);
    setConfig(cfg);
    setJobs(list.jobs);
  }, []);

  useEffect(() => {
    void load();
    const timer = setInterval(load, 5000);
    return () => clearInterval(timer);
  }, [load]);

  useEventStream((type) => {
    if (type === 'stage' || type === 'job') void load();
  });

  const stages = data?.activeStages ?? [];
  const doneStages = stages.filter((s) => s.status === 'done').length;
  const progressPct = stages.length ? Math.round((doneStages / stages.length) * 100) : 0;
  const preset = config?.presets.find((p) => p.name === config.agentPreset);
  const agents = preset
    ? preset.agents.map((id) => config!.agents.find((a) => a.id === id)!).filter(Boolean)
    : config?.agents ?? [];
  const stateFor = (agentId: string) => {
    const stage = stages.find((s) => s.agent_id === agentId);
    if (!stage) return 'menunggu';
    if (stage.status === 'running') return 'bekerja';
    if (stage.status === 'done') return 'selesai';
    if (stage.status === 'failed') return 'gagal';
    return 'menunggu';
  };

  if (!data || !config) {
    return (
      <div className="bento" aria-busy="true">
        <div className="card card--wide">
          <div className="skeleton" style={{ height: 40, width: '40%' }} />
          <div className="skeleton" style={{ height: 220, marginTop: 24 }} />
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="bento">
        <section className="card card--cream" style={{ gridColumn: 'span 7' }} aria-labelledby="job-aktif">
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16 }}>
            <div>
              <p className="label" id="job-aktif">
                Job aktif
              </p>
              <h1 style={{ marginTop: 8, wordBreak: 'break-word' }}>
                {data.activeJob?.model ?? 'Belum ada job'}
              </h1>
              <p className="muted" style={{ marginTop: 8, fontFamily: 'var(--font-mono)', fontSize: '0.78rem' }}>
                {data.activeJob
                  ? `${data.activeJob.duration_sec} dtk · ${data.activeJob.aspect} · tema ${data.activeJob.theme_id}`
                  : 'Kirim template pertama untuk memulai'}
              </p>
            </div>
            <div className="ring" style={{ ['--value' as string]: progressPct }} aria-label={`Progres ${progressPct}%`}>
              <span>
                {doneStages}/{stages.length || 0}
              </span>
            </div>
          </div>

          {data.activeJob ? (
            <>
              <div className="frame" style={{ marginTop: 20, aspectRatio: '16/9' }}>
                <video
                  src={`/api/jobs/${data.activeJob.id}/file/video.mp4`}
                  poster={`/api/jobs/${data.activeJob.id}/file/preview.jpg`}
                  controls
                  preload="none"
                  style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                />
              </div>
              <div className="timeline" aria-label="Timeline scene">
                {stages.map((stage, i) => (
                  <div
                    className="seg"
                    key={stage.id}
                    data-state={stage.status === 'done' ? 'done' : stage.status === 'running' ? 'running' : 'pending'}
                  >
                    {String(i + 1).padStart(2, '0')} {stage.name}
                  </div>
                ))}
              </div>
            </>
          ) : (
            <div style={{ marginTop: 24, display: 'flex', gap: 12, flexWrap: 'wrap' }}>
              <button className="btn btn--primary" onClick={() => navigate('/template-baru')}>
                Buat video pertama
              </button>
            </div>
          )}
        </section>

        <section className="card" style={{ gridColumn: 'span 5' }} aria-labelledby="koneksi">
          <p className="label" id="koneksi">
            Koneksi
          </p>
          <h2 style={{ marginTop: 8 }}>{connection === 'ONLINE' ? 'Tersambung' : 'Dijeda'}</h2>
          <p className="muted" style={{ marginTop: 8 }}>
            {connection === 'ONLINE'
              ? 'Worker mengambil tugas dan render berjalan.'
              : 'Semua job dijeda dan akan lanjut dari checkpoint.'}
          </p>

          <hr style={{ border: 0, borderTop: '1px solid var(--border)', margin: '24px 0' }} />

          <p className="label">Biaya hari ini</p>
          <p className="display mono" style={{ fontSize: '2rem', marginTop: 8 }}>
            ${data.costToday.toFixed(2)}
            <span className="muted" style={{ fontSize: '0.9rem' }}> / ${data.costLimit.toFixed(0)}</span>
          </p>
          <div
            aria-hidden="true"
            style={{ height: 6, borderRadius: 3, background: '#2a2622', marginTop: 10, overflow: 'hidden' }}
          >
            <div
              style={{
                width: `${Math.min(100, (data.costToday / Math.max(1, data.costLimit)) * 100)}%`,
                height: '100%',
                background: 'var(--orange)',
              }}
            />
          </div>

          <hr style={{ border: 0, borderTop: '1px solid var(--border)', margin: '24px 0' }} />

          <p className="label">Antrean</p>
          <p className="display mono" style={{ fontSize: '2rem', marginTop: 8 }}>
            {data.queue}
          </p>
          <p className="muted" style={{ fontSize: '0.85rem' }}>
            batas per job ${data.jobCostLimit.toFixed(2)}
          </p>
        </section>

        <section className="card card--wide" aria-labelledby="tim-agen">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 16 }}>
            <p className="label" id="tim-agen">
              Tim agen · {String(agents.length).padStart(2, '0')}
            </p>
            <p className="label">preset {config.agentPreset}</p>
          </div>
          <div className="agents" style={{ marginTop: 16 }}>
            {agents.map((agent, i) => {
              const state = stateFor(agent.id);
              return (
                <div className="agent-cube" key={agent.id} data-state={state}>
                  <span className="num">{String(i + 1).padStart(2, '0')}</span>
                  <span className="name">{agent.name}</span>
                  <span className="state">{state}</span>
                </div>
              );
            })}
          </div>
        </section>

        {jobs.length > 0 && (
          <section className="card card--wide" aria-labelledby="riwayat">
            <p className="label" id="riwayat">
              Riwayat job
            </p>
            <div style={{ overflowX: 'auto', marginTop: 16 }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.9rem' }}>
                <thead>
                  <tr style={{ textAlign: 'left' }}>
                    {['Model', 'Status', 'Durasi', 'Biaya', ''].map((h) => (
                      <th key={h} className="label" style={{ padding: '10px 12px', borderBottom: '1px solid var(--border)' }}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {jobs.map((job) => (
                    <tr key={job.id}>
                      <td style={{ padding: '12px' }}>{job.model}</td>
                      <td style={{ padding: '12px' }} className="mono">
                        {job.status}
                      </td>
                      <td style={{ padding: '12px' }} className="mono">
                        {job.duration_sec} dtk
                      </td>
                      <td style={{ padding: '12px' }} className="mono">
                        ${job.cost_estimate.toFixed(2)}
                      </td>
                      <td style={{ padding: '12px', textAlign: 'right' }}>
                        <a className="btn btn--ghost" href={`#/job/${job.id}`} style={{ minHeight: 36 }}>
                          Detail
                        </a>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}
      </div>
    </>
  );
}

// ------------------------------------------------------- pencarian internet

/**
 * Pencarian mobil lintas internet.
 *
 * Katalog lokal tetap jadi jalur utama (cepat, foto dan suara mesin sudah
 * siap), dan internet dipakai untuk mobil yang belum ada di katalog. Label
 * sumber ditampilkan di setiap kartu supaya pengguna tahu apa yang dipakai.
 */
function CariInternet({ onPilih }: { onPilih: (kartu: KartuMobil) => void }) {
  const [kata, setKata] = useState('');
  const [hasil, setHasil] = useState<HasilCari | null>(null);
  const [memuat, setMemuat] = useState(false);
  const [galat, setGalat] = useState('');
  const [detail, setDetail] = useState<KartuMobil | null>(null);

  const cari = async (lokalSaja = false) => {
    const q = kata.trim();
    if (q.length < 2) return;
    setMemuat(true);
    setGalat('');
    try {
      const res = await api.get<HasilCari>(
        `/cars/search?q=${encodeURIComponent(q)}&limit=8${lokalSaja ? '&sumber=lokal' : ''}`,
      );
      setHasil(res);
    } catch (err) {
      setGalat(err instanceof Error ? err.message : 'pencarian gagal');
      setHasil(null);
    } finally {
      setMemuat(false);
    }
  };

  return (
    <div style={{ marginTop: 24 }}>
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        <h2 style={{ margin: 0 }}>Cari mobil dari seluruh dunia</h2>
        <span className="badge" title="Sumber: katalog lokal lalu Wikipedia">
          Internet aktif
        </span>
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          void cari();
        }}
        style={{ display: 'flex', gap: 12, marginTop: 12, flexWrap: 'wrap' }}
      >
        <input
          aria-label="Cari mobil dari internet"
          value={kata}
          onChange={(e) => setKata(e.target.value)}
          placeholder="Cari mobil dari seluruh dunia…"
          style={{ flex: '1 1 260px' }}
        />
        <button type="submit" className="btn btn--primary" disabled={memuat || kata.trim().length < 2}>
          {memuat ? 'Mencari…' : 'Cari'}
        </button>
        {hasil && (
          <button type="button" className="btn" onClick={() => void cari(true)} disabled={memuat}>
            Katalog lokal saja
          </button>
        )}
      </form>

      {memuat && (
        <p className="muted" style={{ marginTop: 12 }}>
          <span className="spinner" aria-hidden="true" /> Menghubungi internet, mohon tunggu…
        </p>
      )}

      {galat && (
        <p className="muted" style={{ marginTop: 12, color: 'var(--orange)' }}>
          {galat}
        </p>
      )}

      {hasil && !memuat && (
        <>
          <p className="muted" style={{ marginTop: 12, fontSize: '0.85rem' }}>
            {hasil.kartu.length
              ? `${hasil.kartu.length} hasil · sumber: ${
                  hasil.sumberDominan === 'campuran'
                    ? 'katalog lokal + internet'
                    : hasil.sumberDominan === 'internet'
                      ? 'internet'
                      : 'katalog lokal'
                }`
              : hasil.catatan ?? 'Tidak ada hasil'}
          </p>

          {hasil.kartu.length > 0 && (
            <div className="model-grid" style={{ marginTop: 12 }}>
              {hasil.kartu.map((k) => (
                <article key={k.id} className="model-card">
                  {k.gambarUrl ? (
                    <img
                      src={k.gambarUrl}
                      alt={k.nama}
                      loading="lazy"
                      style={{ width: '100%', height: 120, objectFit: 'cover', borderRadius: 10 }}
                      onError={(e) => {
                        (e.currentTarget as HTMLImageElement).style.display = 'none';
                      }}
                    />
                  ) : (
                    <div
                      className="muted"
                      style={{
                        height: 120,
                        display: 'grid',
                        placeItems: 'center',
                        border: '1px dashed var(--border)',
                        borderRadius: 10,
                        fontSize: '0.8rem',
                      }}
                    >
                      tanpa foto
                    </div>
                  )}
                  <span className="badge" style={{ alignSelf: 'flex-start' }}>
                    {k.sumber === 'internet' ? 'Internet' : 'Database lokal'}
                  </span>
                  <strong style={{ fontFamily: 'var(--font-display)' }}>{k.nama}</strong>
                  <span className="muted" style={{ fontSize: '0.8rem' }}>
                    {[k.merk, k.tahun, k.tenaga].filter(Boolean).join(' · ')}
                  </span>
                  <div style={{ display: 'flex', gap: 8, marginTop: 'auto' }}>
                    <button className="btn btn--primary" onClick={() => onPilih(k)}>
                      Pilih mobil
                    </button>
                    <button className="btn" onClick={() => setDetail(k)}>
                      Lihat detail
                    </button>
                  </div>
                </article>
              ))}
            </div>
          )}
        </>
      )}

      {detail && (
        <div
          role="dialog"
          aria-label={`Detail ${detail.nama}`}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.7)',
            display: 'grid',
            placeItems: 'center',
            padding: 24,
            zIndex: 50,
          }}
          onClick={() => setDetail(null)}
        >
          <div
            className="card"
            style={{ maxWidth: 560, width: '100%', maxHeight: '85vh', overflow: 'auto' }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 style={{ marginTop: 0 }}>{detail.nama}</h3>
            {detail.gambarUrl && (
              <img
                src={detail.gambarUrl}
                alt={detail.nama}
                style={{ width: '100%', borderRadius: 12, marginBottom: 12 }}
              />
            )}
            <dl style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '6px 12px', fontSize: '0.88rem' }}>
              {[
                ['Merek', detail.merk],
                ['Tahun', detail.tahun],
                ['Generasi', detail.generasi],
                ['Mesin', detail.mesin],
                ['Tenaga', detail.tenaga],
                ['Transmisi', detail.transmisi],
                ['Sumber', detail.sumber === 'internet' ? 'Internet (Wikipedia)' : 'Database lokal'],
              ]
                .filter(([, v]) => v)
                .map(([label, nilai]) => (
                  <Fragment key={label}>
                    <dt className="muted">{label}</dt>
                    <dd style={{ margin: 0 }}>{nilai}</dd>
                  </Fragment>
                ))}
            </dl>
            {detail.deskripsi && (
              <p className="muted" style={{ fontSize: '0.85rem' }}>{detail.deskripsi}</p>
            )}
            {detail.halamanUrl && (
              <p style={{ fontSize: '0.8rem' }}>
                <a href={detail.halamanUrl} target="_blank" rel="noreferrer noopener">
                  Buka sumber
                </a>
              </p>
            )}
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn btn--primary" onClick={() => { onPilih(detail); setDetail(null); }}>
                Pilih mobil ini
              </button>
              <button className="btn" onClick={() => setDetail(null)}>
                Tutup
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------ new template

function NewTemplate({ navigate }: { navigate: (to: string) => void }) {
  const [config, setConfig] = useState<Config | null>(null);
  const [step, setStep] = useState(1);
  const [model, setModel] = useState('');
  const [durasi, setDurasi] = useState(45);
  const [rasio, setRasio] = useState<'16:9' | '9:16' | '1:1'>('16:9');
  const [tagline, setTagline] = useState('');
  const [keunggulan, setKeunggulan] = useState('');
  const [jadwal, setJadwal] = useState('');
  const [estimate, setEstimate] = useState<{ durationSec: number; cost: number; sceneCount: number; minutes: number; bumped: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [cari, setCari] = useState('');
  const [kategori, setKategori] = useState('semua');

  useEffect(() => {
    api.get<Config>('/config').then((cfg) => {
      setConfig(cfg);
      setDurasi(Math.max(cfg.minDurasi, 45));
    });
  }, []);

  useEffect(() => {
    if (!config) return;
    const timer = setTimeout(() => {
      api
        .send<{ durationSec: number; cost: number; sceneCount: number; minutes: number; bumped: boolean }>('/estimate', {
          durasi,
          rasio,
          model: model || 'mobil sport',
        })
        .then(setEstimate)
        .catch(() => setEstimate(null));
    }, 200);
    return () => clearTimeout(timer);
  }, [durasi, rasio, model, config]);

  const submit = async () => {
    setBusy(true);
    setError('');
    try {
      const brief = {
        model,
        tagline: tagline || undefined,
        durasi,
        rasio,
        keunggulan: keunggulan
          .split('\n')
          .map((s) => s.trim())
          .filter(Boolean),
        jadwalPublish: jadwal || undefined,
      };
      const res = await api.send<{ job: Job }>('/jobs', { brief });
      navigate(`/job/${res.job.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'gagal membuat job');
    } finally {
      setBusy(false);
    }
  };

  if (!config) return <div className="skeleton" style={{ height: 320 }} />;

  return (
    <div className="bento">
      <section className="card card--wide">
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <p className="label">Template baru</p>
          <div className="nav-pill" style={{ marginLeft: 'auto' }} role="tablist" aria-label="Langkah">
            {[1, 2, 3].map((n) => (
              <button key={n} role="tab" aria-selected={step === n} aria-current={step === n ? 'page' : undefined} onClick={() => setStep(n)}>
                {String(n).padStart(2, '0')} {n === 1 ? 'Model' : n === 2 ? 'Durasi' : 'Jadwal'}
              </button>
            ))}
          </div>
        </div>

        {step === 1 && (
          <div style={{ marginTop: 24 }}>
            <h2>Pilih model</h2>
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: 16 }}>
              <input
                aria-label="Cari model"
                value={cari}
                onChange={(e) => setCari(e.target.value)}
                placeholder="Cari merk atau model, mis. Supra"
                style={{ flex: '1 1 220px' }}
              />
              <div className="nav-pill" role="tablist" aria-label="Kategori">
                {['semua', 'sport', 'balap', 'modifikasi', 'klasik'].map((k) => (
                  <button key={k} role="tab" aria-selected={kategori === k} onClick={() => setKategori(k)}>
                    {k}
                  </button>
                ))}
              </div>
            </div>
            <div className="model-grid" style={{ marginTop: 16 }}>
              {filterKatalog(config.catalog, cari, kategori).map((m) => (
                <button
                  key={m.slug}
                  className="model-card"
                  aria-pressed={model === m.model}
                  onClick={() => setModel(m.model)}
                >
                  <span className="swatch" aria-hidden="true">
                    <i style={{ background: 'var(--orange)' }} />
                    <i style={{ background: 'var(--ink)' }} />
                    <i style={{ background: 'var(--krem)' }} />
                  </span>
                  <strong style={{ fontFamily: 'var(--font-display)' }}>{m.model}</strong>
                  <span className="muted" style={{ fontSize: '0.8rem' }}>
                    {ringkasModel(m)}
                  </span>
                </button>
              ))}
            </div>
            {filterKatalog(config.catalog, cari, kategori).length === 0 && (
              <p className="muted" style={{ marginTop: 12 }}>
                Tidak ada model yang cocok. Tulis sendiri di kolom bawah.
              </p>
            )}
            <CariInternet
              onPilih={(kartu) => {
                // Nama model dipakai pipeline untuk mencari foto dan suara
                // mesin, jadi yang dipilih adalah nama modelnya, bukan id kartu.
                setModel(kartu.nama);
                setCari(kartu.nama);
              }}
            />

            <div className="field" style={{ marginTop: 24 }}>
              <label htmlFor="model-custom">Atau tulis model sendiri</label>
              <input
                id="model-custom"
                value={model}
                onChange={(e) => setModel(e.target.value)}
                placeholder="Ferrari 296 GTB, r34, hachiroku…"
              />
              {(() => {
                const m = modelTerdeteksi(config.catalog, model);
                if (!model.trim()) return null;
                return m ? (
                  <p className="muted" style={{ fontSize: '0.82rem', marginTop: 8 }}>
                    Terdeteksi: <strong style={{ color: 'var(--orange)' }}>{m.model}</strong> — foto{' '}
                    {m.slug}
                    {m.mesin ? ` dan suara mesinnya (${m.mesin.split('(')[0].trim()})` : ''} akan dipakai.
                  </p>
                ) : (
                  <p className="muted" style={{ fontSize: '0.82rem', marginTop: 8 }}>
                    Model belum ada di katalog. Foto tidak tersedia, jadi visual akan dibuat generator.
                  </p>
                );
              })()}
            </div>
            <div className="field">
              <label htmlFor="tagline">Tagline (opsional)</label>
              <input id="tagline" value={tagline} onChange={(e) => setTagline(e.target.value)} placeholder="Hibrida yang tetap berdarah balap" />
            </div>
            <div className="field">
              <label htmlFor="keunggulan">Keunggulan, satu per baris (opsional)</label>
              <textarea
                id="keunggulan"
                value={keunggulan}
                onChange={(e) => setKeunggulan(e.target.value)}
                placeholder={'V6 3.0L hibrida\nsekitar 830 hp total'}
              />
            </div>
            <button className="btn btn--primary" disabled={!model.trim()} onClick={() => setStep(2)}>
              Lanjut ke durasi →
            </button>
          </div>
        )}

        {step === 2 && (
          <div style={{ marginTop: 24 }}>
            <h2>Atur durasi</h2>
            <p className="muted">Durasi bebas. Minimum {config.minDurasi} detik.</p>
            <div className="field" style={{ marginTop: 16 }}>
              <label htmlFor="durasi-range">Durasi (detik)</label>
              <input
                id="durasi-range"
                type="range"
                min={config.minDurasi}
                max={Math.min(config.maxDurasi, 180)}
                step={1}
                value={durasi}
                onChange={(e) => setDurasi(Number(e.target.value))}
              />
              <input
                type="number"
                aria-label="Durasi dalam detik"
                min={config.minDurasi}
                max={config.maxDurasi}
                value={durasi}
                onChange={(e) => setDurasi(Number(e.target.value))}
                style={{ maxWidth: 160 }}
              />
            </div>
            <div className="field">
              <label htmlFor="rasio">Rasio</label>
              <select id="rasio" value={rasio} onChange={(e) => setRasio(e.target.value as typeof rasio)}>
                <option value="16:9">16:9 — YouTube</option>
                <option value="9:16">9:16 — Reels / Shorts</option>
                <option value="1:1">1:1 — Feed</option>
              </select>
            </div>
            {estimate && (
              <div className="card card--cream" style={{ marginTop: 16 }}>
                <p className="label">Estimasi</p>
                <div style={{ display: 'flex', gap: 32, flexWrap: 'wrap', marginTop: 12 }}>
                  <div>
                    <p className="display mono" style={{ fontSize: '1.8rem' }}>
                      {estimate.durationSec} dtk
                    </p>
                    <p className="muted" style={{ fontSize: '0.8rem' }}>
                      {estimate.sceneCount} scene
                      {estimate.bumped ? ' · dinaikkan ke minimum' : ''}
                    </p>
                  </div>
                  <div>
                    <p className="display mono" style={{ fontSize: '1.8rem' }}>
                      ${estimate.cost.toFixed(2)}
                    </p>
                    <p className="muted" style={{ fontSize: '0.8rem' }}>
                      perkiraan biaya
                    </p>
                  </div>
                  <div>
                    <p className="display mono" style={{ fontSize: '1.8rem' }}>
                      ~{estimate.minutes} mnt
                    </p>
                    <p className="muted" style={{ fontSize: '0.8rem' }}>
                      perkiraan waktu
                    </p>
                  </div>
                </div>
              </div>
            )}
            <div style={{ display: 'flex', gap: 12, marginTop: 20 }}>
              <button className="btn btn--ghost" onClick={() => setStep(1)}>
                ← Kembali
              </button>
              <button className="btn btn--primary" onClick={() => setStep(3)}>
                Lanjut ke jadwal →
              </button>
            </div>
          </div>
        )}

        {step === 3 && (
          <div style={{ marginTop: 24 }}>
            <h2>Jadwal dan kirim</h2>
            <div className="field" style={{ marginTop: 16 }}>
              <label htmlFor="jadwal">Jadwal publish (opsional)</label>
              <input id="jadwal" type="datetime-local" value={jadwal} onChange={(e) => setJadwal(e.target.value)} />
            </div>
            <div className="card card--cream">
              <p className="label">Ringkasan</p>
              <p style={{ fontFamily: 'var(--font-display)', fontSize: '1.4rem', margin: '8px 0' }}>{model || '—'}</p>
              <p className="muted">
                {durasi} detik · {rasio} · {estimate ? `${estimate.sceneCount} scene · $${estimate.cost.toFixed(2)}` : 'estimasi belum siap'}
              </p>
            </div>
            {error && (
              <p role="alert" style={{ color: 'var(--orange)', marginTop: 16 }}>
                {error}
              </p>
            )}
            <div style={{ display: 'flex', gap: 12, marginTop: 20 }}>
              <button className="btn btn--ghost" onClick={() => setStep(2)}>
                ← Kembali
              </button>
              <button className="btn btn--primary" onClick={submit} disabled={busy || !model.trim()}>
                {busy ? 'Mengirim…' : 'Kirim dan mulai →'}
              </button>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

// Tenaga yang tidak ada di artikel sumber ditandai di data, bukan di layar.
function ringkasModel(m: CatalogModel): string {
  const parts = [m.kategori, m.tahun];
  if (m.tenaga && !m.tenaga.includes('tidak disebut')) parts.push(m.tenaga);
  return parts.join(' · ');
}

function norm(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Mirrors the server matcher so the UI agrees with what will actually render. */
function cocokSkor(m: CatalogModel, cari: string): number {
  const q = norm(cari);
  if (!q) return 0;
  const qc = q.replace(/ /g, '');
  // Aliases are what the server search matches on, so the hint here agrees
  // with the model that actually supplies the photos and engine sound.
  const fields = [m.model, m.seri, `${m.merk} ${m.model}`, m.slug.replace(/-/g, ' '), ...(m.alias ?? [])];
  let best = 0;
  for (const f of fields) {
    const n = norm(f);
    const nc = n.replace(/ /g, '');
    if (!nc) continue;
    if (nc === qc) best = Math.max(best, 1);
    else if (nc.startsWith(qc)) best = Math.max(best, 0.9);
    else if (nc.includes(qc)) best = Math.max(best, 0.8);
    else {
      const qt = q.split(' ');
      const nt = n.split(' ');
      const hit = qt.filter((t) => nt.some((x) => x === t || x.startsWith(t) || t.startsWith(x))).length;
      if (hit) best = Math.max(best, 0.7 * (hit / qt.length));
    }
  }
  return best;
}

function filterKatalog(catalog: CatalogModel[], cari: string, kategori: string): CatalogModel[] {
  const key = cari.trim();
  const filtered = catalog.filter((m) => kategori === 'semua' || m.kategori === kategori);
  if (!key) return filtered;
  return filtered
    .map((m) => ({ m, skor: cocokSkor(m, key) }))
    .filter((x) => x.skor >= 0.55)
    .sort((a, b) => b.skor - a.skor)
    .map((x) => x.m);
}

/**
 * What the typed text resolves to. The picker only fills a text field, so
 * without this the user cannot tell whether "r34" will use the R34 photos and
 * its engine note, or silently fall back to a generator.
 */
function modelTerdeteksi(catalog: CatalogModel[], input: string): CatalogModel | null {
  const key = input.trim();
  if (!key) return null;
  const hit = catalog
    .map((m) => ({ m, skor: cocokSkor(m, key) }))
    .filter((x) => x.skor >= 0.7)
    .sort((a, b) => b.skor - a.skor)[0];
  return hit?.m ?? null;
}

// ---------------------------------------------------------------- job detail

function JobDetail({ id }: { id: string }) {
  const [data, setData] = useState<{
    job: Job;
    stages: Stage[];
    events: { id: string; level: string; scope: string; message: string; created_at: string }[];
    artifacts: string[];
  } | null>(null);
  const [filter, setFilter] = useState('');

  const load = useCallback(() => {
    api.get<typeof data>(`/jobs/${id}`).then(setData).catch(() => setData(null));
  }, [id]);

  useEffect(() => {
    load();
    const timer = setInterval(load, 4000);
    return () => clearInterval(timer);
  }, [load]);

  useEventStream((type, payload) => {
    const p = payload as { jobId?: string };
    if (p?.jobId === id && (type === 'stage' || type === 'job')) load();
  });

  if (!data) return <div className="skeleton" style={{ height: 320 }} />;
  const { job, stages, events } = data;
  const scenes = stages.filter((s) => s.status !== 'skipped');

  return (
    <div className="bento">
      <section className="card card--cream" style={{ gridColumn: 'span 7' }}>
        <p className="label">Detail job</p>
        <h1 style={{ marginTop: 8 }}>{job.model}</h1>
        <p className="muted" style={{ marginTop: 8 }}>
          {job.duration_sec} dtk · {job.aspect} · {job.mode} · biaya ${job.cost_estimate.toFixed(2)}
        </p>
        <div className="frame" style={{ marginTop: 20, aspectRatio: '16/9' }}>
          <video
            src={`/api/jobs/${job.id}/file/video.mp4`}
            poster={`/api/jobs/${job.id}/file/preview.jpg`}
            controls
            preload="metadata"
            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
          />
        </div>
        <div style={{ display: 'flex', gap: 12, marginTop: 16, flexWrap: 'wrap' }}>
          <a className="btn btn--ghost" href={`/api/jobs/${job.id}/file/video.mp4`} download>
            Unduh video
          </a>
          <a className="btn btn--ghost" href={`/api/jobs/${job.id}/file/preview.jpg`} download>
            Unduh preview
          </a>
          <button
            className="btn btn--ghost"
            onClick={() =>
              api
                .send(`/publish/${job.id}`, { platform: 'instagram', dryRun: true })
                .then(() => alert('Dry run publish dicatat.'))
                .catch((e) => alert(e.message))
            }
          >
            Coba publish (dry run)
          </button>
        </div>
      </section>

      {job.error && (
        <section className="card card--wide" style={{ borderColor: 'var(--orange)' }}>
          <p className="label">Perlu tindakan</p>
          <p style={{ marginTop: 8 }} role="alert">
            {job.error}
          </p>
          <div style={{ display: 'flex', gap: 12, marginTop: 16, flexWrap: 'wrap' }}>
            <button
              className="btn btn--primary"
              onClick={() =>
                api
                  .send(`/jobs/${job.id}/retry`, {})
                  .then(() => load())
                  .catch((e: Error) => alert(e.message))
              }
            >
              Ulangi tahap yang gagal
            </button>
            <button
              className="btn btn--ghost"
              onClick={() =>
                api
                  .send(`/jobs/${job.id}/retry`, { from: 'aset-visual' })
                  .then(() => load())
                  .catch((e: Error) => alert(e.message))
              }
            >
              Ulangi dari aset visual
            </button>
          </div>
        </section>
      )}

      <ArtifactPanel jobId={job.id} artifacts={data.artifacts} />

      <AssetPanel model={job.model} />

      <section className="card" style={{ gridColumn: 'span 5' }}>
        <p className="label">Tahap agen</p>
        <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
          {scenes.map((stage, i) => (
            <div key={stage.id} style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
              <span className="mono" style={{ color: 'var(--orange)', fontSize: '0.75rem' }}>
                {String(i + 1).padStart(2, '0')}
              </span>
              <span style={{ flex: 1 }}>{stage.name}</span>
              <span className="mono" style={{ fontSize: '0.7rem', color: 'var(--muted)' }}>
                {stage.status}
              </span>
            </div>
          ))}
        </div>
      </section>

      <section className="card card--wide">
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <p className="label">Log</p>
          <select value={filter} onChange={(e) => setFilter(e.target.value)} style={{ marginLeft: 'auto' }}>
            <option value="">Semua level</option>
            <option value="info">Info</option>
            <option value="warn">Warn</option>
            <option value="error">Error</option>
          </select>
        </div>
        <div className="log" style={{ marginTop: 16 }} role="log" aria-live="polite">
          {events
            .filter((e) => !filter || e.level === filter)
            .map((e) => (
              <div className="row" key={e.id} data-level={e.level}>
                <span className="mono" style={{ color: 'var(--muted)', flex: 'none' }}>
                  {e.created_at.slice(11, 19)}
                </span>
                <span className="mono" style={{ color: 'var(--orange)', flex: 'none' }}>
                  {e.scope}
                </span>
                <span>{e.message}</span>
              </div>
            ))}
        </div>
      </section>
    </div>
  );
}

// -------------------------------------------------------------- own assets

// ------------------------------------------------------------ artifact panel

interface QaReport {
  passed: boolean;
  preview?: string;
  sharpness?: Record<string, number>;
  issues?: { sceneIndex: number; code: string; reason: string }[];
  video?: { ok?: boolean; width?: number; height?: number; durationSec?: number; expectedDurationSec?: number };
  motion?: { score: number; globalMotion: number; localMotion: number; passed: boolean };
  motionPerScene?: { scene: number; key: string; score: number; passed: boolean }[];
}

function ArtifactPanel({ jobId, artifacts }: { jobId: string; artifacts: string[] }) {
  const [qa, setQa] = useState<QaReport | null>(null);
  const hasQa = artifacts.includes('qa.json');

  useEffect(() => {
    if (!hasQa) {
      setQa(null);
      return;
    }
    api
      .get<{ value: QaReport }>(`/jobs/${jobId}/artifact/qa.json`)
      .then((r) => setQa(r.value))
      .catch(() => setQa(null));
  }, [jobId, hasQa]);

  return (
    <section className="card" style={{ gridColumn: 'span 5' }}>
      <p className="label">Artefak</p>
      {artifacts.length === 0 ? (
        <p className="muted" style={{ marginTop: 8 }}>
          Belum ada artefak.
        </p>
      ) : (
        <ul style={{ marginTop: 12, display: 'grid', gap: 6, listStyle: 'none', padding: 0 }}>
          {artifacts.map((name) => (
            <li key={name} style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
              <span>{name}</span>
              <a
                className="muted"
                href={`/api/jobs/${jobId}/artifact/${name}`}
                target="_blank"
                rel="noreferrer"
              >
                lihat
              </a>
            </li>
          ))}
        </ul>
      )}

      {qa && (
        <div style={{ marginTop: 20, borderTop: '1px solid var(--line)', paddingTop: 16 }}>
          <p className="label">Hasil QA</p>
          <p style={{ marginTop: 8, color: qa.passed ? 'var(--cream)' : 'var(--orange)' }}>
            {qa.passed ? 'Lolos' : `Ditolak · ${qa.issues?.length ?? 0} masalah`}
          </p>
          {qa.video?.durationSec !== undefined && (
            <p className="muted" style={{ marginTop: 6, fontSize: 13 }}>
              {qa.video.width}×{qa.video.height} · {qa.video.durationSec.toFixed(1)} dtk
            </p>
          )}
          {qa.motion && (
            <div style={{ marginTop: 14 }}>
              <p className="muted" style={{ fontSize: 13 }}>
                Gerakan {qa.motion.score.toFixed(2)} · kamera {qa.motion.globalMotion.toFixed(2)} · subjek{' '}
                {qa.motion.localMotion.toFixed(2)}
              </p>
              {qa.motionPerScene && qa.motionPerScene.length > 0 && (
                <ul style={{ marginTop: 8, paddingLeft: 0, listStyle: 'none', fontSize: 12 }}>
                  {qa.motionPerScene.map((s) => (
                    <li
                      key={s.scene}
                      className="muted"
                      style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: '2px 0' }}
                    >
                      <span>
                        {s.scene + 1}. {s.key}
                      </span>
                      <span style={{ color: s.passed ? 'var(--cream)' : 'var(--orange)' }}>
                        {s.score.toFixed(2)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
          {qa.issues && qa.issues.length > 0 && (
            <ul style={{ marginTop: 10, paddingLeft: 18, fontSize: 13 }}>
              {qa.issues.slice(0, 5).map((issue) => (
                <li key={`${issue.sceneIndex}-${issue.code}`} className="muted">
                  Scene {issue.sceneIndex + 1}: {issue.reason}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}

const VIDEO_EXT = /\.(mp4|mov)$/i;

function AssetPanel({ model }: { model: string }) {
  const [files, setFiles] = useState<string[]>([]);
  const [warnings, setWarnings] = useState<Record<string, string>>({});
  const [folder, setFolder] = useState('');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const load = useCallback(() => {
    api
      .get<{ folder: string; files: string[]; warnings?: Record<string, string> }>(
        `/assets/${encodeURIComponent(model)}`,
      )
      .then((res) => {
        setFiles(res.files);
        setWarnings(res.warnings ?? {});
        setFolder(res.folder);
      })
      .catch(() => setFiles([]));
  }, [model]);

  useEffect(load, [load]);

  const upload = async (list: FileList | null) => {
    if (!list?.length) return;
    setBusy(true);
    setNote(null);
    try {
      for (const file of Array.from(list)) {
        const res = await fetch(
          `/api/assets/${encodeURIComponent(model)}?name=${encodeURIComponent(file.name)}`,
          { method: 'POST', credentials: 'same-origin', body: file },
        );
        if (!res.ok) throw new Error(((await res.json()) as { error?: string }).error ?? `HTTP ${res.status}`);
      }
      setNote(`${list.length} berkas tersimpan.`);
      load();
    } catch (err) {
      setNote(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const flagged = files.filter((file) => warnings[file]).length;

  return (
    <section className="card card--wide">
      <p className="label">Aset milik sendiri</p>
      <h2 style={{ marginTop: 8 }}>Foto atau video {model}</h2>
      <p className="muted" style={{ marginTop: 8 }}>
        Visual hanya diambil dari berkas nyata. Unggah foto/video kendaraan ini supaya videonya
        benar-benar model tersebut. Tersimpan di <span className="mono">{folder || 'assets/own/…'}</span>.
      </p>
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginTop: 16, flexWrap: 'wrap' }}>
        <label className="btn btn--primary" style={{ cursor: 'pointer' }}>
          {busy ? 'Mengunggah…' : 'Pilih berkas'}
          <input
            type="file"
            multiple
            accept=".jpg,.jpeg,.png,.webp,.mp4,.mov"
            disabled={busy}
            onChange={(e) => void upload(e.target.files)}
            style={{ display: 'none' }}
          />
        </label>
        <span className="muted mono" style={{ fontSize: '0.78rem' }}>
          {files.length} berkas siap dipakai
        </span>
      </div>
      {note && (
        <p className="muted" style={{ marginTop: 12 }} role="status">
          {note}
        </p>
      )}
      {flagged > 0 && (
        <p className="warn" style={{ marginTop: 16 }} role="alert">
          {flagged} berkas terdeteksi gambar stok acak, bukan kendaraan. Video akan tampil tanpa mobil —
          ganti dulu sebelum render.
        </p>
      )}
      {files.length > 0 && (
        <ul className="asset-grid">
          {files.map((file) => {
            const url = `/api/assets/${encodeURIComponent(model)}/file/${encodeURIComponent(file)}`;
            const warning = warnings[file];
            return (
              <li key={file} className="asset" data-warn={warning ? 'true' : undefined}>
                <div className="asset__frame">
                  {VIDEO_EXT.test(file) ? (
                    <video src={url} muted preload="metadata" />
                  ) : (
                    <img src={url} alt={`Pratinjau ${file}`} loading="lazy" />
                  )}
                  {VIDEO_EXT.test(file) && <span className="asset__badge">video</span>}
                </div>
                <div className="asset__meta">
                  <span className="mono" title={file}>
                    {file}
                  </span>
                  <button
                    className="btn btn--ghost"
                    aria-label={`Hapus ${file}`}
                    onClick={() =>
                      api
                        .send(`/assets/${encodeURIComponent(model)}/${encodeURIComponent(file)}`, undefined, 'DELETE')
                        .then(load)
                        .catch((e: Error) => setNote(e.message))
                    }
                  >
                    Hapus
                  </button>
                </div>
                {warning && <p className="asset__warn">{warning}</p>}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

// ------------------------------------------------------------------- studio

function StudioRoom({ connection }: { connection: Connection }) {
  const [stages, setStages] = useState<Stage[]>([]);
  const [config, setConfig] = useState<Config | null>(null);

  const load = useCallback(async () => {
    const dash = await api.get<{ activeStages: Stage[] }>('/dashboard');
    setStages(dash.activeStages ?? []);
  }, []);

  useEffect(() => {
    void load();
    api.get<Config>('/config').then(setConfig).catch(() => {});
    const timer = setInterval(load, 5000);
    return () => clearInterval(timer);
  }, [load]);

  useEventStream(() => void load());

  const agents = config?.agents ?? [];
  const offline = connection === 'PAUSED_OFFLINE';
  const stateFor = (agentId: string) => {
    const stage = stages.find((s) => s.agent_id === agentId);
    if (!stage) return 'menunggu';
    return stage.status === 'running' ? 'bekerja' : stage.status === 'done' ? 'selesai' : 'menunggu';
  };

  return (
    <div className="bento">
      <section className="card card--wide">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: 12 }}>
          <div>
            <p className="label">Ruang studio</p>
            <h2 style={{ marginTop: 8 }}>Tim agen di meja kerja</h2>
          </div>
          <p className="label">{offline ? 'dijeda' : 'live'}</p>
        </div>

        <div className="studio" data-offline={offline} style={{ marginTop: 20 }} role="img" aria-label="Ilustrasi ruang studio dengan agen bekerja">
          <div className="glow" />
          <div className="desk" />
          <div className="floor" />
          {agents.slice(0, 9).map((agent, i) => {
            const state = stateFor(agent.id);
            const left = 14 + i * 8.6;
            return (
              <div
                key={agent.id}
                className="worker"
                data-state={state}
                style={{ left: `${left}%`, animationDelay: `${i * 0.2}s` }}
                title={`${agent.name} — ${state}`}
              />
            );
          })}
        </div>

        <div className="agents" style={{ marginTop: 20 }}>
          {agents.map((agent, i) => (
            <div className="agent-cube" key={agent.id} data-state={stateFor(agent.id)}>
              <span className="num">{String(i + 1).padStart(2, '0')}</span>
              <span className="name">{agent.name}</span>
              <span className="state">{stateFor(agent.id)}</span>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

// ----------------------------------------------------------------- settings

function Settings() {
  const [config, setConfig] = useState<Config | null>(null);
  const [settings, setSettings] = useState<Record<string, unknown> | null>(null);
  const [saved, setSaved] = useState('');
  const [keys, setKeys] = useState({ imageProviderApiKey: '', videoProviderApiKey: '', stockApiKey: '', llmApiKey: '', igAccessToken: '' });

  useEffect(() => {
    void Promise.all([api.get<Config>('/config'), api.get<Record<string, unknown>>('/settings')]).then(([c, s]) => {
      setConfig(c);
      setSettings(s);
    });
  }, []);

  if (!config || !settings) return <div className="skeleton" style={{ height: 320 }} />;

  const save = async (patch: Record<string, unknown>) => {
    await api.send('/settings', patch, 'PUT');
    setSaved('Tersimpan');
    setTimeout(() => setSaved(''), 2500);
  };

  return (
    <div className="bento">
      <section className="card" style={{ gridColumn: 'span 6' }}>
        <p className="label">Durasi</p>
        <div className="field" style={{ marginTop: 16 }}>
          <label htmlFor="minDurasi">Durasi minimum (detik)</label>
          <input
            id="minDurasi"
            type="number"
            defaultValue={Number(settings.minDurasi)}
            onBlur={(e) => save({ minDurasi: Number(e.target.value) })}
          />
        </div>
        <div className="field">
          <label htmlFor="workTime">Work time total (detik)</label>
          <input
            id="workTime"
            type="number"
            defaultValue={Number((settings.workTime as { total?: number })?.total ?? 90)}
            onBlur={(e) => save({ workTime: { ...(settings.workTime as object), mode: 'real', total: Number(e.target.value) } })}
          />
        </div>
        <div className="field">
          <label htmlFor="preset">Preset agen</label>
          <select
            id="preset"
            defaultValue={String(settings.agentPreset)}
            onChange={(e) => save({ agentPreset: e.target.value })}
          >
            {config.presets.map((p) => (
              <option key={p.name} value={p.name}>
                {p.name} ({p.agents.length} agen)
              </option>
            ))}
          </select>
        </div>
      </section>

      <section className="card" style={{ gridColumn: 'span 6' }}>
        <p className="label">Batas biaya</p>
        <div className="field" style={{ marginTop: 16 }}>
          <label htmlFor="maxJob">Maks biaya per job (USD)</label>
          <input id="maxJob" type="number" step="0.5" defaultValue={Number(settings.maxCostPerJob)} onBlur={(e) => save({ maxCostPerJob: Number(e.target.value) })} />
        </div>
        <div className="field">
          <label htmlFor="maxDay">Maks biaya per hari (USD)</label>
          <input id="maxDay" type="number" step="1" defaultValue={Number(settings.maxCostPerHari)} onBlur={(e) => save({ maxCostPerHari: Number(e.target.value) })} />
        </div>
        <p className="muted" style={{ fontSize: '0.82rem' }}>
          Job yang melewati batas menunggu persetujuan, tidak berjalan sendiri.
        </p>
      </section>

      <section className="card card--wide">
        <p className="label">Kunci API (hanya tulis, tidak pernah ditampilkan kembali)</p>
        <div className="model-grid" style={{ marginTop: 16 }}>
          {(
            [
              ['imageProviderApiKey', 'Generator gambar', config.adapters.find((a) => a.kind === 'image-gen')?.configured],
              ['videoProviderApiKey', 'Generator video', config.adapters.find((a) => a.kind === 'video-gen')?.configured],
              ['stockApiKey', 'Stock footage', config.adapters.find((a) => a.kind === 'stock-api')?.configured],
              ['llmApiKey', 'LLM agen', Boolean(config.llm?.model)],
              ['igAccessToken', 'Instagram token', false],
            ] as [keyof typeof keys, string, boolean | undefined][]
          ).map(([key, label, configured]) => (
            <div className="field" key={key} style={{ margin: 0 }}>
              <label htmlFor={key}>
                {label} {configured ? '· terpasang' : '· belum'}
              </label>
              <input
                id={key}
                type="password"
                autoComplete="off"
                value={keys[key]}
                onChange={(e) => setKeys({ ...keys, [key]: e.target.value })}
                placeholder="••••••••"
              />
              <button className="btn btn--ghost" style={{ minHeight: 36 }} onClick={() => save({ [key]: keys[key] })}>
                Simpan
              </button>
            </div>
          ))}
        </div>
        {saved && <p className="mono" style={{ color: 'var(--orange)', marginTop: 12 }}>{saved}</p>}
      </section>

      <section className="card card--wide">
        <p className="label">Kemampuan LLM</p>
        <p className="muted" style={{ marginTop: 12 }}>
          {config.llm?.supportsImages
            ? `Model ${config.llm.model} menerima gambar, QA visual aktif.`
            : `Visual review dilewati: ${config.llm?.note ?? 'model tidak menerima gambar'}.`}
        </p>
      </section>
    </div>
  );
}

// ----------------------------------------------------------------- schedule

function Schedule() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [pubs, setPubs] = useState<Record<string, unknown>[]>([]);

  useEffect(() => {
    api.get<{ jobs: Job[] }>('/jobs?limit=100').then((d) => setJobs(d.jobs));
    api.get<{ publications: Record<string, unknown>[] }>('/dashboard').then((d) => setPubs(d.publications ?? []));
  }, []);

  return (
    <div className="bento">
      <section className="card card--wide">
        <p className="label">Jadwal publish</p>
        <div style={{ overflowX: 'auto', marginTop: 16 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                {['Model', 'Jadwal', 'Status job', 'Publish'].map((h) => (
                  <th key={h} className="label" style={{ textAlign: 'left', padding: '10px 12px', borderBottom: '1px solid var(--border)' }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {jobs.map((job) => (
                <tr key={job.id}>
                  <td style={{ padding: '12px' }}>{job.model}</td>
                  <td style={{ padding: '12px' }} className="mono">
                    {(JSON.parse(job.brief_json).jadwalPublish as string) ?? '—'}
                  </td>
                  <td style={{ padding: '12px' }} className="mono">
                    {job.status}
                  </td>
                  <td style={{ padding: '12px' }} className="mono">
                    {String(pubs.find((p) => p.job_id === job.id)?.status ?? '—')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

// --------------------------------------------------------------------- auth

function Auth({ onDone }: { onDone: () => void }) {
  const [needsSetup, setNeedsSetup] = useState<boolean | null>(null);
  const [login, setLogin] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    api.get<{ needsSetup: boolean }>('/bootstrap').then((d) => setNeedsSetup(d.needsSetup));
  }, []);

  const submit = async () => {
    setError('');
    try {
      if (needsSetup) await api.send('/setup', { email: login, password, username: login.split('@')[0] });
      else await api.send('/login', { email: login, password });
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'gagal');
    }
  };

  return (
    <div className="bento" style={{ maxWidth: 520, margin: '10vh auto 0' }}>
      <section className="card card--wide">
        <p className="label">{needsSetup ? 'Setup pertama' : 'Masuk'}</p>
        <h1 style={{ marginTop: 12, fontSize: '2rem' }}>STUDIO<span style={{ color: 'var(--orange)' }}>/</span>OTOMOTIF</h1>
        <div className="field" style={{ marginTop: 24 }}>
          <label htmlFor="login">{needsSetup ? 'Email' : 'Username atau email'}</label>
          <input id="login" type="text" value={login} onChange={(e) => setLogin(e.target.value)} autoComplete="username" />
        </div>
        <div className="field">
          <label htmlFor="password">Password</label>
          <input
            id="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete={needsSetup ? 'new-password' : 'current-password'}
          />
        </div>
        {error && (
          <p role="alert" style={{ color: 'var(--orange)' }}>
            {error}
          </p>
        )}
        <button className="btn btn--primary" onClick={submit} disabled={!login || !password}>
          {needsSetup ? 'Buat akun admin' : 'Masuk'}
        </button>
      </section>
    </div>
  );
}

// ---------------------------------------------------------------------- app

function App() {
  const [route, navigate] = useRoute();
  const [connection, setConnection] = useState<Connection>('ONLINE');
  const [user, setUser] = useState<{ email: string; username: string | null } | null>(null);
  const [checking, setChecking] = useState(true);

  const refreshMe = useCallback(() => {
    api
      .get<{ user: { email: string; username: string | null } | null }>('/me')
      .then((d) => setUser(d.user))
      .catch(() => setUser(null))
      .finally(() => setChecking(false));
  }, []);

  useEffect(() => {
    refreshMe();
  }, [refreshMe]);

  useEventStream((type, payload) => {
    if (type === 'connection') {
      const p = payload as { data?: { status?: Connection } };
      if (p.data?.status) setConnection(p.data.status);
    }
  });

  useEffect(() => {
    api.get<{ connection: Connection }>('/health').then((d) => setConnection(d.connection)).catch(() => {});
  }, []);

  if (checking) return <div className="shell"><div className="skeleton" style={{ height: 200 }} /></div>;

  if (!user) {
    return (
      <div className="shell">
        <Auth onDone={refreshMe} />
      </div>
    );
  }

  const jobMatch = route.match(/^\/job\/(.+)$/);

  return (
    <div className="shell">
      <Header
        route={route}
        navigate={navigate}
        connection={connection}
        onNew={() => navigate('/template-baru')}
        user={user}
        onLogout={async () => {
          await api.send('/logout', {}).catch(() => {});
          setUser(null);
        }}
      />
      <div className="ruler" aria-hidden="true" />
      <OfflineBanner connection={connection} />
      {route === '/' && <Dashboard navigate={navigate} connection={connection} />}
      {route === '/template-baru' && <NewTemplate navigate={navigate} />}
      {jobMatch && <JobDetail id={jobMatch[1]} />}
      {route === '/studio' && <StudioRoom connection={connection} />}
      {route === '/pengaturan' && <Settings />}
      {route === '/jadwal' && <Schedule />}
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<App />);
