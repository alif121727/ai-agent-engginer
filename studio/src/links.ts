// Sumber tunggal alamat studio. Tautan ini juga dicetak di UI (Pengaturan)
// dan di netlify-site/tautan.html supaya tidak hilang saat build ulang atau
// saat seseorang membagikan hasil deploy.
//
// Backend produksi sekarang berjalan di Fly.io (`fly.toml`, app
// `ai-agent-engginer`). Alamat masih bisa ditimpa saat build:
// `STUDIO_URL=https://... npm run build:studio`, dan pengguna tetap bisa
// menggantinya di Pengaturan (tersimpan di localStorage).
declare const __STUDIO_URL__: string | undefined;

const fromBuild = typeof __STUDIO_URL__ === 'string' && __STUDIO_URL__ ? __STUDIO_URL__ : '';

export const LINKS = {
  /** Studio dengan backend nyata: render ffmpeg, worker, dan QA sungguhan. */
  studio: fromBuild || 'https://ai-agent-engginer.fly.dev',
  /** Salinan statis di GitHub Pages; aman dibuka tanpa backend. */
  pages: 'https://alif121727.github.io/ai-agent-engginer/',
  /** Deploy Netlify dari repo yang sama. */
  netlify: 'https://agent-studio-ai.netlify.app',
  /** Kode sumber. */
  repo: 'https://github.com/alif121727/ai-agent-engginer',
} as const;

export type LinkKey = keyof typeof LINKS;
