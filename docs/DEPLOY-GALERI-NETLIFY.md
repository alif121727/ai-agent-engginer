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
`video/<nama>.mp4` adalah **master** hasil render apa adanya (1080p untuk
video vertikal, 720p untuk video horizontal lama). `video/web/<nama>.mp4`
adalah versi ringan yang diputar autoplay di Feed; unduhan tetap memakai
master. Untuk mengganti satu video:

```bash
# master (dipakai tombol Unduh)
ffmpeg -y -i jobs/<id>/video.mp4 -c:v libx264 -crf 23 -preset medium \
  -c:a aac -b:a 128k -movflags +faststart netlify-site/video/<nama>.mp4

# versi putar untuk Feed (wajib ada untuk setiap entri feed)
ffmpeg -y -i jobs/<id>/video.mp4 -vf scale=-2:1280 -c:v libx264 -crf 27 \
  -preset medium -c:a aac -b:a 96k -movflags +faststart \
  netlify-site/video/web/<nama>.mp4
```

Ukuran `width`/`height` di `studio/src/data/rendered.ts` harus sama dengan
dimensi berkas yang benar-benar disajikan — cek dengan `ffprobe`, jangan
disalin dari brief.

## Catatan penting
Ini **hanya galeri**. Aplikasi penuh (login, buat job, render video) butuh
proses Node + ffmpeg + database, jadi tidak bisa jalan di Netlify. Untuk
aplikasi penuh, pakai host yang mendukung proses server (Render/Railway/Fly/VPS).
