# AUDIT AUDIO — FASE 0 (Diagnostik)

Tanggal: 2026-11-20
Repo: `/workspace/project` (bukan `/workspace/ai-agent-engginer`)
Status: **diagnostik saja — tidak ada kode yang diubah**

---

## Ringkasan eksekutif

Premis prompt tidak sepenuhnya cocok dengan kondisi repo. Tiga dari lima
keluhan di prompt **tidak terbukti** ada di data nyata, dan satu keluhan yang
sangat nyata **tidak disebut** di prompt sama sekali.

| Keluhan di prompt | Terbukti? | Bukti |
|---|---|---|
| Video tidak punya audio stream | **TIDAK** | 56/57 video `done` punya audio 48 kHz. 0 tanpa audio. |
| FFmpeg gagal di berbagai tahap | **TIDAK** | 0 kegagalan mux/normalisasi di 57 job. Semua 48 kHz. |
| Audio error / gagal render | **TIDAK** | Tidak ada job `failed` karena audio. |
| Narasi tenggelam oleh musik | **SEBAGIAN** | Bukan tenggelam — narasi **hilang total** sejak 24 Nov. |
| Tidak ada fallback saat API gagal | **TIDAK** | Fallback ada: ElevenLabs → Piper → lewati. |
| *(tidak disebut prompt)* | **YA, KRITIS** | Mesin suara: 27 dari 33 model pakai sintesis, bukan rekaman. |

**Kesimpulan:** pipeline audio repo ini sudah lebih matang daripada yang
diasumsikan prompt. Yang rusak adalah **satu hal spesifik**: mesin TTS lokal
(Piper) tidak terpasang, sehingga narasi hilang tanpa suara dan tanpa log.

---

## 1. Dependensi

| Item | Hasil |
|---|---|
| `ffmpeg` | **7.1.5-0+deb13u1** di `/usr/bin/ffmpeg` ✅ |
| `ffprobe` | **7.1.5-0+deb13u1** di `/usr/bin/ffprobe` ✅ |
| `ffmpeg-static` | tidak ada |
| `fluent-ffmpeg` | tidak ada |
| `@ffmpeg-installer` | tidak ada |

ffmpeg dipanggil lewat `spawnSync` langsung, bukan pustaka pihak ketiga. Ini
alasan `ffmpeg-static` tidak diperlukan: sistem sudah punya biner.

Dependensi runtime hanya `express`, `pg`, `zod`. Tidak ada vitest — test runner
adalah `tests/run.ts` buatan sendiri (`npm test`).

## 2. File audio yang ada

Manifest rekaman mesin: `assets/audio/manifest.json`, 6 entri, semua
`*.m4a` 14 detik, sumber Wikimedia Commons **CC BY 3.0**, atribusi lengkap
(artis + URL). Format terverifikasi: AAC 48 kHz stereo.

Model TTS lokal: `assets/tts/id_ID-news_tts-medium.onnx` (62,9 MB) + `MODEL_CARD`.
**Biner `piper` tidak ada** di `~/.local/bin`, `/usr/local/bin`, maupun `/usr/bin`.

## 3. Kode TTS

Berkas: `src/tts/provider.ts` (342 baris).

| Aspek | Status |
|---|---|
| Model | `eleven_multilingual_v2` ✅ (bukan turbo) |
| Output format | `mp3_44100_192` ✅ (sudah 192 kbps) |
| Voice settings | `stability 0.5`, `similarity_boost 0.75`, `style 0.3`, `use_speaker_boost true` ✅ |
| Timeout | **ada**, 60 s via `AbortController` ✅ |
| Validasi hasil | **ada**, tolak `< 1024` byte ✅ |
| Retry | **TIDAK ADA** ❌ — satu percobaan, langsung menyerah |
| Penanganan 429 | **TIDAK ADA** ❌ — tidak membaca `retry-after` |
| Fallback | **ada**: ElevenLabs → Piper → `skipped: true` ✅ |
| Voice per tone | **ada**: 4 tone (energik, sinematik, hangat, tegas) ✅ |

Perbandingan dengan usulan prompt: prompt menyarankan 5 tone berbahasa Inggris
(`energetic`, `cinematic`, ...) dengan voice ID berbeda. Repo sudah punya 4 tone
**Bahasa Indonesia** yang terhubung ke `toneForModel()` (tone otomatis dari jenis
mobil). Mengganti nama tone akan memutus UI dan `brief.suaraTone` — **jangan
diganti**.

## 4. Kode FFmpeg

Semua pemanggilan: `src/render/ffmpeg.ts`, `src/render/audio.ts`,
`src/render/narration.ts`, `src/render/assemble.ts`, `src/visuals/adapters.ts`.

| Filter yang diminta prompt | Sudah ada? | Lokasi |
|---|---|---|
| `loudnorm` | ✅ | `audio.ts` `muxAudio`, `narration.ts` `NARRATION_FILTER` |
| `sidechaincompress` (ducking) | ✅ | `audio.ts` — rasio 12:1, attack 10 ms, release 400 ms |
| `amix` | ✅ | `audio.ts` `muxAudio` |
| `filter_complex` | ✅ | `audio.ts`, `narration.ts` |
| `highpass` + EQ + `acompressor` | ✅ | `narration.ts` `NARRATION_FILTER` |

**Timeout: tidak ada satu pun `spawnSync` ffmpeg yang memakai opsi `timeout`.** ❌
Ini risiko nyata: ffmpeg yang menggantung akan membekukan worker tanpa batas.

Catatan penting yang sudah ditangani kode: `loudnorm` mengeluarkan 192 kHz, dan
dua instance `loudnorm` di dalam `amix` membuat ffmpeg 7.x abort
(`Assertion best_input >= 0 failed`) → video keluar tanpa audio. Kode menutup
setiap `loudnorm` dengan `aresample=48000`. **Ini justru bug "video tanpa audio"
yang mungkin pernah terjadi, dan sudah diperbaiki di repo.**

## 5. Log error

Tidak ada folder `logs/`. Log ada di SQLite `data/studio.db` tabel `job_events`
(1.002 event) dan `/tmp/api.log`, `/tmp/worker.log`.

Hasil grep `audio|ffmpeg|tts|narasi`:

- **0** event `narasi tidak dibuat`
- **0** error mux / normalisasi
- 5 event `narasi N scene lebih panjang dari durasinya, teks akan terpotong`
- 18 event `suara mesin: sintesis cadangan (...)`

## 6. Video output

57 job `done`, 56 punya berkas `video.mp4`.

| Pemeriksaan | Hasil |
|---|---|
| Video tanpa audio stream | **0** |
| Sample rate | **48.000 Hz pada 56/56** ✅ |
| Bitrate audio | 191–216 kbps, semua ≥ 192 kecuali 1 (191) |
| Mean volume | −17,8 … −19,2 dB — **tidak ada yang silent** ✅ |
| Berkas hilang | 1: job `a1e8ad0b` (Toyota GR Supra, 20 Nov) — direktorinya sudah tidak ada |

Kesimpulan: **tidak ada satu pun video tanpa audio, dan tidak ada yang silent.**

## 7. Simulasi render

Tidak dijalankan render baru. Alasan: 3 job terakhir (24 Nov) sudah cukup
sebagai bukti dan semuanya selesai `done` 100% dengan audio valid. Render baru
akan memakan ~6 menit tanpa menambah informasi.

---

## Temuan utama: narasi hilang total sejak 24 November

Ini akar masalah yang sebenarnya, dan **bukan** "narasi tenggelam oleh musik".

### Bukti

| Tanggal | File narasi per job | Log narasi |
|---|---|---|
| 23 Nov (7 job) | 7 file + `narration.wav` | `narasi: 6 scene, voice energik` |
| 24 Nov (3 job) | **0 file** | **0 log** |

Job 24 Nov termasuk Corvette C8 Z06 yang kita render ulang. Direktori
`jobs/<id>/audio/narration/` **kosong**, dan tidak ada satu pun event
`narasi tidak dibuat` — jadi bukan gagal, tapi dilewati tanpa jejak.

### Root cause

`ttsAvailable()` di `src/tts/provider.ts`:

```
piperBinary: null                                  ← biner tidak terpasang
piperModel : /workspace/project/assets/tts/id_ID-news_tts-medium.onnx
available  : false
provider   : tidak-ada
```

Model ONNX 62 MB **ada di repo**, tetapi biner `piper` tidak. Tanpa
`TTS_API_KEY` dan tanpa biner Piper, tidak ada penyedia TTS. Kode lalu
mengembalikan `skipped: true`, dan `assemble.ts` hanya mencatat log bila
`!narration.skipped` — sehingga **tidak ada log sama sekali**. Itu sebabnya
gejalanya terlihat seperti "audio error" padahal narasi memang tidak pernah
dibuat.

### Mengapa 23 Nov punya narasi

Piper sempat terpasang saat job 23 Nov dirender (17 event narasi sukses pada
tanggal itu), lalu hilang — kemungkinan sandbox di-reset. Ini konsisten dengan
catatan memori proyek bahwa reset sandbox menghapus ffmpeg.

### Dampak ke pengguna

Video 40 detik hanya berisi mesin + musik. Karena musik di-duck oleh narasi
**hanya bila narasi ada**, tanpa narasi musik berjalan penuh. Itu menjelaskan
keluhan "suara ada yang benar dan ada yang salah": yang terdengar adalah mesin
sintesis + musik, tanpa suara manusia sama sekali.

---

## Daftar masalah & prioritas

| # | Masalah | Dampak | Prioritas |
|---|---|---|---|
| 1 | Biner `piper` hilang → narasi tidak pernah dibuat | Video tanpa narasi; musik terdengar dominan | **KRITIS** |
| 2 | Narasi dilewati tanpa log (`skipped` tidak dilaporkan) | Kegagalan tidak terlihat di UI/log | **KRITIS** |
| 3 | 27/33 model pakai mesin sintesis, bukan rekaman | Suara mesin terdengar palsu | **TINGGI** |
| 4 | `synthesizedLocally: true` di-hardcode di `tools.ts:508` | UI salah melaporkan sumber audio | **SEDANG** |
| 5 | Tidak ada timeout pada `spawnSync` ffmpeg | Worker bisa membeku | **SEDANG** |
| 6 | TTS tanpa retry / tanpa penanganan 429 | Satu gangguan jaringan = scene tanpa narasi | **SEDANG** |
| 7 | QA tidak memeriksa apakah audio berisi narasi | Video tanpa narasi tetap lolos 26/26 | **TINGGI** |
| 8 | 1 job lama kehilangan direktori | Data historis hilang | **RENDAH** |

---

## Yang TIDAK perlu dikerjakan (sudah ada di repo)

Agar tidak membangun ulang secara sia-sia:

- `lib/tts/elevenlabs.ts`, `lib/render/ffmpeg.ts`, `lib/render/audio.ts`,
  `lib/render/mix.ts`, `lib/render/concat.ts`, `lib/render/verify.ts`,
  `lib/audio/preflight.ts`, `lib/audio/cleanup.ts`, `lib/audio/fallback.ts`
  → **tidak perlu dibuat**. Fungsinya sudah ada di `src/render/*` dan
  `src/tts/*`, dengan struktur repo yang berbeda (tanpa folder `lib/`).
- Vitest → repo memakai `tests/run.ts`. Menambah vitest = dua test runner.
- `ELEVENLABS_API_KEY` hardcode → sudah dibaca dari env.
- Normalisasi 48 kHz / 192 kbps / −16 LUFS → sudah diterapkan dan terverifikasi
  di 56 video.
- Ducking narasi vs musik → sudah ada (12:1).

---

## Rencana revisi (menggantikan 6 fase prompt)

| Fase | Isi | Alasan |
|---|---|---|
| **A** | Pasang Piper + buat `ttsAvailable()` melaporkan alasan + log `skipped` | Memperbaiki akar masalah #1 & #2 |
| **B** | Tambah retry + penanganan 429 di `synthesize()` | #6 |
| **C** | Tambah gerbang QA: audio harus berisi narasi (bila `voiceover` ada) | #7 — mencegah regresi diam-diam |
| **D** | Perbaiki `synthesizedLocally` agar jujur + tampilkan sumber audio di UI | #4 |
| **E** | Tambah timeout ke semua `spawnSync` ffmpeg | #5 |
| **F** | Rekam mesin untuk model populer (Corvette, Supra, GT-R Nismo) | #3 |

Fase A–C mengembalikan fitur yang hilang. D–F meningkatkan kualitas.

---

## Perlu keputusan Anda sebelum lanjut

1. **Piper**: boleh saya `pip install piper-tts` di sandbox? Ini mesin lokal,
   tanpa biaya, tanpa API key, dan model ONNX-nya sudah ada di repo.
   (Wheel tersedia untuk Python 3.13: `piper_tts-1.8.0-cp39-abi3-manylinux`.)
2. **Struktur**: saya kerjakan di `src/render/*` dan `src/tts/*` yang sudah ada,
   **bukan** membuat folder `lib/*` baru. Setuju?
3. **Test runner**: tetap `tests/run.ts` (tanpa vitest). Setuju?
4. **Fase F** (rekam mesin) butuh unduh + verifikasi audio dari Wikimedia.
   Kerjakan sekarang, atau tunda?

Saya berhenti di sini sesuai instruksi checkpoint. Tidak ada kode yang diubah.
