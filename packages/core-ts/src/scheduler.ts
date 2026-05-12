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
const DEFAULT_HORIZON_HOURS = 24;
/**
 * Rough estimate: a single moderate LLM call consumes around 0.001 kWh of
 * data-center energy. With a typical PUE of 1.5 we use 0.0015 kWh end-to-end.
 * This is a placeholder; the v0.2 receipt should learn per-model coefficients
 * from published research (Patterson et al. 2021, Luccioni et al. 2023).
 */
const ENERGY_KWH_PER_TASK = 0.0015;

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
    const taskId = opts.taskId ?? `t-${this.nextSerial++}`;
    const region = opts.region ?? this.defaultRegion;
    const deadline = normalizeDeadline(opts.deadline);
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
        DEFAULT_HORIZON_HOURS,
        Math.ceil((deadline.getTime() - Date.now()) / (60 * 60 * 1000)),
      ),
    );
    const forecast = await this.feed.fetchForecast(record.region, horizonH);
    const candidate = pickBestWindow(forecast.entries, deadline);
    if (!candidate) {
      // No usable window — dispatch immediately rather than miss the deadline.
      void this.dispatch(taskId, new Date());
      return;
    }
    record.status = "scheduled";
    record.scheduledFor = candidate.datetime;
    const wait = Math.max(0, new Date(candidate.datetime).getTime() - Date.now());
    const timer = setTimeout(() => {
      this.pendingTimers.delete(taskId);
      void this.dispatch(taskId, new Date(candidate.datetime));
    }, wait);
    this.pendingTimers.set(taskId, timer);
  }

  private async dispatch(taskId: string, ranAt: Date): Promise<void> {
    const record = this.tasks.get(taskId);
    const body = this.bodies.get(taskId);
    const resolver = this.resolvers.get(taskId);
    if (!record || !body) return;
    record.status = "running";
    const start = Date.now();
    try {
      const result = await body();
      const durationMs = Date.now() - start;
      const intensityG = await this.estimateIntensity(record.region, ranAt);
      const receipt: CarbonReceipt = {
        taskId,
        ranAt: ranAt.toISOString(),
        region: record.region,
        estimatedCarbonGCo2: Math.round(ENERGY_KWH_PER_TASK * intensityG * 10) / 10,
        durationMs,
      };
      record.status = "completed";
      record.completedAt = new Date().toISOString();
      record.result = result;
      record.receipt = receipt;
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

  private async estimateIntensity(region: string, at: Date): Promise<number> {
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
  if (!d) return new Date(Date.now() + 24 * 60 * 60 * 1000);
  if (d instanceof Date) return d;
  return new Date(d);
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
