/**
 * selectWindow — the single carbon-window selection policy, shared by the
 * planning path (`recommendWindow`) and every committing scheduler path
 * (`schedule`, `scheduleProviderCall`, `previewProviderCall`).
 *
 * Why one function: the randomized cleanest-tolerance-band tie-break used
 * to live only in `recommendWindow`. The scheduler's committing paths used
 * the strict-minimum `pickBestWindow`, so every task in a region still
 * landed on the identical trough hour — the even-distribution guarantee
 * the product cites only covered the non-committing recommend path. Routing
 * all four callers through this function closes that gap: committed tasks
 * spread across the cleanest band too (§2.1).
 *
 * Policy:
 *   1. In-deadline filter INCLUDING the current hour (>= now − 1h, matching
 *      the §1.7 fix): forecast entries mark the *start* of an hour, so the
 *      entry covering "now" started up to an hour ago and is still a valid
 *      run-right-now candidate.
 *   2. Tolerance band: every entry within `max(cheapest * 0.15, 30 g)` of
 *      the cheapest survivor is treated as "equally clean".
 *   3. Random pick within the band (injectable rng); a single-entry band
 *      returns the strict minimum.
 *
 * The band+rng logic is identical to the pre-existing recommend tie-break.
 * Budget filtering is the caller's responsibility — this function only
 * ranks the entries it is handed, so budget survivors are passed in.
 */

import type { GridForecastEntry } from "./types.js";

/** Tolerance band floor, in gCO2e/kWh. See recommend.ts for the rationale. */
export const TOLERANCE_FLOOR_G = 30;
/** Tolerance band as a fraction of the cheapest survivor's intensity. */
export const TOLERANCE_FRACTION = 0.15;

export interface SelectWindowOptions {
  /** Inject a clock (mostly for tests). Defaults to `Date.now`. */
  now?: () => Date;
  /**
   * Inject a pseudo-random number generator returning [0, 1). Defaults to
   * `Math.random`. A seeded PRNG makes the tie-break deterministic in
   * tests. Only affects the choice among entries within the
   * cleanest-tolerance band when multiple equally-clean entries exist.
   */
  rng?: () => number;
}

export interface SelectWindowResult {
  /** The chosen entry — a random pick from the cleanest-tolerance band. */
  chosen: GridForecastEntry;
  /** Every in-deadline survivor, sorted ascending by intensity. */
  sorted: GridForecastEntry[];
  /** The subset of `sorted` that falls inside the tolerance band. */
  band: GridForecastEntry[];
  /** The tolerance width actually applied (gCO2e/kWh). */
  tolerance: number;
}

/**
 * Filter `entries` to the ones inside `[now − 1h, deadline]`.
 *
 * Exported so callers (and tests) can share the exact in-deadline
 * semantics without re-deriving the ±1h current-hour rule.
 */
export function inDeadlineEntries(
  entries: GridForecastEntry[],
  deadline: Date,
  now: Date,
): GridForecastEntry[] {
  const lo = now.getTime() - 3_600_000;
  const hi = deadline.getTime();
  return entries.filter((e) => {
    const t = new Date(e.datetime).getTime();
    return t >= lo && t <= hi;
  });
}

/**
 * Select a window from `entries`, applying the shared in-deadline filter
 * and the randomized cleanest-tolerance-band tie-break.
 *
 * Returns `undefined` when no entry falls inside the deadline. Callers that
 * only want the chosen entry can read `.chosen`; the recommend path also
 * uses `.sorted` (for alternatives) and `.band` (for reasoning).
 *
 * Budget filtering is NOT performed here — pass budget survivors in.
 */
export function selectWindow(
  entries: GridForecastEntry[],
  deadline: Date,
  opts: SelectWindowOptions = {},
): SelectWindowResult | undefined {
  const now = (opts.now ?? (() => new Date()))();
  const usable = inDeadlineEntries(entries, deadline, now);
  if (usable.length === 0) return undefined;

  const sorted = [...usable].sort(
    (a, b) => a.carbonIntensityGCo2PerKwh - b.carbonIntensityGCo2PerKwh,
  );
  const cheapest = sorted[0]!.carbonIntensityGCo2PerKwh;
  const tolerance = Math.max(cheapest * TOLERANCE_FRACTION, TOLERANCE_FLOOR_G);
  const band = sorted.filter(
    (e) => e.carbonIntensityGCo2PerKwh <= cheapest + tolerance,
  );
  const rng = opts.rng ?? Math.random;
  const chosen =
    band.length > 1 ? band[Math.floor(rng() * band.length)]! : sorted[0]!;

  return { chosen, sorted, band, tolerance };
}
