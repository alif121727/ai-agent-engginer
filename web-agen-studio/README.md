# Web Agen Studio AI v2 (tahap pipeline)

Repo ini berisi dua hal:

1. `web-agen-studio/` — pipeline video frame-by-frame + pipeline suara yang
   sudah jalan dan terverifikasi (tahap P5 & P6 dari SUPER PROMPT v2).
2. Aplikasi Node/Express lama di root repo — tetap seperti sebelumnya.

## Jalankan

```bash
python3 pipeline/video/render.py --model toyota-gr-supra --dur 5  --out out/video/preview.mp4
python3 pipeline/video/render.py --model toyota-gr-supra --dur 30 --out out/video/hero.mp4
python3 tests/check_video.py out/video/hero.mp4 30      # gate T13/T14/T16/T17
python3 pipeline/voice/tts.py "Tenaga 340 PS, dan torsi 500 Nm." --out out/audio/uji.mp3

# Narasi hanya dibuat kalau diminta (tanpa flag = tanpa suara orang)
python3 pipeline/video/render.py --model toyota-gr-supra --dur 8 \
  --out out/video/uji-narasi.mp4 --narasi "Toyota GR Supra melaju di jalan malam."
```

## Struktur

```
data/mobil.json              daftar model + warna + ukuran
pipeline/video/scenes.py     scene graph L0-L7 (langit, skyline, bangunan, jalan, traffic, hero, FX, fade)
pipeline/video/traffic.py    jadwal menyalip (4 kali) + hero sendirian setelah detik 23
pipeline/video/cars.py       sprite PNG atau mobil prosedural
pipeline/video/postfx.py     vignette, grain, bayangan mobil, fade-to-black
pipeline/video/render.py     render chunked -> ffmpeg stdin, resume per segmen, mux audio
pipeline/voice/normalize.py  angka, rupiah, rentang, desimal, akronim
pipeline/voice/tts.py        edge-tts -> piper -> gTTS -> espeak, cache, validasi
pipeline/voice/validate.py   STT balik (whisper small) + WER
tests/check_video.py         gate video: durasi, codec, gerak, fade, jumlah overtake
```

## Bukti terakhir

- `out/video/hero.mp4`: 30,0 dtk, 1920x1080, h264, audio AAC, 900 frame.
- `logs/video-check/report.json`: lulus semua (fade akhir gelap, gerak antar frame,
  4 menyalip, hero sendirian setelah 23 dtk).
- `logs/voice-test.json`: 4 dari 5 frasa lulus WER <= 10 persen; frasa yang gagal
  tercatat apa adanya (piper melafalkan "malam" seperti "Malang").
- Narasi opsional terbukti: `out/video/uji-narasi.mp4` (8 dtk). Audio finalnya
  ditranskrip balik dan hasilnya "Toyota GR Supra Melaju di Jalan Malam", WER 0.0.
  Tanpa `--narasi`, video tetap tanpa suara orang.

## Belum dikerjakan

UI 4 ruang (Planner/Builder/QA/Deploy) + 180 fitur (P1-P4, P7, P8). Lihat
`LAPORAN-AKHIR.md`.
