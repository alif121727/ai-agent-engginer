"""Generate Markdown dari spec + schema (C.14)."""
from __future__ import annotations

import json
from pathlib import Path

from .estimate import estimate
from .physics import derive_physics


def _table(headers: list[str], rows: list[list]) -> str:
    out = ["| " + " | ".join(headers) + " |",
           "|" + "|".join("---" for _ in headers) + "|"]
    for r in rows:
        out.append("| " + " | ".join(str(c) for c in r) + " |")
    return "\n".join(out)


def _rgb255(c) -> str:
    return "#%02x%02x%02x" % tuple(int(round(v)) for v in c)


def _rgb01(c) -> str:
    return "#%02x%02x%02x" % tuple(int(round(float(v) * 255)) for v in c)


def generate_doc(spec: dict, schema: dict | None = None,
                 preview_path: str | None = None) -> str:
    meta, dims = spec["meta"], spec["dimensions"]
    total = dims["overhang_front"] + dims["wheelbase"] + dims["overhang_rear"]
    L: list[str] = []

    L.append(f"# {meta['display_name']}")
    L.append("")
    L.append(meta["description"])
    L.append("")
    L.append(f"- **Nama template**: `{meta['name']}`")
    L.append(f"- **Schema**: `{spec['schema_version']}`")
    if meta.get("_resolved_chain"):
        L.append(f"- **Rantai inheritance**: {' -> '.join('`%s`' % c for c in meta['_resolved_chain'])}")
    if meta.get("tags"):
        L.append(f"- **Tag**: {', '.join(meta['tags'])}")
    L.append("")

    if preview_path:
        L.append(f"![preview]({preview_path})")
        L.append("")

    L.append("## Ringkasan dimensi")
    L.append("")
    L.append(_table(["Field", "Nilai", "Satuan"], [
        ["Panjang total", f"{total:.3f}", "m"],
        ["Wheelbase", f"{dims['wheelbase']:.3f}", "m"],
        ["Track depan / belakang", f"{dims['track_front']:.3f} / {dims['track_rear']:.3f}", "m"],
        ["Overhang depan / belakang", f"{dims['overhang_front']:.3f} / {dims['overhang_rear']:.3f}", "m"],
        ["Tinggi bodi", f"{dims['body_height']:.3f}", "m"],
        ["Ground clearance", f"{dims['ride_height']:.3f}", "m"],
        ["Lebar maksimum", f"{dims['body_width_max']:.3f}", "m"],
        ["Eksponen superellipse", f"{spec['superellipse_exponent']}", "-"],
    ]))
    L.append("")

    L.append("## Geometri")
    L.append("")
    L.append(f"{len(spec['sections'])} section bodi, {len(spec['cabin']['sections'])} section kabin.")
    L.append("")
    L.append(_table(["i", "z (m)", "half_width (m)", "y_bottom (m)", "y_top (m)"], [
        [i, f"{s['z']:.3f}", f"{s['half_width']:.3f}", f"{s['y_bottom']:.3f}", f"{s['y_top']:.3f}"]
        for i, s in enumerate(spec["sections"])
    ]))
    L.append("")

    geo = spec["geometry"]
    L.append("### Konstanta mesh (`geometry`)")
    L.append("")
    L.append(_table(["Field", "Nilai"], [[f"`{k}`", json.dumps(v)] for k, v in geo.items()]))
    L.append("")

    wh = spec["wheels"]
    L.append("## Roda")
    L.append("")
    L.append(_table(["Field", "Nilai"], [
        ["Diameter rim", f"{wh['rim_diameter_m']:.3f} m"],
        ["Lebar rim", f"{wh['rim_width_m']:.3f} m"],
        ["Lebar ban", f"{wh['tire_width_m']:.3f} m"],
        ["Sidewall", f"{wh['tire_sidewall_m']:.3f} m"],
        ["Jumlah spoke", wh["spokes"]],
        ["Gaya spoke", wh["spoke_style"]],
        ["Arch flare", wh["arch_flare"]],
        ["Warna kaliber", _rgb255(wh.get("brake_caliper_color", [200, 200, 200]))],
    ]))
    L.append("")

    L.append("## Material")
    L.append("")
    c, sr = spec["colors"], spec["surface_response"]
    L.append(_table(["Field", "Nilai"], [
        ["Warna bodi", f"`{_rgb01(c['body_base'])}` {json.dumps(c['body_base'])}"],
        ["Finishing", c["body_finish"]],
        ["Tint kaca", c["glass_tint"]],
        ["Carbon weave", c["carbon_weave"]],
        ["Specular bodi", sr["body_specular"]],
        ["Gloss bodi", sr["body_gloss"]],
        ["Rim bodi", sr["body_rim"]],
        ["Specular kaca", sr["glass_specular"]],
        ["Rim kaca", sr["glass_rim"]],
    ]))
    L.append("")

    L.append("## Fitur")
    L.append("")
    w, a, sd, lg = spec["wing"], spec["aero_front"], spec["side_details"], spec["lights"]
    L.append(_table(["Field", "Nilai"], [
        ["Sayap", w["type"]],
        ["Span sayap", f"{w.get('span_m', '-')} m"],
        ["Chord sayap", f"{w.get('chord_m', '-')} m"],
        ["Tinggi sayap", f"{w.get('height_above_deck_m', '-')} m"],
        ["Support sayap", w.get("supports", 0)],
        ["Endplate", w.get("endplates", False)],
        ["Splitter", f"{a['splitter']} ({a.get('splitter_depth_m', 0)} m)"],
        ["Canards", a["canards"]],
        ["Intake kap", a["intake_hood"]],
        ["Intake samping", sd["intake_side"]],
        ["Sill skirt", sd["sill_skirt"]],
        ["Spion", sd["mirror_shape"]],
        ["Lampu depan", f"{lg['headlight']} {_rgb255(lg['headlight_color'])}"],
        ["Lampu belakang", f"{lg['taillight']} {_rgb255(lg['taillight_color'])}"],
        ["DRL", lg["drl"]],
    ]))
    L.append("")

    if spec.get("livery"):
        liv = spec["livery"]
        L.append("## Livery")
        L.append("")
        L.append(_table(["Field", "Nilai"], [[f"`{k}`", json.dumps(v)] for k, v in liv.items()]))
        L.append("")

    L.append("## LOD")
    L.append("")
    est = estimate(spec)
    L.append(_table(["max_distance_m", "n_sections", "n_ring", "spokes", "n_quads", "n_verts"], [
        [l["max_distance_m"], l["n_sections"], l["n_ring"], l["spokes"], l["n_quads"], l["n_verts"]]
        for l in est["lods"]
    ]))
    L.append("")

    L.append("## Fisika")
    L.append("")
    phys = derive_physics(spec)
    L.append(_table(["Field", "Nilai"], [
        ["Massa", f"{phys['mass_kg']} kg"],
        ["Drag Cd", phys["drag_cd"]],
        ["Area frontal", f"{phys['frontal_area_m2']} m²"],
        ["Radius roda", f"{phys['wheel_radius_m']} m"],
        ["Gear ratios", ", ".join(str(g) for g in phys["gear_ratios"])],
    ]))
    L.append("")

    if spec.get("preview_camera"):
        L.append("## Kamera preview")
        L.append("")
        L.append(_table(["Field", "Nilai"], [[f"`{k}`", v] for k, v in spec["preview_camera"].items()]))
        L.append("")
    return "\n".join(L)


def write_doc(spec: dict, out_path, preview_path: str | None = None) -> Path:
    p = Path(out_path)
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(generate_doc(spec, preview_path=preview_path))
    return p
