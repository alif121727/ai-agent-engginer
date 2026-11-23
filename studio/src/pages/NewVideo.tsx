import React from 'react';
import { useStudio } from '../state/store';
import { Icon, Spinner, ConfidenceBadge, ErrorState } from '../components/ui';
import type { Route } from '../components/shell';
import { CATALOG, type Car } from '../data/catalog';
import { MIN_DUR, MAX_DUR, VIDEO_MODELS } from '../data/models';
import { buildBrief, buildShots, type Brief, type Shot } from '../services/api';
import { ResearchPanel } from '../components/ResearchPanel';
import { WebResults } from '../components/WebResults';
import { PromptPanel } from '../components/PromptPanel';
import { listResearched } from '../data/researched';

type Step = 0 | 1 | 2 | 3 | 4;
const STEPS = ['Pilih Mobil', 'Data & Brief', 'Storyboard', 'Parameter', 'Pratinjau & Generate'];

export function NewVideo({ go, preselect }: { go: (r: Route) => void; preselect?: string }) {
  const { api, upsert, settings, toast, isModelReady } = useStudio();
  const [step, setStep] = React.useState<Step>(0);

  const [car, setCar] = React.useState<Car | null>(null);
  const [q, setQ] = React.useState('');
  const [kat, setKat] = React.useState('semua');

  const [brief, setBrief] = React.useState<Brief | null>(null);
  const [shots, setShots] = React.useState<Shot[]>([]);
  const [busy, setBusy] = React.useState<'brief' | 'shots' | null>(null);
  const [err, setErr] = React.useState<string | null>(null);

  const [dur, setDur] = React.useState(MIN_DUR);
  const [aspect, setAspect] = React.useState<'16:9' | '9:16' | '1:1'>('16:9');
  const [resolution, setResolution] = React.useState<'1080p' | '4K'>('1080p');
  const [style, setStyle] = React.useState<'cinematic' | 'documentary' | 'social'>('cinematic');
  const [modelId, setModelId] = React.useState(settings.defaultModel);
  const [engine, setEngine] = React.useState(true);
  const [music, setMusic] = React.useState(true);
  const [voice, setVoice] = React.useState(false);
  const [tone, setTone] = React.useState<'energik' | 'sinematik' | 'hangat' | 'tegas'>('sinematik');

  // Hasil riset mandiri ikut dicari, jadi model di luar katalog tetap terpilih.
  const [researched, setResearched] = React.useState(() => listResearched());
  const pool = React.useMemo<Car[]>(() => {
    const known = new Set(CATALOG.map((c) => c.slug));
    return [...CATALOG, ...researched.map((r) => r.car).filter((c) => !known.has(c.slug))];
  }, [researched]);

  const list = React.useMemo(() => {
    const s = q.trim().toLowerCase();
    return pool.filter((c) => {
      const okKat = kat === 'semua' || c.kategori === kat;
      const okQ = !s || `${c.merk} ${c.model} ${c.seri} ${c.tahun}`.toLowerCase().includes(s);
      return okKat && okQ;
    });
  }, [q, kat, pool]);

  // Datang dari Garasi dengan mobil tertentu: langsung pilih dan susun brief.
  const preselected = React.useRef(false);
  React.useEffect(() => {
    if (preselected.current || !preselect) return;
    const target = pool.find((c) => c.slug === preselect);
    if (!target) return;
    preselected.current = true;
    setCar(target);
    setStep(1);
    void makeBrief(target);
  }, [preselect, pool]);

  const pickedModel = VIDEO_MODELS.find((m) => m.id === modelId)!;

  async function makeBrief(c: Car) {
    setBusy('brief');
    setErr(null);
    try {
      const b = await api.generateBrief(c);
      setBrief(b);
      setBusy(null);
      setBusy('shots');
      const sh = await api.generateShots(c, dur, b);
      setShots(sh);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function start() {
    if (!car) return;
    setErr(null);
    try {
      const p = await api.createProject({
        carSlug: car.slug,
        durationSec: dur,
        aspect,
        resolution,
        style,
        modelId,
        audio: { engine, music, voiceover: voice, lang: settings.language },
        suaraTone: voice ? tone : undefined,
      });
      p.shots = shots;
      p.brief = brief ?? p.brief;
      await upsert(p);
      toast({ title: 'Proyek dibuat', body: `${p.title} siap dijalankan`, kind: 'ok' });
      go({ name: 'proyek-detail', id: p.id, autoRun: true });
    } catch (e) {
      setErr((e as Error).message);
    }
  }

  const accepted = shots.filter((s) => s.accepted).length;

  return (
    <div className="page stack" style={{ gap: 20 }}>
      <div>
        <div className="eyebrow">Buat video</div>
        <h1 style={{ marginTop: 4 }}>Dari brief ke video jadi</h1>
      </div>

      <div className="stepper" role="tablist" aria-label="Langkah pembuatan">
        {STEPS.map((s, i) => (
          <React.Fragment key={s}>
            {i > 0 && <span className="step__sep" />}
            <button
              className="step"
              role="tab"
              aria-selected={step === i}
              data-state={step === i ? 'active' : step > i ? 'done' : 'todo'}
              disabled={i === 0 ? false : !car}
              onClick={() => setStep(i as Step)}
            >
              <span className="step__num">{step > i ? '✓' : i + 1}</span>
              {s}
            </button>
          </React.Fragment>
        ))}
      </div>

      {err && <ErrorState message={err} onRetry={() => setErr(null)} />}

      {/* ------------------------------------------------------- step 0 */}
      {step === 0 && (
        <div className="stack">
          <div className="row row--wrap" style={{ gap: 8 }}>
            <div className="row" style={{ flex: 1, minWidth: 240, position: 'relative' }}>
              <span style={{ position: 'absolute', left: 11, color: 'var(--text-3)' }}><Icon.Search size={15} /></span>
              <input className="input" style={{ paddingLeft: 34 }} placeholder="Cari merek, model, atau tahun…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Cari mobil" />
            </div>
            <div className="seg" role="group" aria-label="Kategori">
              {['semua', 'sport', 'klasik', 'balap', 'modifikasi'].map((k) => (
                <button key={k} aria-pressed={kat === k} onClick={() => setKat(k)}>{k}</button>
              ))}
            </div>
          </div>

          <div className="dim tiny">
            {list.length > 0
              ? `${list.length} model — semua angka berasal dari Wikipedia, bukan karangan.`
              : 'Belum ada model yang cocok di katalog. Gunakan riset mandiri di bawah.'}
          </div>

          <div className="vgrid">
            {list.map((c) => (
              <button
                key={c.slug}
                className="card card--tight"
                style={{ textAlign: 'left', cursor: 'pointer', borderColor: car?.slug === c.slug ? 'var(--accent)' : undefined, boxShadow: car?.slug === c.slug ? '0 0 0 3px var(--accent-dim)' : undefined }}
                onClick={() => { setCar(c); setBrief(null); setShots([]); }}
              >
                <div className="row row--between" style={{ marginBottom: 6 }}>
                  <span className="chip chip--accent">{c.kategori}</span>
                  <span className="dim tiny mono">{c.tahun}</span>
                </div>
                {researched.some((r) => r.car.slug === c.slug) && (
                  <div className="chip chip--ok tiny" style={{ marginBottom: 6 }}>
                    <Icon.Bolt size={10} /> hasil riset web
                  </div>
                )}
                <div style={{ fontWeight: 650, fontSize: '0.9rem' }}>{c.model}</div>
                <div className="dim tiny" style={{ marginBottom: 8 }}>{c.seri}</div>
                <div className="vcard__specs">
                  <span>{c.tenaga}</span>
                  <span>{c.nol100}</span>
                </div>
              </button>
            ))}
          </div>

          {list.length === 0 && (
            <div className="empty">
              <div className="empty__title">
                {q.trim() ? `"${q.trim()}" belum ada di katalog` : 'Tidak ada model yang cocok'}
              </div>
              <p className="empty__text">
                {q.trim()
                  ? 'Agen bisa mencari sendiri ke Wikipedia: spesifikasi, foto berlisensi, dan sumbernya.'
                  : 'Coba kata kunci lain atau pilih kategori “semua”.'}
              </p>
            </div>
          )}

          {/* Pencarian internet selalu tersedia: model yang belum ada di
              katalog tetap bisa dipakai tanpa menunggu katalog kosong. */}
          {q.trim().length >= 2 && (
            <WebResults
              query={q}
              onPick={(entry) => {
                setResearched(listResearched());
                setCar(entry.car);
                setBrief(null);
                setShots([]);
                toast({
                  title: 'Model dari internet dipakai',
                  body: `${entry.car.model} — ${entry.missing.length ? `tanpa ${entry.missing.join(', ')}` : 'data lengkap'}`,
                  kind: 'ok',
                });
              }}
            />
          )}

          {/* Riset mendalam: susun satu model lengkap beserta sumbernya. */}
          {list.length === 0 && q.trim().length >= 2 && (
            <ResearchPanel
              query={q}
              onPick={(entry) => {
                setResearched(listResearched());
                setCar(entry.car);
                setBrief(null);
                setShots([]);
                toast({
                  title: 'Model hasil riset dipakai',
                  body: `${entry.car.model} — ${entry.missing.length ? `tanpa ${entry.missing.join(', ')}` : 'data lengkap'}`,
                  kind: 'ok',
                });
              }}
            />
          )}

          <div className="row row--between">
            <span className="dim small">{car ? `Dipilih: ${car.model}` : 'Pilih satu mobil untuk lanjut'}</span>
            <button className="btn btn--primary" disabled={!car} onClick={() => { setStep(1); if (car && !brief) void makeBrief(car); }}>
              Lanjut <Icon.ChevronR size={14} />
            </button>
          </div>
        </div>
      )}

      {/* ------------------------------------------------------- step 1 */}
      {step === 1 && car && (
        <div className="workbench">
          <div className="rail stack" style={{ gap: 12 }}>
            <div className="card card--tight">
              <div className="eyebrow" style={{ marginBottom: 8 }}>Data mobil</div>
              <SpecRow k="Mesin" v={car.mesin} />
              <SpecRow k="Tenaga" v={car.tenaga} />
              <SpecRow k="Torsi" v={car.torsi} />
              <SpecRow k="Layout" v={car.layout} />
              <SpecRow k="Berat" v={car.berat} />
              <SpecRow k="0–100" v={car.nol100} />
              <SpecRow k="Top speed" v={car.vmax} />
              <SpecRow k="Tahun" v={car.tahun} />
            </div>
            <a className="note" href={car.sumber} target="_blank" rel="noreferrer">
              <span className="note__icon"><Icon.Info size={14} /></span>
              <span>Sumber spesifikasi: Wikipedia. Klik untuk memeriksa sendiri.</span>
            </a>
          </div>

          <div className="stack">
            <div className="row row--between">
              <h2>Brief 5-beat</h2>
              {busy === 'brief' && <span className="chip chip--warn"><Spinner size={11} /> AI menyusun brief…</span>}
            </div>
            {busy === 'brief' && !brief ? (
              <div className="stack" style={{ gap: 10 }}>
                {[0, 1, 2, 3, 4].map((i) => <div key={i} className="card card--tight"><div className="skel skel--line" style={{ width: '30%' }} /><div style={{ height: 8 }} /><div className="skel skel--line" /></div>)}
              </div>
            ) : brief ? (
              <div className="stack" style={{ gap: 10 }}>
                {(['hook', 'problem', 'product', 'proof', 'cta'] as const).map((k, i) => (
                  <div key={k} className="card card--tight">
                    <div className="row row--between" style={{ marginBottom: 6 }}>
                      <span className="eyebrow">{i + 1} · {k}</span>
                      <ConfidenceBadge level={i === 4 ? 'medium' : 'high'} />
                    </div>
                    <textarea
                      className="textarea"
                      value={brief[k]}
                      onChange={(e) => setBrief({ ...brief, [k]: e.target.value })}
                      aria-label={`Beat ${k}`}
                    />
                    <div className="dim tiny" style={{ marginTop: 6 }}>
                      {i === 3 ? 'Berisi angka dari katalog — jangan diubah tanpa memeriksa sumber.' : 'Boleh diedit bebas; ini suara Anda, bukan suara AI.'}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <ErrorState title="Brief belum tersusun" message="AI belum menghasilkan brief untuk mobil ini." onRetry={() => makeBrief(car)} />
            )}
          </div>

          <div className="rail stack workbench__right" style={{ gap: 12 }}>
            <div className="card card--tight">
              <div className="eyebrow" style={{ marginBottom: 8 }}>Kenapa brief ini?</div>
              <p className="small muted">
                Beat <strong>proof</strong> diisi langsung dari kolom tenaga, torsi, 0–100, dan top speed di katalog.
                Studio tidak mengarang spesifikasi — kalau kolom katalog kosong, teksnya menyebut “belum tercatat”.
              </p>
            </div>
            <div className="card card--tight">
              <div className="eyebrow" style={{ marginBottom: 8 }}>Durasi</div>
              <div className="row row--between"><span className="small">Target</span><span className="mono">{dur}s</span></div>
              <input className="range" type="range" min={MIN_DUR} max={MAX_DUR} step={5} value={dur} onChange={(e) => setDur(+e.target.value)} aria-label="Durasi video" />
              <div className="dim tiny">Minimum {MIN_DUR}s — batas keras pipeline (config/defaults.json).</div>
            </div>
            <button className="btn btn--primary" disabled={!brief || busy !== null} onClick={() => setStep(2)}>
              Lanjut ke storyboard <Icon.ChevronR size={14} />
            </button>
          </div>
        </div>
      )}

      {/* ------------------------------------------------------- step 2 */}
      {step === 2 && car && (
        <div className="stack">
          <div className="row row--between row--wrap">
            <div>
              <h2>Storyboard</h2>
              <p className="dim small">{accepted} dari {shots.length} shot diterima. Tolak shot yang tidak Anda inginkan — AI tidak memaksa.</p>
            </div>
            <div className="row">
              <button className="btn btn--sm" onClick={() => setShots(shots.map((s) => ({ ...s, accepted: true })))}>Terima semua</button>
              <button className="btn btn--sm" onClick={() => setShots(shots.map((s) => ({ ...s, accepted: false })))}>Tolak semua</button>
              <button className="btn btn--sm" onClick={async () => { setBusy('shots'); setShots(await api.generateShots(car, dur, brief!)); setBusy(null); }}>
                {busy === 'shots' ? <Spinner size={12} /> : <Icon.Retry size={13} />} Susun ulang
              </button>
            </div>
          </div>

          <div className="stack" style={{ gap: 8 }}>
            {shots.map((s, i) => (
              <div key={s.id} className="shot" style={{ opacity: s.accepted ? 1 : 0.45 }}>
                <div className="shot__num">{String(i + 1).padStart(2, '0')}</div>
                <div>
                  <input
                    className="input"
                    style={{ background: 'transparent', border: '1px solid transparent', padding: 0, fontSize: '0.82rem' }}
                    value={s.prompt}
                    onChange={(e) => setShots(shots.map((x) => (x.id === s.id ? { ...x, prompt: e.target.value } : x)))}
                    aria-label={`Prompt shot ${i + 1}`}
                  />
                  <div className="shot__meta">
                    <span>{s.dur}s</span>
                    <span>·</span>
                    <span>{s.camera}</span>
                    <span>·</span>
                    <ConfidenceBadge level={s.confidence} />
                  </div>
                </div>
                <div className="row" style={{ gap: 4 }}>
                  <button
                    className="btn btn--sm"
                    aria-pressed={s.accepted}
                    onClick={() => setShots(shots.map((x) => (x.id === s.id ? { ...x, accepted: !x.accepted } : x)))}
                    title={s.accepted ? 'Tolak shot' : 'Terima shot'}
                  >
                    {s.accepted ? <><Icon.Check size={13} /> Terima</> : <><Icon.X size={13} /> Tolak</>}
                  </button>
                </div>
              </div>
            ))}
          </div>

          <div className="row row--between">
            <button className="btn btn--ghost" onClick={() => setStep(1)}><Icon.ChevronL size={14} /> Kembali</button>
            <button className="btn btn--primary" disabled={accepted === 0} onClick={() => setStep(3)}>
              Atur parameter <Icon.ChevronR size={14} />
            </button>
          </div>
        </div>
      )}

      {/* ------------------------------------------------------- step 3 */}
      {step === 3 && (
        <div className="grid grid--2">
          <div className="card stack">
            <h2>Model video</h2>
            <div className="stack" style={{ gap: 8 }}>
              {VIDEO_MODELS.map((m) => (
                <label
                  key={m.id}
                  className="card card--tight"
                  style={{ cursor: 'pointer', borderColor: modelId === m.id ? 'var(--accent)' : undefined, boxShadow: modelId === m.id ? '0 0 0 3px var(--accent-dim)' : undefined }}
                >
                  <div className="row row--between">
                    <div className="row" style={{ gap: 8 }}>
                      <input type="radio" name="vm" checked={modelId === m.id} onChange={() => setModelId(m.id)} />
                      <div>
                        <div style={{ fontWeight: 600, fontSize: '0.86rem' }}>{m.name}</div>
                        <div className="dim tiny">{m.vendor}</div>
                      </div>
                    </div>
                    {isModelReady(m.id) ? <span className="chip chip--ok"><span className="dot" /> siap</span> : <span className="chip chip--warn">butuh API key</span>}
                  </div>
                  <p className="small muted" style={{ marginTop: 6 }}>{m.strength}</p>
                </label>
              ))}
            </div>
            {!isModelReady(pickedModel.id) && (
              <div className="note note--warn">
                <span className="note__icon"><Icon.Warn size={14} /></span>
                <span>
                  <strong>{pickedModel.name}</strong> belum punya kunci API di server ini. Proyek tetap bisa dibuat,
                  tapi tahap render akan memakai <strong>Studio Render (lokal)</strong>. Pilih itu kalau ingin hasil nyata sekarang.
                </span>
              </div>
            )}
          </div>

          <div className="stack">
            <div className="card stack">
              <h2>Parameter</h2>
              <div className="field">
                <span className="field__label">Durasi: {dur}s</span>
                <input className="range" type="range" min={MIN_DUR} max={MAX_DUR} step={5} value={dur} onChange={(e) => setDur(+e.target.value)} />
                <span className="field__hint">Minimal {MIN_DUR}s. Model {pickedModel.name} sendiri membatasi klip {pickedModel.maxDur}s, jadi video panjang akan disusun dari banyak shot.</span>
              </div>
              <div className="field">
                <span className="field__label">Rasio aspek</span>
                <div className="seg">
                  {(['16:9', '9:16', '1:1'] as const).map((a) => <button key={a} aria-pressed={aspect === a} onClick={() => setAspect(a)}>{a}</button>)}
                </div>
              </div>
              <div className="field">
                <span className="field__label">Resolusi</span>
                <div className="seg">
                  {(['1080p', '4K'] as const).map((r) => <button key={r} aria-pressed={resolution === r} onClick={() => setResolution(r)}>{r}</button>)}
                </div>
              </div>
              <div className="field">
                <span className="field__label">Gaya visual</span>
                <div className="seg">
                  {(['cinematic', 'documentary', 'social'] as const).map((s) => <button key={s} aria-pressed={style === s} onClick={() => setStyle(s)}>{s}</button>)}
                </div>
              </div>
            </div>

            <div className="card stack">
              <h2>Audio</h2>
              <Check label="Suara mesin" hint="Disintesis per model dari profil katalog" checked={engine} onChange={setEngine} />
              <Check label="Musik latar" hint="Bed musik instrumental" checked={music} onChange={setMusic} />
              <Check label="Voiceover" hint={`Bahasa ${settings.language === 'id' ? 'Indonesia' : 'Inggris'}`} checked={voice} onChange={setVoice} />
              {voice && (
                <div className="field">
                  <label htmlFor="tone">Nada suara</label>
                  <select id="tone" value={tone} onChange={(e) => setTone(e.target.value as typeof tone)}>
                    <option value="energik">Energik — sport car, EV</option>
                    <option value="sinematik">Sinematik — dokumenter, film</option>
                    <option value="hangat">Hangat — SUV keluarga, review</option>
                    <option value="tegas">Tegas — mewah, klasik</option>
                  </select>
                  <small className="muted">
                    Narasi diucapkan per scene, lalu dirapikan otomatis: EQ, kompresor,
                    dan loudness -16 LUFS. Musik diturunkan saat narasi berbunyi.
                  </small>
                </div>
              )}
            </div>

            {car && <PromptPanel car={car} />}

            <div className="row row--between">
              <button className="btn btn--ghost" onClick={() => setStep(2)}><Icon.ChevronL size={14} /> Kembali</button>
              <button className="btn btn--primary" onClick={() => setStep(4)}>
                Pratinjau <Icon.ChevronR size={14} />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ------------------------------------------------------- step 4 */}
      {step === 4 && car && brief && (
        <div className="workbench">
          <div className="rail stack" style={{ gap: 12 }}>
            <div className="card card--tight">
              <div className="eyebrow" style={{ marginBottom: 8 }}>Ringkasan</div>
              <Kv k="Mobil" v={car.model} />
              <Kv k="Durasi" v={`${dur}s`} />
              <Kv k="Rasio" v={aspect} />
              <Kv k="Resolusi" v={resolution} />
              <Kv k="Gaya" v={style} />
              <Kv k="Shot" v={`${accepted} diterima`} />
              <Kv k="Model" v={pickedModel.name} />
            </div>
            <div className="card card--tight">
              <div className="eyebrow" style={{ marginBottom: 8 }}>Audio</div>
              <div className="row row--wrap" style={{ gap: 6 }}>
                {engine && <span className="chip chip--ok">mesin</span>}
                {music && <span className="chip chip--ok">musik</span>}
                {voice && <span className="chip chip--ok">voiceover {settings.language}</span>}
                {!engine && !music && !voice && <span className="chip chip--warn">tanpa audio</span>}
              </div>
            </div>
          </div>

          <div className="stack">
            <div className="card">
              <div className="eyebrow" style={{ marginBottom: 8 }}>Pratinjau naskah</div>
              <div className="stack" style={{ gap: 10 }}>
                {(['hook', 'problem', 'product', 'proof', 'cta'] as const).map((k, i) => (
                  <div key={k}>
                    <div className="dim tiny" style={{ textTransform: 'uppercase', letterSpacing: '0.06em', fontSize: '0.62rem' }}>{i + 1} · {k}</div>
                    <div className="small">{brief[k]}</div>
                  </div>
                ))}
              </div>
            </div>

            <div className="card">
              <div className="eyebrow" style={{ marginBottom: 8 }}>Urutan shot ({accepted})</div>
              <div className="stack" style={{ gap: 6 }}>
                {shots.filter((s) => s.accepted).map((s, i) => (
                  <div key={s.id} className="row row--between" style={{ gap: 10, padding: '6px 8px', background: 'var(--surface-2)', borderRadius: 7 }}>
                    <div className="row" style={{ gap: 8, minWidth: 0 }}>
                      <span className="mono tiny dim">{String(i + 1).padStart(2, '0')}</span>
                      <span className="tiny truncate">{s.prompt}</span>
                    </div>
                    <span className="mono tiny dim" style={{ flex: '0 0 auto' }}>{s.dur}s</span>
                  </div>
                ))}
              </div>
            </div>

            {!isModelReady(pickedModel.id) && (
              <div className="note note--warn">
                <span className="note__icon"><Icon.Warn size={14} /></span>
                <span><strong>{pickedModel.name}</strong> belum tersambung. Render akan memakai Studio Render lokal.</span>
              </div>
            )}

            <div className="row row--between">
              <button className="btn btn--ghost" onClick={() => setStep(3)}><Icon.ChevronL size={14} /> Kembali</button>
              <button className="btn btn--primary btn--lg" onClick={start}>
                <Icon.Bolt size={15} /> Buat proyek & jalankan
              </button>
            </div>
          </div>

          <div className="rail stack workbench__right" style={{ gap: 12 }}>
            <div className="card card--tight">
              <div className="eyebrow" style={{ marginBottom: 8 }}>Yang akan terjadi</div>
              <ol className="small muted" style={{ margin: 0, paddingLeft: 18, lineHeight: 1.9 }}>
                <li>Proyek disimpan ke ruang kerja Anda</li>
                <li>Sembilan tahap berjalan berurutan</li>
                <li>Setiap tahap menulis artefaknya sendiri</li>
                <li>QA memeriksa durasi, kecerahan, dan audio</li>
              </ol>
            </div>
            <div className="note">
              <span className="note__icon"><Icon.Info size={14} /></span>
              <span>
                {api.kind === 'http'
                  ? 'Terhubung ke backend: pipeline akan benar-benar merender mp4.'
                  : 'Mode demo: pipeline disimulasikan. Untuk mp4 sungguhan, jalankan backend repo (npm run api + npm run worker).'}
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Kv({ k, v }: { k: string; v: string }) {
  return (
    <div className="row row--between" style={{ padding: '3px 0', gap: 8 }}>
      <span className="dim tiny">{k}</span>
      <span className="small" style={{ fontWeight: 550 }}>{v}</span>
    </div>
  );
}

function SpecRow({ k, v }: { k: string; v: string }) {
  return (
    <div className="row row--between" style={{ padding: '4px 0', gap: 8 }}>
      <span className="dim tiny" style={{ flex: '0 0 68px' }}>{k}</span>
      <span className="small" style={{ textAlign: 'right' }}>{v || '—'}</span>
    </div>
  );
}

function Check({ label, hint, checked, onChange }: { label: string; hint: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="row" style={{ gap: 10, cursor: 'pointer' }}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <div>
        <div className="small" style={{ fontWeight: 550 }}>{label}</div>
        <div className="dim tiny">{hint}</div>
      </div>
    </label>
  );
}
