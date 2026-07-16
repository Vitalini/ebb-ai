"""Cross-language model-energy resolution parity (audit §1.8).

The fixture lives in the TS package —
``packages/core-ts/test/fixtures/model-energy-vectors.json`` — and is the
single source of truth for how tricky model ids resolve (dated suffixes,
provider prefixes, word-order variants, family fallbacks, unknown ids).
It is consumed byte-for-byte by BOTH this suite and
``packages/core-ts/test/energy-parity.test.ts``; if the TS and PY
normalization / family-fallback logic drift, one suite goes red.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest

from ebb_ai.energy import resolve_model_energy

# parents[2] == <repo>/packages, then down into core-ts/test/fixtures.
FIXTURE_PATH = (
    Path(__file__).resolve().parents[2]
    / "core-ts"
    / "test"
    / "fixtures"
    / "model-energy-vectors.json"
)

FIXTURE = json.loads(FIXTURE_PATH.read_text(encoding="utf-8"))
VECTORS: list[dict[str, Any]] = FIXTURE["vectors"]
VECTOR_IDS = [f"{v['id']!r}->{v['resolution']}" for v in VECTORS]


def test_fixture_covers_all_four_tiers() -> None:
    tiers = {v["resolution"] for v in VECTORS}
    assert tiers == {"exact", "normalized", "family-fallback", "default"}


@pytest.mark.parametrize("vector", VECTORS, ids=VECTOR_IDS)
def test_resolution_matches_fixture(vector: dict[str, Any]) -> None:
    resolved = resolve_model_energy(vector["id"])
    assert resolved.tier == vector["resolution"]
    assert resolved.coeffs.source == vector["source"]
    assert resolved.coeffs.wh_per_input_token == pytest.approx(
        vector["whPerInputToken"], abs=1e-9
    )
    assert resolved.coeffs.wh_per_output_token == pytest.approx(
        vector["whPerOutputToken"], abs=1e-9
    )
