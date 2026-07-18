/**
 * check_queue_status carbon-budget block (ROADMAP item 4).
 *
 * With an aggregate budget configured, the queue summary appends a
 * `carbon_budget:` block (used / threshold / window / alerted). Absent when
 * no budget is configured.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { mockGridFeed, TaskStore, type TaskRecord } from "@ebb-ai/core";
import { afterEach, describe, expect, it } from "vitest";
import { createEbbServer } from "../src/server.js";

type TextResult = { content: Array<{ type: string; text: string }>; isError?: boolean };

const cleanups: Array<() => void> = [];
afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()!();
});

function seedCompleted(dbPath: string, taskId: string, actualG: number): void {
  const store = new TaskStore({ dbPath });
  const now = new Date().toISOString();
  const record: TaskRecord<unknown> = {
    taskId,
    status: "completed",
    enqueuedAt: now,
    completedAt: now,
    region: "US-CAL-CISO",
    intensitySource: "scored",
    receipt: {
      taskId,
      ranAt: now,
      region: "US-CAL-CISO",
      estimatedCarbonGCo2: actualG,
      actualCarbonGCo2: actualG,
    },
  };
  store.upsert(record);
  store.close();
}

async function connect(deps: Parameters<typeof createEbbServer>[0] = {}) {
  const built = createEbbServer({ feed: mockGridFeed(), ...deps });
  const client = new Client({ name: "budget-test", version: "0.0.0" });
  const [s, c] = InMemoryTransport.createLinkedPair();
  await Promise.all([built.server.connect(s), client.connect(c)]);
  cleanups.push(() => {
    try {
      built.scheduler.shutdown();
    } catch {
      /* already shut down */
    }
  });
  return { client };
}

describe("check_queue_status — carbon budget block", () => {
  let dir: string;
  let dbPath: string;

  function fresh(): void {
    dir = mkdtempSync(join(tmpdir(), "ebb-mcp-budget-"));
    dbPath = join(dir, "queue.db");
    cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
  }

  it("appends the budget block when a budget is configured", async () => {
    fresh();
    seedCompleted(dbPath, "t-1", 60);
    seedCompleted(dbPath, "t-2", 60);
    const { client } = await connect({
      dbPath,
      carbonBudget: { windowKind: "daily", thresholdG: 100 },
    });
    const res = (await client.callTool({
      name: "check_queue_status",
      arguments: {},
    })) as TextResult;
    const text = res.content[0]!.text;
    expect(text).toMatch(/carbon_budget:/);
    expect(text).toMatch(/window: daily/);
    expect(text).toMatch(/used_g: 120/);
    expect(text).toMatch(/threshold_g: 100/);
    expect(text).toMatch(/exceeded: true/);
    expect(text).toMatch(/alerted: false/);
  });

  it("omits the budget block when no budget is configured", async () => {
    fresh();
    seedCompleted(dbPath, "t-1", 60);
    const { client } = await connect({ dbPath, carbonBudget: undefined });
    const res = (await client.callTool({
      name: "check_queue_status",
      arguments: {},
    })) as TextResult;
    expect(res.content[0]!.text).not.toMatch(/carbon_budget:/);
  });
});
