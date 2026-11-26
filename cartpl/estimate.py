"""Prediksi jumlah quad/vertex sebelum render penuh (Lampiran C.13).

Akurasi target < 5% dibanding `build_car()`. Kalau builder berubah dan
estimator melenceng, `test_estimate.py` gagal — itu memang tujuannya.
"""
from __future__ import annotations

from .lods import all_lods

# Sisa selisih terhadap build_car() berasal dari quad yang dibuang builder
# saat normalnya nol (mis. section yang menyempit jadi titik). Untuk template
# bawaan selisihnya 0-4 quad (< 0,25%), jauh di bawah target 5%.
BODY_QUAD_FACTOR = 1.0
CABIN_SECTION_RATIO = 0.5


def _loft_quads(n_sections: int, n_ring: int) -> int:
    """Badan loft tertutup: (n-1) ring * n_ring quad + 2 * n_ring tutup."""
    return (n_sections - 1) * n_ring + 2 * n_ring


def _wheel_quads(geo: dict, spokes: int) -> int:
    """Satu roda terdiri dari: tapak ban, cakram sisi luar ban, cakram rim,
    cakram cekungan gelap, bibir rim, spoke, kotak kaliber (6 sisi), dan
    cakram arch.

    Cakram sisi luar ban mudah terlewat saat menghitung manual; tanpanya
    estimasi kurang 20 quad per roda (80 per mobil). Cekungan + bibir rim
    masing-masing menambah satu cakram penuh (m quad).
    """
    m = geo["tire_segments"]
    return m + m + m + spokes + 6 + m + 2 * m


def _wing_quads(wing: dict) -> int:
    if wing["type"] == "none":
        return 0
    n = 6                                    # bidang utama
    n += 6 * wing.get("supports", 0)
    if wing.get("endplates"):
        n += 12
    return n


def _aero_quads(spec: dict) -> int:
    aero, dims = spec["aero_front"], spec["dimensions"]
    n = 0
    if aero["splitter"] and aero.get("splitter_depth_m", 0) > 0:
        n += 6
    n += 6 * aero.get("canards", 0) * 2       # kiri + kanan
    return n


def _panel_quads() -> int:
    """Garis panel: 2 celah pintu per sisi + 3 slot ventilasi kap."""
    return 4 + 3


def _side_quads(spec: dict) -> int:
    side = spec["side_details"]
    n = 0
    if side["intake_side"] != "none":
        n += 12                              # 6 sisi * 2 sisi mobil
    if side["sill_skirt"]:
        n += 12
    n += 12                                  # spion: 6 * 2
    return n


def _light_quads(spec: dict) -> int:
    lights = spec["lights"]
    head = {"quad-round": 4, "thin-led": 2}.get(lights["headlight"], 2)
    tail = 2
    return head + tail


def estimate_lod(spec: dict, lod: dict) -> dict:
    geo = spec["geometry"]
    nsec, nring = lod["n_sections"], lod["n_ring"]
    spokes = lod.get("spokes", spec["wheels"]["spokes"])

    cabin_sec = max(8, int(geo["cabin_n_sections"] * nsec / max(1, geo["body_n_sections"])))
    body = int(_loft_quads(nsec, nring) * BODY_QUAD_FACTOR)
    cabin = _loft_quads(cabin_sec, geo["cabin_n_ring"])

    per_wheel = _wheel_quads(geo, spokes)
    wheels = per_wheel * 4

    breakdown = {
        "body": body,
        "cabin": cabin,
        "wheels": wheels,
        "wing": _wing_quads(spec["wing"]),
        "aero_front": _aero_quads(spec),
        "side_details": _side_quads(spec),
        "lights": _light_quads(spec),
        "panel_lines": _panel_quads(),
    }
    n_quads = sum(breakdown.values())
    return {
        "max_distance_m": lod["max_distance_m"],
        "n_sections": nsec,
        "n_ring": nring,
        "spokes": spokes,
        "n_quads": n_quads,
        "n_verts": n_quads * 4,
        "breakdown": breakdown,
    }


def estimate(spec: dict) -> dict:
    lods = [estimate_lod(spec, lod) for lod in all_lods(spec)]
    top = lods[0]
    return {
        "template": spec["meta"]["name"],
        "lods": lods,
        # ~250k quad/detik: angka kasar untuk memberi orde besaran, bukan janji.
        "single_frame_render_estimate_s": round(top["n_quads"] / 250_000, 4),
        "n_surfaces": len({k for k, v in top["breakdown"].items() if v}),
    }
