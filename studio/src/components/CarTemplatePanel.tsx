import React from 'react';
import { Icon } from '../components/ui';
import raw from '../data/car-templates.json';

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
 * Datanya dibundel oleh scripts/build-car-templates.ts, jadi panel ini tetap
 * tampil di deploy statis (GitHub Pages/Netlify) yang tidak punya backend.
 * `preview` hanya nama berkas; gambarnya dilayani dari folder pratinjau.
 */
const TEMPLATES = (raw as { hasil?: CarTemplate[] }).hasil ?? [];

export function CarTemplatePanel() {
  const [buka, setBuka] = React.useState(true);

  if (TEMPLATES.length === 0) return null;

  return (
    <section className="stack" style={{ gap: 12 }}>
      <div className="row row--between row--wrap">
        <div>
          <div className="eyebrow">Template mobil</div>
          <h2 style={{ marginTop: 4, fontSize: '1.05rem' }}>{TEMPLATES.length} template parametrik</h2>
          <p className="muted small" style={{ marginTop: 4 }}>
            Geometri, material, dan livery berasal dari berkas JSON yang tervalidasi — bukan angka yang dikarang di kode.
          </p>
        </div>
        <button className="btn btn--ghost btn--sm" onClick={() => setBuka((v) => !v)} aria-expanded={buka}>
          {buka ? 'Sembunyikan' : 'Tampilkan'} <Icon.ChevronR size={11} />
        </button>
      </div>

      {buka && (
        <div className="vgrid">
          {TEMPLATES.map((t) => (
            <article key={t.name} className="card card--tight stack" style={{ gap: 8 }}>
              <div style={{ background: 'var(--bg-2, #12131c)', borderRadius: 10, overflow: 'hidden' }}>
                <img
                  src={`cartpl-preview/${t.preview}`}
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
