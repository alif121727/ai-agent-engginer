# Rumus Prompt

## Kerangka enam bagian

```
[Subjek] + [Aksi/pose] + [Latar] + [Gaya] + [Pencahayaan] + [Kualitas]
```

Urutannya penting: kata di awal punya bobot paling besar. Subjek yang kabur di
awal tidak akan tertolong oleh kata "4K, masterpiece" di akhir.

| Bagian | Isi | Contoh |
|---|---|---|
| Subjek | benda/tokoh utama, spesifik | "secangkir kopi latte dengan latte art daun" |
| Aksi/pose | yang sedang terjadi | "uap mengepul perlahan" |
| Latar | tempat dan isinya | "meja kayu gelap, biji kopi tersebar, bokeh kafe" |
| Gaya | bahasa visual | "sinematik, close-up makro" |
| Cahaya | arah dan kualitas | "cahaya jendela pagi dari samping, kontras lembut" |
| Kualitas | teknis | "4K, detail tinggi, warna hangat" |

## Per jenis media

### Foto produk

Tambahkan bahan dan warna latar, karena itu yang menentukan apakah hasilnya
bisa dipakai untuk katalog:

```
botol serum kaca bening berlabel minimalis, berdiri tegak, latar marmer putih
dengan bayangan lembut, gaya iklan kecantikan, cahaya studio dari kiri atas,
fokus tajam pada label, 4K
```

Negatif: `teks acak, label palsu, pantulan berlebih, latar berantakan`.

### Foto makanan

```
semangkuk ramen dengan telur setengah matang, uap tipis, latar meja kayu,
gaya fotografi makanan editorial, cahaya hangat dari jendela, kedalaman
bidang dangkal, 4K
```

### Video promosi

Untuk video, **tulis gerakan**, bukan ulang adegan. Model video membaca prompt
sebagai instruksi kamera dan aksi:

```
kamera perlahan mendekat ke cangkir, uap kopi bergerak naik, tangan barista
menuang susu dalam gerakan lambat, cahaya pagi bergeser di meja
```

Bukan:

```
secangkir kopi latte di meja kayu, sinematik, 4K
```

Prompt kedua mendeskripsikan gambar diam; hasilnya klip nyaris beku.

Tambahkan instruksi kamera eksplisit: `dolly in`, `pan kanan perlahan`,
`tilt up`, `orbit setengah lingkaran`, `static shot`.

### Video orang (bukan wajah nyata)

```
seorang barista muda dari belakang, celemek kanvas, menuang susu ke cangkir,
kamera mengikuti gerakan tangan, kafe pagi dengan cahaya hangat
```

Hindari menyebut nama orang nyata atau meminta kemiripan wajah tertentu.

## Kata yang berguna vs kata kosong

| Berguna | Kosong |
|---|---|
| "cahaya jendela pagi dari samping" | "cahaya bagus" |
| "latar marmer putih polos" | "latar bersih" |
| "close-up 85mm, kedalaman bidang dangkal" | "profesional" |
| "warna hangat, kontras lembut" | "indah" |
| "uap bergerak naik" (video) | "berkualitas tinggi" |

Kata seperti "masterpiece", "terbaik", "8K" tidak menambah apa pun pada model
modern dan hanya memakan jatah token.

## Negatif yang sering dipakai

```
blur, buram, teks, watermark, tanda tangan, tangan cacat, jari berlebih,
distorsi wajah, latar berantakan, kompresi berlebih
```

Untuk produk tambahkan: `label palsu, merek dagang, pantulan berlebih`.

## Menyesuaikan rasio

| Rasio | Pakai untuk | Catatan prompt |
|---|---|---|
| `16:9` | video promosi, banner | sebut "komposisi lebar, ruang kosong di kiri untuk teks" |
| `9:16` | Reels, TikTok, Story | sebut "komposisi vertikal, subjek di tengah atas" |
| `1:1` | feed, katalog produk | sebut "komposisi simetris, subjek memusat" |
| `4:5` | feed Instagram | mendekati 1:1 tapi lebih tinggi |

Rasio yang diminta di prompt **dan** di parameter API harus sama. Kalau hanya
disebut di prompt, penyedia bisa mengabaikannya.

## Iterasi

Jangan menulis ulang seluruh prompt saat hasil kurang tepat. Ubah satu bagian
per percobaan, dari yang paling berpengaruh:

1. **Subjek** — apakah bendanya benar?
2. **Latar** — apakah terlalu ramai?
3. **Cahaya** — apakah terlalu gelap/terang?
4. **Gaya** — apakah terlalu ilustratif?
5. **Kualitas** — paling akhir, paling kecil pengaruhnya.

Catat prompt yang berhasil ke `output/prompts.md` agar bisa dipakai ulang.
