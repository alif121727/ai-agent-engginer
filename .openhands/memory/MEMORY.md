# Project memory — AI Studio Otomotif

Repo `alif121727/ai-agent-engginer`, branch `main`. Brief otomotif -> `.mp4`
lewat 9 agen dengan meja kerja tetap. Node + `--experimental-strip-types` (server
tanpa build), Express 5, SQLite, esbuild untuk UI. Semua teks UI Bahasa Indonesia.
Detail panjang ada di `archive/MEMORY-full-2026-11-20.md` dan log harian.

## Invarian yang mudah dilanggar
- **Minimum 30 dtk** per video, dijaga `src/core/brief.ts`.
- **Tidak boleh mengarang spesifikasi**; visual hanya dari berkas nyata.
- **Tiap agen hanya menulis artefaknya sendiri** (`config/agents.json`
  `artifacts.writes`, ditegakkan `guardArtifactWrite`). Nama stage != nama
  artefak (`aset-visual` menulis `assets.json`).
- **QA adalah gerbang nyata**: tulis `qa.json` dulu, baru `PermanentError` bila
  gagal. Stage QA `done` wajib punya `qa.json`.
- **Rewind harus menghapus checkpoint** berkunci *nama stage*, kalau tidak daftar
  `done` per scene bertahan dan aset tidak pernah dibuat ulang.
- **Jangan menaruh `referenceImage` yang sudah ada di daftar kandidat**
  (`localCandidateOrder()` di `src/visuals/adapters.ts`) — rotasi foto bergeser
  satu dan QA menolak "scene terlalu mirip".

## Jebakan lingkungan (mahal dipelajari)
- **Versi ffmpeg menentukan, bukan logika.** Debian = 5.1, host = 9.0.
  `loudnorm,aresample=48000` tanpa `aformat=...:channel_layouts=stereo` gagal
  di 5.1 dan `muxAudio` mengembalikan `false` diam-diam -> video tanpa audio.
  Uji perubahan audio di Docker, jangan hanya `npm test`.
- **Jangan pernah memberi `-ss` untuk gambar diam** — 0 frame, semua metrik
  jadi 0 dan semua foto dinilai blur. Dijaga `seekArgs()` di `src/render/ffmpeg.ts`.
- Ketajaman harus pada **480x270**. Kalibrasi: foto asli 18-26, blur sigma-6 ~2,
  placeholder rata = 0. `minSharpness` 8 (`config/defaults.json`).
- Worker meng-cache modul; **restart `src/worker/main.ts`** setelah mengubah
  agen/render.
- API menyajikan `public/` dengan `?v=` ber-hash. Setelah `build:ui`, hard-reload
  atau tambah query, kalau tidak browser memakai JS lama.
- Sandbox reset menghapus ffmpeg/piper. Binari di `/workspace/tools/bin`
  (ffmpeg + ffprobe). `src/core/env.ts` memperbaiki PATH dan di-import api,
  worker, dan `tests/run.ts`.
- Docker butuh `piper-tts` di `/opt/piper` + model `assets/tts/*.onnx`
  (gitignored), diunduh **setelah** `COPY . .`. Uji image dengan
  `-e WORKER_IN_PROCESS=1`, kalau tidak job menggantung `queued`.

## Dua build UI (sering tertukar)
- `build:studio` = **kanonik** -> `netlify-site/` + salinan ke `public/assets/`.
- `build:ui` = legacy (`public/app.js`), kini keluar lebih awal bila
  `public/assets/studio.js` ada.
- Ubah hash URL saja tidak memuat ulang bundel; uji dengan `?cb=1`.

## Deploy
- **Kanonik: GitHub Pages** https://alif121727.github.io/ai-agent-engginer/ .
  Push `main` -> `.github/workflows/pages.yml` build lalu `git push -f` ke
  `gh-pages` (mode **legacy**). Jangan pakai `actions/deploy-pages`.
- **Netlify** https://agent-studio-ai.netlify.app — build dari Git SELALU gagal
  (kredit akun habis, `skipped=true`), jadi push tidak memperbarui situs. Jalur
  yang jalan: `scripts/deploy-netlify.sh` (deploy preview tanpa kredit -> restore
  ke produksi).
- Verifikasi deploy selalu dengan `?cb=$(date +%s)`; CDN menyajikan HTML lama
  beberapa menit.
- Netlify mengabaikan override `Content-Type`, jadi manifest disajikan sebagai
  `manifest.json`.

## Akun & API
- Admin seed `admin@studio.id`; login menerima **username atau email** di field
  yang sama (`users.username`). **`POST /api/login` field-nya `email`**, bukan
  `account`/`identifier`. `/api/auth/login` bukan rute (itu middleware 401).
- Password tidak disimpan di repo. Reset:
  `node --experimental-strip-types scripts/reset-password.ts <email|username> <password> [new-username]`.
  `db().run()` mengembalikan void — cek dengan `db().get()`, jangan `result.changes`.
- Buat job: `POST /api/jobs` `{brief:{model,tagline,durasi,rasio,keunggulan}}`
  (butuh cookie). Unduh: `GET /api/jobs/:id/file/video.mp4`. Media
  `/api/jobs/:id/file/*` butuh `?token=`.

## Data & aset
- `assets/own/<slug>/` dirender **apa adanya**; QA hanya mengukur ketajaman, jadi
  foto stok lolos dan menghasilkan video tanpa mobil. Cek dengan
  `strings foto-1.jpg | head -1` (muncul `Picsum ID:` untuk unduhan stok).
- `.gitignore` sengaja meng-*un-ignore* `jobs/*/artifacts/**`; `git add -A`
  menyeret artefak job baru. Stage eksplisit kalau hanya ingin kode.
- `video/` + `thumb/` di `netlify-site/` **di-track** (~35 MB) karena build
  Netlify jalan dari checkout bersih.

## Audio & narasi
- Piper lokal (gratis) atau ElevenLabs. Pakai `ttsAvailable()`, jangan
  `Boolean(process.env.TTS_API_KEY)`.
- Narasi benar-benar ada: RMS per scene ~-18 dB, atau korelasi selubung audio
  `video.mp4` vs `narration.wav` = 0,879.
- Jitter f0 diukur dengan jendela 1024 @ 8 kHz. Drone 0-2%, mesin asli 57-227%.
- Perbaiki audio terbit dengan **remux** (`-c:v copy`), bukan render ulang.
- Kunci LLM user = DeepSeek (`api.deepseek.com/v1`), saldo 0 -> HTTP 402.
  Bedakan 402 "saldo habis" vs 401/403 "kunci ditolak".

## Car-chase renderer (`/workspace/car-chase/`, terpisah dari app studio)
- Renderer numpy/OpenCV offline, **bukan** bagian app Express. `bash make.sh`
  -> `out/car-chase-60s.mp4` (~14 menit, ~0,56 dtk/frame).
- **Akar faceting**: `car_items` menggambar tiap quad flat + painter's algorithm.
  Diperbaiki: normal per-vertex di `CarModel.VN` + rasterisasi segitiga ke
  **z-buffer** bersama (`_fill_tri`). Rasio faset 0,862 -> 0,466.
- **Jebakan ruang warna**: `sky_sample` mengembalikan sRGB 0-255, penjumlahan
  cahaya linear 0-1. Harus `(sky/255)**2.2`, kalau tidak mobil jadi putih total.
- Dimensi harus dicek dari **bbox**, bukan dict spec: roda keluar fender,
  endplate sayap, splitter, dan lengkung roda di bawah y=0 semuanya
  membengkakkan bbox. Pakai `clip_ground=True`, roda di dalam lebar fender.
- Metrik faset butuh render terisolasi (latar abu + mask z-buffer); mask
  kecerahan `g<60` ikut menangkap aspal dan angkanya tak berarti.

## Catatan kerja
- Saya tidak bisa melihat gambar di lingkungan ini. Verifikasi visual dengan
  metrik numerik (ffprobe, statistik piksel, korelasi), bukan tangkapan layar.
- `npm test` = 183 pemeriksaan, keluar non-zero bila gagal.
