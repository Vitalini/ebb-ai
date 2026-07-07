/**
 * SQLite-backed durable task store.
 *
 * v0.1 of the scheduler kept TaskRecords in a Map; restarting the process
 * lost queued work. v0.2 introduces an opt-in persistent store: pass
 * { dbPath } to the Scheduler and queued / completed records survive
 * a restart and remain auditable as a carbon ledger.
 *
 * The backend is Node's built-in synchronous SQLite (node:sqlite, Node
 * >= 22.5) — no native module to install or compile, which matters in
 * environments that install dependencies without running build scripts.
 * better-sqlite3 is used as a fallback on older Node if it is installed.
 *
 * Schema is intentionally narrow:
 *   - task_id            PRIMARY KEY
 *   - status             queued | scheduled | running | submitted |
 *                        completed | failed | cancelled
 *   - enqueued_at        ISO-8601
 *   - scheduled_for      ISO-8601 (nullable)
 *   - completed_at       ISO-8601 (nullable)
 *   - region             grid region code
 *   - carbon_budget_g    REAL (nullable)
 *   - result_json        text (nullable)
 *   - error              text (nullable)
 *   - receipt_json       text (nullable)
 *   - intensity_source   "scored" | "current" | "expedited" (nullable)
 *   - body_json          persisted provider-call spec (nullable, v0.4)
 *   - estimated_carbon_g REAL, schedule-time projection (nullable, v0.9)
 *   - deadline           ISO-8601 normalized deadline (nullable, v0.12)
 *
 * `result_json` is serialized via JSON.stringify; values that are not
 * JSON-serializable are stored as `{ "_repr": "<toString>" }` so audit
 * trails survive odd values without crashing the store.
 */

import { chmodSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname } from "node:path";
import type { CarbonReceipt, TaskRecord, TaskStatus } from "../types.js";

const requireFn = createRequire(import.meta.url);

interface SqliteDatabase {
  exec(sql: string): void;
  prepare(sql: string): SqlitePreparedStatement;
  close(): void;
}

interface SqlitePreparedStatement {
  run(...params: unknown[]): {
    changes: number | bigint;
    lastInsertRowid: number | bigint;
  };
  get(...params: unknown[]): Record<string, unknown> | undefined;
  all(...params: unknown[]): Record<string, unknown>[];
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS tasks (
  task_id           TEXT PRIMARY KEY,
  status            TEXT NOT NULL,
  enqueued_at       TEXT NOT NULL,
  scheduled_for     TEXT,
  completed_at      TEXT,
  region            TEXT NOT NULL,
  carbon_budget_g   REAL,
  result_json       TEXT,
  error             TEXT,
  receipt_json      TEXT,
  intensity_source  TEXT,
  body_json         TEXT,
  estimated_carbon_g REAL,
  deadline          TEXT
);
CREATE INDEX IF NOT EXISTS tasks_status_idx ON tasks(status);
CREATE INDEX IF NOT EXISTS tasks_enqueued_idx ON tasks(enqueued_at);
`;

/**
 * Idempotent column migrations. SQLite allows `ADD COLUMN` on a
 * non-empty table because each new column is nullable. We check
 * `pragma_table_info` first so re-running on an already-migrated DB
 * (including a freshly created DB) is a no-op. The check-then-ALTER is
 * racy when two processes open the same DB simultaneously (TOCTOU), so
 * a concurrent "duplicate column name" error is swallowed — the column
 * exists either way.
 *   - body_json          (v0.4) persistent provider-call task bodies
 *   - estimated_carbon_g (v0.9) schedule-time carbon projection, so the
 *                        receipt can report actual-vs-estimated delta
 *   - deadline           (v0.12) normalized ISO deadline captured at
 *                        enqueue, for dispatch-time batch decisions
 */
function ensureColumns(db: SqliteDatabase): void {
  const rows = db
    .prepare(`SELECT name FROM pragma_table_info('tasks')`)
    .all() as Array<{ name: string }>;
  const have = new Set(rows.map((r) => r.name));
  const addColumn = (name: string, type: string): void => {
    if (have.has(name)) return;
    try {
      db.exec(`ALTER TABLE tasks ADD COLUMN ${name} ${type}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // Another process migrated between our pragma check and the ALTER.
      if (!/duplicate column name/i.test(msg)) throw err;
    }
  };
  addColumn("body_json", "TEXT");
  addColumn("estimated_carbon_g", "REAL");
  addColumn("deadline", "TEXT");
}

function safeStringify(value: unknown): string | null {
  if (value === undefined) return null;
  try {
    return JSON.stringify(value);
  } catch {
    return JSON.stringify({ _repr: String(value) });
  }
}

function safeParse(s: string | null | undefined): unknown {
  if (s == null) return undefined;
  try {
    return JSON.parse(s);
  } catch {
    return undefined;
  }
}

export interface TaskStoreOptions {
  /** Absolute path to a SQLite file. Use ":memory:" for ephemeral storage (tests). */
  dbPath: string;
  /** Inject a pre-opened SQLite database — node:sqlite or better-sqlite3 (useful for tests). */
  db?: SqliteDatabase;
}

export class TaskStore {
  private readonly db: SqliteDatabase;

  constructor(opts: TaskStoreOptions) {
    if (opts.db) {
      this.db = opts.db;
    } else {
      this.db = openSqliteSync(opts.dbPath);
    }
    // v0.11: enable WAL on disk-backed stores. WAL lifts SQLite's
    // single-writer-per-DB-file pessimism so the `ebb tick` daemon and
    // an interactive process can hold separate `TaskStore` handles
    // against `~/.ebb-ai/queue.db`. Writers can still collide briefly
    // (one writer at a time even under WAL), so busy_timeout makes a
    // colliding writer queue for up to 5s instead of throwing
    // SQLITE_BUSY immediately — node:sqlite defaults to 0ms,
    // better-sqlite3 to 5s; the explicit pragma pins both backends to
    // the same behavior. The WAL PRAGMA is persistent in the DB header
    // so running once on first open is enough; busy_timeout is
    // per-connection and must be set on every open. In-memory DBs
    // (`:memory:`) intentionally skip — WAL on ephemeral stores adds
    // no value.
    if (opts.dbPath !== ":memory:") {
      try {
        this.db.exec("PRAGMA journal_mode = WAL");
        this.db.exec("PRAGMA busy_timeout = 5000");
        // synchronous=NORMAL is the standard WAL companion — durable
        // across app crashes, faster than FULL, only loses the very
        // last transaction on a hard power loss. ebb-ai dispatch is
        // idempotent over `task_id`, so the worst case re-runs one task.
        this.db.exec("PRAGMA synchronous = NORMAL");
      } catch {
        // Some drivers (or read-only filesystems) refuse the pragma.
        // The store still works, just without WAL — fall through.
      }
    }
    this.db.exec(SCHEMA);
    ensureColumns(this.db);
    // The ledger stores prompts (redacted only at terminal transitions)
    // next to a 0600 signing key — keep the DB and its WAL side-files
    // out of reach of other local users. Best-effort: never fail open
    // over a chmod error (e.g. exotic filesystems, Windows).
    if (!opts.db && opts.dbPath !== ":memory:") {
      try {
        chmodSync(dirname(opts.dbPath), 0o700);
      } catch {
        // best-effort
      }
      for (const suffix of ["", "-wal", "-shm"]) {
        try {
          const p = `${opts.dbPath}${suffix}`;
          if (existsSync(p)) chmodSync(p, 0o600);
        } catch {
          // best-effort
        }
      }
    }
  }

  upsert(record: TaskRecord<unknown>): void {
    const stmt = this.db.prepare(`
      INSERT INTO tasks (
        task_id, status, enqueued_at, scheduled_for, completed_at,
        region, carbon_budget_g, result_json, error, receipt_json, intensity_source,
        body_json, estimated_carbon_g, deadline
      ) VALUES (
        @task_id, @status, @enqueued_at, @scheduled_for, @completed_at,
        @region, @carbon_budget_g, @result_json, @error, @receipt_json, @intensity_source,
        @body_json, @estimated_carbon_g, @deadline
      )
      ON CONFLICT(task_id) DO UPDATE SET
        status             = excluded.status,
        scheduled_for      = excluded.scheduled_for,
        completed_at       = excluded.completed_at,
        region             = excluded.region,
        carbon_budget_g    = excluded.carbon_budget_g,
        result_json        = excluded.result_json,
        error              = excluded.error,
        receipt_json       = excluded.receipt_json,
        intensity_source   = excluded.intensity_source,
        body_json          = excluded.body_json,
        estimated_carbon_g = excluded.estimated_carbon_g,
        deadline           = excluded.deadline
    `);
    stmt.run({
      task_id: record.taskId,
      status: record.status,
      enqueued_at: record.enqueuedAt,
      scheduled_for: record.scheduledFor ?? null,
      completed_at: record.completedAt ?? null,
      region: record.region,
      carbon_budget_g: record.carbonBudgetG ?? null,
      result_json: safeStringify(record.result),
      error: record.error ?? null,
      receipt_json: safeStringify(record.receipt),
      intensity_source: record.intensitySource ?? null,
      body_json: record.bodyJson ?? null,
      estimated_carbon_g: record.estimatedCarbonGCo2 ?? null,
      deadline: record.deadline ?? null,
    });
  }

  get(taskId: string): TaskRecord<unknown> | undefined {
    const row = this.db
      .prepare(`SELECT * FROM tasks WHERE task_id = ?`)
      .get(taskId);
    return row ? rowToRecord(row) : undefined;
  }

  list(filter?: { status?: TaskStatus }): TaskRecord<unknown>[] {
    if (filter?.status) {
      return this.db
        .prepare(`SELECT * FROM tasks WHERE status = ? ORDER BY enqueued_at ASC`)
        .all(filter.status)
        .map(rowToRecord);
    }
    return this.db
      .prepare(`SELECT * FROM tasks ORDER BY enqueued_at ASC`)
      .all()
      .map(rowToRecord);
  }

  /**
   * Atomic row-level claim used by `Scheduler.tick` to prevent two
   * concurrent ticks from dispatching the same task. Returns true if
   * the row was claimed (status changed from "scheduled" to "running"
   * in this call); false if the row had already moved on.
   *
   * With WAL + busy_timeout (v0.11+) two processes can hold writable
   * handles on the same DB file; this row-level claim is what makes a
   * dispatch exactly-once across them (e.g. an interactive `ebb tick`
   * racing the launchd cron, or `expedite_task` racing a cron tick).
   */
  claimScheduled(taskId: string): boolean {
    const stmt = this.db.prepare(
      `UPDATE tasks SET status = 'running' WHERE task_id = ? AND status = 'scheduled'`,
    );
    const res = stmt.run(taskId);
    return Number(res.changes) === 1;
  }

  close(): void {
    this.db.close();
  }
}

function rowToRecord(row: Record<string, unknown>): TaskRecord<unknown> {
  const receipt = safeParse(row.receipt_json as string | null) as
    | CarbonReceipt
    | undefined;
  const result = safeParse(row.result_json as string | null);
  return {
    taskId: row.task_id as string,
    status: row.status as TaskStatus,
    enqueuedAt: row.enqueued_at as string,
    scheduledFor: (row.scheduled_for as string | null) ?? undefined,
    completedAt: (row.completed_at as string | null) ?? undefined,
    region: row.region as string,
    carbonBudgetG: (row.carbon_budget_g as number | null) ?? undefined,
    result,
    error: (row.error as string | null) ?? undefined,
    receipt,
    intensitySource:
      ((row.intensity_source as string | null) as
        | "scored"
        | "current"
        | "expedited"
        | null) ?? undefined,
    bodyJson: (row.body_json as string | null) ?? undefined,
    estimatedCarbonGCo2:
      (row.estimated_carbon_g as number | null) ?? undefined,
    deadline: (row.deadline as string | null) ?? undefined,
  };
}

type SqliteCtor = new (path: string) => SqliteDatabase;

/** Load Node's built-in SQLite (node:sqlite, Node >= 22.5), if available. */
function loadNodeSqlite(): SqliteCtor | undefined {
  try {
    const mod = requireFn("node:sqlite") as { DatabaseSync: SqliteCtor };
    return mod.DatabaseSync;
  } catch {
    return undefined;
  }
}

/** Load the optional better-sqlite3 fallback, if it is installed. */
function loadBetterSqlite(): SqliteCtor | undefined {
  try {
    return requireFn("better-sqlite3") as SqliteCtor;
  } catch {
    return undefined;
  }
}

function openSqliteSync(path: string): SqliteDatabase {
  // Prefer Node's built-in SQLite — no native module to install or compile,
  // which matters where dependencies are installed without build scripts
  // (e.g. OpenClaw plugin installs). better-sqlite3 stays as a fallback for
  // Node < 22.5. createRequire gives a working `require` from ESM emit.
  const Ctor = loadNodeSqlite() ?? loadBetterSqlite();
  if (!Ctor) {
    throw new Error(
      "TaskStore: no SQLite backend available. This build uses Node's " +
        "built-in node:sqlite (Node >= 22.5). Upgrade Node, or install the " +
        "optional better-sqlite3 dependency as a fallback.",
    );
  }
  return new Ctor(path);
}
