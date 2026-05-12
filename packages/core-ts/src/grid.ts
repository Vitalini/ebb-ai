/**
 * Grid carbon-intensity feeds.
 *
 * v0.1 ships two sources:
 *   - mockGridFeed: deterministic synthetic data with a realistic intraday
 *     curve, for development and tests without an API key.
 *   - electricityMapsFeed: hits the Electricity Maps free-tier API.
 *
 * WattTime support is planned for v0.2 (marginal emissions are the better
 * climate signal for time-shifting).
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
