/**
 * Carbon-intensity grid feeds for the dashboard.
 *
 * Ported (and trimmed) from `packages/core-ts/src/grid.ts` so the
 * dashboard does not need a workspace dependency on @ebb-ai/core.
 *
 *   - `mockGridForecast`: deterministic synthetic curve, zero-config.
 *   - `fetchElectricityMaps`: Electricity Maps free-tier API (key required).
 *   - `fetchUkCarbonIntensity`: National Grid ESO Carbon Intensity API
 *     (GB only, no auth, real 48-hour forecast).
 *   - `fetchGridForecast`: per-zone router. GB → UK feed; other zones →
 *     Electricity Maps (when key is set) → mock fallback.
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

/**
 * UK National Grid ESO Carbon Intensity API.
 *
 * Free, no auth, no key registration. Returns 30-minute interval forecasts
 * up to 48 hours ahead; we average consecutive pairs into the hourly buckets
 * the dashboard uses everywhere else.
 *
 * `actual` is preferred over `forecast` where available (the upstream API
 * backfills `actual` for intervals that have moved into the past).
 *
 * Docs: https://carbon-intensity.github.io/api-definitions/
 */
export async function fetchUkCarbonIntensity(
  hours: number,
): Promise<GridForecast> {
  const now = new Date();
  now.setMinutes(0, 0, 0);
  now.setSeconds(0, 0);
  // API wants YYYY-MM-DDTHH:MMZ.
  const fromStr = `${now.toISOString().slice(0, 16)}Z`;
  const url = `https://api.carbonintensity.org.uk/intensity/${fromStr}/fw48h`;
  const res = await fetch(url, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(5_000),
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(`UK Carbon Intensity API returned ${res.status}`);
  }
  const json = (await res.json()) as {
    data?: Array<{
      from: string;
      to: string;
      intensity: { forecast: number | null; actual: number | null };
    }>;
  };
  const raw = json.data ?? [];
  if (raw.length === 0) {
    throw new Error("UK Carbon Intensity API returned empty forecast");
  }
  const hourly: GridForecastEntry[] = [];
  for (let i = 0; i + 1 < raw.length && hourly.length < hours; i += 2) {
    const a = raw[i];
    const b = raw[i + 1];
    if (!a || !b) continue;
    const va = a.intensity.actual ?? a.intensity.forecast;
    const vb = b.intensity.actual ?? b.intensity.forecast;
    if (va == null || vb == null) continue;
    const avg = Math.round((va + vb) / 2);
    hourly.push({
      datetime: new Date(a.from).toISOString(),
      carbonIntensityGCo2PerKwh: avg,
      band: classifyBand(avg),
    });
  }
  if (hourly.length === 0) {
    throw new Error("UK Carbon Intensity API returned no usable entries");
  }
  return {
    region: "GB",
    source: "ukCarbonIntensity",
    generatedAt: new Date().toISOString(),
    entries: hourly,
  };
}

/**
 * Per-zone routing across the configured providers. The dashboard's only
 * "smart" feed: picks the right source for each region and silently falls
 * back to mock so the page never goes dark.
 *
 *   - "GB"     → UK Carbon Intensity API (free, no key)
 *   - everything else, when `EBB_ELECTRICITY_MAPS_API_KEY` is set
 *             → Electricity Maps free-tier API
 *   - any failure or missing key → deterministic mock curve
 *
 * The returned forecast's `source` field reports the actual data origin,
 * so the UI can distinguish "live" vs "mock" without inspecting URLs.
 */
export async function fetchGridForecast(
  region: string,
  hours: number,
): Promise<GridForecast> {
  if (region === "GB") {
    try {
      return await fetchUkCarbonIntensity(hours);
    } catch (err) {
      console.warn(
        `[ebb-ai/grid] uk-carbon-intensity fetch failed (${(err as Error).message}); using mock`,
      );
      return mockGridForecast(region, hours);
    }
  }

  const apiKey = process.env.EBB_ELECTRICITY_MAPS_API_KEY;
  if (apiKey) {
    try {
      return await fetchElectricityMaps(region, hours, apiKey);
    } catch (err) {
      console.warn(
        `[ebb-ai/grid] electricity-maps fetch failed (${(err as Error).message}); using mock`,
      );
    }
  }
  return mockGridForecast(region, hours);
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
