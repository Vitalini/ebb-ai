/**
 * Grid carbon-intensity feeds.
 *
 * Built-in sources:
 *   - mockGridFeed: deterministic synthetic curve, zero-config.
 *   - electricityMapsFeed: Electricity Maps free-tier API (key required).
 *   - ukCarbonIntensityFeed: National Grid ESO Carbon Intensity API
 *     (GB only, no auth, real forecast + 48h horizon).
 *   - multiSourceGridFeed: routes per zone across the feeds above.
 *
 * WattTime marginal-emissions support is tracked on the roadmap.
 */

import type { GridFeed, GridForecast, GridForecastEntry } from "./types.js";

function classify(g: number): GridForecastEntry["band"] {
  if (g < 100) return "very_clean";
  if (g < 250) return "clean";
  if (g < 450) return "average";
  if (g < 700) return "dirty";
  return "very_dirty";
}

/**
 * Build a synthetic intraday carbon curve.
 *
 * Real grid intensity in the US typically dips overnight (lots of base-load
 * nuclear and hydro, plus wind) and peaks late afternoon (residential AC,
 * gas peaker plants). We mimic that shape with a sinusoid that bottoms at
 * 03:00 local and peaks at 17:00 local.
 */
function syntheticIntensityForHour(date: Date, region: string): number {
  // Region-specific midpoint so different regions look distinct.
  const regionFloor: Record<string, number> = {
    "US-CAL-CISO": 280, // California — lots of solar daytime, gas overnight
    "US-TEX-ERCO": 340, // Texas — wind off-peak, gas peak
    "US-NE-ISNE": 320, // New England
    "US-NY-NYIS": 360,
    "US-MIDA-PJM": 420,
    "US-MIDW-MISO": 460,
    "FR": 60, // mostly nuclear
    "DE": 380,
    "GB": 220,
  };
  // Per-region phase offset in UTC hours: each region's local-time
  // trough (≈ 03:00 local) translates to a different UTC hour. Without
  // this offset, every region shares the same 03:00 UTC trough and
  // multi-region simulations pile every "cleanest hour" choice into
  // the same bucket (the even-distribution.test.ts pathology shown
  // pre-v0.8.1: 66.9 % of dispatch in a single hour). The offset is
  // approximate — real local clock varies with DST, but a single
  // canonical UTC offset is sufficient for the synthetic curve to
  // exhibit per-region trough variation.
  const regionUtcOffsetHours: Record<string, number> = {
    "US-CAL-CISO": -8,
    "US-TEX-ERCO": -6,
    "US-MIDW-MISO": -6,
    "US-NE-ISNE": -5,
    "US-NY-NYIS": -5,
    "US-MIDA-PJM": -5,
    "GB": 0,
    "FR": 1,
    "DE": 1,
  };
  const floor = regionFloor[region] ?? 380;
  const offsetH = regionUtcOffsetHours[region] ?? 0;
  const amplitude = 220;
  // Local-clock trough at 03:00, peak at 17:00. Phase 0 ⇒ peak.
  const utcHour = date.getUTCHours();
  const localHour = ((utcHour + offsetH) % 24 + 24) % 24;
  const phase = (localHour - 17) * (Math.PI / 12);
  const value = floor + amplitude * Math.cos(phase);
  return Math.max(0, Math.round(value));
}

export function mockGridFeed(): GridFeed {
  return {
    source: "mock",
    async fetchForecast(region: string, hours: number): Promise<GridForecast> {
      const now = new Date();
      now.setMinutes(0, 0, 0);
      const entries: GridForecastEntry[] = [];
      for (let i = 0; i < hours; i++) {
        const t = new Date(now.getTime() + i * 60 * 60 * 1000);
        const g = syntheticIntensityForHour(t, region);
        entries.push({
          datetime: t.toISOString(),
          carbonIntensityGCo2PerKwh: g,
          band: classify(g),
        });
      }
      return {
        region,
        source: "mock",
        generatedAt: new Date().toISOString(),
        entries,
      };
    },
  };
}

/**
 * Electricity Maps free-tier API.
 *
 * Docs: https://www.electricitymaps.com/free-tier-api
 * Endpoint: GET https://api.electricitymap.org/v3/carbon-intensity/forecast?zone=…
 * Header: auth-token: <key>
 *
 * Falls back to the mock feed (and logs to stderr) if the API key is
 * missing, the request fails, or the response shape is unexpected. The
 * fallback is deliberate so a developer can still run the whole stack
 * end-to-end without signing up.
 */
export function electricityMapsFeed(apiKey?: string): GridFeed {
  const key = apiKey ?? process.env.EBB_ELECTRICITY_MAPS_API_KEY;
  const mock = mockGridFeed();

  if (!key) {
    return {
      source: "mock",
      async fetchForecast(region, hours) {
        // eslint-disable-next-line no-console
        console.warn(
          "[ebb-ai/grid] no EBB_ELECTRICITY_MAPS_API_KEY set — using mock data",
        );
        return mock.fetchForecast(region, hours);
      },
    };
  }

  return {
    source: "electricityMaps",
    async fetchForecast(region, hours) {
      try {
        const url = `https://api.electricitymap.org/v3/carbon-intensity/forecast?zone=${encodeURIComponent(region)}`;
        // Hard timeout — without one a degraded Electricity Maps edge can hang
        // the scheduler indefinitely.
        const res = await fetch(url, {
          headers: { "auth-token": key },
          signal: AbortSignal.timeout(5_000),
        });
        if (!res.ok) {
          throw new Error(`Electricity Maps returned ${res.status}`);
        }
        const json = (await res.json()) as {
          zone?: string;
          forecast?: Array<{
            datetime: string;
            carbonIntensity: number;
          }>;
        };
        const raw = (json.forecast ?? []).slice(0, hours);
        if (raw.length === 0) {
          throw new Error("Electricity Maps returned empty forecast");
        }
        const entries: GridForecastEntry[] = raw.map((e) => ({
          datetime: e.datetime,
          carbonIntensityGCo2PerKwh: Math.round(e.carbonIntensity),
          band: classify(e.carbonIntensity),
        }));
        return {
          region,
          source: "electricityMaps",
          generatedAt: new Date().toISOString(),
          entries,
        };
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn(
          `[ebb-ai/grid] electricity-maps fetch failed (${(err as Error).message}); falling back to mock`,
        );
        return mock.fetchForecast(region, hours);
      }
    },
  };
}

/**
 * UK National Grid ESO Carbon Intensity API — `api.carbonintensity.org.uk`.
 *
 * Pros: free, no auth, no rate-limit registration, real 48-hour forecast.
 * Cons: GB only. Other zones fall back to the synthetic mock so this feed
 * is safe to use as the default zone-agnostic feed.
 *
 * The upstream API returns 30-minute intervals; we average each consecutive
 * pair into the hourly buckets ebb-ai uses elsewhere. Actual intensity is
 * preferred over forecast where the backfilled `actual` field is populated
 * (i.e. for the first one or two intervals on a fresh request).
 *
 * Docs: https://carbon-intensity.github.io/api-definitions/#carbon-intensity
 */
export function ukCarbonIntensityFeed(): GridFeed {
  const mock = mockGridFeed();
  return {
    source: "ukCarbonIntensity",
    async fetchForecast(region, hours) {
      if (region !== "GB") {
        // eslint-disable-next-line no-console
        console.warn(
          `[ebb-ai/grid] ukCarbonIntensityFeed only supports zone "GB" (got "${region}") — using mock`,
        );
        return mock.fetchForecast(region, hours);
      }
      try {
        const now = new Date();
        now.setMinutes(0, 0, 0);
        now.setSeconds(0, 0);
        // API wants YYYY-MM-DDTHH:MMZ (no seconds).
        const fromStr = `${now.toISOString().slice(0, 16)}Z`;
        const url = `https://api.carbonintensity.org.uk/intensity/${fromStr}/fw48h`;
        const res = await fetch(url, {
          headers: { Accept: "application/json" },
          signal: AbortSignal.timeout(5_000),
        });
        if (!res.ok) {
          throw new Error(`UK Carbon Intensity API returned ${res.status}`);
        }
        const json = (await res.json()) as {
          data?: Array<{
            from: string;
            to: string;
            intensity: {
              forecast: number | null;
              actual: number | null;
            };
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
          // `i + 1 < raw.length` guarantees both are defined, but TS strict
          // index access doesn't narrow `a`/`b`. Guard explicitly.
          if (!a || !b) continue;
          const va = a.intensity.actual ?? a.intensity.forecast;
          const vb = b.intensity.actual ?? b.intensity.forecast;
          if (va == null || vb == null) continue;
          const avg = Math.round((va + vb) / 2);
          hourly.push({
            datetime: new Date(a.from).toISOString(),
            carbonIntensityGCo2PerKwh: avg,
            band: classify(avg),
          });
        }
        if (hourly.length === 0) {
          throw new Error(
            "UK Carbon Intensity API returned no usable hourly entries",
          );
        }
        return {
          region,
          source: "ukCarbonIntensity",
          generatedAt: new Date().toISOString(),
          entries: hourly,
        };
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn(
          `[ebb-ai/grid] uk-carbon-intensity fetch failed (${(err as Error).message}); falling back to mock`,
        );
        return mock.fetchForecast(region, hours);
      }
    },
  };
}

/**
 * Lifecycle emission factors (grams CO2-equivalent per kWh).
 *
 * Sourced from IPCC AR5 WG III Annex III (median values, lifecycle), with
 * Schlömer et al. (2014) used as the canonical reference. Used by the EIA
 * and ENTSO-E adapters to convert generation-mix data into a single
 * carbon-intensity number per hour.
 *
 * These are *lifecycle* factors — they include construction, fuel chain,
 * and decommissioning — not just combustion. That is the right anchor
 * for comparing dispatchable thermal generation against renewables on a
 * climate-impact basis.
 */
const EMISSION_FACTORS_G_CO2_PER_KWH = {
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

/**
 * EIA Open Data API — `api.eia.gov`.
 *
 * Pros: free (with a 5-second registration), federal data source, covers
 * every major US ISO/RTO with sub-hour resolution, no rate-limit on
 * reasonable use.
 * Cons: returns *historical* data only — there is no official forecast
 * endpoint for grid carbon intensity. We use the most recent 24 hours of
 * realized hourly fuel mix as a naive forecast for the next 24 hours,
 * which is defensible for "is now or +6h cleaner than +20h?" decisions
 * but should not be treated as a meteorologically-aware forecast.
 *
 * Carbon intensity is computed from the realized fuel-mix breakdown using
 * the IPCC AR5 lifecycle factors in `EMISSION_FACTORS_G_CO2_PER_KWH`.
 *
 * Zones supported (EIA respondent codes):
 *   - US-CAL-CISO  → CISO
 *   - US-TEX-ERCO  → ERCO
 *   - US-NE-ISNE   → ISNE
 *   - US-MIDA-PJM  → PJM
 *   - US-NY-NYIS   → NYIS  (bonus, not on the dashboard yet)
 *   - US-MIDW-MISO → MISO  (bonus)
 *
 * Other zones fall back to the synthetic mock.
 *
 * Docs: https://www.eia.gov/opendata/documentation.php
 *       Get a free API key at https://www.eia.gov/opendata/register.php
 */
const EIA_RESPONDENT_BY_ZONE: Record<string, string> = {
  "US-CAL-CISO": "CISO",
  "US-TEX-ERCO": "ERCO",
  "US-NE-ISNE": "ISNE",
  "US-MIDA-PJM": "PJM",
  "US-NY-NYIS": "NYIS",
  "US-MIDW-MISO": "MISO",
};

/** EIA fuel-type codes → emission-factor key. */
const EIA_FUEL_FACTORS: Record<string, number> = {
  COL: EMISSION_FACTORS_G_CO2_PER_KWH.coal,
  NG: EMISSION_FACTORS_G_CO2_PER_KWH.gas,
  OIL: EMISSION_FACTORS_G_CO2_PER_KWH.oil,
  NUC: EMISSION_FACTORS_G_CO2_PER_KWH.nuclear,
  SUN: EMISSION_FACTORS_G_CO2_PER_KWH.solar,
  WND: EMISSION_FACTORS_G_CO2_PER_KWH.wind_onshore,
  WAT: EMISSION_FACTORS_G_CO2_PER_KWH.hydro,
  OTH: EMISSION_FACTORS_G_CO2_PER_KWH.other,
};

interface EiaFuelRow {
  period: string; // ISO-ish, e.g. "2026-05-14T14"
  respondent: string;
  fueltype: string;
  value: number | string | null;
}

/**
 * Carbon-intensity feed backed by the US Energy Information Administration's
 * v2 Open Data API. Returns a synthesized hourly forecast from the last
 * 24 hours of realized fuel mix.
 */
export function eiaFeed(apiKey?: string): GridFeed {
  const key = apiKey ?? process.env.EBB_EIA_API_KEY;
  const mock = mockGridFeed();
  if (!key) {
    return {
      source: "mock",
      async fetchForecast(region, hours) {
        // eslint-disable-next-line no-console
        console.warn(
          "[ebb-ai/grid] no EBB_EIA_API_KEY set — using mock data for EIA-eligible zones",
        );
        return mock.fetchForecast(region, hours);
      },
    };
  }

  return {
    source: "eia",
    async fetchForecast(region, hours) {
      const respondent = EIA_RESPONDENT_BY_ZONE[region];
      if (!respondent) {
        // eslint-disable-next-line no-console
        console.warn(
          `[ebb-ai/grid] eiaFeed does not cover zone "${region}" — using mock`,
        );
        return mock.fetchForecast(region, hours);
      }
      try {
        // Pull the last 30 hours so we have a buffer of completed hours.
        // EIA timestamps are UTC, no offset; the "period" field is "YYYY-MM-DDTHH".
        const now = new Date();
        const endHour = new Date(now);
        endHour.setMinutes(0, 0, 0);
        endHour.setSeconds(0, 0);
        const startHour = new Date(endHour.getTime() - 30 * 60 * 60 * 1000);
        const fmt = (d: Date) => d.toISOString().slice(0, 13); // "YYYY-MM-DDTHH"

        const params = new URLSearchParams({
          api_key: key,
          frequency: "hourly",
          "data[0]": "value",
          "facets[respondent][]": respondent,
          start: fmt(startHour),
          end: fmt(endHour),
          "sort[0][column]": "period",
          "sort[0][direction]": "asc",
          length: "5000",
        });
        // Multiple fueltype facets need to be appended individually.
        for (const code of Object.keys(EIA_FUEL_FACTORS)) {
          params.append("facets[fueltype][]", code);
        }
        const url = `https://api.eia.gov/v2/electricity/rto/fuel-type-data/data/?${params.toString()}`;

        const res = await fetch(url, {
          signal: AbortSignal.timeout(8_000),
        });
        if (!res.ok) {
          throw new Error(`EIA API returned ${res.status}`);
        }
        const json = (await res.json()) as {
          response?: { data?: EiaFuelRow[] };
        };
        const rows = json.response?.data ?? [];
        if (rows.length === 0) {
          throw new Error("EIA API returned no rows");
        }

        // Group by period, compute weighted-average intensity per hour.
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
        const historicalIntensities: number[] = [];
        for (const p of periods) {
          const cell = byPeriod[p]!;
          if (cell.den === 0) continue;
          historicalIntensities.push(Math.round(cell.num / cell.den));
        }
        if (historicalIntensities.length === 0) {
          throw new Error("EIA API returned no usable fuel-mix rows");
        }

        // Synthesise a forecast: use the last 24 hours of history, shifted
        // 24h forward, padded by repeating if we don't have enough history.
        // entries[0] = "now" (anchored to the latest observation).
        const tail = historicalIntensities.slice(-24);
        const forecast: GridForecastEntry[] = [];
        const startTs = new Date(now);
        startTs.setMinutes(0, 0, 0);
        startTs.setSeconds(0, 0);
        for (let i = 0; i < hours; i++) {
          const g = tail[i % tail.length]!;
          const t = new Date(startTs.getTime() + i * 60 * 60 * 1000);
          forecast.push({
            datetime: t.toISOString(),
            carbonIntensityGCo2PerKwh: g,
            band: classify(g),
          });
        }
        return {
          region,
          source: "eia",
          generatedAt: new Date().toISOString(),
          entries: forecast,
        };
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn(
          `[ebb-ai/grid] eia fetch failed (${(err as Error).message}); falling back to mock`,
        );
        return mock.fetchForecast(region, hours);
      }
    },
  };
}

/**
 * ENTSO-E Transparency Platform — `web-api.tp.entsoe.eu`.
 *
 * Pros: free (with a security-token registration), covers every European
 * bidding zone, offers an actual day-ahead generation forecast (not just
 * historical). EU-level open data, well-documented.
 * Cons: XML response, which we parse with a small regex-based reader
 * scoped to the shape ENTSO-E returns. The shape is stable enough that
 * a 30-line parser is more honest than adding a 30KB transitive XML dep.
 *
 * Zones supported:
 *   - FR → 10YFR-RTE------C  (France)
 *   - DE → 10Y1001A1001A82H  (Germany–Luxembourg)
 *   - ES → 10YES-REE------0  (Spain — bonus)
 *   - IT → 10YIT-GRTN-----B  (Italy — bonus)
 *   - NL → 10YNL----------L  (Netherlands — bonus)
 *
 * Docs: https://transparency.entsoe.eu/content/static_content/Static%20content/web%20api/Guide.html
 *       Get a free security token via the platform's "My Account → Web API Security Token".
 */
const ENTSOE_BIDDING_ZONE_BY_REGION: Record<string, string> = {
  FR: "10YFR-RTE------C",
  DE: "10Y1001A1001A82H",
  ES: "10YES-REE------0",
  IT: "10YIT-GRTN-----B",
  NL: "10YNL----------L",
};

/** ENTSO-E psrType codes → emission factor. */
const ENTSOE_PSR_FACTORS: Record<string, number> = {
  B01: EMISSION_FACTORS_G_CO2_PER_KWH.biomass,
  B02: EMISSION_FACTORS_G_CO2_PER_KWH.coal_lignite,
  B03: EMISSION_FACTORS_G_CO2_PER_KWH.gas,
  B04: EMISSION_FACTORS_G_CO2_PER_KWH.gas,
  B05: EMISSION_FACTORS_G_CO2_PER_KWH.coal,
  B06: EMISSION_FACTORS_G_CO2_PER_KWH.oil,
  B07: EMISSION_FACTORS_G_CO2_PER_KWH.oil_shale,
  B08: EMISSION_FACTORS_G_CO2_PER_KWH.peat,
  B09: EMISSION_FACTORS_G_CO2_PER_KWH.geothermal,
  B10: EMISSION_FACTORS_G_CO2_PER_KWH.hydro,
  B11: EMISSION_FACTORS_G_CO2_PER_KWH.hydro,
  B12: EMISSION_FACTORS_G_CO2_PER_KWH.hydro,
  B13: EMISSION_FACTORS_G_CO2_PER_KWH.marine,
  B14: EMISSION_FACTORS_G_CO2_PER_KWH.nuclear,
  B15: EMISSION_FACTORS_G_CO2_PER_KWH.biomass,
  B16: EMISSION_FACTORS_G_CO2_PER_KWH.solar,
  B17: EMISSION_FACTORS_G_CO2_PER_KWH.waste,
  B18: EMISSION_FACTORS_G_CO2_PER_KWH.wind_offshore,
  B19: EMISSION_FACTORS_G_CO2_PER_KWH.wind_onshore,
  B20: EMISSION_FACTORS_G_CO2_PER_KWH.other,
};

/**
 * Minimal ENTSO-E XML extractor. Returns, for each TimeSeries block,
 * the psrType plus the period start time and the resolution and the
 * ordered list of Point quantities.
 *
 * Why regex rather than a real parser: ENTSO-E's response shape is
 * stable, the fields we read are well-namespaced, and adding a 30KB
 * XML dep to `@ebb-ai/core` for one adapter is bad cost-benefit.
 */
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
    const points = pointMatches.map((p) => Number(p[1])).filter((n) => Number.isFinite(n));
    if (points.length === 0) continue;
    out.push({ psrType: psr, start, resolutionMin: Number(res), points });
  }
  return out;
}

/**
 * Carbon-intensity feed backed by the ENTSO-E Transparency Platform's
 * realised generation per type (document type A75). Returns up to
 * `hours` hourly entries computed from the per-fuel generation breakdown.
 */
export function entsoeFeed(securityToken?: string): GridFeed {
  const token = securityToken ?? process.env.EBB_ENTSOE_SECURITY_TOKEN;
  const mock = mockGridFeed();
  if (!token) {
    return {
      source: "mock",
      async fetchForecast(region, hours) {
        // eslint-disable-next-line no-console
        console.warn(
          "[ebb-ai/grid] no EBB_ENTSOE_SECURITY_TOKEN set — using mock data for EU zones",
        );
        return mock.fetchForecast(region, hours);
      },
    };
  }
  return {
    source: "entsoe",
    async fetchForecast(region, hours) {
      const zone = ENTSOE_BIDDING_ZONE_BY_REGION[region];
      if (!zone) {
        // eslint-disable-next-line no-console
        console.warn(
          `[ebb-ai/grid] entsoeFeed does not cover zone "${region}" — using mock`,
        );
        return mock.fetchForecast(region, hours);
      }
      try {
        // Realised generation per type (A75) — most recent hour with data.
        // ENTSO-E expects period in YYYYMMDDhhmm UTC.
        const now = new Date();
        const endHour = new Date(now);
        endHour.setMinutes(0, 0, 0);
        endHour.setSeconds(0, 0);
        const startHour = new Date(endHour.getTime() - 24 * 60 * 60 * 1000);
        const fmt = (d: Date) =>
          d.toISOString().replace(/[-:T]/g, "").slice(0, 12);
        const params = new URLSearchParams({
          securityToken: token,
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
        });
        if (!res.ok) {
          throw new Error(`ENTSO-E API returned ${res.status}`);
        }
        const xml = await res.text();
        const series = parseEntsoeXml(xml);
        if (series.length === 0) {
          throw new Error("ENTSO-E returned no TimeSeries blocks");
        }
        // Bucket each TimeSeries' points into UTC hours and accumulate
        // weighted-average numerator/denominator per hour.
        const byHourMs: Record<number, { num: number; den: number }> = {};
        for (const ts of series) {
          const factor = ENTSOE_PSR_FACTORS[ts.psrType];
          if (factor === undefined) continue;
          const seriesStart = new Date(ts.start).getTime();
          for (let i = 0; i < ts.points.length; i++) {
            const v = ts.points[i]!;
            if (!Number.isFinite(v) || v < 0) continue;
            const t = seriesStart + i * ts.resolutionMin * 60_000;
            // Snap to the start of the hour containing t.
            const hr = Math.floor(t / 3_600_000) * 3_600_000;
            // Weight the contribution by how much of an hour this point covers.
            const weight = ts.resolutionMin / 60;
            byHourMs[hr] ??= { num: 0, den: 0 };
            byHourMs[hr]!.num += v * weight * factor;
            byHourMs[hr]!.den += v * weight;
          }
        }
        const sortedHours = Object.keys(byHourMs)
          .map(Number)
          .sort((a, b) => a - b);
        const intensities: GridForecastEntry[] = [];
        for (const hr of sortedHours) {
          const cell = byHourMs[hr]!;
          if (cell.den === 0) continue;
          const g = Math.round(cell.num / cell.den);
          intensities.push({
            datetime: new Date(hr).toISOString(),
            carbonIntensityGCo2PerKwh: g,
            band: classify(g),
          });
        }
        if (intensities.length === 0) {
          throw new Error("ENTSO-E returned no usable hourly buckets");
        }
        // Same naive-forecast strategy as EIA: use the last 24h pattern,
        // shifted forward. ENTSO-E does have a real day-ahead forecast
        // (documentType=A71 processType=A01), worth a v0.8 upgrade.
        const tail = intensities
          .slice(-24)
          .map((e) => e.carbonIntensityGCo2PerKwh);
        if (tail.length === 0) {
          throw new Error("ENTSO-E synthesised forecast empty");
        }
        const startTs = new Date(now);
        startTs.setMinutes(0, 0, 0);
        startTs.setSeconds(0, 0);
        const forecast: GridForecastEntry[] = [];
        for (let i = 0; i < hours; i++) {
          const g = tail[i % tail.length]!;
          const t = new Date(startTs.getTime() + i * 60 * 60 * 1000);
          forecast.push({
            datetime: t.toISOString(),
            carbonIntensityGCo2PerKwh: g,
            band: classify(g),
          });
        }
        return {
          region,
          source: "entsoe",
          generatedAt: new Date().toISOString(),
          entries: forecast,
        };
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn(
          `[ebb-ai/grid] entsoe fetch failed (${(err as Error).message}); falling back to mock`,
        );
        return mock.fetchForecast(region, hours);
      }
    },
  };
}

/**
 * Compose multiple feeds with per-zone routing.
 *
 * @example
 *   const grid = multiSourceGridFeed({
 *     feeds: {
 *       GB: ukCarbonIntensityFeed(),
 *       "US-CAL-CISO": electricityMapsFeed(),
 *     },
 *     fallback: mockGridFeed(),
 *   });
 *
 * Zones not in `feeds` are routed to `fallback` (default: mockGridFeed).
 * Each leaf feed reports its own `source` on the returned forecast — the
 * wrapper is a router, not a source itself.
 */
export function multiSourceGridFeed(options: {
  feeds?: Record<string, GridFeed>;
  fallback?: GridFeed;
}): GridFeed {
  const feeds = options.feeds ?? {};
  const fallback = options.fallback ?? mockGridFeed();
  return {
    // The router has no single source; report "mock" for the (rare) callers
    // that read `feed.source` without inspecting the forecast.
    source: "mock",
    async fetchForecast(region, hours) {
      const feed = feeds[region] ?? fallback;
      return feed.fetchForecast(region, hours);
    },
  };
}

/**
 * Auto-build the best free grid feed for every supported zone.
 *
 * Selection logic (per zone):
 *   - "GB"                              → UK Carbon Intensity (free, no key)
 *   - "US-CAL-CISO" / ERCO / ISNE /
 *     MIDA-PJM / NY-NYIS / MIDW-MISO    → EIA when EBB_EIA_API_KEY is set
 *   - "FR" / "DE" / "ES" / "IT" / "NL"  → ENTSO-E when EBB_ENTSOE_SECURITY_TOKEN is set
 *   - everything else                   → Electricity Maps when EBB_ELECTRICITY_MAPS_API_KEY is set
 *   - any zone without a configured key → deterministic mock curve
 *
 * Each leaf feed already falls back to the mock on its own when its key
 * is missing or the request fails. The returned forecast's `source` field
 * reports the actual origin, so callers can distinguish "live" from "mock"
 * data without inspecting URLs.
 *
 * Use this in production entry points (MCP server, CLI tick daemon, web
 * APIs) so the user gets real numbers wherever a free source exists — even
 * if they've configured zero API keys, GB still resolves to live data.
 */
export function buildDefaultGridFeed(): GridFeed {
  const feeds: Record<string, GridFeed> = {
    GB: ukCarbonIntensityFeed(),
  };
  for (const zone of Object.keys(EIA_RESPONDENT_BY_ZONE)) {
    feeds[zone] = eiaFeed();
  }
  for (const zone of Object.keys(ENTSOE_BIDDING_ZONE_BY_REGION)) {
    feeds[zone] = entsoeFeed();
  }
  return multiSourceGridFeed({
    feeds,
    fallback: electricityMapsFeed(),
  });
}
