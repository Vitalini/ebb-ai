import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  mockGridFeed,
  multiSourceGridFeed,
  ukCarbonIntensityFeed,
} from "../src/grid.js";

type FetchInput = Parameters<typeof fetch>[0];

const originalFetch = globalThis.fetch;

beforeEach(() => {
  // No-op default; individual tests replace with a stub.
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

/** Build a UK API response covering N hourly buckets (each = 2x 30-min entries). */
function ukResponse(intensities: number[]) {
  const now = new Date();
  now.setMinutes(0, 0, 0);
  const data: Array<{
    from: string;
    to: string;
    intensity: { forecast: number | null; actual: number | null };
  }> = [];
  intensities.forEach((g, i) => {
    const start = new Date(now.getTime() + i * 30 * 60 * 1000);
    const end = new Date(start.getTime() + 30 * 60 * 1000);
    data.push({
      from: start.toISOString(),
      to: end.toISOString(),
      intensity: { forecast: g, actual: null },
    });
  });
  return { data };
}

describe("ukCarbonIntensityFeed", () => {
  it("rolls 30-min intervals up to hourly buckets by averaging", async () => {
    // 4 30-min entries → 2 hourly. Averages: (100+200)/2=150, (300+400)/2=350.
    const stub = vi.fn(async (_input: FetchInput) =>
      new Response(JSON.stringify(ukResponse([100, 200, 300, 400])), {
        status: 200,
      }),
    );
    globalThis.fetch = stub as unknown as typeof fetch;

    const feed = ukCarbonIntensityFeed();
    const fc = await feed.fetchForecast("GB", 24);

    expect(fc.source).toBe("ukCarbonIntensity");
    expect(fc.region).toBe("GB");
    expect(fc.entries.length).toBe(2);
    expect(fc.entries[0]?.carbonIntensityGCo2PerKwh).toBe(150);
    expect(fc.entries[1]?.carbonIntensityGCo2PerKwh).toBe(350);
    expect(fc.entries[0]?.band).toBe("clean"); // 150 → 100..250 = clean
    expect(fc.entries[1]?.band).toBe("average"); // 350 → 250..450 = average
    expect(stub).toHaveBeenCalledOnce();
  });

  it("prefers `actual` over `forecast` when both populated", async () => {
    const stub = vi.fn(async () =>
      new Response(
        JSON.stringify({
          data: [
            {
              from: "2026-05-14T12:00Z",
              to: "2026-05-14T12:30Z",
              // Forecast=999 but actual=100. Should use actual.
              intensity: { forecast: 999, actual: 100 },
            },
            {
              from: "2026-05-14T12:30Z",
              to: "2026-05-14T13:00Z",
              intensity: { forecast: 999, actual: 200 },
            },
          ],
        }),
        { status: 200 },
      ),
    );
    globalThis.fetch = stub as unknown as typeof fetch;

    const fc = await ukCarbonIntensityFeed().fetchForecast("GB", 24);
    expect(fc.entries[0]?.carbonIntensityGCo2PerKwh).toBe(150);
  });

  it("respects the `hours` argument as a cap on rolled-up buckets", async () => {
    // 8 entries → 4 hourly buckets, but we request only 2.
    const stub = vi.fn(async () =>
      new Response(
        JSON.stringify(ukResponse([10, 20, 30, 40, 50, 60, 70, 80])),
        { status: 200 },
      ),
    );
    globalThis.fetch = stub as unknown as typeof fetch;

    const fc = await ukCarbonIntensityFeed().fetchForecast("GB", 2);
    expect(fc.entries.length).toBe(2);
  });

  it("falls back to mock for non-GB zones", async () => {
    const stub = vi.fn();
    globalThis.fetch = stub as unknown as typeof fetch;

    const fc = await ukCarbonIntensityFeed().fetchForecast("US-CAL-CISO", 6);
    expect(fc.source).toBe("mock");
    expect(fc.region).toBe("US-CAL-CISO");
    expect(fc.entries.length).toBe(6);
    // Should not have hit the network at all.
    expect(stub).not.toHaveBeenCalled();
  });

  it("falls back to mock when the API returns non-OK", async () => {
    globalThis.fetch = (async () =>
      new Response("Service Unavailable", { status: 503 })) as typeof fetch;

    const fc = await ukCarbonIntensityFeed().fetchForecast("GB", 4);
    expect(fc.source).toBe("mock");
    expect(fc.entries.length).toBe(4);
  });

  it("falls back to mock when the API returns an empty data array", async () => {
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ data: [] }), {
        status: 200,
      })) as typeof fetch;

    const fc = await ukCarbonIntensityFeed().fetchForecast("GB", 4);
    expect(fc.source).toBe("mock");
  });

  it("falls back to mock when the network throws", async () => {
    globalThis.fetch = (async () => {
      throw new Error("ECONNREFUSED");
    }) as typeof fetch;

    const fc = await ukCarbonIntensityFeed().fetchForecast("GB", 4);
    expect(fc.source).toBe("mock");
  });
});

describe("multiSourceGridFeed", () => {
  it("routes per zone to the matching feed", async () => {
    const ukStub = vi.fn(async () => ({
      region: "GB",
      source: "ukCarbonIntensity" as const,
      generatedAt: new Date().toISOString(),
      entries: [],
    }));
    const emStub = vi.fn(async () => ({
      region: "US-CAL-CISO",
      source: "electricityMaps" as const,
      generatedAt: new Date().toISOString(),
      entries: [],
    }));

    const feed = multiSourceGridFeed({
      feeds: {
        GB: { source: "ukCarbonIntensity", fetchForecast: ukStub },
        "US-CAL-CISO": { source: "electricityMaps", fetchForecast: emStub },
      },
    });

    await feed.fetchForecast("GB", 12);
    expect(ukStub).toHaveBeenCalledOnce();
    expect(emStub).not.toHaveBeenCalled();

    await feed.fetchForecast("US-CAL-CISO", 12);
    expect(emStub).toHaveBeenCalledOnce();
  });

  it("uses the fallback feed for unmapped zones", async () => {
    const fallbackStub = vi.fn(async () => ({
      region: "FR",
      source: "mock" as const,
      generatedAt: new Date().toISOString(),
      entries: [],
    }));

    const feed = multiSourceGridFeed({
      feeds: { GB: { source: "mock", fetchForecast: vi.fn() } },
      fallback: { source: "mock", fetchForecast: fallbackStub },
    });

    await feed.fetchForecast("FR", 12);
    expect(fallbackStub).toHaveBeenCalledOnce();
  });

  it("defaults to mockGridFeed when no fallback is supplied", async () => {
    const feed = multiSourceGridFeed({ feeds: {} });
    const fc = await feed.fetchForecast("DE", 6);
    expect(fc.source).toBe("mock");
    expect(fc.entries.length).toBe(6);
  });
});

describe("mockGridFeed (unchanged baseline)", () => {
  it("returns deterministic entries given UTC-aligned hour", async () => {
    const a = await mockGridFeed().fetchForecast("US-CAL-CISO", 3);
    const b = await mockGridFeed().fetchForecast("US-CAL-CISO", 3);
    expect(a.entries.length).toBe(3);
    expect(a.entries[0]?.carbonIntensityGCo2PerKwh).toBe(
      b.entries[0]?.carbonIntensityGCo2PerKwh,
    );
  });
});
