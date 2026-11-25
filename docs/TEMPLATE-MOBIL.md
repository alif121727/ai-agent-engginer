# Template Mobil (cartpl)

Sistem template parametrik: satu berkas JSON mendeskripsikan sebuah mobil, dan
`cartpl` membangun mesh 3D dari deskripsi itu. Tidak ada geometri yang ditulis
tangan di kode — semua angka berasal dari spec.

## Berkas

```
templates/schema/v1.json   skema + $defs.geometry.proportions
templates/cars/_base.json  nilai dasar yang diwarisi semua template
templates/cars/*.json      6 template konkret
variants/*.json            variasi warna/livery dari template induk
cartpl/                    library Python (builder, validator, cli, livery)
```

Template konkret memakai `meta.extends: "_base"`; field yang tidak ditulis
diwarisi dari induk. `listCarTemplates()` di `src/core/car-templates.ts`
mengikuti rantai `extends` yang sama untuk kebutuhan UI.

## Perintah

```bash
python3 -m cartpl validate                    # validasi semua template
python3 -m cartpl render-preview --all -o public/cartpl-preview --size 512
python3 -m cartpl compare --all -o /tmp/compare.png
python3 -m cartpl estimate mid-engine-supercar
python3 -m cartpl diff a.json b.json
```

Pratinjau yang dirender ke `public/cartpl-preview/` dipakai panel "Template
mobil" di halaman Garasi (`GET /api/car-templates`, publik).

## Tes

```bash
python3 -m pytest tests/ -q
```

433 tes, mencakup validasi (21 kasus invalid E001–E021), loader, builder,
resolver, geometri, livery, CLI, dan estimator. Estimator harus akurat dalam
5%: tiap roda dihitung dua cakram ban (tapak + sisi luar).

## Menambah template

1. Salin template yang paling mirip, ganti `meta.name` dan `meta.display_name`.
2. Jalankan `python3 -m cartpl validate` — skema menolak field tak dikenal.
3. Render pratinjau ke `public/cartpl-preview/<name>.png`.
4. Tambahkan tes bila perilakunya berbeda dari template lain.
