"""Laporan field yang dipakai vs tidak (C.15).

Deteksi statis: cari literal path di source modul konsumen. Pendekatan ini
sengaja sederhana — cukup untuk menandai field yang tidak pernah dibaca.
"""
from __future__ import annotations

import json
import re
from pathlib import Path

PKG = Path(__file__).resolve().parent
REPO = PKG.parent

CONSUMERS = [
    PKG / "builder.py",
    PKG / "preview.py",
    PKG / "physics.py",
    PKG / "livery.py",
    PKG / "estimate.py",
]

# Field yang hanya dibaca bila kondisi tertentu benar.
CONDITIONAL = {
    "wing.span_m": "only if wing.type != none",
    "wing.chord_m": "only if wing.type != none",
    "wing.height_above_deck_m": "only if wing.type != none",
    "wing.supports": "only if wing.type != none",
    "wing.endplates": "only if wing.type != none",
    "wing.material": "only if wing.type != none",
    "aero_front.splitter_depth_m": "only if aero_front.splitter",
    "aero_front.canards": "only if canards > 0",
    "side_details.intake_side": "only if != none",
    "side_details.sill_skirt": "only if true",
    "livery.secondary": "only if livery.style != none",
    "livery.stripe_width_m": "only if livery.style == stripes",
    "livery.number": "only if livery.style == number-roundel",
    "lights.drl": "advisory flag, not drawn separately",
    "colors.carbon_weave": "informational; builder uses KIND_CARBON by normal",
    "colors.glass_tint": "consumed via surface_response in renderer, not builder",
    "wheels.rim_width_m": "consumed by estimate, not by builder mesh",
    "wheels.tire_width_m": "consumed by validator, not by builder mesh",
    "wheels.spoke_style": "visual variant handled by renderer",
    "geometry.rim_segments": "reserved; tire_segments drives the disc",
    "geometry.cabin_n_sections": "scaled against body_n_sections",
    "superellipse_exponent": "read as spec[...] not literal path",
    "cabin.superellipse_exponent": "read via cabin dict",
}


def _read_paths() -> set[str]:
    found: set[str] = set()
    pat = re.compile(r"""["']([a-z_]+(?:\.[a-z_0-9]+)+)["']""")
    for f in CONSUMERS:
        if not f.exists():
            continue
        for m in pat.finditer(f.read_text()):
            found.add(m.group(1))
    return found


def schema_paths(schema: dict | None = None) -> set[str]:
    """Semua path field yang bisa muncul, dari schema v1."""
    if schema is None:
        schema = json.loads((REPO / "templates" / "schema" / "v1.json").read_text())
    out: set[str] = set()

    def walk(node: dict, prefix: str):
        props = node.get("properties")
        if not props:
            return
        for k, v in props.items():
            p = f"{prefix}.{k}" if prefix else k
            if "$ref" in v:
                ref = v["$ref"].split("/")[-1]
                sub = schema.get("$defs", {}).get(ref, {})
                if sub.get("type") == "object" and "properties" in sub:
                    walk(sub, p)
                elif sub.get("type") == "array" and "items" in sub:
                    it = sub["items"]
                    if "$ref" in it:
                        it = schema.get("$defs", {}).get(it["$ref"].split("/")[-1], {})
                    if it.get("type") == "object":
                        walk(it, p)
                out.add(p)
            elif v.get("type") == "object":
                walk(v, p)
                out.add(p)
            else:
                out.add(p)

    walk(schema, "")
    # turunkan juga field di dalam $defs yang dirujuk (mis. geometry, cabin)
    for name in ("geometry", "cabin", "physics", "livery", "camera", "wheels"):
        sub = schema["$defs"].get(name, {})
        if sub.get("type") == "object":
            walk(sub, name)
    return out


def analyze(spec: dict | None = None) -> dict:
    read = _read_paths()
    all_paths = schema_paths()
    used = sorted(p for p in all_paths if p in read)
    unused = sorted(p for p in all_paths if p not in read and p not in CONDITIONAL)
    partial = sorted(p for p in all_paths if p in CONDITIONAL)
    return {
        "used": used,
        "unused": unused,
        "partial": partial,
        "conditional_reason": {p: CONDITIONAL[p] for p in partial},
        "warning": (
            f"{len(unused)} field tidak dipakai; schema mungkin membengkak"
            if len(unused) > 3 else None
        ),
    }


def format_report(result: dict) -> str:
    lines = [f"USED    ({len(result['used'])} fields)"]
    for p in result["used"]:
        lines.append(f"        - {p}")
    lines.append(f"UNUSED  ({len(result['unused'])} fields)")
    for p in result["unused"]:
        lines.append(f"        - {p}")
    lines.append(f"PARTIAL ({len(result['partial'])} fields)")
    for p in result["partial"]:
        lines.append(f"        - {p} ({result['conditional_reason'][p]})")
    if result["warning"]:
        lines.append("")
        lines.append(f"WARNING: {result['warning']}")
    return "\n".join(lines)
