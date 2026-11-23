import React from 'react';
import { Icon, Spinner } from './ui';
import { cariMobilWeb, researchCar, ResearchError, type KandidatWeb } from '../services/research';
import { toResearched } from './ResearchPanel';
import type { ResearchedCar } from '../data/researched';

/**
 * Hasil pencarian dari internet, bukan dari katalog lokal.
 *
 * Daftar kandidat diambil dengan satu permintaan, dan spesifikasi lengkap baru
 * disusun saat kandidat dipilih. Dengan begitu pengguna bisa melihat banyak
 * model (termasuk yang belum ada di situs) tanpa memicu batas laju Wikipedia.
 */
export function WebResults({
  query,
  onPick,
}: {
  query: string;
  onPick: (entry: ResearchedCar) => void;
}) {
  const [kandidat, setKandidat] = React.useState<KandidatWeb[]>([]);
  const [memuat, setMemuat] = React.useState(false);
  const [memilih, setMemilih] = React.useState<string | null>(null);
  const [galat, setGalat] = React.useState('');
  const [dicoba, setDicoba] = React.useState('');

  const q = query.trim();

  React.useEffect(() => {
    if (q.length < 2 || q === dicoba) return;
    let batal = false;
    const timer = setTimeout(() => {
      setMemuat(true);
      setGalat('');
      cariMobilWeb(q, 8)
        .then((hasil) => {
          if (batal) return;
          setKandidat(hasil);
          setDicoba(q);
        })
        .catch((e) => {
          if (batal) return;
          setGalat(e instanceof ResearchError ? e.message : 'Pencarian internet gagal');
          setKandidat([]);
        })
        .finally(() => {
          if (!batal) setMemuat(false);
        });
    }, 500);
    return () => {
      batal = true;
      clearTimeout(timer);
    };
  }, [q, dicoba]);

  async function pilih(k: KandidatWeb) {
    setMemilih(k.judul);
    setGalat('');
    try {
      const res = await researchCar(k.judul);
      onPick(toResearched(res));
    } catch (e) {
      setGalat(e instanceof ResearchError ? e.message : 'Gagal mengambil spesifikasi');
    } finally {
      setMemilih(null);
    }
  }

  if (q.length < 2) return null;

  return (
    <div className="stack" style={{ gap: 10 }}>
      <div className="row row--between row--wrap" style={{ gap: 8 }}>
        <div className="row" style={{ gap: 8 }}>
          <span className="chip chip--accent"><Icon.Bolt size={11} /> internet</span>
          <span className="dim tiny">
            {memuat ? 'Mencari di Wikipedia…' : kandidat.length ? `${kandidat.length} model di luar katalog` : 'Model di luar katalog'}
          </span>
        </div>
        {memuat && <Spinner size={13} />}
      </div>

      {galat && (
        <div className="note note--warn">
          <span className="note__icon"><Icon.Warn size={13} /></span>
          <span>{galat}</span>
        </div>
      )}

      {kandidat.length > 0 && (
        <div className="vgrid">
          {kandidat.map((k) => (
            <button
              key={k.judul}
              className="card card--tight"
              style={{ textAlign: 'left', cursor: 'pointer' }}
              onClick={() => void pilih(k)}
              disabled={memilih !== null}
            >
              {k.gambarUrl && (
                <img
                  src={k.gambarUrl}
                  alt={k.nama}
                  loading="lazy"
                  style={{ width: '100%', height: 110, objectFit: 'cover', borderRadius: 8, marginBottom: 8 }}
                  onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
                />
              )}
              <div className="row row--between" style={{ marginBottom: 6 }}>
                <span className="chip tiny">web</span>
                <span className="dim tiny mono">{k.tahun || '—'}</span>
              </div>
              <div style={{ fontWeight: 650, fontSize: '0.9rem' }}>{k.nama}</div>
              <div className="dim tiny" style={{ marginBottom: 8 }}>
                {k.tenaga ? k.tenaga.slice(0, 60) : 'spesifikasi menyusul'}
              </div>
              {memilih === k.judul ? (
                <span className="dim tiny"><Spinner size={11} /> menyusun spesifikasi…</span>
              ) : (
                <span className="chip chip--ok tiny"><Icon.Check size={10} /> pakai model ini</span>
              )}
            </button>
          ))}
        </div>
      )}

      {!memuat && !galat && dicoba === q && kandidat.length === 0 && (
        <div className="dim small">
          Tidak ada model yang cocok di internet untuk “{q}”. Coba tulis merek dan modelnya.
        </div>
      )}
    </div>
  );
}
