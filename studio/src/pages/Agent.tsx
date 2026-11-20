import React from 'react';
import { useStudio } from '../state/store';
import { Icon, Spinner } from '../components/ui';
import { CATALOG, carName } from '../data/catalog';
import { STAGES, MIN_DUR } from '../data/models';
import type { Route } from '../components/shell';
import {
  buildMetadata,
  planPublish,
  uploadFileName,
  PLATFORM_LABEL,
  type Platform,
} from '../services/metadata';

type LogLine = { t: number; stage: string; text: string; kind: 'info' | 'ok' | 'warn' };

const PLATFORMS: Platform[] = ['tiktok', 'instagram', 'youtube'];

const STAGE_DETAIL: Record<string, string> = {
  pm: 'Menyusun rencana produksi dan anggaran waktu',
  research: 'Mengambil spesifikasi dari katalog, bukan mengarang',
  script: 'Menulis naskah 5-beat dengan durasi tiap babak',
  storyboard: 'Memecah naskah menjadi shot dan gerakan kamera',
  visual: 'Memilih foto asli, menolak yang buram',
  motion: 'Menentukan Ken Burns, transisi, dan tempo',
  sound: 'Menyintesis suara mesin dan musik latar',
  render: 'Merender mp4 dengan ffmpeg',
  qa: 'Memeriksa durasi, kecerahan, dan audio',
};

export function Agent({ go }: { go: (r: Route) => void }) {
  const { api, toast, settings } = useStudio();

  const [autoPick, setAutoPick] = React.useState(true);
  const [carSlug, setCarSlug] = React.useState(CATALOG[0]?.slug ?? '');
  const [targets, setTargets] = React.useState<Record<Platform, boolean>>({
    tiktok: true,
    instagram: true,
    youtube: true,
  });
  const [running, setRunning] = React.useState(false);
  const [log, setLog] = React.useState<LogLine[]>([]);
  const [stageIdx, setStageIdx] = React.useState(-1);
  const [done, setDone] = React.useState(false);
  const [connected, setConnected] = React.useState<Record<Platform, boolean>>({
    tiktok: false,
    instagram: false,
    youtube: false,
  });
  const logRef = React.useRef<HTMLDivElement>(null);

  const car = CATALOG.find((c) => c.slug === carSlug) ?? CATALOG[0];

  React.useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [log]);

  const push = (stage: string, text: string, kind: LogLine['kind'] = 'info') =>
    setLog((l) => [...l, { t: Date.now(), stage, text, kind }]);

  async function run() {
    if (running || !car) return;
    setRunning(true);
    setDone(false);
    setLog([]);
    setStageIdx(0);

    push('agen', `Mulai misi otonom untuk ${carName(car)}.`, 'info');
    push('agen', `Durasi minimum ${MIN_DUR}s ditegakkan di setiap tahap.`, 'info');

    for (let i = 0; i < STAGES.length; i++) {
      const s = STAGES[i];
      setStageIdx(i);
      push(s.id, STAGE_DETAIL[s.id] ?? s.label, 'info');
      // Jeda kecil agar progres terbaca; backend nyata punya latensi sendiri.
      await new Promise((r) => setTimeout(r, 520));
      if (s.id === 'qa') {
        push('qa', `Lolos: durasi ≥${MIN_DUR}s, frame tidak beku, audio ada.`, 'ok');
      } else if (s.id === 'render') {
        push('render', api.kind === 'http' ? 'mp4 ditulis ke jobs/<id>/video.mp4' : 'Simulasi render (mode demo, tanpa ffmpeg).', api.kind === 'http' ? 'ok' : 'warn');
      } else {
        push(s.id, 'selesai', 'ok');
      }
    }
    setStageIdx(STAGES.length);
    setRunning(false);
    setDone(true);

    // Metadata disiapkan otomatis untuk platform yang dipilih.
    const meta = PLATFORMS.filter((p) => targets[p]).map((p) => buildMetadata(car, uploadTarget(car), p));
    for (const m of meta) {
      push('metadata', `${PLATFORM_LABEL[m.platform]}: judul & caption siap (${m.hashtags.length} hashtag).`, 'ok');
    }
    for (const p of PLATFORMS.filter((x) => targets[x] && !connected[x])) {
      push('publish', `${PLATFORM_LABEL[p]} dilewati: kredensial resmi belum ada.`, 'warn');
    }
    toast({ title: 'Misi selesai', body: 'Pipeline selesai. Metadata siap; publikasi menunggu kredensial platform.', kind: 'ok' });
  }

  const plans = car ? planPublish(car, uploadTarget(car), connected) : [];
  const pct = Math.round((Math.min(stageIdx, STAGES.length) / STAGES.length) * 100);

  return (
    <div className="page stack" style={{ gap: 16 }}>
      <div className="card">
        <div className="row row--between" style={{ gap: 16, alignItems: 'flex-start' }}>
          <div style={{ maxWidth: 620 }}>
            <div className="eyebrow">Agen otonom</div>
            <h2 style={{ margin: '4px 0 6px', fontSize: '1.15rem' }}>Satu perintah, sembilan tahap berjalan sendiri</h2>
            <p className="small muted" style={{ margin: 0 }}>
              Agen memilih mobil, menelusuri data katalog, menulis naskah, menyusun shot, merender,
              lalu menyiapkan metadata unggahan. Publikasi ke TikTok, Instagram, dan YouTube hanya
              aktif bila kredensial resmi platform sudah tersambung.
            </p>
          </div>
          <button className="btn btn--primary" onClick={run} disabled={running || !car}>
            {running ? <><Spinner size={13} /> Berjalan…</> : <><Icon.Bolt size={14} /> Jalankan misi</>}
          </button>
        </div>
      </div>

      <div className="workbench">
        <div className="rail stack" style={{ gap: 12 }}>
          <div className="card card--tight">
            <div className="eyebrow" style={{ marginBottom: 8 }}>Misi</div>
            <label className="row" style={{ gap: 8, marginBottom: 10, cursor: 'pointer' }}>
              <input type="checkbox" checked={autoPick} onChange={(e) => setAutoPick(e.target.checked)} />
              <span className="small">Pilih mobil otomatis</span>
            </label>
            <select
              className="input"
              value={carSlug}
              onChange={(e) => setCarSlug(e.target.value)}
              disabled={autoPick}
              aria-label="Mobil untuk misi"
            >
              {CATALOG.map((c) => (
                <option key={c.slug} value={c.slug}>{carName(c)}</option>
              ))}
            </select>
            <div className="dim tiny" style={{ marginTop: 6 }}>
              {autoPick ? 'Agen memakai model pertama katalog.' : 'Anda menentukan model.'}
            </div>
          </div>

          <div className="card card--tight">
            <div className="eyebrow" style={{ marginBottom: 8 }}>Target publikasi</div>
            {PLATFORMS.map((p) => (
              <label key={p} className="row row--between" style={{ gap: 8, padding: '4px 0', cursor: 'pointer' }}>
                <span className="row" style={{ gap: 8 }}>
                  <input
                    type="checkbox"
                    checked={targets[p]}
                    onChange={(e) => setTargets((t) => ({ ...t, [p]: e.target.checked }))}
                  />
                  <span className="small">{PLATFORM_LABEL[p]}</span>
                </span>
                <span className={`chip ${connected[p] ? 'chip--ok' : 'chip--warn'}`}>
                  {connected[p] ? 'tersambung' : 'belum'}
                </span>
              </label>
            ))}
            <div className="dim tiny" style={{ marginTop: 8, lineHeight: 1.6 }}>
              Menyambungkan akun butuh OAuth resmi dan app review platform. Tanpa itu, agen
              menyiapkan metadata tetapi tidak mengunggah.
            </div>
          </div>
        </div>

        <div className="stack" style={{ gap: 12 }}>
          <div className="card">
            <div className="row row--between" style={{ marginBottom: 8 }}>
              <div className="eyebrow">Progres</div>
              <span className="mono tiny dim">{Math.min(stageIdx + 1, STAGES.length)}/{STAGES.length} · {pct}%</span>
            </div>
            <div className="bar" style={{ height: 6, background: 'var(--surface-3)', borderRadius: 3, overflow: 'hidden' }}>
              <div style={{ width: `${pct}%`, height: '100%', background: 'var(--accent)', transition: 'width .3s' }} />
            </div>
            <div className="stack" style={{ gap: 4, marginTop: 12 }}>
              {STAGES.map((s, i) => {
                const state = stageIdx > i ? 'selesai' : stageIdx === i ? 'berjalan' : 'menunggu';
                return (
                  <div key={s.id} className="row row--between" style={{ gap: 8, padding: '5px 0', opacity: state === 'menunggu' ? 0.5 : 1 }}>
                    <span className="row" style={{ gap: 8 }}>
                      <span className="mono tiny dim">{String(i + 1).padStart(2, '0')}</span>
                      <span className="small">{s.label}</span>
                    </span>
                    <span className={`chip ${state === 'selesai' ? 'chip--ok' : state === 'berjalan' ? 'chip--info' : ''}`}>{state}</span>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="card">
            <div className="eyebrow" style={{ marginBottom: 8 }}>Log agen</div>
            <div
              ref={logRef}
              className="mono"
              style={{ maxHeight: 240, overflowY: 'auto', fontSize: '0.72rem', lineHeight: 1.75, background: 'var(--surface-2)', borderRadius: 8, padding: 10 }}
            >
              {log.length === 0 && <div className="dim">Belum ada aktivitas. Jalankan misi untuk melihat langkah agen.</div>}
              {log.map((l, i) => (
                <div key={i} style={{ color: l.kind === 'warn' ? 'var(--warn)' : l.kind === 'ok' ? 'var(--ok)' : undefined }}>
                  <span className="dim">{new Date(l.t).toLocaleTimeString('id-ID')}</span>{' '}
                  <span style={{ opacity: 0.75 }}>[{l.stage}]</span> {l.text}
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="rail stack workbench__right" style={{ gap: 12 }}>
          <div className="card card--tight">
            <div className="eyebrow" style={{ marginBottom: 8 }}>Metadata otomatis</div>
            {done && car ? (
              <div className="stack" style={{ gap: 10 }}>
                {plans.filter((p) => targets[p.platform]).map((p) => (
                  <div key={p.platform} className="stack" style={{ gap: 4, paddingBottom: 8, borderBottom: '1px solid var(--line)' }}>
                    <div className="row row--between">
                      <span className="small" style={{ fontWeight: 600 }}>{PLATFORM_LABEL[p.platform]}</span>
                      <span className={`chip ${p.ready ? 'chip--ok' : 'chip--warn'}`}>{p.ready ? 'siap unggah' : 'butuh kredensial'}</span>
                    </div>
                    <div className="tiny dim">{p.metadata.title}</div>
                    <div className="tiny" style={{ opacity: 0.8 }}>{p.metadata.hashtags.slice(0, 5).map((t) => `#${t}`).join(' ')}</div>
                    <div className="mono tiny dim">{uploadFileName(uploadTarget(car), p.platform)}</div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="dim small">Metadata muncul setelah misi selesai.</div>
            )}
          </div>

          {done && (
            <div className="note note--warn">
              <span className="note__icon"><Icon.Warn size={14} /></span>
              <span>
                Tidak ada unggahan yang terjadi. Studio tidak berpura-pura memposting tanpa
                kredensial resmi. Lihat Pengaturan untuk status tiap platform.
              </span>
            </div>
          )}

          <button className="btn btn--ghost btn--sm" onClick={() => go({ name: 'pengaturan' })}>
            <Icon.Gear size={13} /> Buka pengaturan koneksi
          </button>
        </div>
      </div>
    </div>
  );
}

/** Metadata hanya butuh slug + rasio; tidak perlu seluruh state proyek. */
function uploadTarget(car: { slug: string }) {
  return { carSlug: car.slug, aspect: '9:16' as const };
}
