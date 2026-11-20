import React from 'react';
import { Icon, Spinner } from './ui';
import { researchCar, ResearchError, type ResearchResult } from '../services/research';
import { listResearched, saveResearched, type ResearchedCar } from '../data/researched';
import type { Car } from '../data/catalog';

export function toResearched(res: ResearchResult): ResearchedCar {
  return {
    car: res.car,
    missing: res.missing,
    photoUrl: res.photo?.thumbUrl ?? null,
    photoCredit: res.photo?.author ?? null,
    photoLicense: res.photo?.license ?? null,
    photoPageUrl: res.photo?.pageUrl ?? null,
    articleTitle: res.articleTitle,
    articleUrl: res.car.sumber,
    researchedAt: Date.now(),
  };
}

/**
 * Panel riset mandiri: dipakai saat model yang dicari tidak ada di katalog.
 * Semua angka berasal dari Wikipedia; field yang tidak ditemukan ditandai
 * kosong, bukan diisi tebakan.
 */
export function ResearchPanel({
  query,
  onPick,
  compact = false,
}: {
  query: string;
  onPick: (entry: ResearchedCar) => void;
  compact?: boolean;
}) {
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);
  const [res, setRes] = React.useState<ResearchResult | null>(null);
  const [saved, setSaved] = React.useState<ResearchedCar[]>(listResearched);

  async function run(q: string) {
    setBusy(true);
    setErr(null);
    setRes(null);
    try {
      const out = await researchCar(q);
      setRes(out);
      setSaved(saveResearched(toResearched(out)));
    } catch (e) {
      setErr(e instanceof ResearchError ? e.message : `Riset gagal: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  const q = query.trim();

  return (
    <div className="research stack">
      <div className="research__head">
        <div className="row" style={{ gap: 10 }}>
          <span className="research__badge"><Icon.Bolt size={13} /></span>
          <div>
            <div style={{ fontWeight: 650 }}>Riset mandiri dari web</div>
            <div className="dim tiny">
              Cari model di luar katalog. Agen membaca Wikipedia dan Wikimedia Commons, lalu
              menyusun spesifikasi beserta sumbernya.
            </div>
          </div>
        </div>
      </div>

      {!compact && q.length < 2 && (
        <div className="dim small">
          Tulis nama mobil di kolom pencarian, misalnya <b>Porsche 918</b> atau{' '}
          <b>Bugatti Chiron</b>, lalu tekan tombol riset.
        </div>
      )}

      {q.length >= 2 && (
        <button className="btn btn--primary" disabled={busy} onClick={() => void run(q)}>
          {busy ? <Spinner size={13} /> : <Icon.Search size={14} />}
          {busy ? 'Mencari di Wikipedia…' : `Riset "${q}"`}
        </button>
      )}

      {busy && (
        <div className="research__steps">
          {['Mencari artikel', 'Membaca tabel spesifikasi', 'Mengambil foto berlisensi'].map((s, i) => (
            <div key={s} className="research__step">
              <span className="research__dot" style={{ animationDelay: `${i * 0.18}s` }} />
              {s}
            </div>
          ))}
        </div>
      )}

      {err && (
        <div className="research__err">
          <Icon.Warn size={14} />
          <div>
            <div>{err}</div>
            {q.length >= 2 && (
              <button className="btn btn--ghost btn--sm" style={{ marginTop: 8 }} onClick={() => void run(q)}>
                <Icon.Retry size={12} /> Coba lagi
              </button>
            )}
          </div>
        </div>
      )}

      {res && (
        <div className="research__result">
          <div className="research__photo">
            {res.photo ? (
              <>
                <img src={res.photo.thumbUrl} alt={`${res.car.model} dari Wikimedia Commons`} loading="lazy" />
                <div className="research__credit">
                  {res.photo.author} · {res.photo.license}
                </div>
              </>
            ) : (
              <div className="research__nophoto">
                <Icon.Film size={20} />
                <span>Artikel ini tidak punya foto berlisensi bebas.</span>
              </div>
            )}
          </div>

          <div className="stack" style={{ gap: 10, flex: 1, minWidth: 260 }}>
            <div>
              <div className="eyebrow">Hasil riset</div>
              <h3 style={{ marginTop: 2 }}>{res.car.model}</h3>
              <div className="dim tiny">
                {res.car.merk} · {res.car.tahun || 'tahun tidak tercatat'} · {res.car.kategori}
              </div>
            </div>

            <div className="research__fields">
              {res.fields.map((f) => (
                <div key={f.key} className="research__field" data-found={f.found}>
                  <span className="research__k">{f.label}</span>
                  <span className="research__v">
                    {f.found ? f.value : <em className="dim">tidak ada di sumber</em>}
                  </span>
                </div>
              ))}
            </div>

            {res.missing.length > 0 && (
              <div className="note note--warn">
                <span className="note__icon"><Icon.Info size={13} /></span>
                <span>
                  {res.missing.join(', ')} tidak tercatat di artikel, jadi dibiarkan kosong — tidak
                  dikarang. Isi manual di lembar brief bila perlu.
                </span>
              </div>
            )}

            {res.summary && <p className="dim small">{res.summary.slice(0, 320)}…</p>}

            <div className="row row--wrap" style={{ gap: 8 }}>
              <button className="btn btn--primary" onClick={() => onPick(toResearched(res))}>
                <Icon.Check size={14} /> Pakai model ini
              </button>
              <a className="btn btn--ghost" href={res.car.sumber} target="_blank" rel="noreferrer">
                <Icon.Info size={13} /> Buka artikel
              </a>
            </div>

            <div className="dim tiny">
              Sumber: {res.sources.map((s) => s.label).join(' · ')}
            </div>
          </div>
        </div>
      )}

      {saved.length > 0 && (
        <div className="research__saved">
          <div className="eyebrow" style={{ marginBottom: 8 }}>Hasil riset tersimpan</div>
          <div className="research__chips">
            {saved.map((s) => (
              <button key={s.car.slug} className="research__chip" onClick={() => onPick(s)}>
                {s.photoUrl ? <img src={s.photoUrl} alt="" loading="lazy" /> : <span className="research__chipIcon"><Icon.Car size={14} /></span>}
                <span>
                  <b>{s.car.model}</b>
                  <em>{s.car.tahun || 'tanpa tahun'}</em>
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/** Ubah hasil riset tersimpan menjadi `Car` untuk dipakai pipeline. */
export function researchedToCar(entry: ResearchedCar): Car {
  return entry.car;
}
