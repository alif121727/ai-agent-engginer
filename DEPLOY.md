# Deploy — Agent Studio AI Otomotif

Dua situs menjalankan build yang sama (`netlify-site/`):

| Situs | URL | Deploy |
| --- | --- | --- |
| **GitHub Pages** (kanonik) | https://alif121727.github.io/ai-agent-engginer/ | Otomatis: workflow `.github/workflows/pages.yml` |
| Netlify (cermin) | https://agent-studio-ai.netlify.app | Manual: `./scripts/deploy-netlify.sh` |

URL kanonik (canonical, Open Graph, `sitemap.xml`) menunjuk GitHub Pages karena
situs itu permanen dan tidak memakai kredit. Netlify tetap disajikan penuh,
hanya tidak dijadikan kanonik.

## GitHub Pages (jalur utama)

Pages di repo ini berjalan dalam mode **legacy**: sumbernya branch `gh-pages`,
bukan artifact Actions. Karena itu `actions/deploy-pages` tidak dipakai.
Workflow mem-build studio lalu `git push -f` isi `netlify-site/` ke `gh-pages`.

Mengaktifkan Pages pertama kali tidak butuh klik manual: cukup push branch
bernama `gh-pages`. Token GitHub App di lingkungan ini ditolak saat
`POST /repos/:r/pages` (403), tetapi push `gh-pages` membuat GitHub
mengaktifkan Pages sendiri.

## Netlify

### Cara kerja

Repo ini tersambung ke situs Netlify `agent-studio-ai` (site id
`7c88850b-1563-4372-a2b9-f4aa1240c20d`). Setiap `git push` ke `main` memicu
build Netlify memakai `netlify.toml` di akar repo:

```toml
[build]
  command = "npm ci && npm run build:studio"
  publish = "netlify-site"
```

`npm run build:studio` menjalankan `scripts/build-studio.ts`, yang:

1. membundel `studio/src/main.tsx` dengan esbuild ke `netlify-site/assets/`,
   dengan hash `?v=` supaya peramban tidak memakai JS lama;
2. **gagal keras** kalau berkas media di `netlify-site/video` atau
   `netlify-site/thumb` tidak lengkap — supaya situs tidak pernah terbit tanpa
   video;
3. mencetak hash bundel, jadi log build bisa dipakai memastikan versi baru.

Tidak ada deploy manual. `netlify deploy` tidak diperlukan dan token CLI tidak
disimpan di repo.

## Berkas yang disajikan

| Path | Isi |
| --- | --- |
| `/` | aplikasi (`studio/index.html`) |
| `/assets/studio.js`, `/assets/studio.css` | bundel hasil esbuild |
| `/video/*.mp4`, `/thumb/*.jpg` | 8 video hasil render nyata + poster |
| `/manifest.json`, `/sw.js`, `/ikon/*` | PWA (bisa dipasang di ponsel) |
| `/robots.txt`, `/sitemap.xml` | SEO dasar (menunjuk URL kanonik) |
| `/404.html` | Halaman 404 statis, dipakai Netlify maupun Pages |

`netlify.toml` mengatur cache: aset ber-hash dan media di-cache lama,
`index.html` dan `sw.js` selalu divalidasi ulang.

## Menambah video baru

1. Render job seperti biasa, lalu salin `video.mp4` ke
   `netlify-site/video/<slug>.mp4` dan posternya ke
   `netlify-site/thumb/<slug>.jpg`.
2. Tambahkan satu entri di `studio/src/data/rendered.ts` (`RECORDED`). Angka
   durasi/resolusi/QA harus disalin dari `jobs/<id>/artifacts/*.json`, bukan
   diperkirakan.
3. Kalau model punya entri di `config/catalog.json`, isi `catalogSlug`. Kalau
   tidak, beri `specsFallback` dan tandai `qa: 'tanpa-foto'` bila memang tidak
   memakai foto asli.
4. `npm test` — tes akan menolak spesifikasi yang tidak ada di katalog, video
   yang berkasnya hilang, dan durasi di bawah 30 detik.

## Backend (render sungguhan)

Situs statis tidak bisa merender video. Backend ada di image Docker repo ini
(`Dockerfile`) dan sudah diuji: health OK, ffmpeg + Piper terpasang, render
30 dtk 9/9 tahap selesai, QA 26/26 lulus, narasi RMS −19,2 dB.

Langkah deploy per host (Render, Fly.io, Railway, VPS), tabel variabel
lingkungan, dan cara menyambungkan Pages ke backend baru ada di
**[docs/DEPLOY-BACKEND.md](docs/DEPLOY-BACKEND.md)**.

Ringkas:

- `render.yaml` — blueprint Render dengan disk 10 GB di `/var/data`.
- `fly.toml` — satu mesin + volume `/data`.
- `railway.toml` — build dari Dockerfile, healthcheck `/api/health`.
- `.github/workflows/image.yml` — publikasi image ke GHCR (manual / tag `v*`).

UI tidak pernah lagi berpindah ke data simulasi: kalau backend tidak menjawab,
muncul bilah merah berisi alamat backend dan tombol coba lagi.

## Kalau situs 404

Penyebab yang pernah terjadi: `netlify.toml` tidak ada di akar repo, sehingga
Netlify memakai direktori akar sebagai publish dan tidak menemukan
`index.html`. Pastikan `netlify.toml` ada, `publish = "netlify-site"`, dan
build log berakhir dengan baris `✓ studio dibangun: …`.
