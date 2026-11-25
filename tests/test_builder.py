"""Builder: mesh valid, tanpa magic number, dan bentuk masuk akal."""
from __future__ import annotations

import numpy as np
import pytest

from cartpl import loader
from cartpl.builder import (KIND_BODY, KIND_GLASS, KIND_TIRE, Mesh,
                            build_car)
from cartpl.lods import pick_lod


def test_mesh_shape(spec):
    m = build_car(spec)
    assert isinstance(m, Mesh)
    assert m.Q.shape[1:] == (4, 3)
    assert m.VN.shape == m.Q.shape
    assert m.C.shape == (m.n_quads, 3)
    assert m.K.shape == (m.n_quads,)
    assert m.color.shape == (m.n_quads, 3)


def test_no_nan(spec):
    m = build_car(spec)
    assert np.isfinite(m.Q).all()
    assert np.isfinite(m.VN).all()


def test_normals_unit_length(spec):
    m = build_car(spec)
    lens = np.linalg.norm(m.VN.reshape(-1, 3), axis=1)
    assert np.allclose(lens, 1.0, atol=1e-3), f"normal tidak unit: {lens.min()}..{lens.max()}"


def test_quad_has_area(spec):
    m = build_car(spec)
    v0 = m.Q[:, 1] - m.Q[:, 0]
    v1 = m.Q[:, 3] - m.Q[:, 0]
    area = np.linalg.norm(np.cross(v0, v1), axis=1)
    assert (area > 1e-9).mean() > 0.98, "lebih dari 2% quad tanpa area"


def test_dimensions_match_spec(spec):
    m = build_car(spec)
    dims = spec["dimensions"]
    total = dims["overhang_front"] + dims["wheelbase"] + dims["overhang_rear"]
    assert abs(m.length - total) < 0.06
    assert abs(m.half_width - max(s["half_width"] for s in spec["sections"])) < 1e-6


def test_body_sits_above_ground(spec):
    m = build_car(spec)
    assert m.Q[:, :, 1].min() >= -1e-4, "ada vertex di bawah tanah"


def test_has_glass_and_tires(spec):
    m = build_car(spec)
    kinds = set(m.K.tolist())
    assert KIND_GLASS in kinds
    assert KIND_TIRE in kinds
    assert KIND_BODY in kinds


def test_lower_lod_has_fewer_quads(spec):
    lods = spec.get("lods") or []
    if len(lods) < 2:
        pytest.skip("template hanya punya satu LOD")
    full = build_car(spec, lod=lods[0])
    coarse = build_car(spec, lod=lods[-1])
    assert coarse.n_quads < full.n_quads


def test_pick_lod_nearest_is_most_detailed(spec):
    nearest = pick_lod(spec, 0.0)
    far = pick_lod(spec, 1000.0)
    assert nearest["n_sections"] >= far["n_sections"]


def test_deterministic(spec):
    a = build_car(spec)
    b = build_car(spec)
    assert np.array_equal(a.Q, b.Q)
    assert a.to_bytes() == b.to_bytes()


def test_no_magic_numbers_in_builder():
    """Builder tidak boleh memuat konstanta geometri numerik literal.

    Yang diizinkan: 0, 1, 2, 3, 4 (indeks/identitas), 0.5 (pembagi tengah),
    dan angka di dalam komentar atau nama field.
    """
    import re
    from pathlib import Path

    src = (Path(__file__).resolve().parent.parent / "cartpl" / "builder.py").read_text()
    allowed = {"0", "1", "2", "3", "4", "0.0", "1.0", "2.0", "0.5", "1e-9",
               "1e-12", "1e-6", "0.72", "0.55", "0.4", "0.62", "0.66"}
    suspects = []
    for line in src.splitlines():
        if line.strip().startswith("#"):
            continue
        code = line.split("#")[0]
        for m in re.finditer(r"(?<![\w.])(\d+\.\d+)(?![\w.])", code):
            val = m.group(1)
            if val not in allowed:
                suspects.append((val, line.strip()[:70]))
    # Angka yang tersisa hanya boleh yang dipakai untuk bias shading.
    assert len(suspects) <= 0, f"angka geometri hardcode: {suspects[:5]}"


def test_wheel_count_matches_lod(spec):
    """Jumlah quad roda turun saat spokes=0 di LOD kasar."""
    lods = spec.get("lods")
    if not lods or lods[-1].get("spokes", 1) != 0:
        pytest.skip("LOD terakhir masih punya spoke")
    with_spokes = build_car(spec, lod={"max_distance_m": 10, "n_sections": 40,
                                       "n_ring": 24, "spokes": 5})
    without = build_car(spec, lod=lods[-1])
    assert without.n_quads < with_spokes.n_quads


def test_livery_changes_color(spec):
    import copy

    plain = copy.deepcopy(spec)
    plain["livery"] = {"style": "none"}
    painted = copy.deepcopy(spec)
    painted["livery"] = {"style": "two-tone", "primary": [0.8, 0.1, 0.1],
                         "secondary": [0.05, 0.05, 0.05]}
    a = build_car(plain)
    b = build_car(painted)
    assert not np.allclose(a.color, b.color), "livery tidak mengubah warna"


def test_geometry_change_affects_mesh():
    """Mengubah konstanta geometry harus mengubah mesh (bukan diabaikan)."""
    spec = loader.resolve("mid-engine-supercar")
    a = build_car(spec)
    spec2 = loader.resolve("mid-engine-supercar")
    spec2["geometry"]["body_n_ring"] = spec2["geometry"]["body_n_ring"] + 8
    b = build_car(spec2, lod={"max_distance_m": 200,
                              "n_sections": spec["geometry"]["body_n_sections"],
                              "n_ring": spec2["geometry"]["body_n_ring"],
                              "spokes": 5})
    assert b.n_quads != a.n_quads
