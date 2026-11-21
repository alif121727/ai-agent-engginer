import React from 'react';
import { useStudio } from '../state/store';
import { EmptyState, Icon, Skeleton } from '../components/ui';
import type { Route } from '../components/shell';
import { STAGES, VIDEO_MODELS } from '../data/models';
import { CATALOG } from '../data/catalog';

export function Dashboard({ go }: { go: (r: Route) => void }) {
  const { projects, user, settings } = useStudio();
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
    const t = setTimeout(() => setLoading(false), 260);
    return () => clearTimeout(t);
  }, []);

  const done = projects.filter((p) => p.status === 'done');
  const running = projects.filter((p) => p.status === 'running');
  const failed = projects.filter((p) => p.status === 'failed');
  // Durasi hanya dihitung dari proyek yang benar-benar menghasilkan mp4;
  // menjumlahkan proyek gagal membuat statistik terlihat lebih besar dari
  // kenyataan.
  const totalSec = done.reduce((a, p) => a + (p.durationSec || 0), 0);
  const model = VIDEO_MODELS.find((m) => m.id === settings.defaultModel);

  if (loading) {
    return (
      <div className="page stack">
        <div className="grid grid--4">
          {[0, 1, 2, 3].map((i) => <div key={i} className="stat"><Skeleton w="40%" /><div style={{ height: 10 }} /><Skeleton variant="title" w="55%" /></div>)}
        </div>
        <div className="grid grid--3">
          {[0, 1, 2].map((i) => <Skeleton key={i} variant="card" />)}
        </div>
      </div>
    );
  }

  return (
    <div className="page stack" style={{ gap: 24 }}>
      <div className="row row--between row--wrap" style={{ alignItems: 'flex-end' }}>
        <div>
          <div className="eyebrow">Selamat datang kembali</div>
          <h1 style={{ marginTop: 4 }}>{user?.name}</h1>
          <p className="muted small" style={{ marginTop: 4 }}>
            Studio produksi video otomotif berbasis data. Setiap angka di video berasal dari katalog atau brief Anda.
          </p>
        </div>
        <button className="btn btn--primary btn--lg" onClick={() => go({ name: 'baru' })}>
          <Icon.Plus size={16} /> Buat Video
        </button>
      </div>

      <div className="grid grid--4">
        <Stat
          label="Proyek"
          value={String(projects.length)}
          meta={`${done.length} selesai · ${running.length} berjalan${failed.length ? ` · ${failed.length} gagal` : ''}`}
        />
        <Stat label="Total durasi" value={`${totalSec}s`} meta="akumulasi semua proyek" />
        <Stat label="Model default" value={model?.name.split(' ')[0] ?? '—'} meta={model?.ready ? 'siap dipakai' : 'butuh kunci API'} />
        <Stat label="Katalog" value={String(CATALOG.length)} meta="model mobil dengan data nyata" />
      </div>

      <div className="grid grid--3">
        <QuickCard
          icon={<Icon.Plus size={18} />}
          title="Mulai dari brief"
          text="Pilih mobil dari katalog, isi spesifikasi, lalu biarkan AI menyusun naskah dan storyboard."
          cta="Buat video baru"
          onClick={() => go({ name: 'baru' })}
        />
        <QuickCard
          icon={<Icon.Library size={18} />}
          title="Lihat hasil jadi"
          text="Semua video yang benar-benar sudah dirender, lengkap dengan spesifikasi sumbernya."
          cta="Buka perpustakaan"
          onClick={() => go({ name: 'perpustakaan' })}
        />
        <QuickCard
          icon={<Icon.Car size={18} />}
          title="Kelola garasi"
          text="Simpan data mobil yang sering Anda pakai agar tidak perlu mengetik ulang."
          cta="Buka garasi"
          onClick={() => go({ name: 'garasi' })}
        />
      </div>

      <section className="stack" style={{ gap: 12 }}>
        <div className="row row--between">
          <h2>Proyek terakhir</h2>
          {projects.length > 0 && (
            <button className="btn btn--ghost btn--sm" onClick={() => go({ name: 'proyek' })}>
              Lihat semua <Icon.ChevronR size={13} />
            </button>
          )}
        </div>
        {projects.length === 0 ? (
          <EmptyState
            art={<Icon.Film size={30} />}
            title="Belum ada proyek"
            text="Studio ini bekerja dalam sembilan tahap: rencana, riset, naskah, storyboard, aset visual, motion, audio, render, lalu QA. Mulai satu proyek untuk melihat seluruh prosesnya."
            action={
              <button className="btn btn--primary" onClick={() => go({ name: 'baru' })}>
                <Icon.Plus size={15} /> Mulai proyek pertama
              </button>
            }
          />
        ) : (
          <div className="vgrid">
            {projects.slice(0, 3).map((p) => (
              <button key={p.id} className="vcard" style={{ textAlign: 'left', cursor: 'pointer' }} onClick={() => go({ name: 'proyek-detail', id: p.id })}>
                <div className="vcard__body">
                  <div className="row row--between">
                    <span className="vcard__title truncate">{p.title}</span>
                    <StatusChip status={p.status} />
                  </div>
                  <div className="vcard__specs">
                    <span>{p.durationSec}s</span>
                    <span>{p.aspect}</span>
                    <span>{p.resolution}</span>
                  </div>
                  <div className="dim tiny">{new Date(p.updatedAt).toLocaleString('id-ID')}</div>
                </div>
              </button>
            ))}
          </div>
        )}
      </section>

      <section className="card">
        <div className="row row--between" style={{ marginBottom: 12 }}>
          <h2>Sembilan tahap produksi</h2>
          <span className="chip">pipeline nyata</span>
        </div>
        <div className="grid grid--3" style={{ gap: 10 }}>
          {STAGES.map((s, i) => (
            <div key={s.id} className="row" style={{ gap: 10, padding: '8px 10px', background: 'var(--surface-2)', borderRadius: 8 }}>
              <span className="mono tiny dim" style={{ minWidth: 18 }}>{String(i + 1).padStart(2, '0')}</span>
              <div style={{ minWidth: 0 }}>
                <div className="small" style={{ fontWeight: 600 }}>{s.label}</div>
                <div className="dim tiny truncate">{s.desc}</div>
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

function Stat({ label, value, meta }: { label: string; value: string; meta: string }) {
  return (
    <div className="stat">
      <div className="stat__label">{label}</div>
      <div className="stat__value">{value}</div>
      <div className="stat__meta">{meta}</div>
    </div>
  );
}

function QuickCard({ icon, title, text, cta, onClick }: { icon: React.ReactNode; title: string; text: string; cta: string; onClick: () => void }) {
  return (
    <div className="card stack" style={{ gap: 10 }}>
      <div style={{ width: 34, height: 34, borderRadius: 9, background: 'var(--accent-dim)', color: 'var(--accent)', display: 'grid', placeItems: 'center' }}>{icon}</div>
      <h3>{title}</h3>
      <p className="muted small" style={{ flex: 1 }}>{text}</p>
      <button className="btn btn--sm" onClick={onClick} style={{ alignSelf: 'flex-start' }}>{cta}</button>
    </div>
  );
}

export function StatusChip({ status }: { status: string }) {
  const map: Record<string, { cls: string; label: string }> = {
    draft: { cls: '', label: 'Draf' },
    running: { cls: 'chip--warn', label: 'Berjalan' },
    done: { cls: 'chip--ok', label: 'Selesai' },
    failed: { cls: 'chip--err', label: 'Gagal' },
  };
  const m = map[status] ?? { cls: '', label: status };
  return <span className={`chip ${m.cls}`}>{m.label}</span>;
}
