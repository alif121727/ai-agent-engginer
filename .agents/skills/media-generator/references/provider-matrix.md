# Matriks Penyedia

Perbandingan penyedia media generatif yang umum dipakai lewat API. Angka harga
dan batas kuota berubah cepat — **periksa dokumentasi resmi penyedia sebelum
menjanjikan apa pun ke pengguna**. Tabel ini untuk memilih arah, bukan untuk
kutipan harga.

## Video

| Penyedia | Kekuatan | Bentuk permintaan | Bentuk respons | Catatan |
|---|---|---|---|---|
| Runway (Gen-4) | gerakan kamera sinematik | `POST` prompt + `duration` | url klip, terkadang perlu polling | kredit per detik; hasil 5–10 dtk |
| HeyGen | avatar/talking head, teks ke video presenter | `POST` skrip + avatar id | id tugas → polling → url | butuh avatar dan suara terdaftar |
| Kling | gerak fisik realistis, image-to-video | `POST` prompt + gambar acuan | id tugas → polling → url | image-to-video jauh lebih stabil |
| WideCast / endpoint internal | sesuai kontrak internal | `POST` `VIDEO_PROVIDER_URL` | `{ "url": ... }` | dipakai repo studio otomotif ini |

Pola umum: permintaan pertama mengembalikan **id tugas**, bukan berkas. Siapkan
polling dengan batas waktu dan hentikan bila status `failed`. Skrip
`generate_media.py` punya `--poll-url` untuk ini.

## Gambar

| Penyedia | Kekuatan | Bentuk permintaan | Bentuk respons | Catatan |
|---|---|---|---|---|
| DALL·E | prompt bahasa alami, aman untuk produk | `POST` `prompt`, `size`, `n` | `data[0].url` atau `b64_json` | menolak prompt bermerek |
| Stable Diffusion (API) | kontrol gaya via model/seed | `POST` `prompt`, `negative_prompt`, `steps` | `b64_json` | butuh prompt negatif untuk hasil bersih |
| Flux | detail dan teks dalam gambar | `POST` `prompt`, `aspect_ratio` | `url` | baik untuk tipografi produk |
| Midjourney (via API pihak ketiga) | estetika khas | `POST` `prompt` | url setelah tugas selesai | bukan API resmi; syarat layanan berbeda |

## Hal yang wajib diperiksa sebelum memanggil

1. **Rasio yang didukung.** Tidak semua penyedia menerima `9:16`; sebagian
   hanya `1:1`, `16:9`, `9:16`, `3:2`. Rasio tak didukung biasanya jadi 400.
2. **Durasi.** Video umumnya 5 atau 10 detik. Meminta 30 detik dari satu
   permintaan sering ditolak; sambung beberapa klip dengan `ffmpeg`.
3. **Format hasil.** Sebagian mengembalikan `b64_json`, sebagian `url`. Unduh
   `url` segera — banyak yang kedaluwarsa dalam hitungan jam.
4. **Konten yang ditolak.** Wajah orang nyata, merek dagang, dan kekerasan
   hampir selalu difilter. Gagal filter = 400, bukan kesalahan kunci.
5. **Batas laju.** Bila ada header `Retry-After`, patuhi; jangan mengulang
   beruntun.

## Menyambung klip video pendek

Bila pengguna minta durasi lebih panjang daripada batas penyedia, buat beberapa
klip lalu gabungkan:

```bash
printf "file '%s'\n" klip-1.mp4 klip-2.mp4 > daftar.txt
ffmpeg -y -f concat -safe 0 -i daftar.txt -c copy output/gabungan.mp4
```

Untuk hasil yang mulus, minta klip dengan gerakan yang saling melanjutkan, dan
pakai `-c copy` hanya bila codec serta resolusinya sama.

## Env yang dibaca repo studio otomotif

| Variabel | Fungsi |
|---|---|
| `IMAGE_PROVIDER_URL` | endpoint generator gambar |
| `IMAGE_PROVIDER_API_KEY` | kunci generator gambar |
| `VIDEO_PROVIDER_URL` | endpoint generator video |
| `VIDEO_PROVIDER_API_KEY` | kunci generator video |
| `STOCK_API_KEY` | stok foto/video berlisensi (Pexels) |

Adapter di `src/visuals/adapters.ts` sudah menangani bentuk `data[0].url`,
`data[0].b64_json`, dan `{ url }`, jadi mengganti vendor cukup dengan mengubah
URL dan kunci — tanpa menyentuh kode.
