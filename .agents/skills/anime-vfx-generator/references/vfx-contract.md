# Kontrak VFX per Jenis Efek

Setiap efek di bawah punya lima bagian yang sama: **sumber, bahan, arah,
cahaya, akhir**. Perhatikan bahwa yang berubah antar jenis efek adalah bahan
dan perilakunya, bukan strukturnya.

## Ledakan

| Bagian | Isi |
|---|---|
| Sumber | titik pusat yang jelas: "dari tengah dada karakter", "dari dasar botol" |
| Bahan | bola api oranye, asap hitam pekat, pecahan beton, debu |
| Arah | melebar keluar dari pusat, pecahan melengkung ke bawah |
| Cahaya | kilatan putih sesaat, lalu oranye hangat menyinari sekitar |
| Akhir | asap mengepul naik dan menipis, debu mengendap |

```
ledakan dari tengah dada karakter, bola api oranye terang melebar keluar,
asap hitam pekat mengepul ke atas, pecahan batu kecil melengkung ke bawah,
kilatan putih satu frame di awal lalu cahaya oranye hangat menyinari wajah
dan lengan, asap menipis dan debu mengendap di 1 detik terakhir
```

Kesalahan umum: hanya menulis "ledakan besar". Hasilnya bola api tanpa
pecahan, tanpa asap, tanpa akhir — dan terlihat seperti stiker.

## Partikel

| Bagian | Isi |
|---|---|
| Sumber | "dari telapak tangan", "dari jejak kaki", "dari ujung pedang" |
| Bahan | debu emas halus, bunga api, serpihan kaca, kunang-kunang |
| Arah | berputar, menyebar, mengikuti alur tubuh |
| Cahaya | setiap butir memancarkan cahaya sendiri, memantul di kulit |
| Akhir | butir memudar satu per satu, bukan hilang serentak |

```
partikel debu emas halus keluar dari telapak tangan yang terbuka, berputar
perlahan searah jarum jam lalu menyebar ke depan, setiap butir memancarkan
cahaya hangat yang memantul di kulit dan lengan baju, butir memudar satu per
satu dari yang terjauh
```

Untuk partikel yang mengikuti gerakan, sebut objek yang diikuti: "partikel
mengikuti jejak kaki", "mengikuti ujung pedang".

## Efek sihir

| Bagian | Isi |
|---|---|
| Sumber | tangan, tongkat, lingkaran sihir di tanah, mata |
| Bahan | garis cahaya, rune, kabut berwarna, kristal |
| Arah | lingkaran berputar, garis menjalar, formasi menyusun diri |
| Cahaya | warna spesifik menyinari lingkungan, bayangan ikut bergerak |
| Akhir | garis terurai jadi titik cahaya lalu padam |

```
lingkaran sihir biru kehijauan terbentuk di tanah di bawah karakter, garis
rune berputar perlahan lalu naik membentuk silinder cahaya, cahaya biru
menyinari bagian bawah wajah dan pakaian, silinder menyusut dan terurai jadi
titik cahaya yang padam dari atas
```

Hindari kata "sihir" sendirian. Model tidak punya rujukan visual untuk itu;
"garis cahaya berputar" punya.

## Asap dan kabut

| Bagian | Isi |
|---|---|
| Sumber | "dari celah tanah", "dari pipa knalpot", "dari permukaan air" |
| Bahan | asap tipis, kabut tebal, uap air, debu beterbangan |
| Arah | mengepul naik, menyebar mendatar, tertiup angin ke satu sisi |
| Cahaya | menyerap cahaya, membuat siluet, atau menyala dari dalam |
| Akhir | menipis hingga tembus pandang |

```
asap putih tipis mengepul dari celah tanah, menyebar mendatar di permukaan,
tertiup angin ke kanan, menyerap cahaya bulan sehingga tepinya bersinar
keperakan, menipis hingga tembus pandang di akhir klip
```

Kepadatan harus disebut: "tipis" vs "pekat" menghasilkan dua gambar berbeda.

## Energi

| Bagian | Isi |
|---|---|
| Sumber | tubuh, senjata, benda yang dipegang |
| Bahan | aliran cahaya, listrik, plasma, aura |
| Arah | menjalar di sepanjang permukaan, memancar keluar, mengalir ke satu titik |
| Cahaya | warna kuat, kontras tinggi, memantul di permukaan logam |
| Akhir | meredup dari ujung, atau meledak jadi percikan |

```
aliran listrik biru putih menjalar di sepanjang lengan karakter mengikuti
otot, berkumpul di kepalan tangan, memancarkan cahaya kuat yang memantul di
logam gelang, lalu meledak jadi percikan kecil saat tangan diayunkan
```

## Cuaca

| Bagian | Isi |
|---|---|
| Sumber | seluruh langit / permukaan |
| Bahan | tetes hujan, butir salju, butir es, debu gurun |
| Arah | jatuh miring karena angin, memantul di permukaan |
| Cahaya | memantulkan sumber cahaya, membuat kabut di kejauhan |
| Akhir | mereda, atau berlanjut dengan intensitas berubah |

```
hujan deras jatuh miring ke kanan karena angin kencang, tetes memantul di
permukaan aspal membentuk lapisan tipis air, cahaya lampu jalan memantul
kekuningan di genangan, hujan mereda di 2 detik terakhir
```

## Kehancuran

| Bagian | Isi |
|---|---|
| Sumber | titik tumbukan yang jelas |
| Bahan | pecahan beton, serpihan kaca, debu, tulang (untuk gaya anime) |
| Arah | menyebar radial, pecahan besar lebih lambat dari debu |
| Cahaya | debu menahan cahaya, membuat berkas cahaya di antara pecahan |
| Akhir | pecahan jatuh dan mengendap, debu turun perlahan |

```
tumbukan di dinding beton, retakan menjalar keluar dari titik tumbukan,
pecahan besar jatuh lebih lambat dari debu halus, debu menahan cahaya pagi
sehingga terbentuk berkas cahaya di antara pecahan, debu mengendap perlahan
selama 2 detik terakhir
```

## Tabel cepat: kata kabur dan penggantinya

| Kabur | Ganti dengan |
|---|---|
| "epik" | "kamera rendah mendongak, efek memenuhi dua pertiga frame" |
| "kuat" | "cahaya menyinari seluruh latar, bayangan tajam" |
| "cepat" | "bergerak menyeberang frame dalam 0,5 detik" |
| "halus" | "transisi tanpa hentakan, gerakan melengkung" |
| "realistis" | "simulasi fisik: gravitasi, hambatan udara, pantulan" |
| "indah" | sebut warna, kontras, dan arah cahayanya |

## Checklist sebelum mengirim prompt

- [ ] Sumber efek disebut (dari mana)
- [ ] Bahan disebut (dari apa)
- [ ] Arah dan kecepatan disebut
- [ ] Interaksi cahaya disebut (warna dan arah)
- [ ] Akhir efek disebut (kapan dan bagaimana hilang)
- [ ] Satu gerakan kamera saja
- [ ] Tidak ada kata kabur tanpa pengganti fisik
- [ ] Identitas subjek dijaga bila efek berada di dekat wajah/tangan
