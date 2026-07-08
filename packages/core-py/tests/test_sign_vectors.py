"""Shared cross-language receipt-signing test vectors (audit §0.3).

The fixture lives in the TS package —
``packages/core-ts/test/fixtures/cross-lang-receipt-vectors.json`` —
and is the single source of truth for the canonical signing form. It is
consumed byte-for-byte by BOTH this suite and
``packages/core-ts/test/sign-vectors.test.ts``; if either port drifts
from the canonical camelCase / ES-number form, one of the two suites
goes red.

The embedded ``privateKeyPem`` is a THROWAWAY Ed25519 key generated once
for the fixture. It is test-only and protects nothing.
"""

from __future__ import annotations

import base64
import json
import re
from datetime import datetime
from pathlib import Path
from typing import Any

import pytest

from ebb_ai.sign import (
    SigningKeyPair,
    canonical_receipt_payload,
    is_signing_available,
    sign_receipt,
    verify_receipt,
)

pytestmark = pytest.mark.skipif(
    not is_signing_available(),
    reason="ebb-ai[signing] extras not installed",
)

# Relative path from packages/core-py/tests up to the shared fixture in
# the TS package: parents[2] == <repo>/packages, then down into
# core-ts/test/fixtures. Both suites read the SAME file.
FIXTURE_PATH = (
    Path(__file__).resolve().parents[2]
    / "core-ts"
    / "test"
    / "fixtures"
    / "cross-lang-receipt-vectors.json"
)

FIXTURE = json.loads(FIXTURE_PATH.read_text(encoding="utf-8"))
VECTORS: list[dict[str, Any]] = FIXTURE["vectors"]
VECTOR_IDS = [v["description"][:48] for v in VECTORS]

_SIGNATURE_KEYS = frozenset(
    {"signature", "signerPublicKey", "signer_public_key", "signedAt", "signed_at"}
)


def _key_pair_from_pem(pem: str) -> SigningKeyPair:
    from cryptography.hazmat.primitives import serialization

    private_key = serialization.load_pem_private_key(pem.encode("ascii"), password=None)
    raw_pub = private_key.public_key().public_bytes(
        encoding=serialization.Encoding.Raw,
        format=serialization.PublicFormat.Raw,
    )
    return SigningKeyPair(
        private_key=private_key,
        public_key=private_key.public_key(),
        public_key_base64=base64.b64encode(raw_pub).decode("ascii"),
        private_key_path="<fixture>",
    )


def _tamper(value: Any) -> Any:
    """Mutate a value in a way that survives JSON round-trips."""
    if isinstance(value, bool):
        return not value
    if isinstance(value, str):
        return value + "-tampered"
    if isinstance(value, (int, float)):
        return value * 2 + 1
    return "tampered"


def _snake_to_camel(key: str) -> str:
    return re.sub(r"_([a-z0-9])", lambda m: m.group(1).upper(), key)


def _camel_to_snake(key: str) -> str:
    return re.sub(r"([A-Z])", lambda m: "_" + m.group(1).lower(), key)


def test_fixture_has_at_least_four_vectors() -> None:
    assert len(VECTORS) >= 4


@pytest.mark.parametrize("vector", VECTORS, ids=VECTOR_IDS)
def test_canonicalization_is_byte_exact(vector: dict[str, Any]) -> None:
    got = canonical_receipt_payload(
        vector["signedReceipt"],
        exclude_signed_at=vector["legacyV011"],
    )
    assert got == vector["expectedCanonical"]


@pytest.mark.parametrize("vector", VECTORS, ids=VECTOR_IDS)
def test_signed_receipt_verifies_as_valid(vector: dict[str, Any]) -> None:
    result = verify_receipt(vector["signedReceipt"])
    assert result.outcome == "valid"
    assert result.signer_public_key == FIXTURE["signerPublicKeyBase64"]
    if vector["legacyV011"]:
        assert "legacy v0.11 canonical form" in result.reason
    else:
        assert "legacy" not in result.reason


@pytest.mark.parametrize("vector", VECTORS, ids=VECTOR_IDS)
def test_verifies_in_the_opposite_key_rendering(vector: dict[str, Any]) -> None:
    signed = vector["signedReceipt"]
    is_snake = any("_" in k for k in signed)
    translate = _snake_to_camel if is_snake else _camel_to_snake
    rendered = {translate(k): v for k, v in signed.items()}
    assert verify_receipt(rendered).outcome == "valid"


@pytest.mark.parametrize("vector", VECTORS, ids=VECTOR_IDS)
def test_tampering_any_covered_field_is_detected(vector: dict[str, Any]) -> None:
    signed = vector["signedReceipt"]
    for key, value in signed.items():
        if key in _SIGNATURE_KEYS:
            continue
        if value is None:
            continue  # excluded from the canonical form
        mutated = {**signed, key: _tamper(value)}
        assert verify_receipt(mutated).outcome == "tampered", f"field {key}"


@pytest.mark.parametrize("vector", VECTORS, ids=VECTOR_IDS)
def test_signed_at_tampering(vector: dict[str, Any]) -> None:
    signed = vector["signedReceipt"]
    key = "signed_at" if "signed_at" in signed else "signedAt"
    mutated = {**signed, key: "1999-01-01T00:00:00+00:00"}
    if vector["legacyV011"]:
        # Documented v0.11 limitation — exactly why v0.12 moved signedAt
        # inside the signed payload.
        assert verify_receipt(mutated).outcome == "valid"
    else:
        assert verify_receipt(mutated).outcome == "tampered"


def test_sign_receipt_reproduces_the_snake_vector_signature() -> None:
    """Ed25519 is deterministic: re-signing the Python-rendered vector
    with the fixture key and the fixed signedAt must reproduce the exact
    signature bytes."""
    vector = next(v for v in VECTORS if any("_" in k for k in v["signedReceipt"]))
    kp = _key_pair_from_pem(vector["privateKeyPem"])
    signed = sign_receipt(
        vector["receipt"],
        kp,
        now=datetime.fromisoformat(vector["signedAt"]),
    )
    assert signed["signature"] == vector["signedReceipt"]["signature"]
    assert signed["signer_public_key"] == vector["signedReceipt"]["signer_public_key"]
    assert signed["signed_at"] == vector["signedAt"]
    # And the returned receipt keeps its snake_case keys untouched.
    assert set(vector["receipt"]) <= set(signed)


def test_low_level_resign_reproduces_all_v012_vectors() -> None:
    for vector in VECTORS:
        if vector["legacyV011"]:
            continue
        kp = _key_pair_from_pem(vector["privateKeyPem"])
        canonical = canonical_receipt_payload(
            {**vector["receipt"], "signedAt": vector["signedAt"]}
        )
        assert canonical == vector["expectedCanonical"]
        sig = base64.b64encode(kp.private_key.sign(canonical.encode("utf-8"))).decode("ascii")
        assert sig == vector["signedReceipt"]["signature"], vector["description"]
