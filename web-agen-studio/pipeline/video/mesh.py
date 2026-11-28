"""Mesh mobil: bodi melengkung (loft berband), bukan kotak.

Koordinat lokal: X kanan, Y atas, Z maju. Mobil berpusat di z=0, panjang 4,5 m,
lebar ~1,84 m. Tiap muka adalah poligon ber-tag warna, diurutkan jauh-ke-dekat
sebelum digambar.

Lengkung dibuat dengan membagi bodi jadi beberapa pita (band) horizontal;
setengah lebar dihitung per titik dari profil + tonjolan fender di atas roda,
jadi sudut-sudutnya tidak lagi segiempat datar.
"""
import math

import numpy as np

PAINT, GLASS, TRIM, LIGHT, PLATE, TYRE = "cat", "kaca", "trim", "lampu", "plat", "ban"

BELT = 1.04          # garis pinggang bodi
ROOF = 1.40
GREEN_W_BASE = 0.70
GREEN_W_ROOF = 0.56
REAR = -2.25
FRONT = 2.25

# Profil setengah lebar bodi terhadap tinggi: sempit di bawah, cembung di
# tengah, menyempit lagi ke garis pinggang.
PROFILE = [(0.30, 0.78), (0.44, 0.88), (0.62, 0.92), (0.86, 0.915), (BELT, 0.86)]
# Stasiun memanjang: buritan, roda belakang, tengah, roda depan, moncong.
STATIONS = (REAR, -1.34, 0.10, 1.22, FRONT)
ARCH_Z = (-1.42, 1.16)   # pusat rumah roda


def _half_width(y: float, z_rel: float) -> float:
    """Setengah lebar bodi di titik (y, z): profil + tonjolan fender."""
    ys = [p[0] for p in PROFILE]
    xs = [p[1] for p in PROFILE]
    base = float(np.interp(y, ys, xs))
    for za in ARCH_Z:
        base += 0.035 * math.exp(-((z_rel - za) / 0.72) ** 2)
    # Moncong dan buritan menyempit sedikit supaya tidak terasa kotak.
    base *= 1.0 - 0.05 * max(0.0, abs(z_rel) - 1.95) / 0.30
    return base


def _poly(points, tag: str):
    return np.array(points, dtype=np.float32), tag


def body_quads(cx: float, z: float) -> list:
    quads: list = []
    zs = [z + s for s in STATIONS]

    # Sisi kiri & kanan: pita melintang, lebar tiap sudut dihitung sendiri.
    for side in (1, -1):
        for (ya, _), (yb, _) in zip(PROFILE, PROFILE[1:]):
            for za, zb in zip(zs, zs[1:]):
                quads.append(_poly([
                    (cx + side * _half_width(ya, za - z), ya, za),
                    (cx + side * _half_width(ya, zb - z), ya, zb),
                    (cx + side * _half_width(yb, zb - z), yb, zb),
                    (cx + side * _half_width(yb, za - z), yb, za),
                ], PAINT))

    # Permukaan atas bodi (garis pinggang) dengan sedikit cembung di tengah.
    for za, zb in zip(zs, zs[1:]):
        tengah = BELT + 0.02
        wa, wb = _half_width(BELT, za - z), _half_width(BELT, zb - z)
        quads.append(_poly([(cx - wa, BELT, za), (cx, tengah, za), (cx, tengah, zb), (cx - wb, BELT, zb)], TRIM))
        quads.append(_poly([(cx, tengah, za), (cx + wa, BELT, za), (cx + wb, BELT, zb), (cx, tengah, zb)], TRIM))

    # Buritan & moncong: poligon mengikuti profil, bukan persegi.
    for zz in (z + REAR, z + FRONT):
        kiri = [(cx - _half_width(y, zz - z), y, zz) for y, _ in PROFILE]
        kanan = [(cx + _half_width(y, zz - z), y, zz) for y, _ in reversed(PROFILE)]
        quads.append(_poly(kiri + [(cx, BELT + 0.02, zz)] + kanan, TRIM))

    quads.append(_poly([(cx - _half_width(0.30, za - z), 0.30, za) for za in zs]
                       + [(cx + _half_width(0.30, za - z), 0.30, za) for za in reversed(zs)], TRIM))
    return quads


def greenhouse_quads(cx: float, z: float) -> list:
    """Kabin: kaca belakang dua pita (sedikit melengkung), atap cembung, pilar."""
    zb, zf = z - 1.52, z + 1.02
    zt0, zt1 = z - 0.98, z + 0.28
    wb, wt = GREEN_W_BASE, GREEN_W_ROOF
    mid_y = (BELT + ROOF) / 2 - 0.015
    mid_z = (zb + zt0) / 2
    mid_w = (wb + wt) / 2
    quads = [
        _poly([(cx - wb, BELT, zb), (cx + wb, BELT, zb),
               (cx + mid_w, mid_y, mid_z), (cx - mid_w, mid_y, mid_z)], GLASS),
        _poly([(cx - mid_w, mid_y, mid_z), (cx + mid_w, mid_y, mid_z),
               (cx + wt, ROOF, zt0), (cx - wt, ROOF, zt0)], GLASS),
        _poly([(cx - wt, ROOF, zt1), (cx + wt, ROOF, zt1),
               (cx + wb, BELT, zf), (cx - wb, BELT, zf)], GLASS),
        # atap cembung: dua pita dengan punggung di tengah
        _poly([(cx - wt, ROOF, zt0), (cx, ROOF + 0.02, zt0), (cx, ROOF + 0.02, zt1), (cx - wt, ROOF, zt1)], PAINT),
        _poly([(cx, ROOF + 0.02, zt0), (cx + wt, ROOF, zt0), (cx + wt, ROOF, zt1), (cx, ROOF + 0.02, zt1)], PAINT),
        # pilar kiri & kanan
        _poly([(cx - wb, BELT, zb), (cx - wb, BELT, zf), (cx - wt, ROOF, zt1), (cx - wt, ROOF, zt0)], PAINT),
        _poly([(cx + wb, BELT, zb), (cx + wb, BELT, zf), (cx + wt, ROOF, zt1), (cx + wt, ROOF, zt0)], PAINT),
        # dasar kabin: menutup celah antara pilar dan bodi
        _poly([(cx - wb, BELT, zb), (cx + wb, BELT, zb), (cx + wb, BELT, zf), (cx - wb, BELT, zf)], TRIM),
    ]
    return quads


def detail_quads(cx: float, z: float, brake: bool = False) -> list:
    w = _half_width(0.84, REAR)
    zr = z + REAR - 0.03
    quads = []
    lampu = "lampu_rem" if brake else LIGHT
    for s in (-1, 1):
        a = cx + s * w * 0.52
        b = cx + s * w * 0.99
        quads.append(_poly([(a, 0.76, zr), (b, 0.76, zr), (b, 0.95, zr), (a, 0.95, zr)], lampu))
    quads.append(_poly([(cx - 0.18, 0.44, zr), (cx + 0.18, 0.44, zr),
                        (cx + 0.18, 0.58, zr), (cx - 0.18, 0.58, zr)], PLATE))
    quads.append(_poly([(cx - w + 0.06, 0.30, zr), (cx + w - 0.06, 0.30, zr),
                        (cx + w - 0.06, 0.40, zr), (cx - w + 0.06, 0.40, zr)], TRIM))
    quads.append(_poly([(cx - 0.30, 0.30, zr), (cx - 0.16, 0.30, zr),
                        (cx - 0.16, 0.40, zr), (cx - 0.30, 0.40, zr)], TRIM))
    return quads


def wheel_quads(cx: float, z: float) -> list:
    quads = []
    for side in (-1, 1):
        # Ban menempel di sisi bodi (setengah lebar di ketinggian roda),
        # tidak menonjol keluar seperti papan.
        base = _half_width(0.46, ARCH_Z[0])
        sx = cx + side * base - 0.10
        for wz in (z + ARCH_Z[0] - 0.32, z + ARCH_Z[1] - 0.32):
            quads.append(_poly([(sx, 0.02, wz), (sx + 0.20, 0.02, wz),
                                (sx + 0.20, 0.64, wz), (sx, 0.64, wz)], TYRE))
            quads.append(_poly([(sx, 0.02, wz + 0.64), (sx + 0.20, 0.02, wz + 0.64),
                                (sx + 0.20, 0.64, wz + 0.64), (sx, 0.64, wz + 0.64)], TYRE))
            quads.append(_poly([(sx + 0.20, 0.02, wz), (sx + 0.20, 0.02, wz + 0.64),
                                (sx + 0.20, 0.64, wz + 0.64), (sx + 0.20, 0.64, wz)], TYRE))
    return quads


def car_quads(cx: float, z: float, hero: bool = False, brake: bool = False) -> list:
    quads = wheel_quads(cx, z) + body_quads(cx, z) + greenhouse_quads(cx, z)
    quads += detail_quads(cx, z, brake=brake)
    if not hero:
        quads = [(p, ("lampu_redup" if tag == LIGHT else tag)) for p, tag in quads]
    return quads
