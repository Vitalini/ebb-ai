/**
 * End to end: `runTickOnce` finds a fake `claude` on the injected PATH and
 * dispatches through it. Hermetic HOME (test setup), temp ledger, no network.
 */
import { cpSync, existsSync, mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { TaskStore } from "@tidegap/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runTickOnce, type TickCommandOptions } from "../src/commands/tick.js";

const FIXTURE = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "fake-claude");
const VARS = [
  "ANTHROPIC_API_KEY",
  "OPENAI_API_KEY",
  "GEMINI_API_KEY",
  "GOOGLE_API_KEY",
  "OLLAMA_HOST",
  "TIDEGAP_CLAUDE_BIN",
  "TIDEGAP_CLAUDE_CODE",
  "TIDEGAP_CLAUDE_CODE_MAX_BUDGET_USD",
  "FAKE_CLAUDE_MODE",
  "FAKE_CLAUDE_LOG",
] as const;

let root: string;
let dbPath: string;
let log: string;
const saved = new Map<string, string | undefined>();

beforeEach(() => {
  for (const k of VARS) {
    saved.set(k, process.env[k]);
    delete process.env[k];
  }
  root = realpathSync(mkdtempSync(join(tmpdir(), "tidegap-tick-cc-")));
  dbPath = join(root, "queue.db");
  log = join(root, "log");
  // The fake and its canned replies, as one directory on the injected PATH.
  cpSync(FIXTURE, join(root, "bin"), { recursive: true });
  // The adapter hands its child this process's environment (minus the API key).
  process.env.FAKE_CLAUDE_LOG = log;
});

afterEach(() => {
  for (const [k, v] of saved) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  saved.clear();
  rmSync(root, { recursive: true, force: true });
});

function tickOpts(): TickCommandOptions {
  return {
    db: dbPath,
    envFile: join(root, "no-env"),
    notify: false,
    claudeLookup: {
      path: join(root, "bin"),
      home: join(root, "home"),
      platform: "linux",
      isExecutable: (p) => p.startsWith(root) && existsSync(p),
      loginShell: () => undefined,
    },
  };
}

function queue(taskId: string, provider: string, model: string, dueNow = true): void {
  const store = new TaskStore({ dbPath });
  store.upsert({
    taskId,
    status: "scheduled",
    enqueuedAt: new Date(Date.now() - 60_000).toISOString(),
    scheduledFor: new Date(Date.now() + (dueNow ? -1_000 : 3_600_000)).toISOString(),
    region: "US-CAL-CISO",
    bodyJson: JSON.stringify({ type: "provider_call", provider, model, prompt: "Reply OK" }),
  });
  store.close();
}

function row(taskId: string) {
  const store = new TaskStore({ dbPath });
  try {
    return store.get(taskId);
  } finally {
    store.close();
  }
}

const argv = (): string[] => readFileSync(join(log, "argv"), "utf8").split("\n").slice(0, -1);

describe("tidegap tick with Claude Code", () => {
  it("completes a claude-code task with a claude-code receipt", async () => {
    queue("t-cc", "claude-code", "default");
    const r = await runTickOnce(tickOpts());
    expect(r.message).toContain("1 dispatched, 0 failed");
    expect(r.exitCode).toBe(0);
    const rec = row("t-cc");
    expect(rec?.status).toBe("completed");
    expect(rec?.receipt?.provider).toBe("claude-code");
    expect(rec?.receipt?.model).toBe("claude-haiku-5-5");
    expect(rec?.receipt?.totalTokens).toBe(2056);
    expect(argv()).not.toContain("--model");
  });

  it("runs an anthropic task through Claude Code when there is no key", async () => {
    queue("t-an", "anthropic", "claude-sonnet-5");
    const r = await runTickOnce(tickOpts());
    expect(r.message).toContain("1 dispatched");
    expect(row("t-an")?.status).toBe("completed");
    expect(row("t-an")?.receipt?.provider).toBe("claude-code");
    const args = argv();
    expect(args.slice(args.indexOf("--model"), args.indexOf("--model") + 2)).toEqual(["--model", "claude-sonnet-5"]);
  });

  it("fails a logged-out run once and does not re-dispatch it", async () => {
    process.env.FAKE_CLAUDE_MODE = "logged-out";
    queue("t-out", "claude-code", "haiku");
    const r = await runTickOnce(tickOpts());
    expect(r.exitCode).toBe(1);
    expect(r.message).toContain("0 dispatched, 1 failed");
    expect(row("t-out")?.status).toBe("failed");
    expect(row("t-out")?.error).toContain("Not logged in");

    rmSync(log, { recursive: true, force: true });
    const again = await runTickOnce(tickOpts());
    expect(again.message).toContain("0 dispatched, 0 failed");
    expect(existsSync(log)).toBe(false);
  });

  it("fails a keyless openai task and still names its key", async () => {
    queue("t-oa", "openai", "gpt-6-sol");
    const r = await runTickOnce(tickOpts());
    expect(row("t-oa")?.status).toBe("failed");
    expect(row("t-oa")?.error).toContain("no adapter configured");
    expect(r.message).toContain("OPENAI_API_KEY");
  });

  it("does not warn about ANTHROPIC_API_KEY when Claude Code serves anthropic", async () => {
    queue("t-later", "anthropic", "claude-sonnet-5", false);
    const r = await runTickOnce(tickOpts());
    expect(r.message).not.toContain("ANTHROPIC_API_KEY");
    expect(r.message).not.toMatch(/no adapters configured/);
  });

  it("warns about an invalid budget cap and uses 1", async () => {
    process.env.TIDEGAP_CLAUDE_CODE_MAX_BUDGET_USD = "lots";
    queue("t-b", "claude-code", "default");
    const r = await runTickOnce(tickOpts());
    expect(r.message).toContain("TIDEGAP_CLAUDE_CODE_MAX_BUDGET_USD");
    const args = argv();
    expect(args[args.indexOf("--max-budget-usd") + 1]).toBe("1");
  });
});
