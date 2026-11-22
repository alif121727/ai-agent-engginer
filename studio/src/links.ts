// Sumber tunggal alamat studio. Tautan ini juga dicetak di UI (Pengaturan)
// dan di netlify-site/tautan.html supaya tidak hilang saat build ulang atau
// saat seseorang membagikan hasil deploy.
export const LINKS = {
  /** Studio dengan backend nyata: render ffmpeg, worker, dan QA sungguhan. */
  studio: 'https://work-1-lxpwikokempxmoli.prod-runtime.all-hands.dev',
  /** Salinan statis di GitHub Pages; aman dibuka tanpa backend. */
  pages: 'https://alif121727.github.io/ai-agent-engginer/',
  /** Deploy Netlify dari repo yang sama. */
  netlify: 'https://agent-studio-ai.netlify.app',
  /** Kode sumber. */
  repo: 'https://github.com/alif121727/ai-agent-engginer',
} as const;

export type LinkKey = keyof typeof LINKS;
