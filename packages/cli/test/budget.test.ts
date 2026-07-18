/**
 * `ebb stats` aggregate carbon-budget block (ROADMAP item 4).
 *
 * Seeds completed receipts into a temp ledger and asserts the budget block
 * renders (and appears in --json) when a budget is configured, and is absent
 * otherwise.
 */

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TaskStore, type TaskRecord } from "@ebb-ai/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runStats } from "../src/commands/stats.js";

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

describe("ebb stats — carbon budget block", () => {
  let dir: string;
  let dbPath: string;
  let cfgPath: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "ebb-stats-budget-"));
    dbPath = join(dir, "queue.db");
    cfgPath = join(dir, "config");
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("renders the budget block with used/threshold/percent when configured", async () => {
    seedCompleted(dbPath, "t-1", 30);
    seedCompleted(dbPath, "t-2", 45);
    writeFileSync(cfgPath, "EBB_CARBON_BUDGET_G=100\nEBB_CARBON_BUDGET_WINDOW=daily\n");
    const res = await runStats({ db: dbPath, budgetConfig: cfgPath });
    expect(res.budget).toBeDefined();
    expect(res.budget!.usedG).toBe(75);
    expect(res.budget!.thresholdG).toBe(100);
    expect(res.budget!.pct).toBe(75);
    expect(res.budget!.exceeded).toBe(false);
    expect(res.rendered).toMatch(/carbon budget \(daily\)/);
    expect(res.rendered).toMatch(/used 75\.0 \/ 100 g/);
    expect(res.rendered).toMatch(/\(75%\)/);
  });

  it("flags OVER BUDGET once consumption crosses the threshold", async () => {
    seedCompleted(dbPath, "t-1", 80);
    seedCompleted(dbPath, "t-2", 40);
    writeFileSync(cfgPath, "EBB_CARBON_BUDGET_G=100\n");
    const res = await runStats({ db: dbPath, budgetConfig: cfgPath });
    expect(res.budget!.exceeded).toBe(true);
    expect(res.rendered).toMatch(/OVER BUDGET/);
  });

  it("omits the budget block when no budget is configured", async () => {
    seedCompleted(dbPath, "t-1", 30);
    const res = await runStats({ db: dbPath, budgetConfig: join(dir, "nonexistent") });
    expect(res.budget).toBeUndefined();
    expect(res.rendered).not.toMatch(/carbon budget/);
  });

  it("includes the budget in --json output", async () => {
    seedCompleted(dbPath, "t-1", 30);
    writeFileSync(cfgPath, "EBB_CARBON_BUDGET_G=100\n");
    const res = await runStats({ db: dbPath, json: true, budgetConfig: cfgPath });
    const parsed = JSON.parse(res.rendered) as { budget?: { usedG: number } };
    expect(parsed.budget?.usedG).toBe(30);
  });
});
