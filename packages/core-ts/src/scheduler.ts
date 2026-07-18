/**
 * Scheduler — the in-process orchestrator for ebb-ai.
 *
 * Responsibilities:
 *   - Hold a queue of deferrable tasks (closure-based `defer`/`enqueue`
 *     and JSON-persistable provider-call tasks).
 *   - Score candidate execution windows for each task using a grid feed.
 *   - Sleep until the chosen window (closure tasks) or mark the window
 *     for a later `tick()` (provider-call tasks), then dispatch.
 *   - Record a signed carbon receipt on the resulting TaskRecord.
 *   - Optionally write every state transition through to a SQLite
 *     audit ledger (`dbPath`), shared safely across processes via WAL
 *     plus a row-level dispatch claim.
 *
 * Still out of scope (see ROADMAP.md):
 *   - Cross-provider routing.
 *   - Multi-region failover.
 */

import { randomUUID } from "node:crypto";
import { gramsForIntensity, resolveModelEnergy } from "./energy.js";
import { mockGridFeed } from "./grid.js";
import type { ProviderAdapter } from "./providers/base.js";
import {
  candidateId,
  parseCandidates,
  scoreCandidates,
  type RoutingDecision,
} from "./routing.js";
import { selectWindow } from "./select-window.js";
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
  GridForecast,
  GridForecastEntry,
  ProviderCallSpec,
  ProviderName,
  TaskRecord,
  TickResult,
  TickResultEntry,
} from "./types.js";

const DEFAULT_REGION = "US-CAL-CISO";
const MAX_HORIZON_HOURS = 72;

/**
 * The adapters map `tick` (and the expedite / retry / batch helpers) accept:
 * a provider name → adapter. A partial record so a caller can supply only the
 * providers it has configured; an unmapped provider fails the task with a
 * clear "no adapter configured" error rather than silently dropping it.
 */
export type TickAdapters = Partial<Record<ProviderName, ProviderAdapter>>;

/** Providers `enqueueProviderCall` accepts. Keep in sync with {@link ProviderName}. */
const SUPPORTED_PROVIDERS: ReadonlySet<ProviderName> = new Set([
  "anthropic",
  "openai",
  "gemini",
  "ollama",
]);

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
  /**
   * Inject a pseudo-random number generator returning [0, 1). Defaults to
   * `Math.random`. Used by the cleanest-tolerance-band tie-break in every
   * committing scheduling path so a region's committed tasks spread across
   * the clean band instead of all landing on the single trough hour
   * (§2.1). A seeded PRNG makes window selection deterministic in tests.
   */
  rng?: () => number;
}

export class Scheduler {
  private readonly feed: GridFeed;
  private readonly defaultRegion: string;
  private readonly rng: () => number;
  private readonly tasks = new Map<string, TaskRecord<unknown>>();
  private readonly pendingTimers = new Map<string, NodeJS.Timeout>();
  private readonly resolvers = new Map<
    string,
    { resolve: (v: unknown) => void; reject: (e: unknown) => void }
  >();
  private readonly bodies = new Map<string, DeferrableTask<unknown>>();
  private readonly store: TaskStore | undefined;
  // Mutable: a single load failure disables signing for the rest of
  // this scheduler instance (see `getSigningKey`).
  private signingConfig: false | { keyPath?: string };
  private signingKey: SigningKeyPair | undefined;

  constructor(opts: SchedulerOptions = {}) {
    this.feed = opts.feed ?? mockGridFeed();
    this.defaultRegion = opts.defaultRegion ?? DEFAULT_REGION;
    this.rng = opts.rng ?? Math.random;
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
      // Check both the in-memory map and the durable store: a fresh
      // process re-using an old id must not silently overwrite a
      // persisted (possibly completed + signed) ledger row.
      if (this.tasks.has(opts.taskId) || this.store?.get(opts.taskId)) {
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
      deadline: deadline.toISOString(),
    };
    this.tasks.set(taskId, record);
    this.bodies.set(taskId, task as DeferrableTask<unknown>);
    this.store?.upsert(record);
    // Fire-and-forget, but never unhandled: a rejecting grid feed (or any
    // scheduling error) must fail the task — rejecting the defer() promise
    // — instead of crashing the process with an unhandledRejection.
    this.schedule(taskId, deadline).catch((err) => {
      this.failTask(taskId, err instanceof Error ? err : new Error(String(err)));
    });
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
    if (!SUPPORTED_PROVIDERS.has(spec.provider)) {
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
      // Check both the in-memory map and the durable store: a fresh
      // process re-using an old id must not silently overwrite a
      // persisted (possibly completed + signed) ledger row.
      if (this.tasks.has(opts.taskId) || this.store?.get(opts.taskId)) {
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
      deadline: deadline.toISOString(),
    };
    this.tasks.set(taskId, record);
    this.store?.upsert(record);
    // Schedule a carbon window but DO NOT register an in-process timer that
    // calls `dispatch` — provider-call tasks are driven exclusively by
    // `Scheduler.tick`. We still write `scheduled` + `scheduledFor` so the
    // ledger reflects the chosen window and so `tick` can compare against
    // `Date.now()`.
    try {
      await this.scheduleProviderCall(taskId, deadline);
    } catch (err) {
      // A scheduling failure after the queued-row upsert must not strand
      // a permanently-"queued" row in the ledger.
      this.failTask(taskId, err instanceof Error ? err : new Error(String(err)));
      throw err;
    }
    return record;
  }

  /**
   * Drain due provider-call tasks against the supplied adapters. Returns a
   * `TickResult` summarising what happened. Closure-based tasks
   * (`enqueue` / `defer`) are NOT touched by this method — only this
   * process can run those.
   */
  async tick(adapters: TickAdapters): Promise<TickResult> {
    const results: TickResultEntry[] = [];
    let dispatched = 0;
    let failed = 0;
    let inspected = 0;

    // ---- (1) Batch-submit sweep, BEFORE the due sweep ----
    // A batch-eligible task's deferral mechanism IS the Batch API: the
    // provider runs it within its own 24h SLA and picks the execution
    // hour. We deliberately do NOT wait for a clean local window — the
    // whole point is to submit early and let the provider place the run.
    // Carbon scoring does not apply to batch-routed tasks (the provider
    // owns the hour); cost does (50% off). See §0.1.
    let batchSubmitted = 0;
    // Tasks submitted in THIS tick must not be polled in the same tick's
    // poll sweep — submit and poll are distinct ticks (the provider needs
    // time to start the batch).
    const submittedThisTick = new Set<string>();
    for (const record of this.collectBatchSubmitCandidates(adapters)) {
      // Reuse the scheduled→running claim so a racing tick can't submit
      // the same row twice (double-billed batch). In-memory-only mode
      // has no cross-process race, so claim only when a store exists.
      if (this.store) {
        let claimed = false;
        try {
          claimed = this.store.claimScheduled(record.taskId);
        } catch (err) {
          // eslint-disable-next-line no-console
          console.warn(
            `[ebb-ai/scheduler] tick: could not claim task ${record.taskId} for batch submit: ${describeErr(err)}; skipping this round`,
          );
          continue;
        }
        if (!claimed) continue;
      } else {
        // In-memory guard: flip to running so a re-entrant tick skips it.
        if (record.status !== "scheduled") continue;
        record.status = "running";
      }
      inspected++;
      const entry = await this.submitBatch(record, adapters);
      results.push(entry);
      if (entry.status === "submitted") {
        batchSubmitted++;
        submittedThisTick.add(record.taskId);
      } else if (entry.status === "completed") dispatched++;
      else failed++;
    }

    // ---- (2) Due sweep (sync provider calls) ----
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

    for (const record of candidates) {
      // Row-level claim: only one tick gets to dispatch this task. If
      // the store is configured, the claim is also visible to other
      // processes pointing at the same SQLite file (e.g. an
      // interactive `ebb tick` racing the launchd cron).
      if (this.store) {
        let claimed = false;
        try {
          claimed = this.store.claimScheduled(record.taskId);
        } catch (err) {
          // A locked / throwing row (e.g. SQLITE_BUSY under heavy
          // multi-process contention) is skipped — it stays "scheduled"
          // and a later tick retries. It must never abort the whole tick.
          // eslint-disable-next-line no-console
          console.warn(
            `[ebb-ai/scheduler] tick: could not claim task ${record.taskId}: ${describeErr(err)}; skipping this round`,
          );
          continue;
        }
        if (!claimed) continue;
      }
      inspected++;
      const entry = await this.dispatchProviderCall(record, adapters);
      results.push(entry);
      if (entry.status === "completed") dispatched++;
      else failed++;
    }

    // ---- (3) Batch-poll sweep, AFTER the due sweep ----
    let batchPolled = 0;
    for (const record of this.collectSubmittedCandidates(submittedThisTick)) {
      // Claim submitted→running so two racing ticks can't double-complete.
      if (this.store) {
        let claimed = false;
        try {
          claimed = this.store.claimSubmitted(record.taskId);
        } catch (err) {
          // eslint-disable-next-line no-console
          console.warn(
            `[ebb-ai/scheduler] tick: could not claim submitted task ${record.taskId}: ${describeErr(err)}; skipping this round`,
          );
          continue;
        }
        if (!claimed) continue;
      } else {
        if (record.status !== "submitted") continue;
        record.status = "running";
      }
      inspected++;
      const entry = await this.pollBatch(record, adapters);
      results.push(entry);
      if (entry.status === "completed") dispatched++;
      else if (entry.status === "submitted") batchPolled++;
      else failed++;
    }

    return {
      inspected,
      dispatched,
      failed,
      results,
      batchSubmitted,
      batchPolled,
    };
  }

  /**
   * Collect scheduled provider-call tasks that should be routed through a
   * Batch API this tick: preferBatch !== false, an adapter with a
   * dispatchBatch function exists, a deadline is persisted, and
   * (deadline − now) > 24h. Legacy rows with no persisted deadline are
   * skipped (they fall through to the sync due-sweep), never errored.
   */
  private collectBatchSubmitCandidates(adapters: TickAdapters): TaskRecord<unknown>[] {
    const now = Date.now();
    const out: TaskRecord<unknown>[] = [];
    const seen = new Set<string>();
    const consider = (record: TaskRecord<unknown>): void => {
      if (seen.has(record.taskId)) return;
      if (record.status !== "scheduled") return;
      if (!record.bodyJson) return;
      if (!record.deadline) return; // legacy row → sync path
      if (new Date(record.deadline).getTime() - now <= 24 * 60 * 60 * 1000) return;
      let spec: Partial<ProviderCallSpec>;
      try {
        spec = JSON.parse(record.bodyJson) as Partial<ProviderCallSpec>;
      } catch {
        return; // corrupt body → sync due-sweep fails it with a clear error
      }
      if (spec.type !== "provider_call") return;
      if (spec.preferBatch === false) return;
      if (spec.provider !== "anthropic" && spec.provider !== "openai") return;
      const adapter = adapters[spec.provider];
      if (!adapter) return;
      if (typeof adapter.dispatchBatch !== "function") return;
      seen.add(record.taskId);
      out.push(record);
    };
    for (const record of this.tasks.values()) consider(record);
    if (this.store) {
      for (const record of this.store.list({ status: "scheduled" })) {
        if (seen.has(record.taskId)) continue;
        this.tasks.set(record.taskId, record);
        consider(record);
      }
    }
    return out;
  }

  /**
   * Collect every "submitted" provider-call task awaiting batch results.
   * `exclude` skips tasks submitted earlier in the same tick — submit and
   * poll are distinct ticks by design.
   */
  private collectSubmittedCandidates(
    exclude: Set<string> = new Set(),
  ): TaskRecord<unknown>[] {
    const out: TaskRecord<unknown>[] = [];
    const seen = new Set<string>();
    for (const record of this.tasks.values()) {
      if (exclude.has(record.taskId)) continue;
      if (record.status !== "submitted") continue;
      if (!record.batchId) continue;
      out.push(record);
      seen.add(record.taskId);
    }
    if (this.store) {
      for (const record of this.store.list({ status: "submitted" })) {
        if (exclude.has(record.taskId) || seen.has(record.taskId)) continue;
        if (!record.batchId) continue;
        this.tasks.set(record.taskId, record);
        out.push(record);
      }
    }
    return out;
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
   * in flight will still complete on the wire. The dispatcher re-checks
   * the status before finalizing, so a cancelled task's late result is
   * dropped locally and never written over the cancelled ledger row.
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
    if (record.status === "submitted") {
      // The task is already in flight at the provider's Batch API. We
      // have no adapter handle here (cancelTask takes no adapters), so we
      // cannot issue a provider-side cancel — mark it cancelled locally
      // and warn that the batch may still run and bill. (Trivial
      // provider cancel is deferred: the vendor batch-cancel endpoints
      // are best-effort and racy against completion.)
      // eslint-disable-next-line no-console
      console.warn(
        `[ebb-ai/scheduler] cancelTask: task ${taskId} was submitted to the provider's Batch API (batch id ${record.batchId ?? "unknown"}); marking cancelled locally, but the provider-side batch may still run and bill`,
      );
    }
    record.status = "cancelled";
    record.completedAt = new Date().toISOString();
    // Terminal transition: redact secrets out of the persisted body so the
    // ledger does not retain raw prompts forever (see redactBodyJson).
    record.bodyJson = redactBodyJson(record.bodyJson);
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
    adapters: TickAdapters,
  ): Promise<TickResultEntry> {
    const record = this.resolveTask(taskId);
    if (!record) {
      throw new Error(`expediteTask: task ${JSON.stringify(taskId)} not found`);
    }
    if (record.status === "running") {
      throw new Error(`expediteTask: task ${taskId} is already running`);
    }
    if (record.status === "submitted") {
      throw new Error(
        `expediteTask: task ${taskId} is already submitted to the provider's Batch API (batch id ${record.batchId ?? "unknown"}); poll with tick / check_queue_status`,
      );
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
    // Same row-level claim `tick` uses: if a concurrent process (e.g. the
    // cron tick) grabbed the row between our upsert and here, do NOT
    // dispatch a second (double-billed) provider call.
    if (this.store && !this.store.claimScheduled(taskId)) {
      throw new Error(
        `task ${taskId} was just claimed by another process (racing tick?)`,
      );
    }
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
    record.deadline = parsedDeadline.toISOString();
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
    adapters: TickAdapters,
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
    // A retry re-dispatches synchronously via the due path below — clear
    // any stale batchId from a prior batch attempt so the completed row
    // no longer points at a dead/failed batch.
    record.batchId = undefined;
    this.store?.upsert(record);
    // Row-level claim: don't double-dispatch if a concurrent tick in
    // another process grabbed the freshly re-scheduled row first.
    if (this.store && !this.store.claimScheduled(taskId)) {
      throw new Error(
        `task ${taskId} was just claimed by another process (racing tick?)`,
      );
    }
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
    /**
     * How many near-equal low-carbon windows sat in the cleanest-tolerance
     * band the shared `selectWindow` chose from (§2.1). A committed
     * `enqueueProviderCall` picks randomly within this same set, so the
     * preview's `scheduledFor` may legitimately differ from the eventual
     * commit's — but the candidate SET is identical. Undefined when no
     * in-deadline window existed (the "run now" fallback below).
     */
    cleanBandSize?: number;
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
    // Shared selection (§2.1): preview and the eventual commit both run
    // `selectWindow` over the same budget survivors, so they agree on the
    // candidate band even though each makes its own random pick within it.
    const selection = selectWindow(survivors, deadline, { rng: this.rng });
    const candidate = selection?.chosen;
    // batchEligible reflects whether the *deadline* is far enough out
    // that Batch API (24h SLA) is still a viable route, not whether the
    // chosen window itself is more than 24h away.
    const batchEligible = deadline.getTime() - Date.now() > 24 * 60 * 60 * 1000;
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
      // No usable window inside the deadline. Mirror what the commit path
      // (`scheduleProviderCall`) does — schedule for "now" — instead of
      // throwing, so dry_run and the real call cannot diverge.
      const head = forecast.entries[0];
      if (!head) {
        throw new Error("previewProviderCall: forecast returned no entries");
      }
      return {
        scheduledFor: new Date().toISOString(),
        estimatedCarbonGCo2:
          Math.round(intensityToGrams(head.carbonIntensityGCo2PerKwh, spec.model) * 10) / 10,
        intensityGCo2PerKwh: head.carbonIntensityGCo2PerKwh,
        band: head.band,
        batchEligible,
        region,
      };
    }
    return {
      // A candidate whose hour started in the past is the *current* hour —
      // the commit path dispatches now, so the preview says "now" too.
      scheduledFor:
        new Date(candidate.datetime).getTime() <= Date.now()
          ? new Date().toISOString()
          : candidate.datetime,
      estimatedCarbonGCo2: Math.round(intensityToGrams(candidate.carbonIntensityGCo2PerKwh, spec.model) * 10) / 10,
      intensityGCo2PerKwh: candidate.carbonIntensityGCo2PerKwh,
      band: candidate.band,
      batchEligible,
      region,
      cleanBandSize: selection!.band.length,
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
    // Shared selection: cleanest-tolerance-band tie-break with the
    // scheduler's rng, so committed tasks spread across the clean band
    // instead of all colliding on the single trough hour (§2.1).
    const candidate = selectWindow(survivors, deadline, { rng: this.rng })?.chosen;
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
      this.dispatchSafe(taskId, new Date(), undefined);
      return;
    }
    if (new Date(candidate.datetime).getTime() <= Date.now()) {
      // The chosen window is the *current* hour (its start is in the
      // past) — dispatch now, keeping the scored entry for the receipt.
      this.dispatchSafe(taskId, new Date(), candidate);
      return;
    }
    record.status = "scheduled";
    record.scheduledFor = candidate.datetime;
    this.store?.upsert(record);
    const wait = Math.max(0, new Date(candidate.datetime).getTime() - Date.now());
    // Node's setTimeout overflows the signed-32-bit ms range (~24.85 days).
    // Cap each hop at 2_000_000_000 ms (~23.1 days) and re-schedule when
    // the timer fires before the actual window.
    const safeWait = Math.min(wait, 2_000_000_000);
    const timer = setTimeout(() => {
      this.pendingTimers.delete(taskId);
      if (safeWait < wait) {
        // Re-entry after a capped hop. Errors route to failTask so a
        // transient feed failure never becomes an unhandledRejection.
        this.schedule(taskId, deadline).catch((err) => {
          this.failTask(taskId, err instanceof Error ? err : new Error(String(err)));
        });
      } else {
        this.dispatchSafe(taskId, new Date(candidate.datetime), candidate);
      }
    }, safeWait);
    this.pendingTimers.set(taskId, timer);
  }

  /** Fire-and-forget wrapper around `dispatch` that routes any unexpected
   *  rejection to `failTask` instead of an unhandledRejection. */
  private dispatchSafe(
    taskId: string,
    ranAt: Date,
    forecastEntry: GridForecastEntry | undefined,
  ): void {
    this.dispatch(taskId, ranAt, forecastEntry).catch((err) => {
      this.failTask(taskId, err instanceof Error ? err : new Error(String(err)));
    });
  }

  private failTask(taskId: string, err: Error): void {
    const record = this.tasks.get(taskId);
    if (!record) return;
    // Never overwrite a terminal state (a completed = billed dispatch, or
    // an explicit cancellation) with "failed".
    if (
      record.status === "completed" ||
      record.status === "failed" ||
      record.status === "cancelled"
    ) {
      return;
    }
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
    // The try/catch is deliberately narrow: it covers ONLY the user's task
    // body. Once the body has succeeded, every piece of bookkeeping below
    // (intensity fetch, receipt build/sign, ledger write) is fail-soft —
    // a successful run must never be re-labelled "failed" by its paperwork.
    let result: unknown;
    try {
      result = await body();
    } catch (err) {
      record.status = "failed";
      record.completedAt = new Date().toISOString();
      record.error = err instanceof Error ? err.message : String(err);
      this.store?.upsert(record);
      resolver?.reject(err);
      this.bodies.delete(taskId);
      this.resolvers.delete(taskId);
      return;
    }
    const durationMs = Date.now() - start;

    // The task may have been cancelled while the body was running — the
    // resolver was already rejected by cancelTask. Do not overwrite the
    // cancelled ledger row with a completed record + late result.
    // (Widen through a local: TS otherwise keeps `record.status` narrowed
    // to the "running" literal assigned above.)
    const statusAfterRun = record.status as TaskRecord["status"] as string;
    if (statusAfterRun === "cancelled") {
      // eslint-disable-next-line no-console
      console.warn(
        `[ebb-ai/scheduler] task ${taskId} was cancelled while running; dropping its late result`,
      );
      this.bodies.delete(taskId);
      this.resolvers.delete(taskId);
      return;
    }

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
    let actualIntensityG: number | undefined;
    let gridSource: GridForecast["source"] | undefined;
    let signalType: GridForecast["signalType"];
    try {
      const current = await this.fetchCurrentIntensity(record.region, ranAt);
      actualIntensityG = current.intensityG;
      gridSource = current.source;
      signalType = current.signalType;
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn(
        `[ebb-ai/scheduler] intensity fetch for the receipt failed (${describeErr(err)}); receipt falls back to the schedule-time estimate`,
      );
    }
    let receipt: CarbonReceipt | undefined;
    try {
      const intensityForActual = actualIntensityG ?? estimatedIntensityG;
      const actualCarbonGCo2 =
        intensityForActual !== undefined
          ? Math.round(intensityToGrams(intensityForActual) * 10) / 10
          : 0;
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
      receipt = this.maybeSign({
        taskId,
        ranAt: ranAt.toISOString(),
        region: record.region,
        estimatedCarbonGCo2,
        actualCarbonGCo2,
        deltaPct,
        durationMs,
        // Provenance: the raw intensity + which feed produced it. Left
        // undefined when the receipt-side fetch failed. Closure tasks
        // have no model, so the energy coefficients are the flat legacy
        // fallback tier.
        intensityGCo2PerKwh: actualIntensityG,
        gridSource,
        signalType,
        energySource: "fallback",
        energyResolution: "default",
      });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn(
        `[ebb-ai/scheduler] failed to build the carbon receipt for ${taskId}: ${describeErr(err)}; task stays completed without a receipt`,
      );
    }
    record.status = "completed";
    record.completedAt = new Date().toISOString();
    record.result = result;
    record.receipt = receipt;
    record.intensitySource = source;
    try {
      this.store?.upsert(record);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn(
        `[ebb-ai/scheduler] failed to persist completed task ${taskId}: ${describeErr(err)}`,
      );
    }
    resolver?.resolve(result);
    this.bodies.delete(taskId);
    this.resolvers.delete(taskId);
  }

  private async scheduleProviderCall(taskId: string, deadline: Date): Promise<void> {
    const record = this.tasks.get(taskId);
    if (!record) return;
    // Parse the full spec out of the persisted body so the per-model energy
    // coefficients (v0.10) factor into the budget filter + estimated-carbon
    // receipt, and so cross-provider routing (ROADMAP item 1) can see the
    // candidate list. `specModel` drives WINDOW selection (chosen once,
    // before provider scoring); routing may overwrite the model afterward.
    let spec: ProviderCallSpec | undefined;
    let specModel: string | undefined;
    if (record.bodyJson) {
      try {
        spec = JSON.parse(record.bodyJson) as ProviderCallSpec;
        if (typeof spec.model === "string") specModel = spec.model;
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
    // Shared selection (§2.1): same cleanest-tolerance-band tie-break as
    // the recommend path, so committed provider-call tasks spread too.
    const candidate = selectWindow(survivors, deadline, { rng: this.rng })?.chosen;
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
      // the task immediately rather than miss the deadline. Route (if a
      // candidate list was supplied) against the current-hour intensity.
      const nowIntensity = forecast.entries[0]?.carbonIntensityGCo2PerKwh;
      record.status = "scheduled";
      record.scheduledFor = new Date().toISOString();
      const routedModelNow =
        nowIntensity !== undefined
          ? this.applyRoutingIfNeeded(record, spec, nowIntensity)
          : specModel;
      if (nowIntensity !== undefined) {
        record.estimatedCarbonGCo2 =
          Math.round(intensityToGrams(nowIntensity, routedModelNow) * 10) / 10;
      }
      this.store?.upsert(record);
      return;
    }
    record.status = "scheduled";
    // A candidate whose hour started in the past is the *current* hour —
    // schedule for "now" so the very next tick dispatches immediately.
    record.scheduledFor =
      new Date(candidate.datetime).getTime() <= Date.now()
        ? new Date().toISOString()
        : candidate.datetime;
    // Cross-provider routing (ROADMAP item 1): the window `candidate` was
    // chosen ONCE above; now score the caller's candidates at that window's
    // intensity, overwrite the spec's provider/model with the winner, and
    // record the decision. No-op unless >= 2 candidates were supplied.
    const routedModel = this.applyRoutingIfNeeded(
      record,
      spec,
      candidate.carbonIntensityGCo2PerKwh,
    );
    record.estimatedCarbonGCo2 =
      Math.round(intensityToGrams(candidate.carbonIntensityGCo2PerKwh, routedModel) * 10) / 10;
    this.store?.upsert(record);
  }

  /**
   * Cross-provider routing (ROADMAP item 1). When the spec carries >= 2
   * candidates, score them at `intensityForScoring` (the already-chosen
   * window's intensity), overwrite `spec.provider`/`spec.model` with the
   * winner, re-serialize `record.bodyJson`, and stash the full decision on
   * `record.routingDecision`. Returns the model that should drive the
   * estimated-carbon figure (the routed winner, or the spec's own model when
   * routing did not run). A missing price throws loudly (MissingPriceError)
   * — which fails the task at schedule time, by design.
   */
  private applyRoutingIfNeeded(
    record: TaskRecord<unknown>,
    spec: ProviderCallSpec | undefined,
    intensityForScoring: number,
  ): string | undefined {
    if (!spec) return undefined;
    const specs = spec.candidates;
    if (!Array.isArray(specs) || specs.length < 2) return spec.model;
    const candidates = parseCandidates(specs);
    const batchEligible = record.deadline
      ? new Date(record.deadline).getTime() - Date.now() > 24 * 60 * 60 * 1000
      : false;
    const decision = scoreCandidates({
      candidates,
      intensityGCo2PerKwh: intensityForScoring,
      weights: spec.routeWeights,
      batchEligible,
      rng: this.rng,
    });
    const chosen = decision.considered.find((c) => candidateId(c) === decision.chosen);
    if (chosen) {
      spec.provider = chosen.provider;
      spec.model = chosen.model;
      record.bodyJson = JSON.stringify(spec);
    }
    record.routingDecision = decision;
    return chosen?.model ?? spec.model;
  }

  private async dispatchProviderCall(
    record: TaskRecord<unknown>,
    adapters: TickAdapters,
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
    // Cross-provider routing fallback (ROADMAP item 1): when a routing
    // decision is attached, dispatch the highest-scoring candidate whose
    // adapter is actually configured AND ready (has a key). If the originally
    // chosen candidate is unavailable, fall through to the next-best scored
    // one and record the fallback on the receipt.
    let adapter = adapters[spec.provider];
    const routing = record.routingDecision;
    if (routing) {
      const ordered = [...routing.considered].sort((a, b) => a.score - b.score);
      const picked = ordered.find((c) => {
        const a = adapters[c.provider];
        return a !== undefined && a.ready;
      });
      if (!picked) {
        const msg =
          `tick: no configured/ready adapter for any routing candidate ` +
          `(${routing.considered.map((c) => candidateId(c)).join(", ")})`;
        this.failTask(record.taskId, new Error(msg));
        return { taskId: record.taskId, status: "failed", error: msg };
      }
      const pickedId = candidateId(picked);
      if (pickedId !== routing.chosen) {
        record.routingDecision = {
          ...routing,
          fallbackFrom: routing.chosen,
          chosen: pickedId,
          reasoning: `${routing.reasoning} — dispatch fell back to ${pickedId} (originally ${routing.chosen} unavailable / missing key)`,
        };
        spec.provider = picked.provider;
        spec.model = picked.model;
      }
      adapter = adapters[picked.provider];
    }
    if (!adapter) {
      const msg = `tick: no adapter configured for provider ${spec.provider}`;
      this.failTask(record.taskId, new Error(msg));
      return { taskId: record.taskId, status: "failed", error: msg };
    }

    record.status = "running";
    try {
      this.store?.upsert(record);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn(
        `[ebb-ai/scheduler] failed to persist running status for ${record.taskId}: ${describeErr(err)}`,
      );
    }
    const start = Date.now();
    const ranAt = new Date();
    // The try/catch is deliberately narrow: it covers ONLY the (billed)
    // provider call. Everything after a successful call — intensity fetch,
    // receipt build/sign, ledger write, output file — is fail-soft: a paid
    // dispatch must NEVER be re-labelled "failed" (a retry would bill the
    // provider a second time).
    let result: unknown;
    try {
      // Batch routing (deadline > 24h) is handled by the dedicated
      // submit/poll sweeps in tick(); by the time a task reaches this
      // sync due-sweep it is a genuine synchronous call.
      result = await retryWithBackoff(() => adapter.dispatch(spec.model, spec.prompt, {
        temperature: spec.temperature,
        maxTokens: spec.maxTokens,
        system: spec.systemPrompt,
      }));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      record.status = "failed";
      record.completedAt = new Date().toISOString();
      record.error = msg;
      this.store?.upsert(record);
      return { taskId: record.taskId, status: "failed", error: msg };
    }
    const durationMs = Date.now() - start;

    // The task may have been cancelled while the provider call was in
    // flight (this process, or another one via the shared store). Keep the
    // cancelled ledger row: do not overwrite it with completed + result.
    let cancelledElsewhere = false;
    try {
      cancelledElsewhere = this.store?.get(record.taskId)?.status === "cancelled";
    } catch {
      // Store read failure — fall back to the in-memory status only.
    }
    const statusAfterCall = record.status as TaskRecord["status"] as string;
    if (statusAfterCall === "cancelled" || cancelledElsewhere) {
      record.status = "cancelled";
      // eslint-disable-next-line no-console
      console.warn(
        `[ebb-ai/scheduler] task ${record.taskId} was cancelled while running; dropping its late result`,
      );
      return {
        taskId: record.taskId,
        status: "failed",
        error: "task was cancelled while running; late result dropped",
      };
    }

    let intensityG: number | undefined;
    let gridSource: GridForecast["source"] | undefined;
    let signalType: GridForecast["signalType"];
    try {
      const current = await this.fetchCurrentIntensity(record.region, ranAt);
      intensityG = current.intensityG;
      gridSource = current.source;
      signalType = current.signalType;
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn(
        `[ebb-ai/scheduler] intensity fetch for the receipt failed (${describeErr(err)}); receipt falls back to the schedule-time estimate`,
      );
    }
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
    const totalTokens = typeof usage?.totalTokens === "number" ? usage.totalTokens : undefined;
    let receipt: CarbonReceipt | undefined;
    try {
      const actualCarbonGCo2 =
        intensityG !== undefined
          ? Math.round(
              gramsForIntensity(intensityG, {
                model: actualModel,
                inputTokens,
                outputTokens,
              }) * 10,
            ) / 10
          : (record.estimatedCarbonGCo2 ?? 0);
      const estimatedCarbonGCo2 = record.estimatedCarbonGCo2 ?? actualCarbonGCo2;
      const deltaPct =
        estimatedCarbonGCo2 > 0
          ? Math.round(
              ((actualCarbonGCo2 - estimatedCarbonGCo2) / estimatedCarbonGCo2) * 1000,
            ) / 10
          : 0;
      receipt = this.maybeSign({
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
        // Provenance (v0.12): the raw intensity, which feed produced it
        // ("mock" = synthetic), and the confidence tier of the per-model
        // energy coefficients. Undefined intensity/gridSource means the
        // receipt-side fetch failed and the actual side reuses the
        // schedule-time estimate.
        intensityGCo2PerKwh: intensityG,
        gridSource,
        signalType,
        energySource: resolveModelEnergy(actualModel).coeffs.source,
        energyResolution: resolveModelEnergy(actualModel).tier,
        // Cross-provider routing provenance (ROADMAP item 1): the scored
        // candidate list, weights, chosen id (+ any dispatch fallbackFrom).
        // Inside the signed payload; omitted when routing was not used.
        routing: record.routingDecision,
      });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn(
        `[ebb-ai/scheduler] failed to build the carbon receipt for ${record.taskId}: ${describeErr(err)}; task stays completed without a receipt`,
      );
    }
    record.status = "completed";
    record.completedAt = new Date().toISOString();
    record.result = result;
    record.receipt = receipt;
    record.intensitySource = source;
    // Terminal transition: redact secrets out of the persisted body. The
    // original (unredacted) body was needed up to this point so the live
    // dispatch used the caller's exact prompt; the ledger keeps only the
    // redacted form. (Failed tasks intentionally keep the original body —
    // retryTask must re-dispatch the exact prompt.)
    record.bodyJson = redactBodyJson(record.bodyJson);
    try {
      this.store?.upsert(record);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn(
        `[ebb-ai/scheduler] failed to persist completed task ${record.taskId}: ${describeErr(err)}`,
      );
    }
    if (spec.outputPath && receipt) {
      await writeOutputFile(spec.outputPath, record.taskId, result, receipt);
    }
    return { taskId: record.taskId, status: "completed" };
  }

  /**
   * Submit a batch-eligible task to the provider's Batch API. The row was
   * already claimed (scheduled → running) by the caller. On success the
   * task transitions to "submitted" with the returned batchId persisted —
   * the provider now owns the execution hour (within its 24h SLA), and a
   * later tick's poll sweep completes it. On submit failure → failed
   * (retryTask can re-dispatch sync). No receipt is written here: carbon
   * is scored only when real results (and usage) arrive at poll time.
   */
  private async submitBatch(
    record: TaskRecord<unknown>,
    adapters: TickAdapters,
  ): Promise<TickResultEntry> {
    let spec: ProviderCallSpec;
    try {
      spec = JSON.parse(record.bodyJson ?? "null") as ProviderCallSpec;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.failTask(record.taskId, new Error(`tick: corrupt body_json: ${msg}`));
      return { taskId: record.taskId, status: "failed", error: msg };
    }
    const adapter = adapters[spec.provider];
    const dispatchBatch = adapter?.dispatchBatch;
    if (!adapter || typeof dispatchBatch !== "function") {
      // Should not happen — collectBatchSubmitCandidates already filtered
      // — but stay defensive: fall back to a clear failure.
      const msg = `tick: batch submit selected but adapter/dispatchBatch missing for ${spec.provider}`;
      this.failTask(record.taskId, new Error(msg));
      return { taskId: record.taskId, status: "failed", error: msg };
    }
    try {
      const handle = await retryWithBackoff(() =>
        dispatchBatch.call(adapter, spec.model, [spec.prompt], {
          temperature: spec.temperature,
          maxTokens: spec.maxTokens,
          system: spec.systemPrompt,
        }),
      );
      record.status = "submitted";
      record.batchId = handle.batchId;
      try {
        this.store?.upsert(record);
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn(
          `[ebb-ai/scheduler] failed to persist submitted status for ${record.taskId}: ${describeErr(err)}`,
        );
      }
      return { taskId: record.taskId, status: "submitted" };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // Cross-provider routing (ROADMAP item 1): a candidate chosen WITH a
      // batch discount whose batch submission fails falls back to its OWN
      // sync path first (the receipt then records the actual — sync — path),
      // and only then, if the sync adapter is unavailable, to the next-best
      // scored candidate (handled inside dispatchProviderCall). Non-routed
      // batch tasks keep the historical behavior: fail, and let retryTask
      // re-dispatch sync.
      if (record.routingDecision) {
        // eslint-disable-next-line no-console
        console.warn(
          `[ebb-ai/scheduler] batch submit failed for ${record.taskId} (${msg}); falling back to the synchronous dispatch path for the routed candidate`,
        );
        record.status = "scheduled";
        record.batchId = undefined;
        record.error = undefined;
        return this.dispatchProviderCall(record, adapters);
      }
      record.status = "failed";
      record.completedAt = new Date().toISOString();
      record.error = msg;
      this.store?.upsert(record);
      return { taskId: record.taskId, status: "failed", error: msg };
    }
  }

  /**
   * Poll a "submitted" task's batch. The row was already claimed
   * (submitted → running) by the caller. On:
   *   - in_progress: transition back to "submitted", stay pending.
   *   - completed:   build the full receipt exactly like the sync path
   *                  (real usage tokens + provenance + signing + output
   *                  file) and mark completed.
   *   - failed/expired: mark failed with the provider error (retryTask
   *                  re-dispatches sync via the expedite path).
   */
  private async pollBatch(
    record: TaskRecord<unknown>,
    adapters: TickAdapters,
  ): Promise<TickResultEntry> {
    let spec: ProviderCallSpec;
    try {
      spec = JSON.parse(record.bodyJson ?? "null") as ProviderCallSpec;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.failTask(record.taskId, new Error(`tick: corrupt body_json: ${msg}`));
      return { taskId: record.taskId, status: "failed", error: msg };
    }
    const adapter = adapters[spec.provider];
    if (!adapter || typeof adapter.retrieveBatch !== "function") {
      // No poller available: return the row to "submitted" so a later
      // tick with a capable adapter can pick it up. Do not fail — the
      // batch is genuinely in flight at the provider.
      record.status = "submitted";
      this.store?.upsert(record);
      // eslint-disable-next-line no-console
      console.warn(
        `[ebb-ai/scheduler] tick: no retrieveBatch on adapter for ${spec.provider}; leaving ${record.taskId} submitted`,
      );
      return { taskId: record.taskId, status: "submitted" };
    }
    const batchId = record.batchId;
    if (!batchId) {
      const msg = "tick: submitted task has no batchId";
      this.failTask(record.taskId, new Error(msg));
      return { taskId: record.taskId, status: "failed", error: msg };
    }
    const ranAt = new Date();
    let poll: import("./providers/base.js").BatchRetrieveResult;
    try {
      poll = await retryWithBackoff(() => adapter.retrieveBatch!(batchId));
    } catch (err) {
      // A transient poll error must not fail a genuinely in-flight batch:
      // return it to "submitted" and let a later tick retry.
      record.status = "submitted";
      this.store?.upsert(record);
      // eslint-disable-next-line no-console
      console.warn(
        `[ebb-ai/scheduler] tick: retrieveBatch failed for ${record.taskId} (${describeErr(err)}); leaving submitted`,
      );
      return { taskId: record.taskId, status: "submitted" };
    }

    if (poll.status === "in_progress") {
      record.status = "submitted";
      this.store?.upsert(record);
      return { taskId: record.taskId, status: "submitted" };
    }
    if (poll.status === "failed" || poll.status === "expired") {
      const msg = poll.error ?? `batch ${poll.status}`;
      record.status = "failed";
      record.completedAt = new Date().toISOString();
      record.error = msg;
      this.store?.upsert(record);
      return { taskId: record.taskId, status: "failed", error: msg };
    }
    // completed — take the first (single-prompt) result.
    const first = poll.results?.[0];
    if (!first) {
      const msg = "batch completed with no results";
      record.status = "failed";
      record.completedAt = new Date().toISOString();
      record.error = msg;
      this.store?.upsert(record);
      return { taskId: record.taskId, status: "failed", error: msg };
    }
    // Shape a DispatchResult-like object so the receipt path is identical
    // to the sync dispatch.
    const result = {
      text: first.text,
      usage: first.usage,
      model: first.model ?? spec.model,
      provider: spec.provider,
      raw: poll,
    };

    let intensityG: number | undefined;
    let gridSource: GridForecast["source"] | undefined;
    let signalType: GridForecast["signalType"];
    try {
      const current = await this.fetchCurrentIntensity(record.region, ranAt);
      intensityG = current.intensityG;
      gridSource = current.source;
      signalType = current.signalType;
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn(
        `[ebb-ai/scheduler] intensity fetch for the receipt failed (${describeErr(err)}); receipt falls back to the schedule-time estimate`,
      );
    }
    const usage = result.usage;
    const inputTokens = typeof usage?.inputTokens === "number" ? usage.inputTokens : undefined;
    const outputTokens = typeof usage?.outputTokens === "number" ? usage.outputTokens : undefined;
    const actualModel = result.model;
    const totalTokens = typeof usage?.totalTokens === "number" ? usage.totalTokens : undefined;
    let receipt: CarbonReceipt | undefined;
    try {
      const actualCarbonGCo2 =
        intensityG !== undefined
          ? Math.round(
              gramsForIntensity(intensityG, {
                model: actualModel,
                inputTokens,
                outputTokens,
              }) * 10,
            ) / 10
          : (record.estimatedCarbonGCo2 ?? 0);
      const estimatedCarbonGCo2 = record.estimatedCarbonGCo2 ?? actualCarbonGCo2;
      const deltaPct =
        estimatedCarbonGCo2 > 0
          ? Math.round(
              ((actualCarbonGCo2 - estimatedCarbonGCo2) / estimatedCarbonGCo2) * 1000,
            ) / 10
          : 0;
      receipt = this.maybeSign({
        taskId: record.taskId,
        ranAt: ranAt.toISOString(),
        region: record.region,
        estimatedCarbonGCo2,
        actualCarbonGCo2,
        deltaPct,
        provider: result.provider ?? spec.provider,
        model: actualModel,
        prompt: redactPrompt(spec.prompt, spec.redactInReceipt),
        totalTokens,
        intensityGCo2PerKwh: intensityG,
        gridSource,
        signalType,
        energySource: resolveModelEnergy(actualModel).coeffs.source,
        energyResolution: resolveModelEnergy(actualModel).tier,
        // Cross-provider routing provenance (ROADMAP item 1) — see the sync
        // dispatch path. Present only when the task carried >= 2 candidates.
        routing: record.routingDecision,
      });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn(
        `[ebb-ai/scheduler] failed to build the carbon receipt for ${record.taskId}: ${describeErr(err)}; task stays completed without a receipt`,
      );
    }
    record.status = "completed";
    record.completedAt = new Date().toISOString();
    record.result = result;
    record.receipt = receipt;
    record.intensitySource = "scored";
    record.bodyJson = redactBodyJson(record.bodyJson);
    try {
      this.store?.upsert(record);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn(
        `[ebb-ai/scheduler] failed to persist completed task ${record.taskId}: ${describeErr(err)}`,
      );
    }
    if (spec.outputPath && receipt) {
      await writeOutputFile(spec.outputPath, record.taskId, result, receipt);
    }
    return { taskId: record.taskId, status: "completed" };
  }

  /**
   * Look up the intensity figure (and its feed provenance) used for the
   * actual side of a receipt: re-fetch the forecast and pick the entry
   * closest to the moment the task ran.
   */
  private async fetchCurrentIntensity(
    region: string,
    at: Date,
  ): Promise<{
    intensityG: number;
    source: GridForecast["source"];
    signalType: GridForecast["signalType"];
  }> {
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
    return {
      intensityG: best?.carbonIntensityGCo2PerKwh ?? 400,
      source: forecast.source,
      // Prefer the chosen entry's signal (WattTime sets it per-entry),
      // fall back to the forecast-level marker.
      signalType: best?.signalType ?? forecast.signalType,
    };
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

/**
 * @deprecated Strict-minimum window pick, retained for API compat. Every
 * committing scheduler path now uses the shared {@link selectWindow}
 * (randomized cleanest-tolerance-band tie-break) so committed tasks spread
 * across the clean band instead of all colliding on the single trough hour
 * (§2.1). This helper still returns the strict minimum: it delegates to
 * `selectWindow` with an rng pinned to 0, which always picks the first
 * (cheapest) entry in the sorted band. Prefer `selectWindow` for new code.
 */
export function pickBestWindow(
  entries: GridForecastEntry[],
  deadline: Date,
): GridForecastEntry | undefined {
  // rng pinned to 0 → floor(0 * band.length) === 0 → the cheapest entry,
  // reproducing the historical strict-minimum behaviour exactly.
  return selectWindow(entries, deadline, { rng: () => 0 })?.chosen;
}

/**
 * Retry an async function with exponential backoff: up to 4 attempts
 * total (1 initial + 3 retries at 1s, 4s, 16s waits). Retries only on
 * errors that are safe to re-send: 429 rate-limits, 5xx, and network
 * errors raised *before* the request could reach the provider
 * (ECONNREFUSED / ENOTFOUND / EAI_AGAIN). Ambiguous mid-flight errors
 * (ETIMEDOUT, ECONNRESET) are NOT retried — the provider may already
 * have accepted and billed the call. Other 4xx bubble up immediately.
 *
 * This is the single retry policy for ebb-ai: provider adapters
 * construct their SDK clients with `maxRetries: 0` so vendor-side
 * retries cannot multiply with this one.
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
  const e = err as {
    status?: number;
    statusCode?: number;
    code?: string;
    message?: string;
    cause?: { code?: string };
  };
  const status = e.status ?? e.statusCode;
  if (typeof status === "number") {
    if (status === 429) return true;
    if (status >= 500 && status < 600) return true;
    return false;
  }
  // Node fetch / undici errors often wrap the syscall error in `cause`.
  const code = e.code ?? e.cause?.code;
  if (typeof code === "string") {
    // Only pre-connect failures are safely retryable: the request never
    // reached the provider, so re-sending cannot double-bill. ETIMEDOUT /
    // ECONNRESET happen mid-flight — the provider may have accepted the
    // call — so they are deliberately NOT in this list.
    if (["ECONNREFUSED", "ENOTFOUND", "EAI_AGAIN"].includes(code)) {
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
 * own `redactInReceipt` array. Vendor-shaped credential patterns only:
 * a previous generic `[A-Z]{2,3}_[A-Z0-9]{6,}` catch-all mangled
 * legitimate prose (DB_PASSWORD, US-MIDA-PJM-style codes, ISO_8601)
 * while missing every real vendor key shape below.
 */
const DEFAULT_REDACTION_PATTERNS: ReadonlyArray<RegExp> = [
  /sk-(?:ant-)?[A-Za-z0-9_\-]{20,}/g,               // Anthropic / OpenAI legacy
  /sk-proj-[A-Za-z0-9_\-]{20,}/g,                   // OpenAI project keys
  /\bBearer\s+[A-Za-z0-9_\-.]{20,}/gi,              // OAuth bearer tokens
  /\bAKIA[0-9A-Z]{16}\b/g,                          // AWS access key id
  /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{36}\b/g,   // GitHub tokens
  /\bgithub_pat_[A-Za-z0-9_]{22,}\b/g,              // GitHub fine-grained PAT
  /\bAIza[0-9A-Za-z_\-]{35}\b/g,                    // Google API key
  /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g,              // Slack tokens
  /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g, // JWT
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
 * Redact secrets out of a persisted provider-call body. Applied when a
 * task reaches "completed" or "cancelled" — the live dispatch always
 * uses the original body, and only the final ledger write is rewritten.
 *
 * Deliberately NOT applied on "failed": `retryTask` re-dispatches the
 * persisted body, so a failed task must retain the caller's original
 * prompt until it either succeeds (redacted then) or is cancelled.
 */
function redactBodyJson(bodyJson: string | undefined): string | undefined {
  if (!bodyJson) return bodyJson;
  try {
    const spec = JSON.parse(bodyJson) as Partial<ProviderCallSpec>;
    if (!spec || spec.type !== "provider_call") return bodyJson;
    if (typeof spec.prompt === "string") {
      spec.prompt = redactPrompt(spec.prompt, spec.redactInReceipt);
    }
    if (typeof spec.systemPrompt === "string") {
      spec.systemPrompt = redactPrompt(spec.systemPrompt, spec.redactInReceipt);
    }
    return JSON.stringify(spec);
  } catch {
    // Corrupt body — leave it untouched rather than destroy evidence.
    return bodyJson;
  }
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
