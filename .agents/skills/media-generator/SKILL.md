---
name: media-generator
description: This skill should be used when the user asks to "buat video", "generate video", "buat foto", "generate foto", "buat gambar", "video promosi", "foto produk", or otherwise requests AI-generated photos or videos from a text prompt. Covers requirement gathering (aspect ratio, duration, style), provider selection, prompt construction, API calls with credentials from environment variables, and saving results to output/.
triggers:
  - buat video
  - generate video
  - bikin video
  - buat foto
  - generate foto
  - buat gambar
  - generate gambar
  - video promosi
  - foto produk
---

# Media Generator

Menghasilkan foto dan video lewat API penyedia AI generatif. Skill ini mengatur
percakapan sebelum memanggil API berbayar, menyusun prompt yang efektif, dan
menyimpan hasil ke `output/`.

## Kapan dipakai

Pakai saat pengguna meminta media visual baru dari deskripsi teks: foto produk,
gambar ilustrasi, klip pendek, video promosi. Jangan pakai untuk mengedit media
yang sudah ada, mengunduh stok foto berlisensi bebas, atau membuat diagram —
itu tugas lain.

## Alur kerja

### 1. Pastikan kebutuhannya dulu

Jangan memanggil API sebelum lima hal ini jelas. Tanyakan sekaligus dalam satu
pesan, bukan satu per satu:

| Hal | Contoh jawaban | Default bila pengguna tidak peduli |
|---|---|---|
| Jenis media | foto / video | foto |
| Rasio | 16:9, 9:16, 1:1 | 16:9 untuk video, 1:1 untuk foto produk |
| Durasi (video) | 5 dtk, 10 dtk | 5 dtk |
| Gaya visual | realistis, sinematik, flat illustration | realistis |
| Resolusi | 1080p, 4K | 1080p |

Bila pengguna sudah menyebut semuanya, lewati pertanyaan dan ulangi ringkasannya
satu baris sebelum lanjut — itu cukup untuk mengonfirmasi tanpa mengulur waktu.

### 2. Pilih penyedia

Pilih berdasarkan jenis media dan kredensial yang benar-benar tersedia di
lingkungan. Periksa dulu, jangan berasumsi:

```bash
for v in IMAGE_PROVIDER_URL VIDEO_PROVIDER_URL IMAGE_PROVIDER_API_KEY VIDEO_PROVIDER_API_KEY; do
  if [ -n "${!v}" ]; then echo "$v: terpasang"; else echo "$v: kosong"; fi
done
```

Aturan pemilihan:

- **Video** → penyedia video (Runway, HeyGen, Kling, atau endpoint internal
  lewat `VIDEO_PROVIDER_URL`).
- **Foto** → penyedia gambar (DALL·E, Stable Diffusion, Flux, atau endpoint
  lewat `IMAGE_PROVIDER_URL`).
- **Kredensial tidak ada** → jangan mengarang hasil. Jelaskan penyedia mana yang
  butuh kunci apa, lalu tawarkan pilihan: pengguna menempelkan kunci, atau
  memakai penyedia tanpa kunci bila ada.

Detail perbandingan penyedia ada di `references/provider-matrix.md`.

### 3. Susun prompt

Selalu pakai urutan ini, karena penyedia gambar memberi bobot besar pada kata
di awal:

```
[Subjek] + [Aksi/pose] + [Latar] + [Gaya] + [Pencahayaan] + [Kualitas]
```

Contoh untuk permintaan "video promosi kopi 10 detik":

```
Subjek:  secangkir kopi latte dengan latte art daun
Aksi:    uap mengepul perlahan, tangan barista menuang susu
Latar:   meja kayu gelap, biji kopi tersebar, latar bokeh kafe
Gaya:    sinematik, close-up makro
Cahaya:  cahaya jendela pagi dari samping, kontras lembut
Kualitas: 4K, detail tinggi, warna hangat, grain halus
```

Prompt akhir:

```
secangkir kopi latte dengan latte art daun, uap mengepul perlahan, tangan
barista menuang susu, meja kayu gelap dengan biji kopi tersebar, latar bokeh
kafe, sinematik close-up makro, cahaya jendela pagi dari samping, kontras
lembut, 4K, detail tinggi, warna hangat
```

Aturan tambahan:

- **Video**: deskripsikan **gerakan**, bukan ulang isi gambar. Prompt yang
  mengulang deskripsi adegan membuat klip nyaris beku.
- **Foto produk**: sebut bahan dan warna latar secara eksplisit; "putih polos"
  lebih berguna daripada "bersih".
- **Hindari** merek dagang, nama orang nyata, dan wajah selebritas.
- Prompt negatif berguna untuk membuang cacat umum: `blur, teks, watermark,
  tangan cacat, distorsi`.

Rumus lengkap dan contoh per industri ada di `references/prompt-formula.md`.

### 4. Konfirmasi sebelum biaya keluar

Sebelum memanggil API berbayar, sebutkan: penyedia, perkiraan jumlah permintaan,
dan bahwa hasilnya akan disimpan di `output/`. Tunggu persetujuan. Untuk satu
gambar uji coba, satu permintaan saja — jangan langsung membuat empat variasi.

### 5. Panggil API

Cara tercepat memakai skrip yang sudah disediakan:

```bash
python3 .agents/skills/media-generator/scripts/generate_media.py \
  --kind image \
  --prompt "secangkir kopi latte, meja kayu gelap, sinematik, 4K" \
  --aspect 1:1 \
  --out output/kopi.png
```

Skrip ini membaca `IMAGE_PROVIDER_URL` / `IMAGE_PROVIDER_API_KEY` (atau pasangan
`VIDEO_*`) dari lingkungan, menolak jalan bila kosong, dan punya `--dry-run`
untuk melihat body permintaan tanpa memanggil jaringan.

Untuk panggilan manual, bentuk umumnya:

```bash
curl -sS "$IMAGE_PROVIDER_URL" \
  -H "Authorization: Bearer $IMAGE_PROVIDER_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model":"<model>","prompt":"<prompt>","aspect_ratio":"1:1","n":1}'
```

Respons gambar biasanya berisi `data[0].url` atau `data[0].b64_json`; respons
video berisi `url` klip yang harus diunduh terpisah. Skrip menangani keduanya.

### 6. Simpan dan laporkan

- Simpan ke `output/` dengan nama deskriptif: `output/kopi-latte-1x1.png`.
- Untuk video, buat thumbnail bila `ffmpeg` tersedia:

  ```bash
  ffmpeg -y -i output/kopi.mp4 -frames:v 1 output/kopi-thumb.jpg
  ```

- Laporkan path berkas, ukuran, dan dimensi/durasi sebenarnya dari hasil
  pemeriksaan (`file`, `ffprobe`), bukan dari asumsi.
- Bila ada beberapa variasi, tampilkan semuanya dan minta pengguna memilih.

## Keamanan dan etika

- **Kunci API hanya dari lingkungan.** Jangan pernah menulis kunci ke dalam
  kode, perintah yang tercatat, atau berkas yang masuk git. Baca lewat
  `$NAMA_VAR`, jangan `echo` nilainya.
- **Jangan commit `.env`.** Pastikan `.gitignore` memuatnya sebelum menulis
  konfigurasi apa pun.
- **Konfirmasi sebelum biaya.** Setiap permintaan berbayar butuh persetujuan.
- **Hormati kuota.** Bila menerima 429, berhenti dan laporkan; jangan
  mengulang beruntun.
- **Jangan memalsukan hasil.** Kalau API gagal, sampaikan gagal. Jangan
  mengganti dengan gambar placeholder lalu menyebutnya hasil AI.
- **Hak citra.** Tolak permintaan yang meniru wajah orang nyata tanpa izin, atau
  yang membuat konten menyesatkan tentang orang/kejadian nyata.

## Pemecahan masalah

| Gejala | Sebab umum | Tindakan |
|---|---|---|
| `kunci API kosong` | env belum diisi | Minta pengguna menempelkan kunci atau set env |
| HTTP 401/403 | kunci salah atau kedaluwarsa | Minta kunci baru; jangan mengulang |
| HTTP 429 | kuota habis | Berhenti, laporkan sisa waktu tunggu bila ada |
| HTTP 400 soal prompt | prompt ditolak filter | Ringkas prompt, buang kata sensitif, coba lagi sekali |
| Hasil kosong / bukan media | bentuk respons berbeda | Periksa `references/provider-matrix.md`, sesuaikan parser |
| Video beku | prompt mendeskripsikan adegan, bukan gerakan | Tulis ulang jadi gerakan kamera + subjek |
| Berkas tidak terbuka | unduhan terpotong | Periksa ukuran, unduh ulang sekali |

Bila penyedia utama tidak tersedia, tawarkan alternatif dari
`references/provider-matrix.md` dan sebutkan perbedaan biaya/kualitasnya.

## Sumber daya

- `scripts/generate_media.py` — pemanggil API seragam untuk gambar dan video.
- `references/provider-matrix.md` — perbandingan penyedia, endpoint, bentuk
  respons, dan batas kuota.
- `references/prompt-formula.md` — rumus prompt lanjutan dan contoh per kasus.

## Berkas terkait di repo ini

Bila bekerja di proyek studio otomotif, adapter media sudah ada dan sebaiknya
dipakai daripada memanggil API langsung:

- `config/visuals.json` — daftar adapter dan urutan percobaannya.
- `src/visuals/adapters.ts` — implementasi `image-gen`, `video-gen`, `stock-api`.
- Env yang dibaca: `IMAGE_PROVIDER_URL`, `IMAGE_PROVIDER_API_KEY`,
  `VIDEO_PROVIDER_URL`, `VIDEO_PROVIDER_API_KEY`.
