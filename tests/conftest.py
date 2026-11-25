"""Fixture bersama untuk test suite cartpl."""
from __future__ import annotations

import copy
import json
import sys
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parent.parent
if str(REPO) not in sys.path:
    sys.path.insert(0, str(REPO))

from cartpl import loader, validator  # noqa: E402
from cartpl.schema import validate_structure  # noqa: E402
from cartpl.resolver import apply_presets  # noqa: E402

DATA = Path(__file__).resolve().parent / "data"
INVALID = DATA / "invalid"
VALID = DATA / "valid"
GOLDEN = DATA / "golden"

CONCRETE = ["front-engine-gt", "mid-engine-supercar", "rally-hatch",
            "sedan-traffic", "track-focused", "wedge-hypercar"]


@pytest.fixture(scope="session")
def repo_root() -> Path:
    return REPO


@pytest.fixture(params=CONCRETE)
def template_name(request):
    return request.param


@pytest.fixture
def spec(template_name):
    """Spec final untuk setiap template konkret (parametris)."""
    raw = loader.resolve(template_name)
    resolved, _ = apply_presets(raw)
    return resolved


@pytest.fixture
def base_spec():
    return loader.resolve("mid-engine-supercar")


def load_invalid(name: str) -> dict:
    return json.loads((INVALID / f"{name}.json").read_text())


def codes_for(spec_dict: dict, source: str = "templates") -> list[str]:
    errs = validate_structure(spec_dict) + validator.validate_semantics(spec_dict, source=source)
    return [e["code"] for e in errs]


def all_codes_for(spec_dict: dict, source: str = "templates") -> set[str]:
    return set(codes_for(spec_dict, source))


@pytest.fixture
def concrete_names() -> list[str]:
    return list(CONCRETE)
