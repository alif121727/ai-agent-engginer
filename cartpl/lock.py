"""Freeze template dengan hash SHA256 (C.10)."""
from __future__ import annotations

import hashlib
import json
from pathlib import Path

from .errors import LockMismatchError


def spec_digest(spec: dict) -> str:
    payload = {k: v for k, v in spec.items() if k != "meta"}
    payload["meta"] = {k: v for k, v in spec.get("meta", {}).items() if not k.startswith("_")}
    return hashlib.sha256(json.dumps(payload, sort_keys=True).encode()).hexdigest()


def lock_path(spec_path) -> Path:
    p = Path(spec_path)
    return p.with_suffix(p.suffix + ".lock")


def write_lock(spec_path) -> str:
    spec = json.loads(Path(spec_path).read_text())
    digest = spec_digest(spec)
    lock_path(spec_path).write_text(digest + "\n")
    return digest


def verify_lock(spec_path) -> bool:
    lp = lock_path(spec_path)
    if not lp.exists():
        raise LockMismatchError(f"lock tidak ada: {lp.name}", path=str(lp),
                                hint="jalankan `lock` dulu")
    want = lp.read_text().strip()
    got = spec_digest(json.loads(Path(spec_path).read_text()))
    if want != got:
        raise LockMismatchError(
            f"hash tidak cocok untuk {Path(spec_path).name}",
            path=str(spec_path),
            hint=f"lock={want[:12]}... spec={got[:12]}...; template berubah setelah di-lock",
        )
    return True
