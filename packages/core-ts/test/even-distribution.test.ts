/**
 * Even-distribution simulation.
 *
 * Concern: "if everyone defers to the same off-peak hour, we just create a
 * new peak."
 *
 * Counter-argument we want to verify mechanically: under a realistic load
 * (many tasks with varied deadlines, varied regions, and *varied submit
 * times*), the scheduler's cleanest-window selection across the forecast
 * horizon of each task naturally spreads dispatch hours, because the
 * cleanest hour inside a 6-hour deadline is different from the cleanest
 * hour inside a 48-hour deadline, different across regions, and different
 * depending on what UTC hour the task was submitted.
 *
 * This test (v0.8.2-tightened):
 *   1. Generates 10,000 synthetic tasks with random deadlines (1h-72h),
 *      random regions across 7 zones, and random submit times across
 *      a 7-day window.
 *   2. Calls recommendWindow with a seeded rng for the v0.8.0 tie-break.
 *   3. Bins chosen UTC-hour-of-day into 24 buckets.
 *   4. Asserts max-bucket concentration < 25% (vs. 95% for the
 *      pre-v0.8.0 "everyone-runs-at-trough" pathology).
 *
 * Pure mock data — deterministic across runs given the seeded PRNG.
 */

import { describe, it, expect } from "vitest";
import { recommendWindow } from "../src/recommend.js";
import { mockGridFeed } from "../src/grid.js";

// Simple mulberry32 PRNG so the test is deterministic on every machine.
function seeded(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const REGIONS = [
  "US-CAL-CISO",
  "US-TEX-ERCO",
  "US-NE-ISNE",
  "US-MIDA-PJM",
  "FR",
  "DE",
  "GB",
];

describe("even-distribution simulation", () => {
  it("spreads chosen dispatch hours across the day under varied deadlines + regions", async () => {
    const N = 10_000;
    const rnd = seeded(20260515);
    const tieRnd = seeded(98765432); // seeded RNG for the v0.8.0 tie-break

    const hourBuckets = new Array(24).fill(0);
    // Anchor + ±3.5-day submitted-at variation. The feed shares the
    // same per-task clock so the forecast aligns with the simulated
    // submit time.
    const anchor = new Date("2026-05-15T12:00:00.000Z").getTime();
    const submitWindowMs = 7 * 24 * 3600 * 1000;

    for (let i = 0; i < N; i++) {
      const submittedAt = new Date(anchor + (rnd() - 0.5) * submitWindowMs);
      const deadlineHrs = 1 + Math.floor(rnd() * 71); // 1h–72h
      const region = REGIONS[Math.floor(rnd() * REGIONS.length)]!;
      const deadline = new Date(
        submittedAt.getTime() + deadlineHrs * 3600 * 1000,
      ).toISOString();
      const feed = mockGridFeed(() => submittedAt);
      const out = await recommendWindow(
        { deadline, region },
        { feed, now: () => submittedAt, rng: tieRnd },
      );
      const chosen = new Date(out.scheduledFor).getUTCHours();
      hourBuckets[chosen]! += 1;
    }

    const total = hourBuckets.reduce((s, n) => s + n, 0);
    expect(total).toBe(N);

    const maxBucket = Math.max(...hourBuckets);
    const emptyBuckets = hourBuckets.filter((n) => n === 0).length;

    /* eslint-disable no-console */
    console.log(
      `[sim] dispatch histogram (mock feed, N=${N}):`,
      hourBuckets
        .map((n, h) => `${String(h).padStart(2, "0")}:${String(n).padStart(4)}`)
        .join(" "),
    );
    console.log(
      `[sim] max=${maxBucket} (${((maxBucket / N) * 100).toFixed(1)}%) · ` +
        `empty=${emptyBuckets}/24 buckets`,
    );

    // Under the full v0.8.2 fix set — per-region phase offsets +
    // randomised tie-break + clock-injected mock feed + varied submit
    // times — the residual concentration is ~11 % (vs. the uniform
    // 4.2 % floor for 24 buckets). Threshold of 20 % catches any
    // regression back toward the pre-v0.8.0 pathology (66.9 %) while
    // staying comfortably above the current best.
    expect(maxBucket / N).toBeLessThan(0.2);
    expect(emptyBuckets).toBe(0);
  });
});
