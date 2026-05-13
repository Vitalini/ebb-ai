/**
 * Carbon-intensity grid feeds for the dashboard.
 *
 * Ported (and trimmed) from `packages/core-ts/src/grid.ts` so the
 * dashboard does not need a workspace dependency on @ebb-ai/core in v0.2.
 *
 *   - `mockGridForecast`: deterministic synthetic curve, zero-config.
 *   - `fetchElectricityMaps`: hits Electricity Maps' free-tier API
 *     with a 5-second timeout. Falls back to the mock on any failure.
 *
 * Used by `/api/grid/[region]/route.ts`.
 */

import type {
  CarbonBand,
  GridForecast,
  GridForecastEntry,
} from "./types";

/** Energy use per "typical" deferrable LLM call (kWh, including PUE). */
export const ENERGY_KWH_PER_TASK = 0.0015;

export const BAND_THRESHOLDS: Record<CarbonBand, number> = {
  very_clean: 100,
  clean: 250,
  average: 450,
  dirty: 700,
  very_dirty: Infinity,
};

export function classifyBand(g: number): CarbonBand {
  if (g < 100) return "very_clean";
  if (g < 250) return "clean";
  if (g < 450) return "average";
  if (g < 700) return "dirty";
  return "very_dirty";
}

/**
 * Synthetic intraday curve. Identical shape to the core-ts version:
 * a sinusoid that bottoms ~03:00 UTC and peaks ~17:00 UTC, with a
 * region-specific floor. Deterministic given (region, hour).
 */
const REGION_FLOOR: Record<string, number> = {
  "US-CAL-CISO": 280,
  "US-TEX-ERCO": 340,
  "US-NE-ISNE": 320,
  "US-NY-NYIS": 360,
  "US-MIDA-PJM": 420,
  "US-MIDW-MISO": 460,
  FR: 60,
  DE: 380,
  GB: 220,
};

function syntheticIntensityForHour(date: Date, region: string): number {
  const floor = REGION_FLOOR[region] ?? 380;
  const amplitude = 220;
  const hour = date.getUTCHours();
  const phase = (hour - 17) * (Math.PI / 12);
  return Math.round(floor + amplitude * Math.cos(phase));
}

export function mockGridForecast(region: string, hours = 72): GridForecast {
  const now = new Date();
  now.setMinutes(0, 0, 0);
  const entries: GridForecastEntry[] = [];
  for (let i = 0; i < hours; i++) {
    const t = new Date(now.getTime() + i * 60 * 60 * 1000);
    const g = syntheticIntensityForHour(t, region);
    entries.push({
      datetime: t.toISOString(),
      carbonIntensityGCo2PerKwh: g,
      band: classifyBand(g),
    });
  }
  return {
    region,
    source: "mock",
    generatedAt: new Date().toISOString(),
    entries,
  };
}

/**
 * Hits Electricity Maps' free-tier API. Returns the parsed forecast or
 * throws — callers should catch and fall back to mock.
 *
 * Docs: https://www.electricitymaps.com/free-tier-api
 *   GET https://api.electricitymap.org/v3/carbon-intensity/forecast?zone=…
 *   Header: auth-token: <key>
 */
export async function fetchElectricityMaps(
  region: string,
  hours: number,
  apiKey: string,
): Promise<GridForecast> {
  const url = `https://api.electricitymap.org/v3/carbon-intensity/forecast?zone=${encodeURIComponent(
    region,
  )}`;
  const res = await fetch(url, {
    headers: { "auth-token": apiKey },
    signal: AbortSignal.timeout(5_000),
    // Don't cache between requests — we want fresh forecast data.
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(`Electricity Maps returned ${res.status}`);
  }
  const json = (await res.json()) as {
    zone?: string;
    forecast?: Array<{ datetime: string; carbonIntensity: number }>;
  };
  const raw = (json.forecast ?? []).slice(0, hours);
  if (raw.length === 0) {
    throw new Error("Electricity Maps returned empty forecast");
  }
  const entries: GridForecastEntry[] = raw.map((e) => ({
    datetime: e.datetime,
    carbonIntensityGCo2PerKwh: Math.round(e.carbonIntensity),
    band: classifyBand(e.carbonIntensity),
  }));
  return {
    region,
    source: "electricityMaps",
    generatedAt: new Date().toISOString(),
    entries,
  };
}

export interface BestWindow {
  entry: GridForecastEntry;
  /** Position of this entry in the original forecast (0-indexed). */
  hourOffset: number;
  /** Estimated grams CO2e for one task in this window. */
  projectedGramsCo2: number;
}

/**
 * Pick the cleanest forecast entry between `now` and `deadline`.
 * Returns `undefined` if no entry falls in that window — usually a sign
 * that the deadline is in the past.
 */
export function pickBestWindow(
  forecast: GridForecast,
  deadline: Date,
): BestWindow | undefined {
  const deadlineMs = deadline.getTime();
  const nowMs = Date.now();
  let best: { entry: GridForecastEntry; idx: number } | undefined;
  forecast.entries.forEach((entry, idx) => {
    const t = new Date(entry.datetime).getTime();
    if (t < nowMs - 60 * 60 * 1000) return; // skip past hours
    if (t > deadlineMs) return;
    if (
      !best ||
      entry.carbonIntensityGCo2PerKwh < best.entry.carbonIntensityGCo2PerKwh
    ) {
      best = { entry, idx };
    }
  });
  if (!best) return undefined;
  return {
    entry: best.entry,
    hourOffset: best.idx,
    projectedGramsCo2:
      Math.round(
        ENERGY_KWH_PER_TASK * best.entry.carbonIntensityGCo2PerKwh * 10,
      ) / 10,
  };
}

export function intensityToGrams(gCo2PerKwh: number): number {
  return Math.round(ENERGY_KWH_PER_TASK * gCo2PerKwh * 10) / 10;
}
