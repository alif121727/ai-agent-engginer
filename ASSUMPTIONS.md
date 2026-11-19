# ASSUMPTIONS

Catatan asumsi yang diambil saat spesifikasi ambigu. Semua di sini mengikat
implementasi dan harus diubah kalau asumsi ternyata salah.

1. **Runtime**: Node.js >= 22.6 dengan type-stripping native, jadi `.ts` dijalankan
   langsung (`node src/api/main.ts`). Tidak ada langkah build untuk backend; hanya
   UI yang di-bundle dengan esbuild.
2. **Database**: `node:sqlite` (bawaan Node) untuk mode default. Postgres didukung
   lewat `DB_KIND=postgres` + `DATABASE_URL`; lapisan query ditulis ANSI agar bisa
   dipindah tanpa mengubah kode domain.
3. **Antrean**: tabel `jobs` + `job_stages` di database (bukan Redis), karena
   syaratnya "tahan restart". Klaim tugas memakai `UPDATE ... WHERE status='queued'`
   yang atomik.
4. **Tanpa kunci provider = tidak ada visual.** Karena menggambar mobil lewat kode
   dilarang, job mode `final` GAGAL kalau tidak ada satu pun sumber visual
   (lokal, image-gen, video-gen, stock). Mode `draft` boleh memakai placeholder
   bertanda `FALLBACK` supaya pipeline bisa diuji.
5. **Adapter visual** tidak mengunci vendor. `config/visuals.json` menentukan
   urutan prioritas; menambah provider = menambah adapter + entri config.
6. **Pemeriksaan kemampuan LLM** dilakukan sekali (`npm run llm-check`) dan
   hasilnya disimpan di `config/llm.json`. Kalau model tidak bisa menerima gambar,
   QA visual mencatat "visual review dilewati" dan tidak mengklaim kualitas.
7. **Durasi minimum** default 30 detik, dapat diubah di UI (`minDurasi`). Durasi di
   atas minimum dipakai apa adanya; jumlah scene dihitung dari durasi.
8. **`workTime`** hanya mengatur ritme animasi/estimasi, bukan durasi video.
9. **Instagram** default `dryRun: true` supaya tidak pernah mem-publish tanpa izin.
10. **Koneksi internet** dianggap sumber kebenaran dari sisi server. Kalau browser
    putus tapi server online, pekerjaan tetap jalan (opsi `pauseWhenNoViewer` mati).
11. **Zona waktu** default `Asia/Jakarta`.
12. **Tema web** bukan tema video: `themes.json` hanya untuk gaya video per model.
