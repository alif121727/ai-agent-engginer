# Studio Otomotif — aplikasi web video otomotif dengan tim agen AI

Aplikasi web yang mengubah template/brief menjadi video otomotif realistis,
dikerjakan oleh tim agen AI yang punya job desk masing-masing. Durasi bebas
diatur, pekerjaan otomatis dijeda saat internet bermasalah, dan hasilnya bisa
dipublikasikan ke Instagram (dry run sebagai default).

## Jalankan

```bash
npm install
cp .env.example .env      # isi kunci API bila ada
npm run build:ui
npm run api               # http://localhost:8080
npm run worker            # proses terpisah, menjalankan tahap agen
```

Buka `http://localhost:8080`, buat akun admin pada layar setup pertama.

Docker:

```bash
docker compose up --build                       # api + worker (SQLite)
docker compose --profile postgres up --build    # + Postgres
```

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
