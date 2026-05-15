/**
 * Unit tests for the v0.8 personal-impact aggregator.
 */

import { describe, it, expect } from "vitest";
import {
  aggregateStats,
  aggregateByRegion,
  bandHistogram,
  achievements,
  classifyBand,
  ASSUMED_KWH_PER_CALL,
} from "../src/aggregator.js";
import type { TaskRecord } from "../src/types.js";

function row(opts: {
  taskId: string;
  region?: string;
  estimatedCarbonGCo2?: number;
  ranAt?: string;
  intensitySource?: "scored" | "current" | "expedited";
  withReceipt?: boolean;
}): TaskRecord {
  return {
    taskId: opts.taskId,
    status: "completed",
    enqueuedAt: "2026-05-01T00:00:00.000Z",
    completedAt: opts.ranAt ?? "2026-05-01T01:00:00.000Z",
    region: opts.region ?? "US-CAL-CISO",
    intensitySource: opts.intensitySource,
    receipt:
      opts.withReceipt === false
        ? undefined
        : {
            taskId: opts.taskId,
            ranAt: opts.ranAt ?? "2026-05-01T01:00:00.000Z",
            region: opts.region ?? "US-CAL-CISO",
            estimatedCarbonGCo2: opts.estimatedCarbonGCo2 ?? 0.5,
          },
  };
}

describe("classifyBand", () => {
  it("buckets canonical edges deterministically", () => {
    expect(classifyBand(0)).toBe("veryClean");
    expect(classifyBand(99)).toBe("veryClean");
    expect(classifyBand(100)).toBe("clean");
    expect(classifyBand(249)).toBe("clean");
    expect(classifyBand(250)).toBe("average");
    expect(classifyBand(449)).toBe("average");
    expect(classifyBand(450)).toBe("dirty");
    expect(classifyBand(699)).toBe("dirty");
    expect(classifyBand(700)).toBe("veryDirty");
    expect(classifyBand(2000)).toBe("veryDirty");
  });
});

describe("aggregateStats", () => {
  it("returns zeroed stats on empty input", () => {
    const s = aggregateStats([]);
    expect(s.taskCount).toBe(0);
    expect(s.totalEstimatedCarbonGCo2).toBe(0);
    expect(s.scoredHits).toBe(0);
    expect(s.firstRanAt).toBeNull();
    expect(s.lastRanAt).toBeNull();
  });

  it("counts only rows with receipts", () => {
    const s = aggregateStats([
      row({ taskId: "a", withReceipt: true }),
      row({ taskId: "b", withReceipt: false }),
      row({ taskId: "c", withReceipt: true }),
    ]);
    expect(s.taskCount).toBe(2);
  });

  it("sums estimated carbon across receipts", () => {
    const s = aggregateStats([
      row({ taskId: "a", estimatedCarbonGCo2: 1.5 }),
      row({ taskId: "b", estimatedCarbonGCo2: 2.25 }),
      row({ taskId: "c", estimatedCarbonGCo2: 0.5 }),
    ]);
    expect(s.totalEstimatedCarbonGCo2).toBe(4.25);
  });

  it("bins intensitySource correctly", () => {
    const s = aggregateStats([
      row({ taskId: "a", intensitySource: "scored" }),
      row({ taskId: "b", intensitySource: "scored" }),
      row({ taskId: "c", intensitySource: "current" }),
      row({ taskId: "d", intensitySource: "expedited" }),
      row({ taskId: "e" }), // no source — uncounted in scored hits
    ]);
    expect(s.scoredHits).toBe(2);
    expect(s.currentDispatches).toBe(1);
    expect(s.expeditedDispatches).toBe(1);
  });

  it("captures first / last ranAt timestamps", () => {
    const s = aggregateStats([
      row({ taskId: "a", ranAt: "2026-04-30T12:00:00.000Z" }),
      row({ taskId: "b", ranAt: "2026-05-15T09:00:00.000Z" }),
      row({ taskId: "c", ranAt: "2026-05-10T18:00:00.000Z" }),
    ]);
    expect(s.firstRanAt).toBe("2026-04-30T12:00:00.000Z");
    expect(s.lastRanAt).toBe("2026-05-15T09:00:00.000Z");
  });
});

describe("aggregateByRegion", () => {
  it("groups by region with descending task count", () => {
    const out = aggregateByRegion([
      row({ taskId: "a", region: "GB" }),
      row({ taskId: "b", region: "GB" }),
      row({ taskId: "c", region: "GB" }),
      row({ taskId: "d", region: "FR" }),
      row({ taskId: "e", region: "US-CAL-CISO" }),
    ]);
    expect(out[0]?.region).toBe("GB");
    expect(out[0]?.taskCount).toBe(3);
    expect(out[1]?.region).toMatch(/FR|US-CAL-CISO/); // tie-order is implementation-defined
    expect(out.length).toBe(3);
  });

  it("computes avg per region", () => {
    const out = aggregateByRegion([
      row({ taskId: "a", region: "GB", estimatedCarbonGCo2: 0.2 }),
      row({ taskId: "b", region: "GB", estimatedCarbonGCo2: 0.6 }),
    ]);
    const gb = out.find((r) => r.region === "GB");
    expect(gb?.totalEstimatedCarbonGCo2).toBe(0.8);
    expect(gb?.avgEstimatedCarbonGCo2).toBe(0.4);
  });
});

describe("bandHistogram", () => {
  it("buckets by the recovered grid intensity", () => {
    // intensity = estimatedCarbonGCo2 / 0.0015 kWh
    const out = bandHistogram([
      row({ taskId: "a", estimatedCarbonGCo2: 50 * ASSUMED_KWH_PER_CALL }), // 50 g/kWh -> veryClean
      row({ taskId: "b", estimatedCarbonGCo2: 200 * ASSUMED_KWH_PER_CALL }), // clean
      row({ taskId: "c", estimatedCarbonGCo2: 300 * ASSUMED_KWH_PER_CALL }), // average
      row({ taskId: "d", estimatedCarbonGCo2: 800 * ASSUMED_KWH_PER_CALL }), // veryDirty
    ]);
    expect(out.veryClean).toBe(1);
    expect(out.clean).toBe(1);
    expect(out.average).toBe(1);
    expect(out.veryDirty).toBe(1);
  });
});

describe("achievements", () => {
  it("returns the canonical badge list, unlocked flags reflecting input", () => {
    const rows = Array.from({ length: 15 }, (_, i) =>
      row({
        taskId: `t-${i}`,
        region: i < 8 ? "GB" : i < 12 ? "FR" : "US-CAL-CISO",
        intensitySource: "scored",
        ranAt: new Date(2026, 4, 1 + i).toISOString(),
      }),
    );
    const stats = aggregateStats(rows);
    const perRegion = aggregateByRegion(rows);
    const out = achievements(stats, perRegion);

    expect(out.find((b) => b.id === "first-deferral")?.unlocked).toBe(true);
    expect(out.find((b) => b.id === "ten-deferrals")?.unlocked).toBe(true);
    expect(out.find((b) => b.id === "hundred-deferrals")?.unlocked).toBe(false);
    expect(out.find((b) => b.id === "thousand-deferrals")?.unlocked).toBe(false);
    expect(out.find((b) => b.id === "multi-region")?.unlocked).toBe(true);
    expect(out.find((b) => b.id === "scored-streak")?.unlocked).toBe(true);
    expect(out.find((b) => b.id === "endurance")?.unlocked).toBe(true);
  });

  it("does not unlock the streak badge below 90% scored rate or below 10 tasks", () => {
    const noisy = [
      row({ taskId: "a", intensitySource: "scored" }),
      row({ taskId: "b", intensitySource: "current" }),
      row({ taskId: "c", intensitySource: "scored" }),
      row({ taskId: "d", intensitySource: "scored" }),
    ];
    const stats = aggregateStats(noisy);
    const perRegion = aggregateByRegion(noisy);
    const out = achievements(stats, perRegion);
    expect(out.find((b) => b.id === "scored-streak")?.unlocked).toBe(false);
  });
});
