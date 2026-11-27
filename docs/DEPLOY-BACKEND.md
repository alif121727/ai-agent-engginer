# Deploy backend (render sungguhan)

Situs GitHub Pages hanya berisi UI. Video **tidak** bisa dirender di sana:
render butuh ffmpeg, Piper (narasi), worker, dan SQLite. Semua itu ada di
image Docker repo ini (`Dockerfile`), dan sudah diuji end-to-end.

## Bukti image ini bekerja

Dibangun lokal (`docker build -t ai-studio-otomotif .`, 1,89 GB) lalu
dijalankan dengan volume kosong:

| Pemeriksaan | Hasil |
| --- | --- |
| `GET /api/health` | `{"ok":true,"connection":"ONLINE","db":"sqlite","ffmpeg":true}` |
| `ffmpeg` / `piper` di dalam image | `/usr/bin/ffmpeg`, `/usr/local/bin/piper` |
| Model TTS | `assets/tts/id_ID-news_tts-medium.onnx` (61 MB) ikut ter-bake |
| Render 30 dtk (Porsche 911 GT3 RS) | selesai, 9/9 tahap `done` |
| QA | 26/26 lulus, 0 gagal |
| Berkas video | h264 1920×1080 + AAC stereo, 30,03 dtk, 28,7 MB |
| Narasi benar-benar ada | RMS audio −19,2 dB (bukan senyap) |

Artinya: container ini bisa langsung dipakai host mana pun yang mendukung
Docker + volume persisten.

## Yang wajib persisten

| Path | Isi |
| --- | --- |
| `/data/data/studio.db` | akun, sesi, daftar job |
| `/data/jobs/<id>/` | artefak, audio, `video.mp4` |

Keduanya diarahkan lewat `STUDIO_DATA_DIR=/data` (lihat `src/core/fsx.ts`).
Tanpa volume, semua akun dan video hilang setiap restart/deploy.

## Variabel lingkungan

| Variabel | Nilai | Kenapa |
| --- | --- | --- |
| `PORT` | `8080` | Port yang dibaca `src/api/main.ts` |
| `SESSION_SECRET` | acak ≥ 32 karakter | Tanda tangan sesi & tautan media |
| `STUDIO_DATA_DIR` | `/data` | Menyatukan DB + jobs di volume |
| `DB_KIND` | `sqlite` | Cukup untuk satu mesin |
| `DB_PATH` | `/data/data/studio.db` | Lokasi DB di volume |
| `WORKER_IN_PROCESS` | `1` | Worker ikut proses API (host satu container) |
| `CORS_ORIGINS` | `https://alif121727.github.io,https://agent-studio-ai.netlify.app` | UI statis boleh memanggil API |
| `APP_URL` | URL publik backend | Dipakai tautan absolut & HSTS |

Opsional: `TTS_API_KEY` (ElevenLabs) kalau ingin suara cloud; tanpa itu Piper
lokal yang dipakai. `LLM_BASE_URL`/`LLM_API_KEY`/`LLM_MODEL` untuk naskah LLM
(tanpa itu naskah disusun lokal dan dicatat di `script.json`).

## Render (paling sederhana)

1. Render Dashboard → **New → Blueprint** → pilih repo ini.
   `render.yaml` sudah berisi service, disk 10 GB di `/var/data`, dan env.
2. Set `APP_URL` ke URL service setelah dibuat (mis. `https://studio-ai-otomotif.onrender.com`).
3. Tunggu build (~10 menit pertama), lalu buka `/api/health`.
4. Akun pertama: buka UI → **Daftar** (setup hanya terbuka saat belum ada akun).

Catatan biaya: disk persisten hanya ada di paket berbayar. Free tier akan
menghapus akun + video setiap restart.

## Fly.io

```bash
fly launch --no-deploy --copy-config      # memakai fly.toml
fly volumes create studio_data --size 10 --region sin
fly secrets set SESSION_SECRET=$(openssl rand -hex 32)
fly deploy
fly open /api/health
```

`fly.toml` memakai satu volume di `/data` dan `WORKER_IN_PROCESS=1`.

## Railway

1. **New Project → Deploy from GitHub repo** (Railway membaca `railway.toml`).
2. Tambahkan **Volume** dengan mount path `/data`.
3. Isi variabel dari tabel di atas (`SESSION_SECRET` acak, `STUDIO_DATA_DIR=/data`).
4. Healthcheck `/api/health` sudah diatur di `railway.toml`.

## VPS sendiri (docker compose)

```bash
cp .env.example .env      # isi SESSION_SECRET, CORS_ORIGINS, APP_URL
docker compose up -d --build
curl localhost:8080/api/health
```

`docker-compose.yml` memasang `./data`, `./jobs`, `./assets` sebagai volume,
jadi data tetap ada saat container dibuat ulang. Pasang reverse proxy
(Caddy/Nginx) untuk HTTPS.

## Menyambungkan situs Pages ke backend baru

Tiga cara, pilih satu:

1. **Variabel repo** `STUDIO_URL` = `https://backend-anda` (Settings → Secrets
   and variables → Actions → Variables). Workflow Pages membekukannya ke bundel
   saat build berikutnya.
2. **URL langsung**: `https://alif121727.github.io/ai-agent-engginer/?backend=https://backend-anda`
   — alamat disimpan di peramban setelah probe berhasil.
3. **UI**: menu **Pengaturan → Alamat backend → Sambungkan**.

Kalau backend mati, studio menampilkan bilah merah "Backend tidak terjangkau"
dan **tidak** berpindah ke data simulasi.

## Mengganti kata sandi di server

```bash
docker exec -it <container> node --experimental-strip-types scripts/reset-password.ts admin@studio.id <password-baru> admin123
```

Argumen ketiga opsional: username baru. Akun di DB sandbox saat ini:
`admin@studio.id` / username `admin123` / kata sandi `alif121727`.

## Memeriksa hasil render tanpa membuka UI

```bash
curl -s -H "authorization: Bearer $TOKEN" "$BASE/api/jobs/<id>" | jq '.job.status, .stages'
ffprobe -v error -show_entries format=duration -show_entries stream=codec_name "$STUDIO_DATA_DIR/jobs/<id>/video.mp4"
```
