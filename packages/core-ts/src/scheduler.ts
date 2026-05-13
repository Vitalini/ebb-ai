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
import type { ProviderAdapter } from "./providers/base.js";
import { TaskStore } from "./storage/sqlite.js";
import type {
  CarbonReceipt,
  DeferOptions,
  DeferrableTask,
  GridFeed,
  GridForecastEntry,
  ProviderCallSpec,
  TaskRecord,
  TickResult,
  TickResultEntry,
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
  /**
   * Absolute path to a SQLite file for durable persistence. When set,
   * every state transition writes through to the on-disk audit ledger
   * and persisted records can be reloaded after restart via
   * `Scheduler.listPersistedTasks()` / `Scheduler.loadPersistedTask()`.
   * Omit for v0.1-style in-memory operation.
   */
  dbPath?: string;
  /** Inject a pre-built TaskStore. Mostly for tests. */
  store?: TaskStore;
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
  private readonly store: TaskStore | undefined;
  private nextSerial = 1;

  constructor(opts: SchedulerOptions = {}) {
    this.feed = opts.feed ?? mockGridFeed();
    this.defaultRegion = opts.defaultRegion ?? DEFAULT_REGION;
    if (opts.store) {
      this.store = opts.store;
    } else if (opts.dbPath) {
      this.store = new TaskStore({ dbPath: opts.dbPath });
    }
  }

  /** Reload a previously-persisted task by id. */
  loadPersistedTask<T>(taskId: string): TaskRecord<T> | undefined {
    return this.store?.get(taskId) as TaskRecord<T> | undefined;
  }

  /** Snapshot every task ever persisted (queued, running, completed, failed). */
  listPersistedTasks(): TaskRecord<unknown>[] {
    return this.store?.list() ?? [];
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
    this.store?.upsert(record);
    void this.schedule(taskId, deadline);
    return record;
  }

  /**
   * Enqueue a persistent provider-call task. The body is JSON-serialized
   * into the SQLite ledger, so the task survives the enqueuing process
   * exiting — `Scheduler.tick(adapters)`, typically invoked from
   * `ebb tick` on a cron, can rehydrate the spec and dispatch it.
   *
   * Unlike `enqueue`, no in-process closure is registered; the scheduler
   * does NOT call `dispatch` for these tasks at the chosen window. They
   * are exclusively driven by `tick` so that any process (this one, or a
   * later cron-tick) can pick them up.
   */
  async enqueueProviderCall(
    spec: ProviderCallSpec,
    opts: DeferOptions = {},
  ): Promise<TaskRecord<unknown>> {
    if (spec.type !== "provider_call") {
      throw new Error(
        `enqueueProviderCall: spec.type must be "provider_call", got ${JSON.stringify((spec as { type?: unknown }).type)}`,
      );
    }
    if (spec.provider !== "anthropic" && spec.provider !== "openai") {
      throw new Error(
        `enqueueProviderCall: unsupported provider ${JSON.stringify(spec.provider)}`,
      );
    }
    if (typeof spec.model !== "string" || spec.model.length === 0) {
      throw new Error("enqueueProviderCall: spec.model must be a non-empty string");
    }
    if (typeof spec.prompt !== "string" || spec.prompt.length === 0) {
      throw new Error("enqueueProviderCall: spec.prompt must be a non-empty string");
    }
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
    const record: TaskRecord<unknown> = {
      taskId,
      status: "queued",
      enqueuedAt: new Date().toISOString(),
      region,
      carbonBudgetG: opts.carbonBudgetG,
      bodyJson: JSON.stringify(spec),
    };
    this.tasks.set(taskId, record);
    this.store?.upsert(record);
    // Schedule a carbon window but DO NOT register an in-process timer that
    // calls `dispatch` — provider-call tasks are driven exclusively by
    // `Scheduler.tick`. We still write `scheduled` + `scheduledFor` so the
    // ledger reflects the chosen window and so `tick` can compare against
    // `Date.now()`.
    await this.scheduleProviderCall(taskId, deadline);
    return record;
  }

  /**
   * Drain due provider-call tasks against the supplied adapters. Returns a
   * `TickResult` summarising what happened. Closure-based tasks
   * (`enqueue` / `defer`) are NOT touched by this method — only this
   * process can run those.
   */
  async tick(adapters: {
    anthropic?: ProviderAdapter;
    openai?: ProviderAdapter;
  }): Promise<TickResult> {
    const now = Date.now();
    // Source-of-truth is the in-memory map for this process, plus any
    // persisted records (e.g. when a v0.4 `ebb tick` opens the SQLite file).
    const seen = new Set<string>();
    const candidates: TaskRecord<unknown>[] = [];
    for (const record of this.tasks.values()) {
      if (record.status !== "scheduled") continue;
      if (!record.bodyJson) continue;
      if (!record.scheduledFor) continue;
      if (new Date(record.scheduledFor).getTime() > now) continue;
      candidates.push(record);
      seen.add(record.taskId);
    }
    if (this.store) {
      for (const record of this.store.list({ status: "scheduled" })) {
        if (seen.has(record.taskId)) continue;
        if (!record.bodyJson) continue;
        if (!record.scheduledFor) continue;
        if (new Date(record.scheduledFor).getTime() > now) continue;
        // Hydrate into the in-memory map so subsequent state writes stay
        // consistent with the rest of the scheduler.
        this.tasks.set(record.taskId, record);
        candidates.push(record);
      }
    }

    const results: TickResultEntry[] = [];
    let dispatched = 0;
    let failed = 0;
    for (const record of candidates) {
      const entry = await this.dispatchProviderCall(record, adapters);
      results.push(entry);
      if (entry.status === "completed") dispatched++;
      else failed++;
    }
    return {
      inspected: candidates.length,
      dispatched,
      failed,
      results,
    };
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
    this.store?.close();
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
    this.store?.upsert(record);
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
    this.store?.upsert(record);
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
    this.store?.upsert(record);
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
      this.store?.upsert(record);
      resolver?.resolve(result);
    } catch (err) {
      record.status = "failed";
      record.completedAt = new Date().toISOString();
      record.error = err instanceof Error ? err.message : String(err);
      this.store?.upsert(record);
      resolver?.reject(err);
    } finally {
      this.bodies.delete(taskId);
      this.resolvers.delete(taskId);
    }
  }

  private async scheduleProviderCall(taskId: string, deadline: Date): Promise<void> {
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
      // No usable window — schedule for `now` so the very next `tick` runs
      // the task immediately rather than miss the deadline.
      record.status = "scheduled";
      record.scheduledFor = new Date().toISOString();
      this.store?.upsert(record);
      return;
    }
    record.status = "scheduled";
    record.scheduledFor = candidate.datetime;
    this.store?.upsert(record);
  }

  private async dispatchProviderCall(
    record: TaskRecord<unknown>,
    adapters: { anthropic?: ProviderAdapter; openai?: ProviderAdapter },
  ): Promise<TickResultEntry> {
    let spec: ProviderCallSpec;
    try {
      spec = JSON.parse(record.bodyJson ?? "null") as ProviderCallSpec;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.failTask(record.taskId, new Error(`tick: corrupt body_json: ${msg}`));
      return { taskId: record.taskId, status: "failed", error: msg };
    }
    if (!spec || spec.type !== "provider_call") {
      const msg = `tick: body is not a provider_call spec`;
      this.failTask(record.taskId, new Error(msg));
      return { taskId: record.taskId, status: "failed", error: msg };
    }
    const adapter = adapters[spec.provider];
    if (!adapter) {
      const msg = `tick: no adapter configured for provider ${spec.provider}`;
      this.failTask(record.taskId, new Error(msg));
      return { taskId: record.taskId, status: "failed", error: msg };
    }

    record.status = "running";
    this.store?.upsert(record);
    const start = Date.now();
    const ranAt = new Date();
    try {
      const preferBatch = spec.preferBatch !== false;
      // We compare the task's scheduled_for to a 24h-from-now boundary to
      // decide whether the Batch API is still worth it. (The deadline itself
      // is not on the record after enqueuing — `scheduled_for` is the proxy.)
      const scheduledForTs = record.scheduledFor
        ? new Date(record.scheduledFor).getTime()
        : Date.now();
      const moreThan24h = scheduledForTs - Date.now() > 24 * 60 * 60 * 1000;
      const useBatch = preferBatch && moreThan24h && typeof adapter.dispatchBatch === "function";
      const result = useBatch
        ? await adapter.dispatchBatch(spec.model, [spec.prompt], {
            temperature: spec.temperature,
            maxTokens: spec.maxTokens,
            system: spec.systemPrompt,
          })
        : await adapter.dispatch(spec.model, spec.prompt, {
            temperature: spec.temperature,
            maxTokens: spec.maxTokens,
            system: spec.systemPrompt,
          });
      const durationMs = Date.now() - start;
      const intensityG = await this.intensityForReceipt(record.region, ranAt);
      const source: "scored" | "current" = "scored";
      const receipt: CarbonReceipt = {
        taskId: record.taskId,
        ranAt: ranAt.toISOString(),
        region: record.region,
        estimatedCarbonGCo2: Math.round(intensityToGrams(intensityG) * 10) / 10,
        provider: spec.provider,
        model: spec.model,
        durationMs,
      };
      record.status = "completed";
      record.completedAt = new Date().toISOString();
      record.result = result;
      record.receipt = receipt;
      record.intensitySource = source;
      this.store?.upsert(record);
      return { taskId: record.taskId, status: "completed" };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      record.status = "failed";
      record.completedAt = new Date().toISOString();
      record.error = msg;
      this.store?.upsert(record);
      return { taskId: record.taskId, status: "failed", error: msg };
    }
  }

  /**
   * Look up an intensity figure for the receipt. We re-fetch the forecast
   * and pick the entry that best aligns with the task's `scheduled_for`
   * (or the moment we ran, if there is no scheduled_for).
   */
  private async intensityForReceipt(region: string, at: Date): Promise<number> {
    return this.fetchCurrentIntensity(region, at);
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
