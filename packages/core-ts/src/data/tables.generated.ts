/**
 * GENERATED — DO NOT EDIT.
 *
 * Produced by scripts/gen-data.mjs from packages/core-ts/src/data/*.json.
 * Edit those JSON files and run 'pnpm gen:data' to regenerate. CI fails
 * on drift ('pnpm gen:data:check').
 */
import type { ModelEnergyCoefficients, ModelFamily } from "../energy.js";
import type { GridForecastEntry } from "../types.js";

/** Industry-average Power Usage Effectiveness for hyperscaler data centres. */
export const DEFAULT_PUE = 1.15;

/** Backwards-compatible flat estimate. Used when no model is provided. */
export const LEGACY_KWH_PER_TASK = 0.0015;

/** Typical token shape used when a caller names a model but no token counts. */
export const TYPICAL_INPUT_TOKENS = 500;
export const TYPICAL_OUTPUT_TOKENS = 500;

/** Per-model coefficient table. Keys are canonical lowercase names. */
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

/**
 * Ordered family-fallback rules. The first rule whose conditions all hold
 * (see familyRepresentative in energy.ts) supplies coefficients for an
 * otherwise-unknown model id in that family.
 */
export const MODEL_FAMILIES: readonly ModelFamily[] = Object.freeze([
  { id: "claude-opus", representative: "claude-opus-4", contains: ["opus"] },
  { id: "claude-sonnet", representative: "claude-sonnet-4", contains: ["sonnet"] },
  { id: "claude-haiku", representative: "claude-haiku-4-5", contains: ["haiku"] },
  { id: "gpt-4o", representative: "gpt-4o", prefix: "gpt-4o" },
  { id: "gpt-4", representative: "gpt-4", prefix: "gpt-4" },
  { id: "gpt-3", representative: "gpt-3-5-turbo", prefix: "gpt-3" },
  { id: "openai-o", representative: "o3", regex: "^o[0-9]" },
  { id: "gemini-flash", representative: "gemini-2-0-flash", contains: ["flash"], prefix: "gemini" },
  { id: "gemini-pro", representative: "gemini-1-5-pro", prefix: "gemini" },
  { id: "mixtral", representative: "mixtral-8x7b", prefix: "mixtral" },
  { id: "mistral", representative: "mistral-7b", prefix: "mistral" },
  { id: "llama", representative: "llama-3-1-70b", prefix: "llama" },
]);

/** Citation metadata for the coefficient table. */
export const ENERGY_SOURCES = Object.freeze({
  "patterson2021": {
    "citation": "Patterson et al. 2021, 'Carbon Emissions and Large Neural Network Training'",
    "arxiv": "2104.10350"
  },
  "luccioni2024": {
    "citation": "Luccioni, Jernite, Strubell 2024, 'Power Hungry Processing'",
    "venue": "FAccT 2024",
    "arxiv": "2311.16863"
  },
  "huggingface": {
    "citation": "Hugging Face AI Energy Score",
    "url": "https://huggingface.co/AIEnergyScore"
  }
});

/** Synthetic-curve region midpoints (gCO2/kWh). */
export const REGION_FLOORS: Readonly<Record<string, number>> = Object.freeze({
  "US-CAL-CISO": 280,
  "US-TEX-ERCO": 340,
  "US-NE-ISNE": 320,
  "US-NY-NYIS": 360,
  "US-MIDA-PJM": 420,
  "US-MIDW-MISO": 460,
  "FR": 60,
  "DE": 380,
  "GB": 220,
});

/** Fallback midpoint for regions with no explicit floor. */
export const DEFAULT_REGION_FLOOR = 380;

/** Peak-to-trough half-swing of the synthetic curve (gCO2/kWh). */
export const SYNTHETIC_AMPLITUDE = 220;

/** Per-region UTC-hour offset applied to the synthetic curve's local trough. */
export const REGION_UTC_OFFSETS: Readonly<Record<string, number>> = Object.freeze({
  "US-CAL-CISO": -8,
  "US-TEX-ERCO": -6,
  "US-MIDW-MISO": -6,
  "US-NE-ISNE": -5,
  "US-NY-NYIS": -5,
  "US-MIDA-PJM": -5,
  "GB": 0,
  "FR": 1,
  "DE": 1,
});

/** Band thresholds (ascending). A value maps to the first band it is below. */
export const BAND_THRESHOLDS: readonly {
  maxExclusive: number;
  band: GridForecastEntry["band"];
}[] = Object.freeze([
  { maxExclusive: 100, band: "very_clean" },
  { maxExclusive: 250, band: "clean" },
  { maxExclusive: 450, band: "average" },
  { maxExclusive: 700, band: "dirty" },
]);

/** Band for values at or above every threshold. */
export const DEFAULT_BAND: GridForecastEntry["band"] = "very_dirty";
