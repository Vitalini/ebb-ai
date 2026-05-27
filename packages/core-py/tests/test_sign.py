"""Ed25519 receipt-signing tests (mirrors core-ts/test/sign.test.ts).

These tests are guarded: if the ``signing`` extras aren't installed,
the suite is skipped en bloc (matching how the scheduler degrades).
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from ebb_ai.sign import (
    SigningNotInstalled,
    _canonicalize,  # type: ignore[attr-defined]
    default_signing_key_path,
    is_signing_available,
    load_or_create_signing_key,
    sign_receipt,
    verify_receipt,
)

pytestmark = pytest.mark.skipif(
    not is_signing_available(),
    reason="ebb-ai[signing] extras not installed",
)

BASE_RECEIPT = {
    "task_id": "py-sign-1",
    "ran_at": "2026-06-01T12:00:00.000Z",
    "region": "US-CAL-CISO",
    "estimated_carbon_g_co2": 3.2,
    "actual_carbon_g_co2": 3.4,
    "delta_pct": 6.3,
    "model": "claude-sonnet-4-5",
    "duration_ms": 1234,
}


class TestCanonicalize:
    def test_sorts_recursively_and_deterministically(self) -> None:
        a = _canonicalize({"b": 1, "a": 2, "c": {"y": 3, "x": 4}})
        b = _canonicalize({"a": 2, "c": {"x": 4, "y": 3}, "b": 1})
        assert a == b
        assert a == '{"a":2,"b":1,"c":{"x":4,"y":3}}'

    def test_drops_none_keeps_null_as_explicit(self) -> None:
        # `None` is the Python `undefined`; we strip it like the TS port.
        assert _canonicalize({"a": None, "b": 0}) == '{"b":0}'

    def test_preserves_array_order(self) -> None:
        assert _canonicalize([3, 1, 2]) == "[3,1,2]"

    def test_rejects_non_finite_numbers(self) -> None:
        with pytest.raises(ValueError, match="non-finite"):
            _canonicalize(float("nan"))
        with pytest.raises(ValueError, match="non-finite"):
            _canonicalize({"x": float("inf")})


class TestLoadOrCreateSigningKey:
    def test_generates_on_first_call_reuses_after(self, tmp_path: Path) -> None:
        p = tmp_path / "signing.key"
        a = load_or_create_signing_key(p)
        b = load_or_create_signing_key(p)
        assert a.public_key_base64 == b.public_key_base64

    def test_raw_public_key_is_32_bytes(self, tmp_path: Path) -> None:
        import base64
        kp = load_or_create_signing_key(tmp_path / "k")
        assert len(base64.b64decode(kp.public_key_base64)) == 32

    def test_default_path_under_ebb_ai_home(self) -> None:
        assert default_signing_key_path().name == "signing.key"
        assert default_signing_key_path().parent.name == ".ebb-ai"


class TestSignAndVerify:
    def test_round_trip_valid(self, tmp_path: Path) -> None:
        kp = load_or_create_signing_key(tmp_path / "k")
        signed = sign_receipt(BASE_RECEIPT, kp)
        assert signed["signer_public_key"] == kp.public_key_base64
        assert signed["signed_at"].startswith("20")
        result = verify_receipt(signed)
        assert result.outcome == "valid"
        assert result.signer_public_key == kp.public_key_base64

    def test_detects_tampered_field(self, tmp_path: Path) -> None:
        kp = load_or_create_signing_key(tmp_path / "k")
        signed = sign_receipt(BASE_RECEIPT, kp)
        tampered = {**signed, "actual_carbon_g_co2": 0.1}
        assert verify_receipt(tampered).outcome == "tampered"

    def test_legacy_unsigned(self) -> None:
        assert verify_receipt(BASE_RECEIPT).outcome == "legacy-unsigned"

    def test_key_mismatch(self, tmp_path: Path) -> None:
        import base64
        kp = load_or_create_signing_key(tmp_path / "k")
        signed = sign_receipt(BASE_RECEIPT, kp)
        fake = base64.b64encode(b"\x07" * 32).decode("ascii")
        result = verify_receipt(signed, trusted_public_key=fake)
        assert result.outcome == "key-mismatch"

    def test_two_keypairs_diverge(self, tmp_path: Path) -> None:
        a = load_or_create_signing_key(tmp_path / "a")
        b = load_or_create_signing_key(tmp_path / "b")
        assert a.public_key_base64 != b.public_key_base64
        sa = sign_receipt(BASE_RECEIPT, a)["signature"]
        sb = sign_receipt(BASE_RECEIPT, b)["signature"]
        assert sa != sb

    def test_field_reorder_does_not_break_verification(self, tmp_path: Path) -> None:
        kp = load_or_create_signing_key(tmp_path / "k")
        signed = sign_receipt(BASE_RECEIPT, kp)
        reordered = dict(reversed(list(signed.items())))
        # Force a round-trip through JSON to mimic on-wire transport.
        round_trip = json.loads(json.dumps(reordered))
        assert verify_receipt(round_trip).outcome == "valid"

    def test_invalid_public_key_length_raises(self) -> None:
        import base64
        bad = {
            **BASE_RECEIPT,
            "signature": "AAAA",
            "signer_public_key": base64.b64encode(b"\x00" * 16).decode("ascii"),
            "signed_at": "2026-06-01T12:00:00Z",
        }
        with pytest.raises(ValueError, match="32 bytes"):
            verify_receipt(bad)


class TestErrorIfExtraMissing:
    def test_sign_without_extra_raises_signingnotinstalled(self, monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
        # Simulate missing crypto without uninstalling the package.
        from ebb_ai import sign as sign_mod
        monkeypatch.setattr(sign_mod, "_HAS_CRYPTO", False)
        with pytest.raises(SigningNotInstalled):
            sign_mod.load_or_create_signing_key(tmp_path / "k")
