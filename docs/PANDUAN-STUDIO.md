# Panduan Studio AI Otomotif

Dokumen ini menjelaskan cara memakai studio dari nol: masuk, memilih mobil,
menjalankan pipeline, sampai videonya bisa ditonton dan diunduh.

## 1. Alamat situs

| Situs | URL | Kapan dipakai |
| --- | --- | --- |
| GitHub Pages | https://alif121727.github.io/ai-agent-engginer/ | Alamat utama, ikut terbarui setiap push ke `main` |
| Netlify | https://agent-studio-ai.netlify.app | Cermin, deploy manual |
| Backend sandbox | https://work-1-lxpwikokempxmoli.prod-runtime.all-hands.dev | API + UI satu origin, hidup selama sesi sandbox |

Netlify dan Pages hanya berkas statis. Keduanya memanggil API sandbox, jadi
kalau sandbox mati, halaman tetap terbuka tetapi login dan daftar proyek gagal.
Untuk alamat permanen, jalankan `Dockerfile` di host sendiri (lihat README).

## 2. Masuk

| Isian | Nilai |
| --- | --- |
| Username atau email | `admin123` atau `admin@studio.id` |
| Password | `StudioAlif2026` |

Satu kolom menerima username **atau** email. Password minimal 8 karakter.
Kalau lupa, reset dari terminal:

```bash
node --experimental-strip-types scripts/reset-password.ts admin@studio.id PasswordBaru123 admin123
```

Argumen ketiga opsional: username baru. Perintah ini juga membuat akun kalau
belum ada.

## 3. Membuat video (5 langkah)

1. **Pilih mobil.** Katalog berisi 33 model dengan data nyata. Filter tersedia
   untuk sport, klasik, balap, dan modifikasi.
2. **Data & Brief.** Spesifikasi terisi dari katalog dan ditautkan ke sumber
   Wikipedia. Naskah lima babak disusun dari data itu — tidak ada angka karangan.
3. **Storyboard.** Setiap shot bisa diterima, ditolak, atau disusun ulang.
   Durasi total selalu sama dengan target.
4. **Parameter.** Pilih model render, rasio (16:9, 9:16, 1:1), resolusi
   (1080p atau 4K), gaya, dan trek audio.
5. **Pratinjau & Generate.** Periksa ringkasan, lalu tekan
   **Buat proyek & jalankan**.

Setelah proyek dibuat, halaman detail menampilkan progres sembilan tahap:
Rencana → Riset → Naskah → Storyboard → Aset Visual → Motion → Audio → Render
→ QA. Halaman menyegarkan sendiri setiap 3 detik selama masih berjalan.

Render 1080p 30 detik butuh sekitar 2–3 menit pada 4 vCPU. Jangan tutup
worker; tanpa worker, tahap tidak pernah bergerak.

## 4. Menonton dan mengunduh

Progres 9/9 berarti QA menerima video. Pemutar muncul di bagian **Hasil
render**, dan tombol **Unduh mp4** mengambil berkas aslinya.

Video tidak disimpan di Netlify atau Pages. Keduanya menunjuk ke berkas di
backend, dengan token sesi di URL karena tag `<video>` tidak bisa mengirim
header. Tautan itu kedaluwarsa bersama sesi login Anda.

## 5. Kalau gagal

| Gejala | Penyebab umum | Tindakan |
| --- | --- | --- |
| Dashboard menampilkan 0 proyek padahal login berhasil | `CORS_ORIGINS` di backend tidak memuat domain UI, atau header `Authorization` tidak diizinkan | Set `CORS_ORIGINS` berisi kedua domain, lalu restart API |
| Login berhasil tetapi sebentar lagi logout sendiri | Token tidak tersimpan (mode privat peramban) | Pakai jendela normal, atau buka UI dari origin backend |
| Tahap berhenti di Render | Worker mati | `npm run worker`, lalu tekan **Jalankan ulang pipeline** |
| QA menolak video | Aset buram atau gelap | Ganti foto di `assets/own/<slug>/`, ulangi dari tahap Aset Visual |
| Job berstatus `paused_offline` | Koneksi bermasalah | Tunggu monitor mendeteksi koneksi pulih; job lanjut dari scene terakhir |

Rewind memakai nama tahap, bukan nama artefak:

```bash
curl -X POST http://localhost:8080/api/jobs/<id>/retry \
  -H "authorization: Bearer <token>" \
  -H 'content-type: application/json' \
  -d '{"from":"aset-visual"}'
```

## 6. Menambah foto sendiri

Letakkan foto atau video asli di `assets/own/<slug-model>/`. Adapter `local`
dicoba paling awal, jadi folder yang terisi selalu menang atas generator.
Nama folder harus sama dengan slug di `config/catalog.json`
(contoh: `ferrari-f40`).

Periksa dulu bahwa fotonya benar-benar berisi mobil:

```bash
strings assets/own/ferrari-f40/foto-1.jpg | head -1   # "Picsum ID:" berarti foto stok acak
```

## 7. Konfigurasi backend

| Variabel | Kegunaan |
| --- | --- |
| `PORT` | Port API (default 8080) |
| `APP_URL` | Alamat publik, dipakai untuk cookie dan tautan |
| `SESSION_SECRET` | Kunci tanda tangan sesi; ganti di produksi |
| `CORS_ORIGINS` | Daftar origin UI yang diizinkan, dipisah koma |
| `DB_KIND`, `DB_PATH` | `sqlite` (default) atau `postgres` |
| `IMAGE_PROVIDER_API_KEY` | Generator gambar |
| `VIDEO_PROVIDER_API_KEY` | Generator video (image-to-video) |
| `STOCK_API_KEY` | Stock footage (Pexels) |
| `LLM_API_KEY`, `LLM_MODEL` | Model bahasa untuk agen |

Tanpa kunci API, pipeline tetap jalan memakai foto di `assets/own/`. Kalau
folder kosong dan tidak ada kunci, job gagal dengan pesan yang jelas — bukan
menghasilkan video palsu.

## 8. Perintah harian

```bash
npm test              # 130 pemeriksaan
npm run build:ui      # bundle UI ke public/
npm run api           # API + UI
npm run worker        # worker agen
./scripts/serve.sh 12000   # API + worker sekaligus di port publik sandbox
```
