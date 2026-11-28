# pola.md

Pola kerja yang dipakai pipeline ini, diperbarui setiap kali render selesai.

## Video
- Frame dirender satu per satu dari scene graph L0-L7; tidak ada crossfade foto.
- Urutan wajib: establishing -> hero masuk -> overtake (minimal 3) -> hero sendirian -> fade-to-black.
- Traffic berhenti di-spawn setelah detik 23 (dari 30) supaya hero terlihat sendirian.
- Frame terakhir mendekati hitam (fade 60 frame).

## Suara
- Teks dinormalisasi dulu (angka, Rp, akronim) sebelum masuk TTS.
- Setiap klip divalidasi balik dengan STT; WER > 10% diulang, maksimal 3 kali.
