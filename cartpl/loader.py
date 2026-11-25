"""Pembacaan template, resolusi `extends`, dan deep merge.

Aturan merge (Lampiran C.1):
- object  : digabung rekursif
- array   : diganti total (bukan digabung)
- scalar  : diganti
- `meta.name` / `meta.extends` selalu milik leaf
"""
from __future__ import annotations

import copy
import json
from pathlib import Path

from .errors import IOErrorCartpl, TemplateCycleError, TemplateNotFoundError

REPO_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_ROOT = REPO_ROOT / "templates" / "cars"
MAX_DEPTH = 3


def _read_json(path: Path) -> dict:
    if not path.exists():
        raise TemplateNotFoundError(f"template tidak ditemukan: {path.name}", path=str(path))
    try:
        return json.loads(path.read_text())
    except json.JSONDecodeError as exc:
        raise IOErrorCartpl(f"JSON tidak valid di {path.name}: {exc.msg}", path=str(path)) from exc


def load_raw(name_or_path: str | Path, root: Path = DEFAULT_ROOT) -> dict:
    """Baca satu file template tanpa resolve inheritance."""
    p = Path(name_or_path)
    if not p.exists():
        p = root / (f"{name_or_path}.json" if not str(name_or_path).endswith(".json") else str(name_or_path))
    return _read_json(p)


def _merge(a, b):
    if isinstance(a, dict) and isinstance(b, dict):
        out = dict(a)
        for k, v in b.items():
            out[k] = _merge(a[k], v) if k in a else copy.deepcopy(v)
        return out
    # array / scalar: b menang
    return copy.deepcopy(b)


def _resolve_chain(raw: dict, root: Path) -> list[dict]:
    """DFS ke atas lewat `extends`; hasil urut base -> leaf."""
    chain: list[dict] = [raw]
    seen = [raw.get("meta", {}).get("name", "<anon>")]
    cur = raw
    while True:
        parent = cur.get("meta", {}).get("extends")
        if not parent:
            break
        if parent in seen:
            raise TemplateCycleError(
                f"extends cycle: {' -> '.join(seen + [parent])}",
                hint="hapus salah satu `extends` di rantai itu",
            )
        if len(chain) >= MAX_DEPTH:
            raise TemplateCycleError(
                f"extends terlalu dalam (>{MAX_DEPTH}): {' -> '.join(seen)}",
                hint="ratakan hierarki; maksimal base -> mid -> leaf",
            )
        seen.append(parent)
        nxt = load_raw(parent, root)
        chain.append(nxt)
        cur = nxt
    chain.reverse()
    return chain


def resolve(name_or_path: str | Path, root: Path = DEFAULT_ROOT) -> dict:
    """Template final: inheritance sudah diterapkan."""
    raw = load_raw(name_or_path, root)
    chain = _resolve_chain(raw, root)
    merged: dict = {}
    for spec in chain:
        merged = _merge(merged, spec)

    # Meta milik leaf, kecuali `abstract`/`tags` yang boleh diwarisi.
    leaf_meta = raw.get("meta", {})
    base_meta = chain[0].get("meta", {})
    # `abstract` tidak boleh diwarisi: hanya leaf yang menentukan apakah ia
    # konkret. Tanpa ini semua anak `_base` (abstract: true) ikut abstract.
    merged["meta"] = {
        **{k: v for k, v in base_meta.items()
           if k not in {"name", "extends", "abstract"}},
        **{k: v for k, v in leaf_meta.items() if k not in {"extends"}},
    }
    merged["meta"]["_resolved_chain"] = [m["meta"]["name"] for m in chain]
    if "extends" in leaf_meta:
        merged["meta"]["extends"] = leaf_meta["extends"]
    merged["meta"].setdefault("abstract", False)
    return merged


def list_templates(root: Path = DEFAULT_ROOT, include_abstract: bool = False) -> list[str]:
    if not root.exists():
        return []
    names = []
    for p in sorted(root.glob("*.json")):
        try:
            meta = json.loads(p.read_text()).get("meta", {})
        except json.JSONDecodeError:
            continue
        if meta.get("abstract") and not include_abstract:
            continue
        names.append(p.stem)
    return names


def list_abstract(root: Path = DEFAULT_ROOT) -> list[str]:
    return [n for n in list_templates(root, include_abstract=True) if n not in list_templates(root)]
