# Panduan Audio

Cara narasi dibuat, dirapikan, dan dicampur ke video.

## Alur

```
naskah per scene
      │
      ▼
ElevenLabs (mp3 44.1 kHz 192 kbps)
      │
      ▼
pasca-proses: highpass → EQ → kompresor → loudnorm → 48 kHz WAV
      │
      ▼
penempatan timeline (adelay sesuai scene.start)
      │
      ▼
mix: narasi (-16 LUFS) + mesin + musik (-22 LUFS, duck 12:1)
      │
      ▼
AAC 192 kbps 48 kHz
```

## Rantai filter narasi

```
highpass=f=80,
equalizer=f=200:t=q:w=1:g=-2,
equalizer=f=3000:t=q:w=1:g=3,
equalizer=f=5000:t=q:w=1:g=2,
acompressor=threshold=-12dB:ratio=3:attack=5:release=50,
loudnorm=I=-16:TP=-1.5:LRA=11
```

Urutan ini bukan selera:

- `highpass=f=80` membuang gemuruh di bawah 80 Hz. Dilakukan **pertama** supaya
  gemuruh tidak memicu kompresor dan menekan seluruh narasi.
- `equalizer f=200 g=-2` mengurangi bagian "berlumpur" yang membuat suara
  terdengar seperti dari dalam kotak.
- `equalizer f=3000 g=+3` menaikkan kejelasan konsonan. Ini yang membuat kata
  terbaca, bukan sekadar terdengar.
- `equalizer f=5000 g=+2` menambah keterbacaan pada speaker kecil ponsel.
- `acompressor` meratakan jarak antara kata pelan dan kata keras, sehingga
  penonton tidak perlu menaikkan volume.
- `loudnorm` ditaruh **terakhir**. Kalau diletakkan lebih awal, kompresor
  sesudahnya akan merusak level yang baru distabilkan.

Keluaran tahap ini adalah WAV 48 kHz. WAV dipilih agar penggabungan berikutnya
tidak menumpuk kompresi lossy; AAC baru dipakai sekali di akhir.

## Pilihan voice

| Nada | Voice | Cocok untuk |
|---|---|---|
| `energik` | Charlie | sport car, EV |
| `sinematik` | Brian | dokumenter, film pendek |
| `hangat` | George | SUV keluarga, review |
| `tegas` | Adam | mobil mewah, klasik |

Nada dipilih otomatis dari nama model bila pengguna tidak memilih. Contoh:
GT3 RS → `energik`, Fortuner → `hangat`, F40 → `tegas`.

Pengaturan API: `stability 0.5`, `similarity_boost 0.75`, `style 0.3`,
`use_speaker_boost true`. Speaker boost berpengaruh besar pada kejelasan dan
karena itu selalu aktif.

## Mixing

| Lapisan | Target | Catatan |
|---|---|---|
| Narasi | -16 LUFS | trek utama, paling jelas |
| Mesin | -22 LUFS | cukup terasa, tidak menutupi kata |
| Musik | -22 LUFS | turun 12:1 saat narasi berbunyi |

Ducking memakai narasi sebagai pemicu (`sidechaincompress`), bukan mesin.
Memakai mesin sebagai pemicu membuat musik ter-duck sepanjang video karena
mesin tidak pernah berhenti.

Parameter ducking: `threshold=0.03`, `ratio=12`, `attack=10`, `release=400`.
Release 400 ms mencegah efek "pompa" yang terdengar seperti kesalahan mixing.

## Checklist kualitas

```
[ ] Integrated loudness -17 .. -15 LUFS
[ ] True peak <= -1.5 dBTP
[ ] Sample rate 48000 Hz
[ ] Bitrate >= 192 kbps
[ ] Stereo (2 kanal)
[ ] Ada narasi di setiap scene
[ ] Musik turun saat narasi berbunyi
```

Jalankan:

```bash
npm run validate:audio jobs/<id>/video.mp4
```

Keluar dengan kode 1 bila ada yang gagal, jadi bisa dipakai di CI.

## Kalau suara masih tidak jelas

Periksa berurutan:

1. **Apakah ada narasi?** Lihat `jobs/<id>/audio/narration/`. Kalau kosong,
   `TTS_API_KEY` belum diisi atau kuota habis. Cek log worker.
2. **Apakah klip lebih panjang dari scene?** Log menulis
   `narasi N scene lebih panjang dari durasinya`. Persingkat naskah atau
   tambah durasi scene.
3. **Apakah musik menutupi?** Ukur pita frekuensi musik saat narasi dan saat
   jeda. Selisih harus sekitar 6 dB. Kalau tidak, ducking tidak aktif.
4. **Apakah loudness melenceng?** Jalankan `validate:audio`. Kalau di luar
   -17..-15 LUFS, `loudnorm` gagal karena audio sumber kosong atau rusak.
5. **Apakah hanya terdengar di satu perangkat?** Uji di ponsel dengan speaker
   kecil. Kalau di situ kata hilang, naikkan `equalizer f=3000` menjadi `+4`.

## Mesin lokal (gratis)

Tanpa kunci ElevenLabs, narasi dibuat dengan Piper:

```bash
pip install piper-tts
./scripts/fetch-tts-model.sh
```

Piper menulis WAV mono 22 kHz, lalu `synthesizeLocal()` mengubahnya menjadi mp3
44,1 kHz stereo 192 kbps. Bentuk keluaran sama dengan jalur ElevenLabs, jadi
tahap pasca-proses dan mixing tidak berubah.

Keterbatasan yang perlu diketahui: Piper datar secara emosi. Untuk iklan
komersial, ElevenLabs tetap lebih baik. Untuk pratinjau, uji coba, dan render
internal, Piper sudah memadai.

Variabel yang bisa diatur: `PIPER_BIN`, `PIPER_MODEL`,
`PIPER_SENTENCE_SILENCE` (jeda antar kalimat, detik).

## Biaya

Model `eleven_multilingual_v2` sekitar tiga kali `turbo`. Untuk video 30 detik
selisihnya sekitar delapan sen. Narasi di-cache per scene di
`audio/narration/`, jadi render ulang tidak memanggil API lagi selama berkas
`scene-NN.wav` masih ada.
