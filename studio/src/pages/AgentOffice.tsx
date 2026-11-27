import React from 'react';
import { useStudio } from '../state/store';
import { STAGES } from '../data/models';
import type { JobEvent } from '../services/api';
import type { Route } from '../components/shell';

/**
 * Kantor Agen: tiga ruang kerja (naskah, editor, QA) yang menyala mengikuti
 * tahap pipeline yang benar-benar berjalan di server. Semua angka di halaman
 * ini berasal dari artefak job; tidak ada metrik karangan.
 */

type ScriptArtifact = {
  model?: string;
  tagline?: string;
  sumber?: string;
  catatan?: string;
  lines?: Array<{ sceneIndex: number; onScreenText?: string; voiceover?: string }>;
};

type QaArtifact = {
  checks?: Array<{ name: string; ok?: boolean; detail?: string }>;
  verdict?: string;
};

type RenderArtifact = {
  durationSec?: number;
  width?: number;
  height?: number;
  fps?: number;
  bitrateKbps?: number;
  hasAudio?: boolean;
  scenes?: number;
  transitions?: number;
};

const GLYPH: Record<string, string> = {
  pm: '✎',
  research: '⌕',
  script: '✍',
  storyboard: '▤',
  visual: '▣',
  motion: '▶',
  sound: '♪',
  render: '⚙',
  qa: '✓',
};

/* --------------------------------------------------------------- pixel art */
type Ctx2D = CanvasRenderingContext2D;

function R(c: Ctx2D, x: number, y: number, w: number, h: number, col: string): void {
  c.fillStyle = col;
  c.fillRect(x, y, w, h);
}

function person(c: Ctx2D, x: number, y: number, body: string, hair: string, act: boolean, t: number): void {
  const bob = act ? (t >> 2) & 1 : 0;
  R(c, x + 2, y + bob, 6, 6, '#f0c9a0');
  R(c, x + 2, y + bob, 6, 2, hair);
  R(c, x + 1, y + 6 + bob, 8, 8, body);
  R(c, x + 2, y + 14, 2, 3, '#222');
  R(c, x + 6, y + 14, 2, 3, '#222');
}

const BG = '#0d111c';
const WALL = '#1a2132';
const ACC = '#5ce1ff';
const ACC2 = '#8b7cff';

function roomScript(c: Ctx2D, act: boolean, t: number): void {
  R(c, 0, 0, 160, 110, WALL);
  R(c, 0, 0, 160, 28, '#121724');
  R(c, 14, 6, 32, 16, '#22304a');
  R(c, 114, 6, 32, 16, '#22304a');
  for (let i = 0; i < 160; i += 16) R(c, i, 28, 1, 82, '#232c42');
  R(c, 30, 68, 100, 12, '#6b4f36');
  R(c, 30, 80, 100, 3, '#4a3726');
  person(c, 40, 50, '#3b8de0', '#20242e', act, t);
  R(c, 70, 46, 44, 20, '#05070d');
  R(c, 72, 48, 40, 16, act ? ((t >> 3) & 1 ? ACC : '#2f7d94') : '#161d2b');
  if (act) {
    for (let l = 0; l < 3; l++) R(c, 74, 51 + l * 4, 10 + (((t >> 2) + l) % 3) * 6, 1, '#04121a');
  }
  R(c, 14, 76, 12, 14, '#2f7a44');
  R(c, 17, 88, 6, 8, '#6b4429');
  R(c, 128, 58, 18, 28, '#0f1420');
  R(c, 131, 62, 12, 3, ACC);
  R(c, 131, 68, 8, 2, '#3a4560');
  R(c, 131, 72, 10, 2, '#3a4560');
}

function roomEditor(c: Ctx2D, act: boolean, t: number, pr: number): void {
  R(c, 0, 0, 160, 110, '#241f45');
  R(c, 0, 0, 160, 26, '#171334');
  R(c, 10, 6, 40, 14, '#0b0a1c');
  R(c, 110, 6, 40, 14, '#0b0a1c');
  R(c, 16, 64, 48, 10, '#3a3170');
  R(c, 96, 64, 48, 10, '#3a3170');
  R(c, 20, 42, 36, 22, '#05070d');
  R(c, 22, 44, Math.max(2, Math.round(32 * pr)), 18, act ? ACC : '#2a5f75');
  R(c, 104, 42, 36, 22, '#05070d');
  R(c, 106, 44, 32, 18, '#1c2540');
  for (let i = 0; i < 3; i++) R(c, 108, 48 + i * 5, 22 - i * 4, 2, '#31456b');
  person(c, 66, 44, ACC2, '#20242e', act, t);
  R(c, 24, 74, 50, 3, '#2b2456');
  R(c, 100, 92, 18, 12, '#1b1740');
  R(c, 6, 96, 148, 6, '#0f0c26');
  R(c, 8, 97, Math.round(144 * pr), 4, ACC);
  if (act) R(c, 8 + Math.round(144 * pr), 96, 2, 6, '#ffffff');
}

function roomQa(c: Ctx2D, act: boolean, t: number): void {
  R(c, 0, 0, 160, 110, '#232a36');
  R(c, 0, 0, 160, 30, '#1b2130');
  R(c, 12, 6, 30, 18, '#05070d');
  R(c, 14, 20, 24, 2, ACC);
  R(c, 50, 6, 30, 18, '#05070d');
  R(c, 53, 11, 22, 2, ACC);
  R(c, 53, 16, 12, 2, '#3a4560');
  for (let k = 0; k < 3; k++) {
    R(c, 12 + k * 18, 74, 14, 32, '#151b26');
    for (let j = 0; j < 4; j++) R(c, 15 + k * 18, 78 + j * 6, 3, 2, ((t >> 2) + j + k) % 3 ? ACC : '#e0556b');
  }
  person(c, 70, 52, '#e0b030', '#4a2a1a', act, t);
  c.strokeStyle = '#05070d';
  c.lineWidth = 1;
  c.beginPath();
  c.arc(130, 86, 18, 0, 6.3);
  c.stroke();
  c.strokeStyle = ACC;
  c.beginPath();
  c.moveTo(130, 86);
  c.lineTo(130 + 17 * Math.cos(t / 8), 86 + 17 * Math.sin(t / 8));
  c.stroke();
  R(c, 96, 96, 56, 4, '#151b26');
  R(c, 96, 96, Math.round(56 * (0.4 + 0.3 * Math.sin(t / 20))), 4, ACC2);
}

function drawRoom(c: Ctx2D, kind: RoomKind, act: boolean, pr: number, t: number): void {
  if (kind === 'script') roomScript(c, act, t);
  else if (kind === 'editor') roomEditor(c, act, t, pr);
  else roomQa(c, act, t);
}

/* -------------------------------------------------------------------- view */
type RoomKind = 'script' | 'editor' | 'qa';

const WHO: Record<RoomKind, string> = {
  script: 'Penulis Naskah',
  editor: 'Render Engineer',
  qa: 'QA Reviewer',
};

const ROOMS: Array<{ kind: RoomKind; sub: string; title: string; stages: string[] }> = [
  { kind: 'script', sub: '01 /script-lab', title: 'SCRIPT LAB', stages: ['pm', 'research', 'script', 'storyboard'] },
  { kind: 'editor', sub: '02 /editor', title: 'EDIT STUDIO', stages: ['visual', 'motion', 'sound', 'render'] },
  { kind: 'qa', sub: '03 /qa', title: 'QA & BUKTI', stages: ['qa'] },
];

function Room({ kind, active, done, total, progress, paused, bubble, status }: {
  kind: RoomKind;
  active: boolean;
  done: number;
  total: number;
  progress: number;
  paused: boolean;
  bubble: string;
  status: string;
}) {
  const ref = React.useRef<HTMLCanvasElement | null>(null);
  const t = React.useRef(0);
  const state = React.useRef({ active, progress, paused });
  state.current = { active, progress, paused };

  React.useEffect(() => {
    const tick = () => {
      const c = ref.current?.getContext('2d');
      if (!c) return;
      if (!state.current.paused) t.current++;
      drawRoom(c, kind, state.current.active, state.current.progress, t.current);
    };
    tick();
    const id = window.setInterval(tick, 90);
    return () => window.clearInterval(id);
  }, [kind]);

  return (
    <div className={`kantor__card${active ? ' is-on' : ''}`}>
      <div className="kantor__tb mono">
        <span>{ROOMS.find((r) => r.kind === kind)?.sub}</span>
        <span>{ROOMS.find((r) => r.kind === kind)?.title}</span>
      </div>
      <div className="kantor__stage">
        <canvas ref={ref} width={160} height={110} />
        {active && <div className="kantor__bub">{bubble}</div>}
      </div>
      <div className="kantor__st">
        <span>{status}</span>
        <span className="mono dim" style={{ float: 'right' }}>
          {done}/{total}
        </span>
        <div className="kantor__pb">
          <i style={{ width: `${Math.round(progress * 100)}%` }} />
        </div>
      </div>
    </div>
  );
}

function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

export function AgentOffice({ go }: { go: (r: Route) => void }) {
  const { api, projects, refresh, toast } = useStudio();
  const [id, setId] = React.useState('');
  const [paused, setPaused] = React.useState(false);
  const [script, setScript] = React.useState<ScriptArtifact | null>(null);
  const [qa, setQa] = React.useState<QaArtifact | null>(null);
  const [render, setRender] = React.useState<RenderArtifact | null>(null);
  const [events, setEvents] = React.useState<JobEvent[]>([]);
  const [now, setNow] = React.useState(() => new Date());
  const [busy, setBusy] = React.useState(false);

  const project = projects.find((p) => p.id === id) ?? projects[0];

  React.useEffect(() => {
    if (!id && projects.length) setId(projects[0].id);
  }, [id, projects]);

  React.useEffect(() => {
    const h = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(h);
  }, []);

  const stageStates = project?.stages.map((s) => s.state).join(',') ?? '';

  React.useEffect(() => {
    if (!api || !project) return;
    let alive = true;
    (async () => {
      const [s, q, r] = await Promise.all([
        api.getArtifact<ScriptArtifact>(project.id, 'script.json').catch(() => null),
        api.getArtifact<QaArtifact>(project.id, 'qa.json').catch(() => null),
        api.getArtifact<RenderArtifact>(project.id, 'render-result.json').catch(() => null),
      ]);
      const ev = await api.getEvents(project.id, 40).catch(() => [] as JobEvent[]);
      if (!alive) return;
      setScript(s);
      setQa(q);
      setRender(r);
      setEvents(ev);
    })();
    return () => {
      alive = false;
    };
  }, [api, project?.id, stageStates]);

  React.useEffect(() => {
    if (project?.status !== 'running') return;
    const h = window.setInterval(() => void refresh(), 3000);
    return () => window.clearInterval(h);
  }, [project?.status, refresh]);

  const stateOf = (sid: string) => project?.stages.find((s) => s.id === sid)?.state ?? 'menunggu';
  const runningStage = STAGES.find((s) => stateOf(s.id) === 'berjalan');
  const failedStage = STAGES.find((s) => stateOf(s.id) === 'gagal');
  const doneCount = STAGES.filter((s) => ['selesai', 'dilewati'].includes(stateOf(s.id))).length;

  const checks = qa?.checks ?? [];
  const qaPass = checks.length > 0 && checks.every((c) => c.ok !== false);
  const lines = script?.lines ?? [];
  const hook = lines[0]?.voiceover || lines[0]?.onScreenText || '';

  async function approve() {
    if (!project) return;
    setBusy(true);
    try {
      const res = await api.publish(project.id, 'instagram', `${project.title} — ${project.carName}`);
      toast({
        title: res.status === 'failed' ? 'Persetujuan tidak dijalankan' : 'Video disetujui',
        body: res.note ?? (res.dryRun ? 'dry-run: belum ada akun platform tersambung' : res.status),
        kind: res.status === 'failed' ? 'err' : 'ok',
      });
    } catch (err) {
      toast({ title: 'Gagal menyetujui', body: err instanceof Error ? err.message : 'kesalahan tak dikenal', kind: 'err' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="kantor">
      <div className="kantor__head">
        <div className="kantor__legend">
          <span className={`chip ${api.kind === 'http' ? 'chip--ok' : 'chip--info'}`}>
            {api.kind === 'http' ? 'MODE NYATA' : 'MODE DEMO'}
          </span>
          <span className="dim">
            3 ruang · 9 agen · proyek {project ? project.title : 'belum dipilih'}
          </span>
        </div>
        <div className="kantor__clock">
          <b className="mono">
            {pad(now.getHours())}
            <i>:</i>
            {pad(now.getMinutes())}
            <small>:{pad(now.getSeconds())}</small>
          </b>
          <small>jam nonstop · waktu perangkat</small>
        </div>
        <div className="kantor__hex" aria-label="Status sembilan agen">
          {STAGES.map((s) => {
            const st = stateOf(s.id);
            const cls = st === 'berjalan' ? 'on' : st === 'selesai' || st === 'dilewati' ? 'ok' : st === 'gagal' ? 'bad' : '';
            return (
              <span key={s.id} className={`kantor__hx ${cls}`} title={`${s.label} · ${st}`}>
                {GLYPH[s.id] ?? '•'}
              </span>
            );
          })}
        </div>
      </div>

      <div className="kantor__bar">
        <button className="btn btn--sm" onClick={() => setPaused((p) => !p)} title="Hanya animasi kantor; worker tetap berjalan">
          {paused ? 'Lanjut' : 'Jeda'} tampilan
        </button>
        <select
          className="kantor__pick"
          value={project?.id ?? ''}
          onChange={(e) => setId(e.target.value)}
          aria-label="Pilih proyek"
        >
          {projects.length === 0 && <option value="">Belum ada proyek</option>}
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.title} · {p.status}
            </option>
          ))}
        </select>
        <button
          className="btn btn--primary btn--sm"
          disabled={!project || project.status !== 'done' || busy}
          onClick={approve}
          title={project?.status === 'done' ? 'Menjalankan uji unggah (dry-run)' : 'Aktif setelah video selesai'}
        >
          {busy ? 'Memproses…' : 'Setujui video'}
        </button>
        <div className="kantor__chips mono">
          <span className="chip">script.json</span>
          <span className="chip">qa.json</span>
          <span className="chip">{doneCount}/9 tahap</span>
        </div>
      </div>

      <div className="kantor__rooms">
        {ROOMS.map((r) => {
          const states = r.stages.map(stateOf);
          const active = states.includes('berjalan');
          const done = states.filter((s) => s === 'selesai' || s === 'dilewati').length;
          const failed = states.includes('gagal');
          const defs = r.stages.map((sid) => STAGES.find((s) => s.id === sid));
          const cur = defs.find((s) => s && stateOf(s.id) === 'berjalan');
          const bad = defs.find((s) => s && stateOf(s.id) === 'gagal');
          const all = done === r.stages.length;
          const bubble = cur ? cur.label : bad ? 'gagal' : all ? 'selesai' : 'menunggu';
          const status = cur
            ? `${cur.label} · berjalan`
            : bad
              ? `${bad.label} · gagal`
              : all
                ? `${WHO[r.kind]} · selesai`
                : `${WHO[r.kind]} · menunggu`;
          return (
            <Room
              key={r.kind}
              kind={r.kind}
              active={active}
              done={done}
              total={r.stages.length}
              progress={r.stages.length ? done / r.stages.length : 0}
              paused={paused}
              bubble={bubble}
              status={status}
            />
          );
        })}
      </div>

      <div className="kantor__two">
        <div className="card card--tight kantor__panel">
          {checks.length > 0 && <span className={`kantor__stamp mono${qaPass ? '' : ' is-fail'}`}>{qaPass ? 'LULUS QA' : 'GAGAL QA'}</span>}
          <div className="mono dim" style={{ fontSize: 12 }}>
            script.json{script?.sumber ? ` · naskah ${script.sumber}` : ''}
          </div>
          <span className="chip chip--accent mono" style={{ marginTop: 8 }}>
            HOOK
          </span>
          <div className="kantor__hook">{hook || 'Belum ada naskah untuk proyek ini.'}</div>
          <ul className="kantor__pt">
            {lines.slice(0, 6).map((l, i) => (
              <li key={i}>
                <span>{i + 1}</span>
                {l.voiceover || l.onScreenText || '—'}
              </li>
            ))}
          </ul>
          {script?.catatan && <p className="dim kantor__note">catatan: {script.catatan}</p>}
        </div>

        <div className="card card--tight kantor__panel">
          <div className="mono dim" style={{ fontSize: 12, marginBottom: 8 }}>
            bukti render · ffprobe
          </div>
          {[
            ['Durasi', render?.durationSec ? `${render.durationSec} dtk` : '—'],
            ['Resolusi', render?.width ? `${render.width}×${render.height}` : '—'],
            ['FPS', render?.fps ? String(render.fps) : '—'],
            ['Bitrate', render?.bitrateKbps ? `${render.bitrateKbps} kbps` : '—'],
            ['Audio', render?.hasAudio === undefined ? '—' : render.hasAudio ? 'ada' : 'tidak ada'],
            ['Scene / transisi', render?.scenes ? `${render.scenes} / ${render.transitions ?? 0}` : '—'],
          ].map(([k, v]) => (
            <div key={k} className="kantor__row">
              <span>{k}</span>
              <em className="mono">{v}</em>
            </div>
          ))}
          <div className="kantor__pola mono">
            {checks.length ? `qa ${checks.filter((c) => c.ok !== false).length}/${checks.length} lulus` : 'qa belum dijalankan'}
            {failedStage ? ` · gagal di ${failedStage.label}` : runningStage ? ` · ${runningStage.label} berjalan` : ''}
          </div>
          <p className="dim kantor__note">
            Angka penonton tidak ditampilkan: belum ada akun TikTok/Instagram/YouTube tersambung, jadi tidak ada data
            tayangan yang bisa dilaporkan.
          </p>
        </div>
      </div>

      <div className="card card--tight kantor__log mono">
        <div className="dim" style={{ fontSize: 12, marginBottom: 6 }}>
          log agen
        </div>
        {events.length === 0 && <div className="dim">Belum ada peristiwa. Jalankan pipeline untuk melihat langkah agen.</div>}
        {[...events].reverse().slice(0, 6).map((e, i) => (
          <div key={`${e.created_at}-${i}`} className="kantor__logline">
            <span className="dim">{String(e.created_at).slice(11, 19)}</span> {e.agent_id || e.scope} · {e.message}
          </div>
        ))}
        {!project && (
          <div className="dim">
            Belum ada proyek.{' '}
            <button className="btn btn--sm" onClick={() => go({ name: 'baru' })}>
              Buat video
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
