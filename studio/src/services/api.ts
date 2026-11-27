// Lapisan service. Satu antarmuka, dua implementasi:
//  - HttpStudioApi  -> memakai backend repo (Express + worker + ffmpeg) bila terjangkau
//  - DemoStudioApi  -> simulasi lokal (localStorage) supaya studio tetap bisa
//                      dipakai/dinilai saat di-deploy statis (Netlify).
// Pemanggil tidak perlu tahu mana yang aktif.

import { CATALOG, carName, findCar, type Car } from '../data/catalog.ts';
import { STAGES, MIN_DUR } from '../data/models.ts';
import { RENDERED, type RenderedVideo } from '../data/rendered.ts';
import { findResearched, listResearched } from '../data/researched.ts';

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
  /** Nada suara narasi; kosong berarti dipilih otomatis dari model mobil. */
  suaraTone?: 'energik' | 'sinematik' | 'hangat' | 'tegas';
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
  /** Dikirim /api/jobs dan /api/jobs/:id; nama tahap mengikuti server. */
  stages?: { name: string; status: string; error?: string | null }[];
};

/**
 * Judul proyek selalu diturunkan dari mobilnya. Ini juga menyembuhkan proyek
 * lama yang tersimpan dengan judul keliru ("Bugatti Bugatti Chiron").
 */
function projectTitle(carSlug: string, fallback: string): string {
  const car = resolveCar(carSlug);
  if (car) return carName(car);
  const words = fallback.trim().split(/\s+/);
  if (words.length > 1 && words[0].toLowerCase() === words[1].toLowerCase()) {
    return words.slice(1).join(' ');
  }
  return fallback;
}

/**
 * Cari mobil berdasarkan slug, termasuk model hasil riset web yang tidak ada
 * di katalog statis. Tanpa ini, proyek dari hasil riset gagal dibuat dengan
 * pesan "Mobil tidak ada di katalog".
 */
export function resolveCar(slug: string): Car | undefined {
  return CATALOG.find((c) => c.slug === slug) ?? findResearched(slug)?.car;
}

const ASPECTS = ['16:9', '9:16', '1:1'] as const;

export function projectFromServer(j: ServerJob, base = '', mediaToken = ''): Project {
  const slug = j.brief_slug ?? '';
  const car = findCar(slug, j.model) ?? findResearched(slug)?.car ?? findResearched(j.model)?.car;
  const created = j.created_at ? Date.parse(j.created_at) : NaN;
  // 'queued' berarti worker sudah menerima tugas: tampilkan sebagai berjalan,
  // bukan draf, supaya pengguna tahu pekerjaannya sedang dikerjakan.
  const status =
    j.status === 'done'
      ? 'done'
      : j.status === 'failed'
        ? 'failed'
        : j.status === 'queued' || j.status === 'running'
          ? 'running'
          : 'draft';
  const byName = new Map((j.stages ?? []).map((s) => [s.name, s.status]));
  const stageState = (id: string, i: number): StageRun['state'] => {
    const st = byName.get(SERVER_STAGE[id] ?? id);
    if (st === 'done') return 'selesai';
    if (st === 'skipped') return 'dilewati';
    if (st === 'failed') return 'gagal';
    if (st === 'running') return 'berjalan';
    // Tanpa data tahap dari server (mis. job lama), pakai status job saja.
    if (j.stages?.length) return 'menunggu';
    if (status === 'done') return 'selesai';
    return status === 'running' && i === 0 ? 'berjalan' : 'menunggu';
  };
  return {
    id: j.id,
    createdAt: Number.isFinite(created) ? created : Date.now(),
    updatedAt: Number.isFinite(created) ? created : Date.now(),
    title: projectTitle(slug || j.model || '', j.title ?? j.model ?? 'Tanpa judul'),
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
      state: stageState(s.id, i),
      ms: 0,
    })),
    status,
    qaNote: j.error ?? undefined,
    // Hanya job yang benar-benar selesai punya mp4. Tanpa ini pemutar di
    // halaman detail tidak muncul walau file ada di disk.
    // URL absolut ke backend: halaman statis di Netlify/Pages harus memutar
    // mp4 dari server render, bukan dari domain statis yang tidak punya file.
    videoUrl: status === 'done' ? `${base}/api/jobs/${j.id}/file/video.mp4${mediaToken}` : undefined,
    thumbUrl: status === 'done' ? `${base}/api/jobs/${j.id}/file/preview.jpg${mediaToken}` : undefined,
  };
}

export type PublishOutcome = {
  status: 'dry_run' | 'published' | 'duplicate' | 'failed';
  remoteId: string | null;
  dryRun: boolean;
  note?: string;
};

/** Satu baris log job dari server (`/api/jobs/:id/events`). */
export type JobEvent = {
  level: string;
  scope: string;
  agent_id?: string | null;
  message: string;
  created_at: string;
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
  /** Membuat akun baru di server. Mode demo cukup menyimpan sesi lokal. */
  register(name: string, email: string, password: string): Promise<{ ok: boolean; error?: string }>;
  /** Melupakan sesi; server menghapus cookie-nya. */
  logout(): Promise<void>;
  /** Sesi yang masih berlaku menurut server, bukan menurut localStorage. */
  currentUser(): Promise<{ email: string; name: string } | null>;
  /** true bila server belum punya akun sama sekali (pendaftaran masih terbuka). */
  needsSetup(): Promise<boolean>;
  /**
   * Kesiapan model video menurut kredensial di server. Mode demo menjawab
   * `null`: tidak ada backend, jadi tidak ada yang bisa dijanjikan.
   */
  modelReadiness(): Promise<Readiness | null>;
  /** Jejak peristiwa job (log agen). Mode demo tidak punya worker: kosong. */
  getEvents(jobId: string, limit?: number): Promise<JobEvent[]>;
  /** Artefak JSON hasil satu tahap (`script.json`, `qa.json`, ...). */
  getArtifact<T = unknown>(jobId: string, name: string): Promise<T | null>;
};

/** Kesiapan satu vendor: `ready` false berarti render akan ditolak vendor. */
export type ProviderState = { keyed: boolean; credits?: number; ready: boolean; note?: string };
export type Readiness = { providers: Record<string, ProviderState>; local: boolean };

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const rid = () => Math.random().toString(36).slice(2, 10);

/* ------------------------------------------------------------------ brief */
// 5-beat yang benar-benar memakai angka dari katalog — tidak mengarang.
/** Gabungkan bagian kalimat, lewati yang kosong supaya tidak ada "top speed ." */
function rangkai(bagian: Array<string | undefined>, kosong: string): string {
  const isi = bagian.filter((b): b is string => Boolean(b && b.trim()));
  return isi.length ? isi.join(', ') : kosong;
}

export function buildBrief(car: Car): Brief {
  const tenaga = car.tenaga || 'tenaga belum tercatat';
  const nol = car.nol100 ? `0–100 ${car.nol100}` : 'angka akselerasi belum tercatat';
  const vmax = car.vmax ? `top speed ${car.vmax}` : undefined;
  return {
    hook: `${car.model}: ${car.tagline || 'satu mesin, satu karakter.'}`,
    problem: `Banyak konten otomotif menyebut angka tanpa sumber. ${car.model} sering dibahas dengan klaim yang tidak bisa dilacak.`,
    product: rangkai([car.mesin, tenaga, car.torsi && `torsi ${car.torsi}`, car.layout && `layout ${car.layout}`], 'Spesifikasi belum tersedia.'),
    proof: `${rangkai([nol, vmax], 'Angka performa belum tercatat')}. ${car.berat ? `Berat ${car.berat}. ` : ''}Sumber: Wikipedia (lihat lembar riset).`,
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
    { p: car.nol100 ? `Akselerasi: 0–100 ${car.nol100}` : 'Akselerasi: tarikan mesin', cam: 'chase cam', conf: 'medium', w: 0.14 },
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
  // Video render-3d dibuat di luar pipeline job, jadi tidak punya tahap,
  // artefak, atau QA. Membuatkannya proyek akan mengarang riwayat kerja.
  if (v.qa === 'render-3d') return null;

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
function demoEmail(): string {
  try {
    const raw = localStorage.getItem('asa.user');
    if (raw) return (JSON.parse(raw) as { email?: string }).email || 'anon';
  } catch {
    /* localStorage rusak -> pakai kunci anon */
  }
  return 'anon';
}

/** Kunci penyimpanan demo, diturunkan dari email akun yang login. */
export function demoProjectsKey(): string {
  return `asa.projects.${demoEmail()}`;
}

/**
 * Naikkan angka ini setiap kali data benih berubah (judul, tanggal, durasi).
 * Tanpa versi, pengunjung yang sudah pernah membuka situs menyimpan benih lama
 * selamanya dan perbaikan data tidak pernah sampai ke mereka.
 */
export const SEED_VERSION = 2;

const seedVersionKey = () => `asa.seedVersion.${demoEmail()}`;
const deletedKey = () => `asa.deleted.${demoEmail()}`;

/** Id proyek yang berasal dari benih, dipakai membedakan dari proyek buatan pengguna. */
const seedIds = () => new Set(RENDERED.map((v) => v.jobId));

export function deletedSeeds(): string[] {
  try {
    return JSON.parse(localStorage.getItem(deletedKey()) || '[]') as string[];
  } catch {
    return [];
  }
}

export function rememberDeletion(id: string) {
  if (!seedIds().has(id)) return;
  const next = Array.from(new Set([...deletedSeeds(), id]));
  try {
    localStorage.setItem(deletedKey(), JSON.stringify(next));
  } catch {
    /* kuota penuh -> proyek bisa muncul lagi setelah versi benih berubah */
  }
}

export class DemoStudioApi implements StudioApi {
  kind = 'demo' as const;

  private key() {
    return demoProjectsKey();
  }

  /**
   * Projects made before signing in are stored under the `anon` key, so they
   * disappeared the moment a visitor logged in. Moving them across keeps the
   * work a visitor already did instead of silently hiding it.
   */
  private adoptAnonymous(): void {
    const own = demoProjectsKey();
    const anonKey = 'asa.projects.anon';
    if (own === anonKey) return;
    let anon: Project[] = [];
    try {
      anon = JSON.parse(localStorage.getItem(anonKey) || '[]') as Project[];
    } catch {
      return;
    }
    if (!anon.length) return;
    let mine: Project[] = [];
    try {
      mine = JSON.parse(localStorage.getItem(own) || '[]') as Project[];
    } catch {
      mine = [];
    }
    const known = new Set(mine.map((p) => p.id));
    const merged = [...mine, ...anon.filter((p) => !known.has(p.id))].sort(
      (a, b) => b.createdAt - a.createdAt,
    );
    try {
      localStorage.setItem(own, JSON.stringify(merged.slice(0, 60)));
      localStorage.removeItem(anonKey);
    } catch {
      /* kuota penuh -> biarkan, refresh berikutnya mencoba lagi */
    }
  }

  async listProjects(): Promise<Project[]> {
    this.adoptAnonymous();
    await wait(120);
    const raw = localStorage.getItem(this.key());
    const deleted = new Set(deletedSeeds());

    // Pengguna baru: isi dengan proyek hasil render nyata supaya studio tidak
    // terbuka kosong.
    if (raw === null) {
      const seed = seedProjects().filter((p) => !deleted.has(p.id));
      this.persist(seed);
      return seed;
    }

    let stored: Project[] = [];
    try {
      stored = JSON.parse(raw) as Project[];
    } catch {
      stored = [];
    }

    // Versi benih lama: segarkan entri benih, pertahankan proyek buatan
    // pengguna dan proyek benih yang sudah dia hapus.
    if (localStorage.getItem(seedVersionKey()) !== String(SEED_VERSION)) {
      const ids = seedIds();
      const own = stored.filter((p) => !ids.has(p.id));
      const fresh = seedProjects().filter((p) => !deleted.has(p.id));
      const merged = [...own, ...fresh].sort((a, b) => b.createdAt - a.createdAt);
      this.persist(merged);
      return merged;
    }

    return stored.map((p) => ({ ...p, title: projectTitle(p.carSlug, p.title) }));
  }

  private persist(list: Project[]) {
    try {
      localStorage.setItem(this.key(), JSON.stringify(list.slice(0, 60)));
      localStorage.setItem(seedVersionKey(), String(SEED_VERSION));
    } catch {
      /* kuota penuh -> data hanya berlaku untuk sesi ini */
    }
  }

  async saveProject(p: Project): Promise<void> {
    const all = await this.listProjects();
    const i = all.findIndex((x) => x.id === p.id);
    p.updatedAt = Date.now();
    if (i >= 0) all[i] = p;
    else all.unshift(p);
    this.persist(all);
  }

  async createProject(input: Partial<Project> & { carSlug: string }): Promise<Project> {
    const car = resolveCar(input.carSlug);
    if (!car) throw new Error('Mobil tidak ada di katalog');
    const dur = Math.max(MIN_DUR, input.durationSec ?? MIN_DUR);
    const brief = buildBrief(car);
    return {
      id: rid(),
      createdAt: Date.now(),
      updatedAt: Date.now(),
      title: carName(car),
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
  async register(): Promise<{ ok: boolean; error?: string }> {
    return { ok: true };
  }
  async logout(): Promise<void> {
    /* mode demo tidak punya sesi server */
  }
  async currentUser(): Promise<{ email: string; name: string } | null> {
    return null;
  }
  async needsSetup(): Promise<boolean> {
    return false;
  }
  // Tanpa backend tidak ada kredensial yang bisa dilaporkan.
  async modelReadiness(): Promise<Readiness | null> {
    return null;
  }
  // Mode demo tidak punya kredensial maupun backend, jadi tidak pernah mengunggah.
  async getEvents(): Promise<JobEvent[]> {
    return [];
  }
  async getArtifact<T>(): Promise<T | null> {
    return null;
  }
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
/** Nama tahap di UI berbeda dari nama di server (lihat config/agents.json). */
const SERVER_STAGE: Record<string, string> = {
  pm: 'rencana',
  research: 'riset',
  script: 'naskah',
  storyboard: 'storyboard',
  visual: 'aset-visual',
  motion: 'motion',
  sound: 'audio',
  render: 'render',
  qa: 'qa',
};

export class HttpStudioApi implements StudioApi {
  kind = 'http' as const;
  private base: string;
  constructor(base: string) {
    this.base = base;
  }

  // Sesi lintas situs tidak bisa bergantung pada cookie: Chrome/Safari
  // memblokir cookie pihak ketiga. Token dari /api/login disimpan di
  // localStorage dan dikirim sebagai Bearer.
  private static tokenKey = 'studio_token';
  private static token(): string {
    try {
      return localStorage.getItem(HttpStudioApi.tokenKey) ?? '';
    } catch {
      return '';
    }
  }
  private static setToken(token: string): void {
    try {
      if (token) localStorage.setItem(HttpStudioApi.tokenKey, token);
      else localStorage.removeItem(HttpStudioApi.tokenKey);
    } catch {
      /* mode privat: jatuh ke cookie */
    }
  }
  // <video>/<img> tidak bisa mengirim header, jadi token ikut di URL media.
  private mediaQuery(): string {
    const t = HttpStudioApi.token();
    return t ? `?token=${encodeURIComponent(t)}` : '';
  }

  private authHeaders(): Record<string, string> {
    const t = HttpStudioApi.token();
    return t ? { authorization: `Bearer ${t}` } : {};
  }

  private async j<T>(path: string, init?: RequestInit): Promise<T> {
    const { headers, ...rest } = init ?? {};
    const r = await fetch(this.base + path, {
      credentials: 'include',
      ...rest,
      headers: { 'content-type': 'application/json', ...this.authHeaders(), ...(headers as Record<string, string> | undefined) },
    });
    if (!r.ok) throw new Error(`${path} -> ${r.status}`);
    return (await r.json()) as T;
  }

  async listProjects(): Promise<Project[]> {
    const d = await this.j<{ jobs: ServerJob[] }>('/api/jobs');
    return (d.jobs ?? []).map((j) => projectFromServer(j, this.base, this.mediaQuery()));
  }
  async saveProject(): Promise<void> {
    /* server yang menyimpan; tidak perlu aksi */
  }
  async createProject(input: Partial<Project> & { carSlug: string }): Promise<Project> {
    const car = resolveCar(input.carSlug);
    if (!car) throw new Error('Mobil tidak ada di katalog');
    const d = await this.j<{ job: ServerJob }>('/api/jobs', {
      method: 'POST',
      body: JSON.stringify({
        model: car.model,
        durasi: input.durationSec,
        aspect: input.aspect,
        resolusi: input.resolution,
        // Nada suara ikut dikirim; tanpa ini pilihan pengguna hilang dan
        // server memakai nada otomatis.
        ...(input.suaraTone ? { suaraTone: input.suaraTone } : {}),
        // Model yang dipilih di UI menentukan adapter vendor di worker.
        ...(input.modelId ? { modelId: input.modelId } : {}),
      }),
    });
    // Job dari server memakai nama kolom snake_case; tanpa pemetaan ini UI
    // menampilkan durasi/rasio kosong dan tahap tidak bisa dicocokkan.
    return projectFromServer(d.job, this.base, this.mediaQuery());
  }
  async generateBrief(car: Car): Promise<Brief> {
    return buildBrief(car);
  }
  async generateShots(car: Car, dur: number, brief: Brief): Promise<Shot[]> {
    return buildShots(car, dur, brief);
  }
  async runStage(project: Project, stageId: string): Promise<Partial<StageRun>> {
    // Backend menjalankan seluruh pipeline di worker, bukan per tahap dari UI.
    // Jadi UI menunggu tahap ini benar-benar 'done' di server, bukan mengaku
    // selesai sendiri: tanpa ini "Jalankan pipeline" tampak sukses padahal
    // worker belum/tidak pernah menulis video.mp4.
    const serverName = SERVER_STAGE[stageId] ?? stageId;
    const deadline = Date.now() + 10 * 60_000;
    while (Date.now() < deadline) {
      const d = await this.j<{
        job: ServerJob;
        stages: { name: string; status: string; error?: string | null }[];
      }>(`/api/jobs/${project.id}`);
      if (d.job?.status === 'failed') {
        return { state: 'gagal', error: d.job.error ?? 'job gagal di backend' };
      }
      const stage = d.stages?.find((s) => s.name === serverName);
      if (stage?.status === 'failed') {
        return { state: 'gagal', error: stage.error ?? `tahap ${serverName} gagal` };
      }
      if (stage?.status === 'done' || stage?.status === 'skipped') {
        return { state: 'selesai', artifact: stageId === 'visual' ? 'assets.json' : `${stageId}.json` };
      }
      await new Promise((r) => setTimeout(r, 1500));
    }
    return { state: 'gagal', error: `tahap ${serverName} melewati batas waktu 10 menit` };
  }
  async authenticate(account: string, password: string): Promise<{ ok: boolean; error?: string }> {
    try {
      const r = await fetch(this.base + '/api/login', {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: account, password }),
      });
      if (r.ok) {
        const d = (await r.json().catch(() => ({}))) as { token?: string };
        if (d.token) HttpStudioApi.setToken(d.token);
        return { ok: true };
      }
      const d = (await r.json().catch(() => ({}))) as { error?: string };
      return { ok: false, error: d.error ?? `login gagal (${r.status})` };
    } catch {
      return { ok: false, error: 'Tidak bisa menghubungi server.' };
    }
  }
  async register(name: string, email: string, password: string): Promise<{ ok: boolean; error?: string }> {
    try {
      const r = await fetch(this.base + '/api/setup', {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, password, username: name }),
      });
      if (r.ok) return { ok: true };
      const d = (await r.json().catch(() => ({}))) as { error?: string };
      return { ok: false, error: d.error ?? `pendaftaran gagal (${r.status})` };
    } catch {
      return { ok: false, error: 'Tidak bisa menghubungi server.' };
    }
  }
  async logout(): Promise<void> {
    try {
      await fetch(this.base + '/api/logout', {
        method: 'POST',
        credentials: 'include',
        headers: this.authHeaders(),
      });
    } catch {
      /* sesi lokal tetap dihapus pemanggil */
    }
    HttpStudioApi.setToken('');
  }
  async currentUser(): Promise<{ email: string; name: string } | null> {
    const r = await fetch(this.base + '/api/me', {
      credentials: 'include',
      headers: this.authHeaders(),
    });
    if (r.status === 401) return null;
    if (!r.ok) throw new Error(`/api/me -> ${r.status}`);
    const d = (await r.json()) as { user?: { email: string; username: string | null } | null };
    if (!d.user) return null;
    return { email: d.user.email, name: d.user.username || d.user.email.split('@')[0] };
  }
  async needsSetup(): Promise<boolean> {
    try {
      const r = await fetch(this.base + '/api/bootstrap', {
        credentials: 'include',
        headers: this.authHeaders(),
      });
      if (!r.ok) return false;
      const d = (await r.json()) as { needsSetup?: boolean };
      return d.needsSetup === true;
    } catch {
      return false;
    }
  }
  async modelReadiness(): Promise<Readiness | null> {
    try {
      const r = await fetch(this.base + '/api/visual/readiness', { credentials: 'include' });
      if (!r.ok) return null;
      const d = (await r.json()) as Partial<Readiness>;
      return { providers: d.providers ?? {}, local: d.local !== false };
    } catch {
      return null;
    }
  }
  async getEvents(jobId: string, limit = 200): Promise<JobEvent[]> {
    const d = await this.j<{ events: JobEvent[] }>(`/api/jobs/${jobId}/events?limit=${limit}`);
    return d.events ?? [];
  }
  async getArtifact<T>(jobId: string, name: string): Promise<T | null> {
    try {
      const d = await this.j<{ value: T }>(`/api/jobs/${jobId}/artifact/${encodeURIComponent(name)}`);
      return d.value ?? null;
    } catch {
      return null;
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
// Disuntik esbuild (lihat scripts/build-studio.ts); kosong saat dev.
declare const __STUDIO_URL__: string | undefined;

/**
 * Backend yang dipilih pengguna dari halaman Pengaturan. Disimpan di
 * localStorage supaya situs statis bisa diarahkan ke server mana pun tanpa
 * build ulang — ini yang membedakan "mode demo" dari "backend nyata".
 */
export const BACKEND_KEY = 'studio.backend';

export function savedBackend(): string {
  try {
    return (localStorage.getItem(BACKEND_KEY) ?? '').trim().replace(/\/$/, '');
  } catch {
    return '';
  }
}

export function saveBackend(url: string): void {
  try {
    const clean = url.trim().replace(/\/$/, '');
    if (clean) localStorage.setItem(BACKEND_KEY, clean);
    else localStorage.removeItem(BACKEND_KEY);
  } catch {
    /* mode privat: pilihan hanya berlaku untuk sesi ini */
  }
}

/** Cek satu kandidat backend; true kalau /api/health menjawab ok. */
export async function probeBackend(base: string): Promise<boolean> {
  try {
    const r = await fetch(base.replace(/\/$/, '') + '/api/health', {
      credentials: 'include',
      signal: AbortSignal.timeout(4000),
    });
    if (!r.ok) return false;
    const d = (await r.json()) as { ok?: boolean };
    return Boolean(d?.ok);
  } catch {
    return false;
  }
}

/** Hasil percobaan terakhir; UI memakainya untuk menjelaskan mode demo. */
export type BackendProbe = { base: string; ok: boolean };
let lastProbe: BackendProbe[] = [];

/**
 * Alamat yang dicoba saat pemilihan terakhir. Kosong berarti memang tidak ada
 * backend yang dikonfigurasi, bukan backend yang mati — dua hal berbeda yang
 * dulu sama-sama tampil sebagai "mode demo".
 */
export function lastProbeResults(): BackendProbe[] {
  return lastProbe;
}

export async function pickApi(): Promise<StudioApi> {
  // Urutan percobaan: backend pilihan pengguna, origin sendiri, override
  // runtime, backend yang disuntikkan saat build (STUDIO_URL), lalu demo.
  // Demo berarti tidak ada backend yang menjawab.
  //
  // Origin sendiri didahulukan karena pada deploy satu-alamat (Docker/Render)
  // UI disajikan oleh backend yang sama, jadi jawabannya instan dan selalu
  // benar. Di situs statis (Pages/Netlify) probe ini gagal cepat lalu
  // diteruskan ke alamat backend yang tersimpan/dibekukan.
  const candidates = [
    savedBackend(),
    globalThis.location?.origin,
    (globalThis as any).__STUDIO_API__ as string | undefined,
    typeof __STUDIO_URL__ === 'string' && __STUDIO_URL__ ? __STUDIO_URL__ : undefined,
  ].filter((b): b is string => typeof b === 'string' && b.length > 0);

  lastProbe = [];
  for (const base of new Set(candidates)) {
    const ok = await probeBackend(base);
    lastProbe.push({ base, ok });
    if (ok) return new HttpStudioApi(base.replace(/\/$/, ''));
  }
  return new DemoStudioApi();
}
