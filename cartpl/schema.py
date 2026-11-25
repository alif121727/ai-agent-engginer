"""Lapis 1: validasi struktural terhadap JSON Schema v1."""
from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path

import jsonschema

from .errors import SchemaValidationError

CURRENT_VERSION = "1.0.0"

REPO_ROOT = Path(__file__).resolve().parent.parent
SCHEMA_DIR = REPO_ROOT / "templates" / "schema"


def schema_path(version: str = CURRENT_VERSION) -> Path:
    major = version.split(".")[0]
    return SCHEMA_DIR / f"v{major}.json"


@lru_cache(maxsize=8)
def load_schema(version: str = CURRENT_VERSION) -> dict:
    path = schema_path(version)
    if not path.exists():
        raise SchemaValidationError(f"schema v{version} tidak ada", path=str(path))
    return json.loads(path.read_text())


def _fmt_path(err: jsonschema.ValidationError) -> str:
    """Ubah `deque` path jsonschema jadi dot/bracket notation yang bisa dicari."""
    out = ""
    for part in err.absolute_path:
        out += f"[{part}]" if isinstance(part, int) else (f".{part}" if out else str(part))
    return out or "<root>"


def validate_structure(spec: dict, version: str | None = None) -> list[dict]:
    """Kembalikan daftar error; kosong berarti lolos."""
    ver = version or spec.get("schema_version", CURRENT_VERSION)
    schema = load_schema(ver)
    validator = jsonschema.Draft202012Validator(schema)
    errors = []
    for err in sorted(validator.iter_errors(spec), key=lambda e: list(e.absolute_path)):
        errors.append({
            "code": "SCHEMA",
            "path": _fmt_path(err),
            "message": err.message,
        })
    return errors


def check_structure(spec: dict, version: str | None = None) -> None:
    errors = validate_structure(spec, version)
    if errors:
        first = errors[0]
        raise SchemaValidationError(
            f"{first['path']}: {first['message']}",
            path=first["path"],
            hint=f"{len(errors)} error skema; jalankan `validate --json` untuk daftar penuh",
        )
