"""Export/import pack zip (C.12). Termasuk proteksi zip slip."""
from __future__ import annotations

import json
import shutil
import tempfile
import zipfile
from datetime import datetime, timezone
from pathlib import Path

from .errors import ImportConflictError, PackNotFoundError
from .loader import DEFAULT_ROOT, load_raw
from .schema import CURRENT_VERSION

VARIANTS_DIR = Path(__file__).resolve().parent.parent / "variants"


def _extends_chain(name: str, root: Path) -> list[str]:
    """Rantai extends dari leaf ke akar.

    Template yang tidak ada TIDAK boleh ditelan diam-diam: tanpa ini,
    `export` akan menulis zip kosong atau gagal dengan FileNotFoundError
    (exit 2) padahal masalahnya template tidak ditemukan (exit 4).
    """
    out, cur = [], name
    while cur:
        out.append(cur)
        meta = load_raw(cur, root).get("meta", {})
        cur = meta.get("extends")
    return out


def export(names: list[str], out_zip, root: Path = DEFAULT_ROOT,
           variants_dir: Path = VARIANTS_DIR) -> dict:
    out_zip = Path(out_zip)
    templates, variants = set(), set()
    for n in names:
        templates.update(_extends_chain(n, root))
        if variants_dir.exists():
            variants.update(p.stem for p in variants_dir.glob(f"{n}.*.json"))

    manifest = {
        "name": out_zip.stem,
        "version": "1",
        "created": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "schema_version": CURRENT_VERSION,
        "templates": sorted(templates),
        "variants": sorted(variants),
    }
    out_zip.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(out_zip, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("pack/manifest.json", json.dumps(manifest, indent=2))
        for t in sorted(templates):
            z.write(root / f"{t}.json", f"pack/templates/{t}.json")
        for v in sorted(variants):
            z.write(variants_dir / f"{v}.json", f"pack/variants/{v}.json")
    return manifest


def _safe_members(z: zipfile.ZipFile) -> list[str]:
    bad = []
    for info in z.infolist():
        name = info.filename
        if name.startswith("/") or ".." in Path(name).parts or ":" in name.split("/")[0]:
            bad.append(name)
    return bad


def import_(zip_path, dest, force: bool = False,
            variants_dest: Path | None = None) -> dict:
    zp = Path(zip_path)
    if not zp.exists():
        raise PackNotFoundError(f"pack tidak ditemukan: {zp}", path=str(zp))
    dest = Path(dest)
    variants_dest = variants_dest or VARIANTS_DIR

    with zipfile.ZipFile(zp) as z:
        bad = _safe_members(z)
        if bad:
            raise ImportConflictError(f"entry tidak aman di pack: {bad[0]}",
                                      hint="pack berisi path absolut atau '..'")
        manifest = json.loads(z.read("pack/manifest.json"))

        conflicts = []
        for name in manifest["templates"]:
            if (dest / f"{name}.json").exists():
                conflicts.append(f"templates/{name}.json")
        for name in manifest["variants"]:
            if (variants_dest / f"{name}.json").exists():
                conflicts.append(f"variants/{name}.json")
        if conflicts and not force:
            raise ImportConflictError(
                f"{len(conflicts)} file sudah ada: {conflicts[0]}",
                hint="pakai --force untuk menimpa",
            )

        # extract ke tmp dulu, validasi, baru pindahkan
        with tempfile.TemporaryDirectory() as tmp:
            tmpd = Path(tmp)
            z.extractall(tmpd)
            dest.mkdir(parents=True, exist_ok=True)
            variants_dest.mkdir(parents=True, exist_ok=True)
            moved = 0
            for t in manifest["templates"]:
                src = tmpd / "pack" / "templates" / f"{t}.json"
                if src.exists():
                    shutil.copy2(src, dest / f"{t}.json")
                    moved += 1
            for v in manifest["variants"]:
                src = tmpd / "pack" / "variants" / f"{v}.json"
                if src.exists():
                    shutil.copy2(src, variants_dest / f"{v}.json")
                    moved += 1
    return {"manifest": manifest, "moved": moved, "conflicts": len(conflicts)}
