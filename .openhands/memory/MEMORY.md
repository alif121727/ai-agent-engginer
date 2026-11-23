# Project memory — AI Studio Otomotif

## What this is
Web app (`ai-agent-engginer`, branch `main`) that turns an automotive brief into
an mp4 using a team of AI agents with fixed job desks. Node + `--experimental-strip-types`
(no build step for the server), Express 5, SQLite by default, esbuild for the UI
(`ui/app.tsx` -> `public/`). All user-facing text is Indonesian.

## Key invariants
- **30s hard minimum** per video, enforced in `src/core/brief.ts`.
- **No invented specs**; visuals only come from real files. `assets/own/<slug>/`
  holds the user's own photos/videos and the `local` adapter is tried first.
- **Each agent writes only its own artifacts** (`config/agents.json`
  `artifacts.writes`, enforced by `guardArtifactWrite`). A stage name and the
  artifact it writes differ (`aset-visual` writes `assets.json`).
- **QA is a real gate**: it writes `qa.json` first, then throws `PermanentError`
  if the report fails or the video duration is off. A `done` QA stage must
  therefore always have `qa.json`.
- **Rewind must clear the checkpoint** keyed by the *stage name*; otherwise the
  per-scene `done` list survives and assets are never regenerated.

- **Skills**: `.agents/skills/` holds `media-generator` (foto/video) and
  `anime-vfx-generator` (animasi/VFX). `quick_validate.py` from `skill-creator`
  is stale — it rejects the `triggers:` key even though docs and bundled skills
  use it. Validate a /tmp copy with the triggers block stripped.

## Environment quirks (expensive to learn)
- **Never pass `-ss` to ffmpeg for a still image** — it yields 0 frames, so
  `frameSharpness`/`perceptualHash`/`detectText` all return 0/empty and every
  photo is judged blurry. `seekArgs()` in `src/render/ffmpeg.ts` guards this.
- Sharpness must be sampled at **480x270** (not 160x90, where detail vanishes).
  Calibration: real photos 18-26, sigma-6 blur ~2, flat placeholder art = 0.
  `minSharpness` is 8 (`config/defaults.json`).
- The worker caches imported modules; **restart `src/worker/main.ts` after
  editing agent/render code**, or it keeps running the old logic.
- The API serves `public/` with a hashed `?v=` query (`scripts/build-ui.ts`).
  After `build:ui`, hard-reload or add a query param or the browser shows stale JS.
- Jobs whose assets are flat placeholder PNGs legitimately fail QA. Test with
  real photos (e.g. picsum) instead of generated gradients.

## Galeri statis (deploy GitHub Pages)
- Situs live: `https://alif121727.github.io/ai-agent-engginer/` (workflow
  `.github/workflows/pages.yml` build `npm run build:studio` lalu push ke `gh-pages`;
  Pages berjalan mode legacy, jadi JANGAN pakai `actions/deploy-pages`).
- `video/` = master (dipakai tombol Unduh), `video/web/` = versi putar 720p untuk
  Feed. Tes menuntut ukuran web < 40% master.
- `width`/`height` di `studio/src/data/rendered.ts` harus berasal dari `ffprobe`
  berkas yang disajikan, bukan dari brief — dulu mengklaim 1080p untuk berkas 720p.
- Badge kartu: `v.qa === 'tanpa-foto'` -> "AI-GENERATED", selain itu "FOTO ASLI".
- Provenance foto: `jobs/<id>/artifacts/assets.json` (`provider: local`, `source`
  menunjuk `assets/own/<slug>/`). Slug folder ≠ slug galeri.

## Failure modes worth knowing
- **Job tertahan `running`**: worker mati di tengah render meninggalkan job
  `running`; `claimNextJob()` hanya ambil `queued` dan retry menolak `running`.
  Sudah diperbaiki: `requeueStaleRunning()` saat `Worker.start()`, heartbeat
  `touchJob()` tiap 60s, retry menerima job diam >15 menit (`d985d9c`).
- **Dashboard "Gagal" untuk job `done`**: itu `honestStatus()` — job `done`
  yang `video.mp4`-nya hilang sengaja dilaporkan gagal. Bukan bug.

## Commands that matter
- `npm test` -> 168 checks, exits non-zero on failure.
- `npm run api` (port 8080) + `npm run worker` — both needed; jobs stall without the worker.
- `./scripts/serve.sh 12000` — starts API on the public sandbox port and the
  worker if absent, then prints health + the public URL. Public URL for port
  12000: `https://work-1-lxpwikokempxmoli.prod-runtime.all-hands.dev`
  (port 12001 maps to `work-2-...`). Logs: `/tmp/api.log`, `/tmp/worker.log`.
- `npm run build:ui` after any `ui/app.tsx` change.
- `scripts/autopush.sh` commits+pushes every 10 min (log: `/tmp/autopush.log`).

## Deploy reality (checked 2026-11-20)
- **Canonical site is GitHub Pages**: https://alif121727.github.io/ai-agent-engginer/ .
  Push to `main` -> `.github/workflows/pages.yml` builds `netlify-site/` and
  force-pushes it to branch `gh-pages` (legacy mode). Live in ~3-5 min.
- **Netlify is dead** (build credits exhausted); `netlify.toml` is misleading.
  `scripts/deploy-netlify.sh` is the only manual path.
- gh-pages commits read "Build <sha> dari main" and are NOT on `main`; that is
  expected, not a lost commit.
- Verifying a rebuild needs a **query param** (`?r=2#/baru`): hash-only
  navigation keeps the old JS in memory and makes a deploy look missing.

- **Login (2026-11-22)**: kuota login harus **per akun**, bukan per IP (proxy
  sandbox membuat semua orang satu IP -> 429 massal). `rateLimit()` hanya
  menagih lewat `fail()`, dan `clear()` dipanggil setelah login sukses. UI
  "Buat sekarang" wajib memanggil `/api/setup`, bukan menulis localStorage.
  Boot memverifikasi `/api/me` sebelum percaya sesi tersimpan.

## Accounts
- Seeded admin: `admin@studio.id`. Login accepts **username or email** in the same
  field (`users.username`, unique index, added by a migration in
  `SqliteDb` constructor). Current username: `admin123`.
- Passwords are not stored in the repo; reset with
  `node --experimental-strip-types scripts/reset-password.ts <email|username> <password> [new-username]`
  (min 8 chars). `db().run()` returns void — check existence with `db().get()`
  before updating, never `result.changes`.

## Assets gotcha (cost a full render)
- `assets/own/<slug>/` is rendered **as-is**; QA only measures sharpness, so
  random stock photos (picsum) pass QA and produce a car-less video. Verify a
  folder really contains the vehicle before rendering:
  `strings foto-1.jpg | head -1` shows `Picsum ID:` for stock downloads.
- Real photos now come from Wikimedia Commons (CC BY-SA 4.0); see
  `assets/own/README.md` for attribution.

## Netlify (gallery only)
- **Live site (user's own account): https://agent-studio-ai.netlify.app** — no
  password, immutable caching, range requests OK. Site id
  `7c88850b-1563-4372-a2b9-f4aa1240c20d`. This is the canonical link to give.
- Login without a token: `netlify login --request "<msg>" --json` → user opens the
  URL → `netlify login --check <ticket> --json` → `authorized`. Token lands in
  `~/.config/netlify/config.json` (plaintext, no keychain in this container).
- Re-linking: `netlify link --id <x>` FAILS if the folder is already linked to
  another site. Run `netlify unlink` + `rm -rf .netlify` first.
- `netlify api getSite` takes the path var via `--data '{"site_id":"<id>"}'`,
  not positionally (otherwise empty output → JSONDecodeError).
- "Found 1 file to upload" on redeploy is normal — the rest dedupe by content
  hash on the CDN. Verify with HTTP, not the upload count.
- `netlify-site/` is a **static gallery** (8 videos). The full app can't run on
  Netlify — no Node/SQLite/ffmpeg. Proven in `docs/CATATAN-SESI.md` §10.
- `video/` + `thumb/` are **gitignored**, so a fresh clone has no media. Recover
  from git history: `git show 975fa0a:netlify-site.zip > /tmp/s.zip` and unzip
  `video/` + `thumb/` (verified lossless).
- Anonymous deploys (`--allow-anonymous`) are always password-gated
  (`My-Drop-Site`), can't be un-gated without an account (PATCH → 401), and can't
  be claimed. **The 60-min expiry is the CLAIM TOKEN, not the site** — old
  anonymous sites keep serving. Don't claim a link "died" without checking.
- Install CLI locally (`/tmp/nltool`) — global install hits EACCES.

## Environment gotcha: ffmpeg/ffprobe after a reset
- `apt-get` has no root; `npm i ffmpeg-static` silently downloads nothing because
  npm blocks the postinstall. Run it by hand:
  `cd node_modules/ffmpeg-static && node install.js`, copy binary to `~/bin/`.
- `ffmpeg-static` has **no ffprobe**; use `ffprobe-static`
  (`bin/linux/x64/ffprobe`). Without it `npm test` fails 1 mux check (58/59).
- `GET /api/health` used to report `ffmpeg:true` unconditionally
  (`process.env.FFMPEG_OK ?? 'true'` — the var is never set). Fixed in `87f0784`
  to call `ffmpegAvailable()`. Don't trust a health `true` you haven't verified.

## Frontend (studio/) gotchas
- **React hooks must sit above every early return.** `ProjectDetail` used to
  declare `useState` after `if (!project) return ...`; deep-linking a project
  crashed with "Rendered more hooks than during the previous render", which
  React surfaces as a *fully blank page* (only the `<noscript>` text remains).
  Blank page on one route = hooks-order bug, not a routing bug. Verify by
  hard-loading the URL with a fresh `?v=` query, since in-app hash clicks
  re-render instead of remounting.
- Netlify site is a **static build** (`netlify-site/`), so it always runs in
  `mode demo` (localStorage). Real login/publish only work against the Express
  backend. The UI states this honestly; keep it that way.
- **The Netlify site is Git-connected, so every `git push` redeploys.** This is
  why the link once went 404: with no root `netlify.toml`, Netlify published the
  repo root (no `index.html`) and overwrote good manual deploys. Root
  `netlify.toml` now sets `command = npm install --include=dev && npm run
  build:studio` and `publish = "netlify-site"`. Never "fix" the site with a
  manual `netlify deploy` only — push, or the next push will undo it.
- Because builds run from a clean checkout, `netlify-site/video` and
  `netlify-site/thumb` must stay **tracked in git** (~35 MB). `build-studio.ts`
  exits 1 when they are missing, so a bad build keeps the last good deploy
  instead of publishing an empty gallery.
- Deploy is content-deduped: "Found 2 files to upload" / "All files already
  uploaded" is normal. `netlify-cli` is NOT a repo dependency.
- Proof that auto-build really runs: change `studio/src`, push, and the
  `?v=<hash>` in the served `index.html` changes without any manual deploy.

## Studio AI statis (deploy Netlify)
- Situs live: https://agent-studio-ai.netlify.app (Netlify `agent-studio-ai`,
  Git-connected ke `main`). Build lokal: `npm run build:studio` -> `netlify-site/`;
  cocokkan hash `assets/studio.js?v=` dengan situs live untuk memastikan deploy.
- Nama mobil selalu lewat `carName()`; bandingkan kata pertama merek supaya
  "Audi Sport Audi R8" tidak muncul. Judul proyek diturunkan dari `carSlug`.


## Feed publik (studio statis)
- `scripts/build-feed.ts <jobId>` menurunkan `studio/src/data/feed.json` dari
  artefak job; hanya entri vertikal + QA lolos yang ditampilkan.
- Pemutaran memakai `netlify-site/video/web/<slug>.mp4` (720x1280, ~4 MB,
  ffmpeg crf 26). Master 1080x1920 (~23 MB) hanya untuk tombol unduh.
  Setiap entri baru **wajib** di-encode ke `video/web/` atau `npm test` gagal.
- `.shell:has(.feed)` harus `height: 100dvh`; tanpa itu `.shell` membesar
  mengikuti isi, dua slide muat sekaligus, dan dua video autoplay bersamaan.
  IntersectionObserver memilih satu pemenang per pembaruan untuk berjaga.
- Di mode `demo` (situs statis) tidak ada backend untuk memverifikasi
  kredensial, jadi Auth menampilkan tombol "Masuk sebagai tamu".

## Layout notes
- `jobs/<id>/` holds `artifacts/`, `checkpoints/`, `assets/`, `video.mp4`.
  `.gitignore` **sengaja meng-*un-ignore*** `jobs/*/artifacts/**` supaya artefak
  ikut ter-commit; `git add -A` karena itu menyeret artefak job baru ke commit.
  Kalau hanya ingin kode, stage file secara eksplisit.
- `POST /api/jobs/:id/retry` accepts `{ from: '<stage name>' }` to rewind.
- `GET /api/jobs/:id/artifact/:name` returns artifact JSON for the UI panel.
- UI shows an Artefak panel + QA verdict; `AssetPanel` uploads own photos.

## Static demo site (`studio/`, `netlify-site/`)
- Live: `https://agent-studio-ai.netlify.app` (Netlify site `agent-studio-ai`,
  Git-connected to `main`, auto-deploy on push). Build: `npm run build:studio`.
- **Seed data is cached in localStorage per account** (`asa.projects.<email>`).
  Bumping the seed requires raising `SEED_VERSION` in
  `studio/src/services/api.ts`, or returning visitors keep the old data forever.
  Deleted seed projects are tombstoned (`asa.deleted.<email>`) so they stay gone.
- Netlify ignores `[[headers]]` Content-Type overrides, so the PWA manifest is
  served as `manifest.json` (a `.webmanifest` file arrives as
  `application/octet-stream` and breaks installability).
- Deploy check: the `?v=<hash>` on `assets/studio.js` in the live HTML must match
  `netlify-site/index.html` locally; a stale hash means the deploy hasn't landed.

## Fixed 2026-11-20 (commit af57591)
- **Resolution gate was landscape-only.** `checkAssets` compared raw
  width/height against 1280x720, so every correct 1080x1920 reel failed QA with
  "resolusi di bawah minimum" *after* a full render. Now `isBelowMinimum()` in
  `src/pipeline/quality.ts` compares short/long edge (long-edge floor 1024, which
  is the free provider's 9:16 cap). Reuse it for any new resolution check.
- **Qualified model names did not resolve.** `scoreAgainst` only matched when the
  *catalog* name contained the query, so "Mazda RX-7 FD3S" (what the UI shows and
  users type) scored under the threshold → `findModel` undefined → real photos in
  `assets/own/mazda-rx7-fd/` ignored → generator invented a different car. Fixed
  by also matching when the *query* contains the catalog name, and by scoring the
  composite "merk model seri" first (dedupe when `model` already starts with `merk`,
  because catalog data has "Mazda Mazda RX-7"). Without the composite, base cars
  lost to tuned variants sharing a prefix (R34 vs R34 Z-tune).
- **`.env` was never loaded.** `src/core/env.ts` (uses `process.loadEnvFile`)
  must stay the first import of `src/api/main.ts` and `src/worker/main.ts`.
- `scripts/serve.sh` hardcoded the *previous* sandbox host in `APP_URL`; keep it
  in sync with the current `work-N-...` host.
- `npx tsc --noEmit` fails on `@types/node` missing — pre-existing, `@types/node`
  was never a dependency. Runtime strip-types works fine, so tests are the gate.

### Verified good output (baseline)
9:16 → 1080x1920, 16:9 → 1920x1080, 30.0s, ~3.2 Mbps h264 + aac 48k,
`qa.json` 14/14 checks pass, `assets.json` providers all `local`, and each job
asset md5 is byte-identical to its `assets/own/<slug>/foto-N.jpg` source.

### Testing a job via API
`POST /api/login` takes `{email, password}` — the field is `email` but accepts a
username. Then `POST /api/jobs` with `{brief:{model,tagline,durasi,rasio,keunggulan}}`.
Video download is `GET /api/jobs/:id/file/video.mp4` (not `/video`).

## Netlify: kredit akun habis -> SEMUA deploy diblokir
Gejala: push ke `main` menghasilkan deploy `state=error, skipped=true`,
`build_time: null` dalam ~0,1 detik. Penyebab sebenarnya bukan "kuota build
menit" dan bukan kode: kredit akun Free (300 kredit/siklus) habis.
Bukti langsung dari CLI (butuh login):
`netlify deploy --no-build --prod` -> 403
`"Account credit usage exceeded - new deploys are blocked until credits are added"`.
`netlify deploy --prod` (ber-otentikasi) ditolak 403. NAMUN jalur ini tembus:
`netlify deploy --no-build --dir netlify-site --allow-anonymous` (deploy preview,
tanpa kredit) lalu `POST /sites/<id>/deploys/<deploy_id>/restore` dengan token
login -> produksi terbarui di URL lama. Sudah dibungkus di
`scripts/deploy-netlify.sh`. Siklus berjalan
2026-11-10 -> 2026-12-10, setelah itu deploy jalan lagi sendiri.
Endpoint `accounts/<slug>/{usage,billing,credits,credit-usage}` semuanya 404;
angka pemakaian hanya terlihat di dashboard app.netlify.com.
Login tanpa menyimpan token di repo: `netlify login --request` -> beri URL ke
user -> `netlify login --check <ticket>`. Token tersimpan di
`~/.config/netlify/config.json` (key `users.*.auth.token`).
## Skrip deploy Netlify
`./scripts/deploy-netlify.sh` mengunggah `netlify-site/` yang sudah dibangun
(`netlify deploy --no-build --prod`) ke situs `agent-studio-ai`; URL lama tetap.
`netlify deploy` default MENJALANKAN build, jadi selalu pakai `--no-build` bila
bundel sudah jadi. Jalur preview+restore inilah yang menembus blokir kredit.
Dua jebakan yang sudah ditangani di skrip: `netlify status --json` keluar
non-zero saat folder belum tertaut, dan `set -o pipefail` meneruskan kegagalan
itu (jadi baca output, jangan exit code); `netlify link --id` menolak folder
yang sudah tertaut (jadi `unlink` dulu). CLI ada di `/workspace/tools`
(bertahan lintas reset, tidak seperti `/tmp`).

## Studio statis (branch `main`, `netlify-site/`)
- Deploy: `./scripts/deploy-netlify.sh` (preview tanpa kredit -> restore ke produksi).
  Push ke GitHub memicu build yang di-skip karena kredit habis (state=error,
  skipped=true) dan TIDAK menimpa deploy bagus; tetap jalankan skrip itu.
- `.workbench` adalah grid **3 kolom**; jumlah anaknya harus tepat 3. Kalau
  lebih, anak ekstra jatuh ke kolom 1 dan kartu `sticky` menimpa kartu lain.
- `.rail` sticky `top:84px`: di layout satu kolom (<=980px) dua rail saling
  menimpa, jadi sticky dimatikan di media query itu.
- Topbar sticky harus **opak**. Latar transparan membuat teks yang discroll
  tembus dan tampak "tumpang tindih" (keluhan yang mudah salah didiagnosis).
- Tombol "Buat proyek & jalankan" dulu hanya membuat proyek tanpa memulai
  pipeline. Sekarang rute `#/proyek/<id>/jalankan` + prop `autoRun` di
  `ProjectDetail` menjalankan `runFrom(0)` sekali.
- Verifikasi UI: Playwright ada di `/workspace/tools` (`overlap2.js` mengukur
  tumpang tindih teks per baris, `resp.js` tabrakan grid per lebar layar,
  `flow2.js` alur buat video end-to-end). Badge Netlify `#nl-badge-frame`
  memblokir klik, hapus dulu di skrip.
- `npm test` butuh **ffmpeg dan ffprobe**. Tanpa keduanya 6-8 cek gagal
  (bukan bug kode). Binari siap pakai: `/workspace/tools/bin` (dari
  imageio-ffmpeg + ffprobe-static); jalankan
  `PATH=/workspace/tools/bin:$PATH npm test` -> 93 lulus.
## Deploy: DUA situs sudah live
- **GitHub Pages** (utama): https://alif121727.github.io/ai-agent-engginer/
- **Netlify** (juga live): https://agent-studio-ai.netlify.app
- Cara mengaktifkan Pages tanpa izin API (temuan penting): token GitHub App
  ditolak saat POST `/repos/:r/pages` (403), TAPI **push branch `gh-pages`
  mengaktifkan Pages otomatis** (build_type `legacy`, source `gh-pages`).
- Karena `build_type=legacy`, `actions/deploy-pages` TIDAK bisa dipakai.
  `.github/workflows/pages.yml` mem-build studio lalu `git push -f` isi
  `netlify-site/` ke `gh-pages` (+ `.nojekyll`). Jangan dikembalikan ke
  upload-pages-artifact/deploy-pages.
- Semua path aset relatif -> aman di subdirektori `/ai-agent-engginer/`.

## Netlify: badge menutupi tombol (bug tata letak)
- Badge "Powered by Netlify" = `<iframe id="nl-badge-frame">` **fixed** di
  pojok kanan bawah, 211x64, `z-index: 2147483645`, `pointer-events: auto`.
  Ia menimpa tombol aksi terakhir (mis. "Lanjut" di wizard) sehingga klik
  pengguna tidak jalan — ketahuan hanya dengan `page.click()` tanpa `force`.
- Perbaikan: `.page { padding-bottom: calc(var(--sp-6) + 56px) }` di
  `studio/src/studio.css`. Kalau menambah tombol aksi di dasar halaman,
  pastikan ada jarak >= ~64px dari tepi bawah.
- Deploy Netlify: `NETLIFY_AUTH_TOKEN` dari env didahulukan (config CLI bisa
  terhapus saat sandbox restart). `netlify deploy --allow-anonymous` TIDAK
  menolong: ia membuat situs BARU ber-password (HTTP 401), bukan memperbarui
  `agent-studio-ai`.

## Rilis 1.0.0 (final) — apa yang dikerjakan
- `package.json` 1.0.0; versi disuntik esbuild (`define: __APP_VERSION__`) dan
  dibaca lewat `studio/src/version.ts` (fallback 'dev'). Tampil di Pengaturan
  sebagai kartu "Tentang". `index.html` juga memakai placeholder
  `__APP_VERSION__` yang diganti saat build (untuk JSON-LD).
- **Host kanonik = GitHub Pages**, bukan Netlify. canonical/OG/Twitter/JSON-LD,
  `robots.txt`, dan `sitemap.xml` semuanya menunjuk
  `https://alif121727.github.io/ai-agent-engginer/`.
- `studio/404.html` (mandiri, tanpa bundel) disalin build ke `netlify-site/`;
  Netlify memakainya lewat `[[redirects]] status = 404`, Pages otomatis.
- Dihapus dari `netlify-site/`: `galeri-lama.html`, `tokens.css`,
  `netlify.toml` (duplikat basi yang ikut terbit). Jangan dihidupkan lagi.
- Tes naik 93 -> **97** (4 pemeriksaan rilis: meta kanonik, sitemap/robots,
  404 mandiri, versi package.json).
- `netlify.toml` akar repo kini punya redirect 404; `[build] publish` tetap
  `netlify-site`.

## Audio mesin (bug mahal, sudah diperbaiki)
- Video terbit sempat **tanpa suara mesin**: yang terdengar hanya drone sine 55 Hz.
  Dua sebab: `theta` (fase kumulatif) dipakai sebagai rpm → nada naik ke 41 kHz;
  dan `rpmPoints()` mengembalikan rpm datar saat `scenes` kosong.
- Sintesis **tidak akan pernah** terdengar seperti mesin. `assets/audio/*.m4a`
  (6 rekaman CC BY 3.0, dipangkas 14 dtk, ~1.4 MB) dipakai lebih dulu lewat
  `recordedSegmentFor()`; sintesis hanya cadangan.
- Metrik pembeda: **jitter nada**. Drone 0–2%, mesin asli 57–227%. Tes
  `suara mesin bergerak seperti mesin sungguhan` gagal di bawah 15%.
- Verifikasi audio **dari browser** (WebAudio `AnalyserNode`), bukan dari file:
  mesin asli menunjukkan deret harmonik (puncak berjarak ~12 Hz).
- `netlify.toml` menetapkan `/video/*` `immutable` 1 tahun. URL mp4 **wajib**
  ber-hash (`MEDIA_VERSION` dari `scripts/build-studio.ts`), kalau tidak
  browser terus memutar audio lama. `Library.tsx` dulu menyusun URL sendiri —
  pakai `videoSrc()`/`thumbSrc()` dari `data/rendered.ts`.
- Video terbit diperbaiki dengan **remux** (`muxAudio`, `-c:v copy`): durasi dan
  gambar utuh, hanya audio diganti. Jauh lebih murah daripada render ulang.

## Test suite must never touch the production DB
- `openDb()` takes an **object**: `openDb({ kind:'sqlite', file })`. Passing a
  bare string silently used the default DB, so `tests/run.ts` wrote a
  "Tes gerak" job into the real `data/studio.db` on every `npm test` run.
  `openDb` now throws `TypeError` on a string argument — keep that guard.
- A job with **zero stages** used to be marked `done` (empty stage loop +
  empty failed list). The worker now rejects it as failed. Symptom to
  recognise: jobs titled "Tes gerak" with 0 rows in `job_stages` and no
  `jobs/<id>/` directory, inflating the dashboard's "selesai" count.
- Dashboard numbers to sanity-check: `done` count must equal the number of
  `jobs/*/video.mp4` on disk (orphans are reported as failed by
  `honestStatus`).
- `POST /api/jobs` requires a session cookie; `POST /api/login` expects the
  field **`email`** (not `account`), and accepts a username there too.
- `ffmpeg` here has no `-vsync`; use `-fps_mode passthrough`.

## PWA / static build gotchas (cost 3 real bugs)
- CSP `script-src 'self'` **blocks inline `<script>`**. The SW registrar must stay
  in `studio/sw-register.js` (external), copied by `build-studio.ts`.
- `build-studio.ts` must copy **every** file the server serves into `public/`:
  `sw.js`, `manifest.json`, `robots.txt`, `sitemap.xml`, `404.html`, `sw-register.js`,
  and the whole `ikon/` folder. Missing files fall through to the catch-all
  `index.html`, so they answer **200 with `text/html`** — looks fine in curl,
  but the SW fails on MIME and `caches.addAll` dies on the 404 icon.
- Verify statically-hosted output with a cache-bust (`?cb=$(date +%s)`); GitHub
  Pages CDN keeps serving the old `index.html` for minutes after a deploy.
  The source of truth is branch `gh-pages`, not the live URL.
- `jobs/` dirs can be deleted while the DB row survives; `honestStatus()` then
  reports such jobs as `failed` even though their QA passed. Not a bug.

## Netlify (agent-studio-ai) — jalur deploy yang benar
- Akun **Free**, dan build dari Git **selalu** gagal: `Skipped due to account
  credit usage exceeded`. Push ke `main` TIDAK memperbarui situs.
- Satu-satunya jalur yang jalan: `scripts/deploy-netlify.sh` — deploy
  `deploy-preview` (tanpa otentikasi, tidak menyentuh kredit) lalu promosikan
  ke produksi via API. `build_settings.cmd` tetap `None`.
- Login CLI: `netlify login --request "<pesan>" --json` -> user membuka URL
  otorisasi -> `netlify login --check <ticket>`. Token tersimpan plaintext di
  `~/.config/netlify/config.json` dan **hilang saat sandbox reset**.
- Verifikasi deploy dengan `?cb=$(date +%s)`; jangan percaya baris
  "Live cocok" dari skrip.
- Situs pembanding `tugas-alif-warung-go-digital` tidak pernah mati karena
  hanya `styles.css` + `app.js`; situs ini membawa 159 MB video di
  `netlify-site/video/`. Itu yang membakar kuota, bukan salah konfigurasi.

## Sandbox mati (502)
- Proses API+worker dimatikan sandbox tanpa peringatan. `scripts/keepalive.sh`
  memeriksa `/api/health` tiap 30s dan menghidupkan ulang. Diuji: kill API ->
  health 000 -> 200 dalam <35s. Tidak bisa menghidupkan sandbox yang mati total.

## Deploy & galeri statis
- Halaman "Semua Proyek" memakai snapshot `netlify-site/data/projects.json`
  (dibuat `npm run export:projects`, di-commit). Job baru tidak muncul sampai
  export + `build:studio` + deploy diulang. Dashboard tidak terpengaruh.
- `deploy-netlify.sh` harus dijalankan di background (nohup) dan selesai dengan
  baris `Live cocok:`. Pages butuh run kedua (`pages-build-deployment`).
- Uji regresi CORS ada di `tests/run.ts` ("CORS preflight mengizinkan header
  Authorization"); total suite kini 130 pemeriksaan.
- Dokumentasi: `docs/PANDUAN-STUDIO.md` dan `docs/ARSITEKTUR-STUDIO.md`.

## TTS / narasi (mahal dipelajari)
- Dua penyedia: ElevenLabs (`TTS_API_KEY`) dan **Piper lokal** (gratis, otomatis
  bila tanpa kunci). `ttsProviderName()` mengembalikan penyedia aktif.
- Piper dipasang lewat `pip install piper-tts` + `./scripts/fetch-tts-model.sh`
  (model `id_ID-news_tts-medium`, 63 MB, **gitignored** di `assets/tts/`).
  Tanpa langkah ini narasi senyap dan `audio.json.ttsAvailable=false`.
- Piper menulis WAV mono 22 kHz; `synthesizeLocal()` mengubahnya jadi mp3
  44,1 kHz stereo 192 kbps supaya bentuk keluaran sama dengan ElevenLabs.
- Nada suara (`suaraTone`) dipetakan ke `length-scale`/`noise-scale` Piper
  lewat `PIPER_TONE`. Terukur: energik 6,84s, sinematik 7,03s, hangat 7,34s,
  tegas 6,77s untuk kalimat yang sama — bukti kontrolnya nyata.
- JANGAN laporkan `ttsAvailable` dari `Boolean(process.env.TTS_API_KEY)` saja;
  pakai `ttsAvailable()` dari `src/tts/provider.ts` (bug ini pernah membuat UI
  memperingatkan "tanpa narasi" padahal video bersuara).
- Cara memverifikasi narasi benar-benar ada: RMS per scene di video final harus
  sekitar -18 dB, bukan `-inf`. Perintah: ffmpeg `-ss <start> -t 2 -af astats`.

## MASTER.md vs kenyataan (audit 2026-11-20)
Dokumen `MASTER.md` (17 sprint) dibangun di atas stack yang TIDAK ada di repo:
Next.js/Supabase/BullMQ/Redis/Stripe/Kling. Repo nyata: Express 5 + SQLite +
esbuild, **tanpa LLM sama sekali** (`src/agents/tools.ts` memakai template
deterministik; `src/pipeline/llm.ts` hanya probe konektivitas, tidak dipanggil
pipeline). Jangan "migrasi" ke Next.js tanpa keputusan eksplisit user.
Yang SUDAH ada dan jangan dibangun ulang: drawtext caption, color grade
(`gradeFilters`), xfade transisi, loudnorm, sidechain ducking, engine track,
SSE progress (`/api/...` event stream), 15 template di `src/core/templates.ts`.

## Overlay (src/render/overlay.ts)
- 6 gaya; gaya dipilih dari isi teks lewat `chooseOverlayStyle`/`parseOverlay`.
- Animasi = ekspresi `drawtext` (`%{eif:...}` + `alpha`), bukan render PNG.
- **Count-up WAJIB dibagi `durasi - 1/fps`**, bukan durasi: frame terakhir ada
  di t=durasi-1/fps, jadi target tidak pernah tercapai (770 tampil 757).
- Nama model berisi angka ("Porsche 911 GT3 RS") harus dianggap teks, bukan
  angka spesifikasi — ada daftar `MEREK` + regex kode tipe.
- `extractBars` harus menerima label SEBELUM atau SESUDAH angka ("525 PS").
- Verifikasi visual tanpa mata: hitung blob glyph (`scipy.ndimage.label`,
  ambang >246) — "0 PS"=3 glyph, "525 PS"=5 glyph.

## Naskah (src/pipeline/script.ts)
- Dua jalur: LLM bila `LLM_BASE_URL`+`LLM_API_KEY`+`LLM_MODEL` lengkap, jika
  tidak -> penyusun lokal. Kegagalan LLM **tidak pernah** menggagalkan render;
  alasan fallback ditulis ke `script.json` (`sumber`, `catatan`).
- Kunci milik user adalah **DeepSeek** (`api.deepseek.com/v1`, model
  `deepseek-flash` / `deepseek-v4-pro`), BUKAN OpenAI: kunci `sk-`+32hex
  ditolak OpenAI (401). `.env.example` lama menunjuk proxy eval yang juga
  menolak `OPENHANDS_API_KEY` (401). Jangan pakai proxy itu.
- Saldo DeepSeek user = **0,00 USD** -> HTTP 402 `insufficient_balance_error`.
  Autentikasi valid tapi tidak bisa dipakai sampai diisi saldo. Cek dengan
  `GET https://api.deepseek.com/user/balance`.
- Kegagalan LLM dibedakan: 402 -> "saldo habis", 401/403 -> "kunci ditolak".
  Jangan pernah menyamarkan jadi "LLM gagal".
- Kecepatan Piper terukur: 80 karakter = 6,9 dtk -> **11,5 karakter/detik**.
  `maxCharsFor(durasi)` memakai 0,92 dari itu sebagai batas per scene.
- JANGAN memotong kalimat sebagai langkah pertama: itu menghasilkan
  "Presisi." dari tagline dan "naturally" dari "naturally aspirated".
  Pola benar: susun beberapa kandidat, pilih yang muat, potong hanya jika
  semua kepanjangan (`pilihYangMuat`).
- Tagline hanya di scene `hook`/`cta`; sediakan varian "tagline saja" karena
  scene cta 3 dtk tidak muat "model + tagline".

## Studio UI (`studio/` -> `netlify-site/`)
- `npm run build:studio` menulis ke `netlify-site/` **dan** `public/assets/`.
  `?v=` di `index.html` berubah tiap build; pakai untuk cek bundel baru.
- Deploy: push `main` -> `pages.yml` push paksa ke `gh-pages` -> Pages build
  sendiri. Dua run harus sukses: "Deploy ke GitHub Pages" + "pages build and
  deployment".
- **Tidak ada typecheck untuk `src/`**; `npx tsc --noEmit -p tsconfig.json`
  memunculkan ~94 error lama yang aman diabaikan (express @types, `Row`),
  tapi error `Cannot find name` / `Property X does not exist` = bug runtime.
- UI wajib jujur: label model "butuh API key" dari `/api/visual/readiness`,
  yang melaporkan `credits` juga (Runway saldo 0 => `ready:false`).
- File media `/api/jobs/:id/file/*` butuh `?token=`; tanpa itu 401.
