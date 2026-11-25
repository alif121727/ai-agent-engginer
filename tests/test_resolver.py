"""Resolver: preset menang atas field konkret, dengan warning."""
from __future__ import annotations

import copy

import pytest

from cartpl import loader
from cartpl.resolver import (AERO_PRESETS, STANCE_PRESETS, TIRE_PRESETS,
                             apply_presets)


@pytest.fixture
def raw():
    return loader.resolve("mid-engine-supercar")


def test_no_presets_is_noop(raw):
    spec, warns = apply_presets(raw)
    assert warns == []
    assert spec["dimensions"]["ride_height"] == raw["dimensions"]["ride_height"]


def test_stance_slammed_sets_ride_height(raw):
    raw["presets"] = {"stance": "slammed"}
    spec, warns = apply_presets(raw)
    assert spec["dimensions"]["ride_height"] == STANCE_PRESETS["slammed"]["ride_height"]
    assert any("ride_height" in w for w in warns)


def test_preset_lock_keeps_explicit_value(raw):
    raw["presets"] = {"stance": "slammed", "preset_lock": True}
    spec, warns = apply_presets(raw, preset_lock=True)
    assert spec["dimensions"]["ride_height"] == raw["dimensions"]["ride_height"]
    assert any("preset-lock" in w for w in warns)


def test_aero_preset_sets_wing(raw):
    raw["presets"] = {"aero": "track"}
    spec, _ = apply_presets(raw)
    assert spec["wing"]["type"] == AERO_PRESETS["track"]["wing"]["type"]
    assert spec["aero_front"]["canards"] == 4


def test_aero_clean_removes_wing(raw):
    raw["presets"] = {"aero": "clean"}
    spec, _ = apply_presets(raw)
    assert spec["wing"]["type"] == "none"


def test_tire_preset(raw):
    raw["presets"] = {"tire": "slick"}
    spec, _ = apply_presets(raw)
    assert spec["wheels"]["tire_width_m"] == TIRE_PRESETS["slick"]["tire_width_m"]


def test_unknown_stance_raises(raw):
    raw["presets"] = {"stance": "terbang"}
    with pytest.raises(ValueError, match="stance"):
        apply_presets(raw)


def test_unknown_aero_raises(raw):
    raw["presets"] = {"aero": "roket"}
    with pytest.raises(ValueError, match="aero"):
        apply_presets(raw)


def test_unknown_tire_raises(raw):
    raw["presets"] = {"tire": "kayu"}
    with pytest.raises(ValueError, match="tire"):
        apply_presets(raw)


def test_presets_key_removed_from_output(raw):
    raw["presets"] = {"stance": "stock"}
    spec, _ = apply_presets(raw)
    assert "presets" not in spec


def test_slammed_keeps_y_bottom_positive(raw):
    raw["presets"] = {"stance": "slammed"}
    spec, _ = apply_presets(raw)
    assert all(s["y_bottom"] >= 0.05 for s in spec["sections"])


def test_does_not_mutate_input(raw):
    raw["presets"] = {"aero": "track"}
    before = copy.deepcopy(raw["wing"]["type"])
    apply_presets(raw)
    assert raw["wing"]["type"] == before


@pytest.mark.parametrize("preset", sorted(STANCE_PRESETS))
def test_all_stance_presets_valid(raw, preset):
    raw["presets"] = {"stance": preset}
    spec, _ = apply_presets(raw)
    from cartpl.validator import validate_semantics

    codes = [e["code"] for e in validate_semantics(spec) if e["code"] != "E006"]
    assert codes == [], f"stance {preset}: {codes}"
