/**
 * recommendWindow — planning endpoint tests.
 *
 * Mirrors the spec in packages/core-ts/src/recommend.ts:
 *   - happy path (chosen window + alternatives + savings number + reasoning)
 *   - budget filter (drops dirty entries, throws when nothing survives)
 *   - batch_eligible flag (true iff deadline > 24h out)
 *   - alternatives ordering (ascending by intensity, excludes chosen)
 *   - error propagation (InvalidDeadlineError, CarbonBudgetExceededError)
 *
 * The tests inject a synthetic GridFeed instead of using mockGridFeed so the
 * scoring math is exercised on values the test author chose, not on a
 * timezone-dependent sinusoid.
 */

import { describe, expect, it } from "vitest";
import {
  CarbonBudgetExceededError,
  InvalidDeadlineError,
  mockGridFeed,
  recommendWindow,
} from "../src/index.js";
import type { GridFeed, GridForecast, GridForecastEntry } from "../src/index.js";

function band(g: number): GridForecastEntry["band"] {
  if (g < 100) return "very_clean";
  if (g < 250) return "clean";
  if (g < 450) return "average";
  if (g < 700) return "dirty";
  return "very_dirty";
}

/**
 * Build a deterministic feed from a list of [hoursFromNow, intensity] pairs.
 * Anchored to a stable "now" so timing in the test does not drift across runs.
 */
function staticFeed(
  now: Date,
  intensities: Array<[hours: number, intensity: number]>,
): GridFeed {
  const entries: GridForecastEntry[] = intensities.map(([h, g]) => ({
    datetime: new Date(now.getTime() + h * 60 * 60 * 1000).toISOString(),
    carbonIntensityGCo2PerKwh: g,
    band: band(g),
  }));
  return {
    source: "mock",
    async fetchForecast(region: string): Promise<GridForecast> {
      return {
        region,
        source: "mock",
        generatedAt: now.toISOString(),
        entries,
      };
    },
  };
}

describe("recommendWindow — happy path", () => {
  it("picks the cheapest in-deadline window and reports it", async () => {
    const now = new Date("2026-05-12T10:00:00Z");
    const feed = staticFeed(now, [
      [0, 500], // now — dirty
      [1, 400],
      [2, 300],
      [3, 100], // cleanest — should be chosen
      [4, 200],
      [5, 250],
    ]);
    const deadline = new Date(now.getTime() + 6 * 60 * 60 * 1000);
    const result = await recommendWindow(
      { deadline, region: "US-CAL-CISO" },
      { feed, now: () => now },
    );

    expect(result.intensityGCo2PerKwh).toBe(100);
    expect(result.band).toBe("clean");
    expect(result.scheduledFor).toBe(
      new Date(now.getTime() + 3 * 60 * 60 * 1000).toISOString(),
    );
    // 0.0015 kWh * 100 gCO2/kWh = 0.15g, rounded to 0.2 (round-half-up)
    expect(result.estimatedCarbonGCo2).toBeCloseTo(0.2, 1);
  });

  it("computes savings vs entry[0] as integer %", async () => {
    const now = new Date("2026-05-12T10:00:00Z");
    const feed = staticFeed(now, [
      [0, 500], // current intensity
      [1, 100], // 80% cleaner
      [2, 250],
    ]);
    const deadline = new Date(now.getTime() + 3 * 60 * 60 * 1000);
    const r = await recommendWindow(
      { deadline, region: "US-CAL-CISO" },
      { feed, now: () => now },
    );
    expect(r.estimatedSavingsVsNowPct).toBe(80);
  });

  it("includes the '% cleaner than dispatching now' phrase when savings > 30%", async () => {
    const now = new Date("2026-05-12T10:00:00Z");
    const feed = staticFeed(now, [
      [0, 500],
      [2, 200], // 60% cleaner
    ]);
    const deadline = new Date(now.getTime() + 3 * 60 * 60 * 1000);
    const r = await recommendWindow(
      { deadline, region: "US-CAL-CISO" },
      { feed, now: () => now },
    );
    expect(r.reasoning).toMatch(/cleaner than dispatching now/);
  });

  it("falls back to a generic reasoning when savings <= 30%", async () => {
    const now = new Date("2026-05-12T10:00:00Z");
    const feed = staticFeed(now, [
      [0, 300],
      [1, 290], // ~3% cleaner only
    ]);
    const deadline = new Date(now.getTime() + 2 * 60 * 60 * 1000);
    const r = await recommendWindow(
      { deadline, region: "US-CAL-CISO" },
      { feed, now: () => now },
    );
    expect(r.reasoning).not.toMatch(/cleaner than dispatching now/);
    expect(r.reasoning).toMatch(/cleanest in-deadline window/);
  });
});

describe("recommendWindow — alternatives", () => {
  it("returns the next 3 cheapest entries, excluding the chosen one", async () => {
    const now = new Date("2026-05-12T10:00:00Z");
    const feed = staticFeed(now, [
      [0, 600],
      [1, 100], // chosen
      [2, 500],
      [3, 200], // alt #1
      [4, 400],
      [5, 300], // alt #3
      [6, 350], // alt #2
    ]);
    const deadline = new Date(now.getTime() + 7 * 60 * 60 * 1000);
    const r = await recommendWindow(
      { deadline, region: "US-CAL-CISO" },
      { feed, now: () => now },
    );
    expect(r.intensityGCo2PerKwh).toBe(100);
    expect(r.alternatives).toHaveLength(3);
    // Ascending order.
    expect(r.alternatives.map((a) => a.intensityGCo2PerKwh)).toEqual([200, 300, 350]);
    // Each alt carries a savings number.
    for (const alt of r.alternatives) {
      expect(alt.estimatedSavingsVsNowPct).toBeGreaterThanOrEqual(0);
      expect(alt.estimatedCarbonGCo2).toBeGreaterThan(0);
    }
  });

  it("returns fewer alternatives if there aren't 4 in-deadline entries", async () => {
    const now = new Date("2026-05-12T10:00:00Z");
    const feed = staticFeed(now, [
      [0, 500],
      [1, 100],
    ]);
    const deadline = new Date(now.getTime() + 2 * 60 * 60 * 1000);
    const r = await recommendWindow(
      { deadline, region: "US-CAL-CISO" },
      { feed, now: () => now },
    );
    expect(r.alternatives).toHaveLength(1);
  });
});

describe("recommendWindow — carbon budget filter", () => {
  it("drops entries above the budget and picks the cheapest survivor", async () => {
    const now = new Date("2026-05-12T10:00:00Z");
    // 0.0015 kWh * intensity = grams. Budget 0.25g → only entries with
    // intensity ≤ 166.67 survive.
    const feed = staticFeed(now, [
      [0, 500],
      [1, 200], // 0.3g — over budget
      [2, 150], // 0.225g — survives
      [3, 100], // 0.15g — survives, chosen
    ]);
    const deadline = new Date(now.getTime() + 4 * 60 * 60 * 1000);
    const r = await recommendWindow(
      { deadline, region: "US-CAL-CISO", carbonBudgetG: 0.25 },
      { feed, now: () => now },
    );
    expect(r.intensityGCo2PerKwh).toBe(100);
    // Only 2 entries survived → at most 1 alternative.
    expect(r.alternatives).toHaveLength(1);
    expect(r.alternatives[0]!.intensityGCo2PerKwh).toBe(150);
  });

  it("mentions the budget when only one window survives", async () => {
    const now = new Date("2026-05-12T10:00:00Z");
    const feed = staticFeed(now, [
      [0, 500],
      [1, 400],
      [2, 100], // only survivor under 0.2g budget
      [3, 350],
    ]);
    const deadline = new Date(now.getTime() + 4 * 60 * 60 * 1000);
    const r = await recommendWindow(
      { deadline, region: "US-CAL-CISO", carbonBudgetG: 0.2 },
      { feed, now: () => now },
    );
    expect(r.reasoning).toMatch(/only one window meets the carbon budget/);
  });

  it("throws CarbonBudgetExceededError when nothing survives", async () => {
    const now = new Date("2026-05-12T10:00:00Z");
    const feed = staticFeed(now, [
      [0, 500],
      [1, 600],
      [2, 700],
    ]);
    const deadline = new Date(now.getTime() + 3 * 60 * 60 * 1000);
    await expect(
      recommendWindow(
        { deadline, region: "US-CAL-CISO", carbonBudgetG: 0.1 },
        { feed, now: () => now },
      ),
    ).rejects.toThrow(CarbonBudgetExceededError);
  });
});

describe("recommendWindow — batch_eligible flag", () => {
  it("is true when deadline > 24h out", async () => {
    const now = new Date("2026-05-12T10:00:00Z");
    const feed = staticFeed(now, [
      [0, 500],
      [10, 200],
      [25, 100],
    ]);
    const deadline = new Date(now.getTime() + 30 * 60 * 60 * 1000);
    const r = await recommendWindow(
      { deadline, region: "US-CAL-CISO" },
      { feed, now: () => now },
    );
    expect(r.batchEligible).toBe(true);
    expect(r.reasoning).toMatch(/Batch API saves an additional 50%/);
  });

  it("is false when deadline <= 24h out", async () => {
    const now = new Date("2026-05-12T10:00:00Z");
    const feed = staticFeed(now, [
      [0, 500],
      [1, 200],
    ]);
    const deadline = new Date(now.getTime() + 6 * 60 * 60 * 1000);
    const r = await recommendWindow(
      { deadline, region: "US-CAL-CISO" },
      { feed, now: () => now },
    );
    expect(r.batchEligible).toBe(false);
    expect(r.reasoning).not.toMatch(/Batch API/);
  });
});

describe("recommendWindow — error propagation", () => {
  it("throws InvalidDeadlineError on an unparseable deadline", async () => {
    await expect(
      recommendWindow({ deadline: "not-a-date", region: "US-CAL-CISO" }),
    ).rejects.toThrow(InvalidDeadlineError);
  });

  it("throws InvalidDeadlineError on a past deadline", async () => {
    await expect(
      recommendWindow({
        deadline: "2020-01-01T00:00:00Z",
        region: "US-CAL-CISO",
      }),
    ).rejects.toThrow(InvalidDeadlineError);
  });

  it("rejects an empty region", async () => {
    await expect(
      recommendWindow({
        deadline: new Date(Date.now() + 60 * 60 * 1000),
        region: "",
      }),
    ).rejects.toThrow(/region is required/);
  });
});

describe("recommendWindow — integration with default mockGridFeed", () => {
  it("returns a well-formed result with no injection", async () => {
    const deadline = new Date(Date.now() + 6 * 60 * 60 * 1000);
    const r = await recommendWindow({ deadline, region: "US-CAL-CISO" });
    expect(typeof r.scheduledFor).toBe("string");
    expect(r.intensityGCo2PerKwh).toBeGreaterThan(0);
    expect(["very_clean", "clean", "average", "dirty", "very_dirty"]).toContain(
      r.band,
    );
    expect(r.alternatives.length).toBeGreaterThanOrEqual(0);
    // mockGridFeed exists, so the explicit injection is identical to default.
    void mockGridFeed;
  });
});
