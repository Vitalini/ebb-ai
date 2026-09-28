"""Cross-language parity for the Anthropic sampling allow-list.

The fixture lives in ``packages/core-ts/test/fixtures/sampling-allowlist-vectors.json``
and is shared with ``packages/core-ts/test/sampling-parity.test.ts``; if the
TS and PY predicates drift, one of the two suites goes red.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest

from ebb_ai.providers.anthropic import _supports_sampling_params

FIXTURE_PATH = (
    Path(__file__).resolve().parents[2]
    / "core-ts"
    / "test"
    / "fixtures"
    / "sampling-allowlist-vectors.json"
)

VECTORS: list[dict[str, Any]] = json.loads(FIXTURE_PATH.read_text(encoding="utf-8"))["vectors"]


@pytest.mark.parametrize("vector", VECTORS, ids=[repr(v["id"]) for v in VECTORS])
def test_sampling_allowlist_vector(vector: dict[str, Any]) -> None:
    assert _supports_sampling_params(vector["id"]) is vector["sampling"]
