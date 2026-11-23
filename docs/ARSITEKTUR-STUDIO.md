# Arsitektur Studio AI Otomotif

Ringkasan teknis: bagian apa yang ada, siapa boleh menulis apa, dan mengapa
beberapa keputusan diambil seperti itu.

## Alur data

```
UI (React + esbuild)
  │  POST /api/jobs {brief}
  ▼
API (Express 5)  ──►  SQLite: jobs + stages
  │
  ▼  worker klaim job (status queued → running)
Worker orkestrasi 9 tahap
  │  tiap tahap: baca artefak sebelumnya → tulis artefaknya sendiri
  ▼
jobs/<id>/artifacts/*.json   (rencana, riset, naskah, storyboard, assets, motion, audio, qa)
jobs/<id>/assets/            (foto/klip per scene)
jobs/<id>/clips/             (klip ffmpeg per scene)
jobs/<id>/video.mp4          (hasil akhir)
  │
  ▼  GET /api/jobs/:id/file/video.mp4
UI memutar video (Bearer token atau ?token=)
```

## Sembilan tahap dan artefaknya

| Tahap | Agen | Artefak tulis | Isi |
| --- | --- | --- | --- |
| `rencana` | `pm` | `plan.json` | Urutan kerja, jumlah scene, estimasi biaya |
| `riset` | `research` | `research.json` | Spesifikasi dari katalog + tautan sumber |
| `naskah` | `script` | `script.json` | Naskah 5 babak dengan durasi per babak |
| `storyboard` | `storyboard` | `storyboard.json` | Shot, gerakan kamera, durasi |
| `aset-visual` | `visual` | `assets.json` | Pilihan foto/klip per scene + alasan |
| `motion` | `motion` | `motion.json` | Ken Burns, transisi, tempo |
| `audio` | `sound` | `audio.json` | Profil suara mesin, musik, level |
| `render` | `render` | `render.json` | Daftar klip, ukuran, kodek |
| `qa` | `qa` | `qa.json` | Verdict, sharpness, pHash, probe video |

Nama tahap dan nama artefak sengaja berbeda. `guardArtifactWrite` di
`src/agents/runner.ts` menolak agen yang menulis artefak milik agen lain, dan
menolak alat di luar `allowedTools` di `config/agents.json`.

## Aturan yang mengikat

**Durasi minimal 30 detik.** Ditegakkan di `src/core/brief.ts`. Permintaan di
bawahnya dinaikkan dan dicatat di log job, bukan ditolak diam-diam.

**Tidak ada spesifikasi karangan.** Angka di naskah hanya boleh berasal dari
`config/catalog.json` atau brief pengguna. Agen riset wajib menyertakan sumber.

**Visual hanya dari berkas nyata.** Urutan adapter di `config/visuals.json`:
`local` → `video-gen` → `image-gen` → `image-gen-free` → stock. Kalau tidak ada
yang siap, job gagal dengan pesan yang menyebut apa yang harus disiapkan.

**QA adalah gerbang sungguhan.** Agen QA menulis `qa.json` lebih dulu, lalu
melempar `PermanentError` kalau verdict gagal atau durasi video menyimpang.
Karena itu, tahap QA berstatus `done` selalu punya `qa.json`.

**Rewind membersihkan checkpoint.** `POST /api/jobs/:id/retry {from}` menghapus
checkpoint berkunci **nama tahap**. Tanpa itu, daftar scene `done` bertahan dan
aset tidak pernah diregenerasi.

## Sesi lintas situs

Netlify dan Pages berbeda origin dari backend, dan Chrome/Safari memblokir
cookie pihak ketiga. Karena itu:

1. `POST /api/login` mengembalikan `{user, token}`; UI menyimpan token di
   `localStorage` (`studio_token`) dan mengirim `Authorization: Bearer`.
2. Tag `<video>`/`<img>` tidak bisa mengirim header, jadi `requireAuth` juga
   menerima `?token=` **khusus GET**.
3. Backend wajib menyetel `CORS_ORIGINS`, dan daftar
   `Access-Control-Allow-Headers` **harus** memuat `Authorization`. Tanpa itu
   preflight gagal, login tampak sukses, tetapi `/api/me` dan `/api/jobs` gagal
   sehingga Dashboard menampilkan 0 proyek. Ini pernah terjadi dan sekarang
   dijaga oleh uji `CORS preflight mengizinkan header Authorization`.

Cookie sesi tetap dipakai untuk UI yang satu origin dengan API.

## Render

`src/render/ffmpeg.ts` merakit klip per scene lalu menggabungkannya. Dua jebakan
yang sudah ditangani:

- **Jangan kirim `-ss` untuk gambar diam.** Hasilnya 0 frame, sehingga
  sharpness, pHash, dan deteksi teks semuanya kosong dan setiap foto dianggap
  buram. `seekArgs()` menjaga ini.
- **Sharpness diukur pada 480x270.** Pada 160x90 detail hilang. Kalibrasi: foto
  asli 18–26, blur sigma-6 sekitar 2, gambar gradien datar 0. Ambang
  `minSharpness` 8.

## Worker dan ketahanan

Worker (`src/worker/main.ts`) mengklaim job, menjalankan tahap, dan menulis
checkpoint per scene. Kalau koneksi putus, `src/net/monitor.ts` menjeda job
(`paused_offline`) setelah 3 kegagalan berturut-turut dan melanjutkannya setelah
2 keberhasilan. Kegagalan jaringan tidak dihitung sebagai percobaan gagal agen.

Worker menyimpan modul yang sudah diimpor. Setelah mengubah kode agen atau
render, **restart worker**, kalau tidak ia menjalankan logika lama.

## Basis data

`SqliteDb` membuat skema dan migrasi di konstruktornya, termasuk indeks unik
`users.username`. Catatan: `db().run()` mengembalikan `void`, jadi periksa
keberadaan baris dengan `db().get()` sebelum `UPDATE` — jangan mengandalkan
`result.changes`.

## Peta berkas

```
src/core      tipe, config, brief, tema, katalog, event bus
src/db        skema + repo (SQLite bawaan Node, Postgres opsional)
src/agents    registry, job desk guard, alat, runner
src/pipeline  scene planner, checkpoint, quality gate
src/visuals   adapter lokal, generator gambar/video, stock
src/render    ffmpeg (rakit, probe, sharpness, pHash), audio, kamera
src/net       probe koneksi + monitor
src/api       REST + SSE + auth
src/worker    klaim job, orkestrasi tahap
src/publish   Instagram Reels (dry run default)
studio/       sumber UI React (di-bundle ke public/ dan netlify-site/)
```
