import React from 'react';
import { Icon } from './ui';
import type { Car } from '../data/catalog';
import { sfxFor, scenesFor, qaPromptFor, engineSummary, AUDIO_NEGATIVE, COMBINED_NEGATIVE } from '../services/prompts';

/** Tombol salin kecil di pojok kanan tiap prompt. */
function CopyButton({ text, label = 'Salin' }: { text: string; label?: string }) {
  const [done, setDone] = React.useState(false);
  const timer = React.useRef<number | undefined>(undefined);
  React.useEffect(() => () => window.clearTimeout(timer.current), []);

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // Clipboard API butuh HTTPS + izin; fallback textarea tetap bekerja lokal.
      const el = document.createElement('textarea');
      el.value = text;
      el.style.position = 'fixed';
      el.style.opacity = '0';
      document.body.appendChild(el);
      el.select();
      document.execCommand('copy');
      el.remove();
    }
    setDone(true);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setDone(false), 1600);
  }

  return (
    <button type="button" className="promptbox__copy" onClick={copy} data-done={done} title={`${label} prompt`}>
      {done ? 'tersalin' : label}
    </button>
  );
}

function Prompt({ text, label }: { text: string; label?: string }) {
  return (
    <div className="promptbox">
      {text}
      <CopyButton text={text} label={label} />
    </div>
  );
}

/**
 * Prompt siap tempel untuk generator eksternal. Pipeline lokal (ffmpeg) tidak
 * memakai berkas ini — prompnya untuk Suno/ElevenLabs/Veo/Kling. UI harus
 * jujur soal itu, jadi ada catatan di bawah tiap tab.
 */
export function PromptPanel({ car }: { car: Car }) {
  const [tab, setTab] = React.useState<'audio' | 'video'>('audio');
  const [vertical, setVertical] = React.useState(false);
  const [scene, setScene] = React.useState<number | null>(null);

  const sfx = React.useMemo(() => sfxFor(car), [car.slug]);
  const scenes = React.useMemo(() => scenesFor(car, vertical), [car.slug, vertical]);

  return (
    <div className="card">
      <div className="row row--between row--wrap" style={{ marginBottom: 10 }}>
        <div>
          <div className="eyebrow">Prompt produksi</div>
          <p className="dim tiny" style={{ marginTop: 2 }}>
            Siap tempel ke generator SFX / video AI. Diturunkan dari data katalog mobil ini.
          </p>
        </div>
        <div className="seg">
          <button aria-pressed={tab === 'audio'} onClick={() => setTab('audio')}>Suara mesin</button>
          <button aria-pressed={tab === 'video'} onClick={() => setTab('video')}>Video</button>
        </div>
      </div>

      <div className="row row--wrap" style={{ gap: 6, marginBottom: 10 }}>
        <span className="chip chip--info mono tiny">{engineSummary(car)}</span>
        {tab === 'video' && (
          <button className="btn btn--sm btn--ghost" onClick={() => setVertical((v) => !v)} aria-pressed={vertical}>
            {vertical ? '9:16 vertikal' : '16:9 horizontal'}
          </button>
        )}
      </div>

      {tab === 'audio' && (
        <>
          <div className="stack" style={{ gap: 0 }}>
            {sfx.map((s) => (
              <div key={s.id} className="promptrow">
                <div className="promptrow__head">
                  <span className="small" style={{ fontWeight: 600 }}>{s.label}</span>
                  <span className="scenetag">{s.scene}</span>
                </div>
                <Prompt text={s.prompt} />
              </div>
            ))}
          </div>
          <div className="promptrow" style={{ borderTop: '1px solid var(--line)' }}>
            <div className="promptrow__head">
              <span className="small" style={{ fontWeight: 600 }}>Negative prompt</span>
              <span className="dim tiny">tempel di semua trek audio</span>
            </div>
            <Prompt text={AUDIO_NEGATIVE} />
          </div>
          <div className="note" style={{ marginTop: 10 }}>
            <span className="note__icon"><Icon.Info size={13} /></span>
            <span>
              Suno/Udio butuh tag <span className="mono">[Sound Effect]</span> atau mode instrumental.
              Untuk SFX murni, ElevenLabs SFX, Stable Audio, atau AudioGen lebih tepat.
              Pipeline lokal menyintesis suara mesin dari profil katalog, bukan memakai prompt ini.
            </span>
          </div>
        </>
      )}

      {tab === 'video' && (
        <>
          <div className="stack" style={{ gap: 0 }}>
            {scenes.map((s, i) => (
              <div key={s.n} className="promptrow">
                <div className="promptrow__head">
                  <span className="scenetag">{String(s.n).padStart(2, '0')}</span>
                  <span className="small" style={{ fontWeight: 600 }}>{s.title}</span>
                  <span className="dim tiny">{s.dur}s</span>
                  <span className="spacer" />
                  <button className="btn btn--sm btn--ghost" onClick={() => setScene(scene === i ? null : i)}>
                    {scene === i ? 'Tutup' : 'Lihat'}
                  </button>
                </div>
                {scene === i ? (
                  <Prompt text={s.prompt} />
                ) : (
                  <div className="tiny dim truncate">{s.prompt}</div>
                )}
              </div>
            ))}
          </div>
          <div className="promptrow" style={{ borderTop: '1px solid var(--line)' }}>
            <div className="promptrow__head">
              <span className="small" style={{ fontWeight: 600 }}>Negative prompt</span>
            </div>
            <Prompt text={COMBINED_NEGATIVE} />
          </div>
          <div className="promptrow">
            <div className="promptrow__head">
              <span className="small" style={{ fontWeight: 600 }}>Prompt QA</span>
              <span className="dim tiny">nilai hasil sebelum publikasi</span>
            </div>
            <Prompt text={qaPromptFor(car)} />
          </div>
          <div className="note" style={{ marginTop: 10 }}>
            <span className="note__icon"><Icon.Info size={13} /></span>
            <span>
              Batas aman tiap klip AI 5–10 detik; delapan scene di atas menjadi ±60 detik.
              Model video AI belum tersambung di lingkungan ini, jadi prompt ini untuk
              dipakai manual di Veo/Kling/Seedance.
            </span>
          </div>
        </>
      )}
    </div>
  );
}
