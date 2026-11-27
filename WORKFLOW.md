# Workflow produksi untuk OpenHand AI

## Tujuan
Membuat video otomotif fiksi berdurasi 40 detik menggunakan gambar referensi dan Runway Image-to-Video, lalu menyunting klip menjadi satu video final.

## Tahap 1 — Siapkan referensi
1. Buka `01_PROMPTS/01_CAR_REFERENCE_SHEET.txt` pada generator gambar.
2. Buat gambar referensi mobil dengan sudut depan, samping, belakang, dan interior.
3. Simpan gambar terpisah ke `04_ASSETS_PLACEHOLDER/REFERENCE_IMAGES/`.
4. Pastikan semua gambar menunjukkan model dan modifikasi yang sama.
5. Gunakan sumber model 3D seperti Sketchfab atau CGTrader hanya jika diperlukan; periksa lisensi dan hak penggunaan.

## Tahap 2 — Generate enam scene
1. Buka Runway dan pilih Image-to-Video.
2. Pilih model video yang tersedia di akun.
3. Unggah gambar referensi yang paling cocok untuk scene tersebut.
4. Salin prompt scene dari `01_PROMPTS/`.
5. Tambahkan isi `03_VEHICLE_CONSISTENCY.txt` jika platform mendukung prompt tambahan.
6. Atur rasio 16:9 dan durasi klip sesuai kemampuan model. Jika durasi tepat 6 atau 7 detik tidak tersedia, hasilkan durasi terdekat lalu potong saat editing.
7. Generate satu scene dahulu, periksa hasilnya, baru lanjutkan.
8. Simpan hasil ke `04_ASSETS_PLACEHOLDER/GENERATED_CLIPS/`.

## Tahap 3 — Periksa kualitas
Periksa apakah:
- Bentuk, warna, lampu, velg, dan spoiler mobil konsisten.
- Ban berputar alami dan tetap menyentuh permukaan jalan.
- Refleksi cahaya sesuai dengan arah lingkungan.
- Dashboard dan interior tidak berubah bentuk.
- Kendaraan lain bergerak wajar dan menjaga jarak.
Jika satu klip bermasalah, ulangi klip tersebut saja.

## Tahap 4 — Audio dan editing
1. Impor enam klip ke CapCut Desktop atau editor lain.
2. Susun sesuai `02_STORYBOARD/STORYBOARD.md`.
3. Potong klip hingga total 40 detik.
4. Tambahkan ambience kota, suara mesin, dan musik instrumental orisinal/berlisensi.
5. Tambahkan judul `MIDNIGHT RUN` dan tagline `THE CITY NEVER SLEEPS` pada scene terakhir.
6. Lakukan color grading secukupnya; pertahankan detail cat hitam dan hindari highlight berlebihan.

## Tahap 5 — Export
- Format: MP4
- Aspect ratio: 16:9
- Frame rate: 24 FPS (samakan dengan timeline)
- Resolusi akhir: target 3840x2160 setelah upscale
- Codec: H.264 atau H.265
- Bitrate: sesuaikan kualitas dan ukuran file

## Catatan 4K
Periksa fitur dan batasan upscale pada paket Runway yang digunakan. Jika generasi awal bukan 4K, lakukan upscale pada hasil klip yang didukung atau gunakan upscaler video yang memiliki hak penggunaan sesuai. Upscale tidak dapat mengembalikan detail yang memang tidak ada pada sumber.

## Prompt musik
Create an original cinematic electronic instrumental soundtrack for a premium nighttime automotive commercial. Dark synthwave atmosphere, sophisticated deep bass, atmospheric synthesizers, rhythmic percussion, subtle industrial textures. Begin with mysterious city ambience, build energy through the middle, briefly reduce intensity for the interior shot, then reach a dramatic cinematic ending. No vocals, no lyrics, original composition.

## Struktur durasi
Scene 01: 6 detik
Scene 02: 6 detik
Scene 03: 7 detik
Scene 04: 7 detik
Scene 05: 7 detik
Scene 06: 7 detik
Total: 40 detik.
