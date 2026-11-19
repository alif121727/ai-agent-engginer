# Cara unggah galeri ini ke Netlify

Isi folder ini adalah situs statis murni — tanpa build, tanpa backend.

## Cara 1 — drag & drop (paling cepat)
1. Buka https://app.netlify.com/drop
2. Seret **folder `netlify-site`** (bukan isi di dalamnya) ke halaman itu.
3. Selesai. Netlify memberi URL acak; ganti nama situs di
   Site configuration → Change site name → `agent-studio-ai`
   agar cocok dengan https://agent-studio-ai.netlify.app

## Cara 2 — lewat CLI
```bash
npm i -g netlify-cli
netlify login
cd netlify-site
netlify deploy --prod --dir .
```

## Kalau ingin memperbarui video
Video di `video/` adalah versi 720p (total ~35 MB). Sumber 1080p ada di
`jobs/<id>/video.mp4`. Untuk mengganti satu video:

```bash
ffmpeg -y -i jobs/<id>/video.mp4 -vf scale=-2:720 -c:v libx264 -crf 27 \
  -preset medium -c:a aac -b:a 96k -movflags +faststart \
  netlify-site/video/<nama>.mp4
```

## Catatan penting
Ini **hanya galeri**. Aplikasi penuh (login, buat job, render video) butuh
proses Node + ffmpeg + database, jadi tidak bisa jalan di Netlify. Untuk
aplikasi penuh, pakai host yang mendukung proses server (Render/Railway/Fly/VPS).
