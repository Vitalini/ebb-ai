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
  const floor = regionFloor[region] ?? 380;
  const amplitude = 220;
  // We use UTC hours so the synthesized curve is deterministic across CI /
  // developer machines and matches the UTC ISO timestamps we emit. Peak ~17:00
  // UTC; trough ~03:00 UTC. (Real provider data is region-local in practice,
  // but for a synthetic feed any deterministic phase is acceptable.)
  const hour = date.getUTCHours();
  const phase = (hour - 17) * (Math.PI / 12);
  const value = floor + amplitude * Math.cos(phase);
  return Math.round(value);
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
  feeds: Record<string, GridFeed>;
  fallback?: GridFeed;
}): GridFeed {
  const fallback = options.fallback ?? mockGridFeed();
  return {
    // The router has no single source; report "mock" for the (rare) callers
    // that read `feed.source` without inspecting the forecast.
    source: "mock",
    async fetchForecast(region, hours) {
      const feed = options.feeds[region] ?? fallback;
      return feed.fetchForecast(region, hours);
    },
  };
}
