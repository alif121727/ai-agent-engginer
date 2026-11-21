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

## Audio mesin

`assets/audio/` berisi rekaman mesin & knalpot asli (CC BY 3.0, Wikimedia
Commons) yang dipakai lebih dulu daripada sintesis:

- `ferrari-296.m4a` — Supercars and beyond (YouTube)
- `lamborghini-huracan-performante.m4a` — NewsTechCars (YouTube)
- `mazda-rx-7.m4a` — Taz Ringer (YouTube)
- `nissan-skyline-gt-r-r34.m4a` — Matteo Torrisi Officina Del Pilota (YouTube)
- `porsche-911-gt3-rs.m4a` — Supercars67 (YouTube)
- `subaru-wrx-sti.m4a` — Hungarian Supercar Spotters (YouTube)

Pemetaan model → berkas + titik potong ada di `assets/audio/manifest.json`.
Atribusi di atas wajib disertakan bila video dipublikasikan.

Model yang belum punya rekaman memakai sintesis cadangan di
`src/render/audio.ts`. Sintesis itu tidak pernah terdengar seperti mesin
sungguhan; anggap ia pengisi sementara, bukan pengganti rekaman.
