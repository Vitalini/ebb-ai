import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TaskStore } from "@ebb-ai/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  missingProviderKeysForPending,
  runTickOnce,
} from "../src/commands/tick.js";

describe("ebb tick", () => {
  const saved = {
    a: process.env.ANTHROPIC_API_KEY,
    o: process.env.OPENAI_API_KEY,
    g: process.env.GEMINI_API_KEY,
    gg: process.env.GOOGLE_API_KEY,
    oh: process.env.OLLAMA_HOST,
  };

  beforeEach(() => {
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.OPENAI_API_KEY;
    delete process.env.GEMINI_API_KEY;
    delete process.env.GOOGLE_API_KEY;
    delete process.env.OLLAMA_HOST;
  });

  afterEach(() => {
    for (const [k, v] of [
      ["ANTHROPIC_API_KEY", saved.a],
      ["OPENAI_API_KEY", saved.o],
      ["GEMINI_API_KEY", saved.g],
      ["GOOGLE_API_KEY", saved.gg],
      ["OLLAMA_HOST", saved.oh],
    ] as const) {
      if (v !== undefined) process.env[k] = v;
      else delete process.env[k];
    }
  });

  it("exits 0 with a clear message when no adapters are configured", async () => {
    const r = await runTickOnce({ db: ":memory:", envFile: "/nonexistent/ebb/env" });
    expect(r.exitCode).toBe(0);
    expect(r.message).toMatch(/no adapters configured/i);
  });
});

describe("missing-provider-key warning", () => {
  let dir: string;
  let dbPath: string;
  const saved = {
    a: process.env.ANTHROPIC_API_KEY,
    o: process.env.OPENAI_API_KEY,
    g: process.env.GEMINI_API_KEY,
    gg: process.env.GOOGLE_API_KEY,
    oh: process.env.OLLAMA_HOST,
  };

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "ebb-tick-"));
    dbPath = join(dir, "queue.db");
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.OPENAI_API_KEY;
    delete process.env.GEMINI_API_KEY;
    delete process.env.GOOGLE_API_KEY;
    delete process.env.OLLAMA_HOST;
    const store = new TaskStore({ dbPath });
    store.upsert({
      taskId: "pending-anthropic",
      status: "scheduled",
      enqueuedAt: new Date().toISOString(),
      scheduledFor: new Date(Date.now() + 3600_000).toISOString(),
      region: "US-CAL-CISO",
      bodyJson: JSON.stringify({
        type: "provider_call",
        provider: "anthropic",
        model: "claude-sonnet-4-5",
        prompt: "hi",
      }),
    });
    store.close();
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    for (const [k, v] of [
      ["ANTHROPIC_API_KEY", saved.a],
      ["OPENAI_API_KEY", saved.o],
      ["GEMINI_API_KEY", saved.g],
      ["GOOGLE_API_KEY", saved.gg],
      ["OLLAMA_HOST", saved.oh],
    ] as const) {
      if (v !== undefined) process.env[k] = v;
      else delete process.env[k];
    }
  });

  it("detects the missing key for a pending provider task", () => {
    expect(missingProviderKeysForPending(dbPath)).toEqual(["ANTHROPIC_API_KEY"]);
  });

  it("does not flag the key once it is set", () => {
    process.env.ANTHROPIC_API_KEY = "sk-test";
    expect(missingProviderKeysForPending(dbPath)).toEqual([]);
  });

  it("tick with no keys names the missing key in its message", async () => {
    const r = await runTickOnce({ db: dbPath, envFile: join(dir, "no-env") });
    expect(r.exitCode).toBe(0);
    expect(r.message).toContain("ANTHROPIC_API_KEY");
    expect(r.message).toMatch(/config\/ebb\/env/);
  });

  it("returns [] for a missing/unreadable db", () => {
    expect(missingProviderKeysForPending(join(dir, "nope.db"))).toEqual([]);
  });
});
