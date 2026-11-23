# Audit Audio — "Suara Tidak Jelas"

Tanggal: 2026-11-23 · Prompt O

## Ringkasan

Keluhan "suara tidak jelas" bukan masalah kualitas mixing. **Penyebab utamanya:
video tidak berisi narasi sama sekali.** Pipeline hanya memasukkan suara mesin
dan musik latar. Tidak ada satu kata pun yang diucapkan.

Ini terkonfirmasi dari tiga bukti di bawah, bukan dugaan.

## Temuan

### 1. Tidak ada TTS (akar masalah) — ❌ KRITIS

`src/agents/tools.ts`, sebelum perbaikan:

```ts
tool('synthesize_speech', 'Siapkan rencana TTS', async (args, ctx) => {
  const text = String(args.text ?? '');
  return { text, engine: process.env.TTS_ENGINE ?? 'belum-dikonfigurasi' };
});
```

Fungsi ini hanya mengembalikan teks yang sama. Tidak ada panggilan API, tidak ada
berkas audio. Agen audio tetap melaporkan sukses karena tidak ada yang gagal.

`src/render/assemble.ts` juga hanya memanggil `buildEngineTrack` dan
`buildMusicBed`, lalu `muxAudio(silent, music, out, lufs, engine)`. Parameter
narasi tidak ada di tanda tangan fungsi itu.

Akibatnya narasi hanya hidup sebagai subtitle di `audio.json` dan tidak pernah
terdengar.

### 2. Angka loudness sudah benar, jadi validasi angka saja menyesatkan — ⚠️

Video lama (`cc18e34f…`) diukur:

| Metrik | Nilai | Target | Status |
|---|---|---|---|
| Integrated loudness | -16.16 LUFS | -16 ± 1 | lulus |
| True peak | -5.70 dBTP | ≤ -1.5 | lulus |
| Sample rate | 48000 Hz | 48000 | lulus |
| Bitrate | 194 kbps | ≥ 192 | lulus |
| Channels | 2 (stereo) | 2 | lulus |

Semua angka lulus, padahal tidak ada narasi. **Kesimpulan: gerbang kualitas
harus memeriksa keberadaan dan isi narasi, bukan hanya loudness.**

### 3. Ducking lama memakai trek mesin sebagai pemicu, bukan suara — ⚠️

Kode lama:

```
[bed][engkey]sidechaincompress=threshold=0.03:ratio=8:attack=8:release=260
```

Musik diturunkan oleh **mesin**, yang berbunyi sepanjang video. Jadi musik
ter-duck hampir terus-menerus dan tidak pernah menyesuaikan diri dengan
pembicara. Ini juga membuat musik terdengar "bernafas" tanpa alasan.

## Perbaikan

| # | Perubahan | Berkas |
|---|---|---|
| 1 | Modul TTS nyata, voice per nada, model `eleven_multilingual_v2`, `mp3_44100_192` | `src/tts/provider.ts` (baru) |
| 2 | Sintesis per scene + pasca-proses + penempatan timeline | `src/render/narration.ts` (baru) |
| 3 | Narasi masuk mix; ducking dipicu narasi, bukan mesin | `src/render/audio.ts` |
| 4 | Narasi disintesis saat render | `src/render/assemble.ts` |
| 5 | `synthesize_speech` benar-benar menghasilkan berkas | `src/agents/tools.ts` |
| 6 | Skrip validasi audio | `scripts/validate-audio.ts` (baru) |
| 7 | Pemilih nada suara di UI | `studio/src/pages/NewVideo.tsx` |

## Bukti sesudah perbaikan

Render job `8a5c7eb5747a4526ac554e5e5f6bb8ca` (6 scene, 30 dtk, 1080p):

```
LULUS  jobs/8a5c7eb…/video.mp4
  loudness -16.29 LUFS · true peak -8.95 dBTP · LRA 1.7
  48000 Hz · 2 kanal · 192 kbps · 30.0 dtk
```

Narasi terdengar di setiap scene (RMS per 2 detik pertama tiap scene):
`-18.3`, `-17.6`, `-17.5`, `-17.5`, `-17.7`, `-17.8` dB — tidak ada scene
yang senyap.

Penempatan timeline diuji terpisah dengan tiga scene pada 0/8/16 detik:
bersuara di 0-3 s dan 8-10 s serta 16-18 s, `-inf` dB di jeda 5-7 s dan
12-15 s. Artinya klip tidak menumpuk di detik nol.

Ducking diuji dengan musik 220 Hz: level pita 220 Hz turun dari `-22.7` dB
(jeda) ke `-28.8` dB (saat narasi) — sekitar 6 dB, sesuai tujuan.

## Catatan biaya

`eleven_multilingual_v2` kira-kira tiga kali lebih mahal daripada `turbo`.
Untuk narasi 30 detik (~450 karakter) selisihnya sekitar delapan sen per video.
Itu harga yang wajar untuk suara yang bisa didengar; `turbo` justru
menghasilkan suara datar yang menjadi keluhan awal.

## Yang belum dikerjakan

- Preview voice-over per scene di halaman review. Saat ini nada dipilih di
  wizard; preview belum ada karena butuh endpoint sintesis terpisah.
- A/B mendengarkan di tiga perangkat. Itu penilaian manusia, tidak bisa
  dilakukan otomatis di sini.
- Video lama tidak dirender ulang. Video baru otomatis memakai jalur ini.

## Cara mengaktifkan

```bash
export TTS_API_KEY=<kunci ElevenLabs>
# opsional, untuk proxy atau pengujian:
export TTS_BASE_URL=https://api.elevenlabs.io
```

Tanpa kunci, video tetap dirender dengan mesin + musik dan log mencatat
`narasi tidak dibuat`. Tidak ada audio palsu.
