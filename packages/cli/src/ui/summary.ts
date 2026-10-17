/**
 * `GET /api/summary` (native clients KTD5): the one answer a compact client
 * renders. Queue counts, unread count, the next run, the next clean grid
 * window and, with `since`, the tasks finished after that cursor. The clean
 * window rule lives here once, so the extension badge and the Mac menu bar
 * show the same numbers.
 */

import type { TaskRecord, TaskStatus, TaskStore } from "@tidegap/core";

import { taskSummary } from "../commands/queue.js";

/** One forecast hour, as `/api/forecast` returns it. */
export interface ForecastPoint {
  /** ISO start of the hour. */
  t: string;
  g: number;
  band: string;
}

export interface CleanWindow {
  start: string;
  end: string;
  /** `very_clean` when every hour is very clean, else `clean` (or the fallback hour's band). */
  band: string;
  /** Lowest intensity in the window, gCO2e/kWh. */
  g: number;
  /** True when the window contains now. */
  now: boolean;
  /** True when no hour is clean: the window is the single cleanest hour. */
  fallback: boolean;
}

const HOUR_MS = 3_600_000;
const CLEAN_BANDS = new Set(["very_clean", "clean"]);
/** Most finished tasks one summary lists. */
export const SUMMARY_FINISHED_MAX = 20;
export const ACTIVE_STATUSES = ["queued", "scheduled", "running", "submitted"] as const satisfies readonly TaskStatus[];

/**
 * The first run of consecutive clean or very clean hours that ends after
 * `now`. Without one, the cleanest hour that ends after `now`, flagged
 * `fallback`. `null` when the forecast has no hour after `now`.
 */
export function nextCleanWindow(points: readonly ForecastPoint[], now: Date): CleanWindow | null {
  const t = now.getTime();
  const hours = points
    .map((p) => ({ ...p, start: Date.parse(p.t) }))
    .filter((p) => Number.isFinite(p.start))
    .sort((a, b) => a.start - b.start);
  const window = (run: typeof hours, fallback: boolean): CleanWindow => {
    const start = run[0]!.start;
    const end = run[run.length - 1]!.start + HOUR_MS;
    return {
      start: new Date(start).toISOString(),
      end: new Date(end).toISOString(),
      band: fallback ? run[0]!.band : run.every((h) => h.band === "very_clean") ? "very_clean" : "clean",
      g: Math.min(...run.map((h) => h.g)),
      now: start <= t && t < end,
      fallback,
    };
  };
  // Runs of consecutive clean hours; the first one that ends after now wins,
  // with the hours of it that already passed (so "now" shows the whole run).
  let run: typeof hours = [];
  for (const h of hours) {
    const prev = run[run.length - 1];
    if (CLEAN_BANDS.has(h.band) && (!prev || h.start === prev.start + HOUR_MS)) {
      run.push(h);
    } else {
      if (run.length > 0 && run[run.length - 1]!.start + HOUR_MS > t) return window(run, false);
      run = CLEAN_BANDS.has(h.band) ? [h] : [];
    }
  }
  if (run.length > 0 && run[run.length - 1]!.start + HOUR_MS > t) return window(run, false);
  const ahead = hours.filter((h) => h.start + HOUR_MS > t);
  if (ahead.length === 0) return null;
  const cleanest = ahead.reduce((best, h) => (h.g < best.g ? h : best));
  return window([cleanest], true);
}

export interface SummaryInput {
  store: TaskStore;
  region: string;
  now: Date;
  /** Forecast points, or `null` when the feed failed. */
  points: readonly ForecastPoint[] | null;
  since?: Date;
}

function brief(r: TaskRecord<unknown>): { task_id: string; title: string } {
  return { task_id: r.taskId, title: String(taskSummary(r).display_title) };
}

/** Assemble the summary body (KTD5). */
export function buildSummary(input: SummaryInput): Record<string, unknown> {
  const { store, now } = input;
  const generatedAt = now.toISOString();
  const counts = Object.fromEntries(ACTIVE_STATUSES.map((s) => [s, store.list({ status: s }).length])) as Record<
    (typeof ACTIVE_STATUSES)[number],
    number
  >;
  const active = ACTIVE_STATUSES.reduce((n, s) => n + counts[s], 0);
  const upcoming = [...store.list({ status: "scheduled" }), ...store.list({ status: "queued" })]
    .filter((r) => r.scheduledFor && Number.isFinite(Date.parse(r.scheduledFor)))
    .sort((a, b) => Date.parse(a.scheduledFor!) - Date.parse(b.scheduledFor!));
  const next = upcoming[0];
  const body: Record<string, unknown> = {
    generated_at: generatedAt,
    region: input.region,
    counts,
    active,
    unread: store.list({ unread: true }).length,
    next_run: next ? { ...brief(next), scheduled_for: next.scheduledFor } : null,
    clean_window: input.points ? nextCleanWindow(input.points, now) : null,
    forecast_ok: input.points !== null,
  };
  if (input.since === undefined) return { ...body, cursor: generatedAt };
  const since = input.since.getTime();
  const finished = [...store.list({ status: "completed" }), ...store.list({ status: "failed" })]
    .filter((r) => r.completedAt && Date.parse(r.completedAt) > since)
    .sort((a, b) => Date.parse(b.completedAt!) - Date.parse(a.completedAt!))
    .slice(0, SUMMARY_FINISHED_MAX);
  return {
    ...body,
    finished: finished.map((r) => ({ ...brief(r), status: r.status, completed_at: r.completedAt })),
    // The server's own clock: clients never compare their clock with ours.
    // With nothing new, keep the caller's cursor so a task stamped just
    // before `generated_at` but written after it is still reported.
    cursor: finished[0]?.completedAt ?? input.since.toISOString(),
  };
}
