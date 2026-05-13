/**
 * recommend_window — non-committal planning endpoint.
 *
 * Returns the optimal execution time for a task **without** scheduling it.
 * The agent calls this, sees the recommendation, then decides whether to
 * follow up with `schedule_task` / `defer`.
 *
 * This module is deliberately stateless and never touches the Scheduler's
 * queue. It only reads the grid feed and runs pure scoring math, which makes
 * it safe to call from any context (an MCP handler, a CLI, a notebook).
 *
 * Algorithm:
 *   1. Validate deadline (same rules as `defer`).
 *   2. Fetch grid forecast for `region`, horizon clamped to 72h.
 *   3. Optionally drop entries above `carbonBudgetG`.
 *   4. Pick the cheapest in-deadline survivor (`pickBestWindow`).
 *   5. Compute alternatives = next 3 cheapest survivors (excluding the chosen).
 *   6. Compute savings vs "now" using forecast entry[0] as the current cell.
 *   7. Generate a one-line `reasoning` string tailored to the situation.
 */

import { mockGridFeed } from "./grid.js";
import {
  CarbonBudgetExceededError,
  InvalidDeadlineError,
} from "./scheduler.js";
import type {
  GridFeed,
  GridForecastEntry,
  RecommendAlternative,
  RecommendOptions,
  RecommendResult,
} from "./types.js";

/** Same constant the Scheduler uses — kept in sync deliberately. */
const ENERGY_KWH_PER_TASK = 0.0015;
const MAX_HORIZON_HOURS = 72;
/** Batch API SLA threshold — Anthropic & OpenAI both promise 24h. */
const BATCH_ELIGIBLE_HOURS = 24;

interface RecommendDependencies {
  /** Inject a feed (mostly for tests). Defaults to a fresh mock feed. */
  feed?: GridFeed;
  /** Inject a clock (mostly for tests). Defaults to `Date.now`. */
  now?: () => Date;
}

/**
 * Compute a recommended window for a task. Pure planning — no side effects.
 *
 * @throws InvalidDeadlineError       if `deadline` is missing/unparseable/past
 * @throws CarbonBudgetExceededError  if every forecast entry exceeds the budget
 */
export async function recommendWindow(
  opts: RecommendOptions,
  deps: RecommendDependencies = {},
): Promise<RecommendResult> {
  if (opts.region === undefined || opts.region === null || opts.region === "") {
    // Region is required on this surface. Throwing a plain Error here is
    // intentional — there's no domain-specific error type for "missing
    // region" and the message is enough for the caller (an LLM) to recover.
    throw new Error("recommendWindow: region is required");
  }
  const deadline = normalizeDeadline(opts.deadline, deps.now);
  const feed = deps.feed ?? mockGridFeed();
  const now = (deps.now ?? (() => new Date()))();

  const horizonH = Math.max(
    1,
    Math.min(
      MAX_HORIZON_HOURS,
      Math.ceil((deadline.getTime() - now.getTime()) / (60 * 60 * 1000)),
    ),
  );
  const forecast = await feed.fetchForecast(opts.region, horizonH);
  const entries = forecast.entries;
  if (entries.length === 0) {
    // Defensive: a real feed should never return an empty forecast for an
    // in-future deadline, but we don't want to crash if it does.
    throw new Error("recommendWindow: forecast returned no entries");
  }

  const budgetG = opts.carbonBudgetG;
  // Filter by deadline first (cheapest entry after the deadline is useless),
  // then by budget.
  const inDeadline = entries.filter((e) => {
    const t = new Date(e.datetime).getTime();
    return t >= now.getTime() && t <= deadline.getTime();
  });
  if (inDeadline.length === 0) {
    // No entry between "now" and the deadline. The Scheduler dispatches
    // immediately in this case; the recommender treats it as the same — fall
    // back to entry[0] as the "best we can do".
    const head = entries[0]!;
    return buildResultFromSingle(head, entries, deadline, opts, now, /* survivors */ 1);
  }

  const survivors =
    budgetG !== undefined
      ? inDeadline.filter(
          (e) => intensityToGrams(e.carbonIntensityGCo2PerKwh) <= budgetG,
        )
      : inDeadline;

  if (survivors.length === 0) {
    // All in-deadline windows exceed the budget. Report the cheapest one so
    // the caller knows the floor before relaxing the budget.
    const cheapest = inDeadline.reduce((a, b) =>
      a.carbonIntensityGCo2PerKwh <= b.carbonIntensityGCo2PerKwh ? a : b,
    );
    throw new CarbonBudgetExceededError(
      intensityToGrams(cheapest.carbonIntensityGCo2PerKwh),
      budgetG!,
    );
  }

  // Sort ascending by intensity — chosen = [0], alternatives = next 3.
  const sorted = [...survivors].sort(
    (a, b) => a.carbonIntensityGCo2PerKwh - b.carbonIntensityGCo2PerKwh,
  );
  const chosen = sorted[0]!;
  const altEntries = sorted.slice(1, 4);

  const nowIntensity = entries[0]!.carbonIntensityGCo2PerKwh;
  const savingsPct = computeSavingsPct(
    nowIntensity,
    chosen.carbonIntensityGCo2PerKwh,
  );
  const chosenGrams = roundTenth(
    intensityToGrams(chosen.carbonIntensityGCo2PerKwh),
  );

  const batchEligible = isBatchEligible(now, deadline);

  const alternatives: RecommendAlternative[] = altEntries.map((e) => ({
    scheduledFor: e.datetime,
    intensityGCo2PerKwh: e.carbonIntensityGCo2PerKwh,
    band: e.band,
    estimatedCarbonGCo2: roundTenth(
      intensityToGrams(e.carbonIntensityGCo2PerKwh),
    ),
    estimatedSavingsVsNowPct: computeSavingsPct(
      nowIntensity,
      e.carbonIntensityGCo2PerKwh,
    ),
  }));

  return {
    scheduledFor: chosen.datetime,
    intensityGCo2PerKwh: chosen.carbonIntensityGCo2PerKwh,
    band: chosen.band,
    estimatedCarbonGCo2: chosenGrams,
    estimatedSavingsVsNowPct: savingsPct,
    batchEligible,
    alternatives,
    reasoning: buildReasoning({
      chosen,
      savingsPct,
      batchEligible,
      budgetG,
      survivorCount: survivors.length,
    }),
  };
}

// --------------------------------------------------------------------------- //
// Helpers

function buildResultFromSingle(
  head: GridForecastEntry,
  _entries: GridForecastEntry[],
  _deadline: Date,
  _opts: RecommendOptions,
  _now: Date,
  _survivorCount: number,
): RecommendResult {
  const grams = roundTenth(intensityToGrams(head.carbonIntensityGCo2PerKwh));
  return {
    scheduledFor: head.datetime,
    intensityGCo2PerKwh: head.carbonIntensityGCo2PerKwh,
    band: head.band,
    estimatedCarbonGCo2: grams,
    estimatedSavingsVsNowPct: 0,
    batchEligible: false,
    alternatives: [],
    reasoning:
      `no in-deadline windows; best available is ${formatHour(head.datetime)} UTC`,
  };
}

function isBatchEligible(now: Date, deadline: Date): boolean {
  const hoursOut = (deadline.getTime() - now.getTime()) / (60 * 60 * 1000);
  return hoursOut > BATCH_ELIGIBLE_HOURS;
}

function buildReasoning(args: {
  chosen: GridForecastEntry;
  savingsPct: number;
  batchEligible: boolean;
  budgetG: number | undefined;
  survivorCount: number;
}): string {
  const { chosen, savingsPct, batchEligible, budgetG, survivorCount } = args;
  const hour = formatHour(chosen.datetime);
  let base: string;
  if (budgetG !== undefined && survivorCount === 1) {
    base = `only one window meets the carbon budget of ${budgetG}g; falls at ${hour} UTC`;
  } else if (savingsPct > 30) {
    base = `cleanest in-deadline window is ${hour} UTC (${chosen.band.replace("_", " ")} mix); ~${savingsPct}% cleaner than dispatching now`;
  } else {
    base = `cleanest in-deadline window is ${hour} UTC`;
  }
  if (batchEligible) {
    return `${base}; Batch API saves an additional 50% on cost (24h SLA)`;
  }
  return base;
}

function formatHour(iso: string): string {
  // Match the spec's "HH:MM" formatting — strip the date and seconds.
  return iso.slice(11, 16);
}

function computeSavingsPct(nowIntensity: number, chosenIntensity: number): number {
  if (nowIntensity <= 0) return 0;
  const raw = (1 - chosenIntensity / nowIntensity) * 100;
  // Round to a non-negative integer. If the chosen window is *dirtier* than
  // "now" (rare, e.g. budget filter forced a weird tie), report 0 rather than
  // a negative number — the agent's mental model is "savings, vs the worst
  // case of running now".
  return Math.max(0, Math.round(raw));
}

function intensityToGrams(gCo2PerKwh: number): number {
  return ENERGY_KWH_PER_TASK * gCo2PerKwh;
}

function roundTenth(v: number): number {
  return Math.round(v * 10) / 10;
}

function normalizeDeadline(
  d: RecommendOptions["deadline"],
  nowFn?: () => Date,
): Date {
  if (d === undefined || d === null) {
    throw new InvalidDeadlineError(d);
  }
  const parsed = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(parsed.getTime())) {
    throw new InvalidDeadlineError(d);
  }
  const now = (nowFn ?? (() => new Date()))().getTime();
  if (parsed.getTime() < now - 5_000) {
    throw new InvalidDeadlineError(d);
  }
  return parsed;
}
