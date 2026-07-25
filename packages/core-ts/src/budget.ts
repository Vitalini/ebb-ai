/**
 * Carbon-budget alerts over the receipt ledger (ROADMAP item 4).
 *
 * Distinct from the per-task `carbonBudgetG` hard cap (which rejects a
 * single task's dirty windows at schedule time), an *aggregate* carbon
 * budget is a threshold on the total carbon actually spent across a
 * rolling window — daily / weekly / monthly — read straight off the
 * completed receipts already in the ledger. Crossing the threshold fires
 * an alert exactly once per (window, threshold); the fired marker is
 * persisted in the same SQLite ledger so the alert is idempotent across
 * process restarts and safe against a multi-process double-fire.
 *
 * This module is pure over its inputs (no clock reads except where a
 * caller passes `at`, no I/O except `loadCarbonBudgetConfig` which reads
 * the config file). Everything else — the DB marker, the scheduler hook,
 * the CLI/MCP/plugin surfaces — is layered on top.
 *
 * No telemetry, no network: the budget is computed entirely from the
 * local ledger. Receipts and signing are untouched — an alert is derived
 * state, never a signed artifact.
 */

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { CarbonReceipt, TaskRecord } from "./types.js";

/** The rolling windows an aggregate carbon budget can be scoped to. */
export type CarbonBudgetWindowKind = "daily" | "weekly" | "monthly";

/** A configured aggregate carbon budget. */
export interface CarbonBudgetConfig {
  /** Rolling window the threshold applies over. */
  windowKind: CarbonBudgetWindowKind;
  /** Threshold in grams CO2-equivalent for one window. */
  thresholdG: number;
}

/**
 * The payload handed to the `onCarbonAlert` scheduler hook when a window's
 * consumption first crosses the configured threshold.
 */
export interface CarbonAlert {
  windowKind: CarbonBudgetWindowKind;
  /** ISO-8601 start of the window that was crossed. */
  windowStart: string;
  /** The configured threshold, in grams CO2-equivalent. */
  thresholdG: number;
  /** Total window consumption at the moment of crossing, in grams. */
  actualG: number;
  /** Id of the task whose completion pushed the window over the threshold. */
  taskIdThatCrossed: string;
}

/** A computed budget-status snapshot for the current window. */
export interface CarbonBudgetStatus {
  windowKind: CarbonBudgetWindowKind;
  /** ISO-8601 window start. */
  windowStart: string;
  /** ISO-8601 window end (exclusive). */
  windowEnd: string;
  thresholdG: number;
  /** Carbon spent so far this window (actual, falling back to estimated). */
  usedG: number;
  /** `usedG / thresholdG` as an integer percent (0 when threshold is 0). */
  pct: number;
  /** How many completed tasks contributed to `usedG`. */
  taskCount: number;
  /** True once `usedG >= thresholdG`. */
  exceeded: boolean;
  /** True once an alert has been recorded for this (window, threshold). */
  alerted: boolean;
}

const CONFIG_WINDOW_ENV = "EBB_CARBON_BUDGET_WINDOW";
const CONFIG_THRESHOLD_ENV = "EBB_CARBON_BUDGET_G";

/** Absolute path to the aggregate-budget config file. */
export function carbonBudgetConfigPath(): string {
  return join(homedir(), ".ebb-ai", "config");
}

/**
 * The carbon a single receipt contributes to a window: the *actual* grams
 * billed against the observed intensity, falling back to the schedule-time
 * *estimate* when a task was dispatched without a separate projection.
 */
export function receiptCarbonG(receipt: CarbonReceipt | undefined): number {
  if (!receipt) return 0;
  if (typeof receipt.actualCarbonGCo2 === "number") return receipt.actualCarbonGCo2;
  if (typeof receipt.estimatedCarbonGCo2 === "number") return receipt.estimatedCarbonGCo2;
  return 0;
}

/**
 * UTC bounds `[start, end)` of the window of `kind` containing `at`.
 *   - daily:   the UTC calendar day.
 *   - weekly:  the ISO week (Monday 00:00 UTC → next Monday).
 *   - monthly: the UTC calendar month.
 */
export function windowBounds(
  kind: CarbonBudgetWindowKind,
  at: Date,
): { start: Date; end: Date } {
  const y = at.getUTCFullYear();
  const m = at.getUTCMonth();
  const d = at.getUTCDate();
  if (kind === "daily") {
    const start = new Date(Date.UTC(y, m, d));
    const end = new Date(Date.UTC(y, m, d + 1));
    return { start, end };
  }
  if (kind === "monthly") {
    const start = new Date(Date.UTC(y, m, 1));
    const end = new Date(Date.UTC(y, m + 1, 1));
    return { start, end };
  }
  // weekly — ISO week starting Monday.
  const dow = new Date(Date.UTC(y, m, d)).getUTCDay(); // 0=Sun..6=Sat
  const mondayOffset = (dow + 6) % 7; // days since Monday
  const start = new Date(Date.UTC(y, m, d - mondayOffset));
  const end = new Date(Date.UTC(y, m, d - mondayOffset + 7));
  return { start, end };
}

/** A completed row's receipt timestamp, in ms, or NaN if unusable. */
function receiptRanAtMs(row: TaskRecord<unknown>): number {
  const iso = row.receipt?.ranAt;
  if (!iso) return Number.NaN;
  const t = new Date(iso).getTime();
  return Number.isNaN(t) ? Number.NaN : t;
}

/** The consumption of a rolling window, summed over the supplied rows. */
export interface CarbonBudgetUsage {
  windowStart: string;
  windowEnd: string;
  usedG: number;
  taskCount: number;
}

/**
 * Sum the carbon of every receipt whose `ranAt` falls inside the window of
 * `kind` containing `at`. Rows without a receipt (or without a parseable
 * `ranAt`) are skipped. Pure — deterministic over `rows` + `at`.
 */
export function carbonBudgetUsage(
  rows: TaskRecord<unknown>[],
  kind: CarbonBudgetWindowKind,
  at: Date,
): CarbonBudgetUsage {
  const { start, end } = windowBounds(kind, at);
  const startMs = start.getTime();
  const endMs = end.getTime();
  let usedG = 0;
  let taskCount = 0;
  for (const row of rows) {
    if (!row.receipt) continue;
    const t = receiptRanAtMs(row);
    if (Number.isNaN(t) || t < startMs || t >= endMs) continue;
    usedG += receiptCarbonG(row.receipt);
    taskCount += 1;
  }
  return {
    windowStart: start.toISOString(),
    windowEnd: end.toISOString(),
    usedG: Math.round(usedG * 100) / 100,
    taskCount,
  };
}

/**
 * A full budget-status snapshot for the current window: consumption vs
 * threshold, percent, and whether an alert has already fired. `alerted`
 * is supplied by the caller (a DB probe) so this stays a pure function.
 */
export function carbonBudgetStatus(
  rows: TaskRecord<unknown>[],
  config: CarbonBudgetConfig,
  at: Date,
  alerted: boolean,
): CarbonBudgetStatus {
  const usage = carbonBudgetUsage(rows, config.windowKind, at);
  const pct =
    config.thresholdG > 0
      ? Math.round((usage.usedG / config.thresholdG) * 100)
      : 0;
  return {
    windowKind: config.windowKind,
    windowStart: usage.windowStart,
    windowEnd: usage.windowEnd,
    thresholdG: config.thresholdG,
    usedG: usage.usedG,
    pct,
    taskCount: usage.taskCount,
    exceeded: usage.usedG >= config.thresholdG,
    alerted,
  };
}

function normalizeWindowKind(raw: string | undefined): CarbonBudgetWindowKind | undefined {
  const v = raw?.trim().toLowerCase();
  if (v === "daily" || v === "weekly" || v === "monthly") return v;
  return undefined;
}

/**
 * Tiny KEY=VALUE parser — the same shape as the `~/.config/ebb/env` secrets
 * file so the config format is one the project already establishes.
 * `#` comments, blank lines, one layer of surrounding quotes.
 */
function parseKeyValues(contents: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const rawLine of contents.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    if (!key) continue;
    let value = line.slice(eq + 1).trim();
    if (
      value.length >= 2 &&
      ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'")))
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

/**
 * The only two environment variables this module consults. Declared as a
 * closed shape rather than the whole environment: the loader must never hold
 * a reference to `process.env` as a whole (see `loadCarbonBudgetConfig`).
 */
export interface CarbonBudgetEnv {
  EBB_CARBON_BUDGET_G?: string;
  EBB_CARBON_BUDGET_WINDOW?: string;
}

export interface LoadCarbonBudgetOptions {
  /** Override the config file path (tests). Defaults to `~/.ebb-ai/config`. */
  path?: string;
  /** Override the two recognized variables (tests). Defaults to reading them
   *  by name from `process.env`. */
  env?: CarbonBudgetEnv;
}

/**
 * Resolve the aggregate carbon budget from the `~/.ebb-ai/config` KEY=VALUE
 * file, with same-named environment variables taking precedence (exactly the
 * secrets-file precedence: an explicit env var always wins). Returns
 * `undefined` when no threshold is configured (feature off), or when the
 * values are malformed — a broken config never throws, it just disables the
 * feature.
 *
 * Recognized keys (file or env):
 *   - `EBB_CARBON_BUDGET_G`      — threshold in grams CO2e (required to enable)
 *   - `EBB_CARBON_BUDGET_WINDOW` — daily | weekly | monthly (default: daily)
 */
export function loadCarbonBudgetConfig(
  opts: LoadCarbonBudgetOptions = {},
): CarbonBudgetConfig | undefined {
  // Read the two budget variables BY NAME. Binding all of `process.env` to a
  // local (the previous `opts.env ?? process.env`) put every secret the host
  // happens to export into this scope, which is indistinguishable from
  // credential harvesting to a static auditor — and needlessly so: the values
  // read here are a gram threshold and a window name that never leave the
  // process. Keep the reads narrow and literal.
  const env: CarbonBudgetEnv = opts.env ?? {
    EBB_CARBON_BUDGET_G: process.env.EBB_CARBON_BUDGET_G,
    EBB_CARBON_BUDGET_WINDOW: process.env.EBB_CARBON_BUDGET_WINDOW,
  };
  const path = opts.path ?? carbonBudgetConfigPath();
  let fileValues: Record<string, string> = {};
  if (existsSync(path)) {
    try {
      fileValues = parseKeyValues(readFileSync(path, "utf8"));
    } catch {
      fileValues = {};
    }
  }
  const rawThreshold = env[CONFIG_THRESHOLD_ENV] ?? fileValues[CONFIG_THRESHOLD_ENV];
  const rawWindow = env[CONFIG_WINDOW_ENV] ?? fileValues[CONFIG_WINDOW_ENV];
  if (rawThreshold === undefined || String(rawThreshold).trim() === "") {
    return undefined;
  }
  const thresholdG = Number(rawThreshold);
  if (!Number.isFinite(thresholdG) || thresholdG <= 0) return undefined;
  const windowKind = normalizeWindowKind(rawWindow) ?? "daily";
  return { windowKind, thresholdG };
}
