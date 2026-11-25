"""Schema + validator: setiap kode E001-E022 punya kasus sendiri."""
from __future__ import annotations

import json

import pytest

from cartpl.schema import check_structure, validate_structure
from cartpl.validator import check_duplicate_names, validate_semantics, warnings_for
from conftest import INVALID, all_codes_for, codes_for, load_invalid

INVALID_CASES = sorted(p.stem for p in INVALID.glob("*.json"))


@pytest.mark.parametrize("case", INVALID_CASES)
def test_invalid_case_triggers_expected_code(case):
    want = case.split("_")[0]
    codes = all_codes_for(load_invalid(case))
    assert want in codes, f"{case}: kode {want} tidak muncul, dapat {codes}"


@pytest.mark.parametrize("case", INVALID_CASES)
def test_invalid_case_reports_path(case):
    spec = load_invalid(case)
    errs = validate_structure(spec) + validate_semantics(spec)
    hits = [e for e in errs if e["code"] == case.split("_")[0]]
    assert hits, f"{case} tidak menghasilkan error"
    assert all(e["path"] for e in hits), f"{case}: error tanpa path"


def test_all_templates_pass_semantics(template_name):
    from cartpl import loader

    spec = loader.resolve(template_name)
    assert validate_semantics(spec) == []


def test_all_templates_pass_schema(template_name):
    from cartpl import loader

    spec = loader.resolve(template_name)
    assert validate_structure(spec) == []


def test_e016_duplicate_names(tmp_path):
    a = tmp_path / "a.json"
    b = tmp_path / "b.json"
    payload = {"meta": {"name": "sama"}}
    a.write_text(json.dumps(payload))
    b.write_text(json.dumps(payload))
    errs = check_duplicate_names([a, b])
    assert [e["code"] for e in errs] == ["E016"]


def test_e016_unique_names_ok(tmp_path):
    a = tmp_path / "a.json"
    b = tmp_path / "b.json"
    a.write_text(json.dumps({"meta": {"name": "satu"}}))
    b.write_text(json.dumps({"meta": {"name": "dua"}}))
    assert check_duplicate_names([a, b]) == []


def test_warnings_are_not_errors(template_name):
    from cartpl import loader

    spec = loader.resolve(template_name)
    warns = warnings_for(spec)
    for w in warns:
        assert w["code"].startswith("W")
        assert w["code"] not in {e["code"] for e in validate_semantics(spec)}


def test_strict_mode_promotes_warnings(tmp_path):
    """--strict: warning dihitung sebagai error (exit code 1)."""
    from cartpl import loader
    from cartpl.cli import main

    spec = loader.resolve("front-engine-gt")
    p = tmp_path / "spec.json"
    p.write_text(json.dumps(spec))
    assert main(["validate", str(p)]) == 0
    assert main(["validate", str(p), "--strict"]) == 1


def test_check_structure_raises_on_missing_field():
    from cartpl.errors import SchemaValidationError

    with pytest.raises(SchemaValidationError):
        check_structure({"schema_version": "1.0.0"})


def test_schema_rejects_unknown_field():
    from cartpl import loader

    spec = loader.resolve("mid-engine-supercar")
    spec["field_tidak_dikenal"] = 1
    codes = [e["code"] for e in validate_structure(spec)]
    assert codes == ["SCHEMA"]


def test_wing_none_allows_missing_dims(template_name):
    """E009 tidak boleh menyalak pada template tanpa sayap."""
    from cartpl import loader

    spec = loader.resolve("sedan-traffic")
    assert spec["wing"]["type"] == "none"
    assert "E009" not in codes_for(spec)
