// Pembuat metadata unggahan: judul, caption, hashtag, dan spesifikasi thumbnail.
// Semua teks diturunkan dari data katalog nyata — tidak ada angka karangan.
// Batas panjang mengikuti batas resmi tiap platform.

import { carName, type Car } from '../data/catalog.ts';

/** Hanya dua field ini yang dipakai untuk metadata & nama berkas. */
export type UploadTarget = { carSlug: string; aspect: '16:9' | '9:16' | '1:1' };

export type Platform = 'tiktok' | 'instagram' | 'youtube';

export const PLATFORM_LIMITS = {
  tiktok: { caption: 2200, title: 100, hashtags: 30 },
  instagram: { caption: 2200, title: 100, hashtags: 30 },
  youtube: { caption: 5000, title: 100, hashtags: 15 },
} as const;

export type Metadata = {
  platform: Platform;
  title: string;
  caption: string;
  hashtags: string[];
  thumbnail: { headline: string; subline: string; focus: 'front' | 'detail' | 'rear' };
};

const KATEGORI_TAG: Record<string, string> = {
  sport: 'supercar',
  klasik: 'classiccar',
  balap: 'motorsport',
  modifikasi: 'tuning',
};

const BASE_TAGS = ['otomotif', 'automotive', 'carsofinstagram'];

function slugTag(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]/g, '');
}

function tidyTags(tags: string[], platform: Platform): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of tags) {
    const clean = slugTag(t);
    if (!clean || seen.has(clean)) continue;
    seen.add(clean);
    out.push(clean);
    if (out.length >= PLATFORM_LIMITS[platform].hashtags) break;
  }
  return out;
}

/** Potong di batas kata supaya kalimat tidak terputus di tengah. */
function clamp(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const lastSpace = cut.lastIndexOf(' ');
  return (lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd() + '…';
}

export function buildMetadata(car: Car, project: UploadTarget, platform: Platform): Metadata {
  const limit = PLATFORM_LIMITS[platform];
  const title = clamp(`${carName(car)} — ${car.tenaga}`, limit.title);

  const lines = [
    `${carName(car)} (${car.tahun})`,
    '',
    `${car.mesin}. ${car.tenaga}, torsi ${car.torsi}.`,
    `0–100 km/jam ${car.nol100}, top speed ${car.vmax}.`,
    '',
    car.tagline,
    '',
    'Spesifikasi: Wikipedia.',
  ];

  const tags = tidyTags(
    [car.merk, car.model, KATEGORI_TAG[car.kategori] ?? '', ...BASE_TAGS],
    platform,
  );

  const caption = clamp(`${lines.join('\n')}\n\n${tags.map((t) => `#${t}`).join(' ')}`, limit.caption);

  return {
    platform,
    title,
    caption,
    hashtags: tags,
    thumbnail: {
      headline: carName(car).toUpperCase(),
      subline: `${car.tenaga} · ${car.torsi}`,
      focus: project.aspect === '9:16' ? 'front' : 'detail',
    },
  };
}

export function uploadFileName(project: UploadTarget, platform: Platform): string {
  const base = `${project.carSlug}-${project.aspect.replace(':', 'x')}-${platform}`;
  return `${slugTag(base) || 'video'}.mp4`;
}

export const REQUIRES: Record<Platform, string> = {
  tiktok: 'Butuh TikTok Content Posting API + app review (scope video.publish).',
  instagram: 'Butuh Instagram Business/Creator + Meta App Review (instagram_content_publish).',
  youtube: 'Butuh Google OAuth + YouTube Data API v3 (youtube.upload), kuota 10.000 unit/hari.',
};

/** Platform yang benar-benar punya adaptor publish di backend repo ini. */
export const PLATFORMS_WITH_ADAPTOR: Platform[] = ['instagram'];

export const PLATFORM_LABEL: Record<Platform, string> = {
  tiktok: 'TikTok',
  instagram: 'Instagram',
  youtube: 'YouTube',
};

export type PublishPlan = {
  platform: Platform;
  ready: boolean;
  blockedBy: string | null;
  metadata: Metadata;
};

/**
 * Rencana unggah per platform. `ready` hanya benar bila kredensial resmi ada.
 * Studio tidak pernah mengaku bisa memposting tanpa izin platform.
 */
export function planPublish(
  car: Car,
  project: UploadTarget,
  connected: Record<Platform, boolean>,
): PublishPlan[] {
  return (['tiktok', 'instagram', 'youtube'] as Platform[]).map((platform) => ({
    platform,
    ready: connected[platform] === true,
    blockedBy: connected[platform] ? null : REQUIRES[platform],
    metadata: buildMetadata(car, project, platform),
  }));
}
