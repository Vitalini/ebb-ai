/**
 * `ebb queue list` — print the queue, optionally filtered by status.
 *
 * We deliberately avoid a table-printing dependency. Columns are
 * padded with String.prototype.padEnd to a fixed width.
 */

import { TaskStore } from "@ebb-ai/core";
import type { TaskRecord, TaskStatus } from "@ebb-ai/core";
import { defaultDbPath } from "./tick.js";

const VALID_STATUSES: ReadonlySet<TaskStatus> = new Set([
  "queued",
  "scheduled",
  "running",
  "completed",
  "failed",
]);

export interface QueueListOptions {
  db?: string;
  status?: string;
}

export interface QueueListResult {
  rows: TaskRecord<unknown>[];
  rendered: string;
}

function fmtCol(value: string | number | undefined, width: number): string {
  const s = value === undefined || value === null ? "-" : String(value);
  return (s.length > width ? s.slice(0, width - 1) + "…" : s).padEnd(width);
}

export function renderQueue(rows: TaskRecord<unknown>[]): string {
  const header =
    fmtCol("task_id", 38) +
    fmtCol("status", 12) +
    fmtCol("scheduled_for", 26) +
    fmtCol("region", 16) +
    fmtCol("budget_g", 10);
  const sep = "-".repeat(header.length);
  const lines = rows.map(
    (r) =>
      fmtCol(r.taskId, 38) +
      fmtCol(r.status, 12) +
      fmtCol(r.scheduledFor, 26) +
      fmtCol(r.region, 16) +
      fmtCol(r.carbonBudgetG, 10),
  );
  return [header, sep, ...lines].join("\n");
}

export async function runQueueList(
  opts: QueueListOptions = {},
): Promise<QueueListResult> {
  const dbPath = opts.db ?? defaultDbPath();
  const store = new TaskStore({ dbPath });
  try {
    let filter: { status: TaskStatus } | undefined;
    if (opts.status) {
      if (!VALID_STATUSES.has(opts.status as TaskStatus)) {
        throw new Error(
          `queue list: unknown status ${JSON.stringify(opts.status)}. Valid: ${[...VALID_STATUSES].join(", ")}`,
        );
      }
      filter = { status: opts.status as TaskStatus };
    }
    const rows = store.list(filter);
    return { rows, rendered: renderQueue(rows) };
  } finally {
    store.close();
  }
}
