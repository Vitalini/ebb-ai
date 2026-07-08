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
    canonical_receipt_payload,
    default_signing_key_path,
    es_number,
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

    def test_uses_es_number_formatting(self) -> None:
        # 2.0 must canonicalize as "2" (JSON.stringify parity), not "2.0".
        assert _canonicalize({"a": 2.0, "b": 1e-7}) == '{"a":2,"b":1e-7}'

    def test_unicode_strings_are_not_ascii_escaped(self) -> None:
        # JSON.stringify leaves non-ASCII intact; so must we.
        assert _canonicalize({"prompt": "Grüße ☀️"}) == '{"prompt":"Grüße ☀️"}'


class TestEsNumber:
    """es_number() must match ECMAScript JSON.stringify byte-for-byte."""

    @pytest.mark.parametrize(
        ("value", "expected"),
        [
            (2.0, "2"),  # integral float loses the .0
            (0.1, "0.1"),
            (1e-7, "1e-7"),  # ES exponent style, no zero-padded exponent
            (1e21, "1e+21"),  # positional/exponent boundary (>= 1e21 → exponent)
            (1e20, "100000000000000000000"),  # last positional magnitude
            (0.000001, "0.000001"),  # ES stays positional down to 1e-6
            (-0.5, "-0.5"),
            (0.6, "0.6"),
            (1234.5678, "1234.5678"),
            (-0.0, "0"),  # JSON.stringify(-0) === "0"
            (0, "0"),
            (7, "7"),
            (9007199254740991, "9007199254740991"),  # Number.MAX_SAFE_INTEGER
            # Not representable as a double — rounds exactly like JS would.
            (1234567890123456789, "1234567890123456800"),
            (1.5e-8, "1.5e-8"),
            (5e-324, "5e-324"),  # smallest denormal
        ],
    )
    def test_matches_json_stringify(self, value: float, expected: str) -> None:
        assert es_number(value) == expected

    def test_rejects_bools_and_non_finite(self) -> None:
        with pytest.raises(TypeError):
            es_number(True)
        with pytest.raises(ValueError, match="non-finite"):
            es_number(float("inf"))


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

    def test_signed_at_is_covered_by_the_signature(self, tmp_path: Path) -> None:
        # v0.12 (audit §0.8): signedAt is INSIDE the signed payload.
        kp = load_or_create_signing_key(tmp_path / "k")
        signed = sign_receipt(BASE_RECEIPT, kp)
        assert f'"signedAt":"{signed["signed_at"]}"' in canonical_receipt_payload(signed)
        backdated = {**signed, "signed_at": "1999-01-01T00:00:00+00:00"}
        assert verify_receipt(backdated).outcome == "tampered"

    def test_signature_covers_the_camel_case_canonical_form(self, tmp_path: Path) -> None:
        # The ONE cross-language canonical form: camelCase keys, ES numbers.
        kp = load_or_create_signing_key(tmp_path / "k")
        receipt = {**BASE_RECEIPT, "estimated_carbon_g_co2": 0.6, "actual_carbon_g_co2": 2.0}
        signed = sign_receipt(receipt, kp)
        canonical = canonical_receipt_payload(signed)
        assert '"estimatedCarbonGCo2":0.6' in canonical
        assert '"actualCarbonGCo2":2' in canonical  # not "2.0"
        assert "estimated_carbon_g_co2" not in canonical


class TestLegacyV011Fallback:
    def test_camel_receipt_signed_without_signed_at_verifies_with_legacy_note(
        self, tmp_path: Path
    ) -> None:
        import base64
        kp = load_or_create_signing_key(tmp_path / "k")
        canonical = canonical_receipt_payload(BASE_RECEIPT, exclude_signed_at=True)
        sig = kp.private_key.sign(canonical.encode("utf-8"))
        legacy = {
            **BASE_RECEIPT,
            "signature": base64.b64encode(sig).decode("ascii"),
            "signer_public_key": kp.public_key_base64,
            "signed_at": "2026-06-01T13:00:00+00:00",
        }
        result = verify_receipt(legacy)
        assert result.outcome == "valid"
        assert "legacy v0.11 canonical form" in result.reason

    def test_old_python_snake_signed_receipt_still_verifies(self, tmp_path: Path) -> None:
        # ≤v0.11 sign_receipt signed the raw snake dict with json.dumps
        # number formatting (2.0 → "2.0"). Those ledger rows must keep
        # verifying via the raw-rendering fallback.
        import base64
        kp = load_or_create_signing_key(tmp_path / "k")
        receipt = {**BASE_RECEIPT, "actual_carbon_g_co2": 2.0}
        payload = {k: v for k, v in receipt.items() if v is not None}
        canonical = _canonicalize(payload, es_numbers=False)
        assert '"actual_carbon_g_co2":2.0' in canonical  # legacy json.dumps rendering
        sig = kp.private_key.sign(canonical.encode("utf-8"))
        legacy = {
            **receipt,
            "signature": base64.b64encode(sig).decode("ascii"),
            "signer_public_key": kp.public_key_base64,
            "signed_at": "2026-05-01T00:00:00+00:00",
        }
        result = verify_receipt(legacy)
        assert result.outcome == "valid"
        assert "legacy v0.11 canonical form" in result.reason

    def test_tampered_legacy_receipt_fails_every_form(self, tmp_path: Path) -> None:
        import base64
        kp = load_or_create_signing_key(tmp_path / "k")
        canonical = canonical_receipt_payload(BASE_RECEIPT, exclude_signed_at=True)
        sig = kp.private_key.sign(canonical.encode("utf-8"))
        legacy = {
            **BASE_RECEIPT,
            "region": "SE",  # tampered after signing
            "signature": base64.b64encode(sig).decode("ascii"),
            "signer_public_key": kp.public_key_base64,
            "signed_at": "2026-06-01T13:00:00+00:00",
        }
        assert verify_receipt(legacy).outcome == "tampered"


class TestCrossRendering:
    def test_camel_case_ts_receipt_verifies_in_python(self, tmp_path: Path) -> None:
        kp = load_or_create_signing_key(tmp_path / "k")
        signed = sign_receipt(BASE_RECEIPT, kp)
        camel = {
            "taskId": signed["task_id"],
            "ranAt": signed["ran_at"],
            "region": signed["region"],
            "estimatedCarbonGCo2": signed["estimated_carbon_g_co2"],
            "actualCarbonGCo2": signed["actual_carbon_g_co2"],
            "deltaPct": signed["delta_pct"],
            "model": signed["model"],
            "durationMs": signed["duration_ms"],
            "signature": signed["signature"],
            "signerPublicKey": signed["signer_public_key"],
            "signedAt": signed["signed_at"],
        }
        result = verify_receipt(camel)
        assert result.outcome == "valid"
        assert "legacy" not in result.reason

    def test_null_valued_fields_are_excluded_from_the_canonical_form(
        self, tmp_path: Path
    ) -> None:
        # asdict() emits None for unset optionals; TS JSON.stringify would
        # have dropped them as undefined. Both must be excluded.
        kp = load_or_create_signing_key(tmp_path / "k")
        signed = sign_receipt({**BASE_RECEIPT, "prompt": None, "provider": None}, kp)
        round_trip = json.loads(json.dumps(signed))
        assert verify_receipt(round_trip).outcome == "valid"


class TestAtomicKeyWrites:
    def test_no_temp_files_left_behind(self, tmp_path: Path) -> None:
        load_or_create_signing_key(tmp_path / "signing.key")
        assert sorted(p.name for p in tmp_path.iterdir()) == [
            "signing.key",
            "signing.key.pub",
        ]


class TestErrorIfExtraMissing:
    def test_sign_without_extra_raises_signingnotinstalled(self, monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
        # Simulate missing crypto without uninstalling the package.
        from ebb_ai import sign as sign_mod
        monkeypatch.setattr(sign_mod, "_HAS_CRYPTO", False)
        with pytest.raises(SigningNotInstalled):
            sign_mod.load_or_create_signing_key(tmp_path / "k")
