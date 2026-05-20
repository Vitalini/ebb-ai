import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { TaskStore } from "@ebb-ai/core";

import ebbPlugin, { runDispatchTick } from "../src/index.js";
import { buildAdapters, setLlmBridgeForTest } from "../src/dispatch.js";
import type { StubResolvedTool } from "./stub-tool-plugin.js";

const TOOL_NAMES = [
  "schedule_task",
  "recommend_window",
  "check_queue_status",
  "cancel_task",
  "get_grid_forecast",
  "update_deadline",
  "cancel_all",
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

  it("registers the seven tools, MCP-style names with no ebb_ prefix", () => {
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

  it("dispatches an overdue task through the captured OpenClaw runtime bridge", async () => {
    let bridgeCalls = 0;
    // Simulate OpenClaw's api.runtime.llm.complete.
    setLlmBridgeForTest(async () => {
      bridgeCalls += 1;
      return {
        text: "PASS — dispatched via the OpenClaw runtime bridge",
        provider: "anthropic",
        model: "claude-sonnet-4-6",
        usage: { totalTokens: 9 },
      };
    });
    try {
      const sched = (await tool("schedule_task").execute(
        { prompt: "bridge dispatch test", deadline: deadlineISO(), region: "GB" },
        { dbPath },
      )) as { task_id: string; dispatch: string };
      // With the bridge captured, schedule_task reports it.
      expect(sched.dispatch).toBe("openclaw-runtime");

      const store = new TaskStore({ dbPath });
      const rec = store.get(sched.task_id);
      if (!rec) throw new Error("task was not persisted");
      rec.status = "scheduled";
      rec.scheduledFor = new Date(Date.now() - 60_000).toISOString();
      store.upsert(rec);
      store.close();

      // No adapter override — runDispatchTick must build the bridge adapter.
      const result = await runDispatchTick({ dbPath });
      expect(bridgeCalls).toBeGreaterThanOrEqual(1);
      expect(result.dispatched).toBeGreaterThanOrEqual(1);

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
