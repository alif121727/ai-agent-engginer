"""Migrasi schema antar versi (C.11).

Setiap langkah adalah fungsi murni dict -> dict. Dispatch BFS mencari jalur
terpendek dari versi asal ke target; kalau tidak ada jalur, error jelas.
"""
from __future__ import annotations

import json
from collections import deque
from pathlib import Path

from .errors import NoMigrationPathError
from .lods import default_lods
from .schema import CURRENT_VERSION

# (dari, ke) -> fungsi
STEPS: dict[tuple[str, str], callable] = {}


def step(frm: str, to: str):
    def deco(fn):
        STEPS[(frm, to)] = fn
        return fn
    return deco


@step("1.0.0", "1.1.0")
def migrate_1_0_0_to_1_1_0(spec: dict) -> dict:
    spec = dict(spec)
    spec["schema_version"] = "1.1.0"
    if "lods" not in spec:
        spec["lods"] = default_lods(spec)
    return spec


@step("1.1.0", "2.0.0")
def migrate_1_1_0_to_2_0_0(spec: dict) -> dict:
    """v2 mengganti `sections` PCHIP dengan beziers.

    Konversi di sini menjaga bentuk: tiap section jadi anchor dengan handle
    horizontal sepertiga jarak tetangga, sehingga kurva melewati titik yang
    sama (PCHIP juga melewati semua titik).
    """
    spec = dict(spec)
    spec["schema_version"] = "2.0.0"
    secs = spec["sections"]
    beziers = []
    for i, s in enumerate(secs):
        prev_z = secs[i - 1]["z"] if i else s["z"]
        next_z = secs[i + 1]["z"] if i + 1 < len(secs) else s["z"]
        span = (next_z - prev_z) / 3 or 0.0
        beziers.append({
            "anchor": [s["z"], s["half_width"], s["y_bottom"], s["y_top"]],
            "handle_in": [-span, 0.0],
            "handle_out": [span, 0.0],
        })
    spec["sections"] = beziers
    return spec


def versions() -> list[str]:
    vs = {CURRENT_VERSION}
    for a, b in STEPS:
        vs.add(a)
        vs.add(b)
    return sorted(vs)


def _find_path(frm: str, to: str) -> list[tuple[str, str]]:
    if frm == to:
        return []
    q = deque([(frm, [])])
    seen = {frm}
    while q:
        cur, path = q.popleft()
        for (a, b) in STEPS:
            if a != cur or b in seen:
                continue
            nxt = path + [(a, b)]
            if b == to:
                return nxt
            seen.add(b)
            q.append((b, nxt))
    raise NoMigrationPathError(
        f"tidak ada jalur migrasi {frm} -> {to}",
        hint=f"versi yang dikenal: {', '.join(versions())}",
    )


def migrate(spec: dict, to: str = CURRENT_VERSION) -> tuple[dict, list[str]]:
    frm = spec.get("schema_version", "1.0.0")
    if frm not in versions():
        raise NoMigrationPathError(
            f"schema_version {frm} tidak dikenal",
            hint=f"versi yang dikenal: {', '.join(versions())}",
        )
    path = _find_path(frm, to)
    out = spec
    applied = []
    for a, b in path:
        out = STEPS[(a, b)](out)
        applied.append(f"{a} -> {b}")
    return out, applied


def migrate_file(src, dst=None, to: str = CURRENT_VERSION, inplace: bool = False) -> list[str]:
    p = Path(src)
    spec = json.loads(p.read_text())
    out, applied = migrate(spec, to)
    target = p if inplace else Path(dst) if dst else p.with_name(p.stem + ".migrated.json")
    target.write_text(json.dumps(out, indent=2) + "\n")
    return applied
