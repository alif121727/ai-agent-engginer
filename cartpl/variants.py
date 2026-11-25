"""Variant: preset warna/trim dari satu base (Lampiran C.2) dan variasi
prosedural berbasis seed (C.17)."""
from __future__ import annotations

import copy
import hashlib
import json
import math
import random
from pathlib import Path

from .errors import VariantForbiddenOverrideError

ALLOWED_FIELDS = {"colors", "surface_response", "livery"}
ALLOWED_META = {"name", "display_name", "description"}
# Field bersarang yang boleh diubah walau induknya terlarang.
ALLOWED_NESTED = {
    "lights": {"headlight_color", "taillight_color"},
    "wheels": {"brake_caliper_color"},
}

VARIANTS_DIR = Path(__file__).resolve().parent.parent / "variants"


def _assert_allowed(variant: dict) -> None:
    for key, value in variant.items():
        if key in {"schema_version", "variant_of", "meta"}:
            continue
        if key in ALLOWED_FIELDS:
            continue
        if key in ALLOWED_NESTED and isinstance(value, dict):
            bad = set(value) - ALLOWED_NESTED[key]
            if bad:
                raise VariantForbiddenOverrideError(
                    f"variant may not override {key}.{sorted(bad)[0]}",
                    path=f"{key}.{sorted(bad)[0]}",
                    hint=f"{key} hanya boleh override: {sorted(ALLOWED_NESTED[key])}",
                )
            continue
        raise VariantForbiddenOverrideError(
            f"variant may not override {key}",
            path=key,
            hint=f"field yang boleh: {sorted(ALLOWED_FIELDS | set(ALLOWED_NESTED))}",
        )
    # `extends` TIDAK boleh diubah variant: variant selalu turunan base konkret,
    # dan mengubah rantai inheritance dari variant akan melewati aturan
    # "variant hanya boleh sentuh warna/trim".
    bad_meta = set(variant.get("meta", {})) - ALLOWED_META
    if bad_meta:
        raise VariantForbiddenOverrideError(
            f"variant may not override meta.{sorted(bad_meta)[0]}",
            path=f"meta.{sorted(bad_meta)[0]}",
        )


def _deep_set(dst: dict, src: dict) -> None:
    for k, v in src.items():
        if isinstance(v, dict) and isinstance(dst.get(k), dict):
            _deep_set(dst[k], v)
        else:
            dst[k] = copy.deepcopy(v)


def apply_variant(base: dict, variant: dict) -> dict:
    """Gabungkan variant ke base; error kalau variant menyentuh geometri."""
    _assert_allowed(variant)
    out = copy.deepcopy(base)
    for k in ALLOWED_FIELDS | set(ALLOWED_NESTED):
        if k in variant:
            if isinstance(variant[k], dict) and isinstance(out.get(k), dict):
                _deep_set(out[k], variant[k])
            else:
                out[k] = copy.deepcopy(variant[k])
    out.setdefault("meta", {})
    vmeta = variant.get("meta", {})
    if "name" in vmeta:
        out["meta"]["name"] = vmeta["name"]
    if "display_name" in vmeta:
        out["meta"]["display_name"] = vmeta["display_name"]
    if "description" in vmeta:
        out["meta"]["description"] = vmeta["description"]
    out["variant_of"] = variant.get("variant_of", base["meta"]["name"])
    out["meta"]["_variant"] = vmeta.get("name", out["meta"]["name"])
    return out


def list_variants(base_name: str, root: Path = VARIANTS_DIR) -> list[str]:
    if not root.exists():
        return []
    return sorted(p.stem for p in root.glob(f"{base_name}.*.json"))


def load_variant(base_name: str, variant_name: str, root: Path = VARIANTS_DIR) -> dict:
    p = root / f"{variant_name}.json"
    if not p.exists():
        p = root / f"{base_name}.{variant_name}.json"
    if not p.exists():
        from .errors import VariantNotFoundError
        raise VariantNotFoundError(f"variant tidak ditemukan: {variant_name}", path=str(p))
    return json.loads(p.read_text())


# --------------------------------------------------------------------- vary


def _hsv_jitter(rgb: list[float], deg: float, sat_mul: float, val_mul: float) -> list[float]:
    import colorsys

    h, s, v = colorsys.rgb_to_hsv(*rgb)
    h = (h + deg / 360.0) % 1.0
    s = min(max(s * sat_mul, 0.0), 1.0)
    v = min(max(v * val_mul, 0.0), 1.0)
    return [round(c, 4) for c in colorsys.hsv_to_rgb(h, s, v)]


COMPATIBLE_WINGS = {
    "none": ["none", "ducktail", "low"],
    "ducktail": ["ducktail", "low"],
    "low": ["low", "ducktail"],
    "high-fixed": ["high-fixed", "active"],
    "active": ["active", "high-fixed"],
}
LIVERY_STYLES = ["none", "stripes", "two-tone", "number-roundel", "split"]


def vary(base: dict, count: int, seed: int) -> list[dict]:
    """Hasilkan `count` variasi deterministik dari satu base."""
    rng = random.Random(seed)
    out = []
    for i in range(count):
        spec = copy.deepcopy(base)
        spec["colors"]["body_base"] = _hsv_jitter(
            base["colors"]["body_base"],
            deg=rng.uniform(-20, 20),
            sat_mul=rng.uniform(0.75, 1.25),
            val_mul=rng.uniform(0.8, 1.2),
        )
        spec["wheels"]["spokes"] = rng.choice([5, 6, 7, 10])
        spec["wing"]["type"] = rng.choice(COMPATIBLE_WINGS[base["wing"]["type"]])
        style = rng.choice(LIVERY_STYLES)
        liv = {"style": style}
        if style != "none":
            liv["secondary"] = _hsv_jitter(base["colors"]["body_base"], 180, 0.4, 1.4)
            liv["stripe_width_m"] = round(rng.uniform(0.06, 0.20), 3)
        spec["livery"] = liv
        spec["variant_of"] = base["meta"]["name"]
        spec["meta"]["name"] = f"{base['meta']['name']}.v{i:02d}"
        spec["meta"]["display_name"] = f"{base['meta']['display_name']} #{i:02d}"
        spec["meta"]["description"] = f"Variasi prosedural seed {seed} nomor {i}"
        out.append(spec)
    return out


def spec_hash(spec: dict) -> str:
    return hashlib.sha256(
        json.dumps(spec, sort_keys=True, default=str).encode()
    ).hexdigest()
