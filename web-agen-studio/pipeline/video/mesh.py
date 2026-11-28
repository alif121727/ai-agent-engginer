"""Mesh mobil low-poly: bodi + greenhouse bertakik, bukan kotak bertumpuk.

Koordinat lokal: X kanan, Y atas, Z maju. Mobil berpusat di z=0, panjang 4,5 m,
lebar 1,84 m. Semua muka adalah quad dengan tag warna, jadi bisa diurutkan
jauh-ke-dekat sebelum digambar.
"""
import numpy as np

PAINT, GLASS, TRIM, LIGHT, PLATE, TYRE = "cat", "kaca", "trim", "lampu", "plat", "ban"

BELT = 1.04          # garis pinggang bodi
ROOF = 1.40
HALF_W = 0.92
GREEN_W_BASE = 0.70
GREEN_W_ROOF = 0.56
REAR = -2.25
FRONT = 2.25


def _quad(p0, p1, p2, p3, tag: str):
    return np.array([p0, p1, p2, p3], dtype=np.float32), tag


def body_quads(cx: float, z: float) -> list:
    """Bodi bawah (0,30 m .. garis pinggang) sebagai kotak dengan bemper."""
    x0, x1 = cx - HALF_W, cx + HALF_W
    z0, z1 = z + REAR, z + FRONT
    y0, y1 = 0.30, BELT
    quads = [
        _quad((x0, y0, z0), (x1, y0, z0), (x1, y1, z0), (x0, y1, z0), PAINT),      # buritan
        _quad((x0, y0, z1), (x1, y0, z1), (x1, y1, z1), (x0, y1, z1), PAINT),      # moncong
        _quad((x0, y0, z0), (x0, y0, z1), (x0, y1, z1), (x0, y1, z0), PAINT),      # sisi kiri
        _quad((x1, y0, z0), (x1, y0, z1), (x1, y1, z1), (x1, y1, z0), PAINT),      # sisi kanan
        _quad((x0, y1, z0), (x1, y1, z0), (x1, y1, z1), (x0, y1, z1), TRIM),       # permukaan atas
        _quad((x0, y0, z0), (x1, y0, z0), (x1, y0, z1), (x0, y0, z1), TRIM),       # alas
    ]
    # Bemper belakang lebih gelap: memisahkan bodi dari jalan.
    quads.append(_quad((x0, y0, z0 - 0.02), (x1, y0, z0 - 0.02),
                       (x1, y0 + 0.16, z0 - 0.02), (x0, y0 + 0.16, z0 - 0.02), TRIM))
    return quads


def greenhouse_quads(cx: float, z: float) -> list:
    """Kabin: kaca belakang miring, atap, kaca depan, pilar menyempit ke atas."""
    zb, zf = z - 1.52, z + 1.02      # ujung kaca belakang & depan di garis pinggang
    zt0, zt1 = z - 0.98, z + 0.28    # atap
    wb, wt = GREEN_W_BASE, GREEN_W_ROOF
    y0, y1 = BELT, ROOF
    quads = [
        _quad((cx - wb, y0, zb), (cx + wb, y0, zb), (cx + wt, y1, zt0), (cx - wt, y1, zt0), GLASS),
        _quad((cx - wt, y1, zt1), (cx + wt, y1, zt1), (cx + wb, y0, zf), (cx - wb, y0, zf), GLASS),
        _quad((cx - wt, y1, zt0), (cx + wt, y1, zt0), (cx + wt, y1, zt1), (cx - wt, y1, zt1), PAINT),
        _quad((cx - wb, y0, zb), (cx - wb, y0, zf), (cx - wt, y1, zt1), (cx - wt, y1, zt0), PAINT),
        _quad((cx + wb, y0, zb), (cx + wb, y0, zf), (cx + wt, y1, zt1), (cx + wt, y1, zt0), PAINT),
    ]
    return quads


def detail_quads(cx: float, z: float, brake: bool = False) -> list:
    x0, x1 = cx - HALF_W, cx + HALF_W
    zr = z + REAR - 0.03
    quads = []
    for s in (-1, 1):
        a = cx + s * HALF_W * 0.52
        b = cx + s * HALF_W * 0.99
        quads.append(_quad((a, 0.76, zr), (b, 0.76, zr), (b, 0.95, zr), (a, 0.95, zr),
                           LIGHT if not brake else "lampu_rem"))
    quads.append(_quad((cx - 0.18, 0.44, zr), (cx + 0.18, 0.44, zr),
                       (cx + 0.18, 0.58, zr), (cx - 0.18, 0.58, zr), PLATE))
    quads.append(_quad((x0 + 0.06, 0.30, zr), (x1 - 0.06, 0.30, zr),
                       (x1 - 0.06, 0.40, zr), (x0 + 0.06, 0.40, zr), TRIM))
    quads.append(_quad((cx - 0.30, 0.30, zr), (cx - 0.16, 0.30, zr),
                       (cx - 0.16, 0.40, zr), (cx - 0.30, 0.40, zr), TRIM))
    return quads


def wheel_quads(cx: float, z: float) -> list:
    quads = []
    for sx in (cx - HALF_W - 0.02, cx + HALF_W - 0.18):
        for wz in (z - 1.42, z + 1.18):
            quads.append(_quad((sx, 0.02, wz), (sx + 0.20, 0.02, wz),
                               (sx + 0.20, 0.66, wz), (sx, 0.66, wz), TYRE))
            quads.append(_quad((sx, 0.02, wz + 0.64), (sx + 0.20, 0.02, wz + 0.64),
                               (sx + 0.20, 0.66, wz + 0.64), (sx, 0.66, wz + 0.64), TYRE))
            quads.append(_quad((sx + 0.20, 0.02, wz), (sx + 0.20, 0.02, wz + 0.64),
                               (sx + 0.20, 0.66, wz + 0.64), (sx + 0.20, 0.66, wz), TYRE))
    return quads


def car_quads(cx: float, z: float, hero: bool = False, brake: bool = False) -> list:
    quads = wheel_quads(cx, z) + body_quads(cx, z) + greenhouse_quads(cx, z)
    if hero:
        quads += detail_quads(cx, z, brake=brake)
    else:
        quads += detail_quads(cx, z)
    return quads
