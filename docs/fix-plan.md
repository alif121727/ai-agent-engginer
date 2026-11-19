# Rencana Perbaikan — AI Studio Otomotif

Catatan penting: proyek ini **bukan** Remotion + Docker + MCP. Pipeline nyatanya:
Node 24 (strip-types) → SQLite → agen per tahap di `src/agents/` → adapter visual
di `src/visuals/` → perakitan ffmpeg di `src/render/assemble.ts` → API Express +
UI Preact di `ui/app.tsx`. Semua instruksi yang menyebut Remotion, `disallowParallelEncoding`,
`concurrency`, MCP, atau `docker compose` tidak punya padanan di sini; padanan
terdekatnya diterapkan dan dicatat di `ASSUMPTIONS.md`.

Urutan kerja (dari error yang paling sering muncul di log):

1. **M-DIAG** — Reproduksi dan dokumentasikan 3 error nyata:
   a) job "stuck" (gagal aset, progres tetap 0%),
   b) aset foto tidak ada untuk model baru,
   c) QA menolak dengan "ketajaman 0".
2. **M-VISUAL** — Adapter fallback berjenjang + validasi respons + provider gratis
   (pollinations) supaya model tanpa foto tetap bisa dirender tanpa placeholder.
3. **M-RENDER** — Pra-validasi aset, gerak kamera (bukan slideshow), validasi
   output ffprobe (durasi/resolusi/bitrate), status `render_invalid`.
4. **M-QA** — Dua putaran pemeriksaan sebelum job dinyatakan selesai.
5. **M-CATALOG** — 27 mobil (balap/sport/klasik) dengan data terverifikasi +
   foto asli + tagline kreatif + naskah detail (mesin, tahun, seri, merk).
6. **M-UI** — Progres/error yang jujur, katalog di form template, banner offline
   di semua halaman, halaman `/diagnostics`.
7. **M-TEST** — Regression test untuk setiap bug yang diperbaiki.

Bukti tiap milestone: log di `logs/issues/`, ringkasan di `docs/issues.md`,
dan `npm test` hijau.
