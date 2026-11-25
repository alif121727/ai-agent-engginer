"""Variant, diff, lock, migrate, pack, snapshot, docgen, dan CLI."""
from __future__ import annotations

import copy
import json
import zipfile

import pytest

from cartpl import loader
from cartpl.cli import main
from cartpl.diff import diff_specs, format_table
from cartpl.docgen import generate_doc, write_doc
from cartpl.errors import (ImportConflictError, LockMismatchError,
                           NoMigrationPathError, VariantForbiddenOverrideError,
                           VariantNotFoundError)
from cartpl.lock import lock_path, spec_digest, verify_lock, write_lock
from cartpl.migrate import migrate, versions
from cartpl.pack import export, import_
from cartpl.snapshot import check_golden, mesh_hash, write_golden
from cartpl.variants import (ALLOWED_FIELDS, apply_variant, list_variants,
                             load_variant, spec_hash, vary)

BASE = "mid-engine-supercar"


# ---------------------------------------------------------------- variants


def test_list_variants():
    names = list_variants(BASE)
    assert len(names) == 2
    assert any("matte-black" in n for n in names)


def test_apply_variant_changes_color(base_spec):
    v = load_variant(BASE, "mid-engine-supercar.matte-black")
    out = apply_variant(base_spec, v)
    assert out["colors"]["body_base"] != base_spec["colors"]["body_base"]
    assert out["variant_of"] == BASE


def test_apply_variant_keeps_geometry(base_spec):
    v = load_variant(BASE, "mid-engine-supercar.matte-black")
    out = apply_variant(base_spec, v)
    assert out["sections"] == base_spec["sections"]
    assert out["geometry"] == base_spec["geometry"]
    assert out["dimensions"] == base_spec["dimensions"]


def test_variant_forbidden_geometry_override(base_spec):
    bad = {"variant_of": BASE, "meta": {"name": "x"},
           "dimensions": {"wheelbase": 3.0}}
    with pytest.raises(VariantForbiddenOverrideError, match="dimensions"):
        apply_variant(base_spec, bad)


def test_variant_forbidden_nested_field(base_spec):
    bad = {"variant_of": BASE, "meta": {"name": "x"},
           "wheels": {"rim_diameter_m": 0.60}}
    with pytest.raises(VariantForbiddenOverrideError):
        apply_variant(base_spec, bad)


def test_variant_allows_nested_allowed_field(base_spec):
    ok = {"variant_of": BASE, "meta": {"name": "x"},
          "wheels": {"brake_caliper_color": [255, 0, 0]}}
    out = apply_variant(base_spec, ok)
    assert out["wheels"]["brake_caliper_color"] == [255, 0, 0]


def test_variant_forbidden_meta_field(base_spec):
    bad = {"variant_of": BASE, "meta": {"name": "x", "extends": "_base"}}
    with pytest.raises(VariantForbiddenOverrideError):
        apply_variant(base_spec, bad)


def test_missing_variant_raises():
    with pytest.raises(VariantNotFoundError):
        load_variant(BASE, "tidak-ada-variant")


def test_variant_result_still_valid(base_spec):
    from cartpl.validator import validate_semantics

    v = load_variant(BASE, "mid-engine-supercar.candy-red")
    out = apply_variant(base_spec, v)
    # Spec variant memang ber-`variant_of`, jadi divalidasi sebagai variant:
    # E013 hanya berlaku untuk berkas di templates/cars/.
    assert validate_semantics(out, source="variants") == []


def test_vary_is_deterministic(base_spec):
    a = vary(base_spec, 3, seed=7)
    b = vary(base_spec, 3, seed=7)
    assert [s["meta"]["name"] for s in a] == [s["meta"]["name"] for s in b]
    assert [s["colors"]["body_base"] for s in a] == [s["colors"]["body_base"] for s in b]


def test_vary_different_seed_differs(base_spec):
    a = vary(base_spec, 3, seed=1)
    b = vary(base_spec, 3, seed=2)
    assert a[0]["colors"]["body_base"] != b[0]["colors"]["body_base"]


def test_vary_produces_valid_specs(base_spec):
    from cartpl.validator import validate_semantics

    for s in vary(base_spec, 4, seed=99):
        codes = [e["code"] for e in validate_semantics(s, source="variants")]
        assert codes == [], f"{s['meta']['name']}: {codes}"


def test_vary_compatible_wing(base_spec):
    for s in vary(base_spec, 6, seed=3):
        assert s["wing"]["type"] in ("high-fixed", "active")


def test_vary_count(base_spec):
    assert len(vary(base_spec, 9, seed=0)) == 9


def test_spec_hash_stable(base_spec):
    assert spec_hash(base_spec) == spec_hash(copy.deepcopy(base_spec))


def test_spec_hash_changes(base_spec):
    other = copy.deepcopy(base_spec)
    other["colors"]["body_base"] = [0.0, 0.0, 0.0]
    assert spec_hash(base_spec) != spec_hash(other)


# -------------------------------------------------------------------- diff


def test_diff_identical_is_empty(base_spec):
    assert diff_specs(base_spec, base_spec) == []


def test_diff_detects_change(base_spec):
    other = copy.deepcopy(base_spec)
    other["wing"]["type"] = "none"
    entries = diff_specs(base_spec, other)
    paths = [e["path"] for e in entries]
    assert "wing.type" in paths


def test_diff_kinds(base_spec):
    other = copy.deepcopy(base_spec)
    other["livery"] = {"style": "stripes", "stripe_width_m": 0.1}
    other["physics"]["mass_kg"] = 999
    kinds = {e["kind"] for e in diff_specs(base_spec, other)}
    assert kinds == {"added", "changed"}


def test_diff_detects_removed_container(base_spec):
    """Field yang dihapus seluruhnya harus muncul sebagai `removed`."""
    with_livery = copy.deepcopy(base_spec)
    with_livery["livery"] = {"style": "stripes", "stripe_width_m": 0.1}
    entries = diff_specs(with_livery, base_spec)
    removed = [e for e in entries if e["kind"] == "removed"]
    assert removed, "penghapusan container tidak terdeteksi"


def test_diff_table_renders(base_spec):
    other = copy.deepcopy(base_spec)
    other["wing"]["type"] = "none"
    out = format_table(diff_specs(base_spec, other))
    assert "wing.type" in out


def test_diff_empty_table_message(base_spec):
    assert "tidak ada perbedaan" in format_table([])


# -------------------------------------------------------------------- lock


def test_lock_roundtrip(tmp_path):
    spec = loader.resolve(BASE)
    p = tmp_path / "x.json"
    p.write_text(json.dumps(spec))
    write_lock(p)
    assert verify_lock(p) is True


def test_lock_detects_change(tmp_path):
    spec = loader.resolve(BASE)
    p = tmp_path / "x.json"
    p.write_text(json.dumps(spec))
    write_lock(p)
    spec["wing"]["type"] = "none"
    p.write_text(json.dumps(spec))
    with pytest.raises(LockMismatchError):
        verify_lock(p)


def test_verify_without_lock_raises(tmp_path):
    p = tmp_path / "y.json"
    p.write_text(json.dumps(loader.resolve(BASE)))
    with pytest.raises(LockMismatchError, match="lock tidak ada"):
        verify_lock(p)


def test_digest_ignores_internal_meta(base_spec):
    a = copy.deepcopy(base_spec)
    b = copy.deepcopy(base_spec)
    a["meta"]["_resolved_chain"] = ["x"]
    b["meta"]["_resolved_chain"] = ["y", "z"]
    assert spec_digest(a) == spec_digest(b)


def test_lock_file_name(tmp_path):
    assert lock_path(tmp_path / "a.json").name == "a.json.lock"


# ----------------------------------------------------------------- migrate


def test_versions_listed():
    assert "1.0.0" in versions()
    assert "2.0.0" in versions()


def test_migrate_1_0_to_1_1_adds_lods():
    spec = loader.resolve(BASE)
    spec.pop("lods", None)
    out, applied = migrate(spec, to="1.1.0")
    assert out["schema_version"] == "1.1.0"
    assert "lods" in out
    assert applied == ["1.0.0 -> 1.1.0"]


def test_migrate_to_2_0_converts_sections():
    spec = loader.resolve(BASE)
    out, applied = migrate(spec, to="2.0.0")
    assert out["schema_version"] == "2.0.0"
    assert isinstance(out["sections"][0], dict)
    assert "anchor" in out["sections"][0]
    assert len(applied) == 2


def test_migrate_preserves_anchor_points():
    """Konversi ke bezier harus mempertahankan posisi anchor."""
    spec = loader.resolve(BASE)
    out, _ = migrate(spec, to="2.0.0")
    for old, new in zip(spec["sections"], out["sections"]):
        assert new["anchor"] == [old["z"], old["half_width"], old["y_bottom"], old["y_top"]]


def test_migrate_same_version_noop():
    spec = loader.resolve(BASE)
    out, applied = migrate(spec, to="1.0.0")
    assert applied == []
    assert out["schema_version"] == "1.0.0"


def test_migrate_unknown_target_raises():
    spec = loader.resolve(BASE)
    with pytest.raises(NoMigrationPathError):
        migrate(spec, to="9.9.9")


def test_migrate_unknown_source_raises():
    spec = loader.resolve(BASE)
    spec["schema_version"] = "0.0.1"
    with pytest.raises(NoMigrationPathError, match="tidak dikenal"):
        migrate(spec, to="1.0.0")


# -------------------------------------------------------------------- pack


def test_export_creates_zip(tmp_path):
    out = tmp_path / "p.zip"
    manifest = export([BASE], out)
    assert out.exists()
    assert "_base" in manifest["templates"]
    assert BASE in manifest["templates"]
    with zipfile.ZipFile(out) as z:
        assert "pack/manifest.json" in z.namelist()


def test_export_includes_variants(tmp_path):
    out = tmp_path / "p.zip"
    manifest = export([BASE], out)
    assert len(manifest["variants"]) == 2


def test_export_pulls_in_parent(tmp_path):
    out = tmp_path / "p.zip"
    manifest = export(["rally-hatch"], out)
    assert "_base" in manifest["templates"]


def test_import_roundtrip(tmp_path):
    z = tmp_path / "p.zip"
    export([BASE], z)
    dest = tmp_path / "cars"
    vdest = tmp_path / "vars"
    res = import_(z, dest, variants_dest=vdest)
    assert (dest / f"{BASE}.json").exists()
    assert (dest / "_base.json").exists()
    assert res["moved"] == res["manifest"]["templates"].__len__() + res["manifest"]["variants"].__len__()


def test_import_conflict_without_force(tmp_path):
    z = tmp_path / "p.zip"
    export([BASE], z)
    dest = tmp_path / "cars"
    vdest = tmp_path / "vars"
    import_(z, dest, variants_dest=vdest)
    with pytest.raises(ImportConflictError, match="sudah ada"):
        import_(z, dest, variants_dest=vdest)


def test_import_force_overwrites(tmp_path):
    z = tmp_path / "p.zip"
    export([BASE], z)
    dest = tmp_path / "cars"
    vdest = tmp_path / "vars"
    import_(z, dest, variants_dest=vdest)
    res = import_(z, dest, force=True, variants_dest=vdest)
    assert res["moved"] > 0


def test_import_rejects_zip_slip(tmp_path):
    z = tmp_path / "evil.zip"
    with zipfile.ZipFile(z, "w") as f:
        f.writestr("pack/manifest.json", json.dumps(
            {"templates": ["a"], "variants": []}))
        f.writestr("../../etc/passwd", "x")
    with pytest.raises(ImportConflictError, match="tidak aman"):
        import_(z, tmp_path / "dest", variants_dest=tmp_path / "v")


def test_import_missing_pack(tmp_path):
    from cartpl.errors import PackNotFoundError

    with pytest.raises(PackNotFoundError):
        import_(tmp_path / "nope.zip", tmp_path / "d", variants_dest=tmp_path / "v")


# ---------------------------------------------------------------- snapshot


def test_mesh_hash_stable(base_spec):
    assert mesh_hash(base_spec) == mesh_hash(copy.deepcopy(base_spec))


def test_mesh_hash_sensitive_to_geometry(base_spec):
    other = copy.deepcopy(base_spec)
    other["sections"][3]["half_width"] += 0.01
    assert mesh_hash(base_spec) != mesh_hash(other)


def test_golden_roundtrip(base_spec):
    name = "_test_golden_tmp"
    write_golden(name, base_spec)
    ok, got, want = check_golden(name, base_spec)
    assert ok and got == want
    from cartpl.snapshot import golden_path

    golden_path(name).unlink()


def test_golden_missing(base_spec):
    ok, got, want = check_golden("_tidak_ada_golden", base_spec)
    assert not ok and want == ""


# ------------------------------------------------------------------ docgen


def test_doc_contains_key_sections(spec):
    md = generate_doc(spec)
    for heading in ("# ", "## Ringkasan dimensi", "## Geometri", "## Roda",
                    "## Material", "## Fitur", "## LOD", "## Fisika"):
        assert heading in md, heading


def test_doc_reports_real_numbers(spec):
    md = generate_doc(spec)
    dims = spec["dimensions"]
    total = dims["overhang_front"] + dims["wheelbase"] + dims["overhang_rear"]
    assert f"{total:.3f}" in md


def test_doc_livery_section_only_when_present(spec):
    without = copy.deepcopy(spec)
    without.pop("livery", None)
    assert "## Livery" not in generate_doc(without)


def test_write_doc_creates_file(tmp_path, spec):
    p = write_doc(spec, tmp_path / "d" / "x.md")
    assert p.exists() and p.read_text().startswith("# ")


def test_doc_embeds_preview(tmp_path, spec):
    md = generate_doc(spec, preview_path="previews/x.png")
    assert "![preview](previews/x.png)" in md


# --------------------------------------------------------------------- CLI


def test_cli_list(capsys):
    assert main(["list"]) == 0
    out = capsys.readouterr().out
    assert BASE in out and "_base" not in out


def test_cli_list_json(capsys):
    assert main(["list", "--json"]) == 0
    rows = json.loads(capsys.readouterr().out)
    assert len(rows) == 6


def test_cli_show(capsys):
    assert main(["show", BASE]) == 0
    assert json.loads(capsys.readouterr().out)["meta"]["name"] == BASE


def test_cli_validate_ok(capsys):
    assert main(["validate", BASE]) == 0


def test_cli_validate_json(capsys):
    assert main(["validate", BASE, "--json"]) == 0
    assert json.loads(capsys.readouterr().out)["ok"] is True


def test_cli_validate_missing_template(capsys):
    assert main(["validate", "tidak-ada"]) == 4


def test_cli_validate_invalid_file(capsys, tmp_path):
    p = tmp_path / "bad.json"
    p.write_text(json.dumps({"schema_version": "1.0.0"}))
    assert main(["validate", str(p)]) == 1


def test_cli_select_writes_file(tmp_path, capsys):
    out = tmp_path / "car_selected.json"
    assert main(["select", BASE, "-o", str(out)]) == 0
    assert out.exists()
    assert json.loads(out.read_text())["meta"]["name"] == BASE


def test_cli_select_conflict(tmp_path, capsys):
    out = tmp_path / "c.json"
    main(["select", BASE, "-o", str(out)])
    assert main(["select", BASE, "-o", str(out)]) == 3


def test_cli_select_force(tmp_path, capsys):
    out = tmp_path / "c.json"
    main(["select", BASE, "-o", str(out)])
    assert main(["select", BASE, "-o", str(out), "--force"]) == 0


def test_cli_select_abstract_rejected(tmp_path, capsys):
    assert main(["select", "_base", "-o", str(tmp_path / "x.json")]) == 1


def test_cli_estimate(capsys):
    assert main(["estimate", BASE]) == 0
    assert "QUADS" in capsys.readouterr().out


def test_cli_estimate_json(capsys):
    assert main(["estimate", BASE, "--json"]) == 0
    assert "lods" in json.loads(capsys.readouterr().out)


def test_cli_diff_exit_code(capsys):
    assert main(["diff", BASE, "wedge-hypercar", "--exit-code"]) == 1


def test_cli_diff_same(capsys):
    assert main(["diff", BASE, BASE, "--exit-code"]) == 0


def test_cli_lock_and_verify(tmp_path, capsys):
    out = tmp_path / "s.json"
    main(["select", BASE, "-o", str(out)])
    assert main(["lock", str(out)]) == 0
    assert main(["verify-lock", str(out)]) == 0


def test_cli_verify_lock_missing(tmp_path, capsys):
    p = tmp_path / "n.json"
    p.write_text(json.dumps(loader.resolve(BASE)))
    assert main(["verify-lock", str(p)]) == 3


def test_cli_migrate_list(capsys):
    assert main(["migrate", "x", "--list"]) == 0
    assert "2.0.0" in capsys.readouterr().out


def test_cli_migrate_file(tmp_path, capsys):
    src = tmp_path / "a.json"
    src.write_text(json.dumps(loader.resolve(BASE)))
    dst = tmp_path / "b.json"
    assert main(["migrate", str(src), "-o", str(dst), "--to", "2.0.0"]) == 0
    assert json.loads(dst.read_text())["schema_version"] == "2.0.0"


def test_cli_export_import(tmp_path, capsys):
    z = tmp_path / "p.zip"
    assert main(["export", BASE, "-o", str(z)]) == 0
    dest = tmp_path / "d"
    vdest = tmp_path / "v"
    assert main(["import", str(z), "--dest", str(dest), "--variants-dest", str(vdest)]) == 0
    assert (dest / f"{BASE}.json").exists()


def test_cli_analytics(capsys):
    assert main(["analytics"]) == 0
    assert "USED" in capsys.readouterr().out


def test_cli_analytics_json(capsys):
    assert main(["analytics", "--json"]) == 0
    assert "unused" in json.loads(capsys.readouterr().out)


def test_cli_variant_list(capsys):
    assert main(["variant", "list", BASE]) == 0
    assert "matte-black" in capsys.readouterr().out


def test_cli_variant_apply(tmp_path, capsys):
    out = tmp_path / "v.json"
    assert main(["variant", "apply", BASE, "mid-engine-supercar.matte-black",
                 "-o", str(out)]) == 0
    assert out.exists()


def test_cli_vary(tmp_path, capsys):
    assert main(["vary", BASE, "--count", "3", "--seed", "5", "-o", str(tmp_path)]) == 0
    assert len(list(tmp_path.glob("*.json"))) == 3


def test_cli_physics(capsys):
    assert main(["physics", BASE]) == 0
    assert "mass_kg" in capsys.readouterr().out


def test_cli_no_args_exits_2():
    with pytest.raises(SystemExit) as exc:
        main([])
    assert exc.value.code == 2


def test_cli_unknown_subcommand_exits_2():
    with pytest.raises(SystemExit) as exc:
        main(["terbang"])
    assert exc.value.code == 2
