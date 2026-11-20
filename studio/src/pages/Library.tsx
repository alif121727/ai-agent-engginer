import React from 'react';
import { EmptyState, Icon, Skeleton } from '../components/ui';
import type { Route } from '../components/shell';
import { RENDERED, VIDEO_BASE, THUMB_BASE, specsOf, type RenderedVideo } from '../data/rendered';

// Metadata video nyata ada di data/rendered.ts supaya Perpustakaan dan benih
// proyek demo memakai angka yang sama.
export type LibItem = RenderedVideo;

const BASE = VIDEO_BASE;
const THUMB = THUMB_BASE;

export function Library({ go }: { go: (r: Route) => void }) {
  const [q, setQ] = React.useState('');
  const [merk, setMerk] = React.useState('semua');
  const [kategori, setKategori] = React.useState('semua');
  const [dur, setDur] = React.useState<'semua' | 'pendek' | 'panjang'>('semua');
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
    const t = setTimeout(() => setLoading(false), 300);
    return () => clearTimeout(t);
  }, []);

  const merks = ['semua', ...Array.from(new Set(RENDERED.map((v) => v.merk)))];
  const list = RENDERED.filter((v) => {
    const s = q.trim().toLowerCase();
    const okQ = !s || `${v.title} ${v.merk} ${v.kategori}`.toLowerCase().includes(s);
    const okM = merk === 'semua' || v.merk === merk;
    const okK = kategori === 'semua' || v.kategori === kategori;
    const okD = dur === 'semua' || (dur === 'pendek' ? v.dur <= 30 : v.dur > 30);
    return okQ && okM && okK && okD;
  });

  return (
    <div className="page stack" style={{ gap: 18 }}>
      <div>
        <div className="eyebrow">Perpustakaan</div>
        <h1 style={{ marginTop: 4 }}>Video yang sudah jadi</h1>
        <p className="muted small" style={{ marginTop: 4 }}>
          {RENDERED.length} video hasil pipeline nyata — dirender dengan ffmpeg dari foto asli, bukan animasi placeholder.
        </p>
      </div>

      <div className="card card--tight stack" style={{ gap: 10 }}>
        <div className="row row--wrap">
          <div className="row" style={{ flex: 1, minWidth: 220, position: 'relative' }}>
            <span style={{ position: 'absolute', left: 11, color: 'var(--text-3)' }}><Icon.Search size={15} /></span>
            <input className="input" style={{ paddingLeft: 34 }} placeholder="Cari judul atau merek…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Cari video" />
          </div>
          <select className="select" style={{ width: 'auto' }} value={merk} onChange={(e) => setMerk(e.target.value)} aria-label="Filter merek">
            {merks.map((m) => <option key={m} value={m}>{m === 'semua' ? 'Semua merek' : m}</option>)}
          </select>
          <select className="select" style={{ width: 'auto' }} value={kategori} onChange={(e) => setKategori(e.target.value)} aria-label="Filter kategori">
            {['semua', 'sport', 'klasik', 'balap', 'modifikasi'].map((k) => <option key={k} value={k}>{k === 'semua' ? 'Semua gaya' : k}</option>)}
          </select>
          <div className="seg">
            {([['semua', 'Semua'], ['pendek', '≤30s'], ['panjang', '>30s']] as const).map(([k, l]) => (
              <button key={k} aria-pressed={dur === k} onClick={() => setDur(k)}>{l}</button>
            ))}
          </div>
        </div>
        <div className="dim tiny">{list.length} hasil</div>
      </div>

      {loading ? (
        <div className="vgrid">{[0, 1, 2, 3, 4, 5].map((i) => <Skeleton key={i} variant="card" />)}</div>
      ) : list.length === 0 ? (
        <EmptyState art={<Icon.Library size={28} />} title="Tidak ada video yang cocok" text="Ubah filter atau kata kunci pencarian Anda." action={<button className="btn" onClick={() => { setQ(''); setMerk('semua'); setKategori('semua'); setDur('semua'); }}>Reset filter</button>} />
      ) : (
        <div className="vgrid">
          {list.map((v) => (
            <article key={v.slug} className="vcard">
              <div className="vcard__media">
                <video src={BASE + v.slug + '.mp4'} poster={THUMB + v.slug + '.jpg'} controls preload="metadata" playsInline />
                <span className="vcard__badge">{v.dur}s</span>
                <span className="vcard__ai">AI-GENERATED</span>
              </div>
              <div className="vcard__body">
                <div className="row row--between">
                  <h3 className="vcard__title truncate">{v.title}</h3>
                  {v.qa === 'tanpa-foto' ? <span className="chip chip--warn">tanpa foto</span> : <span className="chip chip--ok">QA lolos</span>}
                </div>
                <div className="vcard__specs">{specsOf(v).map((s) => <span key={s}>{s}</span>)}</div>
                <div className="row row--wrap" style={{ gap: 6, marginTop: 'auto' }}>
                  <span className="chip chip--accent">{v.kategori}</span>
                  <span className="chip">{v.aspect}</span>
                  <span className="chip">{v.tahun}</span>
                </div>
              </div>
              <div className="vcard__foot">
                <a className="btn btn--sm" href={BASE + v.slug + '.mp4'} download><Icon.Download size={13} /> Unduh</a>
                <button className="btn btn--ghost btn--sm" onClick={() => go({ name: 'baru' })}>Buat versi baru</button>
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
