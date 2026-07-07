/**
 * Aggregate carbon receipts into the personal-impact stats the v0.8
 * dashboard and CLI surface.
 *
 * Inputs are TaskRecord rows read from a TaskStore (typically
 * `~/.ebb-ai/queue.db`). Output is pure data — no I/O. Renderers
 * (CLI / dashboard) layer formatting on top.
 *
 * Scope of v0.8 (local-only): aggregates exactly what is stored on
 * receipts today. Cross-user counters and ranked leaderboards are
 * deferred to v0.9 once a privacy-conscious telemetry endpoint exists.
 */

import { LEGACY_KWH_PER_TASK } from "./energy.js";
import type { CarbonReceipt, TaskRecord } from "./types.js";

/**
 * Flat energy cost of one dispatched LLM call, re-exported from the
 * energy module (single source of truth) under the aggregator's
 * historical name. Only used to back-derive intensity from legacy
 * receipts that predate `receipt.intensityGCo2PerKwh`.
 */
export const ASSUMED_KWH_PER_CALL = LEGACY_KWH_PER_TASK;

/**
 * Aggregate carbon stats. All fields are deterministic over the input
 * rows — no clock reads, no random number generators — so the same set
 * of completed receipts always yields the same output (useful for tests
 * and for diff-visible CI snapshots).
 */
export interface CarbonStats {
  /** Number of completed tasks aggregated. */
  taskCount: number;
  /** Sum of `receipt.estimatedCarbonGCo2`, in grams CO2-equivalent. */
  totalEstimatedCarbonGCo2: number;
  /** Number of tasks whose receipt indicates the scored window was honoured. */
  scoredHits: number;
  /** Number of tasks dispatched immediately (no scheduling deferral). */
  currentDispatches: number;
  /** Number of tasks explicitly expedited past their scored window. */
  expeditedDispatches: number;
  /** Earliest receipt ranAt timestamp. ISO-8601, or null if no rows. */
  firstRanAt: string | null;
  /** Latest receipt ranAt timestamp. ISO-8601, or null if no rows. */
  lastRanAt: string | null;
}

/** Per-region aggregation. */
export interface RegionStats {
  region: string;
  taskCount: number;
  totalEstimatedCarbonGCo2: number;
  /** Average grams CO2-equivalent per task. */
  avgEstimatedCarbonGCo2: number;
}

/** Per-band ("clean", "average", ...) histogram derived from receipts. */
export interface BandHistogram {
  veryClean: number;
  clean: number;
  average: number;
  dirty: number;
  veryDirty: number;
}

/**
 * Local-only achievements. Pure function of CarbonStats + RegionStats,
 * so tests can pin the exact bag of badges for a given input set.
 */
export interface Achievement {
  id: string;
  label: string;
  description: string;
  unlocked: boolean;
}

/** Bucket a grams-per-kWh number into the same band the grid feed uses. */
export function classifyBand(g: number): keyof BandHistogram {
  if (g < 100) return "veryClean";
  if (g < 250) return "clean";
  if (g < 450) return "average";
  if (g < 700) return "dirty";
  return "veryDirty";
}

/**
 * Aggregate the receipts on a set of TaskRecord rows. Rows without a
 * receipt are silently skipped (e.g. completed without dispatch metadata,
 * or failed before receipt creation).
 */
export function aggregateStats(rows: TaskRecord<unknown>[]): CarbonStats {
  let totalEstimatedCarbonGCo2 = 0;
  let scoredHits = 0;
  let currentDispatches = 0;
  let expeditedDispatches = 0;
  let firstRanAtMs = Number.POSITIVE_INFINITY;
  let lastRanAtMs = Number.NEGATIVE_INFINITY;
  let firstRanAt: string | null = null;
  let lastRanAt: string | null = null;
  let counted = 0;

  for (const row of rows) {
    const r = row.receipt;
    if (!r) continue;
    counted += 1;
    totalEstimatedCarbonGCo2 += r.estimatedCarbonGCo2 ?? 0;
    if (row.intensitySource === "scored") scoredHits += 1;
    else if (row.intensitySource === "current") currentDispatches += 1;
    else if (row.intensitySource === "expedited") expeditedDispatches += 1;
    if (r.ranAt) {
      const t = new Date(r.ranAt).getTime();
      if (!Number.isNaN(t)) {
        if (t < firstRanAtMs) {
          firstRanAtMs = t;
          firstRanAt = r.ranAt;
        }
        if (t > lastRanAtMs) {
          lastRanAtMs = t;
          lastRanAt = r.ranAt;
        }
      }
    }
  }

  return {
    taskCount: counted,
    totalEstimatedCarbonGCo2: Math.round(totalEstimatedCarbonGCo2 * 100) / 100,
    scoredHits,
    currentDispatches,
    expeditedDispatches,
    firstRanAt,
    lastRanAt,
  };
}

/** Per-region aggregation, sorted by task count descending. */
export function aggregateByRegion(rows: TaskRecord<unknown>[]): RegionStats[] {
  const byRegion = new Map<string, { taskCount: number; totalEstimatedCarbonGCo2: number }>();
  for (const row of rows) {
    const r = row.receipt;
    if (!r) continue;
    const region = r.region ?? row.region ?? "unknown";
    const bucket = byRegion.get(region) ?? { taskCount: 0, totalEstimatedCarbonGCo2: 0 };
    bucket.taskCount += 1;
    bucket.totalEstimatedCarbonGCo2 += r.estimatedCarbonGCo2 ?? 0;
    byRegion.set(region, bucket);
  }
  return Array.from(byRegion.entries())
    .map(([region, b]) => ({
      region,
      taskCount: b.taskCount,
      totalEstimatedCarbonGCo2: Math.round(b.totalEstimatedCarbonGCo2 * 100) / 100,
      avgEstimatedCarbonGCo2:
        b.taskCount > 0
          ? Math.round((b.totalEstimatedCarbonGCo2 / b.taskCount) * 100) / 100
          : 0,
    }))
    .sort((a, b) => b.taskCount - a.taskCount);
}

/**
 * Build a band histogram. Receipts that record the raw grid intensity
 * (`intensityGCo2PerKwh`, v0.12+) are classified directly. Legacy
 * receipts fall back to back-deriving intensity as
 * `estimatedCarbonGCo2 / ASSUMED_KWH_PER_CALL` — valid only for the
 * flat pre-v0.10 energy model, which is exactly what those old
 * receipts were computed with.
 */
export function bandHistogram(rows: TaskRecord<unknown>[]): BandHistogram {
  const out: BandHistogram = {
    veryClean: 0,
    clean: 0,
    average: 0,
    dirty: 0,
    veryDirty: 0,
  };
  for (const row of rows) {
    const r = row.receipt;
    if (!r) continue;
    if (r.intensityGCo2PerKwh != null) {
      out[classifyBand(r.intensityGCo2PerKwh)] += 1;
      continue;
    }
    if (r.estimatedCarbonGCo2 == null) continue;
    const intensity = r.estimatedCarbonGCo2 / ASSUMED_KWH_PER_CALL;
    out[classifyBand(intensity)] += 1;
  }
  return out;
}

/**
 * Compute the local-only achievement list. Each badge has a stable id
 * so a dashboard widget can pin the renderer to specific badges. v0.9
 * will extend this with global achievements (top-N in zone, etc.)
 * once a backend exists.
 */
export function achievements(
  stats: CarbonStats,
  perRegion: RegionStats[],
): Achievement[] {
  const regions = new Set(perRegion.map((r) => r.region));
  const days =
    stats.firstRanAt && stats.lastRanAt
      ? Math.max(
          1,
          Math.ceil(
            (new Date(stats.lastRanAt).getTime() -
              new Date(stats.firstRanAt).getTime()) /
              (24 * 60 * 60 * 1000),
          ),
        )
      : 0;

  return [
    {
      id: "first-deferral",
      label: "🌱  First Deferral",
      description: "Queue your first ebb-ai task.",
      unlocked: stats.taskCount >= 1,
    },
    {
      id: "ten-deferrals",
      label: "⚡  Ten Up",
      description: "Ship 10 deferred tasks.",
      unlocked: stats.taskCount >= 10,
    },
    {
      id: "hundred-deferrals",
      label: "🔋  Centurion",
      description: "Ship 100 deferred tasks.",
      unlocked: stats.taskCount >= 100,
    },
    {
      id: "thousand-deferrals",
      label: "🌍  Long Run",
      description: "Ship 1 000 deferred tasks.",
      unlocked: stats.taskCount >= 1_000,
    },
    {
      id: "multi-region",
      label: "🗺️  World Tour",
      description: "Dispatch across three or more grid regions.",
      unlocked: regions.size >= 3,
    },
    {
      id: "scored-streak",
      label: "🎯  Sniper",
      description: "Honour the scored window for 90%+ of completed tasks.",
      unlocked:
        stats.taskCount >= 10 &&
        stats.scoredHits / stats.taskCount >= 0.9,
    },
    {
      id: "endurance",
      label: "📅  Endurance",
      description: "Active across 7+ calendar days.",
      unlocked: days >= 7,
    },
  ];
}
