"""Bandingkan dua spec final, hasilkan daftar perbedaan berpath (C.9)."""
from __future__ import annotations

import json


def _flatten(obj, prefix="") -> dict:
    out = {}
    if isinstance(obj, dict):
        for k, v in obj.items():
            if k.startswith("_"):
                continue
            out.update(_flatten(v, f"{prefix}.{k}" if prefix else k))
    elif isinstance(obj, list):
        for i, v in enumerate(obj):
            out.update(_flatten(v, f"{prefix}[{i}]"))
    else:
        out[prefix] = obj
    return out


def diff_specs(a: dict, b: dict) -> list[dict]:
    fa, fb = _flatten(a), _flatten(b)
    # Dict kosong tidak menghasilkan leaf, jadi field yang hilang seluruhnya
    # (mis. `livery`) tak akan terdeteksi. Catat container-nya sendiri.
    for src, flat in ((a, fa), (b, fb)):
        for key, val in src.items():
            if key.startswith("_"):
                continue
            if isinstance(val, dict) and not val:
                flat.setdefault(key, {})
    entries = []
    for path in sorted(set(fa) | set(fb)):
        if path not in fa:
            entries.append({"path": path, "kind": "added", "a": None, "b": fb[path]})
        elif path not in fb:
            entries.append({"path": path, "kind": "removed", "a": fa[path], "b": None})
        elif fa[path] != fb[path]:
            entries.append({"path": path, "kind": "changed", "a": fa[path], "b": fb[path]})
    return entries


def diff_files(a_path, b_path, only: str | None = None) -> list[dict]:
    a = json.loads(open(a_path).read())
    b = json.loads(open(b_path).read())
    entries = diff_specs(a, b)
    if only:
        entries = [e for e in entries if e["path"] == only or e["path"].startswith(f"{only}.") or e["path"].startswith(f"{only}[")]
    return entries


def format_table(entries: list[dict], width: int = 32) -> str:
    if not entries:
        return "tidak ada perbedaan"
    lines = [f"{'PATH':<{width}} {'OLD':<12} NEW"]
    for e in entries:
        old = "-" if e["kind"] == "removed" else _short(e["a"])
        new = "-" if e["kind"] == "added" else _short(e["b"])
        if e["kind"] == "added":
            old = "(baru)"
        elif e["kind"] == "removed":
            new = "(dihapus)"
        lines.append(f"{e['path']:<{width}} {old:<12} {new}")
    return "\n".join(lines)


def _short(v) -> str:
    s = json.dumps(v) if not isinstance(v, str) else v
    return s if len(s) <= 28 else s[:25] + "..."
