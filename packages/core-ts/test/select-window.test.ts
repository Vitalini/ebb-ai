/**
 * selectWindow — shared window-selection policy tests (§2.1).
 *
 * Covers:
 *   - seeded-rng determinism (same seed → same pick)
 *   - tolerance-band boundary (entries within / outside max(15%,30g))
 *   - in-deadline filter including the current hour (>= now − 1h)
 *   - recommend/scheduler agreement on the candidate SET
 *   - the committing scheduler path actually SPREADS dispatch hours
 *
 * The scheduler-spread test drives `enqueueProviderCall` (a real committing
 * path), not `recommendWindow`, which is the whole point of the §2.1 fix.
 */

import { describe, expect, it } from "vitest";
import { Scheduler } from "../src/scheduler.js";
import { selectWindow, inDeadlineEntries } from "../src/select-window.js";
import { recommendWindow } from "../src/recommend.js";
import type { GridFeed, GridForecast, GridForecastEntry } from "../src/types.js";

// mulberry32 — deterministic PRNG so the tie-break is reproducible.
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

// A generator that cycles a fixed sequence of rng values — lets a test
// deterministically walk through every index of a band.
function cycling(values: number[]): () => number {
  let i = 0;
  return () => {
    const v = values[i % values.length]!;
    i += 1;
    return v;
  };
}

function band(g: number): GridForecastEntry["band"] {
  if (g < 100) return "very_clean";
  if (g < 250) return "clean";
  if (g < 450) return "average";
  if (g < 700) return "dirty";
  return "very_dirty";
}

function entriesFrom(
  now: Date,
  pairs: Array<[hours: number, intensity: number]>,
): GridForecastEntry[] {
  return pairs.map(([h, g]) => ({
    datetime: new Date(now.getTime() + h * 3_600_000).toISOString(),
    carbonIntensityGCo2PerKwh: g,
    band: band(g),
  }));
}

function staticFeed(now: Date, entries: GridForecastEntry[]): GridFeed {
  return {
    source: "mock",
    async fetchForecast(region: string): Promise<GridForecast> {
      return { region, source: "mock", generatedAt: now.toISOString(), entries };
    },
  };
}

describe("selectWindow — determinism", () => {
  it("is deterministic under a seeded rng", () => {
    const now = new Date("2026-05-12T10:00:00Z");
    // Three near-equal troughs within a 30g band of 100.
    const entries = entriesFrom(now, [
      [0, 500],
      [1, 100],
      [2, 110],
      [3, 120],
      [4, 400],
    ]);
    const deadline = new Date(now.getTime() + 6 * 3_600_000);

    const a = selectWindow(entries, deadline, {
      now: () => now,
      rng: seeded(42),
    });
    const b = selectWindow(entries, deadline, {
      now: () => now,
      rng: seeded(42),
    });
    expect(a?.chosen.datetime).toBe(b?.chosen.datetime);
    // Band = the 3 entries within 100 + max(15,30)=30 → [100,110,120].
    expect(a?.band.map((e) => e.carbonIntensityGCo2PerKwh)).toEqual([100, 110, 120]);
  });

  it("returns undefined when nothing falls inside the deadline", () => {
    const now = new Date("2026-05-12T10:00:00Z");
    const entries = entriesFrom(now, [
      [10, 100],
      [11, 120],
    ]);
    const deadline = new Date(now.getTime() + 5 * 3_600_000);
    expect(selectWindow(entries, deadline, { now: () => now })).toBeUndefined();
  });
});

describe("selectWindow — tolerance band boundary", () => {
  it("includes entries at the band edge and excludes those beyond it", () => {
    const now = new Date("2026-05-12T10:00:00Z");
    // cheapest=200 → tolerance = max(200*0.15, 30) = 30 → band edge at 230.
    const entries = entriesFrom(now, [
      [0, 500],
      [1, 200], // cheapest
      [2, 230], // exactly at the edge → IN
      [3, 231], // just past the edge → OUT
      [4, 260],
    ]);
    const deadline = new Date(now.getTime() + 6 * 3_600_000);
    const sel = selectWindow(entries, deadline, { now: () => now });
    expect(sel?.tolerance).toBe(30);
    expect(sel?.band.map((e) => e.carbonIntensityGCo2PerKwh)).toEqual([200, 230]);
  });

  it("uses the 30g floor when 15% of cheapest would be smaller", () => {
    const now = new Date("2026-05-12T10:00:00Z");
    // cheapest=80 → 15% = 12, floor 30 wins → band edge at 110.
    const entries = entriesFrom(now, [
      [1, 80],
      [2, 105], // within 30 → IN
      [3, 111], // beyond 30 → OUT
    ]);
    const deadline = new Date(now.getTime() + 6 * 3_600_000);
    const sel = selectWindow(entries, deadline, { now: () => now });
    expect(sel?.tolerance).toBe(30);
    expect(sel?.band.map((e) => e.carbonIntensityGCo2PerKwh)).toEqual([80, 105]);
  });

  it("uses 15% of cheapest when it exceeds the 30g floor", () => {
    const now = new Date("2026-05-12T10:00:00Z");
    // cheapest=400 → 15% = 60 > 30 → band edge at 460.
    const entries = entriesFrom(now, [
      [1, 400],
      [2, 460], // at edge → IN
      [3, 461], // past → OUT
    ]);
    const deadline = new Date(now.getTime() + 6 * 3_600_000);
    const sel = selectWindow(entries, deadline, { now: () => now });
    expect(sel?.tolerance).toBe(60);
    expect(sel?.band.map((e) => e.carbonIntensityGCo2PerKwh)).toEqual([400, 460]);
  });
});

describe("inDeadlineEntries — current-hour inclusion", () => {
  it("includes the entry that started up to an hour ago (§1.7)", () => {
    const now = new Date("2026-05-12T10:30:00Z");
    // Entry at 10:00 started 30min ago — the current hour, still valid.
    const entries = entriesFrom(new Date("2026-05-12T10:00:00Z"), [
      [0, 300], // 10:00, started 30min ago
      [1, 200], // 11:00
    ]);
    const deadline = new Date(now.getTime() + 3 * 3_600_000);
    const usable = inDeadlineEntries(entries, deadline, now);
    expect(usable.map((e) => e.carbonIntensityGCo2PerKwh)).toEqual([300, 200]);
  });

  it("excludes an entry that started more than an hour ago", () => {
    const now = new Date("2026-05-12T12:00:00Z");
    const entries = entriesFrom(new Date("2026-05-12T10:00:00Z"), [
      [0, 300], // 10:00, started 2h ago → OUT
      [2, 200], // 12:00 → IN
    ]);
    const deadline = new Date(now.getTime() + 3 * 3_600_000);
    const usable = inDeadlineEntries(entries, deadline, now);
    expect(usable.map((e) => e.carbonIntensityGCo2PerKwh)).toEqual([200]);
  });
});

describe("recommend / scheduler agreement on candidate set (§2.1)", () => {
  it("recommendWindow and previewProviderCall see the same band", async () => {
    // The Scheduler scores against real Date.now() (no injectable clock),
    // so anchor entries at the current hour so both the recommend path
    // (injected clock) and the preview path (real clock) see the same
    // in-deadline window.
    const now = new Date(Math.floor(Date.now() / 3_600_000) * 3_600_000);
    const entries = entriesFrom(now, [
      [0, 500],
      [1, 100],
      [2, 115],
      [3, 125],
      [4, 400],
    ]);
    const deadline = new Date(now.getTime() + 6 * 3_600_000);
    const feed = staticFeed(now, entries);

    // Ground-truth band from the shared helper.
    const truth = selectWindow(entries, deadline, { now: () => now });
    const bandIntensities = truth!.band.map((e) => e.carbonIntensityGCo2PerKwh);
    // cheapest 100 → tolerance 30 → [100,115,125].
    expect(bandIntensities).toEqual([100, 115, 125]);

    // recommendWindow's chosen + alternatives cover exactly the band's
    // members (chosen ∪ alternatives ⊇ band).
    const rec = await recommendWindow(
      { deadline, region: "US-CAL-CISO" },
      { feed, now: () => now, rng: seeded(7) },
    );
    const recSet = new Set([
      rec.intensityGCo2PerKwh,
      ...rec.alternatives.map((a) => a.intensityGCo2PerKwh),
    ]);
    for (const g of bandIntensities) expect(recSet.has(g)).toBe(true);

    // previewProviderCall reports the same band size.
    const sched = new Scheduler({ feed, rng: seeded(7) });
    const preview = await sched.previewProviderCall(
      { type: "provider_call", provider: "anthropic", model: "claude-sonnet-4-5", prompt: "hi" },
      { deadline, region: "US-CAL-CISO" },
    );
    expect(preview.cleanBandSize).toBe(truth!.band.length);
    sched.shutdown();
  });
});

describe("committing scheduler path spreads dispatch hours (§2.1)", () => {
  it("enqueueProviderCall lands on more than one hour across N tasks", async () => {
    // Three near-equal troughs at +1h, +2h, +3h from the current hour. The
    // Scheduler scores against real Date.now(), so anchor at "now".
    const now = new Date(Math.floor(Date.now() / 3_600_000) * 3_600_000);
    const entries = entriesFrom(now, [
      [0, 500],
      [1, 100],
      [2, 108],
      [3, 116],
      [4, 480],
      [5, 470],
    ]);
    const feed = staticFeed(now, entries);
    const deadline = new Date(now.getTime() + 6 * 3_600_000).toISOString();

    // rng cycling across the band indices so every commit does not pick the
    // same slot. mulberry32 would also spread, but a cycling rng makes the
    // multi-hour guarantee exact and reproducible.
    const N = 50;
    const rng = cycling([0.05, 0.4, 0.75]);
    const sched = new Scheduler({ feed, rng });

    const hours = new Set<number>();
    for (let i = 0; i < N; i++) {
      const rec = await sched.enqueueProviderCall(
        {
          type: "provider_call",
          provider: "anthropic",
          model: "claude-sonnet-4-5",
          prompt: `task ${i}`,
        },
        { deadline, region: "US-CAL-CISO", taskId: `spread-${i}` },
      );
      expect(rec.scheduledFor).toBeDefined();
      hours.add(new Date(rec.scheduledFor!).getUTCHours());
    }
    // The whole point of §2.1: committed tasks do NOT all pile on one hour.
    expect(hours.size).toBeGreaterThan(1);
    sched.shutdown();
  });
});
