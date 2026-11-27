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

## Perpustakaan: tiga status, bukan dua
- `rendered.ts` `qa` sekarang `'lolos' | 'tanpa-foto' | 'render-3d'`.
  `render-3d` = dirender dari geometri 3D prosedural (car-chase), tanpa foto
  maupun gambar AI. Jangan pernah melabelinya "FOTO ASLI".
- Entri `render-3d` **tidak boleh** jadi proyek benih (`seedFrom` melewatinya):
  video itu dibuat di luar pipeline, jadi tidak punya tahap/artefak/QA.
  Membuatkannya proyek = mengarang riwayat kerja.
- Tes "jumlah benih = video ber-katalog" harus memakai filter yang sama
  (`catalogSlug && qa !== 'render-3d'`), kalau tidak tes gagal saat menambah
  entri render-3d.
- Video baru wajib ada di **dua** tempat: `netlify-site/video/<slug>.mp4` dan
  `netlify-site/thumb/<slug>.jpg` (di-track git; Pages membangun dari
  checkout bersih). Thumbnail: pilih frame dengan `ffprobe -f lavfi
  movie=...:seek_point=<t>,signalstats` -> YAVG tertinggi, jangan menebak dari
  ukuran berkas.

## Catatan kerja
- Saya tidak bisa melihat gambar di lingkungan ini. Verifikasi visual dengan
  metrik numerik (ffprobe, statistik piksel, korelasi), bukan tangkapan layar.
- `npm test` = 183 pemeriksaan, keluar non-zero bila gagal.

## Template mobil (cartpl) di studio
- `templates/cars/` + `templates/schema/v1.json` mendeskripsikan mobil; `cartpl/`
  (Python) satu-satunya validator/renderer. `src/core/car-templates.ts` hanya
  membaca JSON untuk UI dan mengikuti rantai `meta.extends` sendiri.
- `GET /api/car-templates` didaftarkan **sebelum** `app.use('/api', requireAuth)`
  supaya Garasi bisa menampilkannya tanpa login. Pindahkan ke bawah middleware
  itu dan panel hilang tanpa galat.
- Pratinjau: `python3 -m cartpl render-preview --all -o public/cartpl-preview --size 512`.
- Body default `_base.json` = `[0.02,0.02,0.025]` (hampir hitam) — frame hero
  gelap itu warna spec, bukan bug.
- Uji visibilitas hero: warnai `body_base` merah terang lalu hitung piksel merah
  (15.5% frame, bbox rasio 2.53 = siluet mobil). Diff antar-model saja tidak
  membuktikan apa pun karena latar juga bergeser.

## car-chase (pipeline render Python, di /workspace/car-chase)
- Repo git terpisah, belum ada remote. Deps yang wajib: numpy, opencv-python-headless,
  scipy; untuk test cartpl juga pytest, jsonschema, pillow.
- **ffmpeg tidak terpasang di image ini.** `apt-get` gagal (bukan root). Pakai
  `pip install imageio-ffmpeg` lalu symlink binernya ke `~/.local/bin/ffmpeg`
  dan tambahkan dir itu ke PATH; render_all.py memanggil `ffmpeg` dari PATH.
- `car_selected.json` adalah **snapshot spec**, bukan referensi hidup. Setelah
  mengubah `project/cartpl/builder.py` atau `templates/`, WAJIB regenerasi:
  `cd project && PYTHONPATH=. python3 -m cartpl select mid-engine-supercar \
   --out /workspace/car-chase/car_selected.json --force`.
  Kalau tidak, `render.py` menangkap exception lalu diam-diam kembali ke model
  bawaan `cars.py` (muncul baris `[cartpl] dilewati: ...`).
- `render.py` punya flag env: `SSAA=2` (2x2 supersampling langit+jalan, +0,65 s/frame),
  `MB_CARS=3` (motion blur mobil lewat 3 sub-waktu).
- **Jangan pernah memberi `ts` negatif ke `Wd.sun_dir`**: `sun_el` memakai
  `(t/60)**1.15`, dan t negatif menghasilkan bilangan kompleks yang meledak
  sebagai `TypeError: must be real number, not complex`. Klamp ke >= 0.
- Angka geometri di `cartpl/builder.py` HARUS berasal dari spec: ada test
  `test_no_magic_numbers_in_builder` yang menolak literal desimal baru.
  Tambahkan ke `templates/cars/_base.json` DAN ke `templates/schema/v1.json`
  (`required` maupun `properties`), lalu ke `cartpl/estimate.py` bila jumlah
  quad berubah (test estimasi menuntut selisih < 5%).
- Tidak bisa "melihat" gambar: verifikasi selalu kuantitatif lewat
  `work/cmp.py` (region_stats) dan `work/zoom.py` (statistik crop).
  Nama file `work/inspect.py` membayangi modul stdlib `inspect` — jangan.
- **Encode final car-chase: crf 23,5 + `-x264-params aq-mode=3`, preset slow.**
  crf 24 (default lama di `make.sh`) membuang tekstur: tepi Laplacian turun
  8,1 -> 2,3 pada klip yang sama. crf 20 mempertahankan detail (8,1) tapi
  ~76 MB. crf 23,5 + aq3 = ~19 MB dengan tepi 3,1-4,8. Ukur dengan
  `|Laplacian|.mean()` pada frame hasil `ffmpeg -ss`.
- `ffprobe` TIDAK ada di sandbox ini (hanya `ffmpeg`). 4 test audio gagal
  palsu karenanya. Perbaikan: `pip install static-ffmpeg` lalu symlink
  `.../static_ffmpeg/bin/linux/{ffmpeg,ffprobe}` ke `~/.local/bin/`.
  Suite jadi **183 lulus, 0 gagal**.
## Kenapa bug lolos (root cause, bukan tebakan)
- CI lama HANYA `npm install` + `build:studio`. Build statis tidak menyentuh
  logika pipeline, jadi `TypeError: complex` di renderer dan crf yang
  menghapus detail bisa masuk `main` dan ter-deploy tanpa ada yang gagal.
  Sekarang `.github/workflows/ci.yml` menjalankan typecheck + npm test +
  pytest + build pada push & PR.
- Tidak ada `requirements.txt`: lingkungan baru kehilangan numpy/cv2/pytest
  dan 180+ test Python tak bisa jalan sama sekali. Sekarang ada
  `requirements.txt` + `requirements-dev.txt`.
- `src/core/env.ts` dulu hanya memulihkan `ffmpeg`, BUKAN `ffprobe`. Sandbox
  tanpa ffprobe membuat 4 test audio gagal dengan pesan menyesatkan
  ("berkas tidak terbaca sebagai audio"). Sekarang keduanya dicari, termasuk
  `~/.local/bin`.
- `./scripts/check.sh` = gerbang lokal satu perintah (typecheck, npm test,
  pytest, build). Jalankan sebelum commit.

## Restore setelah sandbox hilang (2026-11-27, teruji)
- Workspace kosong total (hanya `.openhands/memory`). Repo dipulihkan dari GitHub:
  `git clone --depth 30 https://$GITHUB_TOKEN@github.com/alif121727/ai-agent-engginer.git`
  lalu pindahkan `.git` + isi ke `/workspace/project` (rsync tidak ada; pakai tar).
- `npm ci` cukup (86 paket). `npm run build:studio` -> v hash baru; `npm test`
  **187 lulus** dengan ffmpeg 9.0.2 (imageio) + ffprobe 4.0.2 (ffprobe-static).
- Biner hilang setelah reset. Resep yang berhasil:
  `pip install imageio-ffmpeg` -> salin `imageio_ffmpeg.get_ffmpeg_exe()` ke
  `/workspace/tools/bin/ffmpeg`; `npm i --prefix /tmp/ffp ffprobe-static` ->
  salin `bin/linux/x64/ffprobe` ke folder yang sama. `src/core/env.ts` mencari
  `/workspace/tools/bin`, jadi tidak perlu ubah PATH global.
- `pip install piper-tts` lalu `./scripts/fetch-tts-model.sh` (model onnx 63 MB
  gitignored, harus diunduh ulang tiap reset). `~/.local/bin/piper` sudah ada di
  daftar `toolDirs` env.ts.
- `data/studio.db` **tidak** di-commit -> `users` kosong, dashboard 0 proyek.
  Buat akun admin sekali: `POST /api/setup {email,password,username}` (hanya
  boleh saat userCount=0). Dipakai: admin@studio.id / admin123, username `admin`.
- `jobs/` ikut repo (artefak), tetapi `jobs/*/video.mp4` gitignored -> tidak ada
  video hasil render lama. Video galeri tetap ada di `netlify-site/video/` dan
  disajikan `/video/*` oleh server.
- `scripts/serve.sh` default `APP_URL` masih menunjuk sandbox lama
  (`work-1-lxpwikokempxmoli`). Sudah diganti ke host sekarang
  (`work-1-dqfkjmazfavmzfjk`); kalau host berubah lagi, ubah baris itu.
- Uji asap pasca-restore (2026-11-27): job `1fd6d407b5d641dbad9342417ffe06a7`
  (Mazda RX-7 FD3S, 30 dtk, mode final) selesai `done`, QA 26/26 tanpa gagal,
  video 1920x1080 h264 + AAC stereo, 27,6 MB, RMS -18,1 dB (narasi Piper ada).
  Artinya jalur penuh API -> worker -> render -> QA hidup setelah reset.
- "Buat ulang" proyek yang hilang = POST /api/jobs lagi dengan brief yang sama
  (baca `artifacts/script.json` model + `plan.json` durationSec/aspect/theme).
  Foto asli ada di `assets/own/<slug>/` (ikut git) sehingga hasilnya sama;
  artefak baru hanya ~60 KB dan aman di-commit, sedangkan `video.mp4` tetap
  gitignored. Contoh: job 753b0220 (Porsche 911 GT3 RS, 30 dtk, QA 26/26).
- Baris proyek TIDAK bisa dipulihkan dari artefak secara otomatis; DB harus
  dibuat ulang. Artefak lama tetap berguna sebagai sumber brief/naskah.
## Kantor Agen (studio/src/pages/AgentOffice.tsx)
- Halaman `#/kantor` meniru contoh `Kantor Agent IG.html` (mockup 3 ruang,
  pixel-art canvas, jam, hex 9 agen) tetapi **diisi data nyata**: status tahap
  dari `/api/jobs`, `script.json`, `qa.json`, `render-result.json`, dan log dari
  `/api/jobs/:id/events`.
- Metrik penonton TIDAK ditampilkan (tidak ada akun platform) — jangan tambah
  angka karangan seperti di mockup.
- Butuh dua metode baru di `StudioApi`: `getEvents()` dan `getArtifact()`.
  Mode demo mengembalikan kosong/null supaya UI tidak mengaku punya artefak.
- Tombol "Setujui video" memanggil `api.publish()` (dry-run) — bukan unggah asli.
## Mode demo sudah DIHAPUS (2026-11-27)
- `pickApi()` tidak pernah mengembalikan `DemoStudioApi` lagi: kandidat
  (`?backend=`, pilihan tersimpan, `__STUDIO_API__`, `__STUDIO_URL__`, origin)
  diprobe; kalau semua gagal, UI tetap memakai `HttpStudioApi` supaya error
  kelihatan. `DemoStudioApi` hanya dipakai tes.
- Banner merah `BackendBanner` (components/shell.tsx) muncul saat
  `/api/health` gagal, dengan input alamat + "Simpan & muat ulang".
- Penyebab situs Pages tampak demo: `LINKS.studio` menunjuk host sandbox lama
  (`work-1-lxpwikokempxmoli…`, mati). Sekarang default = host aktif, dan
  `pages.yml` membekukan `vars.STUDIO_URL` bila variabel repo diisi.
- Backend kini mengirim CORS untuk `https://alif121727.github.io` dan
  `https://agent-studio-ai.netlify.app` secara default (`DEFAULT_CORS_ORIGINS`
  di src/api/server.ts); tanpa itu Pages tidak bisa memanggil API sama sekali.
- Verifikasi: `curl -H "Origin: https://alif121727.github.io" .../api/health`
  harus memuat `Access-Control-Allow-Origin`.
