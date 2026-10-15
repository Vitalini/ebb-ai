import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TaskStore } from "@ebb-ai/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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

describe("tick receipts use the region's grid feed", () => {
  let dir: string;
  let dbPath: string;
  const savedHost = process.env.OLLAMA_HOST;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "ebb-tick-feed-"));
    dbPath = join(dir, "queue.db");
    process.env.OLLAMA_HOST = "http://ollama.test";
    // One fetch stub answers both sides of the tick: the GB Carbon
    // Intensity API (a flat 123 gCO2/kWh curve) and the Ollama chat call.
    vi.stubGlobal("fetch", async (input: string | URL) => {
      const url = String(input);
      if (url.startsWith("https://api.carbonintensity.org.uk/intensity/")) {
        const from = new Date(url.split("/")[4]!).getTime();
        const data = Array.from({ length: 96 }, (_, i) => ({
          from: new Date(from + i * 30 * 60_000).toISOString(),
          to: new Date(from + (i + 1) * 30 * 60_000).toISOString(),
          intensity: { forecast: 123, actual: null },
        }));
        return Response.json({ data });
      }
      if (url === "http://ollama.test/api/chat") {
        return Response.json({
          model: "llama3.2:1b",
          message: { role: "assistant", content: "ok" },
          done: true,
          prompt_eval_count: 5,
          eval_count: 3,
        });
      }
      throw new Error(`unexpected fetch ${url}`);
    });
    const store = new TaskStore({ dbPath });
    store.upsert({
      taskId: "due-ollama-gb",
      status: "scheduled",
      enqueuedAt: new Date(Date.now() - 60_000).toISOString(),
      scheduledFor: new Date(Date.now() - 1_000).toISOString(),
      region: "GB",
      bodyJson: JSON.stringify({
        type: "provider_call",
        provider: "ollama",
        model: "llama3.2:1b",
        prompt: "hi",
      }),
    });
    store.close();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    if (savedHost !== undefined) process.env.OLLAMA_HOST = savedHost;
    else delete process.env.OLLAMA_HOST;
    rmSync(dir, { recursive: true, force: true });
  });

  it("records the live feed's intensity, not the mock curve", async () => {
    const r = await runTickOnce({
      db: dbPath,
      region: "GB",
      envFile: join(dir, "no-env"),
      budgetConfig: join(dir, "no-config"),
    });
    expect(r.message).toContain("1 dispatched");
    const store = new TaskStore({ dbPath });
    const receipt = store.get("due-ollama-gb")?.receipt;
    store.close();
    expect(receipt?.gridSource).toBe("ukCarbonIntensity");
    expect(receipt?.intensityGCo2PerKwh).toBe(123);
  });
});

describe("ebb tick pre-tick step (quota sweep, last_tick_at)", () => {
  let dir: string;
  let db: string;
  const savedOllama = process.env.OLLAMA_HOST;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "ebb-cli-quota-"));
    db = join(dir, "queue.db");
    // An adapter must exist for the tick to run. The seeded tasks use the
    // anthropic provider, which has no adapter here, so even a task the
    // window picker makes due now fails fast without a network call.
    process.env.OLLAMA_HOST = "http://127.0.0.1:9";
  });
  afterEach(() => {
    if (savedOllama !== undefined) process.env.OLLAMA_HOST = savedOllama;
    else delete process.env.OLLAMA_HOST;
    rmSync(dir, { recursive: true, force: true });
  });

  function seed(label: string, prevReset: Date): void {
    const store = new TaskStore({ dbPath: db });
    store.upsert({
      taskId: `quota-${label}`,
      status: "scheduled",
      enqueuedAt: new Date(prevReset.getTime() - 3 * 86_400_000).toISOString(),
      // A far-future window, so the unchanged task is never due in this tick.
      scheduledFor: new Date(Date.now() + 30 * 86_400_000).toISOString(),
      region: "DE",
      bodyJson: JSON.stringify({ type: "provider_call", provider: "anthropic", model: "m", prompt: "p" }),
      deadline: new Date(prevReset.getTime() - 2 * 3_600_000).toISOString(),
      deadlineKind: "quota_reset",
      quotaProvider: label,
    });
    store.close();
  }

  it("re-resolves a passed quota deadline, names a missing label, and records last_tick_at", async () => {
    const prevReset = new Date(Math.floor((Date.now() - 3_600_000) / 60_000) * 60_000);
    const day = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"][prevReset.getUTCDay()];
    const config = join(dir, "config");
    writeFileSync(config, `EBB_QUOTA_RESET_CLAUDE=${day} ${prevReset.toISOString().slice(11, 16)} UTC\n`);
    seed("claude", prevReset);
    seed("codex", prevReset);

    const r = await runTickOnce({ db, envFile: "/nonexistent/ebb/env", budgetConfig: config });
    expect(r.message).toMatch(/quota reset \(claude\) passed for quota-claude/);
    expect(r.message).toMatch(/"codex" is not configured/);

    const store = new TaskStore({ dbPath: db });
    const expected = prevReset.getTime() + 7 * 86_400_000 - 2 * 3_600_000;
    expect(store.get("quota-claude")!.deadline).toBe(new Date(expected).toISOString());
    expect(store.get("quota-codex")!.deadline).toBe(
      new Date(prevReset.getTime() - 2 * 3_600_000).toISOString(),
    );
    expect(store.getMeta("last_tick_at")).toBeDefined();
    store.close();
  });
});

describe("ebb tick notifications", () => {
  let dir: string;
  let dbPath: string;
  const savedHost = process.env.OLLAMA_HOST;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "ebb-tick-notify-"));
    dbPath = join(dir, "queue.db");
    process.env.OLLAMA_HOST = "http://ollama.test";
    vi.stubGlobal("fetch", async (input: string | URL) => {
      const url = String(input);
      if (url === "http://ollama.test/api/chat") {
        return Response.json({
          model: "llama3.2:1b",
          message: { role: "assistant", content: "ok" },
          done: true,
          prompt_eval_count: 5,
          eval_count: 3,
        });
      }
      throw new Error(`unexpected fetch ${url}`);
    });
    const store = new TaskStore({ dbPath });
    const due = (taskId: string, provider: string) =>
      store.upsert({
        taskId,
        status: "scheduled",
        enqueuedAt: new Date(Date.now() - 60_000).toISOString(),
        scheduledFor: new Date(Date.now() - 1_000).toISOString(),
        region: "FR",
        title: `title ${taskId}`,
        bodyJson: JSON.stringify({ type: "provider_call", provider, model: "llama3.2:1b", prompt: "hi" }),
      });
    due("ok-1", "ollama");
    due("ok-2", "ollama");
    // No anthropic adapter is registered, so this one fails fast.
    due("bad-1", "anthropic");
    store.close();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    if (savedHost !== undefined) process.env.OLLAMA_HOST = savedHost;
    else delete process.env.OLLAMA_HOST;
    rmSync(dir, { recursive: true, force: true });
  });

  function run(extra: Partial<Parameters<typeof runTickOnce>[0]> = {}) {
    const calls: Array<{ cmd: string; args: string[] }> = [];
    const result = runTickOnce({
      db: dbPath,
      region: "FR",
      envFile: join(dir, "no-env"),
      budgetConfig: join(dir, "no-config"),
      platform: "linux",
      spawnNotify: (cmd, args) => {
        calls.push({ cmd, args });
      },
      ...extra,
    });
    return { result, calls };
  }

  it("posts one notification per completed or failed task (AE8)", async () => {
    const { result, calls } = run();
    const r = await result;
    expect(r.message.split("\n")[0]).toBe("tick: 3 inspected, 2 dispatched, 1 failed");
    expect(r.exitCode).toBe(1);
    expect(calls).toHaveLength(3);
    expect(calls.every((c) => c.cmd === "notify-send" && c.args[0] === "--")).toBe(true);
    const titles = calls.map((c) => c.args[1]).sort();
    expect(titles).toEqual([
      "ebb-ai: done: title ok-1",
      "ebb-ai: done: title ok-2",
      "ebb-ai: failed: title bad-1",
    ]);
  });

  it("--no-notify posts nothing", async () => {
    const { result, calls } = run({ notify: false });
    await result;
    expect(calls).toHaveLength(0);
  });

  it("EBB_NOTIFY=0 in the config posts nothing", async () => {
    const config = join(dir, "config");
    writeFileSync(config, "EBB_NOTIFY=0\n");
    const { result, calls } = run({ budgetConfig: config });
    await result;
    expect(calls).toHaveLength(0);
  });

  it("a throwing spawner does not change the outcome", async () => {
    const r = await runTickOnce({
      db: dbPath,
      region: "FR",
      envFile: join(dir, "no-env"),
      budgetConfig: join(dir, "no-config"),
      platform: "linux",
      spawnNotify: () => {
        throw new Error("boom");
      },
    });
    expect(r.exitCode).toBe(1);
    expect(r.message).toContain("2 dispatched, 1 failed");
  });
});
