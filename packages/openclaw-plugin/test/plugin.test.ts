import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import ebbPlugin, { regionForTimezone, resolveRegion } from "../src/index.js";
import type { StubResolvedTool } from "./stub-tool-plugin.js";

const TOOL_NAMES = [
  "ebb_schedule_task",
  "ebb_recommend_window",
  "ebb_check_queue_status",
  "ebb_cancel_task",
];

function tool(name: string): StubResolvedTool {
  const found = ebbPlugin.tools.find((t) => t.name === name);
  if (!found) throw new Error(`tool ${name} is not registered`);
  return found;
}

/** An ISO-8601 deadline ~24h in the future. */
function deadlineISO(): string {
  return new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
}

describe("ebb OpenClaw plugin — registration", () => {
  it("loads as a tool plugin with id 'ebb'", () => {
    expect(ebbPlugin.id).toBe("ebb");
    expect(ebbPlugin.name).toMatch(/ebb-ai/);
  });

  it("registers exactly the four ebb_* tools", () => {
    const names = ebbPlugin.tools.map((t) => t.name).sort();
    expect(names).toEqual([...TOOL_NAMES].sort());
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

  it("ebb_recommend_window returns a window without opening the queue DB", async () => {
    // The dbPath here points nowhere usable: recommend_window must not need it.
    const res = (await tool("ebb_recommend_window").execute(
      { deadline: deadlineISO(), region: "GB" },
      { dbPath: "/nonexistent-dir/queue.db" },
    )) as Record<string, unknown>;
    expect(res).toBeTruthy();
    expect(typeof res).toBe("object");
  });

  it("ebb_schedule_task persists a task to the queue DB", async () => {
    const res = (await tool("ebb_schedule_task").execute(
      { prompt: "ebb plugin test task", deadline: deadlineISO(), region: "GB" },
      { dbPath },
    )) as { task_id: string; status: string; persisted_to: string };
    expect(res.task_id).toBeTruthy();
    expect(res.status).toBeTruthy();
    expect(res.persisted_to).toBe(dbPath);
    scheduledId = res.task_id;
  });

  it("ebb_check_queue_status lists the scheduled task", async () => {
    const res = (await tool("ebb_check_queue_status").execute(
      {},
      { dbPath },
    )) as { total: number; tasks: Array<{ task_id: string }> };
    expect(res.total).toBeGreaterThanOrEqual(1);
    expect(res.tasks.some((t) => t.task_id === scheduledId)).toBe(true);
  });

  it("ebb_check_queue_status detail returns the persisted task", async () => {
    const res = (await tool("ebb_check_queue_status").execute(
      { task_id: scheduledId },
      { dbPath },
    )) as { taskId: string };
    expect(res.taskId).toBe(scheduledId);
  });

  it("ebb_cancel_task cancels the scheduled task", async () => {
    const res = (await tool("ebb_cancel_task").execute(
      { task_id: scheduledId },
      { dbPath },
    )) as { task_id: string; status: string };
    expect(res.task_id).toBe(scheduledId);
    expect(res.status).toBe("cancelled");
  });

  it("ebb_check_queue_status throws for an unknown task id", async () => {
    await expect(
      tool("ebb_check_queue_status").execute(
        { task_id: "t-does-not-exist" },
        { dbPath },
      ),
    ).rejects.toThrow();
  });
});

describe("ebb OpenClaw plugin — region resolution", () => {
  it("maps known timezones to grid regions", () => {
    expect(regionForTimezone("Europe/London")).toBe("GB");
    expect(regionForTimezone("Europe/Paris")).toBe("FR");
    expect(regionForTimezone("Europe/Berlin")).toBe("DE");
    expect(regionForTimezone("America/Los_Angeles")).toBe("US-CAL-CISO");
    expect(regionForTimezone("America/New_York")).toBe("US-MIDA-PJM");
  });

  it("returns undefined for an unmapped timezone", () => {
    expect(regionForTimezone("Antarctica/Troll")).toBeUndefined();
  });

  it("an explicit request region wins over config and detection", () => {
    expect(resolveRegion("US-TEX-ERCO", { defaultRegion: "GB" })).toEqual({
      region: "US-TEX-ERCO",
      source: "request",
    });
  });

  it("configured defaultRegion is used when the call omits a region", () => {
    expect(resolveRegion(undefined, { defaultRegion: "FR" })).toEqual({
      region: "FR",
      source: "config",
    });
  });

  it("falls back to a timezone guess or GB when nothing is configured", () => {
    const r = resolveRegion(undefined, {});
    expect(r.region.length).toBeGreaterThan(0);
    expect(["timezone", "default"]).toContain(r.source);
  });
});
