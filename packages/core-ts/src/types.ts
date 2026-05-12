/**
 * Public + internal types for @ebb-ai/core.
 */

export type TaskStatus =
  | "queued"
  | "scheduled"
  | "running"
  | "completed"
  | "failed";

export interface DeferOptions {
  /** ISO-8601 deadline; defaults to 24h from now if omitted. */
  deadline?: string | Date;
  /** Maximum carbon budget for this task in grams CO2-equivalent. */
  carbonBudgetG?: number;
  /** Electricity Maps region code (e.g. "US-CAL-CISO"). */
  region?: string;
  /** Region-locking for privacy ("us-only", "eu-only", etc.). */
  privacy?: string;
  /** Caller-supplied identifier for tracing. */
  taskId?: string;
}

export interface GridForecastEntry {
  /** ISO-8601 start of this hour. */
  datetime: string;
  /** Grams CO2-equivalent per kWh — marginal or average, see source. */
  carbonIntensityGCo2PerKwh: number;
  /** Convenience: same value classified into a band. */
  band: "very_clean" | "clean" | "average" | "dirty" | "very_dirty";
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
}

/** Function the user hands to `defer`. */
export type DeferrableTask<T> = () => Promise<T> | T;

/** Source of carbon-intensity data for a region. */
export interface GridFeed {
  readonly source: GridForecast["source"];
  fetchForecast(region: string, hours: number): Promise<GridForecast>;
}
