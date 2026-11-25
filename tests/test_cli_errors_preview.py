"""Exit code CLI, pemetaan error, dan renderer pratinjau."""
from __future__ import annotations

import copy
import json

import numpy as np
import pytest
from PIL import Image

from cartpl import loader
from cartpl.builder import build_car
from cartpl.cli import main
from cartpl.errors import (CartplError, ImportConflictError, LockMismatchError,
                           NoMigrationPathError, PhysicsInconsistentError,
                           SchemaValidationError, SemanticValidationError,
                           TemplateCycleError, TemplateNotFoundError,
                           VariantForbiddenOverrideError, VariantNotFoundError,
                           IOErrorCartpl)
from cartpl.preview import contact_sheet, render_array, render_preview

BASE = "mid-engine-supercar"


# ------------------------------------------------------------ error codes


@pytest.mark.parametrize("exc,code", [
    (SchemaValidationError("x"), 1),
    (SemanticValidationError("x"), 1),
    (VariantForbiddenOverrideError("x"), 1),
    (PhysicsInconsistentError("x"), 1),
    (TemplateNotFoundError("x"), 4),
    (VariantNotFoundError("x"), 4),
    (TemplateCycleError("x"), 3),
    (NoMigrationPathError("x"), 3),
    (LockMismatchError("x"), 3),
    (ImportConflictError("x"), 3),
    (IOErrorCartpl("x"), 2),
])
def test_exception_maps_to_exit_code(exc, code):
    assert exc.code == code


def test_base_error_defaults_to_5():
    assert CartplError("x").code == 5


def test_cli_returns_error_code_for_cartpl_error(capsys):
    assert main(["validate", "tidak-ada-template"]) == 4


def test_cli_io_error_code(tmp_path, capsys):
    p = tmp_path / "rusak.json"
    p.write_text("{bukan json")
    assert main(["validate", str(p)]) == 2


def test_cli_diff_missing_template(capsys):
    assert main(["diff", "tidak-ada", BASE]) == 4


def test_cli_export_missing_template(tmp_path, capsys):
    assert main(["export", "tidak-ada", "-o", str(tmp_path / "x.zip")]) == 4


def test_cli_verify_lock_mismatch(tmp_path, capsys):
    p = tmp_path / "s.json"
    p.write_text(json.dumps(loader.resolve(BASE)))
    main(["lock", str(p)])
    spec = json.loads(p.read_text())
    spec["wing"]["type"] = "none"
    p.write_text(json.dumps(spec))
    assert main(["verify-lock", str(p)]) == 3


def test_cli_import_conflict(tmp_path, capsys):
    z = tmp_path / "p.zip"
    main(["export", BASE, "-o", str(z)])
    dest, vdest = tmp_path / "d", tmp_path / "v"
    assert main(["import", str(z), "--dest", str(dest), "--variants-dest", str(vdest)]) == 0
    assert main(["import", str(z), "--dest", str(dest), "--variants-dest", str(vdest)]) == 3


def test_error_output_has_code_and_path(capsys, tmp_path):
    p = tmp_path / "bad.json"
    p.write_text(json.dumps({"schema_version": "1.0.0"}))
    main(["validate", str(p)])
    err = capsys.readouterr().err
    assert "ERROR" in err and "at:" in err


# ---------------------------------------------------------------- preview


def test_render_array_shape(spec):
    arr = render_array(build_car(spec), spec, size=96)
    assert arr.shape == (96, 96, 3)
    assert arr.dtype == np.uint8


def test_render_not_blank(spec):
    arr = render_array(build_car(spec), spec, size=128)
    bg = np.array([32, 32, 32])
    coverage = (np.abs(arr.astype(int) - bg).sum(axis=2) > 18).mean()
    assert 0.05 < coverage < 0.85, f"coverage {coverage:.1%}"


def test_render_respects_camera(spec):
    """Kamera dari sudut berbeda harus menghasilkan gambar berbeda."""
    a = render_array(build_car(spec), spec, size=96,
                     camera={"azimuth_deg": 45, "elevation_deg": 15,
                             "distance_m": 8, "fov_deg": 35})
    b = render_array(build_car(spec), spec, size=96,
                     camera={"azimuth_deg": -120, "elevation_deg": 40,
                             "distance_m": 12, "fov_deg": 50})
    assert not np.array_equal(a, b)


def test_render_preview_writes_png(tmp_path, spec):
    p = render_preview(spec, tmp_path / "p.png", size=96)
    assert p.exists()
    im = Image.open(p)
    assert im.size == (96, 96)
    assert im.mode == "RGB"


def test_render_preview_makes_parent_dirs(tmp_path, spec):
    p = render_preview(spec, tmp_path / "a" / "b" / "p.png", size=64)
    assert p.exists()


def test_contact_sheet_size(tmp_path, spec):
    specs = {"a": spec, "b": copy.deepcopy(spec)}
    specs["b"]["colors"]["body_base"] = [0.8, 0.1, 0.1]
    p = contact_sheet(specs, tmp_path / "sheet.png", cols=2, size=64, pad=4)
    im = Image.open(p)
    assert im.size[0] == 2 * (64 + 8)


def test_contact_sheet_labels_differ(tmp_path, spec):
    """Setiap sel harus dapat dibedakan (label + warna berbeda)."""
    a = copy.deepcopy(spec)
    b = copy.deepcopy(spec)
    a["colors"]["body_base"] = [0.9, 0.9, 0.9]
    b["colors"]["body_base"] = [0.05, 0.05, 0.05]
    p = contact_sheet({"a": a, "b": b}, tmp_path / "s.png", cols=2, size=64)
    arr = np.asarray(Image.open(p)).astype(int)
    left = arr[:, : arr.shape[1] // 2].mean()
    right = arr[:, arr.shape[1] // 2:].mean()
    assert abs(left - right) > 3, "dua sel identik padahal warna beda"


def test_preview_all_templates(capsys, tmp_path):
    assert main(["render-preview", "--all", "-o", str(tmp_path), "--size", "64"]) == 0
    assert len(list(tmp_path.glob("*.png"))) == 6


def test_preview_single(capsys, tmp_path):
    out = tmp_path / "one.png"
    assert main(["render-preview", BASE, "-o", str(out), "--size", "64"]) == 0
    assert out.exists()


def test_preview_bad_camera_args(capsys, tmp_path):
    assert main(["render-preview", BASE, "-o", str(tmp_path / "x.png"),
                 "--camera", "1,2,3"]) == 1


def test_compare_cli(capsys, tmp_path):
    out = tmp_path / "cmp.png"
    assert main(["compare", BASE, "sedan-traffic", "-o", str(out), "--size", "64"]) == 0
    assert out.exists()


def test_compare_all(capsys, tmp_path):
    out = tmp_path / "all.png"
    assert main(["compare", "--all", "-o", str(out), "--size", "64"]) == 0
    assert out.exists()
