/**
 * Shared cross-language receipt-signing test vectors (audit §0.3).
 *
 * The fixture `test/fixtures/cross-lang-receipt-vectors.json` is the
 * single source of truth for the canonical signing form. It is consumed
 * byte-for-byte by BOTH this suite and
 * `packages/core-py/tests/test_sign_vectors.py` — if either port drifts
 * from the canonical camelCase / ES-number form, one of the two suites
 * goes red.
 *
 * The embedded `privateKeyPem` is a THROWAWAY Ed25519 key generated
 * once for the fixture. It is test-only and protects nothing.
 */
import { createPrivateKey, createPublicKey } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  canonicalReceiptPayload,
  signReceipt,
  verifyReceipt,
  type SigningKeyPair,
} from "../src/sign.js";
import type { CarbonReceipt } from "../src/types.js";

interface Vector {
  description: string;
  legacyV011: boolean;
  privateKeyPem: string;
  receipt: Record<string, unknown>;
  signedAt: string;
  expectedCanonical: string;
  signedReceipt: Record<string, unknown>;
}

const fixture = JSON.parse(
  readFileSync(
    new URL("./fixtures/cross-lang-receipt-vectors.json", import.meta.url),
    "utf8",
  ),
) as { signerPublicKeyBase64: string; vectors: Vector[] };

const SIGNATURE_KEYS = new Set([
  "signature",
  "signerPublicKey",
  "signer_public_key",
  "signedAt",
  "signed_at",
]);

function keyPairFromPem(pem: string, publicKeyBase64: string): SigningKeyPair {
  const privateKey = createPrivateKey({ key: pem, format: "pem" });
  return {
    privateKey,
    publicKey: createPublicKey(privateKey),
    publicKeyBase64,
    privateKeyPath: "<fixture>",
  };
}

/** Tamper a value in a way that survives JSON round-trips. */
function tamper(v: unknown): unknown {
  if (typeof v === "string") return `${v}-tampered`;
  if (typeof v === "number") return v * 2 + 1;
  if (typeof v === "boolean") return !v;
  return "tampered";
}

const snakeToCamel = (k: string): string =>
  k.replace(/_([a-z0-9])/g, (_m, c: string) => c.toUpperCase());
const camelToSnake = (k: string): string =>
  k.replace(/([A-Z])/g, "_$1").toLowerCase();

const rekey = (
  obj: Record<string, unknown>,
  fn: (k: string) => string,
): Record<string, unknown> =>
  Object.fromEntries(Object.entries(obj).map(([k, v]) => [fn(k), v]));

describe("cross-language receipt vectors", () => {
  expect(fixture.vectors.length).toBeGreaterThanOrEqual(4);

  for (const vector of fixture.vectors) {
    describe(vector.description, () => {
      it("canonicalization reproduces expectedCanonical byte-for-byte", () => {
        const got = canonicalReceiptPayload(vector.signedReceipt, {
          excludeSignedAt: vector.legacyV011,
        });
        expect(got).toBe(vector.expectedCanonical);
      });

      it("signedReceipt verifies as valid", () => {
        const res = verifyReceipt(vector.signedReceipt);
        expect(res.outcome).toBe("valid");
        expect(res.signerPublicKey).toBe(fixture.signerPublicKeyBase64);
        if (vector.legacyV011) {
          expect(res.reason).toContain("legacy v0.11 canonical form");
        } else {
          expect(res.reason).not.toContain("legacy");
        }
      });

      it("verifies in the opposite key rendering too", () => {
        const isSnake = Object.keys(vector.signedReceipt).some((k) => k.includes("_"));
        const rendered = rekey(vector.signedReceipt, isSnake ? snakeToCamel : camelToSnake);
        const res = verifyReceipt(rendered);
        expect(res.outcome).toBe("valid");
      });

      it("tampering any covered field flips the outcome to tampered", () => {
        for (const [key, value] of Object.entries(vector.signedReceipt)) {
          if (SIGNATURE_KEYS.has(key)) continue;
          if (value === null) continue; // excluded from the canonical form
          const mutated = { ...vector.signedReceipt, [key]: tamper(value) };
          expect(verifyReceipt(mutated).outcome, `field ${key}`).toBe("tampered");
        }
      });

      if (vector.legacyV011) {
        it("legacy form: signedAt is NOT covered by the signature", () => {
          const mutated = {
            ...vector.signedReceipt,
            signedAt: "1999-01-01T00:00:00.000Z",
          };
          // Documented v0.11 limitation — exactly why v0.12 moved
          // signedAt inside the signed payload.
          expect(verifyReceipt(mutated).outcome).toBe("valid");
        });
      } else {
        it("v0.12 form: tampering signedAt flips to tampered", () => {
          const key = "signedAt" in vector.signedReceipt ? "signedAt" : "signed_at";
          const mutated = {
            ...vector.signedReceipt,
            [key]: "1999-01-01T00:00:00.000Z",
          };
          expect(verifyReceipt(mutated).outcome).toBe("tampered");
        });
      }
    });
  }

  it("signReceipt reproduces the exact fixture signature (Ed25519 is deterministic)", () => {
    for (const vector of fixture.vectors) {
      if (vector.legacyV011) continue; // fixture signature predates signedAt coverage
      // Only timestamps in toISOString() form are reproducible via signReceipt.
      if (new Date(vector.signedAt).toISOString() !== vector.signedAt) continue;
      const kp = keyPairFromPem(vector.privateKeyPem, fixture.signerPublicKeyBase64);
      const signed = signReceipt(
        vector.receipt as unknown as CarbonReceipt,
        kp,
        () => new Date(vector.signedAt),
      );
      expect(signed.signature).toBe(vector.signedReceipt.signature);
      expect(signed.signerPublicKey).toBe(vector.signedReceipt.signerPublicKey);
      expect(signed.signedAt).toBe(vector.signedAt);
    }
  });

  it("the Python-signed snake_case vector verifies as-is AND after camel translation", () => {
    const pyVector = fixture.vectors.find((v) =>
      Object.keys(v.signedReceipt).some((k) => k.includes("_")),
    );
    expect(pyVector).toBeDefined();
    const asIs = verifyReceipt(pyVector!.signedReceipt);
    expect(asIs.outcome).toBe("valid");
    const translated = rekey(pyVector!.signedReceipt, snakeToCamel);
    expect(verifyReceipt(translated).outcome).toBe("valid");
  });
});
