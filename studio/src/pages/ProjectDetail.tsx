import React from 'react';
import { useStudio } from '../state/store';
import { buildMetadata, uploadFileName, PLATFORM_LABEL, PLATFORMS_WITH_ADAPTOR, type Platform } from '../services/metadata';
import { Icon, Spinner, EmptyState } from '../components/ui';
import type { Route } from '../components/shell';
import { STAGES, VIDEO_MODELS } from '../data/models';
import { CATALOG, findCar } from '../data/catalog';
import { findResearched } from '../data/researched';
import type { Project, StageRun, PublishOutcome } from '../services/api';
import { StatusChip } from './Dashboard';
import { PromptPanel } from '../components/PromptPanel';

export function ProjectDetail({ id, go, autoRun }: { id: string; go: (r: Route) => void; autoRun?: boolean }) {
  const { projects, loadingProjects, api, upsert, toast } = useStudio();
  const project = projects.find((p) => p.id === id);
  const [running, setRunning] = React.useState(false);
  const [publishing, setPublishing] = React.useState<Platform | null>(null);
  const [pubResult, setPubResult] = React.useState<Partial<Record<Platform, PublishOutcome>>>({});
  const cancel = React.useRef(false);
  // Tombol "Buat proyek & jalankan" hanya membuat proyek; tanpa ini pipeline
  // tidak pernah mulai dan semua tahap tertahan di "menunggu".
  const autoStarted = React.useRef(false);

  React.useEffect(() => {
    if (!autoRun || !project || autoStarted.current) return;
    autoStarted.current = true;
    // Buang penanda dari URL supaya refresh tidak memicu render ulang.
    if (location.hash.endsWith('/jalankan')) history.replaceState(null, '', `#/proyek/${id}`);
    void runFrom(0);
  }, [autoRun, project?.id]);

  if (!project && loadingProjects) {
    return (
      <div className="page stack" style={{ gap: 14 }}>
        <div className="row" style={{ gap: 8 }}><Spinner size={14} /> <span className="small">Memuat proyek…</span></div>
        <div className="card" style={{ height: 160 }} />
      </div>
    );
  }

  if (!project) {
    return (
      <div className="page">
        <EmptyState
          art={<Icon.Folder size={28} />}
          title="Proyek tidak ditemukan"
          text="Proyek ini mungkin sudah dihapus, atau tautannya salah."
          action={<button className="btn" onClick={() => go({ name: 'proyek' })}>Kembali ke daftar proyek</button>}
        />
      </div>
    );
  }

  // Proyek bisa memakai mobil hasil riset web, yang tidak ada di katalog.
  const car = findCar(project.carSlug, project.carName) ?? findResearched(project.carSlug)?.car;
  const model = VIDEO_MODELS.find((m) => m.id === project.modelId);
  const doneCount = project.stages.filter((s) => s.state === 'selesai' || s.state === 'dilewati').length;
  const pct = Math.round((doneCount / project.stages.length) * 100);
  const allSelesai = doneCount === project.stages.length;

  async function runFrom(startIdx = 0) {
    if (!project) return;
    cancel.current = false;
    setRunning(true);
    const stages: StageRun[] = project.stages.map((s, i) => (i < startIdx ? s : { ...s, state: 'menunggu', error: undefined }));
    let cur: Project = { ...project, stages, status: 'running' };
    await upsert(cur);

    for (let i = startIdx; i < stages.length; i++) {
      if (cancel.current) break;
      stages[i] = { ...stages[i], state: 'berjalan', startedAt: Date.now() };
      cur = { ...cur, stages: [...stages] };
      await upsert(cur);

      let res: Partial<StageRun>;
      try {
        res = await api.runStage(cur, stages[i].id);
      } catch (e) {
        // Tanpa ini tahap tertahan di "berjalan" selamanya saat backend menolak.
        const msg = e instanceof Error ? e.message : String(e);
        stages[i] = { ...stages[i], state: 'gagal', error: msg, endedAt: Date.now() };
        cur = { ...cur, stages: [...stages], status: 'failed' };
        await upsert(cur);
        toast({ title: `Tahap ${stages[i].label} gagal`, body: msg, kind: 'err' });
        setRunning(false);
        return;
      }

      if (res.state === 'gagal') {
        stages[i] = { ...stages[i], state: 'gagal', error: res.error, endedAt: Date.now() };
        cur = { ...cur, stages: [...stages], status: 'failed' };
        await upsert(cur);
        toast({ title: `Tahap ${stages[i].label} gagal`, body: res.error, kind: 'err' });
        setRunning(false);
        return;
      }
      stages[i] = { ...stages[i], state: 'selesai', artifact: res.artifact, endedAt: Date.now() };
      cur = { ...cur, stages: [...stages] };
      await upsert(cur);
    }

    const allDone = stages.every((s) => s.state === 'selesai' || s.state === 'dilewati');
    cur = { ...cur, stages: [...stages], status: allDone ? 'done' : 'draft' };
    await upsert(cur);
    setRunning(false);
    if (allDone) {
      // Mode demo tidak merender mp4: jangan mengaku "video selesai".
      toast(
        api.kind === 'http'
          ? { title: 'Video selesai dirender', body: `${cur.title} lolos QA`, kind: 'ok' }
          : { title: 'Simulasi pipeline selesai', body: 'Tidak ada mp4 yang dihasilkan — mode demo tidak menjalankan ffmpeg.', kind: 'info' },
      );
    }
  }

  const failedIdx = project.stages.findIndex((s) => s.state === 'gagal');

  async function doPublish(platform: Platform) {
    if (!car) return;
    setPublishing(platform);
    try {
      const meta = buildMetadata(car, { carSlug: project.carSlug, aspect: project.aspect }, platform);
      const res = await api.publish(project.id, platform, meta.caption);
      setPubResult((r) => ({ ...r, [platform]: res }));
      toast({
        title: res.status === 'failed' ? 'Unggahan tidak dijalankan' : `Percobaan unggah ${PLATFORM_LABEL[platform]}`,
        body: res.note ?? res.status,
        kind: res.status === 'failed' ? 'err' : 'info',
      });
    } catch (err) {
      setPubResult((r) => ({ ...r, [platform]: { status: 'failed', remoteId: null, dryRun: true, note: err instanceof Error ? err.message : 'gagal' } }));
    } finally {
      setPublishing(null);
    }
  }

  return (
    <div className="page stack" style={{ gap: 18 }}>
      <div className="row row--between row--wrap" style={{ alignItems: 'flex-start' }}>
        <div>
          <button className="btn btn--ghost btn--sm" onClick={() => go({ name: 'proyek' })} style={{ marginBottom: 8 }}>
            <Icon.ChevronL size={13} /> Proyek
          </button>
          <h1>{project.title}</h1>
          <div className="row row--wrap" style={{ gap: 8, marginTop: 8 }}>
            <StatusChip status={project.status} />
            <span className="chip">{project.durationSec}s</span>
            <span className="chip">{project.aspect}</span>
            <span className="chip">{project.resolution}</span>
            <span className="chip">{model?.name ?? project.modelId}</span>
          </div>
        </div>
        <div className="row">
          {running ? (
            <button className="btn btn--danger" onClick={() => { cancel.current = true; }}>
              <Icon.X size={14} /> Hentikan
            </button>
          ) : (
            // Jangan pernah disable tombol ini: proyek yang sudah selesai harus
            // bisa dijalankan ulang, kalau tidak video jadi buntu tanpa jalan keluar.
            <button className="btn btn--primary" onClick={() => runFrom(failedIdx >= 0 ? failedIdx : 0)}>
              {failedIdx >= 0 ? <><Icon.Retry size={14} /> Coba lagi dari tahap gagal</>
                : allSelesai ? <><Icon.Retry size={14} /> Jalankan ulang pipeline</>
                : <><Icon.Play size={14} /> Jalankan pipeline</>}
            </button>
          )}
        </div>
      </div>

      <div className="card">
        <div className="row row--between" style={{ marginBottom: 8 }}>
          <span className="small" style={{ fontWeight: 600 }}>Progres {doneCount}/{project.stages.length} tahap</span>
          <span className="mono small">{pct}%</span>
        </div>
        <div className="bar"><div className="bar__fill" style={{ width: `${pct}%` }} /></div>
      </div>

      {project.videoUrl ? (
        <div className="card stack" style={{ gap: 10 }}>
          <div className="row row--between row--wrap">
            <span className="small" style={{ fontWeight: 600 }}>Hasil render</span>
            {project.qaNote && <span className="chip chip--ok">{project.qaNote}</span>}
          </div>
          <video
            src={project.videoUrl}
            poster={project.thumbUrl}
            controls
            preload="metadata"
            playsInline
            style={{ width: '100%', borderRadius: 10, background: '#000', aspectRatio: project.aspect === '9 / 16' || project.aspect === '9:16' ? '9 / 16' : '16 / 9', maxHeight: 460 }}
          />
          <div className="row row--wrap" style={{ gap: 8 }}>
            <a className="btn btn--sm" href={project.videoUrl} download><Icon.Download size={13} /> Unduh mp4</a>
            <span className="dim tiny">Dirender pipeline nyata dengan ffmpeg dari foto asli.</span>
          </div>
        </div>
      ) : (
        // Tanpa blok ini, proyek yang selesai di mode demo tampak "hilang hasilnya":
        // tidak ada video, dan tidak ada penjelasan kenapa.
        project.status === 'done' && (
          <div className="note note--warn">
            <span className="note__icon"><Icon.Info size={14} /></span>
            <span>
              {api.kind === 'http'
                ? 'Tahap selesai tapi file mp4 tidak ditemukan di server. Jalankan ulang tahap Render untuk membuatnya.'
                : 'Semua tahap simulasi selesai, tetapi mode demo tidak menjalankan ffmpeg sehingga tidak ada mp4. Sambungkan backend di halaman Pengaturan untuk render sungguhan.'}
            </span>
          </div>
        )
      )}

      <div className="workbench">
        <div className="rail card card--tight">
          <div className="eyebrow" style={{ marginBottom: 8 }}>Data mobil</div>
          {car ? (
            <>
              <div style={{ fontWeight: 650, fontSize: '0.88rem', marginBottom: 6 }}>{car.model}</div>
              <Row k="Mesin" v={car.mesin} />
              <Row k="Tenaga" v={car.tenaga} />
              <Row k="Torsi" v={car.torsi} />
              <Row k="0–100" v={car.nol100} />
              <Row k="Top" v={car.vmax} />
            </>
          ) : (
            <p className="dim tiny">Data mobil tidak ada di katalog.</p>
          )}
        </div>

        <div className="stack" style={{ gap: 12, minWidth: 0 }}>
          <div className="card" style={{ padding: 12 }}>
            <div className="eyebrow" style={{ padding: '0 8px 8px' }}>Pipeline 9 tahap</div>
            {project.stages.map((s, i) => {
              const def = STAGES.find((d) => d.id === s.id);
              return (
                <div key={s.id} className="stage" data-state={s.state}>
                  <div className="stage__idx">
                    {s.state === 'selesai' ? '✓' : s.state === 'gagal' ? '!' : s.state === 'berjalan' ? '•' : i + 1}
                  </div>
                  <div className="stage__body">
                    <div className="row row--between">
                      <span className="stage__name">{s.label}</span>
                      <StageBadge state={s.state} />
                    </div>
                    <div className="stage__meta">{def?.desc}</div>
                    {s.state === 'berjalan' && (
                      <div className="bar" style={{ marginTop: 6 }}><div className="bar__fill" style={{ width: '65%' }} /></div>
                    )}
                    {s.error && <div className="note note--err" style={{ marginTop: 6 }}><span className="note__icon"><Icon.Warn size={13} /></span><span>{s.error}</span></div>}
                  </div>
                  <div className="stage__actions">
                    {s.artifact && s.state === 'selesai' && <span className="chip mono tiny">{s.artifact}</span>}
                    {s.state === 'menunggu' && !running && i > 0 && (
                      <button className="btn btn--ghost btn--sm" title="Lewati tahap" onClick={async () => {
                        const st = project.stages.map((x, j) => (j === i ? { ...x, state: 'dilewati' as const } : x));
                        await upsert({ ...project, stages: st });
                      }}>
                        <Icon.Skip size={12} />
                      </button>
                    )}
                    {s.state === 'gagal' && (
                      <button className="btn btn--sm" onClick={() => runFrom(i)}><Icon.Retry size={12} /> Ulangi</button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {car && <PromptPanel car={car} />}
        </div>

        <div className="rail stack workbench__right" style={{ gap: 12 }}>
          {(['hook', 'problem', 'product', 'proof', 'cta'] as const).some((k) => project.brief[k]) && (
            <div className="card card--tight">
              <div className="eyebrow" style={{ marginBottom: 8 }}>Brief</div>
              {(['hook', 'problem', 'product', 'proof', 'cta'] as const).map((k) => (
                <div key={k} style={{ marginBottom: 8 }}>
                  <div className="dim tiny" style={{ textTransform: 'uppercase', letterSpacing: '0.06em', fontSize: '0.62rem' }}>{k}</div>
                  <div className="small">{project.brief[k]}</div>
                </div>
              ))}
            </div>
          )}
          {project.shots.length > 0 && (
            <div className="card card--tight">
              <div className="eyebrow" style={{ marginBottom: 8 }}>Shot diterima</div>
              <div className="mono" style={{ fontSize: '1.3rem', fontWeight: 700 }}>{project.shots.filter((s) => s.accepted).length}/{project.shots.length}</div>
              <div className="dim tiny">Total {project.shots.filter((s) => s.accepted).reduce((a, s) => a + s.dur, 0)}s dari target {project.durationSec}s</div>
            </div>
          )}
          {car && (
            <div className="card card--tight">
              <div className="eyebrow" style={{ marginBottom: 8 }}>Siapkan unggahan</div>
              {PLATFORMS_WITH_ADAPTOR.map((p) => {
                const meta = buildMetadata(car, { carSlug: project.carSlug, aspect: project.aspect }, p);
                const res = pubResult[p];
                return (
                  <div key={p} style={{ padding: '8px 0', borderTop: '1px solid var(--line)' }}>
                    <div className="row row--between" style={{ gap: 8 }}>
                      <span className="small" style={{ fontWeight: 600 }}>{PLATFORM_LABEL[p]}</span>
                      <button
                        className="btn btn--sm"
                        onClick={() => doPublish(p)}
                        disabled={publishing !== null}
                        title={meta.title}
                      >
                        {publishing === p ? <Spinner size={11} /> : <Icon.Upload size={12} />} Uji unggah
                      </button>
                    </div>
                    <div className="tiny dim" style={{ marginTop: 2 }}>{meta.title}</div>
                    <div className="mono tiny dim">{uploadFileName({ carSlug: project.carSlug, aspect: project.aspect }, p)}</div>
                    {res && (
                      <div className={`tiny ${res.status === 'failed' ? '' : 'dim'}`} style={{ marginTop: 4, color: res.status === 'failed' ? 'var(--warn)' : undefined }}>
                        {res.status === 'dry_run' ? 'dry-run: tidak diunggah' : res.status === 'duplicate' ? 'sudah pernah dicoba' : res.status === 'published' ? `terunggah (${res.remoteId})` : 'gagal'}
                        {res.note ? ` — ${res.note}` : ''}
                      </div>
                    )}
                  </div>
                );
              })}
              <div className="dim tiny" style={{ marginTop: 6, lineHeight: 1.6 }}>
                Tombol ini memanggil adaptor publish backend dengan <span className="mono">dryRun</span> aktif:
                alurnya diuji tanpa benar-benar memposting. TikTok dan YouTube belum punya adaptor,
                jadi tidak ditampilkan.
              </div>
            </div>
          )}
          {project.status === 'done' && (
            <div className={`note ${api.kind === 'http' ? 'note--ok' : ''}`}>
              <span className="note__icon"><Icon.Info size={14} /></span>
              <span>
                {api.kind === 'http'
                  ? 'Semua tahap selesai dan QA tidak menolak. Video siap diunduh dari perpustakaan.'
                  : 'Simulasi sembilan tahap selesai. Mode demo tidak menjalankan ffmpeg, jadi tidak ada mp4 baru. Video contoh yang benar-benar dirender ada di Perpustakaan.'}
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function StageBadge({ state }: { state: StageRun['state'] }) {
  if (state === 'berjalan') return <span className="chip chip--accent"><Spinner size={10} /> berjalan</span>;
  if (state === 'selesai') return <span className="chip chip--ok">selesai</span>;
  if (state === 'gagal') return <span className="chip chip--err">gagal</span>;
  if (state === 'dilewati') return <span className="chip">dilewati</span>;
  return <span className="chip">menunggu</span>;
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="row row--between" style={{ padding: '3px 0', gap: 8 }}>
      <span className="dim tiny" style={{ flex: '0 0 56px' }}>{k}</span>
      <span className="tiny" style={{ textAlign: 'right' }}>{v || '—'}</span>
    </div>
  );
}
