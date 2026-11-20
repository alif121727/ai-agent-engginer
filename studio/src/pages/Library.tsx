import React from 'react';
import { EmptyState, Icon, Skeleton } from '../components/ui';
import type { Route } from '../components/shell';
import { CATALOG } from '../data/catalog';

// Delapan video yang benar-benar sudah dirender oleh pipeline repo ini.
// Metadata diambil dari jobs/*/artifacts + durasi nyata file mp4.
export type LibItem = {
  slug: string;
  title: string;
  merk: string;
  kategori: string;
  tahun: string;
  dur: number;
  aspect: '16:9' | '9:16';
  specs: string[];
  qa: 'lolos' | 'tanpa-foto';
  modelAi: string;
};

export const LIBRARY: LibItem[] = [
  { slug: 'mazda-rx7', title: 'Mazda RX-7 (FD3S)', merk: 'Mazda', kategori: 'klasik', tahun: '1992–2002', dur: 45, aspect: '16:9', specs: ['rotary twin-turbo 1.3L', '255–280 PS', '294 Nm', '0–100 5,3 dtk'], qa: 'lolos', modelAi: 'Studio Render (lokal)' },
  { slug: 'ferrari-296-gtb', title: 'Ferrari 296 GTB', merk: 'Ferrari', kategori: 'sport', tahun: '2022–2025', dur: 30, aspect: '16:9', specs: ['V6 3.0L + listrik', '830 PS', '740 Nm', '0–100 2,9 dtk'], qa: 'lolos', modelAi: 'Studio Render (lokal)' },
  { slug: 'porsche-taycan', title: 'Porsche Taycan Turbo S', merk: 'Porsche', kategori: 'sport', tahun: '2019–sekarang', dur: 45, aspect: '16:9', specs: ['dual motor AC', '761 PS', '1.050 Nm', '0–100 2,8 dtk'], qa: 'lolos', modelAi: 'Studio Render (lokal)' },
  { slug: 'skyline-r34', title: 'Nissan Skyline GT-R R34', merk: 'Nissan', kategori: 'modifikasi', tahun: '2005 (19 unit)', dur: 30, aspect: '16:9', specs: ['RB26DETT 2.8L', '500 PS', '540 Nm', 'AWD'], qa: 'lolos', modelAi: 'Studio Render (lokal)' },
  { slug: 'huracan-sto', title: 'Lamborghini Huracán STO', merk: 'Lamborghini', kategori: 'balap', tahun: '2021–2024', dur: 30, aspect: '16:9', specs: ['V10 5.2L NA', '640 PS', '565 Nm', '0–100 3,0 dtk'], qa: 'lolos', modelAi: 'Studio Render (lokal)' },
  { slug: 'subaru-22b', title: 'Subaru Impreza 22B STi', merk: 'Subaru', kategori: 'klasik', tahun: '1998', dur: 45, aspect: '9:16', specs: ['flat-4 2.2L turbo', '280 PS', '363 Nm', 'AWD'], qa: 'lolos', modelAi: 'Studio Render (lokal)' },
  { slug: 'porsche-911-gt3rs', title: 'Porsche 911 GT3 RS', merk: 'Porsche', kategori: 'balap', tahun: '2022–sekarang', dur: 30, aspect: '16:9', specs: ['flat-6 4.0L NA', '525 PS', '465 Nm', '0–100 3,2 dtk'], qa: 'lolos', modelAi: 'Studio Render (lokal)' },
  { slug: 'koenigsegg-jesko', title: 'Koenigsegg Jesko', merk: 'Koenigsegg', kategori: 'balap', tahun: '2023–', dur: 30, aspect: '16:9', specs: ['V8 5.0L twin-turbo', '1.600 PS', '1.500 Nm', '1.420 kg'], qa: 'tanpa-foto', modelAi: 'Studio Render (lokal)' },
];

const BASE = 'video/';
const THUMB = 'thumb/';

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

  const merks = ['semua', ...Array.from(new Set(LIBRARY.map((v) => v.merk)))];
  const list = LIBRARY.filter((v) => {
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
          {LIBRARY.length} video hasil pipeline nyata — dirender dengan ffmpeg dari foto asli, bukan animasi placeholder.
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
                <div className="vcard__specs">{v.specs.map((s) => <span key={s}>{s}</span>)}</div>
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
