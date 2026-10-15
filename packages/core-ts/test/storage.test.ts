import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import { Scheduler, TaskStore } from "../src/index.js";

const requireFn = createRequire(import.meta.url);

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

describe("TaskStore task-visibility fields (v0.17)", () => {
  let dir: string;
  let dbPath: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "ebb-visibility-"));
    dbPath = join(dir, "queue.db");
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  const V016_SCHEMA = `
    CREATE TABLE tasks (
      task_id TEXT PRIMARY KEY, status TEXT NOT NULL, enqueued_at TEXT NOT NULL,
      scheduled_for TEXT, completed_at TEXT, region TEXT NOT NULL,
      carbon_budget_g REAL, result_json TEXT, error TEXT, receipt_json TEXT,
      intensity_source TEXT, body_json TEXT, estimated_carbon_g REAL,
      deadline TEXT, batch_id TEXT, routing_decision TEXT
    );`;

  function seedV016(path: string): void {
    const { DatabaseSync } = requireFn("node:sqlite") as {
      DatabaseSync: new (p: string) => {
        exec(sql: string): void;
        close(): void;
      };
    };
    const raw = new DatabaseSync(path);
    raw.exec(V016_SCHEMA);
    raw.exec(`
      INSERT INTO tasks (task_id, status, enqueued_at, completed_at, region)
        VALUES ('done', 'completed', '2026-10-01T00:00:00.000Z', '2026-10-01T01:00:00.000Z', 'DE');
      INSERT INTO tasks (task_id, status, enqueued_at, completed_at, region)
        VALUES ('bad', 'failed', '2026-10-01T00:00:00.000Z', '2026-10-01T02:00:00.000Z', 'DE');
      INSERT INTO tasks (task_id, status, enqueued_at, scheduled_for, region)
        VALUES ('later', 'scheduled', '2026-10-01T00:00:00.000Z', '2026-10-02T00:00:00.000Z', 'DE');
    `);
    raw.close();
  }

  function rawColumns(store: TaskStore): string[] {
    const db = (store as unknown as {
      db: { prepare: (s: string) => { all(): Array<{ name: string }> } };
    }).db;
    return db.prepare(`SELECT name FROM pragma_table_info('tasks')`).all().map((r) => r.name);
  }

  function rawIndexes(store: TaskStore): string[] {
    const db = (store as unknown as {
      db: { prepare: (s: string) => { all(): Array<{ name: string }> } };
    }).db;
    return db
      .prepare(`SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'tasks'`)
      .all()
      .map((r) => r.name);
  }

  const NEW_COLUMNS = [
    "title",
    "origin_host",
    "origin_cwd",
    "read_at",
    "parent_task_id",
    "deadline_kind",
    "quota_provider",
  ];

  function finished(taskId: string, status: "completed" | "failed" = "completed") {
    return {
      taskId,
      status,
      enqueuedAt: "2026-10-10T00:00:00.000Z",
      completedAt: "2026-10-10T01:00:00.000Z",
      region: "DE",
    } as const;
  }

  it("a fresh in-memory store has every new column and the parent index", () => {
    const store = new TaskStore({ dbPath: ":memory:" });
    expect(rawColumns(store)).toEqual(expect.arrayContaining(NEW_COLUMNS));
    expect(rawIndexes(store)).toContain("tasks_parent_idx");
    store.close();
  });

  it("migrating a v0.16 ledger backfills read_at on finished rows only (AE10)", () => {
    seedV016(dbPath);
    const store = new TaskStore({ dbPath });
    expect(rawColumns(store)).toEqual(expect.arrayContaining(NEW_COLUMNS));
    expect(store.get("done")?.readAt).toBe("2026-10-01T01:00:00.000Z");
    expect(store.get("bad")?.readAt).toBe("2026-10-01T02:00:00.000Z");
    expect(store.get("later")?.readAt).toBeUndefined();
    expect(store.list({ unread: true })).toHaveLength(0);
    // A legacy row has no stored kind and reads as absolute.
    expect(store.get("done")?.deadlineKind).toBe("absolute");
    // Marked unread by hand, then reopened: the backfill does not run again.
    expect(store.markUnread("done")).toBe(true);
    store.close();
    const reopened = new TaskStore({ dbPath });
    expect(reopened.get("done")?.readAt).toBeUndefined();
    expect(reopened.list({ unread: true }).map((r) => r.taskId)).toEqual(["done"]);
    reopened.close();
  });

  it("two stores opening a v0.16 ledger one after the other both succeed", () => {
    seedV016(dbPath);
    const a = new TaskStore({ dbPath });
    const b = new TaskStore({ dbPath });
    expect(a.get("done")?.readAt).toBeDefined();
    expect(b.get("done")?.readAt).toBeDefined();
    a.close();
    b.close();
  });

  it("a store that loses the read_at migration race skips the backfill", () => {
    seedV016(dbPath);
    const { DatabaseSync } = requireFn("node:sqlite") as {
      DatabaseSync: new (p: string) => {
        exec(sql: string): void;
        prepare(sql: string): never;
        close(): void;
      };
    };
    const inner = new DatabaseSync(dbPath);
    let raced = false;
    // Between this store's pragma check and its ALTER, another process
    // migrates the ledger (with the backfill) and the user marks a task
    // unread. This store's ALTER then fails with "duplicate column name".
    const db = {
      exec(sql: string): void {
        if (!raced && /ADD COLUMN read_at/.test(sql)) {
          raced = true;
          const other = new TaskStore({ dbPath });
          expect(other.markUnread("done")).toBe(true);
          other.close();
        }
        inner.exec(sql);
      },
      prepare: (sql: string) => inner.prepare(sql),
      close: () => inner.close(),
    };
    const store = new TaskStore({ dbPath, db });
    expect(raced).toBe(true);
    expect(store.get("done")?.readAt).toBeUndefined();
    expect(store.get("bad")?.readAt).toBeDefined();
    store.close();
  });

  it("upsert never clears read_at and never rewrites identity columns", () => {
    const store = new TaskStore({ dbPath });
    store.upsert({
      ...finished("t1"),
      title: "original",
      originHost: "mcp",
      originCwd: "/work",
      parentTaskId: "p0",
    });
    expect(store.markRead("t1", "2026-10-10T02:00:00.000Z")).toBe(true);
    store.upsert({ ...finished("t1"), title: "changed", originHost: "cli" });
    const got = store.get("t1");
    expect(got?.readAt).toBe("2026-10-10T02:00:00.000Z");
    expect(got?.title).toBe("original");
    expect(got?.originHost).toBe("mcp");
    expect(got?.originCwd).toBe("/work");
    expect(got?.parentTaskId).toBe("p0");
    store.close();
  });

  it("upsert keeps a stored quota kind when the record has none, and clears the label on absolute", () => {
    const store = new TaskStore({ dbPath });
    store.upsert({
      taskId: "q",
      status: "scheduled",
      enqueuedAt: "2026-10-10T00:00:00.000Z",
      region: "DE",
      deadlineKind: "quota_reset",
      quotaProvider: "claude",
    });
    store.upsert({
      taskId: "q",
      status: "scheduled",
      enqueuedAt: "2026-10-10T00:00:00.000Z",
      region: "DE",
    });
    expect(store.get("q")?.deadlineKind).toBe("quota_reset");
    expect(store.get("q")?.quotaProvider).toBe("claude");
    store.upsert({
      taskId: "q",
      status: "scheduled",
      enqueuedAt: "2026-10-10T00:00:00.000Z",
      region: "DE",
      deadlineKind: "absolute",
    });
    expect(store.get("q")?.deadlineKind).toBe("absolute");
    expect(store.get("q")?.quotaProvider).toBeUndefined();
    store.close();
  });

  it("markRead only touches finished rows and sets the timestamp once", () => {
    const store = new TaskStore({ dbPath });
    store.upsert({
      taskId: "s",
      status: "scheduled",
      enqueuedAt: "2026-10-10T00:00:00.000Z",
      region: "DE",
    });
    store.upsert(finished("c"));
    expect(store.markRead("s")).toBe(false);
    expect(store.get("s")?.readAt).toBeUndefined();
    expect(store.markRead("c", "2026-10-10T03:00:00.000Z")).toBe(true);
    expect(store.markRead("c", "2026-10-10T04:00:00.000Z")).toBe(false);
    expect(store.get("c")?.readAt).toBe("2026-10-10T03:00:00.000Z");
    expect(store.markUnread("c")).toBe(true);
    expect(store.markUnread("c")).toBe(false);
    expect(store.get("c")?.readAt).toBeUndefined();
    store.close();
  });

  it("list filters by unread and deadline kind (absolute includes legacy rows)", () => {
    const store = new TaskStore({ dbPath });
    store.upsert(finished("read"));
    store.markRead("read");
    store.upsert(finished("unread-ok"));
    store.upsert(finished("unread-fail", "failed"));
    store.upsert({
      taskId: "quota",
      status: "scheduled",
      enqueuedAt: "2026-10-10T00:00:00.000Z",
      region: "DE",
      deadlineKind: "quota_reset",
      quotaProvider: "claude",
    });
    expect(store.list({ unread: true }).map((r) => r.taskId).sort()).toEqual([
      "unread-fail",
      "unread-ok",
    ]);
    expect(store.list({ deadlineKind: "quota_reset" }).map((r) => r.taskId)).toEqual([
      "quota",
    ]);
    expect(store.list({ deadlineKind: "absolute" }).map((r) => r.taskId).sort()).toEqual([
      "read",
      "unread-fail",
      "unread-ok",
    ]);
    expect(
      store.list({ status: "failed", unread: true }).map((r) => r.taskId),
    ).toEqual(["unread-fail"]);
    store.close();
  });

  it("dataVersion moves on another handle's write and stays put otherwise", () => {
    const watcher = new TaskStore({ dbPath });
    const writer = new TaskStore({ dbPath });
    const v0 = watcher.dataVersion();
    expect(watcher.dataVersion()).toBe(v0);
    writer.upsert(finished("x"));
    expect(watcher.dataVersion()).not.toBe(v0);
    watcher.close();
    writer.close();
  });

  it("meta values round-trip and overwrite", () => {
    const store = new TaskStore({ dbPath });
    expect(store.getMeta("last_tick_at")).toBeUndefined();
    store.setMeta("last_tick_at", "2026-10-10T00:00:00.000Z");
    store.setMeta("last_tick_at", "2026-10-10T00:05:00.000Z");
    expect(store.getMeta("last_tick_at")).toBe("2026-10-10T00:05:00.000Z");
    store.close();
  });
});
