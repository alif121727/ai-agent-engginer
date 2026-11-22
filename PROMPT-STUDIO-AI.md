# Studio AI Otomotif — Spesifikasi & Prompt Pembangunan Lengkap

Satu berkas untuk semua kebutuhan: prompt pembangunan ulang, spesifikasi teknis,
aturan bisnis, kriteria penerimaan, dan daftar jebakan yang sudah terbukti.

**Cara pakai.** Untuk membangun ulang dari nol, tempel seluruh isi berkas ini ke
agen/LLM (Claude Code, Cursor, Codex, OpenHands) dan minta ia mengerjakan bagian
"Kriteria penerimaan" sampai terbukti. Untuk melanjutkan repo yang sudah ada,
pakai bagian "Aturan yang mengikat" dan "Jebakan" sebagai acuan review.

Semua angka, nama, dan aturan di sini diambil dari kode yang berjalan, bukan dari
rencana. Semua teks antarmuka dan pesan error dalam **Bahasa Indonesia**.

---

## 1. Produk

Aplikasi web yang mengubah brief otomotif singkat menjadi berkas `.mp4` 1080p
lewat tim agen AI yang punya meja kerja tetap. Setiap agen punya job desk,
artefak keluaran sendiri, dan tool terbatas. Hasil akhir diperiksa QA sebagai
gerbang sungguhan, bukan formalitas.

Alur: brief → rencana → riset → naskah → storyboard → aset visual → motion →
audio → render → QA → (opsional) publikasi.

## 2. Stack dan batasan teknis (jangan diubah)

- Node.js >= 22.6 dengan `node --experimental-strip-types`. **Backend tidak punya
  langkah build** — `.ts` dieksekusi langsung.
- Express 5 untuk API + penyajian UI statis.
- Database: SQLite lewat `node:sqlite` (default). Postgres lewat
  `DB_KIND=postgres` + `DATABASE_URL`. Lapisan query ditulis ANSI agar portabel.
- UI: React 19 + TypeScript, dibundel **esbuild** ke `public/`. Sumber di
  `studio/src/`, entry `studio/src/main.tsx`. Tanpa Vite, tanpa Next.
- ffmpeg/ffprobe wajib ada di PATH (render dan QA).
- Dependensi produksi seminimal mungkin: `express`, `pg`, `zod`. `esbuild`,
  `react`, `react-dom`, `typescript` cukup di devDependencies.
- Tanpa framework tes. Tes berupa skrip TS yang dijalankan
  `node --experimental-strip-types tests/run.ts`, mencetak
  `N pemeriksaan lulus, M gagal`, exit non-zero bila gagal. Acuan saat ini:
  **128 pemeriksaan lulus**.
- Antrean memakai tabel database (bukan Redis), karena syaratnya tahan restart.

## 3. Struktur folder

```
src/
  api/        server.ts (semua route), main.ts (entry API)
  agents/     registry.ts, runner.ts, tools.ts, guard.ts
  auth/       sesi, hash password
  core/       brief.ts, types.ts, config.ts, templates.ts, catalog.ts,
              fsx.ts, env.ts, log.ts, brief-look.ts, theme-ai.ts
  db/         index.ts (SqliteDb + PgDb), repo.ts, schema.ts
  net/        probe koneksi internet
  pipeline/   scenes.ts, quality.ts, checkpoint.ts, llm.ts, motion-score.ts
  render/     ffmpeg.ts, engine.ts, assemble.ts, audio.ts, camera.ts
  visuals/    types.ts (assetFolderSlug), adapter: local, video-gen,
              image-gen, image-gen-free, stock-api
  publish/    publikasi hasil
  worker/     worker.ts (antrean), main.ts (entry worker terpisah)
studio/src/
  main.tsx, state/store.tsx, components/, pages/, data/rendered.ts
config/       agents.json, defaults.json, catalog.json, llm.json,
              motion-policy.json, prompt-sanitizer.json, visuals.json
scripts/      build-studio.ts, build-ui.ts, serve.sh, reset-password.ts,
              autopush.sh, audit-katalog.py, deploy-netlify.sh
tests/        run.ts
assets/own/<slug>/   foto/video milik pengguna (dipakai apa adanya)
jobs/<id>/           artifacts/, checkpoints/, assets/, video.mp4
netlify-site/        galeri statis (video/thumb di-gitignore)
```

## 4. Aturan yang mengikat (inti produk)

1. **Durasi minimum 30 detik, keras.** Brief di bawah 30 dinaikkan ke 30 dan
   ditandai `bumped: true`. Maksimum 600 detik. Jumlah scene dihitung dari durasi.
2. **Dilarang mengarang spesifikasi mobil.** Semua angka (tenaga, torsi, tahun,
   mesin, 0-100) hanya dari `research.json`/katalog atau brief pengguna. Data tidak
   ada → tulis lebih sedikit. Penanda `'tidak disebut di sumber'` tidak boleh
   tampil di kartu model; hanya kategori · tahun · tenaga, dan tenaga kosong
   dilewati.
3. **Visual hanya dari berkas nyata.** Urutan adapter `local` → `video-gen` →
   `image-gen` → `image-gen-free` → `stock-api` (`config/visuals.json`). Adapter
   `local` membaca `assets/own/<slug>/` **apa adanya**. Job mode `final` GAGAL
   bila tidak ada satu pun sumber visual; mode `draft` boleh placeholder bertanda
   `FALLBACK` untuk menguji pipeline.
4. **Setiap agen hanya menulis artefaknya sendiri**, ditegakkan `guardArtifactWrite`
   dari `artifacts.writes` di `config/agents.json`. Nama tahap dan artefak
   berbeda: tahap `visual` menulis `assets.json`, `sound` menulis `audio.json`.
5. **QA adalah gerbang sungguhan.** QA menulis `qa.json` lebih dulu, lalu
   melempar `PermanentError` bila laporan gagal atau durasi video menyimpang.
   Konsekuensi: tahap QA berstatus `done` **wajib** punya `qa.json`.
6. **Rewind harus menghapus checkpoint** yang di-key oleh **nama tahap**. Kalau
   tidak, daftar `done` per-scene bertahan dan aset tidak pernah dibuat ulang.
   `POST /api/jobs/:id/retry` menerima `{ from: '<nama tahap>' }`.
7. **Status job harus jujur.** Job `done` tanpa `video.mp4` dilaporkan `failed`,
   bukan `done` dengan tombol unduh yang 404.
8. **Klaim job harus atomik.** `claimNextJob()` memakai hasil
   `UPDATE ... WHERE status='queued'` sebagai klaim: hanya worker dengan
   `changes === 1` yang menjalankan job. Tanpa ini dua worker menjalankan job
   yang sama di folder yang sama (pernah membuat `scene-06.jpg` 48 byte).
9. **Folder aset model harus konsisten.** `assetFolderSlug()` memakai
   `findModel(model)?.slug` lebih dulu, `slugifyModel` hanya cadangan. Dipakai
   oleh pipeline **dan** `ownDir()` di API, supaya unggah/daftar/saji/hapus
   menunjuk folder yang sama dengan yang dibaca pipeline.
10. **Biaya dibatasi**: `maxCostPerJob` 5 USD, `maxCostPerHari` 25 USD. Job mahal
    menunggu `POST /api/jobs/:id/approve-cost`.
11. **Publikasi Instagram** default `dryRun: true` — tidak pernah mem-publish
    tanpa izin.
12. **Koneksi internet** adalah kebenaran dari sisi server. Putus → job
    `paused_offline`, lanjut dari checkpoint setelah online
    (`pauseWhenNoViewer` mati).
13. **Zona waktu** default `Asia/Jakarta`. `workTime` hanya mengatur ritme
    animasi/estimasi, bukan durasi video.

## 5. Tim agen (9 meja, 3 preset)

Preset `9-orang` (default): `pm`, `research`, `script`, `storyboard`, `visual`,
`motion`, `sound`, `render`, `qa`.

| id | nama | artefak |
|---|---|---|
| pm | Project Manager (orkestrator) | `plan.json` |
| research | Riset Otomotif | `research.json` |
| script | Penulis Naskah | `script.json` |
| storyboard | Storyboard Artist | `storyboard.json` |
| visual | Visual Designer | `assets.json` |
| motion | Motion Designer | `motion.json` |
| sound | Sound Designer | `audio.json` |
| render | Render Engineer | `render.json` |
| qa | QA Reviewer | `qa.json` |

Preset gabungan: `6-orang` (`pm_qa`, `research_script`, `visual`, `motion`,
`sound`, `render`) dan `4-orang` (`pm_qa`, `script_storyboard`, `visual_motion`,
`render_qa`). Setiap agen punya `systemPrompt`, `allowedTools`, dan
`artifacts.reads/writes`. Hanya `pm` yang boleh menentukan urutan tahap; setiap
agen hanya boleh memanggil tool di `allowedTools`.

## 6. Template scene dan tema

Enam template: `showroom-30` (Showroom 30 detik), `track-day` (Track Day),
`heritage` (Warisan Klasik), `night-run` (Night Run), `garage-story` (Cerita
Garasi), `ev-explainer` (Penjelas EV). Template menentukan resep scene; brief
menyimpan `templateId`.

Brief juga menerima `temaAi` (palette, mood, grade, cameraLanguage, lighting,
descriptor) yang dibuat lewat `POST /api/tema-ai`. Tema web bukan tema video:
gaya video disimpan per model di `themes.json`.

Katalog: 33 model di `config/catalog.json`. Menambah model = entri katalog +
folder `assets/own/<slug>/` berisi foto asli. Alias (`r34`, `hachiroku`, `22b`,
`gullwing`) diekspor `aliasesFor()` dan dikirim sebagai `alias` di `/api/config`,
dipakai UI maupun server.

## 7. Route API

```
GET  /api/health            {ok, connection, db, ffmpeg}
GET  /api/bootstrap
POST /api/setup             akun pertama (tidak ada seed admin di kode)
POST /api/login             menerima username ATAU email di satu field
POST /api/logout
GET  /api/me
GET  /api/config            config + catalog + alias
GET  /api/templates
POST /api/tema-ai
POST /api/estimate
POST /api/jobs              buat job
GET  /api/jobs              daftar
GET  /api/jobs/:id
POST /api/jobs/:id/approve-cost
POST /api/jobs/:id/retry    { from: '<tahap>' } untuk rewind
POST /api/jobs/:id/cancel
GET  /api/jobs/:id/events
GET  /api/jobs/:id/file/:name        video.mp4, preview.jpg
GET  /api/jobs/:id/artifact/:name    JSON artefak untuk panel UI
GET  /api/jobs/:id/asset/:scene
GET  /api/assets/:model
GET  /api/assets/:model/file/:name
DELETE /api/assets/:model/:name
GET  /api/dashboard
GET  /api/settings ; PUT /api/settings
POST /api/publish/:jobId
GET  /api/events            SSE
```

Semua route job dan aset wajib lewat autentikasi sesi. Unduhan video tanpa sesi
harus **401**, bukan 200.

## 8. Database

Tabel: `users`, `sessions`, `jobs`, `job_stages`, `job_events`, `settings`,
`daily_costs`, `publications`.

`users` punya `username` unik (migrasi di konstruktor `SqliteDb`) di samping
`email`, karena login menerima keduanya. Password di-hash, minimal 8 karakter,
tidak pernah plaintext.

**Kontrak `run()`**: `run(sql, params): Promise<number>` mengembalikan jumlah
baris yang berubah (SQLite `result.changes`, Postgres `rowCount`). Ini yang
membuat klaim job atomik mungkin. Untuk sekadar memeriksa keberadaan baris pakai
`get()`, jangan andalkan `run()` bila maksudnya membaca data.

## 9. Halaman UI

`Auth` (masuk/daftar, alur akun pertama), `Dashboard`, `NewVideo`, `Projects`,
`ProjectDetail` (panel Artefak + verdict QA + `AssetPanel` unggah foto sendiri),
`Agent`, `Feed`, `Library`, `Models`, `Garasi`, `Pengaturan`. Hash router
(`#/proyek`). Palet hitam/oranye/putih/krem.

Bundel disajikan dengan query `?v=<hash>` dari `scripts/build-studio.ts`. Setelah
build ulang hash harus berubah, kalau tidak browser menyajikan JS lama. Jangan
memakai `m.field.split(...)` pada data API tanpa opsional (`m.field?.`): satu
field hilang membuat React melempar dan seluruh halaman jadi layar putih.

## 10. Invariant render dan QA

- **Jangan pernah memberi `-ss` pada ffmpeg untuk gambar diam.** Hasilnya 0
  frame, sehingga `frameSharpness`, `perceptualHash`, dan `detectText` 0/kosong
  dan semua foto dinilai buram. Pakai `seekArgs()` di `src/render/ffmpeg.ts`.
- Ketajaman diukur pada **480x270**, bukan 160x90 (detail hilang). Kalibrasi:
  foto asli 18-26, blur sigma-6 ≈ 2, placeholder rata = 0.
  `minSharpness` 8 (foto asli), `minSharpnessGenerated` 5 (hasil generator).
- Pemeriksaan resolusi membandingkan sisi pendek/panjang, bukan lebar/tinggi
  mentah, agar 9:16 (1080x1920) dan 1:1 (1080x1080) lolos dengan bar yang sama
  seperti 16:9. Sisi panjang yang diminta maksimum 1024.
- Gerbang frame video menangkap **hitam atau beku**, bukan menilai ketajaman
  fotografis (itu tugas gerbang per-aset). Ambang frame 2 + cek `tidak-beku`
  lewat perceptual hash antar frame. Menaikkan `unsharp` tidak menolong.
- QA menghasilkan **25 pemeriksaan**: 21 cek render (`berkas-video`,
  `terbaca-ffprobe`, `durasi-sesuai`, `ada-audio`, `resolusi`, `tanpa-fallback`,
  `frame-1..6`, `tidak-kosong`, `tidak-beku`, `gerakan-terukur`,
  `gerakan-scene-1..6`) plus 4 cek audio: `audio-plan-lengkap`,
  `loudness-sesuai` (±1 LU dari target), `true-peak-aman` (≤ -1 dBTP), dan
  `penggerak-konsisten` (EV tidak dinilai dengan profil ICE).
- Loudness diukur dari video jadi lewat `ebur128` (`measureLoudness`), bukan dari
  angka yang kita niatkan. Target `-16 LUFS` di `config/defaults.json`. Video lama
  terukur `-14.3 LUFS` sehingga gerbang ini benar-benar menolak, bukan hiasan.
- Setiap scene punya `audio-plan` di `audio.json` (penggerak, posisi kamera,
  event dominan, permukaan, silinder, firing per rev, rpm). Nilainya diturunkan
  dari profil mesin katalog; model di luar katalog ditandai `sumber: unknown`.
- QA **tidak** memeriksa bitrate. Dua job pernah lulus QA dengan bitrate ~50 kbps
  (0,2-0,3 MB untuk 30-45 detik) dan harus dikeluarkan dari galeri manual.
- Worker menyimpan cache modul. Setelah mengubah kode agen/render, **restart
  worker**, bukan hanya API.
- Prompt provider: `GenerateRequest` hanya punya `req.scene.prompt` (bukan
  `req.prompt`). Membaca field yang salah mengirim `"undefined"` ke semua scene →
  gambar identik → QA menolak karena duplikat.
- Negative prompt provider gratis: taruh di **depan** prompt. Di belakang tidak
  berpengaruh (piksel 100% identik, A/B seed sama) karena provider memotong ekor
  prompt. Korelasi turun ke -0.2465 saat di depan vs 1.0000 saat di belakang.
- Provider gratis (Pollinations) membatasi ~1 gambar/45 detik/IP (`HTTP 402
  FREE_LIMIT`) dan membatasi ukuran ~1015x580. Mitigasi: `seed` unik per scene
  (hash `model:index`), `maxRetries: 4`, `cooldownMs: 25000`, jeda
  `VISUAL_PACE_MS` (default 4000 ms), lalu upscale lanczos ke ukuran target.

## 11. Deploy

### Container (backend nyata)

- `Dockerfile` multi-stage `node:24-bookworm-slim` + ffmpeg +
  `fonts-dejavu-core` + `tini` sebagai init (ffmpeg meninggalkan proses anak;
  tanpa reaper container tidak berhenti bersih).
- **Wajib `npm ci --include=dev`**: esbuild dan react ada di devDependencies,
  jadi `--omit=dev` membuat `build:studio` gagal.
- Build UI memakai `npm run build:studio`, **bukan** `build:ui` (yang membangun UI
  lama). Galeri statis besar dikecualikan saat build lewat `MEDIA_OPTIONAL=1`.
- `WORKER_IN_PROCESS=1` memanggil `worker.start()` di proses API, supaya satu
  container cukup. Default mati agar pengembangan bisa memisahkan `npm run api`
  dan `npm run worker`.
- `STUDIO_DATA_DIR` mengarahkan `jobs/` dan `data/` ke disk eksternal (default
  `ROOT/jobs`, `ROOT/data`). Wajib dipakai di host ber-container; tanpa itu akun
  dan video hilang setiap deploy.
- Server bind ke semua interface (`app.listen(port)` tanpa host) agar health
  check host ber-container bisa menjangkau.
- `render.yaml`: `runtime: docker`, `plan: 1c-2g`, `region: singapore`,
  `healthCheckPath: /api/health`, disk `sizeGB: 10` di `mountPath: /var/data`,
  env `STUDIO_DATA_DIR=/var/data`, `DB_KIND=sqlite`,
  `DB_PATH=/var/data/db/studio.db`, `WORKER_IN_PROCESS=1`.
  Nilai `plan` yang sah hanya `free`, `0.5c-512mb`, `1c-2g`, `2c-4g`, `2c-8g`,
  `2c-16g`, `4c-8g`, dst — nilai karangan seperti `standard` ditolak. Persistent
  disk hanya untuk service berbayar, jadi `plan: free` tidak bisa dipakai.
- Sumber daya: 4 vCPU ≈ 2-3 menit per video 30 detik; 1 vCPU ≈ 5-8 menit.
  Memori di bawah 1 GB membuat ffmpeg terbunuh.

### Galeri statis (GitHub Pages + Netlify)

Aplikasi penuh **tidak bisa** jalan di hosting statis: butuh proses Node,
SQLite, dan ffmpeg. Dibuktikan: `public/` disajikan statis, halaman login tampil,
tetapi `POST /api/login` balas 404.

- GitHub Pages (kanonik): mode legacy, sumber branch `gh-pages`, workflow
  mem-build studio lalu `git push -f` isi `netlify-site/` ke `gh-pages`. Push
  branch `gh-pages` cukup untuk mengaktifkan Pages (POST /pages ditolak 403).
- Netlify (cermin): `netlify.toml` di akar repo,
  `command = "npm ci && npm run build:studio"`, `publish = "netlify-site"`.
- `build:studio` **gagal keras** bila berkas media wajib hilang, supaya situs
  tidak pernah terbit tanpa video. Ia mencetak hash bundel.
- Spesifikasi kartu galeri diambil dari `artifacts/research.json` `catalog`
  (angka padat), bukan prosa `specs` yang bisa berisi paragraf panjang.
- Video galeri dikompres 720p CRF 27 + faststart (211 MB → 35 MB); sumber 1080p
  tetap di `jobs/<id>/video.mp4`. `netlify-site/video/`, `thumb/`, `*.zip`
  di-gitignore.
- Situs statis memakai `DemoStudioApi` (login tidak diverifikasi, proyek di
  `localStorage`). Bila `/api/health` terdeteksi, `pickApi()` memakai backend
  sungguhan.

### Penyimpanan dan auto-push

- `scripts/autopush.sh` commit + push tiap 600 detik (log `/tmp/autopush.log`).
  "tidak ada perubahan" berarti working tree bersih, bukan skrip mati.
- `jobs/**` diabaikan, **kecuali** `jobs/*/artifacts/**` (±584 KB teks). Video,
  aset, klip, `qa-frames` tidak masuk repo (±461 MB).
- Pola gitignore butuh `!jobs/*/` sebelum `!jobs/*/artifacts/`; tanpa itu folder
  induk sudah ter-ignore dan pengecualian tidak berlaku.

## 12. Kriteria penerimaan

Bangun sampai semua ini **terbukti**, bukan diasumsikan:

1. `npm test` lulus semua (acuan 128 pemeriksaan) dan `typecheck:studio` bersih.
2. `npm run build:studio` menghasilkan `public/assets/studio.js` + `studio.css`
   dengan hash versi baru; penjaga media tetap menolak build bila berkas media
   wajib hilang tanpa `MEDIA_OPTIONAL`.
3. Lewat URL publik: `POST /api/setup` 200, login 200, `POST /api/jobs` 201, job
   `queued → running → done`, `video.mp4` bisa diunduh 200.
4. Video hasil: 1920x1080, durasi >= 30 detik, h264 + aac, `qa.json`
   `passed: true` dengan 21 cek.
5. Container dengan `PORT=10000`, disk `/var/data`, dan env blueprint di atas:
   `/api/health` OK, satu job selesai, DB dan video benar-benar tersimpan di disk
   eksternal.
6. Unduhan video tanpa sesi mengembalikan 401.
7. Aset yang dirender benar-benar kendaraan yang diminta. Uji dengan korelasi
   thumbnail 32x32 antara scene dan foto sumber (target 1.000), bukan hanya
   "QA lulus".

## 13. Jebakan yang sudah memakan korban

Semua ini nyata dan pernah terjadi di proyek ini. Hindari sejak awal.

**Render & QA**
- `-ss` pada ffmpeg untuk still image → 0 frame, semua foto dinilai buram.
- Mengukur ketajaman pada 160x90 → detail hilang.
- Memakai ketajaman fotografis sebagai gerbang frame video (salah metrik);
  menaikkan `unsharp` tidak menolong.
- Lupa bahwa QA tidak memeriksa bitrate → video 50 kbps lolos.

**Aset**
- Foto stok acak (picsum) lolos QA tetapi menghasilkan video tanpa mobil. Cek isi
  folder: `strings foto-1.jpg | head -1` menampilkan `Picsum ID:` untuk unduhan
  stok.
- Nama folder aset kustom (`porsche-911-gt3-rs-992`) tidak ditemukan oleh
  `slugifyModel` → 12 dari 30 model diam-diam jatuh ke generator. Tidak ada error.
- `ownDir()` membuat slug sendiri → unggahan user masuk folder yang tidak pernah
  dibaca pipeline. Kegagalan senyap.
- `thumb.wikimedia.org` menolak ukuran sembarang (400 "Use thumbnail sizes
  listed") dan membalas 429 saat burst; pakai `iiurlwidth` dari API + jeda.

**Antrean & proses**
- Dua worker mengklaim job yang sama → berkas ditulis dua proses, satu terpotong.
- Restart API saja setelah mengubah kode pipeline → worker lama tetap dipakai,
  aset identik walau kode sudah berubah.
- Lupa build UI → browser menyajikan bundel lama.

**Data & API**
- `req.prompt` padahal field-nya `req.scene.prompt` → prompt `"undefined"`,
  gambar identik.
- Negative prompt di belakang prompt → dibuang provider (dipotong).
- Satu field API hilang (`mesin`) dan UI memanggil `.split()` → layar putih total,
  tanpa pesan error.
- UI menyalin logika skor sendiri tanpa alias → "r34" dianggap tidak ada di
  katalog padahal server mengenalinya.

**Deploy**
- `npm ci --omit=dev` → esbuild hilang → `build:studio` gagal.
- `build:ui` alih-alih `build:studio` → UI lama yang disajikan.
- `plan: standard` di `render.yaml` → ditolak; nilai sah hanya daftar di §11.
- `plan: free` + disk → tidak mungkin; disk hanya untuk service berbayar.
- Path data di-hardcode ke root proyek → data hilang tiap deploy.

## 14. Asumsi yang mengikat

Ubah kalau terbukti salah, tapi jangan diam-diam.

1. Runtime type-stripping native; hanya UI yang di-bundle.
2. SQLite default; Postgres lewat `DB_KIND=postgres` + `DATABASE_URL`.
3. Antrean di tabel database, bukan Redis, karena harus tahan restart.
4. Tanpa sumber visual sama sekali → job `final` GAGAL (menggambar mobil lewat
   kode dilarang).
5. Adapter visual tidak mengunci vendor; menambah provider = adapter + config.
6. Pemeriksaan kemampuan LLM sekali (`npm run llm-check`), hasil di
   `config/llm.json`. Model tanpa dukungan gambar → QA visual mencatat "visual
   review dilewati" dan tidak mengklaim kualitas.
7. `minDurasi` 30 dapat diubah di UI; jumlah scene dihitung dari durasi.
8. Instagram `dryRun: true`.
9. Koneksi internet dinilai dari sisi server.
10. Zona waktu `Asia/Jakarta`.
11. `config/llm.json` saat ini `model: ""` dan `baseUrl: ""` — agen berjalan lewat
    jalur deterministik, bukan LLM sungguhan. Jangan mengarang konfigurasi LLM.

## 15. Riset, sumber, dan header keamanan

- Sumber angka ada di `config/catalog.json` field `sumber` (semua 33 model →
  Wikipedia). Skrip `scripts/riset-sumber.py` memeriksa URL-nya secara nyata
  (HEAD request) dan menulis `data/riset-sumber.json` berisi `url`, `license`,
  `accessed_at`, `confidence`. Jalankan `--offline` di CI tanpa jaringan.
- URL katalog tidak boleh memuat catatan seperti ` (bagian Z-tune)`: teks itu
  membuat URL tidak valid. Simpan catatan di tempat lain.
- Angka yang tidak ada di sumber ditulis `tidak disebut di sumber`, tidak diisi
  tebakan, dan tidak pernah tampil di kartu model.
- Header keamanan dipasang global: `X-Content-Type-Options`, `Referrer-Policy`,
  `X-Frame-Options: DENY`, dan CSP yang hanya mengizinkan skrip dari origin
  sendiri. HSTS hanya dikirim bila `APP_URL`/`SITE_URL` berawalan `https`.
- Halaman ditandai `noindex` kecuali `SITE_URL` berisi domain produksi
  (bukan host `prod-runtime.all-hands.dev`, `localhost`, atau `127.0.0.1`).
  Tag robots yang sudah ada **diganti**, bukan ditambah: dua tag berlawanan
  membuat mesin pencari memilih yang paling permisif.
- Rate limit login sudah ada: 10 percobaan/menit per akun, 60/menit per IP.

## 16. Perintah

```bash
npm test                                   # 128 pemeriksaan
npm run typecheck:studio
npm run build:studio                       # bundel UI + hash versi
npm run api                                # port 8080 (atau PORT)
npm run worker                             # proses terpisah
./scripts/serve.sh 12000                   # API publik + worker
node --experimental-strip-types scripts/reset-password.ts <email|username> <password> [username]
bash scripts/autopush.sh                   # commit tiap 10 menit
```

Akun: tidak ada seed admin. Akun pertama lewat `POST /api/setup` atau tab
**Daftar**. Login menerima username atau email di satu field. Password minimal
8 karakter.
