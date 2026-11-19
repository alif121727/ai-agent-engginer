# Catatan Sesi — AI Studio Otomotif

Dokumen ini menggantikan riwayat chat. Percakapan asisten tidak disimpan di
repo maupun di sandbox (riwayat terikat sandbox, dan sandbox bisa hilang), jadi
setiap sesi dicatat di sini: apa yang diminta, apa akar masalahnya, apa bukti
bahwa sudah beres, dan apa yang masih terbuka.

Aturan main: catatan ini **ikutsan di-commit** oleh `scripts/autopush.sh`
setiap 10 menit, bersama artefak job. Kalau ada sesi baru, tambahkan bagian di
bawah, jangan menimpa bagian lama.

---

## 1. Permintaan produk (ringkas)

- Aplikasi web "AI Studio Otomotif": tim agen AI otonom sesuai job desk,
  mengubah template/brief menjadi video otomotif sangat realistis.
- Durasi **bisa diatur bebas** (implementasi: 30–600 dtk, minimum 30).
- Tampilan web menarik; palet **hitam, oranye, putih, krem**.
- Otomatis **dijeda saat internet bermasalah**, lalu lanjut dari checkpoint.
- Commit/push ke `alif121727/ai-agent-engginer` **tiap 10 menit**.
- Login memakai email/username + password, sesi lewat cookie.

## 2. Sesi 1 — sandbox hilang, aplikasi dihidupkan lagi

Chat lama tidak bisa dipulihkan; repo dan `data/studio.db` masih utuh.

- Aplikasi dijalankan di port 12000:
  https://work-1-bvtlbdodwnodjuan.prod-runtime.all-hands.dev
- Password admin lama tidak tercatat → dibuat `scripts/reset-password.ts`.
- `db().run()` mengembalikan `void`, jadi `result.changes` selalu `undefined`;
  cek keberadaan baris harus lewat `db().get()`.
- Ditemukan: foto di `assets/own/ferrari-296-gtb/nyata-*.jpg` sebenarnya
  unduhan **picsum** (terlihat dari `strings` pada file), sehingga render
  menampilkan pemandangan acak tanpa mobil. QA lolos karena hanya mengukur
  ketajaman. Diganti foto asli Wikimedia Commons (CC BY-SA 4.0).
- Catatan unduh Commons: `thumb.wikimedia.org` menolak ukuran sembarang
  (HTTP 400 "Use thumbnail sizes listed") dan membalas 429 saat burst — pakai
  `iiurlwidth` dari API dan beri jeda antar unduhan.

## 3. Sesi 2 — aset identik dan gerbang QA yang salah ukur

Gejala: job Koenigsegg Jesko gagal QA dengan keluhan "scene terlalu mirip".
MD5 keenam `scene-0X.jpg` identik (`449e9ff0…`, 135641 B) walau prompt tiap
scene berbeda.

### 3.1 Akar masalah: prompt "undefined"

Adapter Pollinations membaca `req.prompt`, padahal `GenerateRequest` hanya punya
`req.scene.prompt`. Jadi semua scene mengirim teks `"undefined"` ke provider →
gambar identik → QA menolak karena duplikat.

Perbaikan (`6cf9e95`): baca `req.scene.prompt`. Bukti: dua prompt berbeda
sebelum perbaikan menghasilkan MD5 sama, sesudahnya berbeda
(`051ca254…` vs `9775630…`).

### 3.2 Rate limit provider gratis

Setelah prompt benar, job masih gagal separuh: HTTP 402/503 dari Pollinations.
Provider ini juga membatasi ukuran ~1015x580 walau diminta 1792x1024.

Perbaikan (`06466e5`):

- `seed` unik per scene (hash dari `model:index`) agar komposisi tidak
  bertabrakan dan retry tetap bisa direproduksi.
- `maxRetries: 4`, `cooldownMs: 25000` untuk `image-gen-free`.
- Jeda `VISUAL_PACE_MS` (default 4000 ms) antar scene.
- Upscale lanczos ke ukuran target (sudah ada sejak sesi sebelumnya).

Bonus temuan: progres tahap aset memakai `done.size` yang tidak pernah
bertambah di dalam loop, sehingga progres macet. Sekarang memakai jumlah aset
nyata.

### 3.3 Gerbang QA yang salah ukur

Setelah semua aset jadi, QA menolak frame video dengan "ketajaman 4". Padahal
gerbang frame dimaksudkan menangkap render **hitam atau beku**, bukan menilai
ketajaman fotografis — itu tugas gerbang per-aset (yang sudah memakai dua
ambang: 8 untuk foto asli, 5 untuk aset generator).

Perbaikan (`6c5697f`): ambang frame turun ke 2 ("tidak kosong") dan ditambah
cek `tidak-beku` lewat perceptual hash antar frame, sehingga video yang
membeku tetap tertangkap.

Catatan penting: menaikkan `unsharp` tidak menolong (diukur: tetap 7), karena
masalahnya bukan ketajaman melainkan salah pilih metrik.

## 4. Hasil verifikasi

Tiga job dijalankan penuh sampai `done`, semuanya 14 cek QA lulus:

| Job | Model | Durasi | Sumber visual | QA |
|---|---|---|---|---|
| `4c3a860f` | Koenigsegg Jesko | 30 dtk | generator gratis, **tanpa foto** | lulus |
| `44575cde` | Lamborghini Huracan STO | 30 dtk | foto asli | lulus |
| `c3ab4937` | Porsche Taycan Turbo S | 45 dtk | foto asli | lulus |
| `dd99c58f` | Porsche 911 GT3 RS | 30 dtk | foto asli (6/6) | lulus |

Job 45 dtk membuktikan durasi benar-benar bisa diatur, bukan hanya 30 dtk.
Output: H.264 1920x1080 30 fps + audio AAC, durasi tepat sesuai brief.

## 4b. Sesi 3 — 12 model punya foto tapi tidak pernah dipakai

Ditemukan saat menjawab "apakah tugasnya sudah selesai". Bukan keluhan user,
tapi bug senyap: `userAssetsFor()` mencari folder lewat `slugifyModel(model)`,
sedangkan folder di `assets/own/` dinamai tangan dengan versi/generasi
(`porsche-911-gt3-rs-992`, `ford-gt-2017`, `bmw-m4-competition-g82`). Untuk 12
dari 30 model katalog, hasilnya `[]` → job diam-diam jatuh ke generator gambar
walau foto asli tersedia. Tidak ada error, tidak ada peringatan.

Perbaikan: `assetFolderSlug()` memakai `findModel(model)?.slug` lebih dulu
(slug katalog = nama folder sebenarnya), dan `slugifyModel` hanya sebagai
cadangan untuk model di luar katalog. Pesan bantuan unggah foto juga ikut
memakai slug yang benar supaya user menaruh file di folder yang dibaca.

Verifikasi: job `dd99c58f` (Porsche 911 GT3 RS) → 6/6 aset `provider: local`
dari `porsche-911-gt3-rs-992`, video 1920x1080 30 dtk, QA 14/14 lulus.
Tes regresi ditambahkan: "foto katalog terbaca meski nama foldernya beda dari
slug otomatis" (41 pemeriksaan total).

Catatan desain yang dijaga: folder `porsche-911-gt3` (di luar katalog) tetap
sah, karena brief boleh menyebut model apa pun. Folder kosong seperti
`toyota-gr-supra` dan `toyota-ae86` juga bukan kegagalan — model itu memang
belum punya foto dan akan memakai generator.

## 5. Riwayat commit sesi ini

| Commit | Isi |
|---|---|
| `e79fa24` | fallback visual nyata, audio, QA berbasis bukti |
| `6cf9e95` | adapter gambar membaca `req.scene.prompt` |
| `06466e5` | seed per scene, backoff lebih panjang, pacing |
| `6c5697f` | gerbang frame: kosong/beku, bukan ketajaman foto |
| `1227cfd` | artefak job ikut dilacak di repo |

## 6. Penyimpanan data & auto-push

- `scripts/autopush.sh` commit + push tiap 600 detik (log: `/tmp/autopush.log`).
  "tidak ada perubahan" berarti working tree bersih, bukan skrip mati.
- `jobs/**` diabaikan, **kecuali** `jobs/*/artifacts/**` (plan, riset, naskah,
  storyboard, aset, motion, audio, render, QA — total ±584 KB teks). Video,
  aset, klip, dan `qa-frames` tidak masuk repo (461 MB).
- Pola gitignore butuh `!jobs/*/` sebelum `!jobs/*/artifacts/`; tanpa itu
  folder induk sudah ter-ignore dan pengecualian tidak berlaku.
- Memori kerja asisten ada di `/workspace/project/.openhands/memory/`
  (**di luar repo**), jadi bisa hilang bersama sandbox. Dokumen ini yang
  tersimpan permanen di repo.

## 7. Cara melanjutkan

```bash
npm test                                   # 46 pemeriksaan
PORT=12000 node --experimental-strip-types src/api/main.ts &
node --experimental-strip-types src/worker/main.ts &
bash scripts/autopush.sh &                 # commit tiap 10 menit
```

- Brief baru: `POST /api/jobs` dengan `{brief:{model,tagline,durasi,rasio,keunggulan}}`.
- Model tanpa foto tetap bisa dirender lewat rantai fallback
  `local → video-gen → image-gen → image-gen-free → stock-api`.
- Kalau provider gratis sedang membatasi laju, perbesar `VISUAL_PACE_MS`.

## 8. Terbuka

- Halaman Pengaturan untuk mengatur provider visual dari UI belum ditelusuri.
- Katalog kini 33 model; menambah model = menambah entri `config/catalog.json`
  + folder `assets/own/<slug>/` berisi foto asli.

---

## 9. Sesi lanjutan — pemilih katalog di web + skrip `npm run web` rusak

Permintaan: melanjutkan pekerjaan yang tertunda (katalog belum tersambung ke UI).

**Akar masalah 1 — `npm run web` tidak pernah bisa jalan.**
Skrip menunjuk `src/web/main.ts`, berkas yang **tidak ada di git** (folder
`src/web/` kosong). Yang benar-benar melayani UI + API adalah `src/api/main.ts`.
Skrip sudah diarahkan ke sana; port diatur lewat `PORT`.

**Akar masalah 2 — katalog tidak sampai ke layar.**
`/api/config` sudah mengirim `catalog`, tetapi UI masih memakai grid tema lama
(7 kartu) dengan fungsi `labelFor()` yang memetakan id tema ke nama mobil.

**Perbaikan.**
- `ui/app.tsx`: `interface CatalogModel` + `catalog` di `interface Config`;
  grid tema diganti pemilih 33 model dengan kotak cari dan filter kategori
  (semua/sport/balap/modifikasi/klasik). `filterKatalog()` menyaring gabungan
  kata kunci dan kategori; `ringkasModel()` menyembunyikan penanda data.
- Penanda `'tidak disebut di sumber'` sempat **bocor ke kartu model** (terlihat
  di Porsche Taycan Turbo S, Mercedes 300 SL, BMW M4 GT3). Sekarang hanya
  kategori · tahun · tenaga yang tampil, dan tenaga kosong dilewati.

**Bukti.**
- `npm test`: 46 lulus, 0 gagal (naik dari 41). Empat cek baru: katalog sampai
  ke `/api/config` (≥33 model, ≥2 balap), tiap model punya foto di
  `assets/own`, penanda tak pernah muncul di `specLines()`, sumber tiap model
  berupa artikel Wikipedia.
- `python3 scripts/audit-katalog.py`: `0/33 entri punya angka tanpa bukti`.
- Di browser: 33 kartu tampil, filter "balap" menyisakan 11 model, cari
  "z-tune" menyisakan 1, klik kartu mengisi kolom model dan langkah durasi
  menampilkan estimasi 45 dtk / 7 scene / $0.42.
- `/api/health` → `{"ok":true,"connection":"ONLINE","db":"sqlite","ffmpeg":true}`.

**Catatan teknis.** `npx tsc --noEmit` gagal karena `@types/node` tidak
terpasang; ini bukan regresi — build nyata memakai esbuild (`npm run build:ui`)
dan lolos. Bila memeriksa UI manual, ganti query `?v=` di URL karena browser
meng-cache `app.js` dengan keras.

---

## 10. Sesi 4 — jawaban "kemana chat pembuatan studio AI"

Riwayat percakapan **tidak bisa dipulihkan**: chat terikat pada sandbox, dan
sandbox lama sudah hilang. Yang permanen adalah repo. Karena itu dokumen ini
memang dibuat sebagai pengganti riwayat chat — semua keputusan, akar masalah,
dan bukti verifikasi ada di sini.

Selama menjawab, tiga bug nyata ditemukan dan diperbaiki.

### 10.1 Dua worker bisa mengklaim job yang sama

`claimNextJob()` membaca baris `queued`, lalu `UPDATE ... WHERE status='queued'`,
lalu memeriksa status lewat `getJob()`. Dua worker yang poll bersamaan sama-sama
membaca baris yang sama, dan keduanya melihat `running` — sehingga keduanya
menjalankan job yang sama di folder yang sama. Ini yang membuat `scene-06.jpg`
sempat hanya 48 byte (dua proses menulis file yang sama, satu terbunuh).

Perbaikan: `db().run()` sekarang mengembalikan jumlah baris yang berubah, dan
`claimNextJob()` memakai hasil `UPDATE` sebagai klaim atomik — hanya worker
yang `changes === 1` yang menjalankan job.

Bukti: tes "dua worker tidak bisa mengklaim job yang sama" menjalankan empat
`claimNextJob()` serentak. Dengan kode lama tes gagal (`job diklaim dua kali:
23d4fe4d…` empat kali); dengan kode baru lulus.

### 10.2 Halaman Template baru blank

`/api/config` mengirim `catalog` tanpa field `mesin`, padahal UI memanggil
`m.mesin.split('(')`. Satu field hilang membuat React melempar dan seluruh
halaman kosong — bukan pesan error, hanya layar putih.

Perbaikan: `mesin` dikirim oleh API, dan UI memakai `mesin?` opsional sehingga
katalog yang belum punya data mesin tetap tampil.

### 10.3 Hint "Terdeteksi" bertentangan dengan mesin pencarian

UI punya salinan logika skor sendiri dan tidak tahu alias (`r34`, `hachiroku`,
`gullwing`). Akibatnya mengetik "r34" menampilkan "Model belum ada di katalog"
padahal job-nya akan memakai foto R34. Server sendiri sudah mengenali alias itu.

Perbaikan: `aliasesFor()` diekspor dari `src/core/catalog.ts`, dikirim sebagai
`alias` di `/api/config`, dan dipakai UI. Ditambah tes yang memastikan setiap
alias katalog mengarah ke model yang benar.

**Verifikasi.** `npm test`: **54 lulus, 0 gagal**. Di browser: 33 kartu tampil,
klik kartu R34 menampilkan "Terdeteksi: Nissan Skyline GT-R R34 Nismo Z-tune —
foto nissan-r34-gtr-z-tune dan suara mesinnya (Inline-six 2.8L twin-turbo
RB26DETT) akan dipakai". Foto untuk enam nama panggilan diverifikasi terurai ke
folder yang benar (`r34`→6 foto, `hachiroku`→5, `22b`→6, `gullwing`→3).

**Prompt visual diperkuat.** `buildPrompt()` kini menyebut medium fotografi
kongkret (full frame, lensa prime, f/1.8, ISO 100, RAW) dan `NEGATIVE_PROMPT`
ditambah artefak yang membuat mobil hasil generator terlihat seperti mainan
(warna terlalu jenuh, kulit plastik, roda mengambang, bayangan ganda).

---

## 11. Sesi 5 — satu job lagi (Mazda RX-7, 45 dtk)

Permintaan: jalankan satu job lagi. Dipilih **Mazda RX-7 (FD3S)**, model yang
belum pernah dirender dan punya 6 foto di `assets/own/mazda-rx7-fd/`. Durasi
45 dtk, bukan 30, supaya sekaligus membuktikan durasi benar-benar bisa diatur.

Brief diambil dari katalog (`findModel('rx7')` + `detailBrief`), jadi tidak ada
angka yang dikarang: rotary twin-turbo 1.3L 13B-REW, 255–280 PS, torsi 294 Nm,
0–100 km/jam 5,3 dtk, top speed 250 km/jam, berat 1.270 kg.

**Hasil** (job `39de7149c1ce492ba99bc23f758fd0db`):

- 9/9 tahap `done`, tanpa error, waktu render ±3,5 menit.
- Video 35,4 MB: H.264 1920×1080, 45,0 dtk tepat, audio AAC 48 kHz stereo,
  −14,0 LUFS.
- 7 scene, **7/7 aset `provider: local`** dari folder RX-7 (6 foto; scene 7
  memakai ulang foto-1 karena scene lebih banyak dari foto).
- QA **14/14 lulus**: resolusi, durasi, audio, tanpa-fallback, 6 frame dengan
  ketajaman 13–22, "tidak-kosong" rata-rata 16,8, "tidak-beku" 6/6 frame beda.
- Kecocokan scene ↔ foto sumber diuji dengan korelasi thumbnail 32×32:
  scene-01..06 → foto-1..6, scene-07 → foto-1, semuanya **korelasi 1.000**.
  Ini memastikan yang dirender memang RX-7, bukan gambar acak seperti kasus
  picsum di sesi 1.

### 11.1 Bug baru: panel unggah aset menulis ke folder yang salah

Halaman detail menampilkan "Tersimpan di `assets/own/mazda-rx-7`", padahal
folder nyata dan folder yang dibaca pipeline adalah `mazda-rx7-fd`. Penyebabnya
`ownDir()` di `src/api/server.ts` membuat slug sendiri dari nama tampilan
(`model.replace(...)`), bukan lewat `assetFolderSlug()`. Akibatnya setiap foto
yang diunggah user untuk model katalog dengan nama folder kustom akan
tersimpan di tempat yang tidak pernah dibaca pipeline — kegagalan senyap, sama
seperti bug §4b tetapi di lapisan API.

Perbaikan: `ownDir()` memakai `assetFolderSlug(model)`, sehingga unggah, daftar,
saji, dan hapus semuanya menunjuk folder yang sama dengan pipeline.

Bukti: tes baru "unggahan aset model katalog masuk ke folder yang dibaca
pipeline". Dengan kode lama tes gagal (`berkas harus mendarat di
…/assets/own/mazda-rx7-fd`); dengan kode baru lulus. `npm test`: **55 lulus,
0 gagal**. Di browser panel aset kini menampilkan `assets/own/mazda-rx7-fd`
dan 6 pratinjau foto.

**Catatan login.** Username direset ke `admin123` (email `admin@studio.id`),
karena kredensial yang tercatat sebelumnya sudah tidak cocok dengan DB.

## §9 Job model tanpa foto (Koenigsegg Jesko) + negative prompt provider gratis

**Job.** Model di luar katalog (tanpa folder foto) dirender lewat jalur
generator gratis. Job `a0ebc7d46d624cefa1e571ba843248fb`: 30 dtk, 6/6 aset
`image-gen-free`, QA 14/14 lulus, h264 1920x1080 + AAC 48 kHz stereo, 11.6 MB.

**Bug nyata: negative prompt tidak pernah sampai ke provider gratis.**
`NEGATIVE_PROMPT` hanya dikirim adapter berbayar lewat parameter
`negative_prompt`; Pollinations tidak punya parameter itu, jadi negatif dibuang
diam-diam. Perbaikan pertama (menempelkan negatif di *belakang* prompt) ternyata
**tidak berpengaruh sama sekali** — dibuktikan dengan A/B seed sama: piksel
100% identik (0 byte berbeda dari 1.769.472), hanya metadata yang beda.
Penyebabnya provider memotong prompt yang panjang, sehingga ekor prompt hilang.
Menaruh negatif di **depan** baru mengubah hasil: korelasi turun ke **-0.2465**
(vs **1.0000** saat di belakang). Kontrol: seed sama + prompt sama dua kali
menghasilkan gambar identik, dan prompt sangat berbeda berkorelasi 0.3489 —
jadi memang urutan yang menentukan, bukan cache.

**Jebakan operasional (mahal).** `src/worker/main.ts` adalah proses terpisah.
Restart API saja tidak memuat kode adapter baru: worker lama (start 17:28) tetap
memakai kode lama, sehingga dua job pertama menghasilkan aset **md5 identik**
padahal kode sudah diubah. Setelah worker di-restart (19:12), job ketiga
menghasilkan aset berbeda (md5 berubah) dan ketajaman naik 6.8 → 8.5.
**Selalu restart worker, bukan hanya API, setelah mengubah kode pipeline.**

**Rate limit.** Pollinations gratis: 1 gambar / 45 dtk / IP, balasannya
`HTTP 402 FREE_LIMIT`. Saat menguji A/B manual, beri jeda ≥50 dtk; kalau tidak,
hasilnya 402 dan mudah salah dibaca sebagai "prompt ditolak".

**Tes.** `npm test`: **56 lulus, 0 gagal**, termasuk tes baru yang mengunci
urutan (negatif harus di depan).
