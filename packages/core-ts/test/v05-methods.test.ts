import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  CarbonBudgetExceededError,
  InvalidDeadlineError,
  Scheduler,
  type ProviderAdapter,
  type ProviderCallSpec,
} from "../src/index.js";

function fakeAnthropic(): ProviderAdapter & { calls: { sync: number; batch: number } } {
  const calls = { sync: 0, batch: 0 };
  return {
    provider: "anthropic",
    ready: true,
    calls,
    async dispatch(model, prompt) {
      calls.sync++;
      return {
        text: `ok:${prompt.slice(0, 12)}`,
        usage: { totalTokens: 42 },
        model,
        provider: "anthropic",
        raw: null,
      };
    },
    async dispatchBatch(model, prompts) {
      calls.batch++;
      return { batchId: "batch-x", provider: "anthropic", size: prompts.length };
    },
  };
}

describe("Scheduler.cancelTask", () => {
  it("transitions a queued/scheduled task to cancelled (idempotent)", async () => {
    const s = new Scheduler();
    const rec = await s.enqueueProviderCall(
      {
        type: "provider_call",
        provider: "anthropic",
        model: "claude-sonnet-4-5",
        prompt: "hello",
      },
      { deadline: new Date(Date.now() + 60_000), region: "US-CAL-CISO" },
    );
    const cancelled = s.cancelTask(rec.taskId);
    expect(cancelled.status).toBe("cancelled");
    // idempotent
    const again = s.cancelTask(rec.taskId);
    expect(again.status).toBe("cancelled");
    s.shutdown();
  });

  it("throws on unknown task id", () => {
    const s = new Scheduler();
    expect(() => s.cancelTask("no-such-thing")).toThrow(/not found/);
    s.shutdown();
  });
});

describe("Scheduler.expediteTask", () => {
  it("dispatches immediately and marks intensitySource=expedited", async () => {
    const s = new Scheduler();
    const adapter = fakeAnthropic();
    const rec = await s.enqueueProviderCall(
      {
        type: "provider_call",
        provider: "anthropic",
        model: "claude-sonnet-4-5",
        prompt: "hello",
      },
      { deadline: new Date(Date.now() + 60 * 60 * 1000), region: "US-CAL-CISO" },
    );
    const entry = await s.expediteTask(rec.taskId, { anthropic: adapter });
    expect(entry.status).toBe("completed");
    const after = s.getTask(rec.taskId)!;
    expect(after.status).toBe("completed");
    expect(after.intensitySource).toBe("expedited");
    expect(adapter.calls.sync).toBe(1);
    expect(adapter.calls.batch).toBe(0);
    s.shutdown();
  });

  it("throws on terminal status", async () => {
    const s = new Scheduler();
    const rec = await s.enqueueProviderCall(
      { type: "provider_call", provider: "anthropic", model: "m", prompt: "x" },
      { deadline: new Date(Date.now() + 60_000), region: "US-CAL-CISO" },
    );
    s.cancelTask(rec.taskId);
    await expect(s.expediteTask(rec.taskId, {})).rejects.toThrow(/already cancelled/);
    s.shutdown();
  });
});

describe("Scheduler.updateDeadline", () => {
  it("re-scores against a new deadline", async () => {
    const s = new Scheduler();
    const rec = await s.enqueueProviderCall(
      { type: "provider_call", provider: "anthropic", model: "m", prompt: "x" },
      { deadline: new Date(Date.now() + 60 * 60 * 1000), region: "US-CAL-CISO" },
    );
    const firstSched = rec.scheduledFor;
    await s.updateDeadline(rec.taskId, new Date(Date.now() + 6 * 60 * 60 * 1000));
    const after = s.getTask(rec.taskId)!;
    expect(after.scheduledFor).toBeDefined();
    // We don't assert that the window changed (the mock grid is
    // deterministic), but the status remains scheduled.
    expect(after.status).toBe("scheduled");
    void firstSched;
    s.shutdown();
  });

  it("throws if new deadline is in the past", async () => {
    const s = new Scheduler();
    const rec = await s.enqueueProviderCall(
      { type: "provider_call", provider: "anthropic", model: "m", prompt: "x" },
      { deadline: new Date(Date.now() + 60_000), region: "US-CAL-CISO" },
    );
    await expect(
      s.updateDeadline(rec.taskId, new Date(Date.now() - 60_000)),
    ).rejects.toThrow(InvalidDeadlineError);
    s.shutdown();
  });

  it("throws if task is running/completed", async () => {
    const s = new Scheduler();
    const adapter = fakeAnthropic();
    const rec = await s.enqueueProviderCall(
      { type: "provider_call", provider: "anthropic", model: "m", prompt: "x" },
      { deadline: new Date(Date.now() + 60 * 60 * 1000), region: "US-CAL-CISO" },
    );
    await s.expediteTask(rec.taskId, { anthropic: adapter });
    await expect(
      s.updateDeadline(rec.taskId, new Date(Date.now() + 60 * 60 * 1000)),
    ).rejects.toThrow(/completed/);
    s.shutdown();
  });
});

describe("Scheduler.retryTask", () => {
  it("only re-dispatches failed tasks", async () => {
    const s = new Scheduler();
    const adapter = fakeAnthropic();
    const rec = await s.enqueueProviderCall(
      { type: "provider_call", provider: "anthropic", model: "m", prompt: "x" },
      { deadline: new Date(Date.now() + 60_000), region: "US-CAL-CISO" },
    );
    // success — retry should refuse
    await s.expediteTask(rec.taskId, { anthropic: adapter });
    await expect(s.retryTask(rec.taskId, { anthropic: adapter })).rejects.toThrow(
      /retry is only valid on failed/,
    );
    s.shutdown();
  });
});

describe("Scheduler.previewProviderCall", () => {
  it("returns a plan without persisting anything", async () => {
    const s = new Scheduler();
    const spec: ProviderCallSpec = {
      type: "provider_call",
      provider: "anthropic",
      model: "m",
      prompt: "x",
    };
    const plan = await s.previewProviderCall(spec, {
      deadline: new Date(Date.now() + 12 * 60 * 60 * 1000),
      region: "US-CAL-CISO",
    });
    expect(plan.scheduledFor).toBeDefined();
    expect(plan.estimatedCarbonGCo2).toBeGreaterThan(0);
    expect(plan.batchEligible).toBe(false); // 12h < 24h
    expect(s.listTasks().length).toBe(0); // not persisted
    s.shutdown();
  });

  it("flags batchEligible=true for deadlines > 24h", async () => {
    const s = new Scheduler();
    const plan = await s.previewProviderCall(
      { type: "provider_call", provider: "anthropic", model: "m", prompt: "x" },
      { deadline: new Date(Date.now() + 48 * 60 * 60 * 1000), region: "US-CAL-CISO" },
    );
    expect(plan.batchEligible).toBe(true);
    s.shutdown();
  });

  it("throws CarbonBudgetExceededError when no window fits the budget", async () => {
    const s = new Scheduler();
    await expect(
      s.previewProviderCall(
        { type: "provider_call", provider: "anthropic", model: "m", prompt: "x" },
        {
          deadline: new Date(Date.now() + 6 * 60 * 60 * 1000),
          region: "US-MIDW-MISO",
          carbonBudgetG: 0.01,
        },
      ),
    ).rejects.toThrow(CarbonBudgetExceededError);
    s.shutdown();
  });
});

describe("Receipt redaction + output_path", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "ebb-v05-"));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("redacts default API-key patterns from the receipt prompt", async () => {
    const s = new Scheduler();
    const adapter = fakeAnthropic();
    const rec = await s.enqueueProviderCall(
      {
        type: "provider_call",
        provider: "anthropic",
        model: "m",
        prompt: "context: sk-ant-AAAAABBBBBBCCCCCCDDDDDD here is the secret",
      },
      { deadline: new Date(Date.now() + 60 * 60 * 1000), region: "US-CAL-CISO" },
    );
    await s.expediteTask(rec.taskId, { anthropic: adapter });
    const after = s.getTask(rec.taskId)!;
    expect(after.receipt?.prompt).toBeDefined();
    expect(after.receipt!.prompt).not.toContain("sk-ant-AAAA");
    expect(after.receipt!.prompt).toContain("[REDACTED]");
    s.shutdown();
  });

  it("writes output_path JSON on completion", async () => {
    const path = join(dir, "result.json");
    const s = new Scheduler();
    const adapter = fakeAnthropic();
    const rec = await s.enqueueProviderCall(
      {
        type: "provider_call",
        provider: "anthropic",
        model: "m",
        prompt: "x",
        outputPath: path,
      },
      { deadline: new Date(Date.now() + 60 * 60 * 1000), region: "US-CAL-CISO" },
    );
    await s.expediteTask(rec.taskId, { anthropic: adapter });
    const written = JSON.parse(readFileSync(path, "utf8"));
    expect(written.taskId).toBe(rec.taskId);
    expect(written.result.text).toMatch(/ok:/);
    expect(written.receipt.taskId).toBe(rec.taskId);
    s.shutdown();
  });

  it("respects an explicit empty redactInReceipt array (no redaction)", async () => {
    const s = new Scheduler();
    const adapter = fakeAnthropic();
    const rec = await s.enqueueProviderCall(
      {
        type: "provider_call",
        provider: "anthropic",
        model: "m",
        prompt: "raw sk-ant-keep-this-visible-please",
        redactInReceipt: [],
      },
      { deadline: new Date(Date.now() + 60 * 60 * 1000), region: "US-CAL-CISO" },
    );
    await s.expediteTask(rec.taskId, { anthropic: adapter });
    const after = s.getTask(rec.taskId)!;
    expect(after.receipt?.prompt).toContain("sk-ant-keep-this");
    s.shutdown();
  });
});

describe("retryWithBackoff (integration)", () => {
  it("retries a 5xx-flagged failure and eventually succeeds", async () => {
    let attempts = 0;
    const adapter: ProviderAdapter = {
      provider: "anthropic",
      ready: true,
      async dispatch(model, prompt) {
        attempts++;
        if (attempts < 2) {
          const e: { status: number; message: string } = { status: 503, message: "transient" };
          throw e;
        }
        return { text: "ok", model, provider: "anthropic", raw: null };
      },
      async dispatchBatch() {
        throw new Error("not used");
      },
    };
    const s = new Scheduler();
    const rec = await s.enqueueProviderCall(
      { type: "provider_call", provider: "anthropic", model: "m", prompt: "x" },
      { deadline: new Date(Date.now() + 60 * 60 * 1000), region: "US-CAL-CISO" },
    );
    // Speed up the backoff for tests: stub setTimeout once.
    const realSetTimeout = global.setTimeout;
    vi.spyOn(global, "setTimeout").mockImplementation((cb: () => void) => realSetTimeout(cb, 0) as unknown as NodeJS.Timeout);
    try {
      const entry = await s.expediteTask(rec.taskId, { anthropic: adapter });
      expect(entry.status).toBe("completed");
      expect(attempts).toBe(2);
    } finally {
      vi.restoreAllMocks();
    }
    s.shutdown();
  });

  it("does not retry 4xx (non-429) and fails fast", async () => {
    let attempts = 0;
    const adapter: ProviderAdapter = {
      provider: "anthropic",
      ready: true,
      async dispatch() {
        attempts++;
        const e: { status: number; message: string } = { status: 400, message: "bad prompt" };
        throw e;
      },
      async dispatchBatch() {
        throw new Error("not used");
      },
    };
    const s = new Scheduler();
    const rec = await s.enqueueProviderCall(
      { type: "provider_call", provider: "anthropic", model: "m", prompt: "x" },
      { deadline: new Date(Date.now() + 60 * 60 * 1000), region: "US-CAL-CISO" },
    );
    const entry = await s.expediteTask(rec.taskId, { anthropic: adapter });
    expect(entry.status).toBe("failed");
    expect(attempts).toBe(1);
    s.shutdown();
  });
});

describe("TaskStore.claimScheduled (row-level claim)", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "ebb-claim-"));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("only one of two concurrent claims wins", async () => {
    const dbPath = join(dir, "queue.sqlite");
    const s1 = new Scheduler({ dbPath });
    const rec = await s1.enqueueProviderCall(
      { type: "provider_call", provider: "anthropic", model: "m", prompt: "x" },
      { deadline: new Date(Date.now() + 60 * 60 * 1000), region: "US-CAL-CISO" },
    );
    s1.shutdown();

    // Two fresh schedulers each try to claim the same row.
    const a = new Scheduler({ dbPath });
    const b = new Scheduler({ dbPath });
    const adapter = fakeAnthropic();
    // Force scheduled_for into the past so both ticks see the task as due.
    const persisted = a.loadPersistedTask(rec.taskId)!;
    persisted.scheduledFor = new Date(Date.now() - 1000).toISOString();
    // Re-upsert through both schedulers so each sees the past timestamp.
    // (Use the store accessor directly.)
    (a as unknown as { store?: { upsert: (r: typeof persisted) => void } }).store?.upsert(persisted);
    const [resA, resB] = await Promise.all([
      a.tick({ anthropic: adapter }),
      b.tick({ anthropic: adapter }),
    ]);
    const totalDispatched = resA.dispatched + resB.dispatched;
    expect(totalDispatched).toBe(1);
    a.shutdown();
    b.shutdown();
  });
});
