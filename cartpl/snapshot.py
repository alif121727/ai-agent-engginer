"""Snapshot hash mesh untuk mendeteksi perubahan geometri tak sengaja (C.10)."""
from __future__ import annotations

import hashlib
from pathlib import Path

from .builder import build_car

GOLDEN_DIR = Path(__file__).resolve().parent.parent / "tests" / "data" / "golden"


def mesh_hash(spec: dict) -> str:
    return hashlib.sha256(build_car(spec).to_bytes()).hexdigest()


def golden_path(name: str) -> Path:
    return GOLDEN_DIR / f"{name}.hash"


def write_golden(name: str, spec: dict) -> str:
    GOLDEN_DIR.mkdir(parents=True, exist_ok=True)
    h = mesh_hash(spec)
    golden_path(name).write_text(h + "\n")
    return h


def check_golden(name: str, spec: dict) -> tuple[bool, str, str]:
    p = golden_path(name)
    got = mesh_hash(spec)
    if not p.exists():
        return False, got, ""
    return p.read_text().strip() == got, got, p.read_text().strip()
