/**
 * Cross-provider LLM routing — the scored-candidate selection engine
 * (ROADMAP item 1).
 *
 * Given a set of caller-allowed `provider:model` candidates and the grid
 * intensity at the ALREADY-CHOSEN dispatch window, pick the best candidate on
 * a weighted blend of carbon, cost and latency. The window is selected once
 * by `selectWindow` BEFORE this runs — routing never shops for a per-candidate
 * window.
 *
 * ## Honesty constraints (non-negotiable, mirrored in the reasoning string)
 *
 *  1. **No silent model swaps.** Routing only ever picks among the candidates
 *     the caller explicitly allowed. There are no built-in model-equivalence
 *     tiers — a one-candidate list routes to exactly that candidate.
 *  2. **Grid honesty.** For hosted providers we do NOT know the data-centre
 *     grid; every hosted candidate is scored against the SAME caller's-grid
 *     intensity (the receipt's documented assumption). Routing differentiates
 *     carbon via per-model SSOT energy coefficients, not pretend per-provider
 *     grids. Ollama is genuinely local. The reasoning string says which.
 *  3. **Explainable pick.** The full scored candidate list + the normalized
 *     weights are returned (and recorded on the receipt); the pick is
 *     reproducible given the same rng seed.
 *
 * ## Scoring
 *
 * For each candidate `c` at the chosen window `W`:
 *  - `carbonG(c)  = estimateEnergyKwh(model, tokens) × intensity(W)` — the
 *    same math today's receipts use.
 *  - `costUsd(c)  = tokens × price(model)`, halved by `batchDiscount` when the
 *    task is batch-eligible AND the adapter supports batch. A candidate model
 *    missing from the price table is REJECTED loudly (never guessed).
 *  - `latencyClass(c)` — static tiers: local (ollama) = 0, hosted-sync = 0.5,
 *    hosted-batch = 1. No fake milliseconds.
 *
 * Each dimension is normalized across the candidates to `[0,1]` (min→0, max→1;
 * all-equal→0). `score = w_carbon·carbon + w_cost·cost + w_latency·latency`.
 * Lowest score wins; exact ties are broken with the injectable rng.
 */

import { estimateEnergyKwh, normalizeModelName } from "./energy.js";
import { MODEL_PRICES, TYPICAL_INPUT_TOKENS, TYPICAL_OUTPUT_TOKENS } from "./data/tables.generated.js";
import type { ProviderName } from "./types.js";

/** One row of the SSOT price table (`data/prices.json`). USD per million tokens. */
export interface ModelPrice {
  /** USD per million input (prompt) tokens (public list price). */
  inUsdPerMtok: number;
  /** USD per million output (completion) tokens (public list price). */
  outUsdPerMtok: number;
  /** Multiplier applied when the candidate runs via the vendor Batch API
   *  (0.5 for Anthropic / OpenAI). Absent ⇒ no batch discount available. */
  batchDiscount?: number;
  /** Month the figure was read, e.g. "2026-07". */
  asOf: string;
  /** Vendor pricing-page citation. */
  source: string;
}

/** The three routing dimensions and their relative importance. Non-negative. */
export interface RouteWeights {
  carbon: number;
  cost: number;
  latency: number;
}

/** Default weights when the caller does not supply `route_weights`. */
export const DEFAULT_ROUTE_WEIGHTS: RouteWeights = Object.freeze({
  carbon: 0.6,
  cost: 0.3,
  latency: 0.1,
});

/** A parsed `provider:model` candidate. */
export interface RoutingCandidate {
  provider: ProviderName;
  model: string;
}

/**
 * Static latency tier — deliberately coarse, no fake milliseconds:
 *   - `0`   local (Ollama)
 *   - `0.5` hosted synchronous call
 *   - `1`   hosted Batch API (up-to-24h SLA)
 */
export type LatencyClass = 0 | 0.5 | 1;

/** One fully-scored candidate, as recorded on the receipt's routing block. */
export interface ScoredCandidate {
  provider: ProviderName;
  model: string;
  /** Estimated grams CO2e for this candidate at the chosen window. */
  estCarbonG: number;
  /** Estimated USD list cost for this candidate (batch discount applied when it applies). */
  estCostUsd: number;
  latencyClass: LatencyClass;
  /** Weighted, normalized blend in [0,1]. Lower is better. */
  score: number;
}

/**
 * The routing decision — persisted on the task row at schedule time and
 * embedded in the signed receipt at completion. `chosen` / `fallbackFrom`
 * are compact `"provider:model"` ids.
 */
export interface RoutingDecision {
  weights: RouteWeights;
  considered: ScoredCandidate[];
  chosen: string;
  /** Set when dispatch fell back off the originally-chosen candidate. */
  fallbackFrom?: string;
  /** One honest human-readable line for an LLM caller / a receipt renderer. */
  reasoning: string;
}

/**
 * A NON-BINDING routing preview, returned by `recommend_window` and
 * `schedule_task` dry_run. Same scored-candidate math as the committing path,
 * but scored at the PREVIEWED window's intensity — the binding pick is made
 * at schedule time and may differ if the forecast shifts before commit. The
 * `preview` flag and the reasoning prefix disclose that plainly.
 */
export interface RoutingPreview extends RoutingDecision {
  preview: true;
}

/** Disclosure prefix on a preview's reasoning line. */
export const ROUTING_PREVIEW_DISCLOSURE =
  "PREVIEW — the binding pick is decided at schedule time and may differ if the forecast shifts before commit";

/** The providers a candidate string may name (keep in sync with {@link ProviderName}). */
const KNOWN_PROVIDERS: ReadonlySet<string> = new Set([
  "anthropic",
  "openai",
  "gemini",
  "ollama",
]);

/** Providers whose adapters can route through a synchronous vendor Batch API. */
const BATCH_CAPABLE_PROVIDERS: ReadonlySet<ProviderName> = new Set([
  "anthropic",
  "openai",
]);

/** Thrown when a `provider:model` candidate string is malformed. */
export class InvalidCandidateError extends Error {
  constructor(public readonly received: string, detail: string) {
    super(`Invalid routing candidate ${JSON.stringify(received)}: ${detail}`);
    this.name = "InvalidCandidateError";
  }
}

/**
 * Thrown when one or more candidate models are absent from the SSOT price
 * table. Loud by design — routing never guesses a price. Lists every missing
 * id so the caller can fix the whole candidate set at once.
 */
export class MissingPriceError extends Error {
  constructor(public readonly missing: string[]) {
    super(
      `No price in data/prices.json for routing candidate model(s): ${missing.join(", ")}. ` +
        `Add each to prices.json (with asOf + source) or drop it from the candidate list — routing never guesses a price.`,
    );
    this.name = "MissingPriceError";
  }
}

/** Thrown when the caller-supplied weights cannot be normalized. */
export class InvalidRouteWeightsError extends Error {
  constructor(detail: string) {
    super(`Invalid route_weights: ${detail}`);
    this.name = "InvalidRouteWeightsError";
  }
}

/** Parse a single `"provider:model"` string. */
export function parseCandidate(spec: string): RoutingCandidate {
  if (typeof spec !== "string") {
    throw new InvalidCandidateError(String(spec), "expected a string");
  }
  const trimmed = spec.trim();
  const idx = trimmed.indexOf(":");
  if (idx <= 0) {
    throw new InvalidCandidateError(spec, 'expected "provider:model"');
  }
  const provider = trimmed.slice(0, idx).trim().toLowerCase();
  const model = trimmed.slice(idx + 1).trim();
  if (!KNOWN_PROVIDERS.has(provider)) {
    throw new InvalidCandidateError(
      spec,
      `unknown provider ${JSON.stringify(provider)} (expected one of anthropic, openai, gemini, ollama)`,
    );
  }
  if (model.length === 0) {
    throw new InvalidCandidateError(spec, "model part is empty");
  }
  return { provider: provider as ProviderName, model };
}

/** Parse a list of `"provider:model"` strings. */
export function parseCandidates(specs: readonly string[]): RoutingCandidate[] {
  return specs.map(parseCandidate);
}

/** Compact `"provider:model"` id for a candidate. */
export function candidateId(c: { provider: string; model: string }): string {
  return `${c.provider}:${c.model}`;
}

/**
 * Normalize caller weights to a non-negative vector summing to 1. Absent ⇒
 * {@link DEFAULT_ROUTE_WEIGHTS}. Missing keys default to 0; any negative value
 * or an all-zero vector is rejected.
 */
export function normalizeRouteWeights(w?: Partial<RouteWeights>): RouteWeights {
  if (w === undefined || w === null) {
    return { ...DEFAULT_ROUTE_WEIGHTS };
  }
  const carbon = w.carbon ?? 0;
  const cost = w.cost ?? 0;
  const latency = w.latency ?? 0;
  for (const [k, v] of [["carbon", carbon], ["cost", cost], ["latency", latency]] as const) {
    if (typeof v !== "number" || Number.isNaN(v)) {
      throw new InvalidRouteWeightsError(`${k} must be a number, got ${JSON.stringify(v)}`);
    }
    if (v < 0) {
      throw new InvalidRouteWeightsError(`${k} must be non-negative, got ${v}`);
    }
  }
  const sum = carbon + cost + latency;
  if (sum <= 0) {
    throw new InvalidRouteWeightsError("at least one weight must be positive");
  }
  return { carbon: carbon / sum, cost: cost / sum, latency: latency / sum };
}

/** Look up the SSOT price for a model id, trying exact then normalized. */
export function priceForModel(model: string): ModelPrice | undefined {
  const exact = MODEL_PRICES[model.trim().toLowerCase()];
  if (exact) return exact;
  return MODEL_PRICES[normalizeModelName(model)];
}

/** Whether a candidate would run via the vendor Batch API given task/adapter state. */
function willRunBatch(
  c: RoutingCandidate,
  price: ModelPrice,
  batchEligible: boolean,
  batchCapable: (provider: ProviderName) => boolean,
): boolean {
  return (
    batchEligible &&
    BATCH_CAPABLE_PROVIDERS.has(c.provider) &&
    price.batchDiscount !== undefined &&
    batchCapable(c.provider)
  );
}

function latencyClassFor(c: RoutingCandidate, runsBatch: boolean): LatencyClass {
  if (c.provider === "ollama") return 0;
  return runsBatch ? 1 : 0.5;
}

/** USD list cost for a candidate at the given token shape. */
function costUsdFor(
  price: ModelPrice,
  inputTokens: number,
  outputTokens: number,
  runsBatch: boolean,
): number {
  const base =
    (inputTokens / 1_000_000) * price.inUsdPerMtok +
    (outputTokens / 1_000_000) * price.outUsdPerMtok;
  const mult = runsBatch && price.batchDiscount !== undefined ? price.batchDiscount : 1;
  return base * mult;
}

export interface ScoreCandidatesOptions {
  /** Parsed candidate list (>= 1). >= 2 is where routing actually differentiates. */
  candidates: readonly RoutingCandidate[];
  /** Grid intensity (gCO2e/kWh) at the already-chosen dispatch window. */
  intensityGCo2PerKwh: number;
  /** Caller weights; normalized internally. Absent ⇒ DEFAULT_ROUTE_WEIGHTS. */
  weights?: Partial<RouteWeights>;
  /** True when (deadline − now) > 24h, i.e. the Batch API SLA still fits. */
  batchEligible?: boolean;
  /**
   * Whether a configured adapter for `provider` supports batch this run.
   * Defaults to "yes for anthropic/openai" — the scheduler passes a stricter
   * predicate keyed on the actually-configured adapters.
   */
  batchCapable?: (provider: ProviderName) => boolean;
  /** Input tokens for the estimate. Defaults to the typical-task shape. */
  inputTokens?: number;
  /** Output tokens for the estimate. Defaults to the typical-task shape. */
  outputTokens?: number;
  /** Injectable rng in [0,1) for the tie-break. Defaults to Math.random. */
  rng?: () => number;
}

/** Ties within this score epsilon are broken with the rng (reproducible given a seed). */
export const SCORE_TIE_EPSILON = 1e-9;

/**
 * Score a candidate set and pick the lowest-scoring one. Throws
 * {@link MissingPriceError} if any candidate model is absent from the price
 * table (loud, never guessed).
 */
export function scoreCandidates(opts: ScoreCandidatesOptions): RoutingDecision {
  const {
    candidates,
    intensityGCo2PerKwh,
    batchEligible = false,
    batchCapable = (p) => BATCH_CAPABLE_PROVIDERS.has(p),
    inputTokens = TYPICAL_INPUT_TOKENS,
    outputTokens = TYPICAL_OUTPUT_TOKENS,
    rng = Math.random,
  } = opts;
  if (candidates.length === 0) {
    throw new Error("scoreCandidates: candidates must be non-empty");
  }
  const weights = normalizeRouteWeights(opts.weights);

  // Resolve every price FIRST so a missing one rejects the whole set loudly.
  const missing: string[] = [];
  const prices = candidates.map((c) => {
    const p = priceForModel(c.model);
    if (!p) missing.push(candidateId(c));
    return p;
  });
  if (missing.length > 0) {
    throw new MissingPriceError(missing);
  }

  // Raw per-dimension figures.
  const raw = candidates.map((c, i) => {
    const price = prices[i]!;
    const runsBatch = willRunBatch(c, price, batchEligible, batchCapable);
    const carbonG =
      estimateEnergyKwh({ model: c.model, inputTokens, outputTokens }) * intensityGCo2PerKwh;
    const costUsd = costUsdFor(price, inputTokens, outputTokens, runsBatch);
    const latencyClass = latencyClassFor(c, runsBatch);
    return { c, carbonG, costUsd, latencyClass };
  });

  const norm = (values: number[]): number[] => {
    const min = Math.min(...values);
    const max = Math.max(...values);
    if (max - min <= 0) return values.map(() => 0);
    return values.map((v) => (v - min) / (max - min));
  };
  const nCarbon = norm(raw.map((r) => r.carbonG));
  const nCost = norm(raw.map((r) => r.costUsd));
  const nLatency = norm(raw.map((r) => r.latencyClass));

  const considered: ScoredCandidate[] = raw.map((r, i) => ({
    provider: r.c.provider,
    model: r.c.model,
    estCarbonG: round4(r.carbonG),
    estCostUsd: round6(r.costUsd),
    latencyClass: r.latencyClass,
    score: round6(
      weights.carbon * nCarbon[i]! + weights.cost * nCost[i]! + weights.latency * nLatency[i]!,
    ),
  }));

  // Lowest score wins; exact ties (within epsilon) broken by rng. Reproducible
  // given a seeded rng — same tolerance spirit as selectWindow.
  const minScore = Math.min(...considered.map((c) => c.score));
  const tied = considered.filter((c) => c.score - minScore <= SCORE_TIE_EPSILON);
  const chosen =
    tied.length > 1 ? tied[Math.floor(rng() * tied.length)]! : tied[0]!;

  return {
    weights,
    considered,
    chosen: candidateId(chosen),
    reasoning: buildRoutingReasoning(considered, chosen, weights),
  };
}

/**
 * Non-binding routing preview for the planning surfaces (`recommend_window`,
 * `schedule_task` dry_run). Runs the SAME scoring as {@link scoreCandidates}
 * at the previewed window's intensity, then marks the result as a preview and
 * prefixes the reasoning with {@link ROUTING_PREVIEW_DISCLOSURE}. Returns
 * `undefined` when fewer than two candidates were supplied (routing is a no-op
 * — no block is shown, so the params are never inert: they take effect exactly
 * when >= 2 candidates are present). Throws {@link MissingPriceError} /
 * {@link InvalidCandidateError} loudly, same as the committing path.
 */
export function previewRouting(
  candidates: readonly string[] | undefined,
  opts: Omit<ScoreCandidatesOptions, "candidates">,
): RoutingPreview | undefined {
  if (!Array.isArray(candidates) || candidates.length < 2) return undefined;
  const decision = scoreCandidates({ ...opts, candidates: parseCandidates(candidates) });
  return {
    ...decision,
    preview: true,
    reasoning: `${ROUTING_PREVIEW_DISCLOSURE}: ${decision.reasoning}`,
  };
}

// --------------------------------------------------------------------------- //
// Reasoning

function buildRoutingReasoning(
  considered: ScoredCandidate[],
  chosen: ScoredCandidate,
  weights: RouteWeights,
): string {
  const others = considered.filter((c) => c !== chosen);
  const vs = others.length
    ? ` (score ${fmtScore(chosen.score)} vs ${others.map((o) => fmtScore(o.score)).join("/")})`
    : "";

  // Which dimension the chosen candidate leads on (honest: only claim "lowest"
  // when it truly is the min, and only mention dimensions with weight).
  const clauses: string[] = [];
  if (weights.carbon > 0 && isMinBy(considered, chosen, (c) => c.estCarbonG)) {
    clauses.push("lowest carbon at window");
  }
  if (weights.cost > 0 && isMinBy(considered, chosen, (c) => c.estCostUsd)) {
    clauses.push(chosen.estCostUsd === 0 ? "no per-token cost (local)" : "lowest cost");
  }
  if (weights.latency > 0 && isMinBy(considered, chosen, (c) => c.latencyClass)) {
    clauses.push(chosen.latencyClass === 0 ? "local (no network latency tier)" : "fastest latency tier");
  }
  if (clauses.length === 0) {
    clauses.push("best weighted blend of carbon/cost/latency");
  }

  const gridHonesty =
    chosen.provider === "ollama"
      ? "runs locally on your own grid"
      : "hosted-grid assumption applies (all hosted candidates scored at the same caller's-grid intensity)";

  return `routed to ${candidateId(chosen)}${vs}: ${clauses.join("; ")}; ${gridHonesty}`;
}

function isMinBy(
  all: ScoredCandidate[],
  target: ScoredCandidate,
  key: (c: ScoredCandidate) => number,
): boolean {
  const min = Math.min(...all.map(key));
  return key(target) <= min + SCORE_TIE_EPSILON;
}

/** Format a [0,1] score like ".21" (leading zero stripped), matching the design's examples. */
function fmtScore(x: number): string {
  const s = x.toFixed(2);
  return s.startsWith("0.") ? s.slice(1) : s;
}

function round4(v: number): number {
  return Math.round(v * 10000) / 10000;
}
function round6(v: number): number {
  return Math.round(v * 1000000) / 1000000;
}
