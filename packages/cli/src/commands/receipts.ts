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

/** True when the receipt's carbon was derived from the synthetic curve. */
function isMock(rec: TaskRecord<unknown>["receipt"]): boolean {
  return rec?.gridSource === "mock";
}

export function renderReceipts(rows: TaskRecord<unknown>[]): string {
  const header =
    fmtCol("task_id", 38) +
    fmtCol("ran_at", 26) +
    fmtCol("region", 16) +
    fmtCol("est_g_co2", 12) +
    fmtCol("intensity", 12) +
    fmtCol("grid_source", 16) +
    fmtCol("energy_src", 12) +
    fmtCol("duration_ms", 12);
  const sep = "-".repeat(header.length);
  const lines = rows.map((r) => {
    const rec = r.receipt;
    const mock = isMock(rec);
    // Mark synthetic grid data loudly so no one mistakes it for real.
    const gridSource = rec?.gridSource
      ? mock
        ? `mock(SYNTH)`
        : rec.gridSource
      : undefined;
    return (
      fmtCol(r.taskId, 38) +
      fmtCol(rec?.ranAt ?? r.completedAt, 26) +
      fmtCol(rec?.region ?? r.region, 16) +
      fmtCol(rec?.estimatedCarbonGCo2, 12) +
      fmtCol(rec?.intensityGCo2PerKwh, 12) +
      fmtCol(gridSource, 16) +
      fmtCol(rec?.energySource, 12) +
      fmtCol(rec?.durationMs, 12)
    );
  });
  const out = [header, sep, ...lines];
  if (rows.some((r) => isMock(r.receipt))) {
    out.push(
      "",
      "!! MOCK DATA: rows with grid_source=mock(SYNTH) used the synthetic",
      "   fallback curve, not a real grid feed — their carbon is illustrative.",
    );
  }
  return out.join("\n");
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
