"""Loader: inheritance, deep merge, dan penanganan siklus."""
from __future__ import annotations

import json

import pytest

from cartpl import loader
from cartpl.errors import TemplateCycleError, TemplateNotFoundError


def test_list_templates_excludes_abstract():
    names = loader.list_templates()
    assert "_base" not in names
    assert len(names) == 6


def test_list_abstract_only_base():
    assert loader.list_abstract() == ["_base"]


def test_resolve_includes_chain():
    spec = loader.resolve("mid-engine-supercar")
    assert spec["meta"]["_resolved_chain"] == ["_base", "mid-engine-supercar"]


def test_child_overrides_parent_scalar():
    base = loader.resolve("_base")
    child = loader.resolve("rally-hatch")
    assert base["wheels"]["spokes"] != child["wheels"]["spokes"]


def test_child_inherits_geometry_from_base():
    base = loader.resolve("_base")
    child = loader.resolve("sedan-traffic")
    assert child["geometry"] == base["geometry"]


def test_deep_merge_keeps_sibling_keys():
    """Override `colors` tidak boleh menghapus `colors.carbon_weave`."""
    spec = loader.resolve("front-engine-gt")
    assert spec["colors"]["carbon_weave"] is False
    assert "body_base" in spec["colors"]
    assert "glass_tint" in spec["colors"]


def test_arrays_are_replaced_not_merged():
    base = loader.resolve("_base")
    child = loader.resolve("track-focused")
    # gear_ratios anak lebih pendek -> harus diganti total
    assert child["physics"]["gear_ratios"] != base.get("physics", {}).get("gear_ratios")
    assert len(child["physics"]["gear_ratios"]) == 6


def test_meta_name_belongs_to_leaf():
    spec = loader.resolve("wedge-hypercar")
    assert spec["meta"]["name"] == "wedge-hypercar"
    assert spec["meta"]["extends"] == "_base"


def test_abstract_not_inherited():
    """Anak `_base` (abstract: true) harus konkret."""
    for name in loader.list_templates():
        spec = loader.resolve(name)
        assert spec["meta"]["abstract"] is False, name


def test_missing_template_raises():
    with pytest.raises(TemplateNotFoundError):
        loader.resolve("tidak-ada")


def test_cycle_detection(tmp_path):
    a = {"meta": {"name": "a", "extends": "b", "display_name": "A", "description": "x"}}
    b = {"meta": {"name": "b", "extends": "a", "display_name": "B", "description": "y"}}
    (tmp_path / "a.json").write_text(json.dumps(a))
    (tmp_path / "b.json").write_text(json.dumps(b))
    with pytest.raises(TemplateCycleError):
        loader.resolve("a", tmp_path)


def test_self_cycle_detection(tmp_path):
    a = {"meta": {"name": "a", "extends": "a", "display_name": "A", "description": "x"}}
    (tmp_path / "a.json").write_text(json.dumps(a))
    with pytest.raises(TemplateCycleError):
        loader.resolve("a", tmp_path)


def test_depth_limit(tmp_path):
    names = ["d0", "d1", "d2", "d3", "d4"]
    for i, n in enumerate(names):
        spec = {"meta": {"name": n, "display_name": n, "description": "x"}}
        if i + 1 < len(names):
            spec["meta"]["extends"] = names[i + 1]
        (tmp_path / f"{n}.json").write_text(json.dumps(spec))
    with pytest.raises(TemplateCycleError):
        loader.resolve("d0", tmp_path)


def test_load_raw_accepts_path(tmp_path):
    p = tmp_path / "x.json"
    p.write_text(json.dumps({"meta": {"name": "x"}}))
    assert loader.load_raw(p)["meta"]["name"] == "x"


def test_invalid_json_reports_io_error(tmp_path):
    from cartpl.errors import IOErrorCartpl

    p = tmp_path / "bad.json"
    p.write_text("{bukan json")
    with pytest.raises(IOErrorCartpl):
        loader.load_raw(p)


def test_resolve_does_not_mutate_source():
    first = loader.resolve("mid-engine-supercar")
    first["colors"]["body_base"] = [1.0, 0.0, 0.0]
    second = loader.resolve("mid-engine-supercar")
    assert second["colors"]["body_base"] != [1.0, 0.0, 0.0]
