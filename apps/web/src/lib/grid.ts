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

import { unstable_cache } from "next/cache";

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
 * Lifecycle emission factors (g CO2-equivalent per kWh) per IPCC AR5 WG III
 * Annex III medians. Shared by the EIA and ENTSO-E adapters below.
 */
const EMISSION_FACTORS = {
  coal: 820,
  coal_lignite: 1050,
  gas: 490,
  oil: 740,
  oil_shale: 1000,
  peat: 1000,
  nuclear: 12,
  solar: 48,
  wind_onshore: 11,
  wind_offshore: 12,
  hydro: 24,
  geothermal: 38,
  biomass: 230,
  waste: 700,
  marine: 50,
  other: 700,
} as const;

const EIA_RESPONDENT_BY_ZONE: Record<string, string> = {
  "US-CAL-CISO": "CISO",
  "US-TEX-ERCO": "ERCO",
  "US-NE-ISNE": "ISNE",
  "US-MIDA-PJM": "PJM",
};

const EIA_FUEL_FACTORS: Record<string, number> = {
  COL: EMISSION_FACTORS.coal,
  NG: EMISSION_FACTORS.gas,
  OIL: EMISSION_FACTORS.oil,
  NUC: EMISSION_FACTORS.nuclear,
  SUN: EMISSION_FACTORS.solar,
  WND: EMISSION_FACTORS.wind_onshore,
  WAT: EMISSION_FACTORS.hydro,
  OTH: EMISSION_FACTORS.other,
};

interface EiaFuelRow {
  period: string;
  respondent: string;
  fueltype: string;
  value: number | string | null;
}

/**
 * EIA Open Data API. Returns last-24h-shifted-forward as a naive forecast
 * (the API offers no first-class forecast endpoint). See the core-ts
 * `eiaFeed()` for the full doc-string; this is the dashboard mirror.
 */
export async function fetchEia(
  region: string,
  hours: number,
  apiKey: string,
): Promise<GridForecast> {
  const respondent = EIA_RESPONDENT_BY_ZONE[region];
  if (!respondent) {
    throw new Error(`EIA does not cover zone "${region}"`);
  }
  const now = new Date();
  const endHour = new Date(now);
  endHour.setMinutes(0, 0, 0);
  endHour.setSeconds(0, 0);
  const startHour = new Date(endHour.getTime() - 30 * 60 * 60 * 1000);
  const fmt = (d: Date) => d.toISOString().slice(0, 13);

  const params = new URLSearchParams({
    api_key: apiKey,
    frequency: "hourly",
    "data[0]": "value",
    "facets[respondent][]": respondent,
    start: fmt(startHour),
    end: fmt(endHour),
    "sort[0][column]": "period",
    "sort[0][direction]": "asc",
    length: "5000",
  });
  for (const code of Object.keys(EIA_FUEL_FACTORS)) {
    params.append("facets[fueltype][]", code);
  }
  const url = `https://api.eia.gov/v2/electricity/rto/fuel-type-data/data/?${params.toString()}`;

  const res = await fetch(url, {
    signal: AbortSignal.timeout(8_000),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`EIA API returned ${res.status}`);
  const json = (await res.json()) as { response?: { data?: EiaFuelRow[] } };
  const rows = json.response?.data ?? [];
  if (rows.length === 0) throw new Error("EIA API returned no rows");

  const byPeriod: Record<string, { num: number; den: number }> = {};
  for (const row of rows) {
    const factor = EIA_FUEL_FACTORS[row.fueltype];
    if (factor === undefined) continue;
    const v = typeof row.value === "string" ? Number(row.value) : row.value;
    if (v == null || !Number.isFinite(v) || v < 0) continue;
    byPeriod[row.period] ??= { num: 0, den: 0 };
    byPeriod[row.period]!.num += v * factor;
    byPeriod[row.period]!.den += v;
  }
  const periods = Object.keys(byPeriod).sort();
  const intensities: number[] = [];
  for (const p of periods) {
    const cell = byPeriod[p]!;
    if (cell.den === 0) continue;
    intensities.push(Math.round(cell.num / cell.den));
  }
  if (intensities.length === 0) {
    throw new Error("EIA API returned no usable rows");
  }
  const tail = intensities.slice(-24);
  const startTs = new Date(now);
  startTs.setMinutes(0, 0, 0);
  startTs.setSeconds(0, 0);
  const entries: GridForecastEntry[] = [];
  for (let i = 0; i < hours; i++) {
    const g = tail[i % tail.length]!;
    const t = new Date(startTs.getTime() + i * 60 * 60 * 1000);
    entries.push({
      datetime: t.toISOString(),
      carbonIntensityGCo2PerKwh: g,
      band: classifyBand(g),
    });
  }
  return {
    region,
    source: "eia",
    generatedAt: new Date().toISOString(),
    entries,
  };
}

const ENTSOE_BIDDING_ZONE_BY_REGION: Record<string, string> = {
  FR: "10YFR-RTE------C",
  DE: "10Y1001A1001A82H",
};

const ENTSOE_PSR_FACTORS: Record<string, number> = {
  B01: EMISSION_FACTORS.biomass,
  B02: EMISSION_FACTORS.coal_lignite,
  B03: EMISSION_FACTORS.gas,
  B04: EMISSION_FACTORS.gas,
  B05: EMISSION_FACTORS.coal,
  B06: EMISSION_FACTORS.oil,
  B07: EMISSION_FACTORS.oil_shale,
  B08: EMISSION_FACTORS.peat,
  B09: EMISSION_FACTORS.geothermal,
  B10: EMISSION_FACTORS.hydro,
  B11: EMISSION_FACTORS.hydro,
  B12: EMISSION_FACTORS.hydro,
  B13: EMISSION_FACTORS.marine,
  B14: EMISSION_FACTORS.nuclear,
  B15: EMISSION_FACTORS.biomass,
  B16: EMISSION_FACTORS.solar,
  B17: EMISSION_FACTORS.waste,
  B18: EMISSION_FACTORS.wind_offshore,
  B19: EMISSION_FACTORS.wind_onshore,
  B20: EMISSION_FACTORS.other,
};

function parseEntsoeXml(xml: string): Array<{
  psrType: string;
  start: string;
  resolutionMin: number;
  points: number[];
}> {
  const out: Array<{
    psrType: string;
    start: string;
    resolutionMin: number;
    points: number[];
  }> = [];
  const tsRe = /<TimeSeries>([\s\S]*?)<\/TimeSeries>/g;
  for (const m of xml.matchAll(tsRe)) {
    const block = m[1] ?? "";
    const psr = block.match(/<psrType>([A-Z0-9]+)<\/psrType>/)?.[1];
    const start = block.match(/<start>([0-9TZ:-]+)<\/start>/)?.[1];
    const res = block.match(/<resolution>PT(\d+)M<\/resolution>/)?.[1];
    if (!psr || !start || !res) continue;
    const pointMatches = [
      ...block.matchAll(/<Point>\s*<position>\d+<\/position>\s*<quantity>([\d.]+)<\/quantity>\s*<\/Point>/g),
    ];
    const points = pointMatches
      .map((p) => Number(p[1]))
      .filter((n) => Number.isFinite(n));
    if (points.length === 0) continue;
    out.push({ psrType: psr, start, resolutionMin: Number(res), points });
  }
  return out;
}

/**
 * ENTSO-E Transparency Platform feed. EU bidding zones only (currently FR
 * and DE on this dashboard). See core-ts `entsoeFeed()` for the full
 * doc-string; this is the dashboard mirror.
 */
export async function fetchEntsoe(
  region: string,
  hours: number,
  securityToken: string,
): Promise<GridForecast> {
  const zone = ENTSOE_BIDDING_ZONE_BY_REGION[region];
  if (!zone) {
    throw new Error(`ENTSO-E does not cover zone "${region}"`);
  }
  const now = new Date();
  const endHour = new Date(now);
  endHour.setMinutes(0, 0, 0);
  endHour.setSeconds(0, 0);
  const startHour = new Date(endHour.getTime() - 24 * 60 * 60 * 1000);
  const fmt = (d: Date) =>
    d.toISOString().replace(/[-:T]/g, "").slice(0, 12);
  const params = new URLSearchParams({
    securityToken,
    documentType: "A75",
    processType: "A16",
    in_Domain: zone,
    periodStart: fmt(startHour),
    periodEnd: fmt(endHour),
  });
  const url = `https://web-api.tp.entsoe.eu/api?${params.toString()}`;
  const res = await fetch(url, {
    headers: { Accept: "application/xml" },
    signal: AbortSignal.timeout(10_000),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`ENTSO-E API returned ${res.status}`);
  const xml = await res.text();
  const series = parseEntsoeXml(xml);
  if (series.length === 0) {
    throw new Error("ENTSO-E returned no TimeSeries blocks");
  }
  const byHourMs: Record<number, { num: number; den: number }> = {};
  for (const ts of series) {
    const factor = ENTSOE_PSR_FACTORS[ts.psrType];
    if (factor === undefined) continue;
    const seriesStart = new Date(ts.start).getTime();
    for (let i = 0; i < ts.points.length; i++) {
      const v = ts.points[i]!;
      if (!Number.isFinite(v) || v < 0) continue;
      const t = seriesStart + i * ts.resolutionMin * 60_000;
      const hr = Math.floor(t / 3_600_000) * 3_600_000;
      const weight = ts.resolutionMin / 60;
      byHourMs[hr] ??= { num: 0, den: 0 };
      byHourMs[hr]!.num += v * weight * factor;
      byHourMs[hr]!.den += v * weight;
    }
  }
  const sortedHours = Object.keys(byHourMs)
    .map(Number)
    .sort((a, b) => a - b);
  const intensities: number[] = [];
  for (const hr of sortedHours) {
    const cell = byHourMs[hr]!;
    if (cell.den === 0) continue;
    intensities.push(Math.round(cell.num / cell.den));
  }
  if (intensities.length === 0) {
    throw new Error("ENTSO-E returned no usable hourly buckets");
  }
  const tail = intensities.slice(-24);
  const startTs = new Date(now);
  startTs.setMinutes(0, 0, 0);
  startTs.setSeconds(0, 0);
  const entries: GridForecastEntry[] = [];
  for (let i = 0; i < hours; i++) {
    const g = tail[i % tail.length]!;
    const t = new Date(startTs.getTime() + i * 60 * 60 * 1000);
    entries.push({
      datetime: t.toISOString(),
      carbonIntensityGCo2PerKwh: g,
      band: classifyBand(g),
    });
  }
  return {
    region,
    source: "entsoe",
    generatedAt: new Date().toISOString(),
    entries,
  };
}

/**
 * Per-zone routing across the configured providers. Each zone has a
 * primary source; failures and missing keys fall back to the next-best
 * option, ending at the deterministic mock so the dashboard never goes
 * dark. The returned forecast's `source` field reports the actual data
 * origin, so the UI can distinguish "live" vs "mock" without inspecting
 * URLs.
 *
 *   - "GB"                                    → UK Carbon Intensity API (free, no key)
 *   - "US-CAL-CISO" / ERCO / ISNE / MIDA-PJM  → EIA (when EBB_EIA_API_KEY set)
 *   - "FR" / "DE"                             → ENTSO-E (when EBB_ENTSOE_SECURITY_TOKEN set)
 *   - anything else, when EBB_ELECTRICITY_MAPS_API_KEY is set → Electricity Maps
 *   - any failure or missing key              → deterministic mock curve
 */
export async function fetchGridForecast(
  region: string,
  hours: number,
): Promise<GridForecast> {
  // GB: always free, always tried first.
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

  // US ISOs: EIA when key is available.
  if (EIA_RESPONDENT_BY_ZONE[region]) {
    const key = process.env.EBB_EIA_API_KEY;
    if (key) {
      try {
        return await fetchEia(region, hours, key);
      } catch (err) {
        console.warn(
          `[ebb-ai/grid] eia fetch failed (${(err as Error).message}); falling through`,
        );
      }
    }
  }

  // EU zones: ENTSO-E when token is available.
  if (ENTSOE_BIDDING_ZONE_BY_REGION[region]) {
    const token = process.env.EBB_ENTSOE_SECURITY_TOKEN;
    if (token) {
      try {
        return await fetchEntsoe(region, hours, token);
      } catch (err) {
        console.warn(
          `[ebb-ai/grid] entsoe fetch failed (${(err as Error).message}); falling through`,
        );
      }
    }
  }

  // Universal fallback: Electricity Maps if a key is configured.
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

/**
 * Cached `fetchGridForecast` — keyed by (zone, hours), refreshed every
 * 5 minutes. Grid data is hourly-granularity, so a 5-min cache is
 * imperceptible while it caps upstream feed calls (Electricity Maps /
 * EIA) regardless of page traffic. Use this on pages rendered per
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
