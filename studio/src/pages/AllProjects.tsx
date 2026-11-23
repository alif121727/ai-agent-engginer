import React from 'react';
import { EmptyState, Icon } from '../components/ui';
import type { Route } from '../components/shell';
import { loadSnapshot, formatBytes, type SnapshotProject } from '../services/snapshot';

// Daftar seluruh proyek yang pernah dikerjakan, apa pun statusnya, langsung
// dari snapshot hasil render nyata. Tujuannya menjawab "mana hasil kerja saya"
// tanpa harus membuka satu per satu.
export function AllProjects({ go }: { go: (r: Route) => void }) {
  const [data, setData] = React.useState<SnapshotProject[] | null>(null);
  const [generatedAt, setGeneratedAt] = React.useState('');
  const [q, setQ] = React.useState('');
  const [filter, setFilter] = React.useState<'semua' | 'video' | 'tanpa-video'>('semua');
  const [open, setOpen] = React.useState<SnapshotProject | null>(null);

  React.useEffect(() => {
    let alive = true;
    loadSnapshot().then((s) => {
      if (!alive) return;
      setData(s?.projects ?? []);
      setGeneratedAt(s?.generatedAt ?? '');
    });
    return () => { alive = false; };
  }, []);

  const list = (data ?? []).filter((p) => {
    const s = q.trim().toLowerCase();
    const cocok = !s || `${p.title} ${p.model}`.toLowerCase().includes(s);
    const lolosFilter = filter === 'semua' || (filter === 'video' ? p.hasVideo : !p.hasVideo);
    return cocok && lolosFilter;
  });

  const totalVideo = (data ?? []).filter((p) => p.hasVideo).length;
  const totalBytes = (data ?? []).reduce((a, p) => a + (p.sizeBytes || 0), 0);

  return (
    <div className="page stack" style={{ gap: 18 }}>
      <div className="row row--between row--wrap">
        <div>
          <div className="eyebrow">Semua proyek</div>
          <h1 style={{ marginTop: 4 }}>{data === null ? 'Memuat…' : `${data.length} proyek dikerjakan`}</h1>
          <p className="muted small" style={{ marginTop: 4 }}>
            {data === null
              ? 'Membaca snapshot hasil render.'
              : `${totalVideo} punya video siap tonton · ${formatBytes(totalBytes)} total berkas${generatedAt ? ` · snapshot ${new Date(generatedAt).toLocaleString('id-ID')}` : ''}`}
          </p>
        </div>
        <button className="btn btn--primary" onClick={() => go({ name: 'baru' })}><Icon.Plus size={15} /> Buat Video</button>
      </div>

      {data !== null && data.length > 0 && (
        <div className="row row--wrap" style={{ gap: 10 }}>
          <div className="row" style={{ flex: 1, minWidth: 240, position: 'relative' }}>
            <span style={{ position: 'absolute', left: 11, color: 'var(--text-3)' }}><Icon.Search size={15} /></span>
            <input className="input" style={{ paddingLeft: 34 }} placeholder="Cari proyek atau mobil…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Cari proyek" />
          </div>
          <div className="seg">
            <button aria-pressed={filter === 'semua'} onClick={() => setFilter('semua')}>Semua</button>
            <button aria-pressed={filter === 'video'} onClick={() => setFilter('video')}>Ada video</button>
            <button aria-pressed={filter === 'tanpa-video'} onClick={() => setFilter('tanpa-video')}>Tanpa video</button>
          </div>
        </div>
      )}

      {data !== null && data.length === 0 && (
        <EmptyState
          art={<Icon.Film size={28} />}
          title="Snapshot proyek belum ada"
          text="Jalankan `npm run export:projects` untuk menulis data/projects.json dari job nyata, lalu deploy ulang."
        />
      )}

      {list.length > 0 && (
        <div className="vgrid">
          {list.map((p) => (
            <article key={p.id} className="card card--tight stack" style={{ gap: 10 }}>
              {p.thumbPath ? (
                <button
                  onClick={() => p.hasVideo && setOpen(p)}
                  style={{ padding: 0, border: 0, background: 'none', cursor: p.hasVideo ? 'pointer' : 'default', borderRadius: 10, overflow: 'hidden', display: 'block', width: '100%' }}
                  aria-label={p.hasVideo ? `Putar ${p.title}` : p.title}
                >
                  <img src={p.thumbPath} alt={`Pratinjau ${p.title}`} loading="lazy" style={{ width: '100%', display: 'block', aspectRatio: '16 / 9', objectFit: 'cover' }} />
                </button>
              ) : (
                <div style={{ aspectRatio: '16 / 9', display: 'grid', placeItems: 'center', background: 'var(--surface-2)', borderRadius: 10 }}>
                  <span className="dim tiny">tanpa pratinjau</span>
                </div>
              )}

              <div className="row row--between row--wrap" style={{ gap: 6 }}>
                <span className="chip chip--accent">{p.durationSec}s</span>
                {p.hasVideo
                  ? <span className="chip chip--ok">video siap</span>
                  : <span className="chip chip--warn">tanpa video</span>}
                {p.qa && (
                  <span className={`chip ${p.qa.passed ? 'chip--ok' : 'chip--warn'}`}>
                    QA {p.qa.passed ? 'lolos' : 'gagal'} {p.qa.checks} cek
                  </span>
                )}
              </div>

              <div>
                <div style={{ fontWeight: 600 }}>{p.title}</div>
                <div className="dim tiny mono">{new Date(p.createdAt).toLocaleString('id-ID')}</div>
              </div>

              {p.render && (
                <div className="dim tiny mono">
                  {p.render.width}×{p.render.height} · {p.render.fps} fps · {p.render.codec} · {p.render.scenes} scene{p.render.hasAudio ? ' · audio' : ''}
                </div>
              )}

              {p.specs && p.specs.length > 0 && (
                <div className="tiny muted" style={{ lineHeight: 1.5 }}>{p.specs.slice(0, 3).map((x) => (typeof x === 'string' ? x : (x as any)?.text)).filter(Boolean).join(' · ')}</div>
              )}

              <div className="row" style={{ gap: 6 }}>
                {p.hasVideo && <button className="btn btn--sm btn--primary" onClick={() => setOpen(p)}>Lihat hasil</button>}
                {p.hasVideo && (
                  <a className="btn btn--sm" href={p.videoPath ?? '#'} download={`${p.id}.mp4`}>Unduh</a>
                )}
                {p.error && <span className="chip chip--warn" title={p.error}>ada galat</span>}
              </div>
            </article>
          ))}
        </div>
      )}

      {data !== null && data.length > 0 && list.length === 0 && (
        <div className="empty"><div className="empty__text">Tidak ada proyek yang cocok dengan “{q}”.</div></div>
      )}

      {open && (
        <div
          onClick={() => setOpen(null)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.72)', display: 'grid', placeItems: 'center', padding: 20, zIndex: 50 }}
        >
          <div className="card stack" style={{ gap: 12, maxWidth: 900, width: '100%' }} onClick={(e) => e.stopPropagation()}>
            <div className="row row--between">
              <div>
                <div style={{ fontWeight: 600 }}>{open.title}</div>
                <div className="dim tiny">{open.durationSec}s · {open.render ? `${open.render.width}×${open.render.height} ${open.render.fps} fps` : open.aspect}</div>
              </div>
              <button className="btn btn--ghost btn--sm" onClick={() => setOpen(null)} aria-label="Tutup">Tutup</button>
            </div>
            <video src={open.videoPath ?? ''} controls autoPlay playsInline style={{ width: '100%', borderRadius: 10, background: '#000' }} />
            <div className="row row--wrap" style={{ gap: 6 }}>
              <a className="btn btn--sm" href={open.videoPath ?? '#'} download={`${open.id}.mp4`}>Unduh mp4</a>
              <span className="dim tiny mono">{formatBytes(open.sizeBytes)}</span>
              {open.qa && <span className="dim tiny">QA: {open.qa.checks} cek, {open.qa.failed} gagal</span>}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
