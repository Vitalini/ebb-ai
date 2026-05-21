import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { TaskStore } from "@ebb-ai/core";

import ebbPlugin, { runDispatchTick } from "../src/index.js";
import { buildAdapters, setLlmBridgeForTest } from "../src/dispatch.js";
import {
  deliverResult,
  formatReport,
  getDeliveryConfig,
  readDeliveryRecord,
  recordDeliveryOutcomes,
  scanDeliveryOptions,
  setDeliveryConfig,
  validateDeliveryConfig,
} from "../src/delivery.js";
import type { StubResolvedTool } from "./stub-tool-plugin.js";

const TOOL_NAMES = [
  "schedule_task",
  "recommend_window",
  "check_queue_status",
  "cancel_task",
  "get_grid_forecast",
  "update_deadline",
  "cancel_all",
  "set_delivery",
];

function tool(name: string): StubResolvedTool {
  const found = ebbPlugin.tools.find((t) => t.name === name);
  if (!found) throw new Error(`tool ${name} is not registered`);
  return found;
}

/** An ISO-8601 deadline ~24h in the future. */
function deadlineISO(hoursAhead = 24): string {
  return new Date(Date.now() + hoursAhead * 60 * 60 * 1000).toISOString();
}

describe("ebb OpenClaw plugin — registration", () => {
  it("loads as a tool plugin with id 'ebb'", () => {
    expect(ebbPlugin.id).toBe("ebb");
    expect(ebbPlugin.name).toMatch(/ebb-ai/);
  });

  it("registers the eight tools, MCP-style names with no ebb_ prefix", () => {
    const names = ebbPlugin.tools.map((t) => t.name).sort();
    expect(names).toEqual([...TOOL_NAMES].sort());
    for (const t of ebbPlugin.tools) {
      expect(t.name).not.toMatch(/^ebb_/);
    }
  });

  it("gives every tool a label, a description and a parameters schema", () => {
    for (const t of ebbPlugin.tools) {
      expect(t.label.length).toBeGreaterThan(0);
      expect(t.description.length).toBeGreaterThan(20);
      expect(t.parameters).toBeTruthy();
    }
  });
});

describe("ebb OpenClaw plugin — tool execution", () => {
  let tmp: string;
  let dbPath: string;
  let scheduledId: string;

  beforeAll(() => {
    tmp = mkdtempSync(join(tmpdir(), "ebb-plugin-test-"));
    dbPath = join(tmp, "queue.db");
  });

  afterAll(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it("recommend_window returns a window without opening the queue DB", async () => {
    const res = (await tool("recommend_window").execute(
      { deadline: deadlineISO(), region: "GB" },
      { dbPath: "/nonexistent-dir/queue.db" },
    )) as Record<string, unknown>;
    expect(res).toBeTruthy();
    expect(typeof res).toBe("object");
  });

  it("get_grid_forecast returns a forecast without opening the queue DB", async () => {
    const res = (await tool("get_grid_forecast").execute(
      { region: "GB", hours: 6 },
      { dbPath: "/nonexistent-dir/queue.db" },
    )) as Record<string, unknown>;
    expect(res).toBeTruthy();
    expect(typeof res).toBe("object");
  });

  it("schedule_task persists a task and reports region_source", async () => {
    const res = (await tool("schedule_task").execute(
      { prompt: "ebb plugin test task", deadline: deadlineISO(), region: "GB" },
      { dbPath },
    )) as {
      task_id: string;
      status: string;
      region: string;
      region_source: string;
      persisted_to: string;
    };
    expect(res.task_id).toBeTruthy();
    expect(res.region).toBe("GB");
    expect(res.region_source).toBe("request");
    expect(res.persisted_to).toBe(dbPath);
    scheduledId = res.task_id;
  });

  it("check_queue_status lists the scheduled task", async () => {
    const res = (await tool("check_queue_status").execute(
      {},
      { dbPath },
    )) as { total: number; tasks: Array<{ task_id: string }> };
    expect(res.total).toBeGreaterThanOrEqual(1);
    expect(res.tasks.some((t) => t.task_id === scheduledId)).toBe(true);
  });

  it("update_deadline reschedules a queued task", async () => {
    const res = (await tool("update_deadline").execute(
      { task_id: scheduledId, deadline: deadlineISO(48) },
      { dbPath },
    )) as { task_id: string; status: string };
    expect(res.task_id).toBe(scheduledId);
    expect(["queued", "scheduled"]).toContain(res.status);
  });

  it("cancel_task cancels the scheduled task", async () => {
    const res = (await tool("cancel_task").execute(
      { task_id: scheduledId },
      { dbPath },
    )) as { task_id: string; status: string };
    expect(res.task_id).toBe(scheduledId);
    expect(res.status).toBe("cancelled");
  });

  it("cancel_all cancels remaining queued/scheduled tasks", async () => {
    await tool("schedule_task").execute(
      { prompt: "second task", deadline: deadlineISO(), region: "GB" },
      { dbPath },
    );
    const res = (await tool("cancel_all").execute({}, { dbPath })) as {
      matched: number;
      cancelled: number;
      errors: unknown[];
    };
    expect(res.matched).toBeGreaterThanOrEqual(1);
    expect(res.cancelled).toBeGreaterThanOrEqual(1);
  });

  it("check_queue_status throws for an unknown task id", async () => {
    await expect(
      tool("check_queue_status").execute(
        { task_id: "t-does-not-exist" },
        { dbPath },
      ),
    ).rejects.toThrow();
  });

  it("runDispatchTick dispatches an overdue scheduled task", async () => {
    const sched = (await tool("schedule_task").execute(
      { prompt: "dispatch me", deadline: deadlineISO(), region: "GB" },
      { dbPath },
    )) as { task_id: string };

    // Force the chosen window into the past via the shared store — the
    // task is now overdue and must be picked up by the next sweep.
    const store = new TaskStore({ dbPath });
    const rec = store.get(sched.task_id);
    if (!rec) throw new Error("scheduled task was not persisted");
    rec.status = "scheduled";
    rec.scheduledFor = new Date(Date.now() - 60_000).toISOString();
    store.upsert(rec);
    store.close();

    const stub = {
      provider: "anthropic" as const,
      ready: true,
      async dispatch(model: string, prompt: string) {
        return { text: `stub:${prompt}`, model, provider: "anthropic", raw: {} };
      },
    };
    const result = await runDispatchTick({ dbPath }, { anthropic: stub });
    expect(result.dispatched).toBeGreaterThanOrEqual(1);

    const after = (await tool("check_queue_status").execute(
      { task_id: sched.task_id },
      { dbPath },
    )) as { status: string };
    expect(after.status).toBe("completed");
  });

  it("bridge dispatch (no model): the runtime bridge is called WITHOUT a model override", async () => {
    const bridgeRequests: Array<Record<string, unknown>> = [];
    setLlmBridgeForTest(async (req) => {
      bridgeRequests.push(req as Record<string, unknown>);
      return {
        text: "PASS via the OpenClaw runtime bridge",
        provider: "anthropic",
        model: "gateway-agent-model",
        usage: { totalTokens: 9 },
      };
    });
    try {
      const sched = (await tool("schedule_task").execute(
        { prompt: "bridge default-model test", deadline: deadlineISO(), region: "GB" },
        { dbPath },
      )) as { task_id: string; dispatch: string; note?: string };
      expect(sched.dispatch).toBe("openclaw-runtime");
      expect(sched.note).toBeUndefined();

      const store = new TaskStore({ dbPath });
      const rec = store.get(sched.task_id);
      if (!rec) throw new Error("task was not persisted");
      rec.status = "scheduled";
      rec.scheduledFor = new Date(Date.now() - 60_000).toISOString();
      store.upsert(rec);
      store.close();

      const result = await runDispatchTick({ dbPath });
      expect(result.dispatched).toBeGreaterThanOrEqual(1);
      // The 0.1.6 bug: any `model` param triggers OpenClaw's override-policy
      // denial. The bridge must never send one.
      expect(bridgeRequests.length).toBeGreaterThanOrEqual(1);
      expect(bridgeRequests[0]).not.toHaveProperty("model");

      const after = (await tool("check_queue_status").execute(
        { task_id: sched.task_id },
        { dbPath },
      )) as { status: string };
      expect(after.status).toBe("completed");
    } finally {
      setLlmBridgeForTest(undefined);
    }
  });

  it("bridge dispatch (explicit model): still no model override; schedule_task notes it", async () => {
    const bridgeRequests: Array<Record<string, unknown>> = [];
    setLlmBridgeForTest(async (req) => {
      bridgeRequests.push(req as Record<string, unknown>);
      return { text: "PASS", provider: "anthropic", model: "gateway-agent-model" };
    });
    try {
      const sched = (await tool("schedule_task").execute(
        {
          prompt: "bridge explicit-model test",
          deadline: deadlineISO(),
          region: "GB",
          model: "claude-opus-4-1",
        },
        { dbPath },
      )) as { task_id: string; dispatch: string; note?: string };
      expect(sched.dispatch).toBe("openclaw-runtime");
      // The user is told the explicit model is not applied via the bridge.
      expect(sched.note).toMatch(/model/i);

      const store = new TaskStore({ dbPath });
      const rec = store.get(sched.task_id);
      if (!rec) throw new Error("task was not persisted");
      rec.status = "scheduled";
      rec.scheduledFor = new Date(Date.now() - 60_000).toISOString();
      store.upsert(rec);
      store.close();

      const result = await runDispatchTick({ dbPath });
      expect(result.dispatched).toBeGreaterThanOrEqual(1);
      // Even with an explicit model the bridge must not send a model override.
      expect(bridgeRequests[0]).not.toHaveProperty("model");

      const after = (await tool("check_queue_status").execute(
        { task_id: sched.task_id },
        { dbPath },
      )) as { status: string };
      expect(after.status).toBe("completed");
    } finally {
      setLlmBridgeForTest(undefined);
    }
  });
});

describe("ebb OpenClaw plugin — dispatch adapters", () => {
  beforeEach(() => setLlmBridgeForTest(undefined));

  it("buildAdapters is empty when no provider keys are set", () => {
    expect(buildAdapters({})).toEqual({});
  });

  it("buildAdapters exposes an adapter per configured API key", () => {
    const adapters = buildAdapters({
      ANTHROPIC_API_KEY: "sk-ant-test",
      OPENAI_API_KEY: "sk-openai-test",
    });
    expect(adapters.anthropic?.provider).toBe("anthropic");
    expect(adapters.openai?.provider).toBe("openai");
    expect(typeof adapters.anthropic?.dispatch).toBe("function");
  });
});

describe("ebb OpenClaw plugin — result delivery", () => {
  const completedTask = {
    taskId: "t-deliver",
    status: "completed",
    region: "GB",
    enqueuedAt: "2026-05-21T00:00:00Z",
    completedAt: "2026-05-21T03:00:00Z",
    result: { text: "the deferred answer" },
    receipt: {
      taskId: "t-deliver",
      ranAt: "2026-05-21T03:00:00Z",
      region: "GB",
      estimatedCarbonGCo2: 42,
      provider: "openai",
      model: "gpt-5.5",
      durationMs: 1200,
      prompt: "x",
    },
  } as unknown as Parameters<typeof formatReport>[0];

  it("scanDeliveryOptions reflects whether a chat channel is configured", () => {
    const withTg = scanDeliveryOptions({
      channels: { telegram: { enabled: true, botToken: "x", allowFrom: ["1"] } },
    });
    expect(withTg.find((o) => o.mode === "chat")?.available).toBe(true);
    const without = scanDeliveryOptions({});
    expect(without.find((o) => o.mode === "chat")?.available).toBe(false);
    expect(without.find((o) => o.mode === "webhook")?.available).toBe(true);
  });

  it("validateDeliveryConfig requires a target for webhook and file", () => {
    expect(validateDeliveryConfig({ modes: ["webhook"] })).toMatch(/webhook_url/);
    expect(validateDeliveryConfig({ modes: ["file"] })).toMatch(/file_path/);
    expect(validateDeliveryConfig({ modes: [] })).toMatch(/at least one/);
    expect(validateDeliveryConfig({ modes: ["chat"] })).toBeNull();
  });

  it("formatReport renders md / html / json", () => {
    expect(formatReport(completedTask, "md")).toContain("the deferred answer");
    expect(formatReport(completedTask, "html")).toContain("<html");
    const json = JSON.parse(formatReport(completedTask, "json")) as {
      result: string;
    };
    expect(json.result).toBe("the deferred answer");
  });

  it("deliverResult writes a file and POSTs a webhook", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ebb-deliver-"));
    const filePath = join(dir, "report.md");
    let posted: { task_id?: string } | undefined;
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async (_url: string, init: { body: string }) => {
      posted = JSON.parse(init.body) as { task_id?: string };
      return { ok: true, status: 200 } as Response;
    }) as unknown as typeof fetch;
    try {
      const outcomes = await deliverResult(
        completedTask,
        {
          modes: ["file", "webhook", "queue"],
          filePath,
          webhookUrl: "https://example.test/hook",
          format: "md",
        },
        {},
      );
      expect(outcomes.every((o) => o.ok)).toBe(true);
      expect(readFileSync(filePath, "utf8")).toContain("the deferred answer");
      expect(posted?.task_id).toBe("t-deliver");
    } finally {
      globalThis.fetch = realFetch;
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("setDeliveryConfig / getDeliveryConfig round-trip via the sidecar", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ebb-sidecar-"));
    process.env.EBB_DELIVERY_FILE = join(dir, "delivery.json");
    try {
      await setDeliveryConfig("t-z", { modes: ["chat", "file"], filePath: "/tmp/r.md" });
      expect((await getDeliveryConfig("t-z", true)).modes).toEqual(["chat", "file"]);
      // an unknown task falls back to the chat default
      expect((await getDeliveryConfig("t-unknown", true)).modes).toEqual(["chat"]);
    } finally {
      delete process.env.EBB_DELIVERY_FILE;
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("recordDeliveryOutcomes persists per-mode outcomes for later audit", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ebb-outcomes-"));
    process.env.EBB_DELIVERY_FILE = join(dir, "delivery.json");
    try {
      await recordDeliveryOutcomes("t-o", { modes: ["chat", "webhook"] }, [
        { mode: "chat", ok: true, detail: "Telegram DM → 1" },
        { mode: "webhook", ok: false, detail: "HTTP 500" },
      ]);
      const rec = await readDeliveryRecord("t-o");
      expect(rec?.deliveredAt).toBeTruthy();
      expect(rec?.outcomes?.find((o) => o.mode === "chat")?.ok).toBe(true);
      expect(rec?.outcomes?.find((o) => o.mode === "webhook")?.ok).toBe(false);
      expect(await readDeliveryRecord("t-none")).toBeUndefined();
    } finally {
      delete process.env.EBB_DELIVERY_FILE;
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
