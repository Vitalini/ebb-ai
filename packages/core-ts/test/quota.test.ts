/**
 * Quota-reset deadlines (v0.17): config parsing, resolver, sweep.
 * Clock-dependent tests fake only Date, so they do not depend on the
 * wall-clock day or hour.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  loadQuotaResetConfig,
  mockGridFeed,
  prepareTick,
  previousQuotaReset,
  resolveQuotaDeadline,
  resolveQuotaProvider,
  Scheduler,
  sweepQuotaDeadlines,
  TaskStore,
} from "../src/index.js";
import type {
  GridForecast,
  ProviderAdapter,
  QuotaResetConfig,
  QuotaResetSchedule,
} from "../src/index.js";
import type { GridFeed } from "../src/types.js";

const BERLIN_MON_10: QuotaResetSchedule = {
  label: "claude",
  weekday: 1,
  hour: 10,
  minute: 0,
  timeZone: "Europe/Berlin",
  marginH: 2,
};

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "tidegap-quota-"));
});
afterEach(() => {
  vi.useRealTimers();
  rmSync(dir, { recursive: true, force: true });
});

function configFile(contents: string): string {
  const path = join(dir, "config");
  writeFileSync(path, contents);
  return path;
}

describe("resolveQuotaDeadline", () => {
  it("before the reset but after the margin: uses next week's reset (AE5)", () => {
    // Monday 2026-10-19 09:00 Berlin (CEST). This week's deadline 08:00 has
    // passed, so the following Monday is used; that one is in CET.
    const { deadline, resetAt } = resolveQuotaDeadline(
      BERLIN_MON_10,
      new Date("2026-10-19T07:00:00Z"),
    );
    expect(deadline.toISOString()).toBe("2026-10-26T07:00:00.000Z");
    expect(resetAt.toISOString()).toBe("2026-10-26T09:00:00.000Z");
  });

  it("mid-week: uses the coming reset", () => {
    // Thursday 2026-10-15 12:00 Berlin.
    const { deadline } = resolveQuotaDeadline(BERLIN_MON_10, new Date("2026-10-15T10:00:00Z"));
    expect(deadline.toISOString()).toBe("2026-10-19T06:00:00.000Z");
  });

  it("lands at the local wall time in a DST-change week", () => {
    // Sunday 2026-03-29 is the spring-forward day in Berlin.
    const sunday = { ...BERLIN_MON_10, weekday: 0 };
    const { resetAt } = resolveQuotaDeadline(sunday, new Date("2026-03-28T12:00:00Z"));
    expect(resetAt.toISOString()).toBe("2026-03-29T08:00:00.000Z");
    // Sunday 2026-10-25 is the fall-back day.
    const { resetAt: autumn } = resolveQuotaDeadline(sunday, new Date("2026-10-24T12:00:00Z"));
    expect(autumn.toISOString()).toBe("2026-10-25T09:00:00.000Z");
  });

  it("previousQuotaReset returns the latest reset at or before now", () => {
    expect(
      previousQuotaReset(BERLIN_MON_10, new Date("2026-10-19T09:00:00Z")).toISOString(),
    ).toBe("2026-10-19T08:00:00.000Z");
    expect(
      previousQuotaReset(BERLIN_MON_10, new Date("2026-10-19T07:59:00Z")).toISOString(),
    ).toBe("2026-10-12T08:00:00.000Z");
  });
});

describe("loadQuotaResetConfig", () => {
  it("parses labels, margins and zones; a missing zone uses the default", () => {
    const path = configFile(
      [
        "TIDEGAP_QUOTA_RESET_CLAUDE=mon 10:00 Europe/Berlin",
        "TIDEGAP_QUOTA_MARGIN_H_CLAUDE=4",
        "TIDEGAP_QUOTA_RESET_CODEX=Friday 18:30",
      ].join("\n"),
    );
    const config = loadQuotaResetConfig({ path, defaultTimeZone: "America/New_York" });
    expect(config.claude).toEqual({ ...BERLIN_MON_10, marginH: 4 });
    expect(config.codex).toEqual({
      label: "codex",
      weekday: 5,
      hour: 18,
      minute: 30,
      timeZone: "America/New_York",
      marginH: 2,
    });
  });

  it("a malformed entry disables only that label", () => {
    const path = configFile(
      [
        "TIDEGAP_QUOTA_RESET_CLAUDE=funday 25:00",
        "TIDEGAP_QUOTA_RESET_CODEX=tue 09:00 UTC",
        "TIDEGAP_QUOTA_RESET_BADZONE=tue 09:00 Mars/Olympus",
      ].join("\n"),
    );
    const config = loadQuotaResetConfig({ path });
    expect(Object.keys(config)).toEqual(["codex"]);
  });

  it("rejects a margin above 168 hours", () => {
    const path = configFile(
      "TIDEGAP_QUOTA_RESET_CLAUDE=mon 10:00 UTC\nTIDEGAP_QUOTA_MARGIN_H_CLAUDE=200\n",
    );
    expect(loadQuotaResetConfig({ path })).toEqual({});
  });

  it("ignores 0.17 EBB_QUOTA_* keys (removed in 0.19)", () => {
    const old = loadQuotaResetConfig({
      path: configFile("EBB_QUOTA_RESET_CLAUDE=mon 10:00 Europe/Berlin\nEBB_QUOTA_MARGIN_H_CLAUDE=4\n"),
    });
    expect(old.claude).toBeUndefined();
    const both = loadQuotaResetConfig({
      path: configFile("EBB_QUOTA_MARGIN_H_CLAUDE=4\nTIDEGAP_QUOTA_RESET_CLAUDE=mon 10:00 Europe/Berlin\n"),
    });
    expect(both.claude).toEqual(BERLIN_MON_10);
  });

  it("a missing file means no labels", () => {
    expect(loadQuotaResetConfig({ path: join(dir, "nope") })).toEqual({});
  });
});

describe("resolveQuotaProvider", () => {
  const two: QuotaResetConfig = {
    claude: BERLIN_MON_10,
    codex: { ...BERLIN_MON_10, label: "codex" },
  };

  it("picks the only label when none is requested", () => {
    const r = resolveQuotaProvider({ claude: BERLIN_MON_10 });
    expect(r.ok && r.schedule.label).toBe("claude");
  });

  it("errors with both labels when two are configured and none is requested", () => {
    const r = resolveQuotaProvider(two);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toMatch(/claude, codex/);
  });

  it("matches a requested label case-insensitively and rejects unknown ones", () => {
    const hit = resolveQuotaProvider(two, "CODEX");
    expect(hit.ok && hit.schedule.label).toBe("codex");
    const miss = resolveQuotaProvider(two, "gemini");
    expect(!miss.ok && miss.error).toMatch(/gemini.*claude, codex/);
  });
});

describe("sweepQuotaDeadlines", () => {
  const SPEC = JSON.stringify({
    type: "provider_call",
    provider: "anthropic",
    model: "claude-sonnet-4-5",
    prompt: "weekly digest",
  });

  function seedQuotaTask(store: TaskStore, taskId: string, label: string): void {
    store.upsert({
      taskId,
      status: "scheduled",
      enqueuedAt: "2026-10-15T10:00:00.000Z",
      scheduledFor: "2026-10-19T05:00:00.000Z",
      region: "US-CAL-CISO",
      bodyJson: SPEC,
      deadline: "2026-10-19T06:00:00.000Z", // Mon 08:00 Berlin = reset 10:00 - 2 h
      deadlineKind: "quota_reset",
      quotaProvider: label,
    });
  }

  function setup(nowIso: string) {
    vi.useFakeTimers({ now: new Date(nowIso), toFake: ["Date"] });
    const store = new TaskStore({ dbPath: join(dir, "queue.db") });
    const scheduler = new Scheduler({ store, feed: mockGridFeed(), signing: false });
    return { store, scheduler };
  }

  it("re-resolves a task whose reset passed, even after a margin change", async () => {
    // Monday 11:00 Berlin: the 10:00 reset passed after the 08:00 deadline.
    const { store, scheduler } = setup("2026-10-19T09:00:00Z");
    seedQuotaTask(store, "q1", "claude");
    const config = { claude: { ...BERLIN_MON_10, marginH: 24 } };
    const messages = await sweepQuotaDeadlines(scheduler, config, new Date());
    const row = store.get("q1")!;
    // Next reset Mon 2026-10-26 10:00 CET = 09:00Z, minus 24 h.
    expect(row.deadline).toBe("2026-10-25T09:00:00.000Z");
    expect(row.deadlineKind).toBe("quota_reset");
    expect(["scheduled", "queued"]).toContain(row.status);
    expect(messages.join("\n")).toMatch(/q1/);
    store.close();
  });

  it("skips a task a concurrent ticker claims after the sweep read", async () => {
    vi.useFakeTimers({ now: new Date("2026-10-19T09:00:00Z"), toFake: ["Date"] });
    const store = new TaskStore({ dbPath: join(dir, "queue.db") });
    const feed = mockGridFeed();
    const fetchForecast = feed.fetchForecast.bind(feed);
    // The other process claims the row while the sweep fetches the forecast:
    // after the sweep's read and status check, before its write.
    feed.fetchForecast = async (region: string, hours: number) => {
      store.claimScheduled("q5");
      return fetchForecast(region, hours);
    };
    const scheduler = new Scheduler({ store, feed, signing: false });
    seedQuotaTask(store, "q5", "claude");
    const messages = await sweepQuotaDeadlines(scheduler, { claude: BERLIN_MON_10 }, new Date());
    const row = store.get("q5")!;
    expect(row.status).toBe("running");
    expect(row.deadline).toBe("2026-10-19T06:00:00.000Z");
    expect(messages.join("\n")).not.toMatch(/q5/);
    store.close();
  });

  it("re-resolves a margin-0 task once its reset (= its deadline) passed", async () => {
    const { store, scheduler } = setup("2026-10-19T09:00:00Z");
    store.upsert({
      taskId: "q0",
      status: "scheduled",
      enqueuedAt: "2026-10-15T10:00:00.000Z",
      scheduledFor: "2026-10-19T07:00:00.000Z",
      region: "US-CAL-CISO",
      bodyJson: SPEC,
      deadline: "2026-10-19T08:00:00.000Z", // Mon 10:00 Berlin, margin 0
      deadlineKind: "quota_reset",
      quotaProvider: "claude",
    });
    const config = { claude: { ...BERLIN_MON_10, marginH: 0 } };
    await sweepQuotaDeadlines(scheduler, config, new Date());
    // Next reset Mon 2026-10-26 10:00 CET = 09:00Z.
    expect(store.get("q0")!.deadline).toBe("2026-10-26T09:00:00.000Z");
    store.close();
  });

  it("leaves a task alone after its deadline but before the reset", async () => {
    // Monday 09:00 Berlin.
    const { store, scheduler } = setup("2026-10-19T07:00:00Z");
    seedQuotaTask(store, "q2", "claude");
    const messages = await sweepQuotaDeadlines(scheduler, { claude: BERLIN_MON_10 }, new Date());
    expect(store.get("q2")!.deadline).toBe("2026-10-19T06:00:00.000Z");
    expect(messages).toEqual([]);
    store.close();
  });

  it("leaves a task with an unconfigured label unchanged and names the label", async () => {
    const { store, scheduler } = setup("2026-10-19T09:00:00Z");
    seedQuotaTask(store, "q3", "codex");
    const messages = await sweepQuotaDeadlines(scheduler, { claude: BERLIN_MON_10 }, new Date());
    expect(store.get("q3")!.deadline).toBe("2026-10-19T06:00:00.000Z");
    expect(messages.join("\n")).toMatch(/"codex" is not configured/);
    store.close();
  });

  it("prepareTick records last_tick_at and runs the sweep", async () => {
    const { store, scheduler } = setup("2026-10-19T09:00:00Z");
    seedQuotaTask(store, "q4", "claude");
    expect(scheduler.lastTickAt()).toBeUndefined();
    const messages = await prepareTick(scheduler, { quotaConfig: { claude: BERLIN_MON_10 } });
    expect(store.getMeta("last_tick_at")).toBe("2026-10-19T09:00:00.000Z");
    expect(scheduler.lastTickAt()).toBe("2026-10-19T09:00:00.000Z");
    expect(store.get("q4")!.deadline).toBe("2026-10-26T07:00:00.000Z");
    expect(messages).toHaveLength(1);
    store.close();
  });
});

describe("prepareTick + Scheduler.tick (AE9)", () => {
  const SPEC = JSON.stringify({
    type: "provider_call",
    provider: "anthropic",
    model: "claude-sonnet-4-5",
    prompt: "weekly digest",
  });

  /** Forecast whose cleanest hour is `cleanAtH` hours from now. */
  function feedCleanestAt(cleanAtH: number): GridFeed {
    return {
      source: "mock",
      async fetchForecast(region: string, hours = 72): Promise<GridForecast> {
        const now = Date.now();
        return {
          region,
          source: "mock",
          generatedAt: new Date(now).toISOString(),
          entries: Array.from({ length: Math.min(hours, 72) }, (_, h) => ({
            datetime: new Date(now + h * 3_600_000).toISOString(),
            carbonIntensityGCo2PerKwh: h === cleanAtH ? 50 : 400,
            band: h === cleanAtH ? ("very_clean" as const) : ("dirty" as const),
          })),
        };
      },
    };
  }

  function adapter(withBatch: boolean): ProviderAdapter & { calls: number } {
    const a: ProviderAdapter & { calls: number } = {
      provider: "anthropic",
      ready: true,
      calls: 0,
      async dispatch(model) {
        a.calls += 1;
        return { text: "ok", model, provider: "anthropic", raw: null };
      },
    } as ProviderAdapter & { calls: number };
    if (withBatch) {
      a.dispatchBatch = async (_model, prompts) => ({
        batchId: "b-1",
        provider: "anthropic",
        size: prompts.length,
      });
    }
    return a;
  }

  async function run(cleanAtH: number, withBatch: boolean) {
    // Monday 2026-10-19 11:00 Berlin: the 10:00 reset passed after the
    // stored 08:00 deadline, and the task's window is overdue.
    vi.useFakeTimers({ now: new Date("2026-10-19T09:00:00Z"), toFake: ["Date"] });
    const store = new TaskStore({ dbPath: join(dir, "queue.db") });
    store.upsert({
      taskId: "q",
      status: "scheduled",
      enqueuedAt: "2026-10-15T10:00:00.000Z",
      scheduledFor: "2026-10-19T05:00:00.000Z",
      region: "DE",
      bodyJson: SPEC,
      deadline: "2026-10-19T06:00:00.000Z",
      deadlineKind: "quota_reset",
      quotaProvider: "claude",
    });
    const scheduler = new Scheduler({
      store,
      feed: feedCleanestAt(cleanAtH),
      signing: false,
      rng: () => 0,
    });
    const a = adapter(withBatch);
    await prepareTick(scheduler, { quotaConfig: { claude: BERLIN_MON_10 } });
    await scheduler.tick({ anthropic: a });
    const row = store.get("q")!;
    store.close();
    return { row, calls: a.calls };
  }

  it("a sync-only adapter does not dispatch the task; it stays scheduled with next week's deadline", async () => {
    const { row, calls } = await run(10, false);
    expect(calls).toBe(0);
    expect(row.status).toBe("scheduled");
    expect(row.deadline).toBe("2026-10-26T07:00:00.000Z");
    expect(Date.parse(row.scheduledFor!)).toBeGreaterThan(Date.parse("2026-10-19T09:00:00Z"));
  });

  it("a batch-capable adapter submits it with the new deadline", async () => {
    const { row, calls } = await run(10, true);
    expect(calls).toBe(0);
    expect(row.status).toBe("submitted");
    expect(row.deadline).toBe("2026-10-26T07:00:00.000Z");
  });

  it("when the cleanest hour is now, it is dispatched in that tick against the new deadline", async () => {
    const { row, calls } = await run(0, false);
    expect(calls).toBe(1);
    expect(row.status).toBe("completed");
    expect(row.deadline).toBe("2026-10-26T07:00:00.000Z");
  });
});
