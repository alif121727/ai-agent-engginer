# LAPORAN AKHIR — sementara (tahap pipeline)

Tanggal: 2026-11-28. Dokumen ini jujur: yang belum selesai tidak ditandai selesai.

## 1 Status per phase

| Phase | Isi | Status |
|---|---|---|
| P0 | env-check, model mobil, kerangka berkas | LULUS — `logs/env-check.txt`, `data/mobil.json` |
| P1 | UI 4 ruang + panel + tema | BELUM |
| P2 | 30 fitur UI/UX | BELUM |
| P3 | Planner/Builder/QA demo | BELUM |
| P4 | Deploy/Ops | BELUM |
| P5 | Pipeline suara | SEBAGIAN — rantai engine, normalisasi, SSML, cache, WER nyata; frasa "malam" belum lulus |
| P6 | Pipeline video | LULUS — 5 dtk preview + 30 dtk final, frame-by-frame, gaya lebih realistis (gradasi bodi, bloom lampu, pantulan aspal, kabut horizon) |
| P7 | Integrasi end-to-end | BELUM (UI belum ada) |
| P8 | Uji akhir menyeluruh | BELUM |

## 2 Video — bukti

`out/video/hero.mp4` (38,6 MB, 900 frame, 30,0 dtk, 1920x1080, h264 + AAC 128k).
`logs/video-check/report.json`:

- durasi 30.0 dtk, fps 30/1, codec h264, audio ada
- kecerahan awal 28.7, tengah 31.1, akhir 5.2 (fade-to-black terbukti)
- gerak antar frame 10.0 vs 10.1 dtk = 11.07 (bukan slideshow)
- 4 menyalip (jadwal 3-6, 9-12, 12.9-18, 18.9-21.9 dtk)
- hero sendirian setelah detik 23

Frame bukti: `logs/video-check/awal.jpg`, `detik-4.jpg`, `detik-10.jpg`,
`tengah.jpg`, `detik-25.jpg`, `akhir.jpg`.

Tidak ada crossfade: setiap frame digambar ulang di `pipeline/video/scenes.py`
(`render_frame`), tanpa fungsi transisi gambar.

## 3 Suara — bukti

`logs/voice-test.json`: 4/5 lulus (WER 0.0 / 0.077 / 0.083 / 0.083 / 0.143).

Yang gagal: "Toyota GR Supra melaju di jalan malam." — STT mendengar "Malang"
(WER 0.143). Penyebab: pelafalan kata "malam" oleh model piper
`id_ID-news_tts-medium`, bukan normalisasi. Belum diperbaiki.

Catatan teknis yang mahal dipelajari:

- `faster-whisper` tidak bisa dipasang di Python 3.13 (paket `av` gagal build),
  jadi STT memakai `openai-whisper` model `small`. Model `base` salah dengar
  angka ("3440" untuk 340), sehingga `small` jadi bawaan.
- WER harus dibandingkan setelah kedua sisi dinormalisasi; tanpa itu angka
  "340" vs "tiga ratus empat puluh" dihitung sebagai kesalahan.
- Piper memotong suku kata terakhir kalau stdin tidak diakhiri baris baru
  ("detik" -> "diti").

## 4 Acceptance test

| Test | Status |
|---|---|
| T13 ffprobe sesuai spesifikasi | LULUS |
| T14 tiga frame uji bergerak + fade akhir | LULUS |
| T15 model mobil = pilihan user | LULUS (nama di `hero.mp4.meta.json`) |
| T16 minimal 3 overtake | LULUS (4) |
| T17 hero sendirian 23-27 dtk | LULUS |
| T18 tidak ada crossfade | LULUS (inspeksi `scenes.py`) |
| T19 resume setelah kill | SEBAGIAN (segmen per 120 frame; belum diuji dengan kill) |
| T11 5 frasa WER <= 10% | GAGAL (4/5) |
| Narasi opsional | LULUS — `--narasi` menghasilkan suara; tanpa flag tidak ada. Audio final ditranskrip balik WER 0.0 |
| Toggle narasi di studio UI | LULUS — `narasiSuara` dikirim dari centang Voiceover; tes `narasi suara hanya dibuat kalau diminta` lulus |
| T12 fallback engine terbukti | SEBAGIAN (edge & gTTS tidak terpasang; jatuh ke piper, tercatat di log) |
| T01-T10, T20 | BELUM (UI belum dibangun) |

## 5 Yang belum & rekomendasi

1. UI 4 ruang + 180 fitur: berkas referensi `Kantor Agent IG.html` belum pernah
   diunggah, jadi belum ditulis (dilarang menebak isinya).
2. Sprite mobil asli belum ada; mobil digambar prosedural dari `data/mobil.json`.
3. Frasa "malam" gagal WER: coba edge-tts (butuh jaringan) untuk kata itu, atau
   ganti model piper.
4. T19 belum diuji dengan kill nyata.

## 6 Cara menjalankan ulang

```bash
cd web-agen-studio
python3 pipeline/video/render.py --model toyota-gr-supra --dur 30 --out out/video/hero.mp4
python3 tests/check_video.py out/video/hero.mp4 30
python3 pipeline/voice/tts.py "Tenaga 340 PS, dan torsi 500 Nm." --out out/audio/uji.mp3
```

## 7 Catatan realism (permintaan terbaru)

Video tetap animasi prosedural, bukan rekaman. Yang ditambahkan supaya terasa
lebih nyata: gradasi bodi + garis panel + rim light, roda dengan pelek berjari,
pantulan mobil di aspal basah, kolam cahaya lampu jalan, bloom lampu, kabut
kota, gradasi bangunan, dan goyangan kamera halus. Batasnya: ini masih
tampilan samping 2D; perspektif 3D (jalan mengecil ke horizon) belum dibuat.

## 8 Risiko

- Piper + whisper kecil masih bisa salah pada kata mirip ("malam"/"Malang").
- Video adalah animasi prosedural, bukan rekaman nyata. Ini sesuai §5 (scene graph),
  tetapi bukan footage asli.
