import React from 'react';
import { Icon } from '../components/ui';
import type { Route } from '../components/shell';
import { FEED, feedVideoSrc, feedDownloadSrc, feedThumbSrc } from '../data/feed';

/**
 * Feed vertikal ala TikTok.
 *
 * Tiga hal yang membuat ini terasa benar dan bukan sekadar daftar video:
 * 1. Scroll snap per kartu, jadi satu video = satu layar.
 * 2. Hanya video yang benar-benar terlihat yang diputar. Autoplay semua kartu
 *    sekaligus membuat browser menolak, baterai habis, dan audio bertumpuk.
 * 3. Semua video mulai dalam keadaan bisu. Browser hanya mengizinkan autoplay
 *    tanpa suara; suara dinyalakan pengguna lewat satu tombol.
 */

export function Feed({ go }: { go: (r: Route) => void }) {
  const [index, setIndex] = React.useState(0);
  const [muted, setMuted] = React.useState(true);
  const [saved, setSaved] = React.useState<Set<string>>(new Set());
  const [liked, setLiked] = React.useState<Set<string>>(new Set());
  const containerRef = React.useRef<HTMLDivElement | null>(null);
  const videoRefs = React.useRef<Map<number, HTMLVideoElement>>(new Map());

  // Hanya kartu yang paling banyak terlihat yang diputar. Memilih satu pemenang
  // per pembaruan mencegah dua video berjalan bersamaan saat layar rendah.
  React.useEffect(() => {
    const root = containerRef.current;
    if (!root) return;
    const ratios = new Map<HTMLVideoElement, number>();
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) ratios.set(e.target as HTMLVideoElement, e.intersectionRatio);
        let best: HTMLVideoElement | null = null;
        let bestRatio = 0.6;
        for (const [el, r] of ratios) {
          if (r > bestRatio) { best = el; bestRatio = r; }
        }
        for (const el of videoRefs.current.values()) {
          if (el !== best) el.pause();
        }
        if (best) {
          setIndex(Number(best.dataset.index));
          void best.play().catch(() => {
            /* autoplay bisa ditolak; pengguna masih bisa menekan play */
          });
        }
      },
      { root, threshold: [0, 0.25, 0.6, 0.9, 1] },
    );
    for (const el of videoRefs.current.values()) io.observe(el);
    return () => io.disconnect();
  }, []);

  // Preferensi bisu berlaku untuk semua kartu, termasuk yang belum terlihat.
  React.useEffect(() => {
    for (const el of videoRefs.current.values()) el.muted = muted;
  }, [muted]);

  const toggle = (set: React.Dispatch<React.SetStateAction<Set<string>>>, slug: string) =>
    set((prev) => {
      const next = new Set(prev);
      next.has(slug) ? next.delete(slug) : next.add(slug);
      return next;
    });

  if (FEED.length === 0) {
    return (
      <div className="page stack">
        <h1>Feed</h1>
        <p className="muted">Belum ada video vertikal yang lolos QA.</p>
        <button className="btn btn--primary" onClick={() => go({ name: 'baru' })}>
          Buat video pertama
        </button>
      </div>
    );
  }

  return (
    <div className="feed" ref={containerRef}>
      <div className="feed__rail" aria-label="Kontrol feed">
        <span className="feed__count mono">
          {index + 1}/{FEED.length}
        </span>
        <button
          className="btn btn--sm"
          onClick={() => setMuted((m) => !m)}
          aria-pressed={!muted}
          title={muted ? 'Nyalakan suara' : 'Bisukan'}
        >
          {muted ? 'Suara mati' : 'Suara hidup'}
        </button>
        <button className="btn btn--sm btn--ghost" onClick={() => go({ name: 'perpustakaan' })}>
          Perpustakaan
        </button>
      </div>

      {FEED.map((v, i) => (
        <section className="feed__slide" key={v.slug} aria-label={`${v.title} oleh ${v.merk}`}>
          <div className="feed__card">
          <video
            className="feed__video"
            data-index={i}
            ref={(el) => {
              if (el) videoRefs.current.set(i, el);
              else videoRefs.current.delete(i);
            }}
            src={feedVideoSrc(v)}
            poster={feedThumbSrc(v)}
            muted={muted}
            loop
            playsInline
            preload={Math.abs(i - index) <= 1 ? 'auto' : 'none'}
            onClick={(e) => {
              const el = e.currentTarget;
              el.paused ? void el.play() : el.pause();
            }}
          />

          <div className="feed__shade" aria-hidden="true" />

          <div className="feed__meta">
            <div className="row" style={{ gap: 8 }}>
              <span className="chip chip--accent tiny">{v.templateName ?? "Alur bawaan"}</span>
              <span className="chip chip--ok tiny">QA {v.qa}</span>
            </div>
            <h2 style={{ marginTop: 8 }}>{v.title}</h2>
            <p className="small muted" style={{ marginTop: 2 }}>
              {v.merk} · {v.tahun} · {v.dur}s · {v.width}×{v.height}
            </p>
            <p className="small" style={{ marginTop: 6 }}>
              <span className="dim">Tema: </span>
              {v.themeId}
              {v.hashtags.length > 0 && <span className="dim"> · {v.hashtags.join(" ")}</span>}
            </p>
          </div>

          <div className="feed__actions">
            <button
              className={`feed__act ${liked.has(v.slug) ? 'is-on' : ''}`}
              onClick={() => toggle(setLiked, v.slug)}
              aria-pressed={liked.has(v.slug)}
              title="Suka"
            >
              <Icon.Spark size={18} />
              <span className="tiny mono">{liked.has(v.slug) ? '1' : '0'}</span>
            </button>
            <button
              className={`feed__act ${saved.has(v.slug) ? 'is-on' : ''}`}
              onClick={() => toggle(setSaved, v.slug)}
              aria-pressed={saved.has(v.slug)}
              title="Simpan"
            >
              <Icon.Folder size={18} />
              <span className="tiny mono">{saved.has(v.slug) ? '1' : '0'}</span>
            </button>
            <a className="feed__act" href={feedDownloadSrc(v)} download title="Unduh versi 1080x1920">
              <Icon.Download size={18} />
            </a>
            <button className="feed__act" onClick={() => go({ name: 'baru' })} title="Buat seperti ini">
              <Icon.Plus size={18} />
            </button>
          </div>
          </div>
        </section>
      ))}
    </div>
  );
}
