"""Ed25519 receipt signing (v0.11+, opt-in).

Python mirror of ``packages/core-ts/src/sign.ts``. Where the TS package
uses Node's built-in ``crypto`` (no deps), the Python build pulls in
``cryptography`` only when the caller opts in via the ``signing`` extras
package — keeping ``pip install ebb-ai`` lightweight for users who only
want the scheduler.

Install with signing enabled:

    pip install "ebb-ai[signing]"

Without that extra, importing this module is fine, but :func:`sign_receipt`
raises :class:`SigningNotInstalled`. Verification (:func:`verify_receipt`)
of pre-signed receipts also requires the extra. The scheduler itself
silently falls back to writing unsigned receipts when the extra is
absent, so the default install path remains v0.10-compatible.

See ``packages/core-ts/src/sign.ts`` for the full design rationale,
canonicalization rules, and key lifecycle.
"""

from __future__ import annotations

import base64
import contextlib
import json
import math
import os
import stat
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Literal

try:
    from cryptography.hazmat.primitives import serialization
    from cryptography.hazmat.primitives.asymmetric import ed25519

    _HAS_CRYPTO = True
except ImportError:  # pragma: no cover — exercised in non-extra installs
    _HAS_CRYPTO = False


class SigningNotInstalled(ImportError):
    """Raised when signing is invoked without the ``signing`` extras installed."""

    def __init__(self) -> None:
        super().__init__(
            "Receipt signing requires the `cryptography` library. "
            "Install via `pip install 'ebb-ai[signing]'`."
        )


def is_signing_available() -> bool:
    """Return True iff the ``cryptography`` extra is installed."""
    return _HAS_CRYPTO


VerifyOutcome = Literal["valid", "tampered", "legacy-unsigned", "key-mismatch"]


@dataclass(frozen=True, slots=True)
class SigningKeyPair:
    """An Ed25519 keypair plus the filesystem path the private key lives at.

    ``public_key_base64`` is the raw 32-byte public key — same encoding
    used by the TS port — suitable for embedding directly on a receipt.
    """

    private_key: Any
    public_key: Any
    public_key_base64: str
    private_key_path: str


@dataclass(frozen=True, slots=True)
class VerifyResult:
    outcome: VerifyOutcome
    reason: str
    signer_public_key: str | None = None


def default_signing_key_path() -> Path:
    """Default ``~/.ebb-ai/signing.key`` location."""
    return Path.home() / ".ebb-ai" / "signing.key"


def load_or_create_signing_key(
    private_key_path: str | os.PathLike[str] | None = None,
) -> SigningKeyPair:
    """Load the local signing keypair, generating + persisting one on first call.

    Mirrors the TS ``loadOrCreateSigningKey()``: idempotent and safe under
    concurrent first-call (file write through ``open(..., 'wb')`` is atomic
    on POSIX; the first writer wins).
    """
    if not _HAS_CRYPTO:
        raise SigningNotInstalled()
    path = Path(private_key_path) if private_key_path else default_signing_key_path()
    public_path = path.with_suffix(path.suffix + ".pub")

    if path.exists():
        pem = path.read_bytes()
        private_key = serialization.load_pem_private_key(pem, password=None)
        public_key = private_key.public_key()
    else:
        private_key = ed25519.Ed25519PrivateKey.generate()
        public_key = private_key.public_key()
        private_pem = private_key.private_bytes(
            encoding=serialization.Encoding.PEM,
            format=serialization.PrivateFormat.PKCS8,
            encryption_algorithm=serialization.NoEncryption(),
        )
        public_pem = public_key.public_bytes(
            encoding=serialization.Encoding.PEM,
            format=serialization.PublicFormat.SubjectPublicKeyInfo,
        )
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(private_pem)
        public_path.write_bytes(public_pem)
        # Best-effort chmod — some filesystems (WSL/Windows mounts) refuse it.
        with contextlib.suppress(OSError):
            os.chmod(path, stat.S_IRUSR | stat.S_IWUSR)

    raw_pub = public_key.public_bytes(
        encoding=serialization.Encoding.Raw,
        format=serialization.PublicFormat.Raw,
    )
    return SigningKeyPair(
        private_key=private_key,
        public_key=public_key,
        public_key_base64=base64.b64encode(raw_pub).decode("ascii"),
        private_key_path=str(path),
    )


_SIGNATURE_FIELDS = frozenset({"signature", "signer_public_key", "signed_at"})


def _canonicalize(value: Any) -> str:
    """Deterministic JSON serialization. Mirrors the TS canonicalize().

    - Object keys sorted recursively.
    - ``None``-valued keys dropped (parity with TS dropping ``undefined``).
    - Numbers serialized via :func:`json.dumps` (shortest round-trip).
    - Non-finite numbers (NaN, ±Inf) raise — the canonical form is total.
    """
    if value is None:
        return "null"
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, (int, float)):
        if isinstance(value, float) and not math.isfinite(value):
            raise ValueError(f"canonicalize: refusing non-finite number {value}")
        return json.dumps(value)
    if isinstance(value, str):
        return json.dumps(value, ensure_ascii=False)
    if isinstance(value, list):
        return "[" + ",".join(_canonicalize(v) for v in value) + "]"
    if isinstance(value, dict):
        keys = sorted(k for k, v in value.items() if v is not None)
        return (
            "{"
            + ",".join(f"{json.dumps(k)}:{_canonicalize(value[k])}" for k in keys)
            + "}"
        )
    raise TypeError(f"canonicalize: unsupported type {type(value).__name__}")


def _strip_signature_fields(receipt: dict[str, Any]) -> dict[str, Any]:
    return {k: v for k, v in receipt.items() if k not in _SIGNATURE_FIELDS and v is not None}


def sign_receipt(
    receipt: dict[str, Any],
    key_pair: SigningKeyPair,
    *,
    now: datetime | None = None,
) -> dict[str, Any]:
    """Return a new dict with signature, signer_public_key, signed_at populated.

    The input receipt is not mutated. Field names use snake_case to match
    the Python receipt schema; verification in the TS verifier is
    cross-language compatible iff the consumer first applies
    snake↔camel translation (the on-wire receipt format is the
    operator's choice).
    """
    if not _HAS_CRYPTO:
        raise SigningNotInstalled()
    payload = _strip_signature_fields(receipt)
    canonical = _canonicalize(payload).encode("utf-8")
    sig = key_pair.private_key.sign(canonical)
    timestamp = (now or datetime.now(UTC)).isoformat()
    return {
        **receipt,
        "signature": base64.b64encode(sig).decode("ascii"),
        "signer_public_key": key_pair.public_key_base64,
        "signed_at": timestamp,
    }


def verify_receipt(
    receipt: dict[str, Any],
    *,
    trusted_public_key: str | None = None,
) -> VerifyResult:
    """Verify a (possibly signed) receipt — mirrors the TS verifyReceipt().

    Outcomes:
      - ``valid``           — Ed25519 signature matches the canonical payload.
      - ``tampered``        — signed receipt whose signature is no longer valid.
      - ``key-mismatch``    — ``trusted_public_key`` set, receipt signed by someone else.
      - ``legacy-unsigned`` — pre-v0.11 receipt (or unsigned by config).
    """
    signature = receipt.get("signature")
    signer = receipt.get("signer_public_key")
    if not signature or not signer:
        return VerifyResult(
            outcome="legacy-unsigned",
            reason="receipt has no `signature`/`signer_public_key` fields "
            "(pre-v0.11 or unsigned by configuration)",
        )
    if trusted_public_key and trusted_public_key != signer:
        return VerifyResult(
            outcome="key-mismatch",
            signer_public_key=signer,
            reason=f"expected signer public key {trusted_public_key}, "
            f"receipt was signed by {signer}",
        )
    if not _HAS_CRYPTO:
        raise SigningNotInstalled()
    raw_pub = base64.b64decode(signer)
    if len(raw_pub) != 32:
        raise ValueError(f"signer_public_key must be 32 bytes (got {len(raw_pub)})")
    public_key = ed25519.Ed25519PublicKey.from_public_bytes(raw_pub)
    payload = _strip_signature_fields(receipt)
    canonical = _canonicalize(payload).encode("utf-8")
    try:
        public_key.verify(base64.b64decode(signature), canonical)
    except Exception:  # InvalidSignature
        return VerifyResult(
            outcome="tampered",
            signer_public_key=signer,
            reason="Ed25519 signature does not match the canonical payload — "
            "receipt was modified after signing",
        )
    return VerifyResult(
        outcome="valid",
        signer_public_key=signer,
        reason=f"Ed25519 signature verified against canonical payload "
        f"({len(canonical)} bytes)",
    )


__all__ = [
    "SigningKeyPair",
    "SigningNotInstalled",
    "VerifyOutcome",
    "VerifyResult",
    "default_signing_key_path",
    "is_signing_available",
    "load_or_create_signing_key",
    "sign_receipt",
    "verify_receipt",
]
