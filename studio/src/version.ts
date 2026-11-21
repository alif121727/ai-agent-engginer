// Nilai `__APP_VERSION__` disuntik esbuild dari package.json (lihat `define`
// di scripts/build-studio.ts). Cadangan 'dev' menjaga skrip/typecheck tetap
// jalan tanpa build penuh.
declare const __APP_VERSION__: string;

export const APP_VERSION: string = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : 'dev';
