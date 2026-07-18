/**
 * Public + internal types for @ebb-ai/core.
 */

import type { RouteWeights, RoutingDecision, RoutingPreview } from "./routing.js";

export type TaskStatus =
  | "queued"
  | "scheduled"
  | "running"
  /**
   * v0.12: the task was routed through a provider Batch API and is
   * awaiting results. `tick()` polls submitted batches and transitions
   * to `completed` only when results actually arrive.
   */
  | "submitted"
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
  /**
   * Cross-provider routing candidates (ROADMAP item 1): `"provider:model"`
   * strings the caller explicitly allows. >= 2 activates routing (the
   * scheduler scores them at the chosen window and dispatches the winner);
   * absent or a single candidate leaves existing behavior unchanged. No
   * silent model swaps — routing only ever picks from this list.
   */
  candidates?: string[];
  /**
   * Optional routing weights `{carbon, cost, latency}` (non-negative,
   * normalized internally). Default `{carbon:0.6, cost:0.3, latency:0.1}`.
   * Ignored unless `candidates` has >= 2 entries.
   */
  routeWeights?: Partial<RouteWeights>;
}

/**
 * Whether an intensity figure is an AVERAGE-emissions signal (the grid's
 * blended intensity across all generation) or a MARGINAL-emissions signal
 * (the emissions rate of the generator that would respond to a change in
 * load — what a marginal-consumption/deferral decision actually moves).
 * Absent means "average", so every pre-WattTime feed is unchanged. Bands
 * are intensity-based and signal-agnostic, so this field never affects
 * classification — it is a pure honesty/disclosure marker.
 */
export type GridSignalType = "average" | "marginal";

export interface GridForecastEntry {
  /** ISO-8601 start of this hour. */
  datetime: string;
  /** Grams CO2-equivalent per kWh — marginal or average, see signalType. */
  carbonIntensityGCo2PerKwh: number;
  /** Convenience: same value classified into a band. */
  band: "very_clean" | "clean" | "average" | "dirty" | "very_dirty";
  /**
   * Optional per-entry signal type (v0.14+). Absent ⇒ "average". Only the
   * WattTime marginal feed sets "marginal"; all other feeds omit it.
   */
  signalType?: GridSignalType;
}

export interface GridForecast {
  region: string;
  source:
    | "electricityMaps"
    | "ukCarbonIntensity"
    | "eia"
    | "entsoe"
    | "wattTime"
    | "mock";
  /** ISO-8601 timestamp when this forecast was generated. */
  generatedAt: string;
  /**
   * How the series was produced (v0.12+): a genuine forward forecast
   * ("forecast"), or recent realised observations tiled onto future
   * hours — a persistence naive-forecast ("persistence"). Feeds that
   * relabel historical data must say so, so downstream surfaces can
   * disclose it.
   */
  kind?: "forecast" | "persistence";
  /**
   * Optional forecast-level signal type (v0.14+): "marginal" when the
   * whole series is a marginal-emissions signal (WattTime co2_moer),
   * absent ⇒ "average" (every other feed). Set redundantly with the
   * per-entry `signalType` so a consumer can read it off either level.
   */
  signalType?: GridSignalType;
  entries: GridForecastEntry[];
}

export interface CarbonReceipt {
  taskId: string;
  ranAt: string;
  region: string;
  /** Carbon the scheduler projected for the chosen window at schedule
   *  time, in grams CO2-equivalent. */
  estimatedCarbonGCo2: number;
  /** Carbon billed against the grid intensity actually observed at
   *  dispatch time. Equals `estimatedCarbonGCo2` when there was no
   *  separate projection step (immediate / expedited dispatch). */
  actualCarbonGCo2?: number;
  /** Signed percentage drift of actual vs estimated, rounded to 0.1.
   *  Negative means the task ran cleaner than projected. */
  deltaPct?: number;
  provider?: string;
  model?: string;
  /** Wall-clock duration of the dispatched call, in milliseconds. */
  durationMs?: number;
  /** The prompt as stored on the receipt — redacted per ProviderCallSpec.redactInReceipt. */
  prompt?: string;
  /** Total tokens (input + output) reported by the provider, if any. */
  totalTokens?: number;
  /**
   * Grid intensity (gCO2eq/kWh) used to compute the actual side of this
   * receipt (v0.12+). Recorded directly so consumers and `ebb stats`
   * never back-derive it from grams (which skews per-model receipts).
   */
  intensityGCo2PerKwh?: number;
  /**
   * Which grid feed produced the intensity (v0.12+). "mock" means the
   * number is SYNTHETIC — the feed had no key or errored and fell back
   * to the deterministic curve. Covered by the signature, so a signed
   * receipt can no longer silently attest mock-derived carbon.
   */
  gridSource?: GridForecast["source"];
  /**
   * Signal type of the grid intensity on this receipt (v0.14+):
   * "marginal" when the intensity came from a marginal-emissions feed
   * (WattTime co2_moer), absent ⇒ "average". Covered by the signature so
   * a signed receipt discloses honestly whether its carbon is a marginal
   * or average figure — the two are not interchangeable.
   */
  signalType?: GridSignalType;
  /**
   * Confidence tier of the per-model energy coefficients used (v0.12+):
   * "measured" (open-weight, published measurements), "estimated"
   * (closed models, size-class estimates), "fallback" (unknown model,
   * flat legacy constant).
   */
  energySource?: "measured" | "estimated" | "fallback";
  /**
   * How the per-model energy coefficients were resolved (v0.13+),
   * orthogonal to `energySource`'s confidence tier: "exact" (id matched a
   * table key verbatim), "normalized" (matched after stripping dated /
   * provider / word-order variance), "family-fallback" (unknown id, but a
   * known family's representative coefficients were used), or "default"
   * (fully unrecognized — flat legacy constant). Lets a receipt disclose a
   * family-fallback estimate instead of silently passing it off as exact.
   */
  energyResolution?: "exact" | "normalized" | "family-fallback" | "default";
  /**
   * Ed25519 signature over the canonical JSON encoding of every other
   * field on this receipt. Base64-encoded raw 64-byte signature. v0.11+.
   * Pre-v0.11 receipts (and unsigned-by-config dispatches) leave this
   * undefined; the verifier flags those as "LEGACY-UNSIGNED".
   */
  signature?: string;
  /**
   * Base64-encoded Ed25519 public key (32 bytes) that produced
   * `signature`. Bundled on every signed receipt so any consumer can
   * verify without out-of-band key distribution; the absolute trust
   * anchor is whoever owns `~/.ebb-ai/signing.key.pub`.
   */
  signerPublicKey?: string;
  /** ISO-8601 timestamp the signature was produced. Helps with replay
   *  defence when a receipt is re-presented out of context. */
  signedAt?: string;
  /**
   * Cross-provider routing provenance (ROADMAP item 1). Present only when
   * the task was scheduled with >= 2 candidates. Records the normalized
   * weights, the full scored candidate list, the chosen `provider:model`,
   * an optional `fallbackFrom` when dispatch fell back off the first pick,
   * and a one-line honest reasoning string. Inside the signed payload —
   * a signed receipt attests exactly which candidates were compared and why
   * the winner was picked. Omitted (undefined) when routing was not used.
   */
  routing?: RoutingDecision;
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
  /**
   * Carbon the scheduler projected for the chosen window when the task
   * was scheduled, in grams CO2-equivalent. Recorded by
   * `scheduleProviderCall` so the dispatcher can compute the actual-vs-
   * estimated delta on the receipt. Absent for immediately-dispatched
   * tasks, which have no projection step.
   */
  estimatedCarbonGCo2?: number;
  /**
   * Normalized ISO deadline captured at enqueue (v0.12+). Persisted so
   * dispatch-time decisions (Batch API eligibility) can be made against
   * the real deadline instead of the scheduled_for proxy.
   */
  deadline?: string;
  /**
   * Provider batch id when the task was routed through a Batch API
   * (v0.12+). Set when status transitions to "submitted"; `tick()`
   * polls this batch until results arrive.
   */
  batchId?: string;
  /**
   * Cross-provider routing decision (ROADMAP item 1), computed and
   * persisted at schedule time when the task was enqueued with >= 2
   * candidates. Carries the scored candidate list, normalized weights and
   * chosen `provider:model`; folded into the signed receipt at completion.
   * Absent when routing was not used.
   */
  routingDecision?: RoutingDecision;
}

/**
 * The providers a task can be dispatched through. `anthropic` and `openai`
 * are batch-capable (Batch APIs); `gemini` and `ollama` are sync-only (see
 * their adapters for why). Adding a value here is backward-compatible —
 * existing callers keep working.
 */
export type ProviderName = "anthropic" | "openai" | "gemini" | "ollama";

/**
 * JSON-serializable provider-call body. Persisted in the SQLite ledger as
 * `body_json`. The cron-tick CLI rehydrates this struct and dispatches it
 * against the matching provider adapter, so a task survives the
 * enqueuing process going away.
 */
export interface ProviderCallSpec {
  type: "provider_call";
  provider: ProviderName;
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
  /**
   * Cross-provider routing candidates (ROADMAP item 1). When >= 2 entries
   * are present the scheduler scores them at the chosen dispatch window and
   * overwrites `provider`/`model` with the winner before persisting; the
   * decision is recorded on the task's `routingDecision` and folded into the
   * signed receipt. Absent / single-entry ⇒ the spec's own provider/model is
   * used unchanged.
   */
  candidates?: string[];
  /** Optional routing weights; see {@link DeferOptions.routeWeights}. */
  routeWeights?: Partial<RouteWeights>;
}

/** Per-task outcome returned by `Scheduler.tick`. */
export interface TickResultEntry {
  taskId: string;
  /**
   * "submitted" (v0.12): the task was routed to a provider Batch API in
   * this tick and is now awaiting results — a later tick will poll it to
   * "completed" or "failed". "completed"/"failed" are terminal.
   */
  status: "completed" | "failed" | "submitted";
  error?: string;
}

/** Aggregate result of one call to `Scheduler.tick`. */
export interface TickResult {
  inspected: number;
  dispatched: number;
  failed: number;
  results: TickResultEntry[];
  /**
   * v0.12 Batch API counters. `batchSubmitted` = tasks routed to a Batch
   * API this tick (scheduled → submitted). `batchPolled` = "submitted"
   * rows this tick observed as still in progress (stayed submitted).
   * Batch tasks that completed/failed on poll are counted in
   * `dispatched`/`failed` like any other terminal transition.
   */
  batchSubmitted: number;
  batchPolled: number;
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
  /**
   * Cross-provider routing candidates (ROADMAP item 1). With >= 2
   * `"provider:model"` entries `recommend_window` returns a `routingPreview`
   * — the scored candidate list + provisional pick at the previewed window's
   * intensity (non-binding; the real decision is made at schedule time).
   * Absent / single-entry ⇒ no preview.
   */
  candidates?: string[];
  /** Optional routing weights; see {@link DeferOptions.routeWeights}. */
  routeWeights?: Partial<RouteWeights>;
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
  /**
   * Which grid feed produced the forecast this plan was scored against
   * (v0.12+). "mock" means the recommendation is based on SYNTHETIC
   * data — surface this to the caller.
   */
  gridSource?: GridForecast["source"];
  /**
   * Signal type of the forecast this plan was scored against (v0.14+):
   * "marginal" (WattTime co2_moer) or absent ⇒ "average". The `reasoning`
   * string discloses it in prose; this field exposes it structurally.
   */
  signalType?: GridSignalType;
  /**
   * Non-binding cross-provider routing preview (ROADMAP item 1). Present only
   * when >= 2 `candidates` were supplied: the scored candidate list +
   * provisional pick at THIS previewed window's intensity. The binding
   * decision is made at schedule time and may differ if the forecast shifts.
   * Absent when routing was not requested.
   */
  routingPreview?: RoutingPreview;
}
