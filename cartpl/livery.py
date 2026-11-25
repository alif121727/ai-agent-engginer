"""Livery prosedural: mask 0..1 per titik bodi (Lampiran C.7).

`u` = posisi sepanjang mobil (0 belakang .. 1 depan), `v` = tinggi (0 bawah .. 1 atas).
Nilai 0 = warna dasar, 1 = warna sekunder. Mask dipakai builder sebagai
modulasi warna, bukan tekstur bitmap, supaya tidak perlu berkas gambar.
"""
from __future__ import annotations

import math


def _stripes(liv: dict, v: float, body_height_m: float, aspect: float) -> float:
    """Dua garis simetris mengapit v=0.5.

    `stripe_width_m` adalah lebar nyata (meter), jadi harus dibagi tinggi bodi
    untuk jadi fraksi `v`. Tanpa ini lebar garis berubah saat mobil diganti.
    """
    width = liv.get("stripe_width_m", 0.12)
    gap = 1.0 / (aspect * 4)
    half = (width / max(body_height_m, 1e-6)) / 2
    return 1.0 if abs(abs(v - 0.5) - gap) <= half else 0.0


def _two_tone(v: float) -> float:
    return 1.0 if v < 0.55 else 0.0


def _number_roundel(liv: dict, u: float, v: float, aspect: float) -> float:
    """Roundel nomor di kap. `aspect` menjaga bentuknya tetap bulat saat
    dipetakan ke bodi yang jauh lebih panjang daripada tingginya."""
    cu, cv, rad = 0.72, 0.62, 0.14
    d = math.hypot(u - cu, (v - cv) * aspect)
    return 1.0 if d <= rad else 0.0


def _split(u: float, v: float) -> float:
    return 1.0 if (u + v) > 1.0 else 0.0


def generate_mask(livery: dict | None, u: float, v: float,
                  body_height_m: float = 1.2, aspect: float = 1.6) -> float:
    """Kembalikan 0..1. `livery` None atau style `none` -> selalu 0."""
    if not livery:
        return 0.0
    style = livery.get("style", "none")
    if style == "none":
        return 0.0
    u = min(max(u, 0.0), 1.0)
    v = min(max(v, 0.0), 1.0)
    if style == "stripes":
        return _stripes(livery, v, body_height_m, aspect)
    if style == "two-tone":
        return _two_tone(v)
    if style == "number-roundel":
        return _number_roundel(livery, u, v, aspect)
    if style == "split":
        return _split(u, v)
    raise ValueError(f'livery style "{style}" tidak dikenal')


def mask_coverage(livery: dict | None, n: int = 40, aspect: float = 1.6) -> float:
    """Fraksi area yang terkena warna sekunder. Dipakai test & analytics."""
    if not livery or livery.get("style", "none") == "none":
        return 0.0
    hits = 0
    for i in range(n):
        for j in range(n):
            if generate_mask(livery, i / (n - 1), j / (n - 1), aspect=aspect) > 0.5:
                hits += 1
    return hits / (n * n)
