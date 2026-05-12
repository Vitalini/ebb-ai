#!/usr/bin/env node
/**
 * ebb-mcp — Model Context Protocol server for carbon-aware AI task scheduling.
 *
 * Exposes three tools to any MCP-compatible agent (Claude Desktop,
 * Claude Code, OpenClaw, Cursor, custom MCP clients):
 *
 *   - get_grid_forecast(region, hours?) → forecasted carbon intensity
 *   - schedule_task(prompt, deadline, model?, carbon_budget_g?) → enqueue
 *   - check_queue_status(task_id?) → status / receipts
 *
 * The server reads `EBB_ELECTRICITY_MAPS_API_KEY` from the environment; if
 * absent, it transparently falls back to a deterministic mock grid feed so
 * the whole stack still runs end-to-end.
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { electricityMapsFeed, Scheduler } from "@ebb-ai/core";
import { z } from "zod";

const DEFAULT_REGION = process.env.EBB_DEFAULT_REGION ?? "US-CAL-CISO";

const feed = electricityMapsFeed();
const scheduler = new Scheduler({ feed, defaultRegion: DEFAULT_REGION });

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
      "Model name to dispatch with (e.g. 'claude-sonnet-4-6'). Optional in v0.1.",
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
});

const checkQueueStatusInput = z.object({
  task_id: z
    .string()
    .optional()
    .describe(
      "If present, return only this task. If omitted, return a queue summary.",
    ),
});

const server = new Server(
  { name: "ebb-mcp", version: "0.1.0" },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "get_grid_forecast",
      description:
        "Return the projected electricity-grid carbon intensity for a region, hour by hour. Use this when deciding whether to run an expensive AI task now or defer it. Carbon intensity is reported in grams CO2-equivalent per kWh, with a categorical band (very_clean / clean / average / dirty / very_dirty).",
      inputSchema: {
        type: "object",
        properties: {
          region: {
            type: "string",
            description:
              "Electricity Maps zone code, e.g. 'US-CAL-CISO', 'US-TEX-ERCO', 'FR', 'DE'.",
          },
          hours: {
            type: "number",
            description: "Forecast horizon in hours (1-72). Defaults to 24.",
          },
        },
        required: ["region"],
      },
    },
    {
      name: "schedule_task",
      description:
        "Queue an AI task to run during the cleanest grid window inside the given deadline. Returns a task_id that can later be checked with check_queue_status. Use this for work that does NOT need to complete instantly — research sweeps, batch summaries, overnight digests, anything where the user is fine waiting until a specified deadline.",
      inputSchema: {
        type: "object",
        properties: {
          prompt: {
            type: "string",
            description: "Prompt or instruction to dispatch at the chosen time.",
          },
          deadline: {
            type: "string",
            description:
              "ISO-8601 timestamp by which the task must complete. Required.",
          },
          model: {
            type: "string",
            description:
              "Optional model identifier (e.g. 'claude-sonnet-4-6').",
          },
          region: {
            type: "string",
            description: "Optional grid region override.",
          },
          carbon_budget_g: {
            type: "number",
            description:
              "Optional hard cap on estimated grams CO2-equivalent for this task.",
          },
        },
        required: ["prompt", "deadline"],
      },
    },
    {
      name: "check_queue_status",
      description:
        "Report on the ebb-ai task queue. With no arguments, returns a compact summary of all known tasks. With task_id, returns full detail for one task including any carbon receipt.",
      inputSchema: {
        type: "object",
        properties: {
          task_id: {
            type: "string",
            description: "Optional task identifier returned by schedule_task.",
          },
        },
      },
    },
  ],
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

    if (name === "schedule_task") {
      const parsed = scheduleTaskInput.parse(args);
      try {
        const record = scheduler.enqueue(
          // v0.1: the MCP server does not actually call the LLM itself —
          // the agent calling this tool is expected to do that after the
          // server informs it the window has opened. A future release will
          // dispatch via Anthropic / OpenAI directly.
          async () => ({
            prompt: parsed.prompt,
            model: parsed.model ?? null,
            dispatched: true,
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
                `Task queued.\n` +
                `task_id: ${record.taskId}\n` +
                `region: ${record.region}\n` +
                `status: ${record.status}\n` +
                `deadline: ${parsed.deadline}\n` +
                `Note: in v0.1 the MCP server schedules the dispatch time but does not call the LLM itself. ` +
                `Poll check_queue_status to see when the chosen window arrives, then execute the prompt yourself.`,
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
      const all = scheduler.listTasks();
      return {
        content: [
          { type: "text", text: formatQueueSummary(all) },
        ],
      };
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

function formatForecast(forecast: Awaited<ReturnType<typeof feed.fetchForecast>>): string {
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

function formatTask(task: ReturnType<Scheduler["getTask"]>): string {
  if (!task) return "";
  const lines = [
    `task_id: ${task.taskId}`,
    `status: ${task.status}`,
    `region: ${task.region}`,
    `enqueued_at: ${task.enqueuedAt}`,
  ];
  if (task.scheduledFor) lines.push(`scheduled_for: ${task.scheduledFor}`);
  if (task.completedAt) lines.push(`completed_at: ${task.completedAt}`);
  if (task.carbonBudgetG)
    lines.push(`carbon_budget_g: ${task.carbonBudgetG}`);
  if (task.receipt) {
    lines.push("");
    lines.push("Carbon receipt:");
    lines.push(`  ran_at: ${task.receipt.ranAt}`);
    lines.push(`  estimated_carbon_g: ${task.receipt.estimatedCarbonGCo2}`);
    if (task.receipt.durationMs)
      lines.push(`  duration_ms: ${task.receipt.durationMs}`);
  }
  if (task.error) lines.push(`error: ${task.error}`);
  return lines.join("\n");
}

function formatQueueSummary(
  tasks: ReadonlyArray<ReturnType<Scheduler["getTask"]>>,
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
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // eslint-disable-next-line no-console
  console.error(
    "[ebb-mcp] ready (stdio) — region=" +
      DEFAULT_REGION +
      ", grid feed=" +
      feed.source,
  );
}

main().catch((err: unknown) => {
  // eslint-disable-next-line no-console
  console.error("[ebb-mcp] fatal:", err);
  process.exit(1);
});
