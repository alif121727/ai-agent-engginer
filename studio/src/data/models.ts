// Model video AI + tahapan pipeline. Semua nilai tahap diambil dari
// config/agents.json (sumber kebenaran), bukan dikarang di UI.

export type VideoModel = {
  id: string;
  name: string;
  vendor: string;
  strength: string;
  detail: string;
  best: string;
  speed: 'cepat' | 'sedang' | 'lambat';
  maxDur: number;
  /** true bila bisa dipakai tanpa kredensial tambahan (render lokal). */
  ready: boolean;
  /** Adapter backend yang menjalankan model ini; kosong = render lokal. */
  provider?: 'runway' | 'kling';
};

// Katalog model video. `ready: false` = belum ada kredensial/adaptor,
// jadi UI harus menandainya jelas, bukan pura-pura bisa dipakai.
export const VIDEO_MODELS: VideoModel[] = [
  {
    id: 'local-render',
    name: 'Studio Render (lokal)',
    vendor: 'Mesin repo ini',
    strength: 'Satu-satunya yang benar-benar jalan di sini',
    detail:
      'Pipeline 9 tahap repo ini: riset, naskah, storyboard, aset visual, motion, audio, render ffmpeg, lalu QA. Memakai foto asli yang Anda unggah dan katalog spesifikasi nyata.',
    best: 'Video otomotif berbasis data, tanpa mengarang spesifikasi',
    speed: 'sedang',
    maxDur: 180,
    ready: true,
  },
  {
    id: 'veo-3.1',
    name: 'Veo 3.1',
    vendor: 'Google DeepMind',
    strength: 'Kualitas sinematik, gerakan kamera halus',
    detail:
      'Model teks-ke-video dengan pemahaman fisika dan pencahayaan kuat. Cocok untuk hero shot dan transisi sinematik. Butuh kunci API Google.',
    best: 'Hero shot, iklan sinematik',
    speed: 'lambat',
    maxDur: 8,
    ready: false,
    provider: 'runway',
  },
  {
    id: 'kling-3.0',
    name: 'Kling 3.0',
    vendor: 'Kuaishou',
    strength: 'Kontrol gerakan level 3D, konsistensi subjek',
    detail:
      'Unggul menjaga bentuk mobil tetap konsisten antar-shot dan mendukung kontrol kamera eksplisit. Butuh kunci API Kuaishou.',
    best: 'B-roll konsisten, orbit kendaraan',
    speed: 'sedang',
    maxDur: 10,
    ready: false,
    provider: 'kling',
  },
  {
    id: 'seedance-2.0',
    name: 'Seedance 2.0',
    vendor: 'ByteDance',
    strength: 'Cepat dan murah, banyak rasio sekaligus',
    detail:
      'Cocok untuk produksi massal konten sosial media. Mendukung 16:9, 9:16, dan 1:1 dalam satu permintaan. Butuh kunci API ByteDance.',
    best: 'Reels/TikTok bervolume tinggi',
    speed: 'cepat',
    maxDur: 12,
    ready: false,
    provider: 'runway',
  },
  {
    id: 'runway-gen4',
    name: 'Runway Gen-4',
    vendor: 'Runway',
    strength: 'Paling kreatif untuk gaya eksperimental',
    detail:
      'Kuat untuk look non-realistis, animasi stylized, dan transisi artistik. Butuh kunci API Runway.',
    best: 'Kampanye stylized, motion graphic',
    speed: 'sedang',
    maxDur: 10,
    ready: false,
    provider: 'runway',
  },
];

// Urutan & artefak 9 tahap — cermin dari config/agents.json.
export type StageDef = { id: string; label: string; writes: string; desc: string };

export const STAGES: StageDef[] = [
  { id: 'pm', label: 'Rencana', writes: 'plan.json', desc: 'Menyusun rencana produksi dan anggaran waktu' },
  { id: 'research', label: 'Riset', writes: 'research.json', desc: 'Mengumpulkan spesifikasi nyata dari katalog/Wikipedia' },
  { id: 'script', label: 'Naskah', writes: 'script.json', desc: 'Menulis naskah 5-beat dengan durasi tiap babak' },
  { id: 'storyboard', label: 'Storyboard', writes: 'storyboard.json', desc: 'Memecah naskah jadi shot + gerakan kamera' },
  { id: 'visual', label: 'Aset Visual', writes: 'assets.json', desc: 'Memilih foto asli per scene, menolak yang buram' },
  { id: 'motion', label: 'Motion', writes: 'motion.json', desc: 'Menentukan Ken Burns, transisi, dan tempo' },
  { id: 'sound', label: 'Audio', writes: 'audio.json', desc: 'Menyintesis suara mesin + musik latar' },
  { id: 'render', label: 'Render', writes: 'render.json', desc: 'Merender mp4 dengan ffmpeg' },
  { id: 'qa', label: 'QA', writes: 'qa.json', desc: 'Menolak video gelap, beku, atau tanpa audio' },
];

export const MIN_DUR = 30; // batas keras repo: config/defaults.json minDurasi
export const MAX_DUR = 180;
