"""Pemilihan LOD berdasarkan jarak kamera (Lampiran C.5)."""
from __future__ import annotations


def default_lods(spec: dict) -> list[dict]:
    """Tabel default kalau template tidak mendefinisikan `lods`."""
    return [
        {"max_distance_m": 200.0, "n_sections": 44, "n_ring": 28,
         "spokes": spec["wheels"]["spokes"]},
        {"max_distance_m": 50.0, "n_sections": 24, "n_ring": 16, "spokes": 4},
        {"max_distance_m": 15.0, "n_sections": 14, "n_ring": 12, "spokes": 0},
    ]


def all_lods(spec: dict) -> list[dict]:
    lods = spec.get("lods")
    return list(lods) if lods else default_lods(spec)


def pick_lod(spec: dict, distance_m: float) -> dict:
    """LOD pertama yang mencakup jarak itu (tabel urut menaik)."""
    for lod in all_lods(spec):
        if distance_m <= lod["max_distance_m"]:
            return lod
    return all_lods(spec)[-1]
