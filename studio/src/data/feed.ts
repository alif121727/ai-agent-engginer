// Feed vertikal: dibaca dari feed.json yang dihasilkan scripts/build-feed.ts
// dari artefak job asli. Tidak ada judul atau angka yang diketik tangan.
import raw from './feed.json';
import { MEDIA_VERSION } from './rendered.ts';

export type FeedItem = {
  slug: string;
  jobId: string;
  title: string;
  merk: string;
  tahun: string;
  kategori: string;
  dur: number;
  width: number;
  height: number;
  scenes: number;
  templateId: string | null;
  templateName: string | null;
  themeId: string;
  qa: 'lolos' | 'gagal';
  caption: string;
  hashtags: string[];
  renderedAt: string;
};

/** Hanya video vertikal yang lolos QA yang masuk feed. */
export const FEED: FeedItem[] = (raw as FeedItem[]).filter(
  (v) => v.qa === 'lolos' && v.height > v.width,
);

/** Pemutaran feed memakai versi 720x1280 (~4 MB) supaya autoplay di seluler
 *  tidak menghabiskan kuota; unduhan tetap master 1080x1920 di feedDownloadSrc. */
export const feedVideoSrc = (v: FeedItem) => `video/web/${v.slug}.mp4?v=${MEDIA_VERSION}`;
export const feedDownloadSrc = (v: FeedItem) => `video/${v.slug}.mp4?v=${MEDIA_VERSION}`;
export const feedThumbSrc = (v: FeedItem) => `thumb/${v.slug}.jpg?v=${MEDIA_VERSION}`;
