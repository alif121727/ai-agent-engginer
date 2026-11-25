import React from 'react';
import { Icon, Spinner } from '../components/ui';

export type CarTemplate = {
  name: string;
  displayName: string;
  description: string;
  tags: string[];
  dimensions: { lengthM: number; widthM: number; heightM: number; wheelbaseM: number; rideHeightM: number };
  wheels: { rimDiameterIn: number; spokes: number };
  wing: string;
  livery: string;
  preview: string;
  variants: string[];
};

/**
 * Katalog template mobil dari Car Template System (templates/cars/).
 *
 * Endpoint butuh login dan hanya ada di backend repo; di deploy statis
 * (Netlify/demo) panel ini menyembunyikan diri alih-alih menampilkan galat,
 * karena katalog mobil utama di bawahnya tetap berfungsi.
 */
export function CarTemplatePanel() {
  const [items, setItems] = React.useState<CarTemplate[] | null>(null);
  const [gagal, setGagal] = React.useState(false);
  const [buka, setBuka] = React.useState(true);

  React.useEffect(() => {
    let hidup = true;
    (async () => {
      try {
        const r = await fetch('/api/car-templates', { credentials: 'include' });
        if (!r.ok) throw new Error(String(r.status));
        const d = (await r.json()) as { hasil?: CarTemplate[] };
        if (hidup) setItems(d.hasil ?? []);
      } catch {
        if (hidup) setGagal(true);
      }
    })();
    return () => {
      hidup = false;
    };
  }, []);

  if (gagal) return null;

  return (
    <section className="stack" style={{ gap: 12 }}>
      <div className="row row--between row--wrap">
        <div>
          <div className="eyebrow">Template mobil</div>
          <h2 style={{ marginTop: 4, fontSize: '1.05rem' }}>
            {items ? `${items.length} template parametrik` : 'Memuat template…'}
          </h2>
          <p className="muted small" style={{ marginTop: 4 }}>
            Geometri, material, dan livery berasal dari berkas JSON yang tervalidasi — bukan angka yang dikarang di kode.
          </p>
        </div>
        <button className="btn btn--ghost btn--sm" onClick={() => setBuka((v) => !v)} aria-expanded={buka}>
          {buka ? 'Sembunyikan' : 'Tampilkan'} <Icon.ChevronR size={11} />
        </button>
      </div>

      {buka && !items && (
        <div className="row" style={{ gap: 8 }}>
          <Spinner />
          <span className="muted small">Membaca templates/cars…</span>
        </div>
      )}

      {buka && items && items.length === 0 && (
        <p className="muted small">Belum ada template konkret di templates/cars/.</p>
      )}

      {buka && items && items.length > 0 && (
        <div className="vgrid">
          {items.map((t) => (
            <article key={t.name} className="card card--tight stack" style={{ gap: 8 }}>
              <div style={{ background: 'var(--bg-2, #12131c)', borderRadius: 10, overflow: 'hidden' }}>
                <img
                  src={t.preview}
                  alt={`Pratinjau ${t.displayName}`}
                  loading="lazy"
                  style={{ width: '100%', display: 'block', aspectRatio: '1 / 1', objectFit: 'cover' }}
                />
              </div>
              <div className="row row--between">
                <span className="chip chip--accent">{t.name}</span>
                <span className="dim tiny mono">{t.dimensions.lengthM.toFixed(2)} m</span>
              </div>
              <div>
                <div style={{ fontWeight: 650, fontSize: '0.9rem' }}>{t.displayName}</div>
                <div className="dim tiny">{t.description}</div>
              </div>
              <div className="vcard__specs">
                <span>{t.dimensions.widthM.toFixed(2)} × {t.dimensions.heightM.toFixed(2)} m</span>
                <span>wheelbase {t.dimensions.wheelbaseM.toFixed(2)} m</span>
                <span>rim {t.wheels.rimDiameterIn}&quot;</span>
                <span>wing {t.wing}</span>
              </div>
              {t.variants.length > 0 && (
                <div className="row row--wrap" style={{ gap: 4 }}>
                  {t.variants.map((v) => (
                    <span key={v} className="chip">{v.split('.').pop()}</span>
                  ))}
                </div>
              )}
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
