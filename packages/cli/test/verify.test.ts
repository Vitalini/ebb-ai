import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  loadOrCreateSigningKey,
  signReceipt,
  type CarbonReceipt,
} from "@ebb-ai/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { runVerify } from "../src/commands/verify.js";

const baseReceipt: CarbonReceipt = {
  taskId: "cli-verify-1",
  ranAt: "2026-06-01T12:00:00.000Z",
  region: "US-CAL-CISO",
  estimatedCarbonGCo2: 2.0,
  actualCarbonGCo2: 2.1,
  deltaPct: 5,
  model: "claude-sonnet-4-5",
};

describe("runVerify --file", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "ebb-verify-"));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("exit 0 + 'VALID' for a signed receipt", async () => {
    const kp = loadOrCreateSigningKey({ privateKeyPath: join(dir, "k") });
    const signed = signReceipt(baseReceipt, kp);
    const path = join(dir, "ok.json");
    writeFileSync(path, JSON.stringify(signed));

    const res = await runVerify({ file: path });
    expect(res.exitCode).toBe(0);
    expect(res.rendered).toMatch(/VALID/);
    expect(res.payload.outcome).toBe("valid");
  });

  it("exit 1 + 'TAMPERED' when actualCarbonGCo2 is changed", async () => {
    const kp = loadOrCreateSigningKey({ privateKeyPath: join(dir, "k") });
    const signed = signReceipt(baseReceipt, kp);
    const tampered = { ...signed, actualCarbonGCo2: 0.01 };
    const path = join(dir, "bad.json");
    writeFileSync(path, JSON.stringify(tampered));

    const res = await runVerify({ file: path });
    expect(res.exitCode).toBe(1);
    expect(res.payload.outcome).toBe("tampered");
  });

  it("exit 2 + 'LEGACY UNSIGNED' for a pre-v0.11 receipt", async () => {
    const path = join(dir, "legacy.json");
    writeFileSync(path, JSON.stringify(baseReceipt));

    const res = await runVerify({ file: path });
    expect(res.exitCode).toBe(2);
    expect(res.payload.outcome).toBe("legacy-unsigned");
  });

  it("exit 3 + 'KEY MISMATCH' when --trusted-public-key disagrees", async () => {
    const kp = loadOrCreateSigningKey({ privateKeyPath: join(dir, "k") });
    const signed = signReceipt(baseReceipt, kp);
    const path = join(dir, "ok.json");
    writeFileSync(path, JSON.stringify(signed));

    const fake = Buffer.alloc(32, 9).toString("base64");
    const res = await runVerify({ file: path, trustedPublicKey: fake });
    expect(res.exitCode).toBe(3);
    expect(res.payload.outcome).toBe("key-mismatch");
  });

  it("exit 4 for a missing file", async () => {
    const res = await runVerify({ file: join(dir, "nope.json") });
    expect(res.exitCode).toBe(4);
    expect(res.payload.outcome).toBe("not-found");
  });

  it("accepts wrapper {taskId, result, receipt} shape (writeOutputFile format)", async () => {
    const kp = loadOrCreateSigningKey({ privateKeyPath: join(dir, "k") });
    const signed = signReceipt(baseReceipt, kp);
    const wrapper = { taskId: signed.taskId, result: "x", receipt: signed };
    const path = join(dir, "wrap.json");
    writeFileSync(path, JSON.stringify(wrapper));

    const res = await runVerify({ file: path });
    expect(res.exitCode).toBe(0);
    expect(res.payload.outcome).toBe("valid");
  });

  it("--json emits structured payload", async () => {
    const kp = loadOrCreateSigningKey({ privateKeyPath: join(dir, "k") });
    const signed = signReceipt(baseReceipt, kp);
    const path = join(dir, "ok.json");
    writeFileSync(path, JSON.stringify(signed));

    const res = await runVerify({ file: path, json: true });
    expect(JSON.parse(res.rendered).outcome).toBe("valid");
  });
});
