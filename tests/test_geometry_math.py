"""LOD, fisika, livery, dan estimator."""
from __future__ import annotations

import copy

import pytest

from cartpl import loader
from cartpl.builder import build_car
from cartpl.estimate import estimate, estimate_lod
from cartpl.livery import generate_mask, mask_coverage
from cartpl.lods import all_lods, default_lods, pick_lod
from cartpl.physics import (derive_physics, drag_force, estimate_mass,
                            geometric_wheel_radius)
from cartpl.errors import PhysicsInconsistentError


# ------------------------------------------------------------------- lods


def test_default_lods_three_levels():
    spec = loader.resolve("mid-engine-supercar")
    assert len(default_lods(spec)) == 3


def test_default_lods_descending():
    spec = loader.resolve("mid-engine-supercar")
    ds = [l["max_distance_m"] for l in default_lods(spec)]
    assert ds == sorted(ds, reverse=True)


def test_pick_lod_zero_is_most_detailed(spec):
    lods = all_lods(spec)
    near = pick_lod(spec, 0.0)
    assert near["n_sections"] == lods[0]["n_sections"]


def test_pick_lod_beyond_range_returns_coarsest(spec):
    lods = all_lods(spec)
    far = pick_lod(spec, 10_000)
    assert far["n_sections"] == lods[-1]["n_sections"]


def test_pick_lod_monotonic(spec):
    lods = all_lods(spec)
    prev = 10**9
    for d in (0, 5, 20, 60, 150, 500):
        n = pick_lod(spec, d)["n_sections"]
        assert n <= prev, f"LOD naik saat jarak bertambah di {d} m"
        prev = n


# ----------------------------------------------------------------- physics


def test_wheel_radius_matches_geometry(spec):
    want = spec["wheels"]["rim_diameter_m"] / 2 + spec["wheels"]["tire_sidewall_m"]
    assert abs(geometric_wheel_radius(spec) - want) < 1e-9


def test_derive_physics_fills_all_fields(spec):
    p = derive_physics(spec)
    for k in ("wheel_radius_m", "mass_kg", "drag_cd", "frontal_area_m2", "gear_ratios"):
        assert k in p


def test_explicit_radius_mismatch_raises():
    spec = loader.resolve("mid-engine-supercar")
    spec["physics"]["wheel_radius_m"] = 0.99
    with pytest.raises(PhysicsInconsistentError):
        derive_physics(spec)


def test_explicit_radius_ok_when_consistent():
    spec = loader.resolve("mid-engine-supercar")
    spec["physics"]["wheel_radius_m"] = round(geometric_wheel_radius(spec), 4)
    p = derive_physics(spec)
    assert p["wheel_radius_m"] == spec["physics"]["wheel_radius_m"]


def test_mass_in_plausible_range(spec):
    assert 600 <= estimate_mass(spec) <= 2500


def test_drag_force_scales_with_square_speed(spec):
    p = derive_physics(spec)
    a = drag_force(p, 10.0)
    b = drag_force(p, 20.0)
    assert abs(b / a - 4.0) < 1e-6


def test_physics_is_deterministic(spec):
    assert derive_physics(spec) == derive_physics(spec)


# ------------------------------------------------------------------ livery


def test_none_livery_is_zero_everywhere():
    for u in (0.0, 0.5, 1.0):
        for v in (0.0, 0.5, 1.0):
            assert generate_mask({"style": "none"}, u, v) == 0.0


def test_two_tone_splits_at_mid_height():
    liv = {"style": "two-tone"}
    assert generate_mask(liv, 0.5, 0.1) == 1.0
    assert generate_mask(liv, 0.5, 0.9) == 0.0


def test_stripes_cover_less_than_half():
    liv = {"style": "stripes", "stripe_width_m": 0.10}
    cov = mask_coverage(liv)
    assert 0.0 < cov < 0.35


def test_stripe_width_affects_coverage():
    thin = mask_coverage({"style": "stripes", "stripe_width_m": 0.04})
    thick = mask_coverage({"style": "stripes", "stripe_width_m": 0.16})
    assert thick > thin


def test_roundel_is_local():
    liv = {"style": "number-roundel"}
    assert generate_mask(liv, 0.72, 0.62) == 1.0
    assert generate_mask(liv, 0.05, 0.05) == 0.0


def test_split_livery_diagonal():
    liv = {"style": "split"}
    assert generate_mask(liv, 0.9, 0.9) == 1.0
    assert generate_mask(liv, 0.1, 0.1) == 0.0


def test_unknown_livery_style_raises():
    with pytest.raises(ValueError, match="livery"):
        generate_mask({"style": "zebra"}, 0.5, 0.5)


def test_mask_is_clamped_outside_unit_square():
    liv = {"style": "two-tone"}
    assert generate_mask(liv, -5, 0.0) in (0.0, 1.0)
    assert generate_mask(liv, 5, 5) in (0.0, 1.0)


# ---------------------------------------------------------------- estimate


@pytest.mark.parametrize("name", ["front-engine-gt", "mid-engine-supercar",
                                  "rally-hatch", "sedan-traffic",
                                  "track-focused", "wedge-hypercar"])
def test_estimate_within_5_percent(name):
    spec = loader.resolve(name)
    est = estimate(spec)["lods"][0]
    actual = build_car(spec).n_quads
    err = abs(est["n_quads"] - actual) / actual
    assert err < 0.05, f"{name}: estimasi {est['n_quads']} vs aktual {actual} ({err:.1%})"


def test_estimate_has_breakdown(spec):
    est = estimate_lod(spec, all_lods(spec)[0])
    assert set(est["breakdown"]) >= {"body", "cabin", "wheels", "wing",
                                     "aero_front", "side_details", "lights"}
    assert sum(est["breakdown"].values()) == est["n_quads"]


def test_estimate_verts_is_quad_times_four(spec):
    est = estimate(spec)
    for l in est["lods"]:
        assert l["n_verts"] == l["n_quads"] * 4


def test_estimate_lod_decreases_with_distance(spec):
    quads = [l["n_quads"] for l in estimate(spec)["lods"]]
    assert quads == sorted(quads, reverse=True)


def test_estimate_wing_none_has_no_wing_quads():
    spec = loader.resolve("sedan-traffic")
    est = estimate_lod(spec, all_lods(spec)[0])
    assert est["breakdown"]["wing"] == 0


def test_estimate_counts_extra_canards():
    spec = loader.resolve("wedge-hypercar")
    base = estimate_lod(spec, all_lods(spec)[0])["breakdown"]["aero_front"]
    spec2 = copy.deepcopy(spec)
    spec2["aero_front"]["canards"] += 2
    more = estimate_lod(spec2, all_lods(spec2)[0])["breakdown"]["aero_front"]
    assert more > base
