/**
 * Fixture-level regression tests for the grid feeds (audit §0.4 / P25).
 *
 * Fixtures under test/fixtures/ are realistic recorded-response shapes:
 *   - entsoe-a75-de.xml          ENTSO-E realised generation (A75) with a
 *                                consumption TimeSeries (outBiddingZone),
 *                                a multi-Period TimeSeries, and a
 *                                Point-position gap (curveType A03).
 *   - entsoe-acknowledgement.xml ENTSO-E "no data" error envelope.
 *   - eia-fuel-mix-lagged.json   EIA hourly fuel mix whose last observation
 *                                is 4h behind the test's faked "now" —
 *                                the phase-rotation regression fixture.
 *   - uk-fw48h-page1/2.json      Two UK Carbon Intensity /fw48h pages with
 *                                a misaligned leading half-period and an
 *                                overlapping boundary period.
 */
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  eiaFeed,
  entsoeFeed,
  parseEntsoeXml,
  ukCarbonIntensityFeed,
} from "../src/grid.js";

const fixture = (name: string): string =>
  readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.useRealTimers();
  vi.restoreAllMocks();
});

/** Fake only Date so `new Date()` is deterministic without stalling fetch/promises. */
function fakeNow(iso: string): void {
  vi.useFakeTimers({ now: new Date(iso), toFake: ["Date"] });
}

// ---------------------------------------------------------------------------
// ENTSO-E A75 XML
// ---------------------------------------------------------------------------

describe("parseEntsoeXml (A75 fixture)", () => {
  it("skips consumption TimeSeries and keeps only generation series", () => {
    const series = parseEntsoeXml(fixture("entsoe-a75-de.xml"));
    // Fixture has 3 TimeSeries; the B11 pumped-storage-pumping one is
    // marked with outBiddingZone_Domain.mRID and must be excluded.
    expect(series.map((s) => s.psrType)).toEqual(["B14", "B05"]);
  });

  it("parses multi-Period TimeSeries per Period", () => {
    const series = parseEntsoeXml(fixture("entsoe-a75-de.xml"));
    const nuclear = series.find((s) => s.psrType === "B14")!;
    expect(nuclear.periods.length).toBe(2);
    expect(nuclear.periods[0]?.start).toBe("2026-05-13T10:00Z");
    expect(nuclear.periods[1]?.start).toBe("2026-05-13T22:00Z");
    expect(nuclear.periods[0]?.points.length).toBe(12);
    expect(nuclear.periods[1]?.points.length).toBe(12);
  });

  it("captures Point positions so gaps stay holes (curveType A03)", () => {
    const series = parseEntsoeXml(fixture("entsoe-a75-de.xml"));
    const coal = series.find((s) => s.psrType === "B05")!;
    const positions = coal.periods[0]!.points.map((p) => p.position);
    expect(positions).not.toContain(3);
    expect(positions).toContain(4);
    expect(positions.length).toBe(23);
  });

  it("throws on an Acknowledgement_MarketDocument instead of returning empty", () => {
    expect(() => parseEntsoeXml(fixture("entsoe-acknowledgement.xml"))).toThrow(
      /Acknowledgement.*No matching data found/,
    );
  });
});

describe("entsoeFeed (A75 fixture)", () => {
  // Fixture mix per hour: nuclear 1000 MW (12 g) + coal 1000 MW (820 g)
  // → (12 + 820) / 2 = 416 g — EXCEPT the coal gap hour (position 3 →
  // period start 10:00Z + 2h = 12:00Z), which is nuclear-only → 12 g.
  // The consumption series (8000 MW hydro-factored) would drag every
  // hour to ~102 g if it were wrongly counted as generation.
  const expected = (hourOfDay: number): number => (hourOfDay === 12 ? 12 : 416);

  it("excludes consumption and keeps the position gap from shifting later hours", async () => {
    globalThis.fetch = (async () =>
      new Response(fixture("entsoe-a75-de.xml"), {
        status: 200,
      })) as typeof fetch;

    const fc = await entsoeFeed("test-token").fetchForecast("DE", 24);
    expect(fc.source).toBe("entsoe");
    expect(fc.kind).toBe("persistence");
    expect(fc.entries.length).toBe(24);
    for (const e of fc.entries) {
      const hod = new Date(e.datetime).getUTCHours();
      expect(
        e.carbonIntensityGCo2PerKwh,
        `hour-of-day ${hod} (${e.datetime})`,
      ).toBe(expected(hod));
    }
    // Regression pin for the index-based bucketing bug: ignoring
    // <position> shifted every post-gap coal hour one hour earlier,
    // yielding 416 at hod 12 and 12 (nuclear-only) at hod 9.
    const at = (hod: number) =>
      fc.entries.find((e) => new Date(e.datetime).getUTCHours() === hod)!;
    expect(at(12).carbonIntensityGCo2PerKwh).toBe(12);
    expect(at(9).carbonIntensityGCo2PerKwh).toBe(416);
  });

  it("falls back to mock (via throw) on an Acknowledgement document", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    globalThis.fetch = (async () =>
      new Response(fixture("entsoe-acknowledgement.xml"), {
        status: 200,
      })) as typeof fetch;

    const fc = await entsoeFeed("test-token").fetchForecast("DE", 6);
    expect(fc.source).toBe("mock");
    expect(fc.entries.length).toBe(6);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("Acknowledgement"),
    );
  });
});

// ---------------------------------------------------------------------------
// EIA fuel mix — publication-lag phase regression
// ---------------------------------------------------------------------------

describe("eiaFeed (lagged fuel-mix fixture)", () => {
  // Fixture: 24 hourly observations 2026-05-13T22 .. 2026-05-14T21 UTC,
  // with COL = hod MW and NUC = (24 - hod) MW, so each observation's
  // intensity uniquely encodes its hour-of-day:
  const expected = (hourOfDay: number): number =>
    Math.round((hourOfDay * 820 + (24 - hourOfDay) * 12) / 24);

  it("serves future hours by hour-of-day despite a 4h publication lag", async () => {
    // "Now" is 4h after the last observation (2026-05-14T21).
    fakeNow("2026-05-15T01:20:00Z");
    globalThis.fetch = (async () =>
      new Response(fixture("eia-fuel-mix-lagged.json"), {
        status: 200,
      })) as typeof fetch;

    const fc = await eiaFeed("test-key").fetchForecast("US-CAL-CISO", 72);
    expect(fc.source).toBe("eia");
    expect(fc.kind).toBe("persistence");
    expect(fc.entries.length).toBe(72);
    expect(fc.entries[0]?.datetime).toBe("2026-05-15T01:00:00.000Z");
    for (const e of fc.entries) {
      const hod = new Date(e.datetime).getUTCHours();
      expect(
        e.carbonIntensityGCo2PerKwh,
        `hour-of-day ${hod} (${e.datetime})`,
      ).toBe(expected(hod));
    }
    // Phase pin: the old tiling anchored the last-24 tail at wall-clock
    // "now", so the 01:00 slot got the 4h-stale 22:00 observation (753)
    // instead of the real 01:00 observation (46).
    expect(fc.entries[0]?.carbonIntensityGCo2PerKwh).toBe(expected(1)); // 46
    expect(fc.entries[0]?.carbonIntensityGCo2PerKwh).not.toBe(expected(22)); // 753
  });

  it("degrades to mock when history covers fewer than 24 hours-of-day", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const full = JSON.parse(fixture("eia-fuel-mix-lagged.json")) as {
      response: { data: unknown[] };
    };
    // Keep only the first 10 hours (2 rows per hour) — a short tail must
    // not be tiled onto a 24h diurnal cycle.
    full.response.data = full.response.data.slice(0, 20);
    globalThis.fetch = (async () =>
      new Response(JSON.stringify(full), { status: 200 })) as typeof fetch;

    const fc = await eiaFeed("test-key").fetchForecast("US-CAL-CISO", 24);
    expect(fc.source).toBe("mock");
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("hours-of-day"),
    );
  });
});

// ---------------------------------------------------------------------------
// UK Carbon Intensity — 72h pagination + top-of-hour alignment
// ---------------------------------------------------------------------------

describe("ukCarbonIntensityFeed (two-page fw48h fixtures)", () => {
  // Half-hour value at index j (from 2026-05-14T12:00Z) is 10*j, so the
  // hourly bucket i must average to 20*i + 5. Page 1 leads with a
  // misaligned 11:30 period valued 9999; page 2 starts one period early,
  // overlapping page 1's last period.
  function stubPages(): ReturnType<typeof vi.fn> {
    const stub = vi.fn(async (input: unknown) => {
      const url = String(input);
      if (url.includes("/intensity/2026-05-14T12:00Z/fw48h")) {
        return new Response(fixture("uk-fw48h-page1.json"), { status: 200 });
      }
      if (url.includes("/intensity/2026-05-16T12:00Z/fw48h")) {
        return new Response(fixture("uk-fw48h-page2.json"), { status: 200 });
      }
      throw new Error(`unexpected URL: ${url}`);
    });
    globalThis.fetch = stub as unknown as typeof fetch;
    return stub;
  }

  it("fetches a second page for horizons beyond 48h and returns 72 aligned buckets", async () => {
    fakeNow("2026-05-14T12:05:00Z");
    const stub = stubPages();

    const fc = await ukCarbonIntensityFeed().fetchForecast("GB", 72);
    expect(stub).toHaveBeenCalledTimes(2);
    expect(String(stub.mock.calls[1]?.[0])).toContain(
      "/intensity/2026-05-16T12:00Z/fw48h",
    );

    expect(fc.source).toBe("ukCarbonIntensity");
    expect(fc.kind).toBe("forecast");
    expect(fc.entries.length).toBe(72);
    for (let i = 0; i < fc.entries.length; i++) {
      const e = fc.entries[i]!;
      const t = new Date(e.datetime);
      // Buckets must be aligned to [HH:00, HH+1:00) and hourly-contiguous.
      expect(t.getUTCMinutes(), e.datetime).toBe(0);
      expect(e.datetime).toBe(
        new Date(Date.UTC(2026, 4, 14, 12 + i)).toISOString(),
      );
      expect(e.carbonIntensityGCo2PerKwh, e.datetime).toBe(20 * i + 5);
    }
    expect(fc.entries[71]?.datetime).toBe("2026-05-17T11:00:00.000Z");
    expect(fc.entries[71]?.carbonIntensityGCo2PerKwh).toBe(1425);
  });

  it("drops the misaligned leading half-period instead of skewing bucket 0", async () => {
    fakeNow("2026-05-14T12:05:00Z");
    stubPages();

    const fc = await ukCarbonIntensityFeed().fetchForecast("GB", 72);
    // If the 11:30 period (9999) were paired in, bucket 0 would be
    // avg(9999, 0) ≈ 5000 at 11:30 instead of avg(0, 10) = 5 at 12:00.
    expect(fc.entries[0]?.datetime).toBe("2026-05-14T12:00:00.000Z");
    expect(fc.entries[0]?.carbonIntensityGCo2PerKwh).toBe(5);
  });

  it("stays on a single page for horizons within 48h", async () => {
    fakeNow("2026-05-14T12:05:00Z");
    const stub = stubPages();

    const fc = await ukCarbonIntensityFeed().fetchForecast("GB", 48);
    expect(stub).toHaveBeenCalledTimes(1);
    expect(fc.entries.length).toBe(48);
    expect(fc.entries[0]?.carbonIntensityGCo2PerKwh).toBe(5);
  });
});
