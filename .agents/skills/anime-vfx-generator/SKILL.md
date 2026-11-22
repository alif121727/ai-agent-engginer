---
name: anime-vfx-generator
description: This skill should be used when the user asks to "buat animasi", "animasi anime", "efek khusus", "efek visual", "VFX", "ledakan", "partikel", "efek sihir", "animasi karakter", or "gerakan kamera sinematik". Generates animated objects, character motion, and cinematic special effects in anime or film style, with a VFX prompt contract (source, material, motion path, light interaction, dissipation) and provider selection guidance.
triggers:
  - buat animasi
  - animasi anime
  - efek khusus
  - efek visual
  - VFX
  - ledakan
  - partikel
  - efek sihir
  - animasi karakter
  - gerakan kamera sinematik
---

# Anime & VFX Generator

Menghasilkan animasi objek, gerakan karakter, dan efek visual sinematik bergaya
anime atau film lewat API penyedia video generatif.

## Kapan dipakai

Pakai saat pengguna meminta gerakan atau efek, bukan sekadar gambar diam:
animasi karakter, objek yang bergerak, ledakan, partikel, asap, energi, sihir,
hujan, gerakan kamera. Untuk foto atau video promosi biasa tanpa efek, pakai
skill `media-generator`.

## Prinsip yang membedakan skill ini

Efek visual gagal bukan karena modelnya lemah, tapi karena prompt-nya tidak
menyebut **asal, bahan, arah, dan akhir** efek. "Ledakan emas yang epik" tidak
memberi model apa pun untuk digambar. Kontrak VFX di bawah memaksa prompt
menjawab lima hal yang bisa digambar.

## Alur kerja

### 1. Pastikan kebutuhannya

Tanyakan sekaligus dalam satu pesan:

| Hal | Pilihan | Default |
|---|---|---|
| Jenis keluaran | animasi objek / gerakan karakter / efek (VFX) | efek |
| Gaya | anime, semi-realistis, sinematik film | anime |
| Durasi | 3–5 dtk per klip | 5 dtk |
| Rasio | 16:9, 9:16, 1:1 | 16:9 |
| Suara | perlu atau tidak | tidak |

Bila pengguna menyebut semuanya, lewati pertanyaan dan ulangi ringkasannya satu
baris sebelum lanjut.

### 2. Pilih penyedia

Periksa kredensial yang benar-benar ada sebelum menjanjikan apa pun:

```bash
for v in VIDEO_PROVIDER_URL VIDEO_PROVIDER_API_KEY ANIME_PROVIDER_URL ANIME_PROVIDER_API_KEY; do
  if [ -n "${!v}" ]; then echo "$v: terpasang"; else echo "$v: kosong"; fi
done
```

Arah pemilihan berdasarkan kekuatan yang umum dilaporkan pengguna — **bukan
jaminan**, karena kemampuan tiap penyedia berubah cepat:

| Kebutuhan | Penyedia yang biasanya kuat |
|---|---|
| Karakter anime, aksi rumit, konsistensi tokoh | PixVerse, Vidu |
| Animasi umum, gerak kamera sinematik | Kling, Seedance, Runway, Luma, Pika |
| Partikel, ledakan, simulasi fisik | WaveSpeedAI, pustaka efek PixVerse |

**Jangan menyebut nomor versi model sebagai fakta** kecuali sudah membaca
dokumentasi resmi penyedia saat itu juga. Tulis "versi terbaru menurut
dokumentasi resmi" lalu periksa. Menyebut "V5.5" atau "Gen-4" dari ingatan
berisiko menyuruh pengguna memakai model yang tidak ada.

Perbandingan lebih rinci ada di `references/provider-matrix.md`.

### 3. Susun prompt dengan kontrak VFX

Isi kelima bagian ini. Bagian yang kosong hampir selalu jadi bagian yang
terlihat salah di hasil.

| Bagian | Pertanyaan yang dijawab | Contoh |
|---|---|---|
| **Sumber** | Dari mana efek muncul? | "dari telapak tangan kanan yang terangkat" |
| **Bahan** | Terbuat dari apa? | "partikel debu emas halus, butiran 1–2 mm" |
| **Arah/gerak** | Ke mana dan secepat apa? | "berputar searah jarum jam lalu menyebar ke depan" |
| **Interaksi cahaya** | Bagaimana ia menyinari sekitar? | "memantulkan cahaya hangat ke wajah dan lengan baju" |
| **Akhir** | Bagaimana ia menghilang? | "memudar jadi asap tipis dalam 1 detik terakhir" |

Contoh lengkap untuk "animasi karakter anime berlari di atas air":

```
anime style, karakter remaja berlari cepat di atas permukaan laut, kakinya
memijak dan memantulkan air, setiap langkah memunculkan cincin riak biru
yang menyebar keluar, percikan air naik ke udara lalu jatuh kembali, partikel
cahaya biru kecil mengikuti jejak kaki, cahaya bulan memantul di percikan,
kamera tracking menyamping mengikuti karakter, gerakan cepat, latar laut
gelap dengan kabut tipis
```

Perhatikan: setiap efek punya sumber (kaki), bahan (air, riak, partikel),
arah (menyebar keluar, naik lalu jatuh), cahaya (bulan memantul), dan akhir
(partikel memudar).

### 4. Aturan timing tiga langkah

Untuk efek yang punya siklus hidup, tulis urutannya secara eksplisit:

```
terbentuk -> bergerak -> menghilang
```

- "bola energi biru terbentuk di antara kedua telapak tangan" (terbentuk)
- "melebar dan melesat ke depan, meninggalkan ekor cahaya" (bergerak)
- "pecah jadi percikan kecil lalu memudar" (menghilang)

Efek yang tidak punya akhir akan terlihat seperti lapisan tempelan yang
membeku sampai klip habis — keluhan paling umum pada VFX generatif.

### 5. Jaga identitas di area sensitif

Untuk efek di dekat wajah, tangan, atau teks:

- **Letakkan efek di sekitar objek, jangan menembusnya.** "cahaya mengelilingi
  wajah" lebih aman daripada "cahaya keluar dari wajah".
- **Sebut yang harus tetap stabil.** "wajah tetap jelas dan tidak berubah
  bentuk" membantu menahan distorsi.
- **Hindari gerakan yang memaksa model menggambar ulang wajah** dalam frame
  yang sama, seperti putaran kepala cepat disertai efek besar.

### 6. Gerakan kamera

Sebut satu gerakan saja per klip; dua gerakan berlawanan membuat hasil goyah.

| Istilah | Efek |
|---|---|
| `static shot` | kamera diam, paling aman untuk VFX |
| `push in` / `dolly in` | maju perlahan, menambah dramatisme |
| `pull back` | menjauh, cocok untuk akhir efek besar |
| `tracking` / `follow` | mengikuti subjek yang bergerak |
| `orbit` | memutari subjek |
| `tilt up` | mendongak, untuk efek menjulang |
| `handheld` | goyangan halus, terasa dokumenter |

### 7. Konfirmasi sebelum biaya keluar

Sebutkan penyedia, jumlah klip, perkiraan durasi total, dan bahwa hasil disimpan
di `output/`. Tunggu persetujuan. Mulai dari **satu klip uji**, bukan empat
variasi sekaligus — VFX mahal per detik.

### 8. Panggil API

```bash
python3 .agents/skills/anime-vfx-generator/scripts/generate_media.py \
  --kind video \
  --prompt "anime style, karakter berlari di atas air, riak biru menyebar, partikel cahaya, kamera tracking" \
  --aspect 16:9 \
  --duration 5 \
  --out output/water-run.mp4
```

Skrip membaca `VIDEO_PROVIDER_URL` dan `VIDEO_PROVIDER_API_KEY` dari lingkungan,
menolak jalan bila kosong, mendukung `--poll-url` untuk penyedia asinkron, dan
punya `--dry-run` untuk memeriksa body permintaan tanpa memanggil jaringan.

Bentuk permintaan manual:

```bash
curl -sS "$VIDEO_PROVIDER_URL" \
  -H "Authorization: Bearer $VIDEO_PROVIDER_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model":"<model>","prompt":"<prompt>","aspect_ratio":"16:9","duration":5}'
```

Untuk image-to-video (lebih stabil untuk karakter yang harus konsisten), kirim
gambar acuan di field `image`.

### 9. Simpan dan laporkan

- Simpan ke `output/` dengan nama deskriptif: `output/water-run-5s.mp4`.
- Buat thumbnail: `ffmpeg -y -i output/water-run-5s.mp4 -frames:v 1 output/water-run-thumb.jpg`
- Laporkan durasi dan resolusi **hasil pemeriksaan** `ffprobe`, bukan asumsi.
- Bila hasilnya kurang, tunjukkan apa yang berubah antar versi prompt.

## Keamanan dan etika

- **Kunci API hanya dari lingkungan.** Jangan tulis kunci di kode atau perintah
  yang tercatat. Jangan `echo` nilainya.
- **Jangan commit `.env`.** Periksa `.gitignore` sebelum menulis konfigurasi.
- **Konfirmasi sebelum biaya.** Setiap klip berbayar butuh persetujuan.
- **Hormati kuota.** Bila 429, berhenti dan laporkan; jangan mengulang beruntun.
- **Jangan meniru orang nyata.** Tolak permintaan animasi wajah orang tertentu
  tanpa izin, atau konten yang menyesatkan tentang orang/kejadian nyata.
- **Jangan memalsukan hasil.** Gagal berarti gagal; jangan ganti dengan klip
  placeholder lalu menyebutnya hasil AI.

## Pemecahan masalah

| Gejala | Sebab | Tindakan |
|---|---|---|
| Efek terlihat seperti tempelan | tidak ada sumber dan akhir | tambahkan asal dan titik memudar |
| Efek "noisy" / berisik | bahan tidak disebut | sebut butiran, asap, debu, atau cairan |
| Karakter berubah bentuk | efek menembus wajah | pindahkan efek ke sekitar, tambah "wajah stabil" |
| Klip nyaris beku | prompt mendeskripsikan adegan, bukan gerakan | tulis gerakan kamera + aksi |
| Kamera goyah | dua gerakan berlawanan | pilih satu gerakan saja |
| Warna efek melenceng | cahaya tidak disebut | tambah arah dan warna sumber cahaya |
| HTTP 401/403 | kunci salah | minta kunci baru; jangan ulang |
| HTTP 429 | kuota habis | berhenti, laporkan |
| Hasil kosong | bentuk respons beda | cek `references/provider-matrix.md` |
| Durasi terpotong | batas penyedia 5 dtk | buat beberapa klip lalu gabung dengan ffmpeg |

Bila penyedia utama tidak tersedia, tawarkan alternatif dari
`references/provider-matrix.md` dan sebutkan perbedaan kekuatannya.

## Sumber daya

- `scripts/generate_media.py` — pemanggil API untuk klip video dan gambar.
- `references/provider-matrix.md` — arah pemilihan penyedia, bentuk respons,
  dan cara menyambung klip.
- `references/vfx-contract.md` — contoh kontrak VFX per jenis efek: ledakan,
  partikel, sihir, asap, energi, cuaca, kehancuran.

## Berkas terkait di repo ini

Di proyek studio otomotif, adapter media sudah tersedia:

- `config/visuals.json` — daftar adapter dan urutan percobaan.
- `src/visuals/adapters.ts` — implementasi `image-gen` dan `video-gen`;
  `i2vPrompt()` di sana sengaja hanya mengirim prompt gerakan, karena
  mendeskripsikan ulang gambar acuan membuat klip hampir statis.
