/**
 * `ebb receipts list` — print carbon receipts for completed tasks.
 */

import { TaskStore } from "@ebb-ai/core";
import type { TaskRecord } from "@ebb-ai/core";
import { defaultDbPath } from "./tick.js";

export interface ReceiptsListOptions {
  db?: string;
  since?: string;
}

export interface ReceiptsListResult {
  rows: TaskRecord<unknown>[];
  rendered: string;
}

function fmtCol(value: string | number | undefined, width: number): string {
  const s = value === undefined || value === null ? "-" : String(value);
  return (s.length > width ? s.slice(0, width - 1) + "…" : s).padEnd(width);
}

export function renderReceipts(rows: TaskRecord<unknown>[]): string {
  const header =
    fmtCol("task_id", 38) +
    fmtCol("ran_at", 26) +
    fmtCol("region", 16) +
    fmtCol("est_g_co2", 12) +
    fmtCol("duration_ms", 12);
  const sep = "-".repeat(header.length);
  const lines = rows.map((r) => {
    const rec = r.receipt;
    return (
      fmtCol(r.taskId, 38) +
      fmtCol(rec?.ranAt ?? r.completedAt, 26) +
      fmtCol(rec?.region ?? r.region, 16) +
      fmtCol(rec?.estimatedCarbonGCo2, 12) +
      fmtCol(rec?.durationMs, 12)
    );
  });
  return [header, sep, ...lines].join("\n");
}

export async function runReceiptsList(
  opts: ReceiptsListOptions = {},
): Promise<ReceiptsListResult> {
  const dbPath = opts.db ?? defaultDbPath();
  const store = new TaskStore({ dbPath });
  try {
    const all = store.list({ status: "completed" });
    let rows = all;
    if (opts.since) {
      const sinceMs = new Date(opts.since).getTime();
      if (Number.isNaN(sinceMs)) {
        throw new Error(
          `receipts list: --since ${JSON.stringify(opts.since)} is not a valid ISO-8601 timestamp`,
        );
      }
      rows = rows.filter((r) => {
        const t = r.receipt?.ranAt ?? r.completedAt;
        return t ? new Date(t).getTime() >= sinceMs : false;
      });
    }
    return { rows, rendered: renderReceipts(rows) };
  } finally {
    store.close();
  }
}
