# Studio Otomotif — aplikasi web video otomotif dengan tim agen AI

Aplikasi web yang mengubah template/brief menjadi video otomotif realistis,
dikerjakan oleh tim agen AI yang punya job desk masing-masing. Durasi bebas
diatur, pekerjaan otomatis dijeda saat internet bermasalah, dan hasilnya bisa
dipublikasikan ke Instagram (dry run sebagai default).

## Situs live

| Situs | URL | Catatan |
| --- | --- | --- |
| **GitHub Pages** (kanonik) | https://alif121727.github.io/ai-agent-engginer/ | Gratis, tanpa kredit, diperbarui otomatis tiap push ke `main` |
| Netlify (cermin) | https://agent-studio-ai.netlify.app | Deploy manual; kredit build Netlify sudah habis |

Masuk dengan `demo@studio.id` / `demo12345`. Keduanya menjalankan **mode demo**:
pipeline disimulasikan di peramban (tanpa ffmpeg), dan UI mengatakannya terus
terang. Untuk mp4 sungguhan, jalankan backend di bawah.

## Jalankan

```bash
npm install
cp .env.example .env      # isi kunci API bila ada
npm run build:ui
npm run api               # http://localhost:8080
npm run worker            # proses terpisah, menjalankan tahap agen
```

Buka `http://localhost:8080` (atau port publik sandbox: `PORT=12000 ./scripts/serve.sh`),
lalu masuk dengan akun admin. Reset password admin:
`node --experimental-strip-types scripts/reset-password.ts <email> <password-baru>`.

Docker:

```bash
docker compose up --build                       # api + worker (SQLite)
docker compose --profile postgres up --build    # + Postgres
docker compose --profile split up --build       # worker terpisah dari api
```

## Alamat permanen

Tautan sandbox (`work-*.prod-runtime.all-hands.dev`) mati saat sesi berakhir.
Untuk alamat yang tetap hidup, jalankan image ini di host yang selalu menyala.
Container sudah memuat ffmpeg, worker in-process, dan studio hasil build, jadi
tidak perlu langkah tambahan.

**Render** — tombol biru di bawah membuat service dari `render.yaml` di repo:

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/alif121727/ai-agent-engginer)

Setelah service hidup, akun pertama dibuat lewat tab **Daftar** di halaman
masuk (hanya akun pertama yang bisa mendaftar), atau:

```bash
curl -X POST https://<host-anda>/api/setup \
  -H 'Content-Type: application/json' \
  -d '{"email":"admin@studio.id","password":"<min-8-karakter>","username":"admin"}'
```

**Railway / Fly / VPS** — pakai `Dockerfile` yang sama:

```bash
docker build -t studio-ai .
docker run -d -p 8080:8080 -v studio-data:/app/data -v studio-jobs:/app/jobs studio-ai
```

Wajib: satu volume untuk `/app/data` (SQLite) dan `/app/jobs` (hasil render).
Tanpa volume, akun dan video hilang setiap container dibuat ulang. Set
`WORKER_IN_PROCESS=1` (default di image) kalau host hanya menjalankan satu
container.

Catatan sumber daya: render 1080p 30 detik butuh CPU cukup berat. Paket
termurah dengan 1 vCPU biasanya butuh ~5-8 menit per video, dan memori di bawah
1 GB bisa membuat ffmpeg terbunuh. Pilih minimal 2 GB RAM.

## Cara kerja

1. **Template masuk.** `POST /api/jobs` memvalidasi brief (`src/core/brief.ts`).
   Durasi di bawah minimum dinaikkan ke minimum dan dicatat di log job.
2. **Rencana.** Agen PM memilih tema dari nama model, menghitung jumlah scene
   dari durasi, dan mengestimasi biaya.
3. **Produksi.** Riset → naskah → storyboard → aset visual → motion → audio.
   Setiap agen hanya boleh memakai alat dan menulis artefak sesuai job desk-nya
   (`config/agents.json`); pelanggaran ditolak dan dicatat sebagai error.
4. **Render.** ffmpeg merakit klip per scene lalu menggabungkannya. Render
   ditolak bila ada scene tanpa aset realistis.
5. **QA.** Quality gate memeriksa resolusi, ketajaman, kemiripan antar scene,
   dan teks nyasar di dalam gambar.

### Durasi bebas

Jumlah scene bertambah mengikuti durasi (±1 scene per 10 detik di atas 30
detik), dan total durasi scene selalu sama persis dengan permintaan.

### Realistis, bukan gambar kode

Mobil tidak pernah digambar dengan kode. Sumber visual, berurutan:

1. `assets/own/<model-slug>/` — foto/video asli milik pengguna
2. generator video (image-to-video)
3. generator gambar
4. stock footage

Kalau tidak ada satu pun yang siap, job **gagal dengan pesan yang jelas**
(folder mana yang harus diisi atau kunci API mana yang belum diset), bukan
menghasilkan video palsu.

### Otomatis dijeda saat internet bermasalah

`src/net/monitor.ts` memeriksa koneksi tiap beberapa detik dengan histeresis
(3 kegagalan berturut-turut → dijeda, 2 keberhasilan → lanjut). Saat dijeda:

- job aktif ditandai `paused_offline`, tidak ada tahap baru dijalankan;
- progres per scene disimpan di `jobs/<id>/checkpoints/`, jadi saat online
  pekerjaan lanjut dari scene yang belum selesai, bukan dari nol;
- dashboard menampilkan banner dan status `PAUSED · OFFLINE`.

Kegagalan jaringan tidak dihitung sebagai percobaan gagal agen.

### Biaya

Estimasi dihitung sebelum job berjalan. Job yang melewati batas per job atau
batas harian berhenti di status `awaiting_cost_approval` sampai disetujui.

## Perintah

| Perintah | Kegunaan |
| --- | --- |
| `npm test` | 33 pemeriksaan (brief, durasi, tema, job desk, offline, DB, API) |
| `npm run build:ui` | Bundle UI ke `public/` |
| `npm run api` | API + UI |
| `npm run worker` | Worker agen |
| `npm run llm-check` | Uji apakah model LLM menerima gambar |

## Struktur

```
src/core     tipe, config, brief, tema, event bus, fs atomik
src/db       skema + repo (SQLite bawaan Node, Postgres opsional)
src/agents   registry, job desk guard, alat, runner
src/pipeline scene planner, checkpoint, quality gate, LLM capability
src/visuals  adapter lokal/gambar/video/stock
src/render   ffmpeg (rakit video, probe, sharpness, pHash)
src/net      probe koneksi + monitor dengan histeresis
src/api      REST + SSE + auth sesi
src/worker   klaim job, orkestrasi tahap, jeda/lanjut
src/publish  Instagram Reels (dry run default)
ui/          React + design token (hitam, oranye, putih, krem)
```

## Catatan

Asumsi teknis yang mengikat ada di [ASSUMPTIONS.md](ASSUMPTIONS.md).
