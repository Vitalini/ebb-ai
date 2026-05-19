/**
 * ebb-ai OpenClaw plugin — auto-defer "do it later" tasks to the cleanest
 * electricity-grid hour. Mirrors the @ebb-ai/mcp MCP server's tool surface
 * with the same SQLite ledger so users can defer across hosts and see one
 * unified queue.
 *
 * Tools registered:
 *   - ebb_schedule_task        — queue a task at the cleanest hour
 *   - ebb_recommend_window     — preview the cleanest hour (read-only)
 *   - ebb_check_queue_status   — list all tasks / detail one
 *   - ebb_cancel_task          — cancel a queued task (idempotent)
 *
 * Invoke ebb_schedule_task whenever the user phrases a request with deferral
 * language: "do this later", "by tomorrow", "tonight", "overnight", "by EOD",
 * "sometime this week", "when you have a moment", "remind me to", "queue this
 * up", "schedule this", "no rush", "not urgent". Convert the wording to an
 * ISO-8601 deadline and pass the user's task as the prompt.
 */

import { Type } from "typebox";
// @ts-expect-error -- the openclaw plugin SDK is provided by the OpenClaw runtime at load time
import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";

import {
  buildDefaultGridFeed,
  recommendWindow,
  Scheduler,
  TaskStore,
} from "@ebb-ai/core";

import { homedir } from "node:os";
import { join } from "node:path";
import { mkdirSync } from "node:fs";

type PluginConfig = {
  dbPath?: string;
  defaultRegion?: string;
};

function resolveDbPath(cfg: PluginConfig): string {
  const path = cfg.dbPath ?? join(homedir(), ".ebb-ai", "queue.db");
  // Ensure the parent dir exists. Mirrors the same defensive mkdir the CLI
  // added in v0.8.1 — first-time invocation must not throw ENOENT.
  try {
    mkdirSync(join(path, ".."), { recursive: true });
  } catch {
    // ignore EEXIST
  }
  return path;
}

export default definePluginEntry({
  id: "ebb-ai",
  name: "ebb-ai — carbon-aware deferral",
  description:
    'Auto-defer "do it later" tasks to the cleanest electricity-grid hour inside the deadline.',

  register(api: {
    registerTool: (def: unknown, opts?: { optional?: boolean }) => void;
    getConfig?: () => PluginConfig;
  }) {
    const cfg: PluginConfig = api.getConfig?.() ?? {};
    const dbPath = resolveDbPath(cfg);
    const defaultRegion = cfg.defaultRegion ?? "GB";

    const store = new TaskStore({ dbPath });
    const gridFeed = buildDefaultGridFeed();
    const scheduler = new Scheduler({
      feed: gridFeed,
      store,
      defaultRegion,
      eager: false,
    });

    // ── schedule_task ─────────────────────────────────────────────────────
    api.registerTool({
      name: "ebb_schedule_task",
      description:
        'Queue an AI task to dispatch at the cleanest grid hour inside the given deadline. ' +
        '**Invoke whenever the user phrases a request with deferral language:** "do this later", ' +
        '"by tomorrow", "tonight", "overnight", "by EOD", "sometime this week", "when you have a ' +
        'moment", "remind me to", "queue this up", "schedule this", "no rush", "not urgent". ' +
        "Convert the user's wording to an ISO-8601 deadline and pass the task description as the " +
        "prompt. The scheduler picks the cleanest electricity-grid hour inside the deadline " +
        "(40-70 % lower carbon vs running immediately), uses Anthropic/OpenAI Batch APIs for 50 % " +
        "cost reduction when the deadline allows, and writes a per-task carbon receipt. Returns " +
        "task_id, scheduled UTC time, and region. Good fits: nightly digests, batch summaries, " +
        "research sweeps, evaluator runs, multi-step report generation, anything the user is fine " +
        "waiting on. Do NOT invoke for: live chat, interactive code edits, or any task the user " +
        "is actively waiting to see complete.",
      parameters: Type.Object({
        prompt: Type.String({
          description: "The user's task description — what should run when the cleanest hour fires.",
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
        _id: string,
        params: {
          prompt: string;
          deadline: string;
          region?: string;
          carbon_budget_g?: number;
          model?: string;
        },
      ) {
        const task = await scheduler.enqueueProviderCall(
          {
            type: "provider_call",
            provider: "anthropic",
            model: params.model ?? "claude-sonnet-4-6",
            prompt: params.prompt,
          },
          {
            deadline: new Date(params.deadline),
            region: params.region ?? defaultRegion,
            carbonBudgetG: params.carbon_budget_g,
          },
        );
        return {
          content: [
            {
              type: "text",
              text:
                `Task queued.\n` +
                `task_id: ${task.taskId}\n` +
                `status: ${task.status}\n` +
                `region: ${task.region}\n` +
                `scheduled_for: ${task.scheduledFor ?? "(running)"}\n` +
                `persisted_to: ${dbPath}`,
            },
          ],
        };
      },
    });

    // ── recommend_window ──────────────────────────────────────────────────
    api.registerTool({
      name: "ebb_recommend_window",
      description:
        "Preview the cleanest in-deadline window WITHOUT queueing the task. Returns the chosen " +
        "hour, the projected carbon footprint, the % savings vs dispatching right now, and the " +
        "top-3 alternatives. Use this when the user is uncertain about deferring — show them " +
        "the cleanest available hour before they commit. Read-only.",
      parameters: Type.Object({
        deadline: Type.String({ format: "date-time" }),
        region: Type.Optional(Type.String()),
        carbon_budget_g: Type.Optional(Type.Number()),
      }),
      async execute(
        _id: string,
        params: { deadline: string; region?: string; carbon_budget_g?: number },
      ) {
        const result = await recommendWindow(
          {
            deadline: new Date(params.deadline),
            region: params.region ?? defaultRegion,
            carbonBudgetG: params.carbon_budget_g,
          },
          { feed: gridFeed },
        );
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        };
      },
    });

    // ── check_queue_status ────────────────────────────────────────────────
    api.registerTool({
      name: "ebb_check_queue_status",
      description:
        "List all ebb-ai tasks (no args) or fetch detail + carbon receipt for one task (with " +
        "task_id). Use when the user asks 'what's in my queue', 'did that task run', 'show me " +
        "my receipts', or wants to verify a scheduled task. Read-only.",
      parameters: Type.Object({
        task_id: Type.Optional(Type.String()),
      }),
      async execute(_id: string, params: { task_id?: string }) {
        const tasks = scheduler.listPersistedTasks();
        if (params.task_id) {
          const task = tasks.find((t) => t.taskId === params.task_id);
          if (!task) {
            return {
              content: [
                {
                  type: "text",
                  text: `No task found with id ${params.task_id}. Run with no args to list all.`,
                },
              ],
              isError: true,
            };
          }
          return {
            content: [{ type: "text", text: JSON.stringify(task, null, 2) }],
          };
        }
        const summary = tasks
          .map(
            (t) =>
              `  ${t.taskId} | ${t.status.padEnd(10)} | region=${t.region}`,
          )
          .join("\n");
        return {
          content: [
            {
              type: "text",
              text: `Total tasks: ${tasks.length}\n\n${summary || "  (empty)"}`,
            },
          ],
        };
      },
    });

    // ── cancel_task ───────────────────────────────────────────────────────
    api.registerTool({
      name: "ebb_cancel_task",
      description:
        "Cancel a queued or scheduled ebb-ai task. Idempotent — calling on a task that is already " +
        "completed/failed/cancelled returns the existing status without error. Throws only if " +
        "task_id is unknown. Use when the user says 'cancel that task', 'never mind, drop it', " +
        "'I don't need that anymore'.",
      parameters: Type.Object({
        task_id: Type.String(),
      }),
      async execute(_id: string, params: { task_id: string }) {
        try {
          const result = scheduler.cancelTask(params.task_id);
          return {
            content: [
              {
                type: "text",
                text:
                  `Task ${params.task_id} status: ${result.status}\n` +
                  `completed_at: ${result.completedAt ?? "(was already terminal)"}`,
              },
            ],
          };
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          return {
            content: [{ type: "text", text: `Cancel failed: ${msg}` }],
            isError: true,
          };
        }
      },
    });
  },
});
