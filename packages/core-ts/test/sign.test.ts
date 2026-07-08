import { sign as nodeSign } from "node:crypto";
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  canonicalReceiptPayload,
  canonicalize,
  defaultSigningKeyPath,
  loadOrCreateSigningKey,
  signReceipt,
  verifyReceipt,
} from "../src/sign.js";
import type { CarbonReceipt } from "../src/types.js";

const baseReceipt: CarbonReceipt = {
  taskId: "t-1",
  ranAt: "2026-06-01T12:00:00.000Z",
  region: "US-CAL-CISO",
  estimatedCarbonGCo2: 3.2,
  actualCarbonGCo2: 3.4,
  deltaPct: 6.3,
  provider: "anthropic",
  model: "claude-sonnet-4-5",
  durationMs: 1234,
  totalTokens: 1000,
};

describe("canonicalize", () => {
  it("sorts object keys recursively and is deterministic", () => {
    const a = canonicalize({ b: 1, a: 2, c: { y: 3, x: 4 } });
    const b = canonicalize({ a: 2, c: { x: 4, y: 3 }, b: 1 });
    expect(a).toBe(b);
    expect(a).toBe('{"a":2,"b":1,"c":{"x":4,"y":3}}');
  });

  it("drops `undefined`-valued keys but keeps `null`", () => {
    const got = canonicalize({ a: undefined, b: null, c: 0 });
    expect(got).toBe('{"b":null,"c":0}');
  });

  it("preserves array order", () => {
    expect(canonicalize([3, 1, 2])).toBe("[3,1,2]");
  });

  it("rejects non-finite numbers", () => {
    expect(() => canonicalize(Number.NaN)).toThrow(/non-finite/);
    expect(() => canonicalize({ x: Infinity })).toThrow(/non-finite/);
  });

  it("emits ECMAScript / RFC 8785 (JCS) number formatting", () => {
    // JSON.stringify is natively JCS-shaped; these pins are the contract
    // the Python port's es_number() must match byte-for-byte.
    expect(canonicalize(2.0)).toBe("2");
    expect(canonicalize(0.1)).toBe("0.1");
    expect(canonicalize(1e-7)).toBe("1e-7");
    expect(canonicalize(1e21)).toBe("1e+21");
    expect(canonicalize(-0.5)).toBe("-0.5");
    expect(canonicalize(1e20)).toBe("100000000000000000000");
    expect(canonicalize(0.000001)).toBe("0.000001");
    expect(canonicalize(9007199254740991)).toBe("9007199254740991");
    // 1234567890123456789 is not representable — rounds like an IEEE double.
    expect(canonicalize(1234567890123456789)).toBe("1234567890123456800");
    expect(canonicalize(-0)).toBe("0");
  });
});

describe("loadOrCreateSigningKey", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "ebb-sign-"));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("generates a keypair on first call and reuses it after", () => {
    const path = join(dir, "signing.key");
    const a = loadOrCreateSigningKey({ privateKeyPath: path });
    const b = loadOrCreateSigningKey({ privateKeyPath: path });
    expect(a.publicKeyBase64).toBe(b.publicKeyBase64);
  });

  it("exposes a 32-byte (base64-encoded) raw Ed25519 public key", () => {
    const path = join(dir, "signing.key");
    const kp = loadOrCreateSigningKey({ privateKeyPath: path });
    expect(Buffer.from(kp.publicKeyBase64, "base64")).toHaveLength(32);
  });

  it("defaults to ~/.ebb-ai/signing.key", () => {
    expect(defaultSigningKeyPath()).toMatch(/[/\\]\.ebb-ai[/\\]signing\.key$/);
  });
});

describe("signReceipt + verifyReceipt", () => {
  let dir: string;
  let keyPath: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "ebb-sign-"));
    keyPath = join(dir, "signing.key");
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("round-trips: signed receipt verifies as valid", () => {
    const kp = loadOrCreateSigningKey({ privateKeyPath: keyPath });
    const signed = signReceipt(baseReceipt, kp);
    expect(signed.signature).toMatch(/^[A-Za-z0-9+/=]+$/);
    expect(signed.signerPublicKey).toBe(kp.publicKeyBase64);
    expect(signed.signedAt).toMatch(/^20\d\d-/);

    const result = verifyReceipt(signed);
    expect(result.outcome).toBe("valid");
    expect(result.signerPublicKey).toBe(kp.publicKeyBase64);
  });

  it("detects tampered actualCarbonGCo2 as 'tampered'", () => {
    const kp = loadOrCreateSigningKey({ privateKeyPath: keyPath });
    const signed = signReceipt(baseReceipt, kp);
    const tampered: CarbonReceipt = { ...signed, actualCarbonGCo2: 0.1 };
    const result = verifyReceipt(tampered);
    expect(result.outcome).toBe("tampered");
  });

  it("detects tampered prompt", () => {
    const kp = loadOrCreateSigningKey({ privateKeyPath: keyPath });
    const withPrompt: CarbonReceipt = { ...baseReceipt, prompt: "hello" };
    const signed = signReceipt(withPrompt, kp);
    const tampered: CarbonReceipt = { ...signed, prompt: "goodbye" };
    expect(verifyReceipt(tampered).outcome).toBe("tampered");
  });

  it("a receipt with no signature is 'legacy-unsigned'", () => {
    const result = verifyReceipt(baseReceipt);
    expect(result.outcome).toBe("legacy-unsigned");
  });

  it("trustedPublicKey mismatch flags as 'key-mismatch' without exposing the signature check", () => {
    const kp = loadOrCreateSigningKey({ privateKeyPath: keyPath });
    const signed = signReceipt(baseReceipt, kp);
    const fake = Buffer.alloc(32, 7).toString("base64");
    const result = verifyReceipt(signed, { trustedPublicKey: fake });
    expect(result.outcome).toBe("key-mismatch");
  });

  it("two keypairs in different paths produce different signatures", () => {
    const a = loadOrCreateSigningKey({ privateKeyPath: keyPath });
    const b = loadOrCreateSigningKey({ privateKeyPath: join(dir, "other.key") });
    expect(a.publicKeyBase64).not.toBe(b.publicKeyBase64);
    const sa = signReceipt(baseReceipt, a).signature;
    const sb = signReceipt(baseReceipt, b).signature;
    expect(sa).not.toBe(sb);
  });

  it("verification is independent of key field order on the receipt", () => {
    const kp = loadOrCreateSigningKey({ privateKeyPath: keyPath });
    const signed = signReceipt(baseReceipt, kp);
    // Reconstruct the receipt with keys in a different order — verify still passes.
    const reordered: CarbonReceipt = JSON.parse(
      JSON.stringify(Object.fromEntries(Object.entries(signed).reverse())),
    );
    expect(verifyReceipt(reordered).outcome).toBe("valid");
  });

  it("rejects a public key that is not 32 bytes", () => {
    const bad: CarbonReceipt = {
      ...baseReceipt,
      signature: "AAAA",
      signerPublicKey: Buffer.alloc(16, 0).toString("base64"),
      signedAt: new Date().toISOString(),
    };
    expect(() => verifyReceipt(bad)).toThrow(/32 bytes/);
  });

  it("signedAt is covered by the signature (v0.12): tampering it → tampered", () => {
    const kp = loadOrCreateSigningKey({ privateKeyPath: keyPath });
    const signed = signReceipt(baseReceipt, kp);
    expect(canonicalReceiptPayload(signed as unknown as Record<string, unknown>)).toContain(
      `"signedAt":"${signed.signedAt}"`,
    );
    const backdated: CarbonReceipt = { ...signed, signedAt: "1999-01-01T00:00:00.000Z" };
    expect(verifyReceipt(backdated).outcome).toBe("tampered");
  });
});

describe("legacy v0.11 verification fallback", () => {
  let dir: string;
  let keyPath: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "ebb-sign-"));
    keyPath = join(dir, "signing.key");
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("camelCase receipt signed WITHOUT signedAt (v0.11 TS form) verifies with the legacy note", () => {
    const kp = loadOrCreateSigningKey({ privateKeyPath: keyPath });
    const canonical = canonicalReceiptPayload(
      baseReceipt as unknown as Record<string, unknown>,
      { excludeSignedAt: true },
    );
    const sig = nodeSign(null, Buffer.from(canonical, "utf8"), kp.privateKey);
    const legacy: CarbonReceipt = {
      ...baseReceipt,
      signature: sig.toString("base64"),
      signerPublicKey: kp.publicKeyBase64,
      signedAt: "2026-06-01T13:00:00.000Z",
    };
    const res = verifyReceipt(legacy);
    expect(res.outcome).toBe("valid");
    expect(res.reason).toContain("legacy v0.11 canonical form");
  });

  it("python ≤v0.11 snake_case-signed receipt verifies via the raw-rendering fallback", () => {
    // Old Python signed its snake_case dict directly — no key
    // normalization, no signed_at in the payload.
    const kp = loadOrCreateSigningKey({ privateKeyPath: keyPath });
    const snakeClaims = {
      task_id: "py-legacy-1",
      ran_at: "2026-05-01T00:00:00+00:00",
      region: "DE",
      estimated_carbon_g_co2: 3.2,
      actual_carbon_g_co2: 3.4,
      delta_pct: 6.3,
      model: "claude-haiku-4-5",
    };
    const canonical = canonicalize(snakeClaims); // raw keys, exactly like old sign.py
    const sig = nodeSign(null, Buffer.from(canonical, "utf8"), kp.privateKey);
    const legacy = {
      ...snakeClaims,
      signature: sig.toString("base64"),
      signer_public_key: kp.publicKeyBase64,
      signed_at: "2026-05-01T00:00:01+00:00",
    };
    const res = verifyReceipt(legacy);
    expect(res.outcome).toBe("valid");
    expect(res.reason).toContain("legacy v0.11 canonical form");
  });

  it("a receipt failing every canonical form is tampered", () => {
    const kp = loadOrCreateSigningKey({ privateKeyPath: keyPath });
    const signed = signReceipt(baseReceipt, kp);
    const mangled: CarbonReceipt = { ...signed, region: "SE" };
    expect(verifyReceipt(mangled).outcome).toBe("tampered");
  });
});

describe("cross-rendering verification (audit §0.3)", () => {
  let dir: string;
  let keyPath: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "ebb-sign-"));
    keyPath = join(dir, "signing.key");
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("a Python-shaped snake_case receipt (v0.12) verifies as-is", () => {
    const kp = loadOrCreateSigningKey({ privateKeyPath: keyPath });
    // Emulate sign_receipt(): snake dict in, signature over the ONE
    // camelCase canonical form, floats that json.dumps would render
    // differently (0.6, 2.0).
    const snake = {
      task_id: "py-1",
      ran_at: "2026-06-01T12:00:00+00:00",
      region: "SE",
      estimated_carbon_g_co2: 0.6,
      actual_carbon_g_co2: 2.0,
      delta_pct: 233.3,
    } as unknown as CarbonReceipt;
    const signed = signReceipt(snake, kp) as unknown as Record<string, unknown>;
    expect(verifyReceipt(signed).outcome).toBe("valid");

    // The equivalent camelCase rendering carries the same signature.
    const camel = {
      taskId: "py-1",
      ranAt: "2026-06-01T12:00:00+00:00",
      region: "SE",
      estimatedCarbonGCo2: 0.6,
      actualCarbonGCo2: 2.0,
      deltaPct: 233.3,
      signature: signed.signature,
      signerPublicKey: signed.signerPublicKey,
      signedAt: signed.signedAt,
    };
    expect(verifyReceipt(camel).outcome).toBe("valid");
  });

  it("null-valued fields are excluded from the canonical form (Python None parity)", () => {
    const kp = loadOrCreateSigningKey({ privateKeyPath: keyPath });
    const signed = signReceipt(baseReceipt, kp);
    // A JSON round-trip through Python's asdict() adds explicit nulls.
    const withNulls = { ...signed, prompt: null, provider_extra: null };
    expect(verifyReceipt(withNulls).outcome).toBe("valid");
  });
});

describe("file lifecycle", () => {
  it("creates the parent directory and writes the public key alongside", () => {
    const dir = mkdtempSync(join(tmpdir(), "ebb-sign-"));
    try {
      const keyPath = join(dir, "nested", "signing.key");
      const kp = loadOrCreateSigningKey({ privateKeyPath: keyPath });
      expect(kp.privateKeyPath).toBe(keyPath);
      // Pre-existing key file should be reused.
      const again = loadOrCreateSigningKey({ privateKeyPath: keyPath });
      expect(again.publicKeyBase64).toBe(kp.publicKeyBase64);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("writes both key files via temp+rename with no temp leftovers", () => {
    const dir = mkdtempSync(join(tmpdir(), "ebb-sign-"));
    try {
      const keyPath = join(dir, "signing.key");
      loadOrCreateSigningKey({ privateKeyPath: keyPath });
      expect(readdirSync(dir).sort()).toEqual(["signing.key", "signing.key.pub"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("a corrupted key file fails fast (does not silently regenerate)", () => {
    const dir = mkdtempSync(join(tmpdir(), "ebb-sign-"));
    try {
      const keyPath = join(dir, "signing.key");
      writeFileSync(keyPath, "this is not a PEM");
      expect(() => loadOrCreateSigningKey({ privateKeyPath: keyPath })).toThrow();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
