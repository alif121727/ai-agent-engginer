# Aset milik sendiri

Taruh foto/video asli kendaraan di sini, satu folder per model:

```
assets/own/ferrari-296-gtb/foto-depan.jpg
assets/own/ferrari-296-gtb/rolling.mp4
```

Nama folder = nama model yang sudah di-slug (huruf kecil, spasi jadi `-`).
Adapter `local` memakai folder ini lebih dulu sebelum generator gambar/video,
jadi hasilnya benar-benar kendaraan tersebut, bukan tafsiran AI.

Format yang didukung: `jpg`, `jpeg`, `png`, `webp`, `mp4`, `mov`.
Rekomendasi minimal 1920x1080 supaya lolos quality gate.
