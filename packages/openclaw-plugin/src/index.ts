/**
 * ebb-ai OpenClaw plugin — auto-defer "do it later" tasks to the cleanest
 * electricity-grid hour. Native OpenClaw tool plugin built with
 * `defineToolPlugin`, which registers the tools so they reach agent
 * sessions.
 *
 * Verify a build with `openclaw plugins inspect ebb --runtime --json` — it
 * lists every tool. Note: plain `openclaw plugins inspect ebb` reports
 * `Shape: non-capability` for tool plugins in OpenClaw 2026.5.18; that is
 * the expected label for this plugin kind, not an error.
 *
 * Scheduled provider-call tasks are executed in-process: a background loop
 * runs `Scheduler.tick`, dispatching due tasks through OpenClaw's own model
 * runtime (`api.runtime.llm.complete`, captured from a tool-call context) —
 * no separate API key required — or through `ANTHROPIC_API_KEY` /
 * `OPENAI_API_KEY` as a fallback.
 *
 * Startup / restart behaviour (important — read before relying on the
 * "background loop"): the loop is started at module load (see
 * `bootstrapDispatcherOnStartup` below), which the manifest's
 * `activation.onStartup:true` triggers when the gateway boots. That catches
 * overdue tasks after a gateway restart WITHOUT waiting for a user to invoke
 * a tool. BUT the two things a task needs to actually *deliver* only exist
 * after the first tool call in the fresh process:
 *   - the OpenClaw runtime LLM bridge (`api.runtime.llm.complete`) — captured
 *     from a tool-call `context`, never present at boot; and
 *   - the gateway chat/config (`api.config`) used for chat/telegram delivery.
 * So at boot the dispatcher can dispatch via a direct API key
 * (ANTHROPIC_API_KEY / OPENAI_API_KEY) if one is set, but tasks whose only
 * viable path is the runtime bridge are SKIPPED (left `scheduled`, logged
 * once per provider) until the first tool call captures the bridge — see
 * `runDispatchTick`. This is honest about the limitation rather than failing
 * such tasks: a restart alone cannot recover bridge-only or chat-delivery
 * tasks; the first tool call in the new process does.
 *
 * Shares the SQLite ledger at ~/.ebb-ai/queue.db with the @ebb-ai/mcp MCP
 * server and the @ebb-ai/cli CLI — a task deferred in OpenClaw shows up in
 * `ebb stats` and vice versa. Tool names match the MCP server surface.
 *
 * Tools:
 *   - schedule_task       — queue a task at the cleanest hour
 *   - recommend_window    — preview the cleanest hour (read-only, no DB)
 *   - check_queue_status  — list all tasks / detail one (read-only)
 *   - cancel_task         — cancel a queued task (idempotent)
 *   - get_grid_forecast   — hourly carbon-intensity forecast (read-only, no DB)
 *   - update_deadline     — move a queued task's deadline
 *   - cancel_all          — cancel every queued/scheduled task
 *   - set_delivery        — choose how a task's result is delivered
 *   - expedite_task       — dispatch a task now, skipping the clean window
 *   - retry_task          — re-dispatch a failed task
 *
 * When a task completes, its result is delivered through the chosen modes
 * (chat / telegram / webhook / file) and is always kept in the queue too.
 */

import { Type, type TSchema } from "typebox";
// @ts-expect-error -- the openclaw plugin SDK is provided by the OpenClaw runtime at load time
import { defineToolPlugin } from "openclaw/plugin-sdk/tool-plugin";

import {
  buildDefaultGridFeed,
  recommendWindow,
  resolveRegion,
  Scheduler,
  TaskStore,
  type ProviderAdapter,
  type ProviderCallSpec,
  type TaskRecord,
  type TickResult,
} from "@ebb-ai/core";

import {
  availableProviders,
  buildAdapters,
  captureOpenClawRuntime,
  dispatchCapability,
  getCapturedOpenClawConfig,
  inferProvider,
  type DispatchAdapters,
} from "./dispatch.js";

import {
  deliverResult,
  getDeliveryConfig,
  readDeliveryRecord,
  recordDeliveryOutcomes,
  scanDeliveryOptions,
  setDeliveryConfig,
  telegramTarget,
  validateDeliveryConfig,
  type DeliveryConfig,
  type DeliveryMode,
  type ReportFormat,
} from "./delivery.js";

import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { mkdirSync } from "node:fs";

type PluginConfig = {
  dbPath?: string;
  defaultRegion?: string;
};

// Loud SYNTHETIC-data disclosure, mirroring the @ebb-ai/mcp server so the two
// surfaces read identically. "mock" grid source ⇒ the carbon numbers are
// illustrative, not measured.
const SYNTHETIC_GRID_WARNING =
  "⚠ SYNTHETIC (mock) grid data — no live grid feed was available for this region, " +
  "so the carbon numbers above are illustrative, not measured. " +
  "Set EBB_ELECTRICITY_MAPS_API_KEY (or another supported feed key) for real intensity.";

/**
 * Surface receipt provenance for a completed/expedited/retried task, mirroring
 * the MCP server: actual vs estimated grams, the signed delta, the grid
 * intensity + its source ("mock" ⇒ SYNTHETIC), and the energy-coefficient
 * confidence tier. Returns undefined when there is no receipt yet.
 */
function receiptProvenance(
  receipt: import("@ebb-ai/core").CarbonReceipt | undefined,
): Record<string, unknown> | undefined {
  if (!receipt) return undefined;
  const out: Record<string, unknown> = {};
  if (typeof receipt.estimatedCarbonGCo2 === "number")
    out.estimated_carbon_g_co2 = receipt.estimatedCarbonGCo2;
  if (typeof receipt.actualCarbonGCo2 === "number")
    out.actual_carbon_g_co2 = receipt.actualCarbonGCo2;
  if (typeof receipt.deltaPct === "number") out.delta_pct = receipt.deltaPct;
  if (typeof receipt.intensityGCo2PerKwh === "number")
    out.intensity_g_co2_per_kwh = receipt.intensityGCo2PerKwh;
  if (receipt.gridSource !== undefined) {
    out.grid_source = receipt.gridSource;
    if (receipt.gridSource === "mock")
      out.grid_source_note = "SYNTHETIC (mock) grid data, not a measurement";
  }
  if (receipt.energySource !== undefined) out.energy_source = receipt.energySource;
  if (receipt.energyResolution !== undefined)
    out.energy_resolution = receipt.energyResolution;
  return out;
}

type ToolDefinition = {
  name: string;
  label?: string;
  description: string;
  parameters: TSchema;
  optional?: boolean;
  execute: (params: never, config: PluginConfig, context?: unknown) => unknown;
};
type ToolFactory = (def: ToolDefinition) => unknown;

// ── Grid feed (no SQLite) ───────────────────────────────────────────────────
// The grid feed has no database dependency, so `recommend_window` and
// `get_grid_forecast` keep working even when the SQLite queue cannot open.
let cachedGridFeed: ReturnType<typeof buildDefaultGridFeed> | undefined;

function getGridFeed(): ReturnType<typeof buildDefaultGridFeed> {
  cachedGridFeed ??= buildDefaultGridFeed();
  return cachedGridFeed;
}

// ── Queue runtime (SQLite-backed) ───────────────────────────────────────────
// Built lazily on the first queue-tool call. Constructing TaskStore here (not
// at module load) keeps plugin import side-effect free.
type QueueRuntime = {
  store: TaskStore;
  scheduler: Scheduler;
  dbPath: string;
};
let cachedQueueRuntime: QueueRuntime | undefined;

function resolveDbPath(cfg: PluginConfig): string {
  const path = cfg.dbPath ?? join(homedir(), ".ebb-ai", "queue.db");
  try {
    mkdirSync(dirname(path), { recursive: true });
  } catch {
    // ignore EEXIST — the parent dir already exists
  }
  return path;
}

function getQueueRuntime(config: PluginConfig): QueueRuntime {
  const dbPath = resolveDbPath(config);
  // Cache is keyed by the resolved DB path. The startup bootstrap opens the
  // DEFAULT path before any tool call; if the plugin is then configured with
  // a custom `dbPath`, the first tool call must re-open against it rather than
  // silently keep serving the default-path handle. (Also lets the test suite
  // point successive calls at different temp DBs.)
  if (cachedQueueRuntime && cachedQueueRuntime.dbPath === dbPath) {
    return cachedQueueRuntime;
  }

  let store: TaskStore;
  try {
    store = new TaskStore({ dbPath });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(
      `ebb-ai: could not open the task queue at ${dbPath} (${msg}). The queue ` +
        `uses Node's built-in node:sqlite — make sure the OpenClaw gateway runs ` +
        `on Node 22.5 or newer. (recommend_window and get_grid_forecast work ` +
        `without the queue.)`,
    );
  }

  const scheduler = new Scheduler({
    feed: getGridFeed(),
    store,
    defaultRegion: resolveRegion(undefined, config.defaultRegion).region,
    eager: false,
  });
  cachedQueueRuntime = { store, scheduler, dbPath };
  // Re-point the background dispatcher at whatever config is now active, so a
  // custom `dbPath` supplied by the first tool call is what the loop sweeps
  // (the startup bootstrap starts the loop against the default path).
  activeDispatchConfig = config;
  ensureDispatcher(config);
  return cachedQueueRuntime;
}

// ── In-process dispatcher ───────────────────────────────────────────────────
// Provider-call tasks only *execute* when Scheduler.tick runs. The OpenClaw
// gateway is long-lived, so the plugin drains due tasks on a background
// interval. The interval is started BOTH at module load (see
// `bootstrapDispatcherOnStartup`, driven by the manifest's
// `activation.onStartup:true`) AND lazily on the first queue-tool call, so
// after a gateway restart already-overdue persisted tasks are picked up
// without waiting for a user to invoke a tool. See the file header for the
// hard limitation: at boot only the direct-API-key path can dispatch — tasks
// whose only route is the OpenClaw runtime bridge, and any chat/telegram
// delivery, need the first tool call of the fresh process to capture the
// bridge and the gateway config. (The CLI's `ebb tick` is the other
// dispatcher, for non-gateway setups.)

const DISPATCH_INTERVAL_MS = 60_000;
let dispatcherStarted = false;
// The config the background sweep runs against. Seeded by the startup
// bootstrap (default path) and re-pointed by getQueueRuntime once a tool call
// supplies the real plugin config (which may carry a custom dbPath).
let activeDispatchConfig: PluginConfig = {};

// Skipped-provider log throttle: emit the "no adapter yet" warning once per
// provider per process, not once per sweep, so a boot with no keys doesn't
// spam the gateway log every 60s.
const loggedSkippedProviders = new Set<string>();

/**
 * Drain every due scheduled task once. Exported so tests and the smoke
 * script can run a single deterministic sweep. `adaptersOverride` lets a
 * test inject a stub instead of the runtime-bridge / HTTP adapters.
 *
 * Tasks whose provider has no adapter yet are SKIPPED, not failed. At boot
 * (before the first tool call captures the runtime bridge) or when a
 * provider's API key is absent, `Scheduler.tick` would otherwise mark such a
 * task `failed` with "no adapter configured for provider …". We roll that
 * transient failure straight back to `scheduled` so the task keeps its clean
 * window and is retried once an adapter becomes available, and we log the gap
 * once per provider.
 */
export async function runDispatchTick(
  config: PluginConfig,
  adaptersOverride?: DispatchAdapters,
): Promise<TickResult> {
  const { scheduler, store } = getQueueRuntime(config);
  const adapters = adaptersOverride ?? buildAdapters();
  const covered = new Set<string>(
    Object.entries(adapters)
      .filter(([, a]) => a !== undefined)
      .map(([p]) => p),
  );

  // Snapshot which due scheduled tasks have NO adapter for their provider.
  // Log the gap once per provider so the reason a task is still `scheduled`
  // after a restart is visible without spamming every sweep.
  const uncovered = new Set<string>(); // task ids we expect tick to fail
  for (const rec of store.list({ status: "scheduled" })) {
    const provider = providerOf(rec);
    if (!provider) continue;
    if (covered.has(provider)) continue;
    uncovered.add(rec.taskId);
    if (!loggedSkippedProviders.has(provider)) {
      loggedSkippedProviders.add(provider);
      // eslint-disable-next-line no-console
      console.warn(
        `[ebb-ai] dispatcher: no adapter for provider "${provider}" yet ` +
          `(runtime bridge is captured on the first tool call; ${provider === "openai" ? "OPENAI_API_KEY" : "ANTHROPIC_API_KEY"} is not set). ` +
          `Leaving those tasks scheduled; they dispatch once an adapter is available.`,
      );
    }
  }

  // DispatchAdapter omits dispatchBatch on purpose — Scheduler.tick guards
  // `typeof adapter.dispatchBatch === "function"`, so dispatch stays
  // synchronous. The cast is safe under that runtime guard.
  const result = await scheduler.tick(
    adapters as { anthropic?: ProviderAdapter; openai?: ProviderAdapter },
  );

  // Undo any "no adapter configured" failure tick may have written: those
  // tasks must stay `scheduled`, not be marked terminal. Drop them from the
  // per-task results and adjust the aggregate counters so callers/tests see a
  // genuine skip rather than a failure.
  const skippedIds = new Set<string>();
  for (const entry of result.results) {
    if (
      entry.status === "failed" &&
      uncovered.has(entry.taskId) &&
      typeof entry.error === "string" &&
      /no adapter configured for provider/i.test(entry.error)
    ) {
      restoreToScheduled(store, entry.taskId);
      skippedIds.add(entry.taskId);
    }
  }
  if (skippedIds.size > 0) {
    result.results = result.results.filter((e) => !skippedIds.has(e.taskId));
    result.failed = Math.max(0, result.failed - skippedIds.size);
  }

  // Deliver the result of every task this sweep just completed.
  for (const entry of result.results) {
    if (entry.status === "completed") {
      await deliverCompletedTask(scheduler, entry.taskId);
    }
  }
  return result;
}

/** Read a persisted task's provider from its serialized body, if any. */
function providerOf(rec: TaskRecord<unknown>): string | undefined {
  if (!rec.bodyJson) return undefined;
  try {
    const spec = JSON.parse(rec.bodyJson) as Partial<ProviderCallSpec>;
    return spec?.type === "provider_call" ? spec.provider : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Roll a task tick just marked `failed` (for a missing adapter) back to
 * `scheduled`, preserving its chosen window so a later sweep retries it.
 * Best-effort — a storage error here must never crash the dispatcher.
 */
function restoreToScheduled(store: TaskStore, taskId: string): void {
  try {
    const rec = store.get(taskId);
    if (!rec || rec.status !== "failed") return;
    rec.status = "scheduled";
    rec.error = undefined;
    rec.completedAt = undefined;
    store.upsert(rec);
  } catch {
    // leave it as-is; the next sweep re-evaluates from the store
  }
}

/**
 * Deliver one completed task's result through its configured channels.
 * Never throws — a delivery failure must not disturb the dispatcher; the
 * result is always retained in the queue regardless.
 */
async function deliverCompletedTask(
  scheduler: Scheduler,
  taskId: string,
): Promise<void> {
  try {
    const task = scheduler.getTask(taskId);
    if (!task) return;
    const openclawConfig = getCapturedOpenClawConfig();
    const chatAvailable = telegramTarget(openclawConfig) !== undefined;
    const cfg = await getDeliveryConfig(taskId, chatAvailable);
    const outcomes = await deliverResult(task, cfg, openclawConfig);
    // Persist the per-mode outcomes so delivery is auditable afterwards
    // via check_queue_status (the `delivery` field).
    await recordDeliveryOutcomes(taskId, cfg, outcomes);
  } catch {
    // best-effort: the result stays retrievable via check_queue_status
  }
}

/** Start the background dispatch loop — once per process. */
function ensureDispatcher(config: PluginConfig): void {
  activeDispatchConfig = config;
  if (dispatcherStarted) return;
  dispatcherStarted = true;
  const sweep = (): void => {
    // A failing sweep must never crash the gateway; per-task failures are
    // recorded on the task records by Scheduler.tick. Always reads the
    // currently-active config so a later custom-dbPath tool call re-points it.
    void runDispatchTick(activeDispatchConfig).catch(() => {});
  };
  // First sweep shortly after start — catches already-overdue tasks.
  setTimeout(sweep, 4000).unref?.();
  setInterval(sweep, DISPATCH_INTERVAL_MS).unref?.();
}

// ── Startup bootstrap ────────────────────────────────────────────────────────
// The OpenClaw plugin SDK's `defineToolPlugin` surface exposes only
// { id, name, description, configSchema, tools } — there is NO explicit
// init/activate/onStartup lifecycle hook to register a callback on (the SDK
// is injected by the gateway at load time and offers no such seam; the
// manifest's `activation.onStartup:true` governs *when the module is loaded*,
// not a hook we can pass a function to). So we start the dispatcher at module
// load, guarded behind a short unref'd `setTimeout` for two reasons:
//   1. it defers the SQLite open past import so a bad DB path fails a tool
//      call (with a clear message) rather than crashing plugin load; and
//   2. `.unref()` keeps the timer from holding a short-lived process open
//      (tests, `--version`, inspect), while a long-lived gateway keeps
//      draining every DISPATCH_INTERVAL_MS.
// `ensureDispatcher` is idempotent, so the later first-tool-call path is a
// no-op once this has fired. `EBB_DISABLE_STARTUP_DISPATCH=1` opts out (tests
// / embedding contexts that drive `runDispatchTick` by hand).
let startupBootstrapped = false;
export function bootstrapDispatcherOnStartup(
  config: PluginConfig = {},
  env: Record<string, string | undefined> = process.env,
): void {
  if (startupBootstrapped) return;
  startupBootstrapped = true;
  if (env.EBB_DISABLE_STARTUP_DISPATCH === "1") return;
  // Defer the queue open + dispatcher start off the import path.
  setTimeout(() => {
    try {
      // getQueueRuntime() calls ensureDispatcher() internally.
      getQueueRuntime(config);
    } catch {
      // A missing/broken DB at boot must never crash plugin load; the queue
      // opens (with a clear error) on the first tool call instead.
    }
  }, 1000).unref?.();
}

// Kick the dispatcher at module load — the manifest's activation.onStartup
// loads this module when the gateway boots, so persisted overdue tasks are
// swept without waiting for a user to invoke a tool.
bootstrapDispatcherOnStartup();

export default defineToolPlugin({
  id: "ebb",
  name: "ebb-ai — carbon-aware deferral",
  description:
    'Auto-defer "do it later" tasks to the cleanest electricity-grid hour inside the deadline.',
  configSchema: Type.Object(
    {
      dbPath: Type.Optional(
        Type.String({
          description:
            "Override the SQLite queue path. Defaults to ~/.ebb-ai/queue.db (shared with the @ebb-ai/mcp server and @ebb-ai/cli).",
        }),
      ),
      defaultRegion: Type.Optional(
        Type.String({
          description:
            "Default electricity-grid region when a tool call omits one. Examples: GB, US-CAL-CISO, US-TEX-ERCO, US-NE-ISNE, US-MIDA-PJM, FR, DE. When unset, ebb-ai guesses from the host machine's timezone (London→GB, Paris→FR, Berlin→DE, US Pacific→US-CAL-CISO, US Eastern→US-MIDA-PJM) and otherwise falls back to GB. Set this explicitly for precise control.",
        }),
      ),
    },
    { additionalProperties: false },
  ),
  tools: (tool: ToolFactory) => [
    // ── schedule_task ─────────────────────────────────────────────────────
    tool({
      name: "schedule_task",
      label: "Schedule task at cleanest grid hour",
      description:
        "Queue an AI task to dispatch at the cleanest grid hour inside the given deadline. " +
        '**Invoke whenever the user phrases a request with deferral language:** "do this later", ' +
        '"by tomorrow", "tonight", "overnight", "by EOD", "sometime this week", "when you have a ' +
        'moment", "remind me to", "queue this up", "schedule this", "no rush", "not urgent". ' +
        "Convert the user's wording to an ISO-8601 deadline and pass the task description as the " +
        "prompt. The scheduler picks the cleanest electricity-grid hour inside the deadline " +
        "(40-70 % lower carbon vs running immediately) and writes a per-task carbon receipt. " +
        "Returns task_id, scheduled UTC time, and region. Good fits: nightly digests, batch " +
        "summaries, research sweeps, evaluator runs, report generation — anything the user is " +
        "fine waiting on. Do NOT invoke for live chat, interactive code edits, or any task the " +
        "user is actively waiting to see complete. Batch routing (50% cheaper via a provider " +
        "Batch API) applies only on the direct API-key dispatch path and only when the deadline " +
        "is far enough out (>24h); the OpenClaw runtime-bridge path cannot batch (its adapter has " +
        "no batch surface) and runs the task synchronously at the chosen hour.",
      parameters: Type.Object({
        prompt: Type.String({
          description:
            "The user's task description — what should run when the cleanest hour fires.",
        }),
        deadline: Type.String({
          description: "ISO-8601 timestamp by which the task must complete. Required.",
          format: "date-time",
        }),
        region: Type.Optional(
          Type.String({
            description:
              "Optional grid-region override. Defaults to the configured defaultRegion, else a timezone guess, else GB.",
          }),
        ),
        carbon_budget_g: Type.Optional(
          Type.Number({
            description:
              "Optional hard cap on grams CO2e for this task. Windows above the cap are dropped before selection.",
          }),
        ),
        model: Type.Optional(
          Type.String({
            description:
              "Optional provider model identifier. Pair the model with its provider: " +
              "Anthropic models are 'claude-*' (e.g. 'claude-sonnet-4-6', 'claude-opus-4-1'); " +
              "OpenAI models are 'gpt-*' or 'o<n>*' (e.g. 'gpt-4o', 'o3-mini'). When `provider` " +
              "is omitted it is inferred from this prefix (gpt-*/o<n>* → openai, claude-* → " +
              "anthropic; default anthropic). Honoured only on the direct API-key dispatch path; " +
              "the OpenClaw runtime bridge always uses the gateway agent's own model.",
          }),
        ),
        provider: Type.Optional(
          Type.Union([Type.Literal("anthropic"), Type.Literal("openai")], {
            description:
              "Which provider dispatches this task on the API-key path. If omitted, inferred " +
              "from the model prefix (gpt-*/o<n>* → openai, claude-* → anthropic; default " +
              "anthropic). On the OpenClaw runtime-bridge path the gateway's own model runs " +
              "regardless, so this only matters when dispatching via ANTHROPIC_API_KEY / " +
              "OPENAI_API_KEY.",
          }),
        ),
        deliver: Type.Optional(
          Type.Array(
            Type.Union([
              Type.Literal("chat"),
              Type.Literal("telegram"),
              Type.Literal("webhook"),
              Type.Literal("file"),
              Type.Literal("queue"),
            ]),
            {
              description:
                "How to deliver the result when the task completes — one or more of: chat (the user's active OpenClaw chat), telegram, webhook, file, queue. If omitted, ASK the user (see next_step in the result) then call set_delivery. Default: chat.",
            },
          ),
        ),
        webhook_url: Type.Optional(
          Type.String({ description: "Target URL when deliver includes 'webhook'." }),
        ),
        file_path: Type.Optional(
          Type.String({ description: "Output path when deliver includes 'file'." }),
        ),
        file_format: Type.Optional(
          Type.Union(
            [
              Type.Literal("md"),
              Type.Literal("html"),
              Type.Literal("txt"),
              Type.Literal("json"),
            ],
            { description: "Report format for 'file' delivery. Default: md." },
          ),
        ),
      }),
      async execute(
        params: {
          prompt: string;
          deadline: string;
          region?: string;
          carbon_budget_g?: number;
          model?: string;
          provider?: "anthropic" | "openai";
          deliver?: string[];
          webhook_url?: string;
          file_path?: string;
          file_format?: string;
        },
        config: PluginConfig,
        context?: unknown,
      ) {
        captureOpenClawRuntime(context);
        const { scheduler, dbPath } = getQueueRuntime(config);
        const { region, source } = resolveRegion(params.region, config.defaultRegion);
        const explicitModel = params.model?.trim();

        // Provider: explicit param wins; else infer from the model prefix
        // (gpt-*/o<n>* → openai, claude-* → anthropic; default anthropic).
        const provider = params.provider ?? inferProvider(explicitModel);
        const providerInferred = params.provider === undefined;
        // A concrete model is stored for the direct-API-key path and for the
        // audit record; the OpenClaw runtime bridge ignores it and uses the
        // gateway agent's own model. Default the model to the chosen
        // provider's flagship so an openai task never carries a claude model.
        const model =
          explicitModel || (provider === "openai" ? "gpt-4o" : "claude-sonnet-4-6");

        // How this task will execute when due: "openclaw-runtime" (gateway
        // model, no key), "api-key", or "unconfigured".
        const dispatch = dispatchCapability();

        // Key validation on the API-key dispatch path: if the ONLY route is a
        // direct API key and the chosen provider has none, the task would
        // fail 100% of the time at dispatch (and, worse, a gpt-* model would
        // be POSTed to api.anthropic.com under the old hardcoded provider).
        // Reject here so the failure surfaces at schedule time, not silently
        // at the clean-grid hour. On the runtime-bridge path the gateway model
        // runs regardless of `provider`, so no rejection is warranted there;
        // when unconfigured we WARN loudly instead of rejecting, because this
        // same call may have just captured the bridge (context-dependent).
        if (dispatch === "api-key") {
          const providers = availableProviders();
          if (!providers.has(provider)) {
            const keyName =
              provider === "openai" ? "OPENAI_API_KEY" : "ANTHROPIC_API_KEY";
            throw new Error(
              `schedule_task rejected: this task would dispatch via provider "${provider}" ` +
                `(${providerInferred ? `inferred from model "${model}"` : "explicitly requested"}), ` +
                `but ${keyName} is not set on the gateway. Set ${keyName} and retry, or choose a ` +
                `provider whose key is configured (${[...providers].join(", ") || "none"}).`,
            );
          }
        }

        const task = await scheduler.enqueueProviderCall(
          {
            type: "provider_call",
            provider,
            model,
            prompt: params.prompt,
          },
          {
            deadline: new Date(params.deadline),
            region,
            carbonBudgetG: params.carbon_budget_g,
          },
        );

        // Result delivery — store the preference if the caller already
        // provided one; otherwise the result asks the agent to collect it.
        const deliveryOptions = scanDeliveryOptions(getCapturedOpenClawConfig());
        let deliverySet: DeliveryConfig | undefined;
        let deliveryError: string | undefined;
        if (params.deliver && params.deliver.length > 0) {
          const cfg: DeliveryConfig = {
            modes: params.deliver as DeliveryMode[],
            webhookUrl: params.webhook_url,
            filePath: params.file_path,
            format: params.file_format as ReportFormat | undefined,
          };
          deliveryError = validateDeliveryConfig(cfg) ?? undefined;
          if (!deliveryError) {
            await setDeliveryConfig(task.taskId, cfg);
            deliverySet = cfg;
          }
        }

        // Grid-source disclosure: the scheduler scores against the grid feed,
        // which falls back to a deterministic SYNTHETIC curve when no live
        // feed key is set. Surface that honestly on the schedule response.
        const gridSource = task.receipt?.gridSource ?? getGridFeed().source;
        const synthetic = gridSource === "mock";

        // Warn (do not reject) when nothing can dispatch yet: the bridge may
        // be captured on a later tool call, so the task is still worth queuing.
        const unconfiguredWarning =
          dispatch === "unconfigured"
            ? "No dispatch route is configured yet: no ANTHROPIC_API_KEY / OPENAI_API_KEY, " +
              "and the OpenClaw runtime bridge has not been captured. The task is queued and " +
              "will dispatch once a route is available (the bridge is captured on the first " +
              "tool call in this process, or set a provider API key)."
            : undefined;

        return {
          task_id: task.taskId,
          status: task.status,
          region: task.region,
          region_source: source,
          provider,
          provider_source: providerInferred ? "inferred" : "request",
          model,
          scheduled_for: task.scheduledFor ?? null,
          estimated_carbon_g_co2: task.estimatedCarbonGCo2 ?? null,
          grid_source: gridSource,
          persisted_to: dbPath,
          dispatch,
          delivery: deliverySet ?? null,
          delivery_options: deliveryOptions
            .filter((o) => o.available)
            .map((o) => `${o.mode} — ${o.detail}`),
          next_step: deliverySet
            ? "Result delivery is configured."
            : "Ask the user how they want this task's result delivered — they may pick several from delivery_options (default: chat). Then call set_delivery with the task_id and their choice.",
          ...(synthetic ? { synthetic_grid_data: SYNTHETIC_GRID_WARNING } : {}),
          ...(deliveryError ? { delivery_error: deliveryError } : {}),
          ...(unconfiguredWarning ? { warning: unconfiguredWarning } : {}),
          ...(explicitModel && dispatch === "openclaw-runtime"
            ? {
                note:
                  `model "${explicitModel}" is honoured only on the direct ` +
                  `API-key dispatch path; via the OpenClaw runtime bridge the ` +
                  `task runs on the gateway agent's configured model.`,
              }
            : {}),
        };
      },
    }),

    // ── recommend_window ──────────────────────────────────────────────────
    tool({
      name: "recommend_window",
      label: "Preview cleanest dispatch window",
      description:
        "Preview the cleanest in-deadline window WITHOUT queueing the task. Returns the chosen " +
        "hour, the projected carbon footprint, the % savings vs dispatching right now, and the " +
        "top alternatives. Use this when the user is uncertain about deferring — show them the " +
        "cleanest available hour before they commit. Read-only; does not touch the task queue.",
      parameters: Type.Object({
        deadline: Type.String({
          description: "ISO-8601 timestamp by which the task must complete.",
          format: "date-time",
        }),
        region: Type.Optional(Type.String()),
        carbon_budget_g: Type.Optional(Type.Number()),
      }),
      async execute(
        params: { deadline: string; region?: string; carbon_budget_g?: number },
        config: PluginConfig,
        context?: unknown,
      ) {
        captureOpenClawRuntime(context);
        const { region } = resolveRegion(params.region, config.defaultRegion);
        return await recommendWindow(
          {
            deadline: new Date(params.deadline),
            region,
            carbonBudgetG: params.carbon_budget_g,
          },
          { feed: getGridFeed() },
        );
      },
    }),

    // ── check_queue_status ────────────────────────────────────────────────
    tool({
      name: "check_queue_status",
      label: "Check ebb-ai queue status",
      description:
        "List all ebb-ai tasks (no args) or fetch detail + carbon receipt for one task (pass " +
        "task_id). Use when the user asks 'what's in my queue', 'did that task run', 'show me my " +
        "receipts', or wants to verify a scheduled task. Read-only.",
      parameters: Type.Object({
        task_id: Type.Optional(
          Type.String({ description: "Optional — the id of one task to detail." }),
        ),
      }),
      async execute(
        params: { task_id?: string },
        config: PluginConfig,
        context?: unknown,
      ) {
        captureOpenClawRuntime(context);
        const { scheduler } = getQueueRuntime(config);
        const tasks = scheduler.listPersistedTasks();
        if (params.task_id) {
          const task = tasks.find((t) => t.taskId === params.task_id);
          if (!task) {
            throw new Error(
              `No ebb-ai task found with id ${params.task_id}. ` +
                "Call this tool with no arguments to list every task.",
            );
          }
          // Omit bodyJson — it is the internal serialized request spec and
          // is misleading as a status field: it shows the requested model,
          // not the model that actually ran. The receipt records what ran.
          const { bodyJson: _bodyJson, ...view } = task;
          const provenance = receiptProvenance(task.receipt);
          const synthetic = task.receipt?.gridSource === "mock";
          return {
            ...view,
            // Surface receipt provenance (actual/delta/intensity/grid_source/
            // energy_source) in one place, mirroring the MCP server.
            ...(provenance ? { receipt_provenance: provenance } : {}),
            ...(synthetic ? { synthetic_grid_data: SYNTHETIC_GRID_WARNING } : {}),
            delivery: (await readDeliveryRecord(params.task_id)) ?? null,
          };
        }
        return {
          total: tasks.length,
          tasks: tasks.map((t) => ({
            task_id: t.taskId,
            status: t.status,
            region: t.region,
            scheduled_for: t.scheduledFor ?? null,
            // "submitted" (v0.12 batch routing): the task is awaiting Batch API
            // results. Surface the batch id whenever the core recorded one so a
            // submitted task is legible instead of looking stuck.
            ...(t.batchId ? { batch_id: t.batchId } : {}),
          })),
        };
      },
    }),

    // ── cancel_task ───────────────────────────────────────────────────────
    tool({
      name: "cancel_task",
      label: "Cancel an ebb-ai task",
      description:
        "Cancel a queued or scheduled ebb-ai task. Idempotent — calling it on a task that is " +
        "already completed/failed/cancelled returns the existing status without error. Throws " +
        "only if task_id is unknown. Use when the user says 'cancel that task', 'never mind, " +
        "drop it', 'I don't need that anymore'.",
      parameters: Type.Object({
        task_id: Type.String({ description: "The id of the task to cancel." }),
      }),
      async execute(
        params: { task_id: string },
        config: PluginConfig,
        context?: unknown,
      ) {
        captureOpenClawRuntime(context);
        const { scheduler } = getQueueRuntime(config);
        const result = scheduler.cancelTask(params.task_id);
        return {
          task_id: params.task_id,
          status: result.status,
          completed_at: result.completedAt ?? null,
        };
      },
    }),

    // ── get_grid_forecast ─────────────────────────────────────────────────
    tool({
      name: "get_grid_forecast",
      label: "Forecast grid carbon intensity",
      description:
        "Return the projected electricity-grid carbon intensity for a region, hour by hour. " +
        "Use this when deciding whether to run an expensive AI task now or defer it — intensity " +
        "is grams CO2e per kWh with a categorical band (very_clean / clean / average / dirty / " +
        "very_dirty). Read-only; does not touch the task queue.",
      parameters: Type.Object({
        region: Type.Optional(
          Type.String({
            description:
              "Grid region (e.g. GB, US-CAL-CISO, FR). Defaults to the configured defaultRegion, else a timezone guess, else GB.",
          }),
        ),
        hours: Type.Optional(
          Type.Number({
            description: "How many hours ahead to forecast. Defaults to 24.",
          }),
        ),
      }),
      async execute(
        params: { region?: string; hours?: number },
        config: PluginConfig,
        context?: unknown,
      ) {
        captureOpenClawRuntime(context);
        const { region } = resolveRegion(params.region, config.defaultRegion);
        const forecast = await getGridFeed().fetchForecast(
          region,
          params.hours ?? 24,
        );
        return forecast;
      },
    }),

    // ── update_deadline ───────────────────────────────────────────────────
    tool({
      name: "update_deadline",
      label: "Move a task's deadline",
      description:
        "Move the deadline of a queued or scheduled ebb-ai task; the scheduler re-picks the " +
        "cleanest window inside the new deadline. Only queued/scheduled tasks can change — " +
        "running/completed/failed/cancelled tasks throw. Use when the user says 'I need that " +
        "sooner' or 'push that task to next week'.",
      parameters: Type.Object({
        task_id: Type.String({ description: "The id of the task to reschedule." }),
        deadline: Type.String({
          description: "New ISO-8601 deadline for the task.",
          format: "date-time",
        }),
      }),
      async execute(
        params: { task_id: string; deadline: string },
        config: PluginConfig,
        context?: unknown,
      ) {
        captureOpenClawRuntime(context);
        const { scheduler } = getQueueRuntime(config);
        const record = await scheduler.updateDeadline(
          params.task_id,
          new Date(params.deadline),
        );
        return {
          task_id: params.task_id,
          status: record.status,
          scheduled_for: record.scheduledFor ?? null,
          new_deadline: params.deadline,
        };
      },
    }),

    // ── cancel_all ────────────────────────────────────────────────────────
    tool({
      name: "cancel_all",
      label: "Cancel all queued tasks",
      description:
        "Cancel every queued and scheduled ebb-ai task at once, optionally filtered to one " +
        "status. Use when the user says 'clear my queue', 'cancel everything', 'drop all my " +
        "pending tasks'. Already-terminal tasks (completed/failed/cancelled) are left untouched.",
      parameters: Type.Object({
        status: Type.Optional(
          Type.Union([Type.Literal("queued"), Type.Literal("scheduled")], {
            description: "Optional — cancel only tasks in this status.",
          }),
        ),
      }),
      async execute(
        params: { status?: "queued" | "scheduled" },
        config: PluginConfig,
        context?: unknown,
      ) {
        captureOpenClawRuntime(context);
        const { scheduler } = getQueueRuntime(config);
        const targets = scheduler
          .listPersistedTasks()
          .filter(
            (t) =>
              (t.status === "queued" || t.status === "scheduled") &&
              (!params.status || t.status === params.status),
          );
        let cancelled = 0;
        const errors: Array<{ task_id: string; error: string }> = [];
        for (const t of targets) {
          try {
            scheduler.cancelTask(t.taskId);
            cancelled++;
          } catch (err) {
            errors.push({
              task_id: t.taskId,
              error: err instanceof Error ? err.message : String(err),
            });
          }
        }
        return { matched: targets.length, cancelled, errors };
      },
    }),

    // ── set_delivery ──────────────────────────────────────────────────────
    tool({
      name: "set_delivery",
      label: "Set how a task's result is delivered",
      description:
        "Set or change how a scheduled task's result is delivered when it completes. Call this " +
        "right after schedule_task, once you have ASKED the user how they want the result. The " +
        "user may pick several modes. Modes: chat (their active OpenClaw chat), telegram, webhook " +
        "(needs webhook_url), file (needs file_path; format md/html/txt/json), queue (no push — " +
        "retrievable via check_queue_status). Default if the user is unsure: chat.",
      parameters: Type.Object({
        task_id: Type.String({ description: "The id returned by schedule_task." }),
        deliver: Type.Array(
          Type.Union([
            Type.Literal("chat"),
            Type.Literal("telegram"),
            Type.Literal("webhook"),
            Type.Literal("file"),
            Type.Literal("queue"),
          ]),
          { description: "One or more delivery modes the user chose." },
        ),
        webhook_url: Type.Optional(
          Type.String({ description: "Target URL when deliver includes 'webhook'." }),
        ),
        file_path: Type.Optional(
          Type.String({ description: "Output path when deliver includes 'file'." }),
        ),
        file_format: Type.Optional(
          Type.Union(
            [
              Type.Literal("md"),
              Type.Literal("html"),
              Type.Literal("txt"),
              Type.Literal("json"),
            ],
            { description: "Report format for 'file' delivery. Default: md." },
          ),
        ),
      }),
      async execute(
        params: {
          task_id: string;
          deliver: string[];
          webhook_url?: string;
          file_path?: string;
          file_format?: string;
        },
        _config: PluginConfig,
        context?: unknown,
      ) {
        captureOpenClawRuntime(context);
        const cfg: DeliveryConfig = {
          modes: params.deliver as DeliveryMode[],
          webhookUrl: params.webhook_url,
          filePath: params.file_path,
          format: params.file_format as ReportFormat | undefined,
        };
        const error = validateDeliveryConfig(cfg);
        if (error) throw new Error(`set_delivery: ${error}`);
        await setDeliveryConfig(params.task_id, cfg);
        return { task_id: params.task_id, delivery: cfg };
      },
    }),

    // ── expedite_task ─────────────────────────────────────────────────────
    tool({
      name: "expedite_task",
      label: "Dispatch a task immediately",
      description:
        "Dispatch a queued or scheduled ebb-ai task RIGHT NOW, bypassing the scheduler's chosen " +
        "clean-grid window. Use when the user says 'run it now', 'don't wait', 'I need that " +
        "immediately'. This forgoes the carbon saving — the receipt records " +
        "intensitySource='expedited'. Only provider-call tasks still queued/scheduled can be " +
        "expedited; running, submitted (awaiting Batch API results), or terminal " +
        "(completed/failed/cancelled) tasks are rejected by the scheduler with an explanatory " +
        "error.",
      parameters: Type.Object({
        task_id: Type.String({ description: "The id of the task to dispatch now." }),
      }),
      async execute(
        params: { task_id: string },
        config: PluginConfig,
        context?: unknown,
      ) {
        captureOpenClawRuntime(context);
        const { scheduler } = getQueueRuntime(config);
        let entry;
        try {
          entry = await scheduler.expediteTask(
            params.task_id,
            buildAdapters() as {
              anthropic?: ProviderAdapter;
              openai?: ProviderAdapter;
            },
          );
        } catch (err) {
          // Surface the scheduler's own rejection message verbatim (e.g. a
          // task in `submitted`/`running`/terminal state cannot be expedited)
          // rather than a generic failure.
          throw new Error(
            `expedite_task could not run task ${params.task_id}: ${
              err instanceof Error ? err.message : String(err)
            }`,
          );
        }
        if (entry.status === "completed") {
          await deliverCompletedTask(scheduler, params.task_id);
        }
        const task = scheduler.getTask(params.task_id);
        const provenance = receiptProvenance(task?.receipt);
        return {
          task_id: params.task_id,
          status: entry.status,
          ...(entry.error ? { error: entry.error } : {}),
          receipt: task?.receipt ?? null,
          ...(provenance ? { receipt_provenance: provenance } : {}),
          ...(task?.receipt?.gridSource === "mock"
            ? { synthetic_grid_data: SYNTHETIC_GRID_WARNING }
            : {}),
          result: task?.result ?? null,
          delivery: (await readDeliveryRecord(params.task_id)) ?? null,
        };
      },
    }),

    // ── retry_task ────────────────────────────────────────────────────────
    tool({
      name: "retry_task",
      label: "Retry a failed task",
      description:
        "Re-dispatch an ebb-ai task that previously FAILED. Only valid when the task's current " +
        "status is 'failed' — queued/scheduled/running/submitted/completed tasks are rejected by " +
        "the scheduler with an explanatory error. The new run overwrites the old receipt. Use " +
        "when the user says 'try that again', 'retry that task', 'that one errored — run it once " +
        "more'.",
      parameters: Type.Object({
        task_id: Type.String({ description: "The id of the failed task to retry." }),
      }),
      async execute(
        params: { task_id: string },
        config: PluginConfig,
        context?: unknown,
      ) {
        captureOpenClawRuntime(context);
        const { scheduler } = getQueueRuntime(config);
        let entry;
        try {
          entry = await scheduler.retryTask(
            params.task_id,
            buildAdapters() as {
              anthropic?: ProviderAdapter;
              openai?: ProviderAdapter;
            },
          );
        } catch (err) {
          // Surface the scheduler's own rejection message verbatim (e.g. a
          // task in `submitted`/`running`/non-failed state cannot be retried).
          throw new Error(
            `retry_task could not re-dispatch task ${params.task_id}: ${
              err instanceof Error ? err.message : String(err)
            }`,
          );
        }
        if (entry.status === "completed") {
          await deliverCompletedTask(scheduler, params.task_id);
        }
        const task = scheduler.getTask(params.task_id);
        const provenance = receiptProvenance(task?.receipt);
        return {
          task_id: params.task_id,
          status: entry.status,
          ...(entry.error ? { error: entry.error } : {}),
          receipt: task?.receipt ?? null,
          ...(provenance ? { receipt_provenance: provenance } : {}),
          ...(task?.receipt?.gridSource === "mock"
            ? { synthetic_grid_data: SYNTHETIC_GRID_WARNING }
            : {}),
          result: task?.result ?? null,
          delivery: (await readDeliveryRecord(params.task_id)) ?? null,
        };
      },
    }),
  ],
});
