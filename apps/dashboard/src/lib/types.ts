/**
 * Dashboard-local copies of the @ebb-ai/core-ts public types.
 *
 * These intentionally duplicate `packages/core-ts/src/types.ts` so the
 * dashboard has zero workspace-package dependencies in v0.2 (we don't want
 * to fight the TypeScript ESM/CJS interop story while the dashboard is
 * still under heavy iteration).
 *
 * If/when the dashboard starts calling the MCP server or core-ts directly
 * (planned for v0.3 per `PLAN.md` §4.4), replace these with an import
 * from `@ebb-ai/core` and delete this file.
 */

export type TaskStatus =
  | "queued"
  | "scheduled"
  | "running"
  | "completed"
  | "failed";

export type CarbonBand =
  | "very_clean"
  | "clean"
  | "average"
  | "dirty"
  | "very_dirty";

export interface GridForecastEntry {
  /** ISO-8601 start of this hour. */
  datetime: string;
  /** Grams CO2-equivalent per kWh — marginal or average, see source. */
  carbonIntensityGCo2PerKwh: number;
  band: CarbonBand;
}

export interface GridForecast {
  region: string;
  source: "electricityMaps" | "wattTime" | "mock";
  /** ISO-8601 timestamp when this forecast was generated. */
  generatedAt: string;
  entries: GridForecastEntry[];
}

export interface CarbonReceipt {
  taskId: string;
  ranAt: string;
  region: string;
  estimatedCarbonGCo2: number;
  provider?: string;
  model?: string;
  /** Wall-clock duration of the dispatched call, in milliseconds. */
  durationMs?: number;
}

export interface TaskRecord<T = unknown> {
  taskId: string;
  status: TaskStatus;
  enqueuedAt: string;
  scheduledFor?: string;
  completedAt?: string;
  region: string;
  carbonBudgetG?: number;
  result?: T;
  error?: string;
  receipt?: CarbonReceipt;
  intensitySource?: "scored" | "current";
}
