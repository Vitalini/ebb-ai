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
  GeminiAdapter,
  OllamaAdapter,
  OpenAIAdapter,
  paramOptionalForHost,
  paramsForHost,
  recommendWindow,
  resolveRegion,
  Scheduler,
  toolsForHost,
  type CanonicalToolDef,
  type GridForecast,
  type ProviderCallSpec,
  type TaskRecord,
  type TickAdapters,
  type ToolParam,
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

function buildAdapters(): TickAdapters {
  const out: TickAdapters = {};
  if (process.env.ANTHROPIC_API_KEY) out.anthropic = new AnthropicAdapter();
  if (process.env.OPENAI_API_KEY) out.openai = new OpenAIAdapter();
  // Gemini reads GEMINI_API_KEY, falling back to GOOGLE_API_KEY.
  if (process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY) {
    out.gemini = new GeminiAdapter();
  }
  // Ollama is local + keyless: register it only when OLLAMA_HOST is set, an
  // explicit opt-in that a local server is being run. (The adapter still
  // defaults to http://localhost:11434 when constructed.)
  if (process.env.OLLAMA_HOST) out.ollama = new OllamaAdapter();
  return out;
}

// ─── Tool input schemas (derived from @ebb-ai/core's canonical surface) ─────
//
// The tool surface — names, descriptions, parameter sets, requiredness — is
// the single source of truth shared with the OpenClaw plugin
// (`@ebb-ai/core`'s tool-surface module, audit §2.2). Here we render each
// tool's neutral parameter descriptors into the zod validators the MCP server
// both parses incoming arguments with AND advertises (via zod-to-json-schema).
//
// The MCP renderer is the STRICT one: it applies every facet the descriptor
// carries (date-time format, string min-length, integer bounds, positivity),
// so `.parse()` accepts/rejects exactly what it always did. (Audit §1.9: the
// previous hand-written JSON schema for schedule_task silently omitted 5
// implemented parameters — deriving the schema forecloses that class of drift.)

/** Render one neutral parameter descriptor into its MCP zod validator. */
function buildZodField(param: ToolParam): z.ZodTypeAny {
  let base: z.ZodTypeAny;
  switch (param.kind) {
    case "string": {
      let s = z.string();
      if (param.minLength !== undefined) s = s.min(param.minLength);
      if (param.format === "date-time") s = s.datetime({ offset: true });
      base = s;
      break;
    }
    case "number": {
      let n = z.number();
      if (param.integer) n = n.int();
      if (param.min !== undefined) n = n.min(param.min);
      if (param.max !== undefined) n = n.max(param.max);
      if (param.positive) n = n.positive();
      base = n;
      break;
    }
    case "boolean":
      base = z.boolean();
      break;
    case "enum":
      base = z.enum(param.values as [string, ...string[]]);
      break;
    case "array":
      base =
        param.itemKind === "enum"
          ? z.array(z.enum(param.values as [string, ...string[]]))
          : z.array(z.string());
      break;
    case "object": {
      const shape: z.ZodRawShape = {};
      for (const sub of param.properties ?? []) {
        shape[sub.name] = buildZodField(sub);
      }
      base = z.object(shape);
      break;
    }
  }
  base = base.describe(param.description);
  return paramOptionalForHost(param, "mcp") ? base.optional() : base;
}

/** Render a canonical tool's MCP parameters into a zod object validator. */
function buildMcpSchema(def: CanonicalToolDef): z.ZodObject<z.ZodRawShape> {
  const shape: z.ZodRawShape = {};
  for (const param of paramsForHost(def, "mcp")) {
    shape[param.name] = buildZodField(param);
  }
  return z.object(shape);
}

/** One advertised MCP tool: name + description + the zod validator that is
 *  also used to parse incoming arguments. Derived from the shared surface. */
export interface ToolDefinition {
  name: string;
  description: string;
  schema: z.ZodObject<z.ZodRawShape>;
}

export const TOOL_DEFINITIONS: ReadonlyArray<ToolDefinition> = toolsForHost(
  "mcp",
).map((def) => ({
  name: def.name,
  description: def.description,
  schema: buildMcpSchema(def),
}));

/** The zod validator for a tool, by name. */
const SCHEMA_BY_NAME: ReadonlyMap<string, z.ZodObject<z.ZodRawShape>> = new Map(
  TOOL_DEFINITIONS.map((d) => [d.name, d.schema]),
);

function schemaOf(name: string): z.ZodObject<z.ZodRawShape> {
  const schema = SCHEMA_BY_NAME.get(name);
  if (!schema) throw new Error(`no MCP schema for tool: ${name}`);
  return schema;
}

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
): Promise<
  { source: GridForecast["source"]; signalType: GridForecast["signalType"] } | undefined
> {
  try {
    const forecast = await feed.fetchForecast(region, 1);
    return { source: forecast.source, signalType: forecast.signalType };
  } catch {
    return undefined;
  }
}

/** Render a grid_source line, disclosing mock + marginal signals honestly. */
function formatGridSourceLine(
  info: Awaited<ReturnType<typeof fetchGridSource>>,
): string {
  const source = info?.source ?? "unknown";
  const mockTail = source === "mock" ? `\n${SYNTHETIC_GRID_WARNING}` : "";
  const marginalTail =
    info?.signalType === "marginal"
      ? " (marginal-emissions signal — not an average-grid figure)"
      : "";
  return `grid_source: ${source}${marginalTail}${mockTail}`;
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
        const parsed = schemaOf("get_grid_forecast").parse(args) as {
          region: string;
          hours?: number;
        };
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
        const parsed = schemaOf("recommend_window").parse(args) as {
          deadline: string;
          region: string;
          carbon_budget_g?: number;
          model?: string;
          candidates?: string[];
          route_weights?: { carbon?: number; cost?: number; latency?: number };
        };
        try {
          const result = await recommendWindow(
            {
              deadline: parsed.deadline,
              region: parsed.region,
              carbonBudgetG: parsed.carbon_budget_g,
              model: parsed.model,
              candidates: parsed.candidates,
              routeWeights: parsed.route_weights,
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
        const parsed = schemaOf("schedule_task").parse(args) as {
          prompt: string;
          deadline: string;
          model?: string;
          region?: string;
          carbon_budget_g?: number;
          dry_run?: boolean;
          dispatch?: boolean;
          provider?: "anthropic" | "openai" | "gemini" | "ollama";
          output_path?: string;
          redact_in_receipt?: string[];
          candidates?: string[];
          route_weights?: { carbon?: number; cost?: number; latency?: number };
        };
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
              candidates: parsed.candidates,
              routeWeights: parsed.route_weights,
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
                    (plan.routingPreview
                      ? `routing_preview: ${JSON.stringify(routingBlockPayload(plan.routingPreview))}\n`
                      : "") +
                    formatGridSourceLine(gridSource),
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
              candidates: parsed.candidates,
              routeWeights: parsed.route_weights,
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
                    (record.routingDecision
                      ? `routing: ${record.routingDecision.reasoning}\n`
                      : "") +
                    `${formatGridSourceLine(gridSource)}\n` +
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
        const parsed = schemaOf("check_queue_status").parse(args) as {
          task_id?: string;
        };
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
        const parsed = schemaOf("cancel_task").parse(args) as { task_id: string };
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
        const parsed = schemaOf("expedite_task").parse(args) as { task_id: string };
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
        const parsed = schemaOf("update_deadline").parse(args) as {
          task_id: string;
          deadline: string;
        };
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
        const parsed = schemaOf("cancel_all").parse(args) as {
          status?: "queued" | "scheduled";
        };
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
        const parsed = schemaOf("retry_task").parse(args) as { task_id: string };
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
  if (forecast.signalType === "marginal") {
    lines.push(
      `Signal: marginal (co2_moer — the marginal generator's rate, not the average-grid figure)`,
    );
  }
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
    // Signal type (v0.14+): "marginal" (WattTime co2_moer) or null ⇒
    // average. The reasoning string discloses it in prose too.
    signal_type: r.signalType ?? null,
    alternatives: r.alternatives.map((a) => ({
      scheduled_for: a.scheduledFor,
      intensity_g_co2_per_kwh: a.intensityGCo2PerKwh,
      band: a.band,
      estimated_carbon_g_co2: a.estimatedCarbonGCo2,
      estimated_savings_vs_now_pct: a.estimatedSavingsVsNowPct,
    })),
    reasoning: r.reasoning,
    // Non-binding cross-provider routing preview (ROADMAP item 1) — present
    // only when >= 2 candidates were supplied. `preview: true` and the
    // reasoning prefix disclose that the binding pick is decided at schedule
    // time and may differ if the forecast shifts.
    ...(r.routingPreview
      ? { routing_preview: routingBlockPayload(r.routingPreview) }
      : {}),
  };
  return JSON.stringify(payload, null, 2);
}

/**
 * snake_case JSON rendering of a routing decision/preview for the MCP text
 * payloads. Shared by recommend_window, schedule_task dry_run, and the
 * committed schedule response so the block reads identically everywhere.
 */
export function routingBlockPayload(
  routing: import("@ebb-ai/core").RoutingDecision & { preview?: true },
): Record<string, unknown> {
  return {
    ...(routing.preview ? { preview: true } : {}),
    chosen: routing.chosen,
    ...(routing.fallbackFrom ? { fallback_from: routing.fallbackFrom } : {}),
    weights: routing.weights,
    considered: routing.considered.map((c) => ({
      provider: c.provider,
      model: c.model,
      est_carbon_g: c.estCarbonG,
      est_cost_usd: c.estCostUsd,
      latency_class: c.latencyClass,
      score: c.score,
    })),
    reasoning: routing.reasoning,
  };
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
            : "") +
          (task.receipt.signalType === "marginal"
            ? " (marginal-emissions signal — not an average-grid figure)"
            : ""),
      );
    if (task.receipt.energySource !== undefined)
      lines.push(`  energy_source: ${task.receipt.energySource}`);
    if (task.receipt.energyResolution !== undefined)
      lines.push(`  energy_resolution: ${task.receipt.energyResolution}`);
    if (task.receipt.durationMs)
      lines.push(`  duration_ms: ${task.receipt.durationMs}`);
  }
  // Cross-provider routing (ROADMAP item 1): show the scored candidate list
  // and the chosen candidate. Prefer the signed receipt's copy (post-run);
  // fall back to the schedule-time decision on the task row (pre-run).
  const routing = task.receipt?.routing ?? task.routingDecision;
  if (routing) {
    lines.push("");
    lines.push("Cross-provider routing:");
    lines.push(`  chosen: ${routing.chosen}`);
    if (routing.fallbackFrom)
      lines.push(`  fallback_from: ${routing.fallbackFrom}`);
    lines.push(
      `  weights: carbon=${routing.weights.carbon} cost=${routing.weights.cost} latency=${routing.weights.latency}`,
    );
    lines.push("  considered:");
    for (const c of routing.considered) {
      lines.push(
        `    ${c.provider}:${c.model} — score ${c.score}, carbon ${c.estCarbonG}g, cost $${c.estCostUsd}, latency ${c.latencyClass}`,
      );
    }
    lines.push(`  reasoning: ${routing.reasoning}`);
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
