/**
 * Per-model inference energy estimation — inline mirror of
 * `@ebb-ai/core`'s `src/energy.ts`.
 *
 * Kept inline (rather than imported from `@ebb-ai/core`) because the
 * web app is deliberately isolated from node-only deps like
 * `better-sqlite3` that the core scheduler pulls in. The core module
 * is the source of truth; this file is a typed snapshot.
 *
 * Sources:
 *   - Patterson et al. 2021, "Carbon Emissions and Large Neural
 *     Network Training", arXiv:2104.10350
 *   - Luccioni, Jernite, Strubell 2024, "Power Hungry Processing",
 *     FAccT 2024, arXiv:2311.16863
 *   - Hugging Face AI Energy Score (2024–),
 *     https://huggingface.co/AIEnergyScore
 */

export type EnergySourceTier = "measured" | "estimated" | "fallback";

export interface ModelEnergyCoefficients {
  whPerInputToken: number;
  whPerOutputToken: number;
  paramsB?: number;
  source: EnergySourceTier;
}

export const DEFAULT_PUE = 1.15;
export const LEGACY_KWH_PER_TASK = 0.0015;

const TYPICAL_INPUT_TOKENS = 500;
const TYPICAL_OUTPUT_TOKENS = 500;

const FALLBACK_COEFFICIENTS: ModelEnergyCoefficients = {
  whPerInputToken:
    (LEGACY_KWH_PER_TASK * 1000) / (TYPICAL_INPUT_TOKENS + TYPICAL_OUTPUT_TOKENS),
  whPerOutputToken:
    (LEGACY_KWH_PER_TASK * 1000) / (TYPICAL_INPUT_TOKENS + TYPICAL_OUTPUT_TOKENS),
  source: "fallback",
};

export const MODEL_ENERGY_COEFFICIENTS: Readonly<
  Record<string, ModelEnergyCoefficients>
> = Object.freeze({
  "claude-opus-4": { whPerInputToken: 0.003, whPerOutputToken: 0.015, paramsB: 400, source: "estimated" },
  "claude-opus-4-7": { whPerInputToken: 0.003, whPerOutputToken: 0.015, paramsB: 400, source: "estimated" },
  "claude-opus-4-6": { whPerInputToken: 0.003, whPerOutputToken: 0.015, paramsB: 400, source: "estimated" },
  "claude-opus-4-1": { whPerInputToken: 0.003, whPerOutputToken: 0.015, paramsB: 400, source: "estimated" },
  "claude-opus-3-5": { whPerInputToken: 0.003, whPerOutputToken: 0.015, paramsB: 400, source: "estimated" },
  "claude-opus-3": { whPerInputToken: 0.003, whPerOutputToken: 0.015, paramsB: 400, source: "estimated" },
  "claude-sonnet-4": { whPerInputToken: 0.001, whPerOutputToken: 0.005, paramsB: 70, source: "estimated" },
  "claude-sonnet-4-6": { whPerInputToken: 0.001, whPerOutputToken: 0.005, paramsB: 70, source: "estimated" },
  "claude-sonnet-4-5": { whPerInputToken: 0.001, whPerOutputToken: 0.005, paramsB: 70, source: "estimated" },
  "claude-sonnet-3-7": { whPerInputToken: 0.001, whPerOutputToken: 0.005, paramsB: 70, source: "estimated" },
  "claude-sonnet-3-5": { whPerInputToken: 0.001, whPerOutputToken: 0.005, paramsB: 70, source: "estimated" },
  "claude-sonnet-3": { whPerInputToken: 0.001, whPerOutputToken: 0.005, paramsB: 70, source: "estimated" },
  "claude-haiku-4-5": { whPerInputToken: 0.0003, whPerOutputToken: 0.0015, paramsB: 13, source: "estimated" },
  "claude-haiku-3-5": { whPerInputToken: 0.0003, whPerOutputToken: 0.0015, paramsB: 13, source: "estimated" },
  "claude-haiku-3": { whPerInputToken: 0.0003, whPerOutputToken: 0.0015, paramsB: 13, source: "estimated" },
  "gpt-4o": { whPerInputToken: 0.002, whPerOutputToken: 0.01, paramsB: 200, source: "estimated" },
  "gpt-4o-mini": { whPerInputToken: 0.0006, whPerOutputToken: 0.003, paramsB: 30, source: "estimated" },
  "gpt-4-turbo": { whPerInputToken: 0.003, whPerOutputToken: 0.015, paramsB: 400, source: "estimated" },
  "gpt-4": { whPerInputToken: 0.005, whPerOutputToken: 0.025, paramsB: 1000, source: "estimated" },
  "gpt-3-5-turbo": { whPerInputToken: 0.0003, whPerOutputToken: 0.0015, paramsB: 20, source: "estimated" },
  "o1": { whPerInputToken: 0.003, whPerOutputToken: 0.015, paramsB: 400, source: "estimated" },
  "o1-mini": { whPerInputToken: 0.0006, whPerOutputToken: 0.003, paramsB: 30, source: "estimated" },
  "o3": { whPerInputToken: 0.003, whPerOutputToken: 0.015, paramsB: 400, source: "estimated" },
  "o3-mini": { whPerInputToken: 0.0006, whPerOutputToken: 0.003, paramsB: 30, source: "estimated" },
  "gemini-1-5-pro": { whPerInputToken: 0.002, whPerOutputToken: 0.01, paramsB: 200, source: "estimated" },
  "gemini-1-5-flash": { whPerInputToken: 0.0003, whPerOutputToken: 0.0015, paramsB: 20, source: "estimated" },
  "gemini-2-0-flash": { whPerInputToken: 0.0003, whPerOutputToken: 0.0015, paramsB: 20, source: "estimated" },
  "gemini-2-0-pro": { whPerInputToken: 0.002, whPerOutputToken: 0.01, paramsB: 200, source: "estimated" },
  "llama-3-1-405b": { whPerInputToken: 0.005, whPerOutputToken: 0.025, paramsB: 405, source: "measured" },
  "llama-3-1-70b": { whPerInputToken: 0.001, whPerOutputToken: 0.005, paramsB: 70, source: "measured" },
  "llama-3-1-8b": { whPerInputToken: 0.0002, whPerOutputToken: 0.001, paramsB: 8, source: "measured" },
  "llama-3-70b": { whPerInputToken: 0.001, whPerOutputToken: 0.005, paramsB: 70, source: "measured" },
  "llama-3-8b": { whPerInputToken: 0.0002, whPerOutputToken: 0.001, paramsB: 8, source: "measured" },
  "mistral-7b": { whPerInputToken: 0.0002, whPerOutputToken: 0.001, paramsB: 7, source: "measured" },
  "mixtral-8x7b": { whPerInputToken: 0.0006, whPerOutputToken: 0.003, paramsB: 47, source: "measured" },
  "mixtral-8x22b": { whPerInputToken: 0.0015, whPerOutputToken: 0.0075, paramsB: 141, source: "measured" },
});

export function normalizeModelName(model: string): string {
  let name = model.trim().toLowerCase();
  name = name.replace(/\./g, "-");
  name = name.replace(/-\d{4}-?\d{2}-?\d{2}$/, "");
  name = name.replace(/-(latest|preview)$/, "");
  name = name.replace(/-v\d+$/, "");
  name = name.replace(/-\d{3,4}$/, "");
  return name;
}

export function lookupModelEnergy(model?: string): ModelEnergyCoefficients {
  if (!model) return FALLBACK_COEFFICIENTS;
  const normalized = normalizeModelName(model);
  return MODEL_ENERGY_COEFFICIENTS[normalized] ?? FALLBACK_COEFFICIENTS;
}

export interface EstimateEnergyOpts {
  model?: string;
  inputTokens?: number;
  outputTokens?: number;
  pue?: number;
}

export function estimateEnergyKwh(opts: EstimateEnergyOpts = {}): number {
  const { model, inputTokens, outputTokens, pue = DEFAULT_PUE } = opts;
  if (model === undefined && inputTokens === undefined && outputTokens === undefined) {
    return LEGACY_KWH_PER_TASK;
  }
  const coeffs = lookupModelEnergy(model);
  if (coeffs.source === "fallback" && inputTokens === undefined && outputTokens === undefined) {
    return LEGACY_KWH_PER_TASK;
  }
  const ins = inputTokens ?? TYPICAL_INPUT_TOKENS;
  const outs = outputTokens ?? TYPICAL_OUTPUT_TOKENS;
  const chipWh = ins * coeffs.whPerInputToken + outs * coeffs.whPerOutputToken;
  const gridWh = chipWh * pue;
  return gridWh / 1000;
}

export function gramsForIntensity(
  gCo2PerKwh: number,
  opts: EstimateEnergyOpts = {},
): number {
  return estimateEnergyKwh(opts) * gCo2PerKwh;
}
