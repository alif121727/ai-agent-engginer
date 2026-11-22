// Sumber tunggal alamat studio. Tautan ini juga dicetak di UI (Pengaturan)
// dan di netlify-site/tautan.html supaya tidak hilang saat build ulang atau
// saat seseorang membagikan hasil deploy.
//
// Host sandbox berubah setiap sesi berjalan, jadi alamat backend bisa
// ditimpa saat build: `STUDIO_URL=https://... npm run build:studio`.
// Nilai yang di-commit hanyalah default supaya bundel tidak menunjuk ke host
// mati tanpa cara memperbaikinya tanpa mengubah kode.
declare const __STUDIO_URL__: string | undefined;

const fromBuild = typeof __STUDIO_URL__ === 'string' && __STUDIO_URL__ ? __STUDIO_URL__ : '';

export const LINKS = {
  /** Studio dengan backend nyata: render ffmpeg, worker, dan QA sungguhan. */
  studio: fromBuild || 'https://work-1-lxpwikokempxmoli.prod-runtime.all-hands.dev',
  /** Salinan statis di GitHub Pages; aman dibuka tanpa backend. */
  pages: 'https://alif121727.github.io/ai-agent-engginer/',
  /** Deploy Netlify dari repo yang sama. */
  netlify: 'https://agent-studio-ai.netlify.app',
  /** Kode sumber. */
  repo: 'https://github.com/alif121727/ai-agent-engginer',
} as const;

export type LinkKey = keyof typeof LINKS;
