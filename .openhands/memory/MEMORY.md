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

## Commands that matter
- `npm test` -> 37 checks, exits non-zero on failure.
- `npm run api` (port 8080) + `npm run worker` — both needed; jobs stall without the worker.
- `./scripts/serve.sh 12000` — starts API on the public sandbox port and the
  worker if absent, then prints health + the public URL. Public URL for port
  12000: `https://work-1-lxpwikokempxmoli.prod-runtime.all-hands.dev`
  (port 12001 maps to `work-2-...`). Logs: `/tmp/api.log`, `/tmp/worker.log`.
- `npm run build:ui` after any `ui/app.tsx` change.
- `scripts/autopush.sh` commits+pushes every 10 min (log: `/tmp/autopush.log`).

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

## Layout notes
- `jobs/<id>/` (gitignored) holds `artifacts/`, `checkpoints/`, `assets/`, `video.mp4`.
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

## Deploy Netlify bisa "di-skip" tanpa error kode
Push ke `main` bisa menghasilkan deploy `state=error, skipped=true` dalam ~0,1
detik (`build_time: null`) — build tidak pernah mulai, biasanya kuota build
menit paket gratis. Cek `GET https://api.netlify.com/api/v1/sites/<site>/deploys`
(publik, tanpa token) dan lihat `skipped` sebelum menyalahkan kode. Buktikan kode
sehat dengan clone bersih: `npm install --include=dev && npm run build:studio`.
`/deploys/<id>/log` 404 dan `/builds/<id>` 401 tanpa token. GitHub Pages diblokir
(403 "Resource not accessible by integration"). Jalur publik tanpa password:
`python3 -m http.server 12001` di `netlify-site/` -> port 12001 sandbox.

## Deploy ulang tanpa build menit
`./scripts/deploy-netlify.sh` mengunggah `netlify-site/` yang sudah dibangun
(`netlify deploy --no-build --prod`) ke situs `agent-studio-ai`, jadi URL lama
tetap dipakai dan kuota build menit tidak terpakai. Butuh `netlify login`;
tanpa kredensial pakai `netlify login --request` (tiket, user klik URL) lalu
`--check <ticket>`. `netlify deploy` default MENJALANKAN build — selalu
`--no-build` kalau bundel sudah jadi. CLI tinggal di `/workspace/tools`
(bertahan lintas reset, tidak seperti `/tmp`).
