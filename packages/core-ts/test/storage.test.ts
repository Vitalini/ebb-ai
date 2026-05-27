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

  it("enables WAL mode on disk-backed stores (v0.11)", () => {
    const store = new TaskStore({ dbPath });
    // Cast through `unknown` because TaskStore intentionally hides the
    // raw db handle from its public surface.
    const db = (store as unknown as {
      db: { prepare: (s: string) => { get(): { journal_mode: string } } };
    }).db;
    const row = db.prepare("PRAGMA journal_mode").get();
    expect(row.journal_mode.toLowerCase()).toBe("wal");
    store.close();
  });

  it("two TaskStore handles over the same file write concurrently without SQLITE_BUSY", () => {
    const a = new TaskStore({ dbPath });
    const b = new TaskStore({ dbPath });
    // Interleave writes — without WAL this used to throw SQLITE_BUSY
    // intermittently when the `ebb tick` daemon and the MCP server held
    // separate connections.
    for (let i = 0; i < 20; i++) {
      const writer = i % 2 === 0 ? a : b;
      writer.upsert({
        taskId: `t-${i}`,
        status: "queued",
        enqueuedAt: new Date(2026, 4, 27, 0, 0, i).toISOString(),
        region: "US-CAL-CISO",
      });
    }
    expect(a.list()).toHaveLength(20);
    expect(b.list()).toHaveLength(20);
    a.close();
    b.close();
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
