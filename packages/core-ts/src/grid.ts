/**
 * Grid carbon-intensity feeds.
 *
 * Built-in sources:
 *   - mockGridFeed: deterministic synthetic curve, zero-config.
 *   - electricityMapsFeed: Electricity Maps free-tier API (key required).
 *   - ukCarbonIntensityFeed: National Grid ESO Carbon Intensity API
 *     (GB only, no auth, real forecast, paginated up to 96h).
 *   - eiaFeed: US EIA fuel-mix data for the major ISO/RTOs (key required;
 *     realised data served as a persistence forecast).
 *   - entsoeFeed: ENTSO-E realised generation for EU bidding zones
 *     (token required; realised data served as a persistence forecast).
 *   - multiSourceGridFeed: routes per zone across the feeds above.
 *   - buildDefaultGridFeed: best free feed per zone, mock fallback.
 *
 * WattTime marginal-emissions support is tracked on the roadmap.
 */

import {
  BAND_THRESHOLDS,
  DEFAULT_BAND,
  DEFAULT_REGION_FLOOR,
  REGION_FLOORS,
  REGION_UTC_OFFSETS,
  SYNTHETIC_AMPLITUDE,
} from "./data/tables.generated.js";
import type { GridFeed, GridForecast, GridForecastEntry } from "./types.js";

function classify(g: number): GridForecastEntry["band"] {
  for (const t of BAND_THRESHOLDS) {
    if (g < t.maxExclusive) return t.band;
  }
  return DEFAULT_BAND;
}

/**
 * Build a synthetic intraday carbon curve.
 *
 * Real grid intensity in the US typically dips overnight (lots of base-load
 * nuclear and hydro, plus wind) and peaks late afternoon (residential AC,
 * gas peaker plants). We mimic that shape with a sinusoid that bottoms at
 * 05:00 local and peaks at 17:00 local.
 */
function syntheticIntensityForHour(date: Date, region: string): number {
  // Region-specific midpoint + per-region UTC offset come from the JSON
  // SSOT (packages/core-ts/src/data/regions.json). The offset shifts each
  // region's local-time trough (≈ 05:00 local) to a distinct UTC hour so
  // multi-region simulations don't pile every "cleanest hour" choice into
  // the same bucket (the even-distribution.test.ts pathology shown
  // pre-v0.8.1: 66.9 % of dispatch in a single hour).
  const floor = REGION_FLOORS[region] ?? DEFAULT_REGION_FLOOR;
  const offsetH = REGION_UTC_OFFSETS[region] ?? 0;
  const amplitude = SYNTHETIC_AMPLITUDE;
  // Local-clock trough at 05:00, peak at 17:00. Phase 0 ⇒ peak.
  const utcHour = date.getUTCHours();
  const localHour = ((utcHour + offsetH) % 24 + 24) % 24;
  const phase = (localHour - 17) * (Math.PI / 12);
  const value = floor + amplitude * Math.cos(phase);
  return Math.max(0, Math.round(value));
}

/**
 * Mock grid feed.
 *
 * `clock` is optional; if supplied, the forecast starts at the clock's
 * current hour (top-of-hour) rather than wall-clock now. Tests that
 * sweep many synthetic "submitted-at" moments through the scheduler
 * pass their own clock so the forecast aligns with the simulated time;
 * production code can omit the parameter and get the natural wall-clock
 * behaviour.
 */
export function mockGridFeed(clock?: () => Date): GridFeed {
  return {
    source: "mock",
    async fetchForecast(region: string, hours: number): Promise<GridForecast> {
      const baseNow = clock ? clock() : new Date();
      const now = new Date(baseNow.getTime());
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
        generatedAt: baseNow.toISOString(),
        // A modeled forward curve, not a projection of realised data.
        kind: "forecast",
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
          kind: "forecast",
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
 * Pros: free, no auth, no rate-limit registration, real forward forecast.
 * Cons: GB only. Other zones fall back to the synthetic mock so this feed
 * is safe to use as the default zone-agnostic feed.
 *
 * Each `/fw48h` page covers 48 hours; when more than 48 hours are
 * requested (the scheduler's MAX_HORIZON is 72h) a second page is fetched
 * at `from + 48h` and the two are merged, extending coverage to 96h.
 *
 * The upstream API returns 30-minute settlement periods; we average each
 * consecutive pair into the hourly buckets ebb-ai uses elsewhere. The
 * API's first settlement period can start *before* the requested
 * top-of-hour (e.g. a request at 12:00 returns a period starting 11:30),
 * so leading periods are dropped until one starts at :00 — that keeps
 * every hourly bucket aligned to [HH:00, HH+1:00). Actual intensity is
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

        interface UkSettlementPeriod {
          from: string;
          to: string;
          intensity: {
            forecast: number | null;
            actual: number | null;
          };
        }
        const fetchPage = async (from: Date): Promise<UkSettlementPeriod[]> => {
          // API wants YYYY-MM-DDTHH:MMZ (no seconds).
          const fromStr = `${from.toISOString().slice(0, 16)}Z`;
          const url = `https://api.carbonintensity.org.uk/intensity/${fromStr}/fw48h`;
          const res = await fetch(url, {
            headers: { Accept: "application/json" },
            signal: AbortSignal.timeout(5_000),
          });
          if (!res.ok) {
            throw new Error(`UK Carbon Intensity API returned ${res.status}`);
          }
          const json = (await res.json()) as { data?: UkSettlementPeriod[] };
          return json.data ?? [];
        };

        // Each page covers 48h. For horizons beyond 48h (MAX_HORIZON is
        // 72h) fetch a second page at from+48h; the two pages can share a
        // boundary period, so merge by `from` timestamp before pairing.
        const pages = [await fetchPage(now)];
        if (hours > 48) {
          pages.push(
            await fetchPage(new Date(now.getTime() + 48 * 60 * 60 * 1000)),
          );
        }
        const byFrom = new Map<number, UkSettlementPeriod>();
        for (const page of pages) {
          for (const p of page) {
            const t = new Date(p.from).getTime();
            if (Number.isFinite(t) && !byFrom.has(t)) byFrom.set(t, p);
          }
        }
        const raw = [...byFrom.entries()]
          .sort(([a], [b]) => a - b)
          .map(([, p]) => p);
        if (raw.length === 0) {
          throw new Error("UK Carbon Intensity API returned empty forecast");
        }
        // The first settlement period can start before the requested
        // top-of-hour (e.g. 11:30 for a 12:00 request). Drop leading
        // half-periods so consecutive-pair averaging yields buckets
        // aligned to [HH:00, HH+1:00).
        const firstAligned = raw.findIndex(
          (p) => new Date(p.from).getUTCMinutes() === 0,
        );
        if (firstAligned < 0) {
          throw new Error(
            "UK Carbon Intensity API returned no top-of-hour-aligned periods",
          );
        }
        const hourly: GridForecastEntry[] = [];
        for (
          let i = firstAligned;
          i + 1 < raw.length && hourly.length < hours;
          i += 2
        ) {
          const a = raw[i];
          const b = raw[i + 1];
          // The loop bound guarantees both are defined, but TS strict
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
          // A genuine forward forecast published by NG ESO.
          kind: "forecast",
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
 * endpoint for grid carbon intensity. We serve a *persistence* forecast
 * (`kind: "persistence"`): each future hour H gets the most recent
 * realized observation whose UTC hour-of-day matches H, keyed by the
 * observation's own timestamp. This keeps the diurnal curve in phase even
 * when EIA publishes with a lag of several hours (naively tiling the last
 * 24 values from wall-clock "now" rotates the whole curve by the lag).
 * It is defensible for "is now or +6h cleaner than +20h?" decisions but
 * should not be treated as a meteorologically-aware forecast.
 *
 * If the realized history covers fewer than 24 distinct hours-of-day we
 * throw rather than tile a short tail (a partial tile would misassign
 * hours); the caller's catch degrades to the mock feed with a warning.
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
        // Index realized intensities by UTC hour-of-day, taken from each
        // observation's own timestamp (EIA "period" is "YYYY-MM-DDTHH",
        // UTC). Ascending iteration means later observations overwrite
        // earlier ones, so each slot holds the most recent value for that
        // hour-of-day.
        const periods = Object.keys(byPeriod).sort();
        const byHourOfDay = new Map<number, number>();
        for (const p of periods) {
          const cell = byPeriod[p]!;
          if (cell.den === 0) continue;
          const hourOfDay = Number(p.slice(11, 13));
          if (!Number.isInteger(hourOfDay) || hourOfDay < 0 || hourOfDay > 23) {
            continue;
          }
          byHourOfDay.set(hourOfDay, Math.round(cell.num / cell.den));
        }
        if (byHourOfDay.size === 0) {
          throw new Error("EIA API returned no usable fuel-mix rows");
        }
        // Design choice: require full diurnal coverage. Tiling a short
        // tail (or serving only some hours) would misassign or hide
        // hours; throwing lets the wrapper degrade to the mock loudly.
        if (byHourOfDay.size < 24) {
          throw new Error(
            `EIA history covers only ${byHourOfDay.size}/24 hours-of-day — refusing to synthesise a persistence forecast`,
          );
        }

        // Persistence forecast: future hour H gets the most recent
        // realized observation whose UTC hour-of-day matches H. This is
        // phase-correct regardless of EIA's publication lag.
        const forecast: GridForecastEntry[] = [];
        const startTs = new Date(now);
        startTs.setMinutes(0, 0, 0);
        startTs.setSeconds(0, 0);
        for (let i = 0; i < hours; i++) {
          const t = new Date(startTs.getTime() + i * 60 * 60 * 1000);
          const g = byHourOfDay.get(t.getUTCHours())!;
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
          // Realized data projected forward — not a real forecast.
          kind: "persistence",
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

/** One `<Period>` inside an ENTSO-E TimeSeries. */
export interface EntsoePeriod {
  /** ISO-8601 start of the period's time interval. */
  start: string;
  resolutionMin: number;
  /** Points keyed by their `<position>` (1-based within the period). */
  points: Array<{ position: number; quantity: number }>;
}

/** One generation `<TimeSeries>` from an ENTSO-E A75 document. */
export interface EntsoeTimeSeries {
  psrType: string;
  periods: EntsoePeriod[];
}

/**
 * Minimal ENTSO-E XML extractor. Returns, for each *generation*
 * TimeSeries block, the psrType plus every `<Period>` (each with its own
 * start/resolution) and each Point's `<position>` and `<quantity>`.
 *
 * Semantics handled here:
 *   - `<Acknowledgement_MarketDocument>` (ENTSO-E's error envelope, e.g.
 *     "no data") throws — an empty result must not masquerade as data.
 *   - TimeSeries carrying `outBiddingZone_Domain.mRID` are CONSUMPTION
 *     series (e.g. pumped-storage pumping in DE/FR/ES/IT) and are
 *     skipped; only generation series (inBiddingZone) are returned.
 *   - Multi-`<Period>` TimeSeries are parsed per-Period, since each
 *     Period has its own start and resolution.
 *   - `<position>` is captured so curveType A03 gaps do not shift
 *     subsequent points; callers must compute each point's timestamp as
 *     periodStart + (position − 1) × resolution.
 *
 * Why regex rather than a real parser: ENTSO-E's response shape is
 * stable, the fields we read are well-namespaced, and adding a 30KB
 * XML dep to `@ebb-ai/core` for one adapter is bad cost-benefit.
 * Exported for parse-level fixture tests.
 */
export function parseEntsoeXml(xml: string): EntsoeTimeSeries[] {
  if (/<Acknowledgement_MarketDocument[\s>]/.test(xml)) {
    const reason =
      xml.match(/<text>([\s\S]*?)<\/text>/)?.[1]?.trim() ??
      "no reason text in document";
    throw new Error(`ENTSO-E returned an Acknowledgement document: ${reason}`);
  }
  const out: EntsoeTimeSeries[] = [];
  const tsRe = /<TimeSeries>([\s\S]*?)<\/TimeSeries>/g;
  for (const m of xml.matchAll(tsRe)) {
    const block = m[1] ?? "";
    // outBiddingZone_Domain.mRID marks a consumption series (energy
    // taken OFF the grid, e.g. pumped-storage pumping). Counting it as
    // generation would systematically drag intensity down.
    if (/<outBiddingZone_Domain\.mRID[\s>]/.test(block)) continue;
    const psr = block.match(/<psrType>([A-Z0-9]+)<\/psrType>/)?.[1];
    if (!psr) continue;
    const periods: EntsoePeriod[] = [];
    for (const pm of block.matchAll(/<Period>([\s\S]*?)<\/Period>/g)) {
      const pBlock = pm[1] ?? "";
      const start = pBlock.match(/<start>([0-9TZ:+-]+)<\/start>/)?.[1];
      const res = pBlock.match(/<resolution>PT(\d+)M<\/resolution>/)?.[1];
      if (!start || !res) continue;
      const points: EntsoePeriod["points"] = [];
      for (const p of pBlock.matchAll(
        /<Point>\s*<position>(\d+)<\/position>\s*<quantity>([\d.]+)<\/quantity>\s*<\/Point>/g,
      )) {
        const position = Number(p[1]);
        const quantity = Number(p[2]);
        if (!Number.isFinite(position) || !Number.isFinite(quantity)) continue;
        points.push({ position, quantity });
      }
      if (points.length === 0) continue;
      periods.push({ start, resolutionMin: Number(res), points });
    }
    if (periods.length === 0) continue;
    out.push({ psrType: psr, periods });
  }
  return out;
}

/**
 * Carbon-intensity feed backed by the ENTSO-E Transparency Platform's
 * realised generation per type (document type A75). Returns up to
 * `hours` hourly entries computed from the per-fuel generation breakdown,
 * served as a persistence forecast (`kind: "persistence"`) anchored by
 * UTC hour-of-day — see the EIA feed for the phase-correctness rationale.
 *
 * Note: ENTSO-E's real day-ahead forecast (documentType A71, processType
 * A01) lacks the per-fuel generation mix we need to compute carbon
 * intensity, which is why realised A75 data + persistence is used instead.
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
        // Bucket every generation point into UTC hours and accumulate
        // weighted-average numerator/denominator per hour. Each point's
        // timestamp comes from its Period start + (position − 1) ×
        // resolution, so curveType A03 gaps leave a hole instead of
        // shifting subsequent points.
        const byHourMs: Record<number, { num: number; den: number }> = {};
        for (const ts of series) {
          const factor = ENTSOE_PSR_FACTORS[ts.psrType];
          if (factor === undefined) continue;
          for (const period of ts.periods) {
            const periodStart = new Date(period.start).getTime();
            if (!Number.isFinite(periodStart)) continue;
            for (const point of period.points) {
              const v = point.quantity;
              if (!Number.isFinite(v) || v < 0) continue;
              const t =
                periodStart + (point.position - 1) * period.resolutionMin * 60_000;
              // Snap to the start of the hour containing t.
              const hr = Math.floor(t / 3_600_000) * 3_600_000;
              // Weight the contribution by how much of an hour this point covers.
              const weight = period.resolutionMin / 60;
              byHourMs[hr] ??= { num: 0, den: 0 };
              byHourMs[hr]!.num += v * weight * factor;
              byHourMs[hr]!.den += v * weight;
            }
          }
        }
        // Index realized hourly intensities by UTC hour-of-day (from the
        // buckets' own timestamps). Ascending iteration means the most
        // recent observation wins each hour-of-day slot.
        const sortedHours = Object.keys(byHourMs)
          .map(Number)
          .sort((a, b) => a - b);
        const byHourOfDay = new Map<number, number>();
        for (const hr of sortedHours) {
          const cell = byHourMs[hr]!;
          if (cell.den === 0) continue;
          byHourOfDay.set(
            new Date(hr).getUTCHours(),
            Math.round(cell.num / cell.den),
          );
        }
        if (byHourOfDay.size === 0) {
          throw new Error("ENTSO-E returned no usable hourly buckets");
        }
        // Same design choice as the EIA feed: require full diurnal
        // coverage rather than tiling a short tail; the catch below
        // degrades to the mock with a warning.
        if (byHourOfDay.size < 24) {
          throw new Error(
            `ENTSO-E history covers only ${byHourOfDay.size}/24 hours-of-day — refusing to synthesise a persistence forecast`,
          );
        }
        // Persistence forecast: future hour H gets the most recent
        // realized observation whose UTC hour-of-day matches H —
        // phase-correct regardless of publication lag.
        const startTs = new Date(now);
        startTs.setMinutes(0, 0, 0);
        startTs.setSeconds(0, 0);
        const forecast: GridForecastEntry[] = [];
        for (let i = 0; i < hours; i++) {
          const t = new Date(startTs.getTime() + i * 60 * 60 * 1000);
          const g = byHourOfDay.get(t.getUTCHours())!;
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
          // Realised A75 data projected forward — not a real forecast.
          kind: "persistence",
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
