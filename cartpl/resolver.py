"""Constraint solver: ubah preset high-level jadi angka konkret (Lampiran C.4).

Dijalankan setelah `loader.resolve`, sebelum `validator`. Preset menang atas
field konkret dan menghasilkan warning, kecuali `preset_lock=True`.
"""
from __future__ import annotations

import copy

STANCE_PRESETS = {
    "slammed": {"ride_height": 0.09, "tire_sidewall_m": 0.08, "y_bottom_delta": -0.02},
    "rally": {"ride_height": 0.20, "tire_sidewall_m": 0.13, "y_bottom_delta": 0.05},
    "track": {"ride_height": 0.10, "arch_flare": True, "y_bottom_delta": 0.0},
    "stock": {},
}

AERO_PRESETS = {
    "track": {
        "wing": {"type": "high-fixed"},
        "canards": 4,
        "splitter": True,
        "splitter_depth_m": 0.20,
    },
    "street": {"wing": {"type": "low"}, "canards": 0},
    "clean": {"wing": {"type": "none"}, "splitter": False, "splitter_depth_m": 0.0},
}

TIRE_PRESETS = {
    "street": {"tire_width_m": 0.24, "tire_sidewall_m": 0.11},
    "semi-slick": {"tire_width_m": 0.28, "tire_sidewall_m": 0.09},
    "slick": {"tire_width_m": 0.31, "tire_sidewall_m": 0.07},
}

Y_BOTTOM_MIN = 0.05


def _set_with_warning(spec: dict, path: str, value, warnings: list[str], lock: bool) -> None:
    """Tulis nilai preset; catat warning kalau menimpa nilai konkret berbeda."""
    node = spec
    parts = path.split(".")
    for p in parts[:-1]:
        node = node[p]
    key = parts[-1]
    old = node.get(key)
    if old is not None and old != value:
        if lock:
            warnings.append(f"preset ignored for {path}: keeping {old!r} (preset-lock)")
            return
        warnings.append(f"preset overrides {path}: {old!r} -> {value!r}")
    node[key] = value


def apply_presets(spec: dict, *, preset_lock: bool = False) -> tuple[dict, list[str]]:
    warnings: list[str] = []
    spec = copy.deepcopy(spec)
    presets = spec.get("presets")
    if not presets:
        return spec, warnings

    stance = presets.get("stance")
    if stance:
        if stance not in STANCE_PRESETS:
            raise ValueError(f'preset stance "{stance}" tidak dikenal; '
                             f'pilihan: {", ".join(STANCE_PRESETS)}')
        p = STANCE_PRESETS[stance]
        if "ride_height" in p:
            _set_with_warning(spec, "dimensions.ride_height", p["ride_height"], warnings, preset_lock)
        if "tire_sidewall_m" in p:
            _set_with_warning(spec, "wheels.tire_sidewall_m", p["tire_sidewall_m"], warnings, preset_lock)
        if "arch_flare" in p:
            _set_with_warning(spec, "wheels.arch_flare", p["arch_flare"], warnings, preset_lock)
        delta = p.get("y_bottom_delta", 0.0)
        if delta:
            for s in spec["sections"]:
                s["y_bottom"] = max(Y_BOTTOM_MIN, round(s["y_bottom"] + delta, 4))

    aero = presets.get("aero")
    if aero:
        if aero not in AERO_PRESETS:
            raise ValueError(f'preset aero "{aero}" tidak dikenal; '
                             f'pilihan: {", ".join(AERO_PRESETS)}')
        p = AERO_PRESETS[aero]
        for k, v in p.get("wing", {}).items():
            _set_with_warning(spec, f"wing.{k}", v, warnings, preset_lock)
        if "canards" in p:
            _set_with_warning(spec, "aero_front.canards", p["canards"], warnings, preset_lock)
        if "splitter" in p:
            _set_with_warning(spec, "aero_front.splitter", p["splitter"], warnings, preset_lock)
        if "splitter_depth_m" in p:
            _set_with_warning(spec, "aero_front.splitter_depth_m",
                              p["splitter_depth_m"], warnings, preset_lock)

    tire = presets.get("tire")
    if tire:
        if tire not in TIRE_PRESETS:
            raise ValueError(f'preset tire "{tire}" tidak dikenal; '
                             f'pilihan: {", ".join(TIRE_PRESETS)}')
        for k, v in TIRE_PRESETS[tire].items():
            _set_with_warning(spec, f"wheels.{k}", v, warnings, preset_lock)

    spec.pop("presets", None)
    return spec, warnings
