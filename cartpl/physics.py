"""Turunkan parameter fisika dari template (Lampiran C.6).

`world.py` memakai nilai ini untuk akselerasi/drag, jadi tidak ada lagi
angka hardcode seperti massa atau area frontal.
"""
from __future__ import annotations

from .errors import PhysicsInconsistentError

DEFAULT_DRAG_CD = 0.34
DEFAULT_MASS_KG = 1400.0
TOL_RADIUS = 0.005


def geometric_wheel_radius(spec: dict) -> float:
    wh = spec["wheels"]
    return wh["rim_diameter_m"] / 2 + wh["tire_sidewall_m"]


def estimate_mass(spec: dict) -> float:
    """Estimasi kasar dari volume bodi. Bukan angka nyata pabrikan."""
    dims = spec["dimensions"]
    length = dims["overhang_front"] + dims["wheelbase"] + dims["overhang_rear"]
    volume = length * dims["body_width_max"] * 2 * dims["body_height"]
    # kerapatan efektif ~85 kg/m3: bodi berongga, bukan balok padat
    return round(min(max(volume * 85.0, 700.0), 2400.0), 1)


def derive_physics(spec: dict) -> dict:
    """Lengkapi semua field fisika; error kalau geometri tidak konsisten."""
    phys = dict(spec.get("physics") or {})
    dims = spec["dimensions"]

    derived_r = geometric_wheel_radius(spec)
    if "wheel_radius_m" in phys:
        if abs(phys["wheel_radius_m"] - derived_r) > TOL_RADIUS:
            raise PhysicsInconsistentError(
                f"wheel_radius_m ({phys['wheel_radius_m']}) tidak konsisten dengan "
                f"geometri ({derived_r:.4f})",
                path="physics.wheel_radius_m",
                hint="hapus field itu (biar diturunkan) atau samakan dengan rim/2 + sidewall",
            )
    phys["wheel_radius_m"] = round(derived_r, 4)
    phys.setdefault("mass_kg", estimate_mass(spec))
    phys.setdefault("drag_cd", DEFAULT_DRAG_CD)
    phys.setdefault("frontal_area_m2",
                    round(dims["body_width_max"] * 2 * dims["body_height"] * 0.85, 3))
    phys.setdefault("gear_ratios", [3.6, 2.4, 1.8, 1.4, 1.15, 0.95])
    return phys


def drag_force(phys: dict, speed_mps: float, air_density: float = 1.225) -> float:
    return 0.5 * air_density * phys["frontal_area_m2"] * phys["drag_cd"] * speed_mps ** 2
