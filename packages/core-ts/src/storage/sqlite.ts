/**
 * SQLite-backed durable task store.
 *
 * v0.1 of the scheduler kept TaskRecords in a Map; restarting the process
 * lost queued work. v0.2 introduces an opt-in persistent store: pass
 * { dbPath } to the Scheduler and queued / completed records survive
 * a restart and remain auditable as a carbon ledger.
 *
 * We use better-sqlite3 because it is synchronous, single-binary, and
 * has zero spin-up cost — appropriate for an in-process queue store.
 *
 * Schema is intentionally narrow:
 *   - task_id           PRIMARY KEY
 *   - status            queued | scheduled | running | completed | failed
 *   - enqueued_at       ISO-8601
 *   - scheduled_for     ISO-8601 (nullable)
 *   - completed_at      ISO-8601 (nullable)
 *   - region            grid region code
 *   - carbon_budget_g   REAL (nullable)
 *   - result_json       text (nullable)
 *   - error             text (nullable)
 *   - receipt_json      text (nullable)
 *   - intensity_source  "scored" | "current" (nullable)
 *
 * `result_json` is serialized via JSON.stringify; values that are not
 * JSON-serializable are stored as `{ "_repr": "<toString>" }` so audit
 * trails survive odd values without crashing the store.
 */

import { createRequire } from "node:module";
import type { CarbonReceipt, TaskRecord, TaskStatus } from "../types.js";

const requireFn = createRequire(import.meta.url);

interface SqliteDatabase {
  exec(sql: string): void;
  prepare(sql: string): SqlitePreparedStatement;
  close(): void;
}

interface SqlitePreparedStatement {
  run(...params: unknown[]): { changes: number; lastInsertRowid: number | bigint };
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
  body_json         TEXT
);
CREATE INDEX IF NOT EXISTS tasks_status_idx ON tasks(status);
CREATE INDEX IF NOT EXISTS tasks_enqueued_idx ON tasks(enqueued_at);
`;

/**
 * v0.4 idempotent migration: `body_json` column added for persistent
 * provider-call task bodies. SQLite allows `ADD COLUMN` on a non-empty
 * table because the new column is nullable. We check
 * `pragma_table_info` first so re-running on an already-migrated DB
 * (including a freshly created v0.4 DB) is a no-op.
 */
function ensureBodyJsonColumn(db: SqliteDatabase): void {
  const rows = db
    .prepare(`SELECT name FROM pragma_table_info('tasks')`)
    .all() as Array<{ name: string }>;
  const hasBodyJson = rows.some((r) => r.name === "body_json");
  if (!hasBodyJson) {
    db.exec(`ALTER TABLE tasks ADD COLUMN body_json TEXT`);
  }
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
  /** Inject a pre-opened better-sqlite3 instance (useful for tests). */
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
    this.db.exec(SCHEMA);
    ensureBodyJsonColumn(this.db);
  }

  upsert(record: TaskRecord<unknown>): void {
    const stmt = this.db.prepare(`
      INSERT INTO tasks (
        task_id, status, enqueued_at, scheduled_for, completed_at,
        region, carbon_budget_g, result_json, error, receipt_json, intensity_source, body_json
      ) VALUES (
        @task_id, @status, @enqueued_at, @scheduled_for, @completed_at,
        @region, @carbon_budget_g, @result_json, @error, @receipt_json, @intensity_source, @body_json
      )
      ON CONFLICT(task_id) DO UPDATE SET
        status            = excluded.status,
        scheduled_for     = excluded.scheduled_for,
        completed_at      = excluded.completed_at,
        region            = excluded.region,
        carbon_budget_g   = excluded.carbon_budget_g,
        result_json       = excluded.result_json,
        error             = excluded.error,
        receipt_json      = excluded.receipt_json,
        intensity_source  = excluded.intensity_source,
        body_json         = excluded.body_json
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
        | null) ?? undefined,
    bodyJson: (row.body_json as string | null) ?? undefined,
  };
}

function openSqliteSync(path: string): SqliteDatabase {
  // better-sqlite3 is a CommonJS module. The top-of-file
  // createRequire(import.meta.url) gives us a working `require` from
  // within ESM emit, without bundler interference.
  type Ctor = new (path: string) => SqliteDatabase;
  let Database: Ctor;
  try {
    Database = requireFn("better-sqlite3") as Ctor;
  } catch {
    throw new Error(
      "TaskStore: `better-sqlite3` is not installed. It is a regular dependency of @ebb-ai/core; reinstall with `pnpm install`.",
    );
  }
  return new Database(path);
}
