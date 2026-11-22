# Matriks Penyedia Animasi & VFX

Panduan arah, bukan kutipan resmi. **Kemampuan, nama model, dan harga penyedia
video berubah sangat cepat.** Sebelum menyebut versi model atau menjanjikan
durasi, buka dokumentasi resmi penyedia saat itu juga.

## Peta kekuatan

| Penyedia | Umumnya kuat untuk | Catatan |
|---|---|---|
| PixVerse | karakter anime, aksi rumit, pustaka efek siap pakai | ada mode efek partikel dan cahaya |
| Vidu | konsistensi karakter antar shot, storyboard anime | berguna untuk cerita berkelanjutan |
| Kling | gerak fisik realistis, image-to-video stabil | bagus untuk adegan aksi |
| Seedance | animasi umum, gerak kamera sinematik | — |
| Runway | kontrol kamera dan gerak sinematik | — |
| Luma Dream Machine | gerak kamera halus, feel filmis | — |
| Pika | efek lucu/stylized, cepat | — |
| WaveSpeedAI | simulasi fisik: ledakan, asap, pecahan | fokus efek, bukan karakter |

Penyedia yang mengkhususkan diri pada karakter anime biasanya lebih baik untuk
konsistensi tokoh, tetapi kurang kuat untuk simulasi fisik. Sebaliknya, penyedia
yang kuat di simulasi fisik sering membuat karakter anime terlihat kaku.

## Pola permintaan yang umum

Hampir semua penyedia video memakai salah satu dari dua pola:

**Pola langsung** — satu permintaan, langsung dapat URL:

```json
POST /generate
{ "model": "...", "prompt": "...", "aspect_ratio": "16:9", "duration": 5 }
-> { "url": "https://.../clip.mp4" }
```

**Pola tugas asinkron** — permintaan pertama mengembalikan id, hasil diambil
lewat polling:

```json
POST /generate  -> { "task_id": "abc123", "status": "queued" }
GET  /tasks/abc123 -> { "status": "processing" }
GET  /tasks/abc123 -> { "status": "done", "url": "https://.../clip.mp4" }
```

Skrip `generate_media.py` menangani pola pertama secara langsung, dan pola kedua
lewat `--poll-url`. Selalu beri batas waktu; jangan menunggu tanpa henti.

## Image-to-video vs text-to-video

| Aspek | Text-to-video | Image-to-video |
|---|---|---|
| Konsistensi karakter | rendah, tiap klip bisa beda | tinggi, mengikuti gambar acuan |
| Kontrol komposisi | hanya lewat prompt | kuat, mengikuti gambar |
| Cocok untuk | efek lepas, latar, transisi | karakter berulang, produk, adegan berlanjut |
| Prompt yang tepat | deskripsi lengkap adegan + gerakan | **gerakan saja**, jangan ulang deskripsi gambar |

Untuk VFX di atas karakter yang harus tetap sama, buat dulu satu gambar acuan,
lalu hasilkan klip image-to-video dengan prompt gerakan. Prompt yang
mendeskripsikan ulang gambar acuan membuat model menggambar ulang semuanya dan
klip jadi nyaris beku — ini penyebab paling sering klip "diam".

## Menyambung klip jadi durasi panjang

Batas umum satu permintaan adalah 5–10 detik. Untuk adegan lebih panjang:

```bash
printf "file '%s'\n" klip-1.mp4 klip-2.mp4 klip-3.mp4 > daftar.txt
ffmpeg -y -f concat -safe 0 -i daftar.txt -c copy output/gabungan.mp4
```

`-c copy` hanya aman bila semua klip punya codec, resolusi, dan fps yang sama.
Bila berbeda, encode ulang:

```bash
ffmpeg -y -f concat -safe 0 -i daftar.txt \
  -c:v libx264 -crf 20 -pix_fmt yuv420p -c:a aac output/gabungan.mp4
```

Untuk transisi halus antar klip, akhiri klip pertama dengan gerakan yang
melanjutkan awal klip kedua (misal kamera masih bergerak ke arah yang sama).

## Hal yang wajib diperiksa

1. **Rasio yang didukung.** Tidak semua menerima `9:16`.
2. **Durasi.** 5 atau 10 detik biasanya; minta 30 detik dari satu permintaan
   sering ditolak.
3. **Ketersediaan air/video bersuara.** Sebagian penyedia video generatif tidak
   menghasilkan audio sama sekali. Bila pengguna butuh suara, itu langkah
   terpisah (TTS + musik), bukan bagian dari klip.
4. **Kedaluwarsa URL.** Unduh segera; banyak URL hasil kedaluwarsa dalam jam.
5. **Batas laju.** Patuhi header `Retry-After` bila ada.

## Env yang dibaca repo studio otomotif

| Variabel | Fungsi |
|---|---|
| `VIDEO_PROVIDER_URL` | endpoint generator video |
| `VIDEO_PROVIDER_API_KEY` | kunci generator video |
| `IMAGE_PROVIDER_URL` | endpoint generator gambar (untuk gambar acuan) |
| `IMAGE_PROVIDER_API_KEY` | kunci generator gambar |

`src/visuals/adapters.ts` sudah menangani bentuk `{ url }` dan
`data[0].url` / `data[0].b64_json`, jadi mengganti vendor cukup mengubah URL
dan kunci.
