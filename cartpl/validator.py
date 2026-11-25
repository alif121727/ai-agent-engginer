"""Lapis 2: validasi semantik. Aturan E001-E020 (Lampiran C.3).

Setiap aturan menerima spec final (sudah lewat loader + resolver) dan
mengembalikan daftar `{code, path, message}`. Aturan dibuat kecil dan
independen supaya `tests/data/invalid/E00X.json` bisa menargetkan satu
kode saja.
"""
from __future__ import annotations

import math
from pathlib import Path

TOL_LEN = 0.05
TOL_WIDTH = 0.02
TOL_HEIGHT = 0.02


def _interp_sections(sections: list[dict], key: str, z: float) -> float:
    """Interpolasi linear nilai section pada z tertentu (di-clamp ke ujung)."""
    zs = [s["z"] for s in sections]
    if z <= zs[0]:
        return sections[0][key]
    if z >= zs[-1]:
        return sections[-1][key]
    for i in range(1, len(zs)):
        if z <= zs[i]:
            t = (z - zs[i - 1]) / (zs[i] - zs[i - 1])
            return sections[i - 1][key] + t * (sections[i][key] - sections[i - 1][key])
    return sections[-1][key]


def _err(code: str, path: str, message: str) -> dict:
    return {"code": code, "path": path, "message": message}


def _finite(v) -> bool:
    if isinstance(v, list):
        return all(_finite(x) for x in v)
    return isinstance(v, (int, float)) and math.isfinite(v)


def total_length(dimensions: dict) -> float:
    return dimensions["overhang_front"] + dimensions["wheelbase"] + dimensions["overhang_rear"]


def section_span(sections: list[dict]) -> float:
    return sections[-1]["z"] - sections[0]["z"]


def _check_sections(spec: dict, out: list[dict]) -> None:
    sections = spec["sections"]
    for i in range(1, len(sections)):
        prev, cur = sections[i - 1], sections[i]
        if not cur["z"] > prev["z"]:
            out.append(_err(
                "E001", f"sections[{i}].z",
                f"z ({cur['z']}) must be > sections[{i-1}].z ({prev['z']})",
            ))
    for i, s in enumerate(sections):
        if not s["y_top"] > s["y_bottom"]:
            out.append(_err(
                "E002", f"sections[{i}]",
                f"y_top ({s['y_top']}) must be > y_bottom ({s['y_bottom']})",
            ))

    # E003: panjang total konsisten dengan span sections
    want = total_length(spec["dimensions"])
    got = section_span(sections)
    if abs(want - got) > TOL_LEN:
        out.append(_err(
            "E003", "dimensions",
            f"total length mismatch: sections span {got:.2f} m, dimensions say {want:.2f} m "
            f"(tolerance {TOL_LEN})",
        ))

    # E004: body_width_max >= max half_width
    max_hw = max(s["half_width"] for s in sections)
    bw = spec["dimensions"]["body_width_max"]
    if bw + TOL_WIDTH < max_hw:
        out.append(_err(
            "E004", "dimensions.body_width_max",
            f"body_width_max ({bw}) < max half_width ({max_hw})",
        ))

    # E006: body_height harus menampung titik tertinggi bodi. Membandingkan
    # ke section terakhir salah: section terakhir adalah hidung yang rendah,
    # sehingga body_height bisa jauh di bawah puncak atap tanpa terdeteksi.
    tallest = max(s["y_top"] for s in sections)
    bh = spec["dimensions"]["body_height"]
    if bh + TOL_HEIGHT < tallest:
        out.append(_err(
            "E006", "dimensions.body_height",
            f"body_height ({bh}) < titik tertinggi bodi ({tallest})",
        ))


def _check_wheels(spec: dict, out: list[dict]) -> None:
    dims, wh, geo = spec["dimensions"], spec["wheels"], spec["geometry"]
    max_hw = max(s["half_width"] for s in spec["sections"])

    # E005: roda tidak keluar bodi
    half_track = max(dims["track_front"], dims["track_rear"]) / 2
    if half_track > max_hw + TOL_WIDTH:
        out.append(_err(
            "E005", "dimensions.track_front",
            f"track/2 ({half_track:.3f}) > max half_width ({max_hw:.3f})",
        ))

    # E007: roda harus muat di tinggi sisi bodi pada posisi sumbunya.
    # Ambang 1.25 memberi ruang karena arch memotong bodi di atas roda.
    wheel_r = wh["rim_diameter_m"] / 2 + wh["tire_sidewall_m"]
    total = (dims["overhang_front"] + dims["wheelbase"] + dims["overhang_rear"])
    for label, wz in (("front", total / 2 - dims["overhang_front"]),
                      ("rear", -total / 2 + dims["overhang_rear"])):
        yb = _interp_sections(spec["sections"], "y_bottom", wz)
        yt = _interp_sections(spec["sections"], "y_top", wz)
        half_side = max((yt - yb) / 2, 1e-6)
        if wheel_r > half_side * 1.25:
            out.append(_err(
                "E007", "wheels",
                f"roda {label} terlalu besar: radius {wheel_r:.3f} m > "
                f"1.25 x tinggi sisi bodi ({half_side:.3f} m)",
            ))

    # W005: lebar tapak roda harus muat di dalam rim_width (bukan aturan spec,
    # tapi mencegah mesh roda yang saling tembus).
    if wh["tire_width_m"] < wh["rim_width_m"]:
        out.append(_err(
            "E021", "wheels.tire_width_m",
            f"tire_width_m ({wh['tire_width_m']}) < rim_width_m ({wh['rim_width_m']})",
        ))

    # E022: geometri mesh harus konsisten dengan jumlah section
    if geo["body_n_sections"] > len(spec["sections"]) * 6:
        out.append(_err(
            "E022", "geometry.body_n_sections",
            f"body_n_sections ({geo['body_n_sections']}) terlalu padat untuk "
            f"{len(spec['sections'])} section",
        ))


def _check_wing(spec: dict, out: list[dict]) -> None:
    wing, aero = spec["wing"], spec["aero_front"]
    if wing["type"] == "none":
        # E008
        if wing.get("supports", 0) != 0:
            out.append(_err("E008", "wing.supports",
                            f"wing type none requires supports=0 (got {wing['supports']})"))
        if wing.get("endplates", False):
            out.append(_err("E008", "wing.endplates",
                            "wing type none requires endplates=false"))
    else:
        # E009
        for f in ("span_m", "chord_m", "height_above_deck_m"):
            if wing.get(f) is None:
                out.append(_err("E009", f"wing.{f}",
                                f'wing type "{wing["type"]}" requires {f}'))

    # E010
    if not aero["splitter"] and aero.get("splitter_depth_m", 0) > 0:
        out.append(_err("E010", "aero_front.splitter_depth_m",
                        f"splitter false but depth {aero['splitter_depth_m']} > 0"))


def _check_lods(spec: dict, out: list[dict]) -> None:
    lods = spec.get("lods")
    if not lods:
        return
    # E011/E012 memakai urutan MENURUN (paling detail dulu), sesuai C.5:
    # tabel default C.5 adalah [200, 50, 15] dan `pick_lod` mengambil entri
    # pertama yang mencakup jarak. Dengan urutan menaik, pick_lod(0) justru
    # mengembalikan LOD paling kasar.
    for i in range(1, len(lods)):
        if not lods[i]["max_distance_m"] < lods[i - 1]["max_distance_m"]:
            out.append(_err(
                "E011", f"lods[{i}].max_distance_m",
                f"max_distance_m ({lods[i]['max_distance_m']}) must be < "
                f"lods[{i-1}] ({lods[i-1]['max_distance_m']}); LOD paling detail dulu",
            ))
    if lods[0]["max_distance_m"] < 200:
        out.append(_err(
            "E012", "lods[0].max_distance_m",
            f"LOD paling detail harus mencakup >= 200 m (got {lods[0]['max_distance_m']})",
        ))


def _check_colors(spec: dict, out: list[dict]) -> None:
    colors, surf = spec["colors"], spec["surface_response"]
    # E015
    if not _finite(colors["body_base"]):
        out.append(_err("E015", "colors.body_base", "body_base contains non-finite value"))

    finish, spec_val = colors["body_finish"], surf["body_specular"]
    # E017
    if finish == "matte" and spec_val > 0.15:
        out.append(_err("E017", "surface_response.body_specular",
                        f"matte finish but specular {spec_val}"))
    # E018
    if finish == "gloss" and spec_val < 0.40:
        out.append(_err("E018", "surface_response.body_specular",
                        f"gloss finish but specular {spec_val}"))
    # E019
    if colors["glass_tint"] > 0.5 and surf["glass_specular"] < 0.4:
        out.append(_err("E019", "surface_response.glass_specular",
                        f"heavy tint ({colors['glass_tint']}) with low specular "
                        f"({surf['glass_specular']})"))


def _check_physics(spec: dict, out: list[dict]) -> None:
    phys = spec.get("physics")
    if not phys:
        return
    ratios = phys.get("gear_ratios")
    if ratios:
        for i in range(1, len(ratios)):
            if not ratios[i] < ratios[i - 1]:
                out.append(_err(
                    "E020", f"physics.gear_ratios[{i}]",
                    f"gear_ratios must strictly decrease: {ratios[i-1]} -> {ratios[i]}",
                ))


def _check_meta(spec: dict, out: list[dict], *, source: str) -> None:
    # E013: variant_of tidak boleh di templates/cars/
    if source == "templates" and "variant_of" in spec:
        out.append(_err("E013", "variant_of", "variant_of not allowed in templates/cars/"))
    # E014: extends harus ada
    ext = spec.get("meta", {}).get("extends")
    if ext and ext not in spec.get("meta", {}).get("_resolved_chain", []):
        out.append(_err("E014", "meta.extends", f'extends "{ext}" not found'))


def validate_semantics(spec: dict, *, source: str = "templates") -> list[dict]:
    out: list[dict] = []
    _check_meta(spec, out, source=source)
    _check_sections(spec, out)
    _check_wheels(spec, out)
    _check_wing(spec, out)
    _check_lods(spec, out)
    _check_colors(spec, out)
    _check_physics(spec, out)
    return out


def warnings_for(spec: dict) -> list[dict]:
    """Warning bersifat advisory; aman dipanggil hanya pada spec lengkap."""
    out = []
    if not spec.get("sections") or not spec.get("wing"):
        return out
    if len(spec["sections"]) < 8:
        out.append({"code": "W001", "path": "sections",
                    "message": f"only {len(spec['sections'])} sections; "
                               "consider >= 8 for smoother body"})
    if not spec.get("lods"):
        out.append({"code": "W002", "path": "lods",
                    "message": "no lods defined; default LOD table will be used"})
    if spec["wing"]["type"] != "none" and not spec["wing"].get("endplates"):
        out.append({"code": "W003", "path": "wing.endplates",
                    "message": "wing without endplates looks unfinished at distance"})
    return out


def check_duplicate_names(paths: list[Path]) -> list[dict]:
    """E016: `meta.name` unik di seluruh folder."""
    import json

    seen: dict[str, Path] = {}
    out = []
    for p in paths:
        try:
            name = json.loads(p.read_text())["meta"]["name"]
        except Exception:
            continue
        if name in seen:
            out.append(_err("E016", "meta.name",
                            f'duplicate name "{name}" ({seen[name].name} & {p.name})'))
        else:
            seen[name] = p
    return out
