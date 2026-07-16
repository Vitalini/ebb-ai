#!/usr/bin/env node
/**
 * ebb-mcp — Model Context Protocol server for carbon-aware AI task scheduling.
 *
 * Exposes nine tools to any MCP-compatible agent (Claude Desktop,
 * Claude Code, OpenClaw, Cursor, custom MCP clients):
 *
 *   - get_grid_forecast(region, hours?) → forecasted carbon intensity
 *   - recommend_window(deadline, region, ...) → planning-only window pick
 *   - schedule_task(prompt, deadline, ...) → enqueue (or dry-run preview)
 *   - check_queue_status(task_id?) → status / receipts
 *   - cancel_task / cancel_all / expedite_task / update_deadline / retry_task
 *
 * The server reads `EBB_ELECTRICITY_MAPS_API_KEY` from the environment; if
 * absent, it transparently falls back to a deterministic mock grid feed so
 * the whole stack still runs end-to-end.
 *
 * This module is import-safe: nothing connects to stdio (and no scheduler
 * or SQLite store is constructed) unless the file is executed directly.
 * Tests import `createEbbServer` / `TOOL_DEFINITIONS` and exercise the
 * real handlers over an in-memory transport.
 */

import { mkdirSync, realpathSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import {
  AnthropicAdapter,
  buildDefaultGridFeed,
  OpenAIAdapter,
  recommendWindow,
  resolveRegion,
  Scheduler,
  type GridForecast,
  type ProviderAdapter,
  type ProviderCallSpec,
  type TaskRecord,
} from "@ebb-ai/core";
import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";

/** The grid-feed interface is not re-exported by @ebb-ai/core's index;
 *  derive it structurally from the factory we already import. */
type GridFeed = ReturnType<typeof buildDefaultGridFeed>;

/**
 * Server version — read from this package's own package.json at runtime so
 * lockstep version bumps can never drift the advertised version. Sole
 * source of truth for both the MCP `serverInfo` field and the stderr
 * ready banner.
 */
const requireFromHere = createRequire(import.meta.url);
export const SERVER_VERSION: string = (
  requireFromHere("../package.json") as { version: string }
).version;

/**
 * Resolve where the scheduler should store its persistent queue. v0.7.1
 * makes persistence the default — without it, every MCP server restart
 * dropped the entire queue (one of the loudest UX bugs reported). The
 * order:
 *
 *   1. `EBB_DB_PATH` env var if set (explicit path, used unchanged).
 *   2. `~/.ebb-ai/queue.db` otherwise. Parent directory is created if
 *      missing so the first call doesn't crash with ENOENT.
 *
 * To opt out of persistence and use the old in-memory mode, set
 * `EBB_DB_PATH=:memory:` — the SQLite driver treats that as an ephemeral
 * database. Mostly useful for tests.
 *
 * If the parent directory cannot be created, we genuinely fall back to
 * in-memory mode (dbPath: undefined → the Scheduler constructs no store)
 * instead of crashing on first use of a dead path; the caller surfaces
 * `fallbackNote` in the ready banner so the operator knows persistence is
 * off.
 */
export function resolveStartupDb(explicit = process.env.EBB_DB_PATH): {
  dbPath: string | undefined;
  fallbackNote?: string;
} {
  const requested = explicit ?? join(homedir(), ".ebb-ai", "queue.db");
  if (requested === ":memory:") return { dbPath: ":memory:" };
  try {
    mkdirSync(dirname(requested), { recursive: true });
    return { dbPath: requested };
  } catch (err) {
    return {
      dbPath: undefined,
      fallbackNote:
        `could not create ${dirname(requested)} ` +
        `(${err instanceof Error ? err.message : String(err)})`,
    };
  }
}

function buildAdapters(): { anthropic?: ProviderAdapter; openai?: ProviderAdapter } {
  const out: { anthropic?: ProviderAdapter; openai?: ProviderAdapter } = {};
  if (process.env.ANTHROPIC_API_KEY) out.anthropic = new AnthropicAdapter();
  if (process.env.OPENAI_API_KEY) out.openai = new OpenAIAdapter();
  return out;
}

// ─── Tool input schemas (zod = single source of truth) ─────────────────────
//
// The advertised MCP inputSchema for every tool is derived from these via
// zod-to-json-schema, so a parameter added to a validator is automatically
// discoverable by LLM clients. (Audit §1.9: the previous hand-written JSON
// schema for schedule_task silently omitted 5 implemented parameters.)

const getGridForecastInput = z.object({
  region: z
    .string()
    .describe(
      "Electricity Maps zone code, e.g. 'US-CAL-CISO', 'US-TEX-ERCO', 'FR', 'DE'.",
    ),
  hours: z
    .number()
    .int()
    .min(1)
    .max(72)
    .optional()
    .describe("Forecast horizon in hours (1-72). Defaults to 24."),
});

const scheduleTaskInput = z.object({
  prompt: z
    .string()
    .min(1)
    .describe("The prompt or instruction to dispatch when the window arrives."),
  deadline: z
    .string()
    .datetime({ offset: true })
    .describe(
      "ISO-8601 timestamp (e.g. '2026-05-13T08:00:00-04:00') by which the task must have completed. Must be in the future. Required.",
    ),
  model: z
    .string()
    .optional()
    .describe(
      "Model name to dispatch with (e.g. 'claude-sonnet-4-6'). Required when dispatch=true.",
    ),
  region: z
    .string()
    .optional()
    .describe(
      "Grid region override (Electricity Maps zone code such as 'US-CAL-CISO'). Defaults to the server's default region.",
    ),
  carbon_budget_g: z
    .number()
    .positive()
    .optional()
    .describe(
      "Hard cap on estimated grams CO2-equivalent for this task. If set and no window inside the deadline meets the cap, the task fails rather than dispatching to a dirty window.",
    ),
  dry_run: z
    .boolean()
    .optional()
    .describe(
      "If true, return the planned dispatch (recommended window + carbon estimate) WITHOUT persisting anything. Useful for confirmation flows.",
    ),
  dispatch: z
    .boolean()
    .optional()
    .describe(
      "If true (default in v0.7.1+), persist a provider_call task body that `ebb tick` (CLI) or scheduler.tick (library) can dispatch via the configured provider. Set to false only to enqueue a placeholder prompt without a dispatchable body (legacy in-memory mode).",
    ),
  provider: z
    .enum(["anthropic", "openai"])
    .optional()
    .describe("Provider to dispatch through when dispatch=true. Defaults to 'anthropic'."),
  output_path: z
    .string()
    .optional()
    .describe(
      "Optional absolute file path. When the task completes, ebb-ai writes { taskId, result, receipt } as JSON to this path.",
    ),
  redact_in_receipt: z
    .array(z.string())
    .optional()
    .describe(
      "Optional regex patterns to strip from the prompt before storing on the receipt. Default behavior (omit field) redacts API-key-looking strings.",
    ),
});

const taskIdOnlyInput = z.object({
  task_id: z.string().min(1).describe("Task identifier returned by schedule_task."),
});

const updateDeadlineInput = z.object({
  task_id: z.string().min(1).describe("Task identifier returned by schedule_task."),
  deadline: z
    .string()
    .datetime({ offset: true })
    .describe("New ISO-8601 deadline. Must be in the future."),
});

const checkQueueStatusInput = z.object({
  task_id: z
    .string()
    .optional()
    .describe(
      "If present, return only this task. If omitted, return a queue summary.",
    ),
});

const recommendWindowInput = z.object({
  deadline: z
    .string()
    .datetime({ offset: true })
    .describe(
      "ISO-8601 timestamp (e.g. '2026-05-13T08:00:00-04:00') by which the task must have completed. Must be in the future. Required.",
    ),
  region: z
    .string()
    .min(1)
    .describe(
      "Electricity Maps zone code (e.g. 'US-CAL-CISO', 'FR'). Required — recommend_window is intentionally explicit about which grid it reasons over.",
    ),
  carbon_budget_g: z
    .number()
    .positive()
    .optional()
    .describe(
      "Optional grams CO2-equivalent cap. Windows above the budget are dropped before the cheapest is chosen.",
    ),
  model: z
    .string()
    .optional()
    .describe(
      "Optional vendor model name (e.g. 'claude-sonnet-4-5'). Affects the reasoning string only.",
    ),
});

const cancelAllInput = z.object({
  status: z
    .enum(["queued", "scheduled"])
    .optional()
    .describe(
      "Optional. If set, cancel only tasks in this status. Valid: 'queued', 'scheduled'. Defaults to both.",
    ),
});

/** One advertised MCP tool: name + description + the zod validator that is
 *  also used to parse incoming arguments. */
export interface ToolDefinition {
  name: string;
  description: string;
  schema: z.ZodObject<z.ZodRawShape>;
}

export const TOOL_DEFINITIONS: ReadonlyArray<ToolDefinition> = [
  {
    name: "get_grid_forecast",
    description:
      "Return the projected electricity-grid carbon intensity for a region, hour by hour. Use this when deciding whether to run an expensive AI task now or defer it. Carbon intensity is reported in grams CO2-equivalent per kWh, with a categorical band (very_clean / clean / average / dirty / very_dirty).",
    schema: getGridForecastInput,
  },
  {
    name: "recommend_window",
    description:
      "Return the optimal carbon-aware execution window for a task WITHOUT scheduling it. Use this for non-committal planning — when you want to see *when* the cleanest grid moment falls inside the deadline (and what the savings vs running now would be) before deciding whether to commit via schedule_task. Returns the chosen window, top 3 alternatives, batch_eligible flag, grid_source (which feed produced the forecast — 'mock' means synthetic data), and a one-line reasoning string.",
    schema: recommendWindowInput,
  },
  {
    name: "schedule_task",
    description:
      "Queue an AI task to run during off-peak hours inside the given deadline. Four parallel wins: (1) **lighter on the electricity grid** — US AI compute is projected to reach 6.7-12% of national grid load by 2028 (DOE 2024); deferring non-urgent tasks smooths that demand. (2) **50% cheaper** — auto-routes through Anthropic/OpenAI Batch APIs when the deadline allows. (3) **faster sync calls** — Anthropic explicitly expanded off-peak capacity (doubled usage limits outside peak hours), shorter queues = lower observed latency. (4) **40-70% lower carbon** — dispatch at the cleanest electricity-grid hour. **Invoke this tool whenever the user phrases a request with deferral language:** \"do this later\", \"by tomorrow\", \"tonight\", \"overnight\", \"by EOD\", \"sometime this week\", \"when you have a moment\", \"remind me to\", \"queue this up\", \"schedule this\", \"no rush\", \"not urgent\". Convert the user's wording to an ISO-8601 deadline and pass the task as the prompt. Returns a task_id that can later be checked with check_queue_status. Extras: pass `dry_run: true` to preview the planned window + carbon estimate without persisting anything (confirmation flows); `provider` to route dispatch through 'anthropic' or 'openai'; `output_path` to have the result + receipt written to a file on completion (file-watcher delivery instead of polling); `redact_in_receipt` to strip sensitive patterns from the prompt before it is stored on the receipt. Good fits: nightly digests, batch summaries, research sweeps, evaluator runs, multi-step report generation, anything the user is fine waiting on. Do NOT use for: live chat, interactive code edits, or any task the user is actively waiting to see complete.",
    schema: scheduleTaskInput,
  },
  {
    name: "check_queue_status",
    description:
      "Report on the ebb-ai task queue. With no arguments, returns a compact summary of all known tasks (including tasks persisted by previous sessions — the queue survives MCP host restarts). With task_id, returns full detail for one task including any carbon receipt (estimated vs actual grams, grid_source, energy_source).",
    schema: checkQueueStatusInput,
  },
  {
    name: "cancel_task",
    description:
      "Cancel a queued/scheduled task. Idempotent — if the task is already completed/failed/cancelled this returns the existing status without error. Throws only if task_id is unknown.",
    schema: taskIdOnlyInput,
  },
  {
    name: "expedite_task",
    description:
      "Dispatch a queued/scheduled provider-call task immediately, bypassing the scheduler's chosen carbon window. The resulting receipt records intensitySource='expedited'. Only valid for tasks that were created with dispatch=true.",
    schema: taskIdOnlyInput,
  },
  {
    name: "update_deadline",
    description:
      "Re-score and reschedule a queued/scheduled task against a new deadline. Throws if the task is already running or terminal, or if the new deadline is invalid/in the past.",
    schema: updateDeadlineInput,
  },
  {
    name: "retry_task",
    description:
      "Re-dispatch a failed provider-call task. Only valid when the task's current status is 'failed'. New receipt overwrites the old.",
    schema: taskIdOnlyInput,
  },
  {
    name: "cancel_all",
    description:
      "Bulk-cancel every task in the queue that is still cancellable (status `queued` or `scheduled`). Running/completed/failed/cancelled tasks are left alone. Optionally filter by status. Returns the number of tasks cancelled.",
    schema: cancelAllInput,
  },
];

/**
 * Convert a zod object validator into the JSON schema advertised over MCP.
 * `$refStrategy: "none"` inlines everything (MCP clients don't resolve
 * refs); the draft-07 `$schema` marker is stripped because the MCP spec
 * carries its own envelope.
 */
export function toInputSchema(
  schema: z.ZodTypeAny,
): { type: "object"; [k: string]: unknown } {
  const json = zodToJsonSchema(schema, { $refStrategy: "none" }) as Record<
    string,
    unknown
  >;
  delete json.$schema;
  return json as { type: "object"; [k: string]: unknown };
}

/** The exact tool list served to ListTools clients. */
export function buildToolList(): Array<{
  name: string;
  description: string;
  inputSchema: { type: "object"; [k: string]: unknown };
}> {
  return TOOL_DEFINITIONS.map((def) => ({
    name: def.name,
    description: def.description,
    inputSchema: toInputSchema(def.schema),
  }));
}

/**
 * Every task this scheduler knows about: the persisted ledger (survives
 * MCP-host restarts — audit §0.10) plus any in-memory-only tasks (present
 * only when the scheduler runs without a store). Persisted rows win on id
 * collision.
 */
function listKnownTasks(scheduler: Scheduler): TaskRecord<unknown>[] {
  const persisted = scheduler.listPersistedTasks();
  const ids = new Set(persisted.map((t) => t.taskId));
  const memoryOnly = scheduler.listTasks().filter((t) => !ids.has(t.taskId));
  return [...persisted, ...memoryOnly];
}

/** Best-effort probe of which grid feed serves this region — used purely
 *  for provenance in tool responses. Never throws. */
async function fetchGridSource(
  feed: GridFeed,
  region: string,
): Promise<GridForecast["source"] | undefined> {
  try {
    const forecast = await feed.fetchForecast(region, 1);
    return forecast.source;
  } catch {
    return undefined;
  }
}

const SYNTHETIC_GRID_WARNING =
  "⚠ SYNTHETIC (mock) grid data — no live grid feed was available for this region, " +
  "so the carbon numbers above are illustrative, not measured. " +
  "Set EBB_ELECTRICITY_MAPS_API_KEY (or another supported feed key) for real intensity.";

export interface EbbServerDeps {
  /** Grid feed. Defaults to buildDefaultGridFeed() (live feeds when keys
   *  are configured, deterministic mock otherwise). */
  feed?: GridFeed;
  /** Pre-built scheduler (tests). When set, `dbPath` is not used to
   *  construct one. */
  scheduler?: Scheduler;
  /** SQLite ledger path. undefined → pure in-memory scheduler (no store);
   *  ":memory:" → ephemeral SQLite store. */
  dbPath?: string;
  defaultRegion?: string;
  defaultModel?: string;
}

/**
 * Build the real ebb-mcp Server with all nine tool handlers registered.
 * Extracted from main() so tests can drive the actual handlers over an
 * InMemoryTransport instead of re-implementing a stub.
 */
export function createEbbServer(deps: EbbServerDeps = {}): {
  server: Server;
  scheduler: Scheduler;
  feed: GridFeed;
  dbPath: string | undefined;
  defaultRegion: string;
  defaultModel: string;
} {
  const feed = deps.feed ?? buildDefaultGridFeed();
  // When EBB_DEFAULT_REGION is unset, guess the region from the host
  // timezone (shared with the CLI and the OpenClaw plugin) instead of
  // hard-coding one — falls back to GB.
  const defaultRegion =
    deps.defaultRegion ??
    resolveRegion(undefined, process.env.EBB_DEFAULT_REGION).region;
  const defaultModel =
    deps.defaultModel ?? process.env.EBB_DEFAULT_MODEL ?? "claude-sonnet-4-6";
  const dbPath = deps.dbPath;
  const scheduler =
    deps.scheduler ??
    new Scheduler({
      feed,
      defaultRegion,
      ...(dbPath !== undefined ? { dbPath } : {}),
    });
  const persistedAt =
    dbPath === undefined || dbPath === ":memory:" ? "(in-memory)" : dbPath;

  const server = new Server(
    { name: "ebb-mcp", version: SERVER_VERSION },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: buildToolList(),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const name = req.params.name;
    const args = req.params.arguments ?? {};

    try {
      if (name === "get_grid_forecast") {
        const parsed = getGridForecastInput.parse(args);
        const hours = parsed.hours ?? 24;
        const forecast = await feed.fetchForecast(parsed.region, hours);
        return {
          content: [
            {
              type: "text",
              text: formatForecast(forecast),
            },
          ],
        };
      }

      if (name === "recommend_window") {
        const parsed = recommendWindowInput.parse(args);
        try {
          const result = await recommendWindow(
            {
              deadline: parsed.deadline,
              region: parsed.region,
              carbonBudgetG: parsed.carbon_budget_g,
              model: parsed.model,
            },
            { feed },
          );
          return {
            content: [
              { type: "text", text: formatRecommendation(result) },
            ],
          };
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          return {
            content: [
              { type: "text", text: `recommend_window rejected: ${msg}` },
            ],
            isError: true,
          };
        }
      }

      if (name === "schedule_task") {
        const parsed = scheduleTaskInput.parse(args);
        try {
          // dry_run: return the planned dispatch without persisting.
          if (parsed.dry_run) {
            const spec: ProviderCallSpec = {
              type: "provider_call",
              provider: parsed.provider ?? "anthropic",
              // Same default as the real enqueue below — dry_run must
              // preview exactly what commit would do.
              model: parsed.model ?? defaultModel,
              prompt: parsed.prompt,
              outputPath: parsed.output_path,
              redactInReceipt: parsed.redact_in_receipt,
            };
            const plan = await scheduler.previewProviderCall(spec, {
              deadline: parsed.deadline,
              region: parsed.region,
              carbonBudgetG: parsed.carbon_budget_g,
            });
            const gridSource = await fetchGridSource(feed, plan.region);
            return {
              content: [
                {
                  type: "text",
                  text:
                    `dry_run plan (nothing persisted):\n` +
                    `provider: ${spec.provider}\n` +
                    `model: ${spec.model}\n` +
                    `region: ${plan.region}\n` +
                    `scheduled_for: ${plan.scheduledFor}\n` +
                    `deadline: ${parsed.deadline}\n` +
                    `intensity_g_co2_per_kwh: ${plan.intensityGCo2PerKwh}\n` +
                    `band: ${plan.band}\n` +
                    `estimated_carbon_g_co2: ${plan.estimatedCarbonGCo2}\n` +
                    `batch_eligible: ${plan.batchEligible}\n` +
                    `grid_source: ${gridSource ?? "unknown"}` +
                    (gridSource === "mock" ? `\n${SYNTHETIC_GRID_WARNING}` : ``),
                },
              ],
            };
          }
          // Persistence-by-default (v0.7.1+) — dispatchable by `ebb tick`.
          // Opt out with `dispatch=false` for the legacy in-memory closure
          // mode (mostly useful for testing or no-dispatch placeholders).
          const shouldDispatch = parsed.dispatch ?? true;
          if (shouldDispatch) {
            const spec: ProviderCallSpec = {
              type: "provider_call",
              provider: parsed.provider ?? "anthropic",
              model: parsed.model ?? defaultModel,
              prompt: parsed.prompt,
              outputPath: parsed.output_path,
              redactInReceipt: parsed.redact_in_receipt,
            };
            const record = await scheduler.enqueueProviderCall(spec, {
              deadline: parsed.deadline,
              region: parsed.region,
              carbonBudgetG: parsed.carbon_budget_g,
            });
            const gridSource = await fetchGridSource(feed, record.region);
            return {
              content: [
                {
                  type: "text",
                  text:
                    `Task persisted (provider_call, dispatchable by \`ebb tick\`).\n` +
                    `task_id: ${record.taskId}\n` +
                    `provider: ${spec.provider}\n` +
                    `model: ${spec.model}\n` +
                    `region: ${record.region}\n` +
                    `status: ${record.status}\n` +
                    `scheduled_for: ${record.scheduledFor ?? "(immediate)"}\n` +
                    `deadline: ${parsed.deadline}\n` +
                    `estimated_carbon_g_co2: ${record.estimatedCarbonGCo2 ?? "(not scored)"}\n` +
                    `grid_source: ${gridSource ?? "unknown"}\n` +
                    (gridSource === "mock" ? `${SYNTHETIC_GRID_WARNING}\n` : ``) +
                    `persisted_to: ${persistedAt}\n` +
                    `\n` +
                    `To actually dispatch tasks at their windows, run the\n` +
                    `\`ebb tick\` daemon (separate process):\n` +
                    `  npm install -g @ebb-ai/cli\n` +
                    `  ebb install      # registers launchd/systemd cron-tick\n` +
                    `\n` +
                    `Without the daemon the task sits queued until you manually\n` +
                    `run \`ebb tick --once\` against the same EBB_DB_PATH.`,
                },
              ],
            };
          }
          // Legacy closure-based mode (opt-in via dispatch=false). The closure
          // does no LLM work — it's a placeholder useful for testing or for
          // workflows where the caller dispatches inline.
          const record = scheduler.enqueue(
            async () => ({
              prompt: parsed.prompt,
              model: parsed.model ?? null,
              dispatched: false,
              note: "closure placeholder — dispatch=true on schedule_task to persist a real provider_call",
            }),
            {
              deadline: parsed.deadline,
              region: parsed.region,
              carbonBudgetG: parsed.carbon_budget_g,
            },
          );
          return {
            content: [
              {
                type: "text",
                text:
                  `Task queued (closure placeholder, in-process only).\n` +
                  `task_id: ${record.taskId}\n` +
                  `region: ${record.region}\n` +
                  `status: ${record.status}\n` +
                  `deadline: ${parsed.deadline}\n` +
                  `Note: dispatch=false placeholder. Will NOT actually call ` +
                  `the LLM. Remove dispatch=false to enqueue a real ` +
                  `provider_call (default in v0.7.1+).`,
              },
            ],
          };
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          return {
            content: [
              {
                type: "text",
                text: `schedule_task rejected: ${msg}`,
              },
            ],
            isError: true,
          };
        }
      }

      if (name === "check_queue_status") {
        const parsed = checkQueueStatusInput.parse(args);
        if (parsed.task_id) {
          // getTask consults the persisted store too, so a task scheduled
          // by a previous MCP-host session is still addressable.
          const task = scheduler.getTask(parsed.task_id);
          if (!task) {
            return {
              content: [
                { type: "text", text: `Unknown task_id: ${parsed.task_id}` },
              ],
              isError: true,
            };
          }
          return {
            content: [{ type: "text", text: formatTask(task) }],
          };
        }
        // Persisted ledger first (survives MCP-host restarts), in-memory
        // fallback when the scheduler runs without a store.
        const all = listKnownTasks(scheduler);
        return {
          content: [
            { type: "text", text: formatQueueSummary(all) },
          ],
        };
      }

      if (name === "cancel_task") {
        const parsed = taskIdOnlyInput.parse(args);
        try {
          const rec = scheduler.cancelTask(parsed.task_id);
          return {
            content: [
              {
                type: "text",
                text:
                  `Task ${parsed.task_id} status: ${rec.status}\n` +
                  (rec.completedAt ? `terminated_at: ${rec.completedAt}\n` : ``),
              },
            ],
          };
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          return { content: [{ type: "text", text: `cancel_task rejected: ${msg}` }], isError: true };
        }
      }

      if (name === "expedite_task") {
        const parsed = taskIdOnlyInput.parse(args);
        try {
          const adapters = buildAdapters();
          if (!adapters.anthropic && !adapters.openai) {
            return {
              content: [
                {
                  type: "text",
                  text:
                    `expedite_task rejected: no provider API key set (ANTHROPIC_API_KEY / OPENAI_API_KEY). ` +
                    `Set one in the MCP server env block, restart, and retry.`,
                },
              ],
              isError: true,
            };
          }
          const entry = await scheduler.expediteTask(parsed.task_id, adapters);
          return {
            content: [
              {
                type: "text",
                text:
                  `Task ${parsed.task_id} expedited.\n` +
                  `status: ${entry.status}\n` +
                  (entry.error ? `error: ${entry.error}\n` : ``),
              },
            ],
          };
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          return { content: [{ type: "text", text: `expedite_task rejected: ${msg}` }], isError: true };
        }
      }

      if (name === "update_deadline") {
        const parsed = updateDeadlineInput.parse(args);
        try {
          const rec = await scheduler.updateDeadline(parsed.task_id, parsed.deadline);
          return {
            content: [
              {
                type: "text",
                text:
                  `Task ${parsed.task_id} updated.\n` +
                  `status: ${rec.status}\n` +
                  `scheduled_for: ${rec.scheduledFor ?? "(immediate)"}\n` +
                  `new_deadline: ${parsed.deadline}`,
              },
            ],
          };
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          return { content: [{ type: "text", text: `update_deadline rejected: ${msg}` }], isError: true };
        }
      }

      if (name === "cancel_all") {
        const parsed = cancelAllInput.parse(args);
        // Persisted ledger first (audit §0.10: the in-memory map is empty
        // after an MCP-host restart while queue.db still holds scheduled
        // tasks); in-memory fallback when the scheduler has no store.
        const allTasks = listKnownTasks(scheduler);
        const targets = allTasks.filter(
          (t): t is NonNullable<typeof t> =>
            !!t &&
            (t.status === "queued" || t.status === "scheduled") &&
            (!parsed.status || t.status === parsed.status),
        );
        let cancelled = 0;
        const errors: string[] = [];
        for (const t of targets) {
          try {
            scheduler.cancelTask(t.taskId);
            cancelled++;
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            errors.push(`${t.taskId}: ${msg}`);
          }
        }
        const lines = [
          `Cancelled ${cancelled} of ${targets.length} ${
            parsed.status ?? "queued/scheduled"
          } task(s).`,
        ];
        if (errors.length > 0) {
          lines.push("");
          lines.push("Errors:");
          for (const e of errors) lines.push(`  ${e}`);
        }
        return { content: [{ type: "text", text: lines.join("\n") }] };
      }

      if (name === "retry_task") {
        const parsed = taskIdOnlyInput.parse(args);
        try {
          const adapters = buildAdapters();
          if (!adapters.anthropic && !adapters.openai) {
            return {
              content: [
                {
                  type: "text",
                  text:
                    `retry_task rejected: no provider API key set (ANTHROPIC_API_KEY / OPENAI_API_KEY).`,
                },
              ],
              isError: true,
            };
          }
          const entry = await scheduler.retryTask(parsed.task_id, adapters);
          return {
            content: [
              {
                type: "text",
                text:
                  `Task ${parsed.task_id} retried.\n` +
                  `status: ${entry.status}\n` +
                  (entry.error ? `error: ${entry.error}\n` : ``),
              },
            ],
          };
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          return { content: [{ type: "text", text: `retry_task rejected: ${msg}` }], isError: true };
        }
      }

      return {
        content: [{ type: "text", text: `Unknown tool: ${name}` }],
        isError: true,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        content: [{ type: "text", text: `Error: ${msg}` }],
        isError: true,
      };
    }
  });

  return { server, scheduler, feed, dbPath, defaultRegion, defaultModel };
}

export function formatForecast(forecast: GridForecast): string {
  const lines: string[] = [];
  lines.push(`Region: ${forecast.region}`);
  lines.push(`Source: ${forecast.source}`);
  lines.push(`Generated: ${forecast.generatedAt}`);
  lines.push("");
  lines.push("Hour | gCO2/kWh | band");
  lines.push("---  | ---      | ---");
  for (const e of forecast.entries) {
    const hour = e.datetime.slice(11, 16);
    lines.push(
      `${hour} | ${String(e.carbonIntensityGCo2PerKwh).padStart(4)} | ${e.band}`,
    );
  }
  type Entry = (typeof forecast.entries)[number];
  const min = forecast.entries.reduce((a: Entry, b: Entry) =>
    a.carbonIntensityGCo2PerKwh <= b.carbonIntensityGCo2PerKwh ? a : b,
  );
  const max = forecast.entries.reduce((a: Entry, b: Entry) =>
    a.carbonIntensityGCo2PerKwh >= b.carbonIntensityGCo2PerKwh ? a : b,
  );
  lines.push("");
  lines.push(`Cleanest hour: ${min.datetime} (${min.carbonIntensityGCo2PerKwh} gCO2/kWh, ${min.band})`);
  lines.push(`Dirtiest hour: ${max.datetime} (${max.carbonIntensityGCo2PerKwh} gCO2/kWh, ${max.band})`);
  return lines.join("\n");
}

export function formatRecommendation(
  r: Awaited<ReturnType<typeof recommendWindow>>,
): string {
  // Emit canonical snake_case JSON so an LLM caller can parse the result
  // directly. The fields mirror the Python `RecommendResult.to_dict()`
  // 1:1 — keep this in lockstep when either side adds a field.
  const payload = {
    scheduled_for: r.scheduledFor,
    intensity_g_co2_per_kwh: r.intensityGCo2PerKwh,
    band: r.band,
    estimated_carbon_g_co2: r.estimatedCarbonGCo2,
    estimated_savings_vs_now_pct: r.estimatedSavingsVsNowPct,
    batch_eligible: r.batchEligible,
    // Provenance (v0.12+): which grid feed produced the forecast this
    // plan was scored against. "mock" = SYNTHETIC data — surface that.
    grid_source: r.gridSource ?? null,
    alternatives: r.alternatives.map((a) => ({
      scheduled_for: a.scheduledFor,
      intensity_g_co2_per_kwh: a.intensityGCo2PerKwh,
      band: a.band,
      estimated_carbon_g_co2: a.estimatedCarbonGCo2,
      estimated_savings_vs_now_pct: a.estimatedSavingsVsNowPct,
    })),
    reasoning: r.reasoning,
  };
  return JSON.stringify(payload, null, 2);
}

export function formatTask(task: TaskRecord<unknown> | undefined): string {
  if (!task) return "";
  const lines = [
    `task_id: ${task.taskId}`,
    `status: ${task.status}`,
    `region: ${task.region}`,
    `enqueued_at: ${task.enqueuedAt}`,
  ];
  if (task.scheduledFor) lines.push(`scheduled_for: ${task.scheduledFor}`);
  if (task.deadline) lines.push(`deadline: ${task.deadline}`);
  if (task.completedAt) lines.push(`completed_at: ${task.completedAt}`);
  if (task.carbonBudgetG)
    lines.push(`carbon_budget_g: ${task.carbonBudgetG}`);
  if (task.receipt) {
    lines.push("");
    lines.push("Carbon receipt:");
    lines.push(`  ran_at: ${task.receipt.ranAt}`);
    lines.push(`  estimated_carbon_g: ${task.receipt.estimatedCarbonGCo2}`);
    if (task.receipt.actualCarbonGCo2 !== undefined)
      lines.push(`  actual_carbon_g: ${task.receipt.actualCarbonGCo2}`);
    if (task.receipt.deltaPct !== undefined)
      lines.push(`  delta_pct: ${task.receipt.deltaPct}`);
    if (task.receipt.intensityGCo2PerKwh !== undefined)
      lines.push(
        `  intensity_g_co2_per_kwh: ${task.receipt.intensityGCo2PerKwh}`,
      );
    if (task.receipt.gridSource !== undefined)
      lines.push(
        `  grid_source: ${task.receipt.gridSource}` +
          (task.receipt.gridSource === "mock"
            ? " — SYNTHETIC (mock) grid data, not a measurement"
            : ""),
      );
    if (task.receipt.energySource !== undefined)
      lines.push(`  energy_source: ${task.receipt.energySource}`);
    if (task.receipt.energyResolution !== undefined)
      lines.push(`  energy_resolution: ${task.receipt.energyResolution}`);
    if (task.receipt.durationMs)
      lines.push(`  duration_ms: ${task.receipt.durationMs}`);
  }
  if (task.result !== undefined) {
    lines.push("");
    lines.push("Result:");
    lines.push(
      typeof task.result === "string"
        ? task.result
        : JSON.stringify(task.result, null, 2),
    );
  }
  if (task.error) lines.push(`error: ${task.error}`);
  return lines.join("\n");
}

export function formatQueueSummary(
  tasks: ReadonlyArray<TaskRecord<unknown> | undefined>,
): string {
  if (tasks.length === 0) {
    return "Queue is empty.";
  }
  const counts: Record<string, number> = {};
  for (const t of tasks) {
    if (!t) continue;
    counts[t.status] = (counts[t.status] ?? 0) + 1;
  }
  const lines = [
    `Total tasks: ${tasks.length}`,
    ...Object.entries(counts).map(([s, n]) => `  ${s}: ${n}`),
    "",
    "Tasks:",
  ];
  for (const t of tasks) {
    if (!t) continue;
    lines.push(
      `  ${t.taskId} | ${t.status.padEnd(10)} | region=${t.region}${
        t.scheduledFor ? ` | sched=${t.scheduledFor}` : ""
      }`,
    );
  }
  return lines.join("\n");
}

async function main() {
  const { dbPath, fallbackNote } = resolveStartupDb();
  if (fallbackNote) {
    // stderr only — stdout belongs to the MCP stdio protocol.
    // eslint-disable-next-line no-console
    console.error(
      `[ebb-mcp] ${fallbackNote} — falling back to an in-memory queue; ` +
        `tasks will NOT survive a restart of this server.`,
    );
  }
  const { server, feed, defaultRegion } = createEbbServer({ dbPath });
  const transport = new StdioServerTransport();
  await server.connect(transport);
  const dbLabel =
    dbPath === undefined
      ? fallbackNote
        ? "in-memory (FALLBACK: db directory unavailable)"
        : "in-memory"
      : dbPath === ":memory:"
        ? "in-memory"
        : dbPath;
  // eslint-disable-next-line no-console
  console.error(
    `[ebb-mcp] ready (stdio, v${SERVER_VERSION}) — region=${defaultRegion}, ` +
      `grid feed=${feed.source}, ` +
      `db=${dbLabel}`,
  );
}

/** Run main() only when executed as a script (node dist/server.js or the
 *  `ebb-mcp` bin shim) — importing this module has no side effects. */
function isDirectRun(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    // realpath: npm bin shims are symlinks into dist/.
    return import.meta.url === pathToFileURL(realpathSync(entry)).href;
  } catch {
    return false;
  }
}

if (isDirectRun()) {
  main().catch((err: unknown) => {
    // eslint-disable-next-line no-console
    console.error("[ebb-mcp] fatal:", err);
    process.exit(1);
  });
}
