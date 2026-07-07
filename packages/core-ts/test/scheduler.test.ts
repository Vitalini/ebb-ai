import { describe, expect, it } from "vitest";
import {
  CarbonBudgetExceededError,
  InvalidDeadlineError,
  mockGridFeed,
  pickBestWindow,
  Scheduler,
} from "../src/index.js";

describe("mockGridFeed", () => {
  it("returns the requested number of hours", async () => {
    const feed = mockGridFeed();
    const forecast = await feed.fetchForecast("US-CAL-CISO", 12);
    expect(forecast.entries).toHaveLength(12);
    expect(forecast.source).toBe("mock");
  });

  it("produces an intraday low (overnight) and high (late afternoon)", async () => {
    const feed = mockGridFeed();
    const forecast = await feed.fetchForecast("US-CAL-CISO", 48);
    const values = forecast.entries.map((e) => e.carbonIntensityGCo2PerKwh);
    const min = Math.min(...values);
    const max = Math.max(...values);
    expect(max - min).toBeGreaterThan(50);
  });

  it("classifies carbon bands monotonically", async () => {
    const feed = mockGridFeed();
    const forecast = await feed.fetchForecast("FR", 6);
    for (const e of forecast.entries) {
      if (e.carbonIntensityGCo2PerKwh < 100) expect(e.band).toBe("very_clean");
      if (e.carbonIntensityGCo2PerKwh >= 700) expect(e.band).toBe("very_dirty");
    }
  });

  it("supports 72-hour horizon", async () => {
    const feed = mockGridFeed();
    const forecast = await feed.fetchForecast("US-MIDA-PJM", 72);
    expect(forecast.entries).toHaveLength(72);
  });
});

describe("pickBestWindow", () => {
  it("returns undefined when no entry falls within the deadline", () => {
    // 2h in the past: fully elapsed, not even the hour covering "now".
    const past = [
      {
        datetime: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
        carbonIntensityGCo2PerKwh: 100,
        band: "clean" as const,
      },
    ];
    const result = pickBestWindow(past, new Date(Date.now() + 60 * 60 * 1000));
    expect(result).toBeUndefined();
  });

  it("accepts the entry covering the current hour (start up to 1h in the past)", () => {
    const entries = [
      {
        // Started 30 minutes ago — this is the hour containing "now".
        datetime: new Date(Date.now() - 30 * 60 * 1000).toISOString(),
        carbonIntensityGCo2PerKwh: 50,
        band: "very_clean" as const,
      },
      {
        datetime: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
        carbonIntensityGCo2PerKwh: 400,
        band: "average" as const,
      },
    ];
    const result = pickBestWindow(entries, new Date(Date.now() + 2 * 60 * 60 * 1000));
    expect(result?.carbonIntensityGCo2PerKwh).toBe(50);
  });

  it("picks the lowest-intensity entry inside the window", () => {
    const inOneHour = new Date(Date.now() + 60 * 60 * 1000);
    const inTwoHours = new Date(Date.now() + 2 * 60 * 60 * 1000);
    const inThreeHours = new Date(Date.now() + 3 * 60 * 60 * 1000);
    const entries = [
      { datetime: inOneHour.toISOString(), carbonIntensityGCo2PerKwh: 400, band: "average" as const },
      { datetime: inTwoHours.toISOString(), carbonIntensityGCo2PerKwh: 120, band: "clean" as const },
      { datetime: inThreeHours.toISOString(), carbonIntensityGCo2PerKwh: 220, band: "clean" as const },
    ];
    const deadline = new Date(Date.now() + 4 * 60 * 60 * 1000);
    const result = pickBestWindow(entries, deadline);
    expect(result?.carbonIntensityGCo2PerKwh).toBe(120);
  });
});

describe("Scheduler.enqueue (synchronous accounting)", () => {
  it("creates a TaskRecord with status 'queued'", () => {
    const s = new Scheduler({ feed: mockGridFeed() });
    const record = s.enqueue(async () => "ok", {
      deadline: new Date(Date.now() + 60 * 60 * 1000),
      region: "US-CAL-CISO",
    });
    expect(record.status).toBe("queued");
    expect(record.region).toBe("US-CAL-CISO");
    expect(s.listTasks()).toHaveLength(1);
    s.shutdown();
  });

  it("uses the default region when none supplied", () => {
    const s = new Scheduler({ feed: mockGridFeed() });
    const record = s.enqueue(async () => "ok");
    expect(record.region).toBe("US-CAL-CISO");
    s.shutdown();
  });

  it("assigns a UUID-shaped id when no taskId supplied", () => {
    const s = new Scheduler({ feed: mockGridFeed() });
    const r1 = s.enqueue(async () => "a");
    const r2 = s.enqueue(async () => "b");
    expect(r1.taskId).not.toBe(r2.taskId);
    expect(r1.taskId).toMatch(/^t-[0-9a-f-]{36}$/);
    s.shutdown();
  });

  it("rejects empty caller-supplied taskId", () => {
    const s = new Scheduler({ feed: mockGridFeed() });
    expect(() => s.enqueue(async () => "x", { taskId: "" })).toThrow();
    s.shutdown();
  });

  it("rejects duplicate caller-supplied taskId", () => {
    const s = new Scheduler({ feed: mockGridFeed() });
    s.enqueue(async () => "a", { taskId: "user:foo" });
    expect(() => s.enqueue(async () => "b", { taskId: "user:foo" })).toThrow();
    s.shutdown();
  });
});

describe("Deadline validation", () => {
  it("rejects an unparseable deadline string", () => {
    const s = new Scheduler({ feed: mockGridFeed() });
    expect(() => s.enqueue(async () => "ok", { deadline: "not-a-date" })).toThrow(
      InvalidDeadlineError,
    );
    s.shutdown();
  });

  it("rejects a deadline already in the past", () => {
    const s = new Scheduler({ feed: mockGridFeed() });
    expect(() => s.enqueue(async () => "ok", { deadline: "2020-01-01T00:00:00Z" })).toThrow(
      InvalidDeadlineError,
    );
    s.shutdown();
  });
});

describe("Carbon budget enforcement", () => {
  it("rejects a task when no window meets the budget", async () => {
    const s = new Scheduler({ feed: mockGridFeed() });
    // Mock floor for US-MIDW-MISO is 460 → grams ~= 0.0015 * 460 = 0.69g
    // Set an impossibly tight budget of 0.1g.
    await expect(
      s.defer(async () => "should never run", {
        deadline: new Date(Date.now() + 200),
        region: "US-MIDW-MISO",
        carbonBudgetG: 0.1,
      }),
    ).rejects.toThrow(CarbonBudgetExceededError);
    s.shutdown();
  });
});

describe("Scheduler.defer (end-to-end with immediate deadline)", () => {
  it("dispatches and returns the task's result", async () => {
    const s = new Scheduler({ feed: mockGridFeed() });
    const result = await s.defer(async () => 42, {
      deadline: new Date(Date.now() + 200),
    });
    expect(result).toBe(42);
    const tasks = s.listTasks();
    expect(tasks[0]?.status).toBe("completed");
    expect(tasks[0]?.receipt?.estimatedCarbonGCo2).toBeGreaterThan(0);
    s.shutdown();
  });

  it("propagates errors from the task body", async () => {
    const s = new Scheduler({ feed: mockGridFeed() });
    await expect(
      s.defer(
        async () => {
          throw new Error("boom");
        },
        { deadline: new Date(Date.now() + 200) },
      ),
    ).rejects.toThrow("boom");
    s.shutdown();
  });
});
