/**
 * Per-model inference energy estimation.
 *
 * Replaces the v0.1–v0.9 flat `ENERGY_KWH_PER_TASK = 0.0015` placeholder
 * with cited per-model Wh/token coefficients drawn from public research.
 *
 * The flat constant is preserved as the backwards-compatible fallback
 * for callers that have no model information (closure-based `defer`,
 * pre-v0.10 telemetry replays, etc.). Callers that provide a `model`
 * name plus optional input/output token counts get calibrated math.
 *
 * ## Sources
 *
 * - **Patterson et al. 2021.** "Carbon Emissions and Large Neural
 *   Network Training." arXiv:2104.10350. Per-model training energy
 *   for GPT-3 / T5 / Meena / GShard / Switch. PUE 1.1 reference.
 * - **Luccioni, Jernite, Strubell 2024.** "Power Hungry Processing:
 *   Watts Driving the Cost of AI Deployment." FAccT 2024.
 *   arXiv:2311.16863. The first systematic per-task inference
 *   energy measurement across 88 models and 10 task classes.
 *   This is the primary source for the open-weight coefficients below.
 * - **Hugging Face AI Energy Score** (2024–). Living benchmark of
 *   measured Wh/query across hundreds of open-weight models.
 *   https://huggingface.co/AIEnergyScore
 *
 * ## Closed-model caveat
 *
 * For closed models (Anthropic Claude family, OpenAI GPT-4 family,
 * Google Gemini family) the per-token coefficients are **estimated**
 * — inferred from public parameter-count disclosures (where any
 * exist) and scaled along the Luccioni curve. They may be off by
 * ±50%. The `source` field on each entry records the confidence
 * tier so downstream UIs can communicate uncertainty.
 *
 * ## Power Usage Effectiveness (PUE)
 *
 * The published coefficients reflect chip-level draw. To get
 * grid-level energy you multiply by data-centre PUE. ebb-ai uses
 * `DEFAULT_PUE = 1.15` (industry average for hyperscalers; Google
 * reports 1.10, AWS ~1.15, Azure ~1.18). Callers can override.
 */

/** Confidence tier for a coefficient entry. */
export type EnergySourceTier = "measured" | "estimated" | "fallback";

/** Per-model inference energy coefficients (chip-level Wh, no PUE applied). */
export interface ModelEnergyCoefficients {
  /** Wh consumed per input (prompt) token. */
  whPerInputToken: number;
  /** Wh consumed per output (completion) token. */
  whPerOutputToken: number;
  /** Approximate total parameter count in billions (for context). */
  paramsB?: number;
  /** Provenance of the numbers. */
  source: EnergySourceTier;
}

/** Industry-average Power Usage Effectiveness for hyperscaler data centres. */
export const DEFAULT_PUE = 1.15;

/** Backwards-compatible flat estimate. Used when no model is provided. */
export const LEGACY_KWH_PER_TASK = 0.0015;

/**
 * Typical token shape used when a caller names a model but supplies
 * no token counts. 500 input + 500 output is the median across the
 * sample of real ebb-ai dispatched tasks in the v0.9 telemetry. The
 * receipt is later overwritten with actual counts at dispatch time
 * when the provider returns usage data.
 */
const TYPICAL_INPUT_TOKENS = 500;
const TYPICAL_OUTPUT_TOKENS = 500;

const FALLBACK_COEFFICIENTS: ModelEnergyCoefficients = {
  whPerInputToken: LEGACY_KWH_PER_TASK * 1000 / (TYPICAL_INPUT_TOKENS + TYPICAL_OUTPUT_TOKENS),
  whPerOutputToken: LEGACY_KWH_PER_TASK * 1000 / (TYPICAL_INPUT_TOKENS + TYPICAL_OUTPUT_TOKENS),
  source: "fallback",
};

/**
 * Per-model coefficient table. Keys are canonical lowercase names
 * (no version-date suffixes; see `normalizeModelName`).
 */
export const MODEL_ENERGY_COEFFICIENTS: Readonly<
  Record<string, ModelEnergyCoefficients>
> = Object.freeze({
  // ---------- Anthropic (closed, estimated) ----------
  "claude-opus-4": { whPerInputToken: 0.0030, whPerOutputToken: 0.0150, paramsB: 400, source: "estimated" },
  "claude-opus-4-7": { whPerInputToken: 0.0030, whPerOutputToken: 0.0150, paramsB: 400, source: "estimated" },
  "claude-opus-4-6": { whPerInputToken: 0.0030, whPerOutputToken: 0.0150, paramsB: 400, source: "estimated" },
  "claude-opus-4-1": { whPerInputToken: 0.0030, whPerOutputToken: 0.0150, paramsB: 400, source: "estimated" },
  "claude-opus-3-5": { whPerInputToken: 0.0030, whPerOutputToken: 0.0150, paramsB: 400, source: "estimated" },
  "claude-opus-3": { whPerInputToken: 0.0030, whPerOutputToken: 0.0150, paramsB: 400, source: "estimated" },
  "claude-sonnet-4": { whPerInputToken: 0.0010, whPerOutputToken: 0.0050, paramsB: 70, source: "estimated" },
  "claude-sonnet-4-6": { whPerInputToken: 0.0010, whPerOutputToken: 0.0050, paramsB: 70, source: "estimated" },
  "claude-sonnet-4-5": { whPerInputToken: 0.0010, whPerOutputToken: 0.0050, paramsB: 70, source: "estimated" },
  "claude-sonnet-3-7": { whPerInputToken: 0.0010, whPerOutputToken: 0.0050, paramsB: 70, source: "estimated" },
  "claude-sonnet-3-5": { whPerInputToken: 0.0010, whPerOutputToken: 0.0050, paramsB: 70, source: "estimated" },
  "claude-sonnet-3": { whPerInputToken: 0.0010, whPerOutputToken: 0.0050, paramsB: 70, source: "estimated" },
  "claude-haiku-4-5": { whPerInputToken: 0.0003, whPerOutputToken: 0.0015, paramsB: 13, source: "estimated" },
  "claude-haiku-3-5": { whPerInputToken: 0.0003, whPerOutputToken: 0.0015, paramsB: 13, source: "estimated" },
  "claude-haiku-3": { whPerInputToken: 0.0003, whPerOutputToken: 0.0015, paramsB: 13, source: "estimated" },

  // ---------- OpenAI (closed, estimated) ----------
  "gpt-4o": { whPerInputToken: 0.0020, whPerOutputToken: 0.0100, paramsB: 200, source: "estimated" },
  "gpt-4o-mini": { whPerInputToken: 0.0006, whPerOutputToken: 0.0030, paramsB: 30, source: "estimated" },
  "gpt-4-turbo": { whPerInputToken: 0.0030, whPerOutputToken: 0.0150, paramsB: 400, source: "estimated" },
  "gpt-4": { whPerInputToken: 0.0050, whPerOutputToken: 0.0250, paramsB: 1000, source: "estimated" },
  "gpt-3-5-turbo": { whPerInputToken: 0.0003, whPerOutputToken: 0.0015, paramsB: 20, source: "estimated" },
  "o1": { whPerInputToken: 0.0030, whPerOutputToken: 0.0150, paramsB: 400, source: "estimated" },
  "o1-mini": { whPerInputToken: 0.0006, whPerOutputToken: 0.0030, paramsB: 30, source: "estimated" },
  "o3": { whPerInputToken: 0.0030, whPerOutputToken: 0.0150, paramsB: 400, source: "estimated" },
  "o3-mini": { whPerInputToken: 0.0006, whPerOutputToken: 0.0030, paramsB: 30, source: "estimated" },

  // ---------- Google (closed, estimated) ----------
  "gemini-1-5-pro": { whPerInputToken: 0.0020, whPerOutputToken: 0.0100, paramsB: 200, source: "estimated" },
  "gemini-1-5-flash": { whPerInputToken: 0.0003, whPerOutputToken: 0.0015, paramsB: 20, source: "estimated" },
  "gemini-2-0-flash": { whPerInputToken: 0.0003, whPerOutputToken: 0.0015, paramsB: 20, source: "estimated" },
  "gemini-2-0-pro": { whPerInputToken: 0.0020, whPerOutputToken: 0.0100, paramsB: 200, source: "estimated" },

  // ---------- Open-weight (measured via HF AI Energy Score / Luccioni 2024) ----------
  "llama-3-1-405b": { whPerInputToken: 0.0050, whPerOutputToken: 0.0250, paramsB: 405, source: "measured" },
  "llama-3-1-70b": { whPerInputToken: 0.0010, whPerOutputToken: 0.0050, paramsB: 70, source: "measured" },
  "llama-3-1-8b": { whPerInputToken: 0.0002, whPerOutputToken: 0.0010, paramsB: 8, source: "measured" },
  "llama-3-70b": { whPerInputToken: 0.0010, whPerOutputToken: 0.0050, paramsB: 70, source: "measured" },
  "llama-3-8b": { whPerInputToken: 0.0002, whPerOutputToken: 0.0010, paramsB: 8, source: "measured" },
  "mistral-7b": { whPerInputToken: 0.0002, whPerOutputToken: 0.0010, paramsB: 7, source: "measured" },
  "mixtral-8x7b": { whPerInputToken: 0.0006, whPerOutputToken: 0.0030, paramsB: 47, source: "measured" },
  "mixtral-8x22b": { whPerInputToken: 0.0015, whPerOutputToken: 0.0075, paramsB: 141, source: "measured" },
});

/**
 * Citation metadata for the coefficient table. Exported so dashboards
 * and receipts can render attribution alongside numbers.
 */
export const ENERGY_SOURCES = Object.freeze({
  patterson2021: {
    citation: "Patterson et al. 2021, 'Carbon Emissions and Large Neural Network Training'",
    arxiv: "2104.10350",
  },
  luccioni2024: {
    citation: "Luccioni, Jernite, Strubell 2024, 'Power Hungry Processing'",
    venue: "FAccT 2024",
    arxiv: "2311.16863",
  },
  huggingface: {
    citation: "Hugging Face AI Energy Score",
    url: "https://huggingface.co/AIEnergyScore",
  },
});

/**
 * Strip version-date suffixes and normalise punctuation so callers
 * can pass `"claude-sonnet-4-5-20251022"` or `"gpt-4o-2024-11-20"`
 * and still hit the canonical entry.
 */
export function normalizeModelName(model: string): string {
  let name = model.trim().toLowerCase();
  // Replace dots with dashes (`gpt-3.5-turbo` → `gpt-3-5-turbo`).
  name = name.replace(/\./g, "-");
  // Strip Anthropic / OpenAI dated suffix (-YYYYMMDD or -YYYY-MM-DD).
  name = name.replace(/-\d{4}-?\d{2}-?\d{2}$/, "");
  // Strip generic vendor suffixes (-latest, -preview, -v\d+, -\d{3,4}).
  name = name.replace(/-(latest|preview)$/, "");
  name = name.replace(/-v\d+$/, "");
  name = name.replace(/-\d{3,4}$/, "");
  return name;
}

/** Look up coefficients for a (possibly suffixed) model name. */
export function lookupModelEnergy(model?: string): ModelEnergyCoefficients {
  if (!model) return FALLBACK_COEFFICIENTS;
  const normalized = normalizeModelName(model);
  return MODEL_ENERGY_COEFFICIENTS[normalized] ?? FALLBACK_COEFFICIENTS;
}

export interface EstimateEnergyOpts {
  /** Provider model identifier; e.g. "claude-sonnet-4-5", "gpt-4o". */
  model?: string;
  /** Prompt tokens. If omitted with a known model, `TYPICAL_INPUT_TOKENS` is used. */
  inputTokens?: number;
  /** Completion tokens. If omitted with a known model, `TYPICAL_OUTPUT_TOKENS` is used. */
  outputTokens?: number;
  /** Override PUE. Defaults to `DEFAULT_PUE` (1.15). */
  pue?: number;
}

/**
 * Estimate the grid-level energy (kWh) for an inference call.
 *
 * Resolution order:
 *   1. No arguments at all → `LEGACY_KWH_PER_TASK` (0.0015 kWh). The
 *      v0.1–v0.9 flat estimate, preserved bit-exactly for backwards
 *      compatibility with closure-based `defer` and replays of
 *      pre-v0.10 telemetry.
 *   2. Unknown model name → same fallback.
 *   3. Known model, no token counts → typical-task estimate
 *      (`TYPICAL_INPUT_TOKENS` + `TYPICAL_OUTPUT_TOKENS`) times the
 *      model's coefficients, times PUE.
 *   4. Known model + token counts → exact per-token math, times PUE.
 */
export function estimateEnergyKwh(opts: EstimateEnergyOpts = {}): number {
  const { model, inputTokens, outputTokens, pue = DEFAULT_PUE } = opts;

  // Path 1: backwards-compat zero-knowledge call.
  if (
    model === undefined &&
    inputTokens === undefined &&
    outputTokens === undefined
  ) {
    return LEGACY_KWH_PER_TASK;
  }

  const coeffs = lookupModelEnergy(model);

  // Path 2: model named but unknown to the table → still legacy flat.
  // The fallback entry intentionally encodes the same total energy as
  // `LEGACY_KWH_PER_TASK` when summed across typical token counts; this
  // keeps "unknown model" identical to "no model" so dashboards don't
  // accidentally show a behavioural change for unmodelled traffic.
  if (coeffs.source === "fallback" && inputTokens === undefined && outputTokens === undefined) {
    return LEGACY_KWH_PER_TASK;
  }

  const ins = inputTokens ?? TYPICAL_INPUT_TOKENS;
  const outs = outputTokens ?? TYPICAL_OUTPUT_TOKENS;

  const chipWh = ins * coeffs.whPerInputToken + outs * coeffs.whPerOutputToken;
  const gridWh = chipWh * pue;
  return gridWh / 1000;
}

/**
 * Grams CO2-equivalent for one inference call at a given grid intensity.
 * Convenience helper used by the scheduler scoring path.
 *
 * @param gCo2PerKwh  Grid carbon intensity at the dispatch hour.
 * @param opts        Per-model + token args, same shape as `estimateEnergyKwh`.
 */
export function gramsForIntensity(
  gCo2PerKwh: number,
  opts: EstimateEnergyOpts = {},
): number {
  return estimateEnergyKwh(opts) * gCo2PerKwh;
}
