// Snapshot proyek yang sudah benar-benar dirender, diekspor oleh
// scripts/export-projects.ts ke data/projects.json. Dipakai UI statis supaya
// daftar proyek berisi hasil nyata (dengan video) dan bukan benih karangan.
//
// Bila backend hidup, sumbernya tetap /api/jobs — snapshot hanya jaring
// pengaman saat backend tidak terjangkau.

export type SnapshotProject = {
  id: string;
  title: string;
  model: string;
  status: 'done' | 'failed' | 'running' | 'draft';
  durationSec: number;
  aspect: string;
  createdAt: string;
  updatedAt: string;
  hasVideo: boolean;
  videoPath: string | null;
  thumbPath: string | null;
  sizeBytes: number;
  render: { width: number; height: number; fps: number; codec: string; scenes: number; bitrateKbps: number; hasAudio: boolean } | null;
  qa: { passed: boolean; checks: number; failed: number } | null;
  specs: string[] | null;
  sceneCount: number | null;
  themeId: string | null;
  scriptTitle: string | null;
  error: string | null;
};

export type ProjectSnapshot = {
  generatedAt: string;
  total: number;
  projects: SnapshotProject[];
};

let cache: ProjectSnapshot | null = null;

export async function loadSnapshot(base = ''): Promise<ProjectSnapshot | null> {
  if (cache) return cache;
  try {
    // `no-cache` memaksa revalidasi: tanpa ini pengunjung yang pernah membuka
    // situs memakai projects.json lama dan tidak melihat proyek baru.
    const r = await fetch(`${base}data/projects.json`, { cache: 'no-cache', signal: AbortSignal.timeout(6000) });
    if (!r.ok) return null;
    const d = (await r.json()) as ProjectSnapshot;
    if (!Array.isArray(d?.projects)) return null;
    cache = d;
    return d;
  } catch {
    return null;
  }
}

export function formatBytes(n: number): string {
  if (!n) return '—';
  if (n > 1024 * 1024 * 1024) return `${(n / (1024 * 1024 * 1024)).toFixed(1)} GB`;
  return `${(n / (1024 * 1024)).toFixed(0)} MB`;
}
