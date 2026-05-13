import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Scheduler, TaskStore } from "../src/index.js";

describe("TaskStore (SQLite-backed)", () => {
  let dir: string;
  let dbPath: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "ebb-sqlite-"));
    dbPath = join(dir, "queue.sqlite");
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("round-trips a TaskRecord through upsert + get", () => {
    const store = new TaskStore({ dbPath });
    store.upsert({
      taskId: "t1",
      status: "queued",
      enqueuedAt: "2026-05-12T00:00:00.000Z",
      region: "US-CAL-CISO",
      carbonBudgetG: 1.5,
    });
    const got = store.get("t1");
    expect(got?.status).toBe("queued");
    expect(got?.region).toBe("US-CAL-CISO");
    expect(got?.carbonBudgetG).toBe(1.5);
    store.close();
  });

  it("survives a reopen", () => {
    const writer = new TaskStore({ dbPath });
    writer.upsert({
      taskId: "t2",
      status: "completed",
      enqueuedAt: "2026-05-12T00:00:00.000Z",
      completedAt: "2026-05-12T01:00:00.000Z",
      region: "US-TEX-ERCO",
      result: { ok: true, payload: "hello" },
      receipt: {
        taskId: "t2",
        ranAt: "2026-05-12T01:00:00.000Z",
        region: "US-TEX-ERCO",
        estimatedCarbonGCo2: 0.4,
        durationMs: 123,
      },
      intensitySource: "scored",
    });
    writer.close();

    const reader = new TaskStore({ dbPath });
    const got = reader.get("t2");
    expect(got?.status).toBe("completed");
    expect((got?.result as { ok: boolean }).ok).toBe(true);
    expect(got?.receipt?.estimatedCarbonGCo2).toBe(0.4);
    expect(got?.intensitySource).toBe("scored");
    reader.close();
  });

  it("filters list() by status", () => {
    const store = new TaskStore({ dbPath });
    store.upsert({
      taskId: "a",
      status: "queued",
      enqueuedAt: "2026-05-12T00:00:00.000Z",
      region: "US-CAL-CISO",
    });
    store.upsert({
      taskId: "b",
      status: "completed",
      enqueuedAt: "2026-05-12T00:01:00.000Z",
      region: "US-CAL-CISO",
    });
    const completed = store.list({ status: "completed" });
    expect(completed.map((r) => r.taskId)).toEqual(["b"]);
    store.close();
  });
});

describe("Scheduler with dbPath persists task transitions", () => {
  let dir: string;
  let dbPath: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "ebb-sched-sqlite-"));
    dbPath = join(dir, "queue.sqlite");
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("writes queued + completed records", async () => {
    const scheduler = new Scheduler({ dbPath });
    const result = await scheduler.defer(
      async () => ({ value: 42 }),
      { deadline: new Date(Date.now() + 60_000) },
    );
    expect((result as { value: number }).value).toBe(42);
    const persisted = scheduler.listPersistedTasks();
    expect(persisted.length).toBe(1);
    expect(persisted[0]?.status).toBe("completed");
    expect(persisted[0]?.receipt).toBeDefined();
    scheduler.shutdown();
  });
});
