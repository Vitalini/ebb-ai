/**
 * Grid carbon-intensity for the dashboard — a thin adapter over @ebb-ai/core.
 *
 * Until audit §2.3 this file carried a ~500-line hand-ported copy of
 * `packages/core-ts/src/grid.ts` (mock curve, Electricity Maps / UK / EIA /
 * ENTSO-E fetchers, XML parser, emission factors, per-zone routing). The
 * dashboard is now a real consumer of core: all of that lives in
 * `@ebb-ai/core/grid` (a browser-safe subpath — its import graph is just the
 * generated data tables plus the shared types, no Node built-ins), reached
 * here through `buildDefaultGridFeed()`.
 *
 * What remains is genuinely web-only:
 *   - `getGridForecast`: the Next.js `unstable_cache` wrapper (5-minute
 *     revalidation) used by per-request pages.
 *   - `pickBestWindow` / `BestWindow`: the /plan page's display helper that
 *     also reports the chosen entry's offset for chart highlighting.
 *   - `intensityToGrams`: a rounded single-number projection for the UI.
 *
 * `@ebb-ai/core` is environment-pure — it reads no environment variables and
 * takes credentials as arguments. The dashboard is a HOST, so it reads the
 * feed env vars here (EBB_EIA_API_KEY, EBB_ENTSOE_SECURITY_TOKEN,
 * EBB_ELECTRICITY_MAPS_API_KEY, and WATTTIME_USERNAME/WATTTIME_PASSWORD for
 * the US ISOs' marginal feed) and injects them into `buildDefaultGridFeed`,
 * which falls back to the deterministic mock so the dashboard never goes dark.
 *
 * This module is server-only (the env reads run in the Next.js server
 * runtime); no credential ever reaches the browser bundle.
 */

import { unstable_cache } from "next/cache";

import { buildDefaultGridFeed } from "@ebb-ai/core/grid";
import { gramsForIntensity } from "@ebb-ai/core/energy";

import type { GridForecast, GridForecastEntry } from "./types";

/**
 * The zone-routing feed: GB → UK Carbon Intensity (free); the major US ISOs →
 * WattTime marginal forecast when its credentials are set, else EIA; the EU
 * bidding zones → ENTSO-E; everything else → Electricity Maps; any missing
 * key or failure → deterministic mock. Each leaf reports its own `source`,
 * so the UI can still distinguish "live" from "mock".
 */
const feed = buildDefaultGridFeed({
  electricityMapsApiKey: process.env.EBB_ELECTRICITY_MAPS_API_KEY,
  eiaApiKey: process.env.EBB_EIA_API_KEY,
  entsoeSecurityToken: process.env.EBB_ENTSOE_SECURITY_TOKEN,
  wattTimeUsername: process.env.WATTTIME_USERNAME,
  wattTimePassword: process.env.WATTTIME_PASSWORD,
});

/**
 * Fetch a forecast for `region` over `hours`, routed across the configured
 * feeds. Never throws — the underlying feeds each degrade to the mock curve.
 */
export async function fetchGridForecast(
  region: string,
  hours: number,
): Promise<GridForecast> {
  return feed.fetchForecast(region, hours);
}

/**
 * Cached `fetchGridForecast` — keyed by (zone, hours), refreshed every
 * 5 minutes. Grid data is hourly-granularity, so a 5-min cache is
 * imperceptible while it caps upstream feed calls (Electricity Maps /
 * EIA / ENTSO-E) regardless of page traffic. Use this on pages rendered per
 * request — the home greeting and the multi-region map.
 */
export const getGridForecast = unstable_cache(
  (region: string, hours: number) => fetchGridForecast(region, hours),
  ["grid-forecast-v1"],
  { revalidate: 300 },
);

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
 *
 * This is the /plan page's strict-minimum display pick (it also reports the
 * chosen entry's `hourOffset` so the chart can highlight it). It intentionally
 * stays a local helper rather than reusing core's committing `selectWindow`
 * tie-break — the planning preview shows the single cleanest hour.
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
    projectedGramsCo2: intensityToGrams(best.entry.carbonIntensityGCo2PerKwh),
  };
}

/**
 * Grams CO2-equivalent for a single inference call.
 *
 * `model` is optional — without it, the function returns the legacy
 * flat-task estimate (matches the per-region map cards). With a model, it uses
 * the per-model Wh/token table from `@ebb-ai/core/energy`.
 */
export function intensityToGrams(gCo2PerKwh: number, model?: string): number {
  return Math.round(gramsForIntensity(gCo2PerKwh, { model }) * 10) / 10;
}
