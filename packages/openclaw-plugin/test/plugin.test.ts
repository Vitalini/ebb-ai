import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import ebbPlugin from "../src/index.js";
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
});
