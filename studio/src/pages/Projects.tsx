import React from 'react';
import { useStudio } from '../state/store';
import { EmptyState, Icon } from '../components/ui';
import type { Route } from '../components/shell';
import { CATALOG } from '../data/catalog';
import { listResearched } from '../data/researched';
import { StatusChip } from './Dashboard';

export function Projects({ go }: { go: (r: Route) => void }) {
  const { projects, remove, toast } = useStudio();
  const [q, setQ] = React.useState('');
  const list = projects.filter((p) => !q.trim() || p.title.toLowerCase().includes(q.trim().toLowerCase()));

  return (
    <div className="page stack" style={{ gap: 18 }}>
      <div className="row row--between row--wrap">
        <div>
          <div className="eyebrow">Proyek saya</div>
          <h1 style={{ marginTop: 4 }}>{projects.length} proyek</h1>
        </div>
        <button className="btn btn--primary" onClick={() => go({ name: 'baru' })}><Icon.Plus size={15} /> Buat Video</button>
      </div>

      {projects.length > 0 && (
        <div className="row" style={{ position: 'relative', maxWidth: 340 }}>
          <span style={{ position: 'absolute', left: 11, color: 'var(--text-3)' }}><Icon.Search size={15} /></span>
          <input className="input" style={{ paddingLeft: 34 }} placeholder="Cari proyek…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Cari proyek" />
        </div>
      )}

      {projects.length === 0 ? (
        <EmptyState
          art={<Icon.Folder size={28} />}
          title="Belum ada proyek"
          text="Setiap proyek menyimpan brief, storyboard, dan status sembilan tahap produksinya. Mulai satu untuk melihat cara kerjanya."
          action={<button className="btn btn--primary" onClick={() => go({ name: 'baru' })}><Icon.Plus size={15} /> Mulai proyek pertama</button>}
        />
      ) : (
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <table className="table">
            <thead>
              <tr><th>Proyek</th><th>Mobil</th><th>Durasi</th><th>Status</th><th>Diperbarui</th><th /></tr>
            </thead>
            <tbody>
              {list.map((p) => {
                const done = p.stages.filter((s) => s.state === 'selesai').length;
                return (
                  <tr key={p.id}>
                    <td>
                      <button className="btn btn--ghost btn--sm" style={{ padding: 0, fontWeight: 600 }} onClick={() => go({ name: 'proyek-detail', id: p.id })}>{p.title}</button>
                      <div className="dim tiny">{done}/{p.stages.length} tahap</div>
                    </td>
                    <td className="small muted">{p.carName}</td>
                    <td className="mono small">{p.durationSec}s</td>
                    <td><StatusChip status={p.status} /></td>
                    <td className="dim tiny">{new Date(p.updatedAt).toLocaleDateString('id-ID')}</td>
                    <td>
                      <div className="row" style={{ gap: 4, justifyContent: 'flex-end' }}>
                        <button className="btn btn--sm" onClick={() => go({ name: 'proyek-detail', id: p.id })}>Buka</button>
                        <button className="btn btn--ghost btn--sm" title="Hapus" onClick={async () => { await remove(p.id); toast({ title: 'Proyek dihapus', kind: 'ok' }); }}>
                          <Icon.Trash size={13} />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {list.length === 0 && <div className="empty" style={{ border: 0 }}><div className="empty__text">Tidak ada proyek yang cocok dengan “{q}”.</div></div>}
        </div>
      )}
    </div>
  );
}

export function Garage({ go }: { go: (r: Route) => void }) {
  const [q, setQ] = React.useState('');
  const [kategori, setKategori] = React.useState('semua');
  // Hasil riset web ikut tampil supaya mobil yang baru dicari tetap bisa dibuka.
  const researched = listResearched().map((r) => r.car);
  const all = [...researched, ...CATALOG];
  const list = all.filter((c) => {
    const s = q.trim().toLowerCase();
    return (kategori === 'semua' || c.kategori === kategori) && (!s || `${c.merk} ${c.model} ${c.seri}`.toLowerCase().includes(s));
  });
  const researchedSlugs = new Set(researched.map((c) => c.slug));

  return (
    <div className="page stack" style={{ gap: 18 }}>
      <div>
        <div className="eyebrow">Garasi</div>
        <h1 style={{ marginTop: 4 }}>Katalog mobil</h1>
        <p className="muted small" style={{ marginTop: 4 }}>
          {CATALOG.length} model katalog{researched.length > 0 ? ` + ${researched.length} hasil riset web` : ''} — semua angka bersumber dari Wikipedia. Studio tidak mengarang spesifikasi; kolom yang tidak ada ditandai kosong.
        </p>
      </div>

      <div className="row row--wrap">
        <div className="row" style={{ flex: 1, minWidth: 220, position: 'relative' }}>
          <span style={{ position: 'absolute', left: 11, color: 'var(--text-3)' }}><Icon.Search size={15} /></span>
          <input className="input" style={{ paddingLeft: 34 }} placeholder="Cari mobil…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Cari mobil" />
        </div>
        <div className="seg">
          {['semua', 'sport', 'klasik', 'balap', 'modifikasi'].map((k) => <button key={k} aria-pressed={kategori === k} onClick={() => setKategori(k)}>{k}</button>)}
        </div>
      </div>

      {list.length === 0 ? (
        <EmptyState art={<Icon.Car size={28} />} title="Tidak ada mobil yang cocok" text="Coba kata kunci lain atau pilih kategori berbeda." />
      ) : (
        <div className="vgrid">
          {list.map((c) => (
            <article key={c.slug} className="card card--tight stack" style={{ gap: 8 }}>
              <div className="row row--between">
                <span className="row" style={{ gap: 6 }}>
                  <span className="chip chip--accent">{c.kategori}</span>
                  {researchedSlugs.has(c.slug) && <span className="chip chip--info">riset web</span>}
                </span>
                <span className="dim tiny mono">{c.tahun}</span>
              </div>
              <div>
                <div style={{ fontWeight: 650, fontSize: '0.9rem' }}>{c.model}</div>
                <div className="dim tiny">{c.seri}</div>
              </div>
              <div className="vcard__specs">
                <span>{c.tenaga}</span>
                <span>{c.torsi}</span>
                <span>{c.nol100}</span>
                <span>{c.vmax}</span>
              </div>
              <p className="dim tiny" style={{ marginTop: 2 }}>{c.tagline}</p>
              <div className="row" style={{ gap: 6, marginTop: 'auto' }}>
                <button className="btn btn--sm btn--primary" onClick={() => go({ name: 'baru', car: c.slug })}>Buat video</button>
                <a className="btn btn--ghost btn--sm" href={c.sumber} target="_blank" rel="noreferrer">Sumber <Icon.ChevronR size={11} /></a>
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
