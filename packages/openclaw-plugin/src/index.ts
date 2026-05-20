/**
 * ebb-ai OpenClaw plugin — auto-defer "do it later" tasks to the cleanest
 * electricity-grid hour. Native OpenClaw tool plugin built with
 * `defineToolPlugin`, which registers the four tools so they reach agent
 * sessions.
 *
 * Verify a build with `openclaw plugins inspect ebb --runtime --json` — it
 * lists the four tools. Note: plain `openclaw plugins inspect ebb` reports
 * `Shape: non-capability` for tool plugins in OpenClaw 2026.5.18; that is the
 * expected label for this plugin kind, not an error.
 *
 * Shares the SQLite ledger at ~/.ebb-ai/queue.db with the @ebb-ai/mcp MCP
 * server and the @ebb-ai/cli CLI — a task deferred in OpenClaw shows up in
 * `ebb stats` and vice versa.
 *
 * Tools:
 *   - ebb_schedule_task       — queue a task at the cleanest hour
 *   - ebb_recommend_window    — preview the cleanest hour (read-only, no DB)
 *   - ebb_check_queue_status  — list all tasks / detail one (read-only)
 *   - ebb_cancel_task         — cancel a queued task (idempotent)
 */

import { Type, type TSchema } from "typebox";
// @ts-expect-error -- the openclaw plugin SDK is provided by the OpenClaw runtime at load time
import { defineToolPlugin } from "openclaw/plugin-sdk/tool-plugin";

import {
  buildDefaultGridFeed,
  recommendWindow,
  Scheduler,
  TaskStore,
} from "@ebb-ai/core";

import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { mkdirSync } from "node:fs";

type PluginConfig = {
  dbPath?: string;
  defaultRegion?: string;
};

type ToolDefinition = {
  name: string;
  label?: string;
  description: string;
  parameters: TSchema;
  optional?: boolean;
  execute: (params: never, config: PluginConfig, context?: unknown) => unknown;
};
type ToolFactory = (def: ToolDefinition) => unknown;

const DEFAULT_REGION = "GB";

function resolveDefaultRegion(config: PluginConfig): string {
  return config.defaultRegion ?? DEFAULT_REGION;
}

// ── Grid feed (no SQLite) ───────────────────────────────────────────────────
// The grid feed has no database dependency, so `ebb_recommend_window` keeps
// working even when the SQLite queue cannot be opened (e.g. a fresh plugin
// install whose better-sqlite3 native binding was not built).
let cachedGridFeed: ReturnType<typeof buildDefaultGridFeed> | undefined;

function getGridFeed(): ReturnType<typeof buildDefaultGridFeed> {
  cachedGridFeed ??= buildDefaultGridFeed();
  return cachedGridFeed;
}

// ── Queue runtime (SQLite-backed) ───────────────────────────────────────────
// Built lazily on the first queue-tool call. Constructing TaskStore here (not
// at module load) keeps plugin import side-effect free, and lets a missing
// native binding surface as a precise, actionable error instead of a crash.
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
  if (cachedQueueRuntime) return cachedQueueRuntime;
  const dbPath = resolveDbPath(config);

  let store: TaskStore;
  try {
    store = new TaskStore({ dbPath });
  } catch (err) {
    // TaskStore lazy-loads the better-sqlite3 native binding. OpenClaw
    // installs plugin dependencies without running install scripts, so a
    // fresh ClawHub install may not have the prebuilt binary.
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(
      `ebb-ai: could not open the task queue at ${dbPath}. The better-sqlite3 ` +
        `native binding is missing — OpenClaw installs plugin dependencies ` +
        `without build scripts. Build it once with:\n` +
        `  cd ~/.openclaw/extensions/ebb && npm rebuild better-sqlite3\n` +
        `then restart the gateway. (ebb_recommend_window works without this.) ` +
        `Original error: ${msg}`,
    );
  }

  const scheduler = new Scheduler({
    feed: getGridFeed(),
    store,
    defaultRegion: resolveDefaultRegion(config),
    eager: false,
  });
  cachedQueueRuntime = { store, scheduler, dbPath };
  return cachedQueueRuntime;
}

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
            "Default electricity-grid region when a tool call omits one. Examples: GB, US-CAL-CISO, FR. Defaults to GB (always-live data, no API key needed).",
        }),
      ),
    },
    { additionalProperties: false },
  ),
  tools: (tool: ToolFactory) => [
    // ── ebb_schedule_task ─────────────────────────────────────────────────
    tool({
      name: "ebb_schedule_task",
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
        "user is actively waiting to see complete.",
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
              "Optional grid-region override. Defaults to the plugin's configured defaultRegion (GB if unset).",
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
              "Optional provider model identifier, e.g. 'claude-sonnet-4-6' or 'gpt-4o'.",
          }),
        ),
      }),
      async execute(
        params: {
          prompt: string;
          deadline: string;
          region?: string;
          carbon_budget_g?: number;
          model?: string;
        },
        config: PluginConfig,
      ) {
        const { scheduler, dbPath } = getQueueRuntime(config);
        const task = await scheduler.enqueueProviderCall(
          {
            type: "provider_call",
            provider: "anthropic",
            model: params.model ?? "claude-sonnet-4-6",
            prompt: params.prompt,
          },
          {
            deadline: new Date(params.deadline),
            region: params.region ?? resolveDefaultRegion(config),
            carbonBudgetG: params.carbon_budget_g,
          },
        );
        return {
          task_id: task.taskId,
          status: task.status,
          region: task.region,
          scheduled_for: task.scheduledFor ?? null,
          persisted_to: dbPath,
        };
      },
    }),

    // ── ebb_recommend_window ──────────────────────────────────────────────
    tool({
      name: "ebb_recommend_window",
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
      ) {
        return await recommendWindow(
          {
            deadline: new Date(params.deadline),
            region: params.region ?? resolveDefaultRegion(config),
            carbonBudgetG: params.carbon_budget_g,
          },
          { feed: getGridFeed() },
        );
      },
    }),

    // ── ebb_check_queue_status ────────────────────────────────────────────
    tool({
      name: "ebb_check_queue_status",
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
      async execute(params: { task_id?: string }, config: PluginConfig) {
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
          return task;
        }
        return {
          total: tasks.length,
          tasks: tasks.map((t) => ({
            task_id: t.taskId,
            status: t.status,
            region: t.region,
            scheduled_for: t.scheduledFor ?? null,
          })),
        };
      },
    }),

    // ── ebb_cancel_task ───────────────────────────────────────────────────
    tool({
      name: "ebb_cancel_task",
      label: "Cancel an ebb-ai task",
      description:
        "Cancel a queued or scheduled ebb-ai task. Idempotent — calling it on a task that is " +
        "already completed/failed/cancelled returns the existing status without error. Throws " +
        "only if task_id is unknown. Use when the user says 'cancel that task', 'never mind, " +
        "drop it', 'I don't need that anymore'.",
      parameters: Type.Object({
        task_id: Type.String({ description: "The id of the task to cancel." }),
      }),
      async execute(params: { task_id: string }, config: PluginConfig) {
        const { scheduler } = getQueueRuntime(config);
        const result = scheduler.cancelTask(params.task_id);
        return {
          task_id: params.task_id,
          status: result.status,
          completed_at: result.completedAt ?? null,
        };
      },
    }),
  ],
});
