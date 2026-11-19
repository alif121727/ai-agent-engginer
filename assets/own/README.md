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

## Penting: berkas di sini harus foto kendaraan sungguhan

Video dirender dari berkas di folder ini apa adanya. Kalau isinya bukan foto
mobil (misalnya gambar stok acak), hasil videonya juga bukan mobil — dan QA
tidak bisa mendeteksinya karena ketajaman gambar tetap tinggi.

Foto contoh yang dipakai sekarang berasal dari Wikimedia Commons, lisensi
CC BY-SA 4.0:

- `ferrari-296-gtb`: Ferrari 296 GTB (foto 1X7A6377, 1X7A6379, DSC 6997, DSC 7011)
- `porsche-911-gt3`: Porsche 911 GT3 992 (EMS 2024, 1X7A7256, 992 GT3 touring)

Sertakan atribusi lisensi bila video dipublikasikan.
