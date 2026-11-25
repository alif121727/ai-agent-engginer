# PROMPT OPENHANDS: Video Kejar-kejaran Mobil 60 Detik (3D prosedural, Python + ffmpeg)

Salin semua isi file ini ke OpenHands sebagai instruksi tugas. Kalau kamu juga punya zip `car-chase-source.zip`, taruh isinya di workspace OpenHands dan suruh agen memakainya sebagai titik awal (bagian 2 menjelaskan isinya).

---

## 0. PERAN DAN TUJUAN

Kamu adalah engineer grafis dan audio. Tugasmu: membuat dan menyempurnakan video animasi 3D prosedural berdurasi tepat 60 detik, berisi kejar-kejaran supercar hitam di jalan tol saat golden hour menuju senja. Semuanya dibuat dari kode (Python + ffmpeg). Tidak boleh memakai model video AI, aset gambar, model 3D, atau suara dari luar.

Hasil akhir: satu file `car-chase-60s.mp4` (H.264 + AAC, 1280x720, 24 fps, 60,0 detik) dan source code yang bisa dijalankan ulang dengan satu perintah.

Versi pertama sudah ada (bagian 2) dan jalan end-to-end. Kualitas visualnya masih low-poly. Tugas utamamu: naikkan kualitasnya lewat daftar penyempurnaan di bagian 8, tanpa merusak hal yang sudah benar.

---

## 1. TOOLS DAN LINGKUNGAN (yang dipakai di versi pertama)

| Kebutuhan | Tool | Catatan |
|---|---|---|
| Bahasa | Python 3.12 | semua logika |
| Array / matematika | numpy | rendering per piksel dibuat vektor, bukan loop |
| Gambar / poligon | opencv-python (cv2) | `fillConvexPoly`, `fillPoly` dengan `LINE_AA`, `GaussianBlur`, `remap`, `resize` |
| Interpolasi / filter | scipy | `PchipInterpolator` (bentuk badan mobil), `signal.butter/lfilter/fftconvolve` (audio) |
| Encode / mux | ffmpeg | pipe `rawvideo rgb24` ke `libx264`, lalu mux AAC dan `loudnorm` |
| Cek visual | render frame PNG + contact sheet | wajib dilihat sebelum render penuh |
| Proses panjang | `setsid nohup python3 ... &` + file progres | proses background biasa (`nohup ... &` saja) mati saat sesi tool selesai |

Batas lingkungan yang kutemui: 1 CPU, RAM 3 GB, tanpa GPU. Render 1280x720 memakan sekitar 0,5 detik per frame, jadi sekitar 12 menit untuk 1440 frame. Kalau mesinmu lebih kuat, naikkan kualitas (bagian 8) dan pakai `multiprocessing` per potongan frame.

---

## 2. STRUKTUR PROYEK

```
car-chase/
  world.py       timeline, kecepatan mobil, jalur lajur, kurva jalan, lalu lintas, matahari/palet langit, posisi pohon
  cars.py        model mobil prosedural (loft penampang superellipse jadi quad, roda, sayap, lampu)
  render.py      kamera tiap clip, shader langit+tanah per piksel, pohon, mobil, bayangan, post-processing
  render_all.py  loop 1440 frame -> pipe ke ffmpeg -> video_silent.mp4
  audio.py       sintesis audio stereo -> audio.wav
  make.sh        render_all -> audio -> mux (buat sendiri)
  test_frames.py render frame uji (buat sendiri), keluarkan contact sheet
```

---

## 3. LANGKAH KERJA (kerjakan berurutan, jangan loncat)

**Fase 0: Siapkan dan jalankan baseline**
1. Cek tool: `python3 -c "import numpy, cv2, scipy; print(numpy.__version__, cv2.__version__, scipy.__version__)"` dan `ffmpeg -version`.
2. Kalau `car-chase-source.zip` tersedia, ekstrak. Kalau tidak, bangun modul sesuai bagian 5 dari nol.
3. Render 8 frame uji (detik 3, 10, 20, 26, 34, 41, 49, 55), gabung jadi satu contact sheet, lihat dengan tool view image. Ini baseline visual yang harus dikalahkan.

**Fase 1: Perbaiki per modul, satu per satu**
Untuk setiap penyempurnaan di bagian 8: ubah, render frame uji, bandingkan dengan baseline, simpan hanya kalau lebih baik. Jangan ubah banyak hal sekaligus supaya penyebab regresi jelas.

**Fase 2: Render penuh**
```bash
setsid nohup python3 render_all.py > render.log 2>&1 < /dev/null &
cat progress.txt   # cek tiap 2-3 menit
```
`render_all.py` menulis `i/1440 detik` ke `progress.txt` dan `DONE` di akhir. Kalau pakai multiprocessing, render per potongan (mis. 4 potongan x 360 frame) ke file PNG/MP4 terpisah lalu gabung dengan `ffmpeg -f concat`.

**Fase 3: Audio**
```bash
python3 audio.py     # menghasilkan audio.wav (stereo float32, 44,1 kHz, 60 detik)
```

**Fase 4: Mux**
```bash
ffmpeg -y -i video_silent.mp4 -i audio.wav \
  -c:v libx264 -preset medium -crf 24 -pix_fmt yuv420p \
  -c:a aac -b:a 192k -af "loudnorm=I=-16:TP=-1.5:LRA=11" \
  -shortest -movflags +faststart car-chase-60s.mp4
```
Render mentah dengan CRF 18 menghasilkan sekitar 200 MB karena film grain. Encode ulang ke CRF 24 menjadi sekitar 30 MB.

**Fase 5: Verifikasi (wajib)**
- `ffprobe` harus menunjukkan durasi 60,0 detik, 1280x720, 24 fps, ada stream audio.
- Ambil frame di detik 5, 12, 24, 35, 42, 49, 56, 59,2 dan lihat. Frame 59,2 harus hitam penuh (rata-rata piksel sama dengan 0).
- Tidak ada frame hitam atau korup di tengah video, dan tidak ada loncatan kecepatan yang aneh di batas antar clip.

---

## 4. SPESIFIKASI HASIL

- 1280x720, 24 fps, 1440 frame, tepat 60 detik. 8 clip x 7,5 detik, potongan keras antar clip.
- Gaya: sinematik, teal-orange, bloom plus anamorphic streak horizontal pada sumber cahaya terang, vignette, film grain halus. Tanpa teks di layar.
- Waktu hari: golden hour menuju senja, konsisten dan bergerak halus sepanjang 60 detik. Cuaca cerah, jalan kering.
- Mobil utama: supercar hitam doff, bentuk dan warna identik di semua clip.
- Tanpa orang di dalam mobil, tanpa teks atau logo di bodi mobil.

---

## 5. DETAIL TEKNIS PER MODUL

### 5.1 world.py (dunia dan timeline)
- **Waktu dunia vs waktu video**: sama, kecuali clip 5 (30-37,5 s) yang slow-motion 0,4x. Setelah itu waktu dunia = waktu video - 4,5.
- **Kecepatan mobil utama** (m/s, waktu dunia, interpolasi linear lalu diintegrasi jadi posisi z): 0=21, 7,5=23, 15=30, 22,5=36, 30=40, 33=43, 40,5=50, 48=68, 55,5=70.
- **Jalan**: 3 lajur satu arah, lebar 3,7 m, pusat lajur X = -3,7 / 0 / +3,7. Satu tikungan halus di sekitar z mobil pada waktu dunia 36,8 detik (kurvatur Gaussian, total heading sekitar 7 derajat). Semua objek (mobil, pohon) mengikuti garis tengah jalan `r(z)`.
- **Jalur lajur mobil utama**: tengah, pindah ke kiri di waktu dunia 11,5 sampai 14,5, kembali ke tengah di 24,6 sampai 25,7 (easing smoothstep).
- **Lalu lintas**: sedan putih (lajur tengah, 23 m/s, disalip di waktu dunia 18,5), SUV perak (lajur kiri, 24 m/s, disalip di 26,2), hatchback merah (lajur kanan, 24,5 m/s, disalip di 31,4). Posisi awalnya diturunkan dari kondisi "z mobil utama sama dengan z mobil lalu lintas pada saat disalip".
- **Matahari**: azimuth +0,30 rad, elevasi turun dari sekitar 0,105 sampai sedikit di bawah horizon di detik 60. Palet langit (horizon, tengah, zenit) dan warna cahaya berinterpolasi dari emas ke ungu gelap.
- **Pohon**: tiga baris tiap sisi jalan (offset 10-16, 17-28, 29-62 m dari garis tengah), deterministik (`RandomState(7)`), diurutkan menurut z agar bisa dipilih dengan `searchsorted`.

### 5.2 cars.py (model mobil)
- Badan dan kabin dibuat dengan loft: beberapa penampang kontrol (z, setengah lebar, y bawah, y atas) diinterpolasi dengan `PchipInterpolator`, tiap penampang berbentuk superellipse (eksponen sekitar 3-3,4), lalu disambung jadi quad. Normal tiap quad diarahkan keluar dengan membandingkan pusat quad dan pusat penampang.
- Jenis permukaan: body, glass, carbon, tire, rim, arch. Tiap jenis punya warna dasar, kekuatan specular, gloss, dan kekuatan rim Fresnel.
- Roda: silinder 12 sisi (quad), cakram karet, cakram pelek, dan "arch" gelap di bodi dengan bias kedalaman supaya tergambar di atas bodi.
- Aksesori mobil utama: sayap belakang (kotak carbon + 2 penyangga + 2 endplate), splitter depan, difuser. Lampu belakang bentuk Y (emisif), lampu depan tipis.
- Semua poligon dijadikan quad supaya bisa disimpan di satu array (F,4,3).
- Mesh mobil utama saat ini 44 penampang x 28 titik cincin. Mobil lalu lintas 14 x 14.

### 5.3 render.py (kamera dan shader)
- **Kamera**: fungsi `camera(t)` mengembalikan posisi, target, roll, FOV. Basis kamera dibangun dari look-at (+ roll), dengan goyangan halus `shake()`.
- **Langit dan tanah per piksel**: untuk tiap piksel hitung arah sinar di dunia. Elevasi >= 0 adalah langit (gradien tiga titik, glow matahari, cakram matahari, tiga lapis gunung berbasis azimuth). Elevasi < 0 adalah tanah: titik potong sinar dengan bidang y=0, lalu koordinat lokal jalan `xr = X - r(Z)` untuk marka (anti-alias berdasarkan footprint piksel), tekstur noise (dua oktaf via `cv2.remap`, wrap), jejak roda, bayangan pohon bergaris, kilau matahari, dan kabut jarak.
- **Motion blur tanah**: lebar blur = |Δz kamera selama setengah frame|, dipakai untuk melebarkan segitiga cakupan garis putus-putus.
- **Pohon**: billboard poligon (15 titik) dengan skala perspektif, diurutkan dari jauh ke dekat, warna dikabutkan menurut jarak, plus rim cahaya matahari. Motion blur dengan 3 sub-sampel waktu (akumulasi premultiplied). Kalau kamera menghadap menyamping (|fwd.z| < 0,75), pohon yang kedalamannya < 32 m tidak digambar.
- **Mobil**: transformasi ke dunia, backface culling, shading vektor (ambient langit/tanah, diffuse matahari, specular Blinn, rim Fresnel, ambient occlusion sederhana berdasarkan tinggi), kabut, lalu painter's algorithm menurut kedalaman rata-rata dikurangi bias. Poligon yang menyentuh near plane dipotong (Sutherland-Hodgman). Lampu emisif digambar terakhir.
- **Bayangan mobil**: convex hull dari alas mobil dan alas yang diproyeksikan sepanjang arah menjauhi matahari, digambar ke mask lalu di-blur dan dipakai menggelapkan jalan.
- **Post-processing**: bloom (ambang 190, skala 1/4, dua Gaussian), anamorphic streak (box blur horizontal 121 piksel, tinted biru), color grade teal-orange (split toning), kurva-S, vignette, grain (10 pola acak berputar), fade global di akhir.

### 5.4 Clip dan kamera

| Clip | Waktu | Kamera | Aksi |
|---|---|---|---|
| 1 | 0-7,5 | rendah di samping, orbit 78 sampai 132 derajat, radius 11,5 sampai 8, lensa panjang (FOV 34) | pembuka tenang |
| 2 | 7,5-15 | di atas kap, FOV 72, goyang, pitch -4,5 sampai +3,5 derajat | mendekati 3 mobil, pindah lajur kiri |
| 3 | 15-22,5 | sisi kiri jalan, FOV 38 sampai 32 | menyalip sedan |
| 4 | 22,5-30 | drone 5,8 sampai 4,6 m di belakang, tinggi 1,9 sampai 1,35 m | menyalip SUV, lampu rem SUV menyala |
| 5 | 30-37,5 | slow-motion, orbit dari sisi kiri ke belakang | melewati hatchback, tutup di lampu belakang |
| 6 | 37,5-45 | di atas kap, FOV 66, roll mengikuti kurva | jalan kosong dan tikungan |
| 7 | 45-52,5 | helikopter, mundur dulu lalu naik ke 46 m dan menunduk hampir tegak lurus | kecepatan puncak |
| 8 | 52,5-60 | pengejar dari belakang, jarak 11,5 sampai 4,25 m, FOV 42 sampai 52 | lampu belakang memenuhi sekitar 80% frame, redup di 56-57,8, hitam penuh dari 58,5 |

### 5.5 audio.py
- Mesin V10: fundamental = rpm/60*5 Hz, 14 harmonik + sub-harmonik, `tanh` waveshaping, derau knalpot yang dimodulasi fase mesin. rpm diturunkan dari kecepatan dengan 6 rentang gigi (batas 0, 19, 31, 42, 53, 64, 82 m/s) dan dip singkat saat pindah gigi.
- Angin (lowpass 900 Hz + sedikit highpass 2,5 kHz) dan ban (bandpass 300-900 Hz) sebanding dengan kecepatan; level per clip berbeda (dekat kap lebih berisik, aerial lebih jauh).
- Efek: kicau burung (clip 1), klakson jauh (sekitar detik 12), deru lewat tiap overtake (18,5; 26,2; 33,5), decit ban SUV (sekitar detik 25), drone bass + detak jantung (clip 5), rotor helikopter 11 Hz (clip 7), decit ban pendek di detik 57,55.
- Mesin memudar jadi hening di detik 56-57,4. Reverb (konvolusi dengan IR derau 2,2 detik) membuat gema tetap terdengar sampai akhir.
- Normalisasi puncak 0,89, lalu `loudnorm` saat mux.

---

## 6. MASALAH YANG SUDAH DITEMUI (jangan diulang)

1. `cv2.remap` error "dst.cols < SHRT_MAX". Solusi: reshape array koordinat ke `(N/1024, 1024)` dengan padding.
2. Proses background mati ketika sesi tool selesai. Solusi: `setsid nohup ... < /dev/null &`.
3. Mobil hitam tampak cokelat/krem. Penyebab: rim Fresnel dan specular terlalu kuat. Solusi: warna dasar sekitar 0,016, specular 0,10, rim 0,30.
4. Kamera samping di tengah barisan pohon menghasilkan pohon raksasa menutupi langit. Solusi: buang pohon yang kedalamannya < 32 m untuk kamera menyamping.
5. Pola bayangan pohon di jalan terlalu tegas dan kotak-kotak. Solusi: haluskan dengan `clip((band-0.35)/0.6)**2` dan kurangi amplitudo.
6. Hub roda berbentuk "pacman" akibat urutan bias kedalaman. Solusi: hapus cakram hub.
7. File mentah 200 MB karena grain. Solusi: encode ulang CRF 24 saat mux.
8. Array horn/envelope beda satu sampel. Solusi: gunakan `int(d*SR)` konsisten di kedua sisi.

---

## 7. KELEMAHAN SAAT INI (hal yang perlu disempurnakan)

Urut dari yang paling terlihat:
1. Mobil masih terlihat low-poly dan flat-shaded, dengan faset terlihat di bodi.
2. Roda berupa cakram sederhana, tanpa spoke, rem, atau arch yang rapi.
3. Pohon blocky, dan di kamera samping latar banyak siluet gelap besar.
4. Tidak ada refleksi langit pada cat dan kaca mobil.
5. Mobil lalu lintas tidak punya motion blur sendiri, jadi tampak terlalu tajam terhadap latar yang di-blur.
6. Tidak ada partikel debu, lens flare ghost, atau heat haze.
7. Tidak ada kaca depan dengan bayangan interior, tidak ada kaca spion, tidak ada lampu depan menyala di senja.
8. Jalan terlihat terlalu bersih, tanpa retakan, tambalan aspal, tiang, atau pagar pembatas.
9. Posisi lalu lintas hanya 3 mobil. Seharusnya ada beberapa mobil jauh di cakrawala supaya terasa "lalu lintas ringan".
10. Sinkronisasi audio-visual: suara deru lewat hanya diatur lewat waktu overtake, belum dihitung dari jarak kamera sebenarnya (belum ada Doppler akurat).

---

## 8. PEKERJAAN YANG DIMINTA

Kerjakan dalam urutan ini dan tunjukkan perbandingan frame sebelum/sesudah di tiap langkah:

**Prioritas 1: kualitas mobil (paling berdampak)**
1. Naikkan kehalusan bodi: tambah penampang dan titik cincin, hitung normal per titik (rata-rata normal quad di sekelilingnya) lalu lakukan shading per vertex dan interpolasi Gouraud, bukan flat per quad. Tujuan: faset hilang.
2. Tambah refleksi lingkungan palsu: untuk tiap titik hitung vektor refleksi dan ambil warna dari fungsi langit (gradien horizon-zenit + glow matahari). Kaca dan cat hitam jadi memantulkan langit.
3. Perbaiki roda: pelek 5 spoke dengan wedge gelap (hanya terlihat saat kecepatan rendah, lalu jadi disk buram saat cepat), kaliper rem, ban dengan tekstur sidewall.
4. Detail bodi: air intake di sisi, lubang udara di kap, sayap spion, garis panel, lampu depan LED.

**Prioritas 2: lingkungan**
5. Ganti pohon billboard dengan beberapa jenis siluet (pinus, pohon bulat) dan variasi warna, tambahkan pagar pembatas (guardrail) dan tiang lampu di tepi jalan.
6. Tambah tekstur aspal yang lebih kaya (retakan, tambalan, bekas ban) dan garis tengah/marka tepi yang sedikit memudar.
7. Tambah 4-6 mobil lalu lintas jauh dengan kecepatan berbeda supaya cakrawala hidup.

**Prioritas 3: post-processing dan gerak**
8. Motion blur untuk mobil: render mobil di 3-4 sub-waktu (seperti pohon) dan akumulasikan, atau blur arah gerak berdasarkan kecepatan relatif ke kamera.
9. Tambah partikel debu yang tertangkap sinar matahari, lens flare ghost kecil, dan heat haze halus di atas aspal.
10. Anti-aliasing temporal ringan (akumulasi 2 sub-frame) untuk mengurangi kedip pada marka jalan.

**Prioritas 4: audio**
11. Hitung jarak kamera ke mobil utama per sampel, lalu turunkan gain (1/(1+d/5)) dan pitch Doppler dari kecepatan radial. Terapkan terutama di clip 1, 3, dan 5.
12. Tambah lapisan "kokpit" (resonansi rendah) untuk clip 2 dan 6 supaya terasa seperti kamera dekat bodi.

**Opsional kalau mau lompat kualitas (jalur alternatif)**
- Blender headless (`pip install bpy` atau `blender -b`): model mobil dan jalan pakai mesh sungguhan, render dengan Eevee atau Cycles, material PBR, motion blur bawaan. Pakai timeline dari `world.py` sebagai data keyframe. Ini jalur terbaik untuk tampilan fotorealistik tanpa model video AI.
- Three.js + Playwright headless untuk render WebGL: lebih cepat, bisa memakai refleksi dan bayangan GPU kalau mesin punya GPU.
- Untuk hasil benar-benar fotorealistik, pakai prompt Veo 3.0 terpisah (8 clip x 7,5 detik) dan jangan campur dengan hasil kode ini.

---

## 9. KRITERIA SELESAI

- [ ] File `car-chase-60s.mp4` ada, 60,0 detik, 1280x720, 24 fps, H.264 + AAC, ukuran di bawah 60 MB.
- [ ] Frame di detik 59,2 hitam penuh, frame di detik 56 masih menampilkan lampu belakang meredup.
- [ ] Mobil utama konsisten (warna, bentuk, sayap) di 8 clip.
- [ ] Tidak ada artefak besar: kotak hitam, garis vertikal acak, poligon bocor, atau pohon raksasa menutupi frame.
- [ ] Contact sheet 8 frame uji dibandingkan dengan baseline dan jelas lebih baik di mobil dan latar.
- [ ] Audio terdengar tanpa klik atau lonjakan, ada fade mesin di 56-57,4 detik, gema masih terdengar sampai akhir.
- [ ] Seluruh pipeline bisa dijalankan ulang dengan `bash make.sh`.

---

## 10. ATURAN KERJA UNTUK AGEN

1. Kerjakan satu perubahan per giliran, render frame uji, lihat gambarnya dengan tool view image, baru lanjut. Jangan percaya angka tanpa melihat gambar.
2. Simpan versi kerja yang baik sebelum eksperimen besar (`git init` dan commit tiap fase).
3. Kalau satu perubahan memperburuk tampilan, kembalikan, jangan ditumpuk dengan perubahan lain.
4. Jangan pakai aset dari luar (gambar, model 3D, suara). Semua harus lahir dari kode.
5. Laporkan di akhir tiap fase: apa yang diubah, bandingan frame sebelum/sesudah, waktu render per frame, dan masalah yang tersisa.
