/**
 * Scheduler — the in-process orchestrator for ebb-ai.
 *
 * Responsibilities (v0.1):
 *   - Hold a queue of deferrable tasks.
 *   - Score candidate execution windows for each task using a grid feed.
 *   - Sleep until the chosen window, then dispatch the task.
 *   - Record a carbon receipt on the resulting TaskRecord.
 *
 * Out of scope for v0.1 (see ROADMAP.md sections 7 and 9):
 *   - Durable persistence (everything is in-memory).
 *   - Cross-provider routing.
 *   - Anthropic / OpenAI Batch API integration.
 *   - Multi-region failover.
 */

import { randomUUID } from "node:crypto";
import { gramsForIntensity } from "./energy.js";
import { mockGridFeed } from "./grid.js";
import type { ProviderAdapter } from "./providers/base.js";
import {
  loadOrCreateSigningKey,
  signReceipt,
  type SigningKeyPair,
} from "./sign.js";
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
  /**
   * Ed25519 receipt-signing configuration. By default the scheduler
   * signs every receipt with a per-installation keypair at
   * `~/.ebb-ai/signing.key` (lazily created on first dispatch). Pass:
   *   - `false` to disable signing entirely (receipts shipped without
   *     signature/signerPublicKey/signedAt fields — back to v0.10 shape).
   *   - `{ keyPath: "..." }` to override the keypair location (mostly
   *     for tests so each scheduler instance gets a fresh key).
   *
   * v0.11+.
   */
  signing?: false | { keyPath?: string };
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
  // Mutable: a single load failure disables signing for the rest of
  // this scheduler instance (see `getSigningKey`).
  private signingConfig: false | { keyPath?: string };
  private signingKey: SigningKeyPair | undefined;

  constructor(opts: SchedulerOptions = {}) {
    this.feed = opts.feed ?? mockGridFeed();
    this.defaultRegion = opts.defaultRegion ?? DEFAULT_REGION;
    if (opts.store) {
      this.store = opts.store;
    } else if (opts.dbPath) {
      this.store = new TaskStore({ dbPath: opts.dbPath });
    }
    this.signingConfig = opts.signing ?? {};
  }

  /**
   * Lazy-load the signing keypair the first time a receipt needs to be
   * signed. Returns undefined when signing is disabled or a fatal error
   * is encountered while loading; the scheduler then drops back to v0.10
   * unsigned receipts rather than failing the dispatch.
   */
  private getSigningKey(): SigningKeyPair | undefined {
    if (this.signingConfig === false) return undefined;
    if (this.signingKey) return this.signingKey;
    try {
      this.signingKey = loadOrCreateSigningKey({
        privateKeyPath: this.signingConfig.keyPath,
      });
      return this.signingKey;
    } catch (err) {
      // The receipt remains valid — it just goes out unsigned. Log to
      // stderr once so operators notice without crashing dispatch.
      // eslint-disable-next-line no-console
      console.warn(
        `[ebb-ai/scheduler] failed to load signing key, receipts will go out unsigned: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      this.signingConfig = false;
      return undefined;
    }
  }

  /** Sign a receipt if signing is enabled; otherwise return it unchanged. */
  private maybeSign(receipt: CarbonReceipt): CarbonReceipt {
    const key = this.getSigningKey();
    if (!key) return receipt;
    return signReceipt(receipt, key);
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
    let inspected = 0;
    for (const record of candidates) {
      // Row-level claim: only one tick gets to dispatch this task. If
      // the store is configured, the claim is also visible to other
      // processes pointing at the same SQLite file (e.g. an
      // interactive `ebb tick` racing the launchd cron).
      if (this.store) {
        const claimed = this.store.claimScheduled(record.taskId);
        if (!claimed) continue;
      }
      inspected++;
      const entry = await this.dispatchProviderCall(record, adapters);
      results.push(entry);
      if (entry.status === "completed") dispatched++;
      else failed++;
    }
    return {
      inspected,
      dispatched,
      failed,
      results,
    };
  }

  /**
   * Look up a task by id. Returns the in-process record if present;
   * otherwise hydrates it from the durable store, so cancel / update /
   * retry / dispatch keep working after the enqueuing process has exited
   * (e.g. an OpenClaw gateway restart). The store is the source of truth
   * for persisted tasks — `this.tasks` is a write-through cache, not the
   * sole index.
   */
  private resolveTask(taskId: string): TaskRecord<unknown> | undefined {
    const inMemory = this.tasks.get(taskId);
    if (inMemory) return inMemory;
    const persisted = this.store?.get(taskId);
    if (persisted) {
      this.tasks.set(taskId, persisted);
      return persisted;
    }
    return undefined;
  }

  /** Snapshot the current state of one task. */
  getTask<T>(taskId: string): TaskRecord<T> | undefined {
    return this.resolveTask(taskId) as TaskRecord<T> | undefined;
  }

  /**
   * Cancel a task. Idempotent — if the task is already in a terminal
   * state, this is a no-op and returns the existing record. Throws
   * only if the task does not exist on this scheduler.
   *
   * Calling cancel on a `running` task is best-effort: we set status
   * to `cancelled` and clear the timer, but a provider call already
   * in flight will still complete on the wire (the result is dropped
   * locally and not written to the ledger).
   */
  cancelTask(taskId: string): TaskRecord<unknown> {
    const record = this.resolveTask(taskId);
    if (!record) {
      throw new Error(`cancelTask: task ${JSON.stringify(taskId)} not found`);
    }
    if (
      record.status === "completed" ||
      record.status === "failed" ||
      record.status === "cancelled"
    ) {
      return record;
    }
    const timer = this.pendingTimers.get(taskId);
    if (timer) {
      clearTimeout(timer);
      this.pendingTimers.delete(taskId);
    }
    record.status = "cancelled";
    record.completedAt = new Date().toISOString();
    this.store?.upsert(record);
    const resolver = this.resolvers.get(taskId);
    resolver?.reject(new Error(`task ${taskId} cancelled`));
    this.bodies.delete(taskId);
    this.resolvers.delete(taskId);
    return record;
  }

  /**
   * Dispatch a queued/scheduled provider-call task immediately,
   * bypassing the scheduler's chosen window. Receipt records
   * `intensitySource: "expedited"`. Closure-based tasks (from
   * `defer`) are not expediteable; we throw a clear error.
   */
  async expediteTask(
    taskId: string,
    adapters: { anthropic?: ProviderAdapter; openai?: ProviderAdapter },
  ): Promise<TickResultEntry> {
    const record = this.resolveTask(taskId);
    if (!record) {
      throw new Error(`expediteTask: task ${JSON.stringify(taskId)} not found`);
    }
    if (record.status === "running") {
      throw new Error(`expediteTask: task ${taskId} is already running`);
    }
    if (
      record.status === "completed" ||
      record.status === "failed" ||
      record.status === "cancelled"
    ) {
      throw new Error(`expediteTask: task ${taskId} is already ${record.status}`);
    }
    if (!record.bodyJson) {
      throw new Error(
        `expediteTask: task ${taskId} is a closure-based task; only provider-call tasks can be expedited`,
      );
    }
    const timer = this.pendingTimers.get(taskId);
    if (timer) {
      clearTimeout(timer);
      this.pendingTimers.delete(taskId);
    }
    record.scheduledFor = new Date().toISOString();
    record.status = "scheduled";
    this.store?.upsert(record);
    const entry = await this.dispatchProviderCall(record, adapters);
    if (entry.status === "completed" && record.receipt) {
      record.intensitySource = "expedited";
      this.store?.upsert(record);
    }
    return entry;
  }

  /**
   * Re-score and reschedule a queued/scheduled task against a new
   * deadline. Throws if the task is already running or terminal, or
   * if the new deadline is invalid.
   */
  async updateDeadline(
    taskId: string,
    newDeadline: string | Date,
  ): Promise<TaskRecord<unknown>> {
    const record = this.resolveTask(taskId);
    if (!record) {
      throw new Error(`updateDeadline: task ${JSON.stringify(taskId)} not found`);
    }
    if (
      record.status === "running" ||
      record.status === "completed" ||
      record.status === "failed" ||
      record.status === "cancelled"
    ) {
      throw new Error(
        `updateDeadline: task ${taskId} is ${record.status}; can only update queued/scheduled tasks`,
      );
    }
    const parsedDeadline = normalizeDeadline(newDeadline);
    const existingTimer = this.pendingTimers.get(taskId);
    if (existingTimer) {
      clearTimeout(existingTimer);
      this.pendingTimers.delete(taskId);
    }
    if (record.bodyJson) {
      await this.scheduleProviderCall(taskId, parsedDeadline);
    } else if (this.bodies.has(taskId)) {
      await this.schedule(taskId, parsedDeadline);
    }
    return record;
  }

  /**
   * Re-dispatch a failed task. Useful when the original failure was a
   * transient provider error (rate-limit, 5xx) and the underlying
   * spec is still valid. Only `failed` tasks are eligible; throws
   * otherwise.
   */
  async retryTask(
    taskId: string,
    adapters: { anthropic?: ProviderAdapter; openai?: ProviderAdapter },
  ): Promise<TickResultEntry> {
    const record = this.resolveTask(taskId);
    if (!record) {
      throw new Error(`retryTask: task ${JSON.stringify(taskId)} not found`);
    }
    if (record.status !== "failed") {
      throw new Error(
        `retryTask: task ${taskId} has status ${record.status}; retry is only valid on failed tasks`,
      );
    }
    if (!record.bodyJson) {
      throw new Error(
        `retryTask: task ${taskId} is closure-based; only provider-call tasks can be retried`,
      );
    }
    record.status = "scheduled";
    record.scheduledFor = new Date().toISOString();
    record.completedAt = undefined;
    record.error = undefined;
    this.store?.upsert(record);
    return await this.dispatchProviderCall(record, adapters);
  }

  /**
   * Pure read-only planning helper: compute the scheduled window and
   * carbon receipt that the same call to `enqueueProviderCall` would
   * produce, without persisting anything. Useful for `schedule_task`
   * with `dry_run: true`.
   */
  async previewProviderCall(
    spec: ProviderCallSpec,
    opts: DeferOptions = {},
  ): Promise<{
    scheduledFor: string;
    estimatedCarbonGCo2: number;
    intensityGCo2PerKwh: number;
    band: GridForecastEntry["band"];
    batchEligible: boolean;
    region: string;
  }> {
    const deadline = normalizeDeadline(opts.deadline);
    const region = opts.region ?? this.defaultRegion;
    const horizonH = Math.max(
      1,
      Math.min(
        MAX_HORIZON_HOURS,
        Math.ceil((deadline.getTime() - Date.now()) / (60 * 60 * 1000)),
      ),
    );
    const forecast = await this.feed.fetchForecast(region, horizonH);
    const budgetG = opts.carbonBudgetG;
    const survivors =
      budgetG !== undefined
        ? forecast.entries.filter((e) => intensityToGrams(e.carbonIntensityGCo2PerKwh, spec.model) <= budgetG)
        : forecast.entries;
    const candidate = pickBestWindow(survivors, deadline);
    if (!candidate) {
      if (budgetG !== undefined && forecast.entries.length > 0) {
        const cheapest = forecast.entries.reduce((a, b) =>
          a.carbonIntensityGCo2PerKwh <= b.carbonIntensityGCo2PerKwh ? a : b,
        );
        const cheapestG = intensityToGrams(cheapest.carbonIntensityGCo2PerKwh, spec.model);
        if (cheapestG > budgetG) {
          throw new CarbonBudgetExceededError(cheapestG, budgetG);
        }
      }
      throw new Error("previewProviderCall: no usable window inside the deadline");
    }
    // batchEligible reflects whether the *deadline* is far enough out
    // that Batch API (24h SLA) is still a viable route, not whether the
    // chosen window itself is more than 24h away.
    const batchEligible = deadline.getTime() - Date.now() > 24 * 60 * 60 * 1000;
    return {
      scheduledFor: candidate.datetime,
      estimatedCarbonGCo2: Math.round(intensityToGrams(candidate.carbonIntensityGCo2PerKwh, spec.model) * 10) / 10,
      intensityGCo2PerKwh: candidate.carbonIntensityGCo2PerKwh,
      band: candidate.band,
      batchEligible,
      region,
    };
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
      // The scheduler scored `forecastEntry` when it picked the window —
      // that is the estimate. `actual` is the intensity observed when the
      // task actually ran. If we dispatched without a forecast (immediate
      // fallback) there is no separate estimate, so the two coincide.
      let source: "scored" | "current" = "scored";
      let estimatedIntensityG: number | undefined;
      if (forecastEntry) {
        estimatedIntensityG = forecastEntry.carbonIntensityGCo2PerKwh;
      } else {
        source = "current";
      }
      const actualIntensityG = await this.fetchCurrentIntensity(record.region, ranAt);
      const actualCarbonGCo2 = Math.round(intensityToGrams(actualIntensityG) * 10) / 10;
      const estimatedCarbonGCo2 =
        estimatedIntensityG !== undefined
          ? Math.round(intensityToGrams(estimatedIntensityG) * 10) / 10
          : actualCarbonGCo2;
      const deltaPct =
        estimatedCarbonGCo2 > 0
          ? Math.round(
              ((actualCarbonGCo2 - estimatedCarbonGCo2) / estimatedCarbonGCo2) * 1000,
            ) / 10
          : 0;
      const receipt: CarbonReceipt = this.maybeSign({
        taskId,
        ranAt: ranAt.toISOString(),
        region: record.region,
        estimatedCarbonGCo2,
        actualCarbonGCo2,
        deltaPct,
        durationMs,
      });
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
    // Parse spec.model out of the persisted body so the per-model energy
    // coefficients (v0.10) factor into both the budget filter and the
    // estimated-carbon receipt.
    let specModel: string | undefined;
    if (record.bodyJson) {
      try {
        const parsed = JSON.parse(record.bodyJson) as Partial<ProviderCallSpec>;
        if (typeof parsed.model === "string") specModel = parsed.model;
      } catch {
        // Corrupt body; downstream dispatch will fail it. Fall back to
        // the legacy flat estimate here.
      }
    }
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
        ? forecast.entries.filter((e) => intensityToGrams(e.carbonIntensityGCo2PerKwh, specModel) <= budgetG)
        : forecast.entries;
    const candidate = pickBestWindow(survivors, deadline);
    if (!candidate) {
      if (budgetG !== undefined && forecast.entries.length > 0) {
        const cheapest = forecast.entries.reduce((a, b) =>
          a.carbonIntensityGCo2PerKwh <= b.carbonIntensityGCo2PerKwh ? a : b,
        );
        const cheapestG = intensityToGrams(cheapest.carbonIntensityGCo2PerKwh, specModel);
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
    record.estimatedCarbonGCo2 =
      Math.round(intensityToGrams(candidate.carbonIntensityGCo2PerKwh, specModel) * 10) / 10;
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
        ? await retryWithBackoff(() => adapter.dispatchBatch(spec.model, [spec.prompt], {
            temperature: spec.temperature,
            maxTokens: spec.maxTokens,
            system: spec.systemPrompt,
          }))
        : await retryWithBackoff(() => adapter.dispatch(spec.model, spec.prompt, {
            temperature: spec.temperature,
            maxTokens: spec.maxTokens,
            system: spec.systemPrompt,
          }));
      const durationMs = Date.now() - start;
      const intensityG = await this.intensityForReceipt(record.region, ranAt);
      const source: "scored" | "current" = "scored";
      // `estimatedCarbonGCo2` was projected at schedule time from the
      // forecast entry the scheduler scored; `actual` is billed against
      // the intensity observed when the task actually ran. The delta is
      // the forecast drift between those two moments. For the actual side
      // we re-estimate energy with the real token counts the provider
      // reported (when available) — that turns the receipt from "typical
      // task at this model" into "this specific call at this model".
      const usage = (result as { usage?: { inputTokens?: number; outputTokens?: number; totalTokens?: number } }).usage;
      const inputTokens = typeof usage?.inputTokens === "number" ? usage.inputTokens : undefined;
      const outputTokens = typeof usage?.outputTokens === "number" ? usage.outputTokens : undefined;
      const actualModel = (result as { model?: string }).model ?? spec.model;
      const actualCarbonGCo2 =
        Math.round(
          gramsForIntensity(intensityG, {
            model: actualModel,
            inputTokens,
            outputTokens,
          }) * 10,
        ) / 10;
      const estimatedCarbonGCo2 = record.estimatedCarbonGCo2 ?? actualCarbonGCo2;
      const deltaPct =
        estimatedCarbonGCo2 > 0
          ? Math.round(
              ((actualCarbonGCo2 - estimatedCarbonGCo2) / estimatedCarbonGCo2) * 1000,
            ) / 10
          : 0;
      const totalTokens = typeof usage?.totalTokens === "number" ? usage.totalTokens : undefined;
      const receipt: CarbonReceipt = this.maybeSign({
        taskId: record.taskId,
        ranAt: ranAt.toISOString(),
        region: record.region,
        estimatedCarbonGCo2,
        actualCarbonGCo2,
        deltaPct,
        // Record what actually ran (the adapter's DispatchResult), not just
        // what was requested — the OpenClaw runtime bridge may run a
        // different model than spec.model. The batch path has no model.
        provider:
          (result as { provider?: string }).provider ?? spec.provider,
        model: (result as { model?: string }).model ?? spec.model,
        durationMs,
        prompt: redactPrompt(spec.prompt, spec.redactInReceipt),
        totalTokens,
      });
      record.status = "completed";
      record.completedAt = new Date().toISOString();
      record.result = result;
      record.receipt = receipt;
      record.intensitySource = source;
      this.store?.upsert(record);
      if (spec.outputPath) {
        await writeOutputFile(spec.outputPath, record.taskId, result, receipt);
      }
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

function intensityToGrams(gCo2PerKwh: number, model?: string): number {
  return gramsForIntensity(gCo2PerKwh, { model });
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

/**
 * Retry an async function with exponential backoff: up to 3 attempts
 * at 1s, 4s, 16s wait. Retries only on transient errors (429
 * rate-limit, 5xx, network errors). Non-retryable errors (4xx other
 * than 429) bubble up on the first call. v0.5 fix for the
 * provider-flake problem.
 */
async function retryWithBackoff<T>(fn: () => Promise<T>): Promise<T> {
  const waits = [1_000, 4_000, 16_000];
  let lastErr: unknown;
  for (let attempt = 0; attempt <= waits.length; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (!isRetryable(err) || attempt === waits.length) {
        throw err;
      }
      // eslint-disable-next-line no-console
      console.warn(
        `[ebb-ai/scheduler] dispatch attempt ${attempt + 1} failed (${describeErr(err)}); retrying in ${waits[attempt]! / 1000}s`,
      );
      await new Promise((r) => setTimeout(r, waits[attempt]!));
    }
  }
  throw lastErr;
}

function isRetryable(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as { status?: number; statusCode?: number; code?: string; message?: string };
  const status = e.status ?? e.statusCode;
  if (typeof status === "number") {
    if (status === 429) return true;
    if (status >= 500 && status < 600) return true;
    return false;
  }
  const code = e.code;
  if (typeof code === "string") {
    // Node fetch / undici-style transient codes.
    if (["ECONNRESET", "ETIMEDOUT", "ECONNREFUSED", "EAI_AGAIN", "UND_ERR_SOCKET"].includes(code)) {
      return true;
    }
  }
  // Anthropic / OpenAI SDKs typically surface their HTTP status on the
  // error; if absent, assume non-retryable.
  return false;
}

function describeErr(err: unknown): string {
  if (!err) return "unknown error";
  if (typeof err === "object") {
    const e = err as { status?: number; code?: string; message?: string };
    const parts: string[] = [];
    if (e.status) parts.push(`status=${e.status}`);
    if (e.code) parts.push(`code=${e.code}`);
    if (e.message) parts.push(e.message);
    return parts.join(" · ") || JSON.stringify(err);
  }
  return String(err);
}

/**
 * Default redaction patterns — applied unless the spec passes its
 * own `redactInReceipt` array. Catches API keys for the major
 * vendors plus generic bearer tokens.
 */
const DEFAULT_REDACTION_PATTERNS: ReadonlyArray<RegExp> = [
  /sk-(?:ant-)?[A-Za-z0-9_\-]{20,}/g,
  /sk-proj-[A-Za-z0-9_\-]{20,}/g,
  /\b[A-Z]{2,3}_[A-Z0-9]{6,}\b/g,                  // generic FOO_BAR keys
  /\bBearer\s+[A-Za-z0-9_\-.]{20,}/gi,
];

/**
 * Apply the spec's redaction patterns (or the default set) to the
 * prompt before storing it on the receipt. Original prompt is left
 * untouched on the live dispatch.
 */
function redactPrompt(prompt: string, patterns: string[] | undefined): string {
  let out = prompt;
  const apply = (p: RegExp) => {
    out = out.replace(p, "[REDACTED]");
  };
  if (patterns === undefined) {
    for (const p of DEFAULT_REDACTION_PATTERNS) apply(p);
  } else if (patterns.length > 0) {
    for (const raw of patterns) {
      try {
        apply(new RegExp(raw, "g"));
      } catch {
        // ignore malformed user regexes
      }
    }
  }
  return out;
}

/**
 * Write { taskId, result, receipt } as JSON to the spec's
 * `outputPath`. Failures are logged but do not fail the task — the
 * SQLite ledger is the source of truth, the file is a convenience.
 */
async function writeOutputFile(
  path: string,
  taskId: string,
  result: unknown,
  receipt: CarbonReceipt,
): Promise<void> {
  try {
    const { mkdir, writeFile } = await import("node:fs/promises");
    const { dirname } = await import("node:path");
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, JSON.stringify({ taskId, result, receipt }, null, 2));
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(
      `[ebb-ai/scheduler] failed to write output_path=${path}: ${describeErr(err)}; result is still in the SQLite ledger`,
    );
  }
}
