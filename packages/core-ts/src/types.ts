/**
 * Public + internal types for @ebb-ai/core.
 */

export type TaskStatus =
  | "queued"
  | "scheduled"
  | "running"
  | "completed"
  | "failed"
  | "cancelled";

export interface DeferOptions {
  /** ISO-8601 deadline; defaults to 24h from now if omitted. Must be in the future. */
  deadline?: string | Date;
  /**
   * Maximum carbon budget for this task in grams CO2-equivalent. If set, the
   * scheduler will reject windows whose estimated grams exceed this value and
   * will fail the task with a CarbonBudgetExceededError if no window inside
   * the deadline meets the budget.
   */
  carbonBudgetG?: number;
  /** Electricity Maps region code (e.g. "US-CAL-CISO"). */
  region?: string;
  /** Caller-supplied identifier for tracing. Must be a non-empty string and unique within the scheduler. */
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
  source: "electricityMaps" | "ukCarbonIntensity" | "wattTime" | "mock";
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
  /** The prompt as stored on the receipt — redacted per ProviderCallSpec.redactInReceipt. */
  prompt?: string;
  /** Total tokens (input + output) reported by the provider, if any. */
  totalTokens?: number;
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
  /** "scored" if the receipt was computed from the forecast entry the
   *  scheduler used to choose the window; "current" if the task was
   *  dispatched immediately and the receipt used a freshly-fetched
   *  intensity; "expedited" if the caller explicitly asked the
   *  scheduler to skip its chosen window (via `expediteTask`).
   */
  intensitySource?: "scored" | "current" | "expedited";
  /**
   * JSON-serializable task body. v0.4 introduces persistent provider-call
   * task bodies so the cron-tick CLI can dispatch a queued task even after
   * the enqueuing process has exited. Set on the record when the task was
   * enqueued via `Scheduler.enqueueProviderCall`. Closure-based tasks
   * (`Scheduler.defer` / `enqueue`) do not populate this field.
   */
  bodyJson?: string;
}

/**
 * JSON-serializable provider-call body. Persisted in the SQLite ledger as
 * `body_json`. The cron-tick CLI rehydrates this struct and dispatches it
 * against the matching provider adapter, so a task survives the
 * enqueuing process going away.
 */
export interface ProviderCallSpec {
  type: "provider_call";
  provider: "anthropic" | "openai";
  model: string;
  prompt: string;
  systemPrompt?: string;
  maxTokens?: number;
  temperature?: number;
  /** If true, route through Batch API when deadline > 24h out. Default true. */
  preferBatch?: boolean;
  /**
   * Optional file path. When set, the dispatcher writes
   * `{ taskId, result, receipt }` as JSON to this path after a
   * successful dispatch. Useful when the caller wants to drop the
   * result into an inbox or trigger a file-watcher rather than poll
   * `check_queue_status`.
   */
  outputPath?: string;
  /**
   * Optional list of regex patterns that the dispatcher redacts from
   * the prompt before storing it on the receipt. Default behavior
   * (when this field is omitted) redacts strings that look like API
   * keys (`sk-...`, `ak_...`, OAuth bearer tokens). Pass `[]` to
   * disable redaction entirely. The receipt's `prompt` field is
   * always the redacted version; the dispatched call uses the
   * original.
   */
  redactInReceipt?: string[];
}

/** Per-task outcome returned by `Scheduler.tick`. */
export interface TickResultEntry {
  taskId: string;
  status: "completed" | "failed";
  error?: string;
}

/** Aggregate result of one call to `Scheduler.tick`. */
export interface TickResult {
  inspected: number;
  dispatched: number;
  failed: number;
  results: TickResultEntry[];
}

/** Function the user hands to `defer`. */
export type DeferrableTask<T> = () => Promise<T> | T;

/** Source of carbon-intensity data for a region. */
export interface GridFeed {
  readonly source: GridForecast["source"];
  fetchForecast(region: string, hours: number): Promise<GridForecast>;
}

/**
 * Input shape for `recommendWindow` — the planning endpoint that returns
 * the optimal execution time for a task without scheduling it.
 *
 * Unlike `DeferOptions`, `region` is **required** on the public surface:
 * `recommend_window` is intended to be called from an agent that is making
 * an explicit, deliberate planning decision and should always be clear about
 * which grid it is reasoning over.
 */
export interface RecommendOptions {
  /** ISO-8601 deadline; must parse and be in the future. */
  deadline: string | Date;
  /** Electricity Maps zone code (e.g. "US-CAL-CISO"). Required. */
  region: string;
  /**
   * Optional hard cap on grams CO2-equivalent for this task. Forecast entries
   * above the budget are dropped *before* the cheapest window is selected.
   * Throws `CarbonBudgetExceededError` if no window inside the deadline meets
   * the budget.
   */
  carbonBudgetG?: number;
  /**
   * Optional vendor model name (e.g. "claude-sonnet-4-5", "gpt-4.1-mini"). Used
   * purely for shaping the `reasoning` string when Batch API is applicable
   * (deadline > 24h out). Does not affect the chosen window.
   */
  model?: string;
}

/**
 * One non-chosen-but-still-clean alternative returned by `recommendWindow`.
 * Identical fields to the top-level result minus `alternatives` + `reasoning`.
 */
export interface RecommendAlternative {
  scheduledFor: string;
  intensityGCo2PerKwh: number;
  band: GridForecastEntry["band"];
  estimatedCarbonGCo2: number;
  estimatedSavingsVsNowPct: number;
}

/**
 * Output of `recommendWindow`. Field names are canonical camelCase on the TS
 * surface; the MCP server emits the snake_case variant in its text payload.
 */
export interface RecommendResult {
  /** Recommended window start, ISO-8601. */
  scheduledFor: string;
  /** Grid intensity at the chosen window, from the forecast entry. */
  intensityGCo2PerKwh: number;
  /** Band classification of the chosen window. */
  band: GridForecastEntry["band"];
  /** Estimated grams CO2e for one task at the chosen window, rounded to 0.1. */
  estimatedCarbonGCo2: number;
  /** Integer % savings vs running right now (forecast entry[0]). */
  estimatedSavingsVsNowPct: number;
  /** True if deadline is more than 24h from now (Batch API window). */
  batchEligible: boolean;
  /** Top 3 next-cheapest in-deadline windows after the chosen one. */
  alternatives: RecommendAlternative[];
  /** Human-readable one-line explanation for an LLM caller. */
  reasoning: string;
}
