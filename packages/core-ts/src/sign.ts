/**
 * Ed25519 receipt signing (v0.11+).
 *
 * Every dispatched task ships a `CarbonReceipt`. Starting in v0.11 the
 * scheduler signs each receipt with a per-installation Ed25519 keypair
 * so any consumer can verify, offline and asynchronously, that:
 *
 *   1. The receipt was produced by an `ebb-ai` installation holding
 *      the matching private key (cryptographic origin authentication).
 *   2. None of the receipt's fields have been tampered with since the
 *      moment of signing (integrity).
 *
 * Key lifecycle is local-first by design:
 *
 *   - Keys live at `~/.ebb-ai/signing.key` (private, 0600) +
 *     `signing.key.pub` (public, 0644).
 *   - The pair is generated lazily on the first call to
 *     `loadOrCreateSigningKey()`. There is no opt-in flow — the goal
 *     is that every receipt is signable by default.
 *   - The keys are NEVER sent anywhere by ebb-ai itself. Verification
 *     consumers bundle the receipt's `signerPublicKey` along with the
 *     receipt; downstream ESG-export pipelines can pin the key on
 *     first sight.
 *
 * Canonical-JSON serialization is a tiny, deterministic stringifier
 * (`canonicalize()`) — recursive key sort, no insignificant whitespace,
 * stable number formatting. It is inline (no `json-canonicalize` dep)
 * because the receipt shape is small and we control both sides.
 *
 * Node ships Ed25519 in the `crypto` stdlib (since v16); there are no
 * native deps.
 */

import {
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  KeyObject,
  sign as nodeSign,
  verify as nodeVerify,
} from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

import type { CarbonReceipt } from "./types.js";

/** Override the keypair location (mainly for tests). */
export interface SigningKeyOptions {
  /** Absolute path to the private key (PEM). Defaults to `~/.ebb-ai/signing.key`. */
  privateKeyPath?: string;
}

export interface SigningKeyPair {
  privateKey: KeyObject;
  publicKey: KeyObject;
  /** Base64-encoded raw 32-byte public key bytes. Suitable for embedding on a receipt. */
  publicKeyBase64: string;
  /** Filesystem path the private key lives at. */
  privateKeyPath: string;
}

/** Default location of the local signing private key. */
export function defaultSigningKeyPath(): string {
  return join(homedir(), ".ebb-ai", "signing.key");
}

/**
 * Load the local signing keypair, generating + persisting one on first
 * call. Idempotent and safe under concurrent access (file write is
 * atomic via rename — single writer wins, both readers converge).
 */
export function loadOrCreateSigningKey(
  opts: SigningKeyOptions = {},
): SigningKeyPair {
  const privateKeyPath = opts.privateKeyPath ?? defaultSigningKeyPath();
  const publicKeyPath = `${privateKeyPath}.pub`;

  if (existsSync(privateKeyPath)) {
    const privatePem = readFileSync(privateKeyPath, "utf8");
    const privateKey = createPrivateKey({ key: privatePem, format: "pem" });
    const publicKey = createPublicKey(privateKey);
    return {
      privateKey,
      publicKey,
      publicKeyBase64: rawPublicKeyBase64(publicKey),
      privateKeyPath,
    };
  }

  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const privatePem = privateKey.export({ type: "pkcs8", format: "pem" }) as string;
  const publicPem = publicKey.export({ type: "spki", format: "pem" }) as string;

  mkdirSync(dirname(privateKeyPath), { recursive: true });
  writeFileSync(privateKeyPath, privatePem, { mode: 0o600 });
  writeFileSync(publicKeyPath, publicPem, { mode: 0o644 });
  // Defensive re-chmod in case umask interfered.
  try { chmodSync(privateKeyPath, 0o600); } catch { /* best-effort */ }

  return {
    privateKey,
    publicKey,
    publicKeyBase64: rawPublicKeyBase64(publicKey),
    privateKeyPath,
  };
}

/**
 * Deterministic JSON canonicalization. Recursively sorts object keys;
 * stringifies numbers via `JSON.stringify` (which already produces the
 * shortest round-trip representation for finite floats); rejects
 * non-finite numbers and `undefined` so the canonical form is total.
 */
export function canonicalize(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new Error(`canonicalize: refusing to serialize non-finite number ${value}`);
    }
    return JSON.stringify(value);
  }
  if (typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map(canonicalize).join(",")}]`;
  }
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj).filter((k) => obj[k] !== undefined).sort();
    const parts = keys.map((k) => `${JSON.stringify(k)}:${canonicalize(obj[k])}`);
    return `{${parts.join(",")}}`;
  }
  throw new Error(`canonicalize: unsupported value of type ${typeof value}`);
}

/** Fields excluded from the signed payload — they are the signature itself. */
const SIGNATURE_FIELDS = new Set(["signature", "signerPublicKey", "signedAt"]);

/** Strip the three signature fields so we sign over the receipt's claims, not the proof. */
function stripSignatureFields(receipt: CarbonReceipt): Omit<CarbonReceipt, "signature" | "signerPublicKey" | "signedAt"> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(receipt)) {
    if (SIGNATURE_FIELDS.has(k)) continue;
    if (v === undefined) continue;
    out[k] = v;
  }
  return out as Omit<CarbonReceipt, "signature" | "signerPublicKey" | "signedAt">;
}

/**
 * Sign a receipt in-place-style: returns a new receipt with the three
 * signature fields populated. The original receipt is not mutated.
 */
export function signReceipt(
  receipt: CarbonReceipt,
  keyPair: SigningKeyPair,
  now: () => Date = () => new Date(),
): CarbonReceipt {
  const payload = stripSignatureFields(receipt);
  const canonical = canonicalize(payload);
  const sig = nodeSign(null, Buffer.from(canonical, "utf8"), keyPair.privateKey);
  return {
    ...receipt,
    signature: sig.toString("base64"),
    signerPublicKey: keyPair.publicKeyBase64,
    signedAt: now().toISOString(),
  };
}

export type VerifyOutcome = "valid" | "tampered" | "legacy-unsigned" | "key-mismatch";

export interface VerifyResult {
  outcome: VerifyOutcome;
  /** Public key bytes that signed the receipt (base64). undefined for legacy-unsigned. */
  signerPublicKey?: string;
  /** Reason text suitable for CLI / API surfacing. */
  reason: string;
}

/**
 * Verify a (possibly signed) receipt.
 *
 *   - `valid`           — signature matches the canonical payload.
 *   - `tampered`        — receipt is signed but the signature does not
 *                         match the canonical payload of its other fields.
 *   - `key-mismatch`    — caller supplied a `trustedPublicKey` that
 *                         differs from the one bundled on the receipt.
 *   - `legacy-unsigned` — pre-v0.11 receipt (no signature). The
 *                         consumer must decide whether to accept it.
 */
export function verifyReceipt(
  receipt: CarbonReceipt,
  opts: { trustedPublicKey?: string } = {},
): VerifyResult {
  const { signature, signerPublicKey } = receipt;
  if (!signature || !signerPublicKey) {
    return {
      outcome: "legacy-unsigned",
      reason: "receipt has no `signature` / `signerPublicKey` fields (pre-v0.11 or unsigned by configuration)",
    };
  }
  if (opts.trustedPublicKey && opts.trustedPublicKey !== signerPublicKey) {
    return {
      outcome: "key-mismatch",
      signerPublicKey,
      reason: `expected signer public key ${opts.trustedPublicKey}, receipt was signed by ${signerPublicKey}`,
    };
  }
  const publicKey = publicKeyFromBase64Raw(signerPublicKey);
  const payload = stripSignatureFields(receipt);
  const canonical = canonicalize(payload);
  const ok = nodeVerify(
    null,
    Buffer.from(canonical, "utf8"),
    publicKey,
    Buffer.from(signature, "base64"),
  );
  if (ok) {
    return {
      outcome: "valid",
      signerPublicKey,
      reason: `Ed25519 signature verified against canonical payload (${canonical.length} bytes)`,
    };
  }
  return {
    outcome: "tampered",
    signerPublicKey,
    reason: "Ed25519 signature does not match the canonical payload — receipt was modified after signing",
  };
}

// --------------------------------------------------------------------------- //
// Helpers

function rawPublicKeyBase64(publicKey: KeyObject): string {
  // Node 16+ exposes a 'raw' jwk-ish format via the JWK export.
  const jwk = publicKey.export({ format: "jwk" }) as { x?: string };
  if (!jwk.x) {
    throw new Error("loadOrCreateSigningKey: failed to extract raw Ed25519 public key bytes");
  }
  // JWK encodes `x` as base64url; normalize to base64 so the receipt is
  // self-consistent with `Buffer.from(sig, "base64")` on the verify side.
  return Buffer.from(jwk.x, "base64url").toString("base64");
}

function publicKeyFromBase64Raw(b64: string): KeyObject {
  const raw = Buffer.from(b64, "base64");
  if (raw.length !== 32) {
    throw new Error(`verifyReceipt: signerPublicKey must be 32 bytes (got ${raw.length})`);
  }
  return createPublicKey({
    key: { kty: "OKP", crv: "Ed25519", x: raw.toString("base64url") },
    format: "jwk",
  });
}
