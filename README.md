# MIDNIGHT RUN — OpenHand AI Production Package

Paket produksi video AI otomotif berdurasi target 40 detik.

## Konsep
- Kendaraan: Toyota GR Supra MK5, Obsidian Black Metallic
- Gaya: ultra-realistic cinematic automotive commercial
- Latar: kota metropolitan pada malam hari, jalan basah, gedung bercahaya, lalu lintas CGI terkontrol
- Platform generasi: Runway Image-to-Video (model/fitur mengikuti ketersediaan akun)
- Editing: CapCut Desktop atau editor video lain
- Target output: 3840x2160 (4K upscale), 16:9, 24 FPS, MP4

## Isi paket
- `01_PROMPTS/`: prompt gambar referensi, prompt global konsistensi, pencahayaan, interior, dan enam prompt video.
- `02_STORYBOARD/`: storyboard 40 detik dan shot list CSV.
- `03_WORKFLOW/`: tutorial langkah demi langkah dan checklist produksi.
- `04_ASSETS_PLACEHOLDER/`: tempat menyimpan gambar referensi dan klip hasil generasi.

## Cara memakai di OpenHand AI
1. Ekstrak ZIP ini.
2. Buka folder hasil ekstraksi sebagai workspace/proyek di OpenHand AI.
3. Mulai dari `03_WORKFLOW/OPENHAND_AI_TASK.md`.
4. Gunakan prompt dalam `01_PROMPTS/` sesuai urutan scene.
5. Simpan gambar dan video hasil generasi ke folder placeholder yang sesuai.
6. Gabungkan klip mengikuti storyboard.
7. Periksa konsistensi kendaraan dan kualitas sebelum export.

Catatan: paket ini berisi prompt, storyboard, instruksi, dan struktur folder. Paket ini tidak berisi model 3D Toyota, gambar referensi hasil generasi, atau video final. Buat/unduh aset tersebut secara terpisah dan pastikan lisensinya mengizinkan penggunaan yang direncanakan.

## Konsistensi dan keselamatan visual
Semua adegan lalu lintas merupakan simulasi CGI. Buat gerakan kendaraan terkontrol, jaga jarak antarkendaraan, hindari tabrakan, dan jangan menjadikan adegan sebagai instruksi berkendara di jalan umum.
