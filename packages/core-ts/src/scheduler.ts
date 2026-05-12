/**
 * Scheduler — the in-process orchestrator for ebb-ai.
 *
 * Responsibilities (v0.1):
 *   - Hold a queue of deferrable tasks.
 *   - Score candidate execution windows for each task using a grid feed.
 *   - Sleep until the chosen window, then dispatch the task.
 *   - Record a carbon receipt on the resulting TaskRecord.
 *
 * Out of scope for v0.1 (see PLAN.md sections 7 and 9):
 *   - Durable persistence (everything is in-memory).
 *   - Cross-provider routing.
 *   - Anthropic / OpenAI Batch API integration.
 *   - Multi-region failover.
 */

import { randomUUID } from "node:crypto";
import { mockGridFeed } from "./grid.js";
import type {
  CarbonReceipt,
  DeferOptions,
  DeferrableTask,
  GridFeed,
  GridForecastEntry,
  TaskRecord,
} from "./types.js";

const DEFAULT_REGION = "US-CAL-CISO";
const MAX_HORIZON_HOURS = 72;
/**
 * Rough estimate: a single moderate LLM call consumes around 0.001 kWh of
 * data-center energy. With a typical PUE of 1.5 we use 0.0015 kWh end-to-end.
 * This is a placeholder; the v0.2 receipt should learn per-model coefficients
 * from published research (Patterson et al. 2021, Luccioni et al. 2023).
 */
const ENERGY_KWH_PER_TASK = 0.0015;

/** Thrown when no candidate window meets the user-supplied carbon budget. */
export class CarbonBudgetExceededError extends Error {
  constructor(public readonly minimumGCo2: number, public readonly budgetGCo2: number) {
    super(
      `No window inside the deadline keeps the task under ${budgetGCo2.toFixed(1)} gCO2e. ` +
        `Cheapest reachable window costs ${minimumGCo2.toFixed(1)} gCO2e.`,
    );
    this.name = "CarbonBudgetExceededError";
  }
}

/** Thrown when the supplied deadline cannot be parsed or is already in the past. */
export class InvalidDeadlineError extends Error {
  constructor(public readonly received: unknown) {
    super(`Invalid deadline: expected an ISO-8601 timestamp in the future, received ${JSON.stringify(received)}`);
    this.name = "InvalidDeadlineError";
  }
}

export interface SchedulerOptions {
  feed?: GridFeed;
  /** Default region to use when DeferOptions does not name one. */
  defaultRegion?: string;
  /** If true (default), background loop ticks immediately on `defer`. */
  eager?: boolean;
}

export class Scheduler {
  private readonly feed: GridFeed;
  private readonly defaultRegion: string;
  private readonly tasks = new Map<string, TaskRecord<unknown>>();
  private readonly pendingTimers = new Map<string, NodeJS.Timeout>();
  private readonly resolvers = new Map<
    string,
    { resolve: (v: unknown) => void; reject: (e: unknown) => void }
  >();
  private readonly bodies = new Map<string, DeferrableTask<unknown>>();
  private nextSerial = 1;

  constructor(opts: SchedulerOptions = {}) {
    this.feed = opts.feed ?? mockGridFeed();
    this.defaultRegion = opts.defaultRegion ?? DEFAULT_REGION;
  }

  /**
   * Defer a task. Returns a promise that resolves with the task's eventual
   * result when ebb-ai dispatches it.
   *
   * For testing / synchronous workflows, see `enqueue` + `tick` + `flush`.
   */
  async defer<T>(task: DeferrableTask<T>, opts: DeferOptions = {}): Promise<T> {
    const record = this.enqueue(task, opts);
    return new Promise<T>((resolve, reject) => {
      this.resolvers.set(record.taskId, {
        resolve: resolve as (v: unknown) => void,
        reject,
      });
    });
  }

  /**
   * Enqueue a task without awaiting it. Returns the TaskRecord immediately
   * with status "queued". Mostly used by the MCP server, which returns the
   * task_id to the caller and lets them poll.
   */
  enqueue<T>(task: DeferrableTask<T>, opts: DeferOptions = {}): TaskRecord<T> {
    const deadline = normalizeDeadline(opts.deadline);
    if (opts.taskId !== undefined) {
      if (typeof opts.taskId !== "string" || opts.taskId.length === 0) {
        throw new Error(`Invalid taskId: must be a non-empty string`);
      }
      if (this.tasks.has(opts.taskId)) {
        throw new Error(`Task id "${opts.taskId}" is already in the queue`);
      }
    }
    const taskId = opts.taskId ?? `t-${randomUUID()}`;
    const region = opts.region ?? this.defaultRegion;
    const record: TaskRecord<T> = {
      taskId,
      status: "queued",
      enqueuedAt: new Date().toISOString(),
      region,
      carbonBudgetG: opts.carbonBudgetG,
    };
    this.tasks.set(taskId, record);
    this.bodies.set(taskId, task as DeferrableTask<unknown>);
    void this.schedule(taskId, deadline);
    return record;
  }

  /** Snapshot the current state of one task. */
  getTask<T>(taskId: string): TaskRecord<T> | undefined {
    return this.tasks.get(taskId) as TaskRecord<T> | undefined;
  }

  /** Snapshot the queue (immutable copy). */
  listTasks(): ReadonlyArray<TaskRecord<unknown>> {
    return Array.from(this.tasks.values());
  }

  /** Cancel and clean up timers. Mostly for tests. */
  shutdown(): void {
    for (const timer of this.pendingTimers.values()) {
      clearTimeout(timer);
    }
    this.pendingTimers.clear();
  }

  private async schedule(taskId: string, deadline: Date): Promise<void> {
    const record = this.tasks.get(taskId);
    if (!record) return;
    const horizonH = Math.max(
      1,
      Math.min(
        MAX_HORIZON_HOURS,
        Math.ceil((deadline.getTime() - Date.now()) / (60 * 60 * 1000)),
      ),
    );
    const forecast = await this.feed.fetchForecast(record.region, horizonH);
    // Optional carbon-budget filter. If a budget is set, drop entries whose
    // estimated grams exceed it; if zero usable windows remain, fail rather
    // than dispatch into a dirty hour.
    const budgetG = record.carbonBudgetG;
    const survivors =
      budgetG !== undefined
        ? forecast.entries.filter((e) => intensityToGrams(e.carbonIntensityGCo2PerKwh) <= budgetG)
        : forecast.entries;
    const candidate = pickBestWindow(survivors, deadline);
    if (!candidate) {
      if (budgetG !== undefined && forecast.entries.length > 0) {
        const cheapest = forecast.entries.reduce((a, b) =>
          a.carbonIntensityGCo2PerKwh <= b.carbonIntensityGCo2PerKwh ? a : b,
        );
        const cheapestG = intensityToGrams(cheapest.carbonIntensityGCo2PerKwh);
        if (cheapestG > budgetG) {
          this.failTask(taskId, new CarbonBudgetExceededError(cheapestG, budgetG));
          return;
        }
      }
      // No usable window inside the deadline — dispatch immediately rather
      // than miss the deadline.
      void this.dispatch(taskId, new Date(), undefined);
      return;
    }
    record.status = "scheduled";
    record.scheduledFor = candidate.datetime;
    const wait = Math.max(0, new Date(candidate.datetime).getTime() - Date.now());
    // Node's setTimeout overflows the signed-32-bit ms range (~24.85 days).
    // Cap to one day before the actual fire time and re-schedule.
    const safeWait = Math.min(wait, 2_000_000_000);
    const timer = setTimeout(() => {
      this.pendingTimers.delete(taskId);
      if (safeWait < wait) {
        void this.schedule(taskId, deadline);
      } else {
        void this.dispatch(taskId, new Date(candidate.datetime), candidate);
      }
    }, safeWait);
    this.pendingTimers.set(taskId, timer);
  }

  private failTask(taskId: string, err: Error): void {
    const record = this.tasks.get(taskId);
    if (!record) return;
    record.status = "failed";
    record.completedAt = new Date().toISOString();
    record.error = err.message;
    const resolver = this.resolvers.get(taskId);
    resolver?.reject(err);
    this.bodies.delete(taskId);
    this.resolvers.delete(taskId);
  }

  private async dispatch(
    taskId: string,
    ranAt: Date,
    forecastEntry: GridForecastEntry | undefined,
  ): Promise<void> {
    const record = this.tasks.get(taskId);
    const body = this.bodies.get(taskId);
    const resolver = this.resolvers.get(taskId);
    if (!record || !body) return;
    record.status = "running";
    const start = Date.now();
    try {
      const result = await body();
      const durationMs = Date.now() - start;
      // Prefer the forecast entry the scheduler scored against. If we
      // dispatched without a forecast (immediate fallback), look up the
      // current hour from the feed once.
      let intensityG: number;
      let source: "scored" | "current" = "scored";
      if (forecastEntry) {
        intensityG = forecastEntry.carbonIntensityGCo2PerKwh;
      } else {
        intensityG = await this.fetchCurrentIntensity(record.region, ranAt);
        source = "current";
      }
      const receipt: CarbonReceipt = {
        taskId,
        ranAt: ranAt.toISOString(),
        region: record.region,
        estimatedCarbonGCo2: Math.round(intensityToGrams(intensityG) * 10) / 10,
        durationMs,
      };
      record.status = "completed";
      record.completedAt = new Date().toISOString();
      record.result = result;
      record.receipt = receipt;
      record.intensitySource = source;
      resolver?.resolve(result);
    } catch (err) {
      record.status = "failed";
      record.completedAt = new Date().toISOString();
      record.error = err instanceof Error ? err.message : String(err);
      resolver?.reject(err);
    } finally {
      this.bodies.delete(taskId);
      this.resolvers.delete(taskId);
    }
  }

  private async fetchCurrentIntensity(region: string, at: Date): Promise<number> {
    const forecast = await this.feed.fetchForecast(region, 24);
    const target = at.getTime();
    let best: GridForecastEntry | undefined;
    let bestDelta = Infinity;
    for (const entry of forecast.entries) {
      const d = Math.abs(new Date(entry.datetime).getTime() - target);
      if (d < bestDelta) {
        best = entry;
        bestDelta = d;
      }
    }
    return best?.carbonIntensityGCo2PerKwh ?? 400;
  }
}

function intensityToGrams(gCo2PerKwh: number): number {
  return ENERGY_KWH_PER_TASK * gCo2PerKwh;
}

/**
 * Convenience: a process-wide scheduler accessed via the top-level
 * `defer()` function. Most users want this; advanced users construct
 * their own `new Scheduler({ ... })`.
 */
let _default: Scheduler | undefined;
function getDefault(): Scheduler {
  _default ??= new Scheduler();
  return _default;
}

export async function defer<T>(
  task: DeferrableTask<T>,
  opts: DeferOptions = {},
): Promise<T> {
  return getDefault().defer(task, opts);
}

function normalizeDeadline(d: DeferOptions["deadline"]): Date {
  if (d === undefined || d === null) {
    return new Date(Date.now() + 24 * 60 * 60 * 1000);
  }
  const parsed = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(parsed.getTime())) {
    throw new InvalidDeadlineError(d);
  }
  // A deadline in the past is meaningless. Allow a small clock-skew tolerance
  // (5 seconds) so a deadline set "now" by the caller doesn't fail.
  if (parsed.getTime() < Date.now() - 5_000) {
    throw new InvalidDeadlineError(d);
  }
  return parsed;
}

export function pickBestWindow(
  entries: GridForecastEntry[],
  deadline: Date,
): GridForecastEntry | undefined {
  const now = Date.now();
  const usable = entries.filter((e) => {
    const t = new Date(e.datetime).getTime();
    return t >= now && t <= deadline.getTime();
  });
  if (usable.length === 0) return undefined;
  let best = usable[0]!;
  for (const e of usable) {
    if (e.carbonIntensityGCo2PerKwh < best.carbonIntensityGCo2PerKwh) {
      best = e;
    }
  }
  return best;
}
