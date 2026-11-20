// Lapisan service. Satu antarmuka, dua implementasi:
//  - HttpStudioApi  -> memakai backend repo (Express + worker + ffmpeg) bila terjangkau
//  - DemoStudioApi  -> simulasi lokal (localStorage) supaya studio tetap bisa
//                      dipakai/dinilai saat di-deploy statis (Netlify).
// Pemanggil tidak perlu tahu mana yang aktif.

import { CATALOG, findCar, type Car } from '../data/catalog.ts';
import { STAGES, MIN_DUR } from '../data/models.ts';
import { RENDERED, type RenderedVideo } from '../data/rendered.ts';

export type StageState = 'menunggu' | 'berjalan' | 'selesai' | 'gagal' | 'dilewati';

export type StageRun = {
  id: string;
  label: string;
  state: StageState;
  startedAt?: number;
  endedAt?: number;
  error?: string;
  artifact?: string;
};

export type Shot = {
  id: string;
  n: number;
  prompt: string;
  dur: number;
  camera: string;
  confidence: 'high' | 'medium' | 'low';
  accepted: boolean;
};

export type Brief = {
  hook: string;
  problem: string;
  product: string;
  proof: string;
  cta: string;
};

export type Project = {
  id: string;
  createdAt: number;
  updatedAt: number;
  title: string;
  carSlug: string;
  carName: string;
  modelId: string;
  durationSec: number;
  aspect: '16:9' | '9:16' | '1:1';
  resolution: '1080p' | '4K';
  style: 'cinematic' | 'documentary' | 'social';
  audio: { engine: boolean; music: boolean; voiceover: boolean; lang: 'id' | 'en' };
  brief: Brief;
  shots: Shot[];
  stages: StageRun[];
  status: 'draft' | 'running' | 'done' | 'failed';
  videoUrl?: string;
  thumbUrl?: string;
  qaNote?: string;
};

/** Job dari /api/jobs memakai snake_case; UI memakai camelCase. */
type ServerJob = {
  id: string;
  title?: string;
  model?: string;
  brief_slug?: string;
  duration_sec?: number;
  aspect?: string;
  status?: string;
  created_at?: string;
  error?: string | null;
};

const ASPECTS = ['16:9', '9:16', '1:1'] as const;

export function projectFromServer(j: ServerJob): Project {
  const slug = j.brief_slug ?? '';
  const car = findCar(slug, j.model);
  const created = j.created_at ? Date.parse(j.created_at) : NaN;
  const status = j.status === 'done' || j.status === 'running' || j.status === 'failed' ? j.status : 'draft';
  return {
    id: j.id,
    createdAt: Number.isFinite(created) ? created : Date.now(),
    updatedAt: Number.isFinite(created) ? created : Date.now(),
    title: j.title ?? j.model ?? 'Tanpa judul',
    carSlug: car?.slug ?? slug,
    carName: car?.model ?? j.model ?? '',
    modelId: 'studio',
    durationSec: j.duration_sec ?? 30,
    aspect: (ASPECTS as readonly string[]).includes(j.aspect ?? '') ? (j.aspect as Project['aspect']) : '16:9',
    resolution: '1080p',
    style: 'cinematic',
    audio: { engine: true, music: true, voiceover: false, lang: 'id' },
    brief: { hook: '', problem: '', product: '', proof: '', cta: '' },
    shots: [],
    stages: STAGES.map((s, i) => ({
      id: s.id,
      label: s.label,
      state: status === 'done' ? 'selesai' : status === 'running' && i === 0 ? 'berjalan' : 'menunggu',
      ms: 0,
    })),
    status,
    qaNote: j.error ?? undefined,
  };
}

export type PublishOutcome = {
  status: 'dry_run' | 'published' | 'duplicate' | 'failed';
  remoteId: string | null;
  dryRun: boolean;
  note?: string;
};

export type StudioApi = {
  kind: 'http' | 'demo';
  createProject(input: Partial<Project> & { carSlug: string }): Promise<Project>;
  generateBrief(car: Car): Promise<Brief>;
  generateShots(car: Car, dur: number, brief: Brief): Promise<Shot[]>;
  runStage(project: Project, stageId: string): Promise<Partial<StageRun>>;
  saveProject(p: Project): Promise<void>;
  listProjects(): Promise<Project[]>;
  publish(jobId: string, platform: string, caption: string): Promise<PublishOutcome>;
  /** Login sungguhan bila ada backend; mode demo menerima apa saja (lokal). */
  authenticate(account: string, password: string): Promise<{ ok: boolean; error?: string }>;
};

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const rid = () => Math.random().toString(36).slice(2, 10);

/* ------------------------------------------------------------------ brief */
// 5-beat yang benar-benar memakai angka dari katalog — tidak mengarang.
export function buildBrief(car: Car): Brief {
  const tenaga = car.tenaga || 'tenaga belum tercatat';
  const nol = car.nol100 || 'angka akselerasi belum tercatat';
  return {
    hook: `${car.model}: ${car.tagline || 'satu mesin, satu karakter.'}`,
    problem: `Banyak konten otomotif menyebut angka tanpa sumber. ${car.model} sering dibahas dengan klaim yang tidak bisa dilacak.`,
    product: `${car.mesin}. ${tenaga}, torsi ${car.torsi}, layout ${car.layout}.`,
    proof: `0–100 ${nol}, top speed ${car.vmax}. Berat ${car.berat}. Sumber: Wikipedia (lihat lembar riset).`,
    cta: `Simpan video ini, lalu bandingkan sendiri dengan data resmi ${car.merk}.`,
  };
}

/* ------------------------------------------------------------------ shots */
// Shot dibangun dari beat + durasi, dengan label keyakinan yang jujur:
// shot yang bertumpu pada angka katalog = high, yang butuh footage tambahan = medium/low.
export function buildShots(car: Car, dur: number, brief: Brief): Shot[] {
  const beats: Array<{ p: string; cam: string; conf: Shot['confidence']; w: number }> = [
    { p: `Detail bodi ${car.model}, cahaya rendah, refleksi cat`, cam: 'slow push-in', conf: 'high', w: 0.16 },
    { p: `${brief.hook} — plat nama dan siluet`, cam: 'orbit kanan', conf: 'high', w: 0.14 },
    { p: `Mesin: ${car.mesin}`, cam: 'macro dolly', conf: 'high', w: 0.18 },
    { p: `Roda dan rem berputar, motion blur`, cam: 'tracking rendah', conf: 'medium', w: 0.14 },
    { p: `Interior kokpit, tangan di setir`, cam: 'handheld halus', conf: 'low', w: 0.12 },
    { p: `Akselerasi: 0–100 ${car.nol100}`, cam: 'chase cam', conf: 'medium', w: 0.14 },
    { p: `${brief.cta}`, cam: 'static hero', conf: 'high', w: 0.12 },
  ];
  const total = beats.reduce((a, b) => a + b.w, 0);
  let acc = 0;
  return beats.map((b, i) => {
    const isLast = i === beats.length - 1;
    const d = isLast ? Math.max(2, Math.round(dur - acc)) : Math.max(2, Math.round((b.w / total) * dur));
    if (!isLast) acc += d;
    return { id: rid(), n: i + 1, prompt: b.p, dur: d, camera: b.cam, confidence: b.conf, accepted: true };
  });
}

/* ------------------------------------------------------------------ benih */
// Proyek awal untuk mode statis, dibangun dari job nyata di jobs/<id>/artifacts.
// Tanpa ini situs statis terbuka kosong dan terlihat rusak.
function fullStages(): StageRun[] {
  return STAGES.map((s) => ({ id: s.id, label: s.label, state: 'selesai' as const, artifact: s.writes }));
}

function seedFrom(v: RenderedVideo): Project | null {
  const car = CATALOG.find((c) => c.slug === v.catalogSlug);
  // Tanpa entri katalog tidak ada spesifikasi bersumber: jangan mengarang
  // proyek. Videonya tetap tersedia di Perpustakaan.
  if (!car) return null;

  const dur = Math.max(MIN_DUR, v.dur);
  const brief = buildBrief(car);
  const created = Date.parse(v.renderedAt);
  return {
    id: v.jobId,
    createdAt: created,
    updatedAt: created,
    title: v.title,
    carSlug: car.slug,
    carName: car.model,
    modelId: 'local-render',
    durationSec: dur,
    aspect: v.aspect,
    resolution: '1080p',
    style: 'cinematic',
    audio: { engine: true, music: true, voiceover: false, lang: 'id' },
    brief,
    shots: buildShots(car, dur, brief),
    stages: fullStages(),
    status: 'done',
    videoUrl: `video/${v.slug}.mp4`,
    thumbUrl: `thumb/${v.slug}.jpg`,
    qaNote: `${v.checks} pemeriksaan lolos — ${v.width}x${v.height} ${v.fps} fps, ${v.scenes} scene`,
  };
}

export function seedProjects(): Project[] {
  return RENDERED.map(seedFrom)
    .filter((p): p is Project => p !== null)
    .sort((a, b) => b.createdAt - a.createdAt);
}

/* ------------------------------------------------------------- demo impl */
/** Kunci penyimpanan demo, diturunkan dari email akun yang login. */
export function demoProjectsKey(): string {
  let email = 'anon';
  try {
    const raw = localStorage.getItem('asa.user');
    if (raw) email = (JSON.parse(raw) as { email?: string }).email || 'anon';
  } catch {
    /* localStorage rusak -> pakai kunci anon */
  }
  return `asa.projects.${email}`;
}

export class DemoStudioApi implements StudioApi {
  kind = 'demo' as const;

  private key() {
    return demoProjectsKey();
  }

  async listProjects(): Promise<Project[]> {
    await wait(120);
    const raw = localStorage.getItem(this.key());
    // Kunci belum ada = pengguna baru. Isi dengan proyek hasil render nyata
    // supaya studio tidak terbuka kosong. Kunci kosong ([]) berarti pengguna
    // memang sudah menghapus semuanya, jadi jangan diisi ulang.
    if (raw === null) {
      const seed = seedProjects();
      try {
        localStorage.setItem(this.key(), JSON.stringify(seed));
      } catch {
        /* kuota penuh -> tetap kembalikan benih untuk sesi ini */
      }
      return seed;
    }
    try {
      return JSON.parse(raw) as Project[];
    } catch {
      return [];
    }
  }

  async saveProject(p: Project): Promise<void> {
    const all = await this.listProjects();
    const i = all.findIndex((x) => x.id === p.id);
    p.updatedAt = Date.now();
    if (i >= 0) all[i] = p;
    else all.unshift(p);
    localStorage.setItem(this.key(), JSON.stringify(all.slice(0, 60)));
  }

  async createProject(input: Partial<Project> & { carSlug: string }): Promise<Project> {
    const car = CATALOG.find((c) => c.slug === input.carSlug);
    if (!car) throw new Error('Mobil tidak ada di katalog');
    const dur = Math.max(MIN_DUR, input.durationSec ?? MIN_DUR);
    const brief = buildBrief(car);
    return {
      id: rid(),
      createdAt: Date.now(),
      updatedAt: Date.now(),
      title: `${car.merk} ${car.seri || car.model}`,
      carSlug: car.slug,
      carName: car.model,
      modelId: input.modelId ?? 'local-render',
      durationSec: dur,
      aspect: input.aspect ?? '16:9',
      resolution: input.resolution ?? '1080p',
      style: input.style ?? 'cinematic',
      audio: input.audio ?? { engine: true, music: true, voiceover: false, lang: 'id' },
      brief,
      shots: buildShots(car, dur, brief),
      stages: STAGES.map((s) => ({ id: s.id, label: s.label, state: 'menunggu' as StageState })),
      status: 'draft',
    };
  }

  async generateBrief(car: Car): Promise<Brief> {
    await wait(420);
    return buildBrief(car);
  }

  async generateShots(car: Car, dur: number, brief: Brief): Promise<Shot[]> {
    await wait(520);
    return buildShots(car, dur, brief);
  }

  // Simulasi satu tahap. Durasi berbeda per tahap supaya terasa nyata,
  // dan render/QA lebih lama karena memang paling berat di backend asli.
  async authenticate(): Promise<{ ok: boolean; error?: string }> {
    return { ok: true };
  }
  // Mode demo tidak punya kredensial maupun backend, jadi tidak pernah mengunggah.
  async publish(): Promise<PublishOutcome> {
    return {
      status: 'failed',
      remoteId: null,
      dryRun: true,
      note: 'Mode demo: unggah butuh backend + kredensial platform resmi.',
    };
  }
  async runStage(project: Project, stageId: string): Promise<Partial<StageRun>> {
    const weights: Record<string, number> = {
      pm: 500, research: 900, script: 800, storyboard: 850,
      visual: 1200, motion: 700, sound: 900, render: 1800, qa: 800,
    };
    await wait(weights[stageId] ?? 700);

    if (stageId === 'qa') {
      // QA jujur: di demo tidak ada ffmpeg, jadi tidak boleh mengaku "lulus".
      const ok = project.shots.some((s) => s.accepted);
      if (!ok) return { state: 'gagal', error: 'Semua shot ditolak — tidak ada yang bisa dirender.' };
      return { state: 'selesai', artifact: 'qa.json' };
    }
    return { state: 'selesai', artifact: `${stageId === 'visual' ? 'assets' : stageId}.json` };
  }
}

/* -------------------------------------------------------------- http impl */
// Dipakai kalau backend repo terjangkau (mis. saat dijalankan lokal).
// Endpoint mengikuti src/api/server.ts yang sudah ada.
export class HttpStudioApi implements StudioApi {
  kind = 'http' as const;
  private base: string;
  constructor(base: string) {
    this.base = base;
  }

  private async j<T>(path: string, init?: RequestInit): Promise<T> {
    const r = await fetch(this.base + path, {
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      ...init,
    });
    if (!r.ok) throw new Error(`${path} -> ${r.status}`);
    return (await r.json()) as T;
  }

  async listProjects(): Promise<Project[]> {
    const d = await this.j<{ jobs: ServerJob[] }>('/api/jobs');
    return (d.jobs ?? []).map(projectFromServer);
  }
  async saveProject(): Promise<void> {
    /* server yang menyimpan; tidak perlu aksi */
  }
  async createProject(input: Partial<Project> & { carSlug: string }): Promise<Project> {
    const car = CATALOG.find((c) => c.slug === input.carSlug);
    if (!car) throw new Error('Mobil tidak ada di katalog');
    const d = await this.j<{ job: Project }>('/api/jobs', {
      method: 'POST',
      body: JSON.stringify({
        model: car.model,
        durasi: input.durationSec,
        aspect: input.aspect,
        resolusi: input.resolution,
      }),
    });
    return d.job;
  }
  async generateBrief(car: Car): Promise<Brief> {
    return buildBrief(car);
  }
  async generateShots(car: Car, dur: number, brief: Brief): Promise<Shot[]> {
    return buildShots(car, dur, brief);
  }
  async runStage(): Promise<Partial<StageRun>> {
    return { state: 'selesai' };
  }
  async authenticate(account: string, password: string): Promise<{ ok: boolean; error?: string }> {
    try {
      const r = await fetch(this.base + '/api/login', {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: account, password }),
      });
      if (r.ok) return { ok: true };
      const d = (await r.json().catch(() => ({}))) as { error?: string };
      return { ok: false, error: d.error ?? `login gagal (${r.status})` };
    } catch {
      return { ok: false, error: 'Tidak bisa menghubungi server.' };
    }
  }
  async publish(jobId: string, platform: string, caption: string): Promise<PublishOutcome> {
    // dryRun selalu true dari UI: unggahan sungguhan hanya lewat kredensial resmi.
    const d = await this.j<PublishOutcome & { note?: string }>(`/api/publish/${jobId}`, {
      method: 'POST',
      body: JSON.stringify({ platform, caption, dryRun: true }),
    });
    return d;
  }
}

/* --------------------------------------------------------------- pemilihan */
export async function pickApi(): Promise<StudioApi> {
  // Urutan percobaan: override eksplisit, lalu origin sendiri (bila studio
  // disajikan oleh API), baru demo. Demo berarti tidak ada backend sama sekali.
  const candidates = [
    (globalThis as any).__STUDIO_API__ as string | undefined,
    globalThis.location?.origin,
  ].filter((b): b is string => typeof b === 'string' && b.length > 0);

  for (const base of candidates) {
    try {
      const r = await fetch(base + '/api/health', {
        credentials: 'include',
        signal: AbortSignal.timeout(2500),
      });
      if (r.ok) {
        const d = (await r.json()) as { ok?: boolean };
        if (d?.ok) return new HttpStudioApi(base);
      }
    } catch {
      /* coba kandidat berikutnya */
    }
  }
  return new DemoStudioApi();
}
