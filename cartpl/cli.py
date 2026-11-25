"""CLI cartpl. Exit code: 0 ok, 1 validasi, 2 I/O, 3 conflict, 4 tidak
ditemukan, 5 internal."""
from __future__ import annotations

import argparse
import json
import sys
import traceback
from pathlib import Path

from . import __version__
from .analytics import analyze, format_report
from .builder import build_car
from .diff import diff_files, diff_specs, format_table
from .docgen import write_doc
from .errors import CartplError
from .estimate import estimate
from .loader import DEFAULT_ROOT, list_templates, load_raw, resolve
from .lock import verify_lock, write_lock
from .migrate import migrate as migrate_spec, migrate_file, versions
from .pack import export as export_pack, import_ as import_pack
from .preview import contact_sheet, render_preview
from .resolver import apply_presets
from .schema import CURRENT_VERSION, check_structure, validate_structure
from .snapshot import check_golden, mesh_hash, write_golden
from .validator import check_duplicate_names, validate_semantics, warnings_for
from .variants import apply_variant, list_variants, load_variant, vary, spec_hash

VARIANTS_DIR = Path(__file__).resolve().parent.parent / "variants"


def _err(code: str, message: str, path: str | None = None, hint: str | None = None) -> None:
    print(f"ERROR [{code}] {message}", file=sys.stderr)
    if path:
        print(f"  at: {path}", file=sys.stderr)
    if hint:
        print(f"  hint: {hint}", file=sys.stderr)


def _ok(message: str) -> None:
    print(f"OK: {message}")


def _full_spec(name: str, *, preset_lock: bool = False) -> tuple[dict, list[str]]:
    spec = resolve(name, DEFAULT_ROOT)
    spec, warns = apply_presets(spec, preset_lock=preset_lock)
    return spec, warns


def _validate_all(spec: dict, *, source: str = "templates", strict: bool = False) -> tuple[list, list]:
    # Kalau skema sudah gagal, validasi semantik tidak aman dijalankan: field
    # wajib bisa saja tidak ada, dan KeyError akan menyamar sebagai bug internal.
    errors = validate_structure(spec)
    if errors:
        # `warnings_for` membaca field wajib; jangan dipanggil saat skema rusak.
        return errors, []
    errors = errors + validate_semantics(spec, source=source)
    warns = warnings_for(spec)
    if strict:
        errors += warns
        warns = []
    return errors, warns


# ------------------------------------------------------------------ commands


def cmd_list(args) -> int:
    rows = []
    for name in list_templates(DEFAULT_ROOT):
        spec = resolve(name, DEFAULT_ROOT)
        dims = spec["dimensions"]
        total = dims["overhang_front"] + dims["wheelbase"] + dims["overhang_rear"]
        rows.append((name, spec["wing"]["type"], f"{total:.2f}",
                     f"{dims['body_width_max'] * 2:.2f}",
                     ", ".join(spec["meta"].get("tags", []))))
    if args.json:
        print(json.dumps([{"name": r[0], "wing": r[1], "length": r[2],
                           "width": r[3], "tags": r[4]} for r in rows], indent=2))
        return 0
    print(f"{'NAME':<22} {'WING':<11} {'LEN':<6} {'WIDTH':<6} TAG")
    for r in rows:
        print(f"{r[0]:<22} {r[1]:<11} {r[2]:<6} {r[3]:<6} {r[4]}")
    return 0


def cmd_show(args) -> int:
    spec, _ = _full_spec(args.name)
    print(json.dumps(spec, indent=2, default=str))
    return 0


def cmd_validate(args) -> int:
    target = Path(args.name)
    if target.exists() and target.suffix == ".json":
        try:
            spec = json.loads(target.read_text())
        except json.JSONDecodeError as exc:
            _err("IO", f"JSON tidak valid di {target.name}: {exc.msg}",
                 path=str(target), hint="perbaiki sintaks JSON")
            return 2
        source = "variants" if "variant_of" in spec else "templates"
    else:
        spec, _ = _full_spec(args.name)
        source = "templates"

    errors, warns = _validate_all(spec, source=source, strict=args.strict)
    if args.json:
        print(json.dumps({"ok": not errors, "errors": errors, "warnings": warns}, indent=2))
        return 0 if not errors else 1
    if errors:
        for e in errors:
            _err(e["code"], e["message"], e["path"])
        return 1
    _ok(f"{args.name} (no errors, {len(warns)} warning"
        + ("s" if len(warns) != 1 else "") + ")")
    for w in warns:
        print(f"  WARN [{w['code']}] {w['path']}: {w['message']}")
    return 0


def cmd_select(args) -> int:
    spec, warns = _full_spec(args.name)
    # Cek abstract SEBELUM validasi: template abstract memang tidak lengkap
    # (tidak punya `sections`), jadi memvalidasinya hanya menghasilkan
    # KeyError yang membingungkan.
    if spec["meta"].get("abstract"):
        _err("ABSTRACT", f"template {args.name} abstract, tidak bisa dipilih",
             hint="pakai template konkret; `list` hanya menampilkan yang konkret")
        return 1
    errors, _ = _validate_all(spec)
    if errors:
        for e in errors:
            _err(e["code"], e["message"], e["path"])
        return 1
    out = Path(args.out)
    if out.exists() and not args.force:
        _err("CONFLICT", f"{out} sudah ada", path=str(out), hint="pakai --force untuk menimpa")
        return 3
    out.write_text(json.dumps(spec, indent=2, default=str) + "\n")
    _ok(f'pakai template "{spec["meta"]["display_name"]}" -> {out}')
    for w in warns:
        print(f"  WARN: {w}")
    return 0


def cmd_render_preview(args) -> int:
    if args.all:
        specs = {}
        for name in list_templates(DEFAULT_ROOT):
            spec, _ = _full_spec(name)
            specs[name] = spec
        out = Path(args.out)
        out.mkdir(parents=True, exist_ok=True)
        for name, spec in specs.items():
            render_preview(spec, out / f"{name}.png", size=args.size)
        _ok(f"{len(specs)} preview -> {out}/")
        return 0

    spec, _ = _full_spec(args.name)
    cam = None
    if args.camera:
        parts = [float(x) for x in args.camera.split(",")]
        if len(parts) != 4:
            _err("ARGS", "--camera butuh 4 angka: azimuth,elevation,distance,fov")
            return 1
        cam = dict(zip(("azimuth_deg", "elevation_deg", "distance_m", "fov_deg"), parts))
    p = render_preview(spec, args.out, size=args.size, camera=cam)
    _ok(f"preview {args.name} -> {p}")
    return 0


def cmd_compare(args) -> int:
    if args.all:
        specs = {n: _full_spec(n)[0] for n in list_templates(DEFAULT_ROOT)}
    else:
        specs = {n: _full_spec(n)[0] for n in args.names}
    p = contact_sheet(specs, args.out, cols=args.cols, size=args.size)
    _ok(f"contact sheet {len(specs)} template -> {p}")
    return 0


def cmd_diff(args) -> int:
    try:
        a = resolve(args.a, DEFAULT_ROOT) if not Path(args.a).exists() else json.loads(Path(args.a).read_text())
        b = resolve(args.b, DEFAULT_ROOT) if not Path(args.b).exists() else json.loads(Path(args.b).read_text())
    except CartplError:
        raise
    entries = diff_specs(a, b)
    if args.only:
        pre = args.only
        entries = [e for e in entries if e["path"] == pre or e["path"].startswith(pre + ".") or e["path"].startswith(pre + "[")]
    if args.json:
        print(json.dumps(entries, indent=2, default=str))
    else:
        print(format_table(entries))
    return 1 if (args.exit_code and entries) else 0


def cmd_lock(args) -> int:
    target = Path(args.name)
    if not target.exists():
        spec, _ = _full_spec(args.name)
        target = Path(f"{args.name}.json")
        target.write_text(json.dumps(spec, indent=2, default=str) + "\n")
    digest = write_lock(target)
    _ok(f"sha256 {digest}")
    return 0


def cmd_verify_lock(args) -> int:
    target = Path(args.name)
    if not target.exists():
        target = Path(f"{args.name}.json")
    try:
        verify_lock(target)
    except CartplError:
        raise
    _ok(f"lock cocok: {target.name}")
    return 0


def cmd_migrate(args) -> int:
    if args.list:
        print("versi dikenal:", ", ".join(versions()))
        print(f"target default: {CURRENT_VERSION}")
        return 0
    applied = migrate_file(args.file, args.out, to=args.to or CURRENT_VERSION,
                           inplace=args.inplace)
    _ok("migrasi: " + (" -> ".join(a.split(" -> ")[1] for a in applied) if applied else "tidak perlu"))
    return 0


def cmd_export(args) -> int:
    manifest = export_pack(args.names, args.out)
    _ok(f"exported {len(manifest['templates'])} template + {len(manifest['variants'])} variant "
        f"-> {args.out} ({Path(args.out).stat().st_size / 1024:.1f} KB)")
    return 0


def cmd_import(args) -> int:
    res = import_pack(args.pack, args.dest, force=args.force,
                      variants_dest=Path(args.variants_dest))
    _ok(f"imported {res['moved']} file ({res['conflicts']} conflict)")
    return 0


def cmd_estimate(args) -> int:
    spec, _ = _full_spec(args.name)
    est = estimate(spec)
    if args.json:
        print(json.dumps(est, indent=2))
        return 0
    print(f"TEMPLATE {est['template']}")
    print(f"{'MAX_DIST':>9} {'SECT':>5} {'RING':>5} {'SPOKE':>6} {'QUADS':>7} {'VERTS':>7}")
    for l in est["lods"]:
        print(f"{l['max_distance_m']:>9} {l['n_sections']:>5} {l['n_ring']:>5} "
              f"{l['spokes']:>6} {l['n_quads']:>7} {l['n_verts']:>7}")
    print(f"perkiraan render per frame: {est['single_frame_render_estimate_s']} s")
    return 0


def cmd_docgen(args) -> int:
    names = list_templates(DEFAULT_ROOT) if args.all else [args.name]
    if args.all:
        outdir = Path(args.out)
        outdir.mkdir(parents=True, exist_ok=True)
        parts = ["# Tutorial Template Mobil", ""]
        for n in names:
            spec, _ = _full_spec(n)
            pv = f"previews/{n}.png"
            p = write_doc(spec, outdir / f"{n}.md", preview_path=pv)
            parts.append(p.read_text())
            parts.append("\n---\n")
        (outdir / "TUTORIAL.md").write_text("\n".join(parts))
        _ok(f"{len(names)} dokumen + TUTORIAL.md -> {outdir}/")
        return 0
    spec, _ = _full_spec(args.name)
    p = write_doc(spec, args.out, preview_path=args.embed_preview)
    _ok(f"doc {args.name} -> {p}")
    return 0


def cmd_analytics(args) -> int:
    res = analyze()
    if args.json:
        print(json.dumps(res, indent=2))
        return 0
    print(format_report(res))
    return 0


def cmd_variant(args) -> int:
    if args.action == "list":
        names = list_variants(args.base)
        if not names:
            _ok(f"tidak ada variant untuk {args.base}")
            return 0
        for n in names:
            print(n)
        return 0
    if args.action == "apply":
        base, _ = _full_spec(args.base)
        variant = load_variant(args.base, args.variant)
        out = apply_variant(base, variant)
        p = Path(args.out)
        p.write_text(json.dumps(out, indent=2, default=str) + "\n")
        _ok(f"variant {args.variant} -> {p}")
        return 0
    _err("ARGS", "action harus list atau apply")
    return 1


def cmd_vary(args) -> int:
    base, _ = _full_spec(args.base)
    outdir = Path(args.out)
    outdir.mkdir(parents=True, exist_ok=True)
    specs = vary(base, args.count, args.seed)
    for s in specs:
        (outdir / f"{s['meta']['name']}.json").write_text(json.dumps(s, indent=2, default=str) + "\n")
    _ok(f"{len(specs)} variasi (seed {args.seed}) -> {outdir}/")
    return 0


def cmd_snapshot(args) -> int:
    names = list_templates(DEFAULT_ROOT) if args.all else [args.name]
    if args.update:
        for n in names:
            spec, _ = _full_spec(n)
            h = write_golden(n, spec)
            print(f"{n}: {h[:16]}...")
        _ok(f"{len(names)} golden hash diperbarui")
        return 0
    bad = 0
    for n in names:
        spec, _ = _full_spec(n)
        ok, got, want = check_golden(n, spec)
        if not want:
            print(f"{n}: (belum ada golden) {got[:16]}...")
            continue
        if ok:
            print(f"{n}: OK")
        else:
            print(f"{n}: BEDA golden={want[:16]}... mesh={got[:16]}...")
            bad += 1
    return 1 if bad else 0


def cmd_physics(args) -> int:
    from .physics import derive_physics

    spec, _ = _full_spec(args.name)
    print(json.dumps(derive_physics(spec), indent=2))
    return 0


# --------------------------------------------------------------------- build


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(prog="cartpl", description="Car Template System")
    p.add_argument("--version", action="version", version=f"cartpl {__version__}")
    sub = p.add_subparsers(dest="cmd", required=True)

    s = sub.add_parser("list", help="daftar template")
    s.add_argument("--json", action="store_true")
    s.set_defaults(func=cmd_list)

    s = sub.add_parser("show", help="cetak spec final")
    s.add_argument("name")
    s.set_defaults(func=cmd_show)

    s = sub.add_parser("validate", help="validasi schema + semantik")
    s.add_argument("name")
    s.add_argument("--json", action="store_true")
    s.add_argument("--strict", action="store_true")
    s.set_defaults(func=cmd_validate)

    s = sub.add_parser("select", help="pilih template -> car_selected.json")
    s.add_argument("name")
    s.add_argument("-o", "--out", default="car_selected.json")
    s.add_argument("--force", action="store_true")
    s.set_defaults(func=cmd_select)

    s = sub.add_parser("render-preview", help="render PNG pratinjau")
    s.add_argument("name", nargs="?")
    s.add_argument("-o", "--out", default="preview.png")
    s.add_argument("--size", type=int, default=512)
    s.add_argument("--camera", help="azimuth,elevation,distance,fov")
    s.add_argument("--all", action="store_true")
    s.set_defaults(func=cmd_render_preview)

    s = sub.add_parser("compare", help="contact sheet beberapa template")
    s.add_argument("names", nargs="*")
    s.add_argument("-o", "--out", default="compare.png")
    s.add_argument("--cols", type=int, default=3)
    s.add_argument("--size", type=int, default=384)
    s.add_argument("--all", action="store_true")
    s.set_defaults(func=cmd_compare)

    s = sub.add_parser("diff", help="bandingkan dua template")
    s.add_argument("a")
    s.add_argument("b")
    s.add_argument("--json", action="store_true")
    s.add_argument("--only")
    s.add_argument("--exit-code", action="store_true")
    s.set_defaults(func=cmd_diff)

    s = sub.add_parser("lock", help="tulis hash template")
    s.add_argument("name")
    s.set_defaults(func=cmd_lock)

    s = sub.add_parser("verify-lock", help="cek hash template")
    s.add_argument("name")
    s.set_defaults(func=cmd_verify_lock)

    s = sub.add_parser("migrate", help="naikkan versi schema")
    s.add_argument("file")
    s.add_argument("-o", "--out")
    s.add_argument("--to", default=None)
    s.add_argument("--inplace", action="store_true")
    s.add_argument("--list", action="store_true")
    s.set_defaults(func=cmd_migrate)

    s = sub.add_parser("export", help="bundle template ke zip")
    s.add_argument("names", nargs="+")
    s.add_argument("-o", "--out", default="pack.zip")
    s.set_defaults(func=cmd_export)

    s = sub.add_parser("import", help="pasang bundle zip")
    s.add_argument("pack")
    s.add_argument("--dest", default=str(DEFAULT_ROOT))
    s.add_argument("--variants-dest", default=str(VARIANTS_DIR))
    s.add_argument("--force", action="store_true")
    s.set_defaults(func=cmd_import)

    s = sub.add_parser("estimate", help="prediksi vertex/quad")
    s.add_argument("name")
    s.add_argument("--json", action="store_true")
    s.set_defaults(func=cmd_estimate)

    s = sub.add_parser("docgen", help="generate Markdown")
    s.add_argument("name", nargs="?")
    s.add_argument("-o", "--out", default="docs")
    s.add_argument("--embed-preview")
    s.add_argument("--all", action="store_true")
    s.set_defaults(func=cmd_docgen)

    s = sub.add_parser("analytics", help="laporan field dipakai/tidak")
    s.add_argument("--json", action="store_true")
    s.set_defaults(func=cmd_analytics)

    s = sub.add_parser("variant", help="kelola variant")
    s.add_argument("action", choices=["list", "apply"])
    s.add_argument("base")
    s.add_argument("variant", nargs="?")
    s.add_argument("-o", "--out", default="variant.json")
    s.set_defaults(func=cmd_variant)

    s = sub.add_parser("vary", help="variasi prosedural dari seed")
    s.add_argument("base")
    s.add_argument("--count", type=int, default=5)
    s.add_argument("--seed", type=int, default=42)
    s.add_argument("-o", "--out", default="variations")
    s.set_defaults(func=cmd_vary)

    s = sub.add_parser("snapshot", help="snapshot hash mesh")
    s.add_argument("name", nargs="?")
    s.add_argument("--all", action="store_true")
    s.add_argument("--update", action="store_true")
    s.set_defaults(func=cmd_snapshot)

    s = sub.add_parser("physics", help="parameter fisika turunan")
    s.add_argument("name")
    s.set_defaults(func=cmd_physics)

    return p


def main(argv=None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    try:
        return args.func(args)
    except CartplError as exc:
        _err(f"{type(exc).__name__}", exc.message, exc.path, exc.hint)
        return exc.code
    except FileNotFoundError as exc:
        _err("IO", str(exc), hint="cek path berkas")
        return 2
    except Exception as exc:  # bug: traceback penuh
        traceback.print_exc()
        _err("INTERNAL", str(exc), hint="ini bug cartpl; laporkan dengan traceback di atas")
        return 5
