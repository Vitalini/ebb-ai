/**
 * `ebb queue list | show | unread` — inspect the ledger.
 *
 * We deliberately avoid a table-printing dependency. Columns are
 * padded with String.prototype.padEnd to a fixed width.
 *
 * Every task string printed here (title, prompt, result, error, ids) is
 * untrusted: it comes from prompts and model output. It goes through
 * `stripControlChars` so it cannot carry terminal escape sequences.
 */

import {
  deadlineKindLabel,
  LAST_TICK_META_KEY,
  loadQuotaResetConfig,
  stripControlChars,
  taskHistory,
  taskPrompt,
  taskResultText,
  TaskStore,
} from "@ebb-ai/core";
import type {
  DeadlineKind,
  QuotaResetConfig,
  TaskListFilter,
  TaskRecord,
  TaskStatus,
} from "@ebb-ai/core";
import { defaultDbPath } from "./tick.js";

export const VALID_STATUSES: ReadonlySet<TaskStatus> = new Set([
  "queued",
  "scheduled",
  "running",
  // v0.12: task routed through a provider Batch API, awaiting results.
  "submitted",
  "completed",
  "failed",
  "cancelled",
]);

export const VALID_KINDS: ReadonlySet<DeadlineKind> = new Set(["absolute", "quota_reset"]);

export interface QueueListOptions {
  db?: string;
  status?: string;
  /** Only finished (completed / failed) tasks nobody has viewed yet. */
  unread?: boolean;
  /** `absolute` or `quota_reset`. */
  kind?: string;
  json?: boolean;
}

export interface QueueListResult {
  rows: TaskRecord<unknown>[];
  rendered: string;
}

/** One line of terminal-safe text. */
function safe(value: string): string {
  return stripControlChars(value);
}

/** Multi-line terminal-safe text (keeps newlines and tabs). */
function safeBlock(value: string): string {
  return stripControlChars(value, { multiline: true });
}

function fmtCol(value: string | number | undefined, width: number): string {
  const s = value === undefined || value === null ? "-" : safe(String(value));
  const chars = Array.from(s);
  return (chars.length > width ? chars.slice(0, width - 1).join("") + "…" : s).padEnd(width);
}

function kindCell(r: TaskRecord<unknown>): string {
  return r.deadlineKind === "quota_reset" ? `quota:${r.quotaProvider ?? "?"}` : "abs";
}

export function renderQueue(
  rows: TaskRecord<unknown>[],
  opts: { lastTickAt?: string } = {},
): string {
  const header =
    fmtCol("task_id", 38) +
    fmtCol("status", 12) +
    fmtCol("title", 34) +
    fmtCol("deadline", 26) +
    fmtCol("kind", 14) +
    fmtCol("scheduled_for", 26) +
    fmtCol("region", 16);
  const sep = "-".repeat(header.length);
  const lines = rows.map(
    (r) =>
      fmtCol(r.taskId, 38) +
      fmtCol(r.status, 12) +
      fmtCol(r.title, 34) +
      fmtCol(r.deadline, 26) +
      fmtCol(kindCell(r), 14) +
      fmtCol(r.scheduledFor, 26) +
      fmtCol(r.region, 16),
  );
  // When a ticker (`ebb tick` or the OpenClaw loop) last ran: tells the user
  // whether scheduled tasks are actually being dispatched.
  const tick = `last tick: ${opts.lastTickAt ?? "never recorded"}`;
  return [header, sep, ...lines, "", tick].join("\n");
}

/**
 * The fields `queue list --json` and the `ebb ui` list API print per task
 * (no prompt, no result).
 */
export function taskSummary(r: TaskRecord<unknown>): Record<string, unknown> {
  return {
    task_id: r.taskId,
    title: r.title ?? null,
    status: r.status,
    origin_host: r.originHost ?? null,
    deadline: r.deadline ?? null,
    deadline_kind: r.deadlineKind ?? "absolute",
    quota_provider: r.quotaProvider ?? null,
    scheduled_for: r.scheduledFor ?? null,
    completed_at: r.completedAt ?? null,
    read_at: r.readAt ?? null,
    region: r.region,
  };
}

function buildFilter(opts: QueueListOptions): TaskListFilter {
  const filter: TaskListFilter = {};
  if (opts.status) {
    if (!VALID_STATUSES.has(opts.status as TaskStatus)) {
      throw new Error(
        `queue list: unknown status ${JSON.stringify(opts.status)}. Valid: ${[...VALID_STATUSES].join(", ")}`,
      );
    }
    filter.status = opts.status as TaskStatus;
  }
  if (opts.kind) {
    if (!VALID_KINDS.has(opts.kind as DeadlineKind)) {
      throw new Error(
        `queue list: unknown kind ${JSON.stringify(opts.kind)}. Valid: ${[...VALID_KINDS].join(", ")}`,
      );
    }
    filter.deadlineKind = opts.kind as DeadlineKind;
  }
  if (opts.unread) filter.unread = true;
  return filter;
}

export async function runQueueList(
  opts: QueueListOptions = {},
): Promise<QueueListResult> {
  const filter = buildFilter(opts);
  const dbPath = opts.db ?? defaultDbPath();
  const store = new TaskStore({ dbPath });
  try {
    const rows = store.list(filter);
    const lastTickAt = store.getMeta(LAST_TICK_META_KEY);
    const rendered = opts.json
      ? JSON.stringify({ last_tick_at: lastTickAt ?? null, tasks: rows.map(taskSummary) }, null, 2)
      : renderQueue(rows, { lastTickAt });
    return { rows, rendered };
  } finally {
    store.close();
  }
}

export interface QueueShowOptions {
  db?: string;
  /** Include the raw vendor payload (`result.raw`). */
  raw?: boolean;
  json?: boolean;
  /** Default true: viewing a finished task marks it read. */
  markRead?: boolean;
  /** Override the ~/.ebb-ai/config path (tests). */
  config?: string;
}

export interface QueueShowResult {
  record: TaskRecord<unknown>;
  rendered: string;
}

export function rawPayload(record: TaskRecord<unknown>): unknown {
  const r = record.result as { raw?: unknown } | undefined;
  return r && typeof r === "object" ? r.raw : undefined;
}

/** Render one task in text, the CLI twin of the `ebb ui` detail view. */
export function renderTask(
  record: TaskRecord<unknown>,
  opts: { raw?: boolean; quota?: QuotaResetConfig } = {},
): string {
  const lines: string[] = [];
  const kv = (key: string, value: string | number | undefined) => {
    if (value !== undefined && value !== "") lines.push(`${key}: ${safe(String(value))}`);
  };
  kv("task_id", record.taskId);
  kv("title", record.title);
  kv("status", record.status);
  if (record.originHost) {
    kv("origin", `${record.originHost}${record.originCwd ? ` (${record.originCwd})` : ""}`);
  }
  kv("parent", record.parentTaskId);
  kv("read_at", record.readAt);
  lines.push("");
  kv("enqueued_at", record.enqueuedAt);
  kv("scheduled_for", record.scheduledFor);
  if (record.deadline) {
    kv("deadline", `${record.deadline} (${deadlineKindLabel(record, opts.quota)})`);
  }
  kv("completed_at", record.completedAt);
  kv("region", record.region);

  const prompt = taskPrompt(record);
  if (prompt !== undefined) {
    lines.push("", "Prompt:", safeBlock(prompt));
  }
  // Prior turns only: the current user turn is the prompt and the reply is
  // the result, both printed in their own blocks.
  const history = taskHistory(record);
  const hasReply = record.status === "completed" && taskResultText(record) !== undefined;
  const prior = history.slice(0, Math.max(0, history.length - 1 - (hasReply ? 1 : 0)));
  if (prior.length > 0) {
    lines.push("", "History:");
    for (const turn of prior) lines.push(`[${turn.role}] ${safeBlock(turn.content)}`);
  }
  const text = taskResultText(record);
  if (text !== undefined) {
    lines.push("", "Result:", safeBlock(text));
  } else if (record.result !== undefined && record.status === "completed") {
    lines.push("", "Result:", safeBlock(JSON.stringify(record.result, null, 2)));
  }
  if (record.error) lines.push("", `error: ${safeBlock(record.error)}`);

  const receipt = record.receipt;
  if (receipt) {
    lines.push("", "Receipt:");
    const rk = (key: string, value: string | number | undefined) => {
      if (value !== undefined) lines.push(`  ${key}: ${safe(String(value))}`);
    };
    rk("ran_at", receipt.ranAt);
    if (receipt.provider || receipt.model) {
      rk("model", `${receipt.provider ?? "?"}:${receipt.model ?? "?"}`);
    }
    rk("estimated_carbon_g", receipt.estimatedCarbonGCo2);
    rk("actual_carbon_g", receipt.actualCarbonGCo2);
    rk("intensity_g_co2_per_kwh", receipt.intensityGCo2PerKwh);
    rk(
      "grid_source",
      receipt.gridSource === "mock"
        ? "mock (SYNTHETIC grid data, not a measurement)"
        : receipt.gridSource,
    );
    rk("energy_source", receipt.energySource);
    rk("signed", receipt.signature ? "yes" : "no");
  }
  const routing = receipt?.routing ?? record.routingDecision;
  if (routing) {
    lines.push("", "Routing:", `  chosen: ${safe(routing.chosen)}`, `  reasoning: ${safe(routing.reasoning)}`);
  }
  if (opts.raw) {
    const raw = rawPayload(record);
    lines.push("", "Raw payload:", raw === undefined ? "(none)" : safeBlock(JSON.stringify(raw, null, 2)));
  }
  return lines.join("\n");
}

/**
 * `ebb queue show <id>`: print one task. A completed or failed task is
 * marked read unless `markRead` is false. Throws on an unknown id.
 */
export async function runQueueShow(
  taskId: string,
  opts: QueueShowOptions = {},
): Promise<QueueShowResult> {
  const dbPath = opts.db ?? defaultDbPath();
  const store = new TaskStore({ dbPath });
  try {
    let record = store.get(taskId);
    if (!record) throw new Error(`queue show: no task with id ${JSON.stringify(taskId)}`);
    if (opts.markRead !== false && store.markRead(taskId)) {
      record = store.get(taskId) ?? record;
    }
    const quota = loadQuotaResetConfig(opts.config !== undefined ? { path: opts.config } : {});
    if (opts.json) {
      const { result, ...rest } = record;
      const payload = {
        ...rest,
        result: opts.raw ? result : withoutRaw(result),
        deadline_label: deadlineKindLabel(record, quota),
        history: taskHistory(record),
      };
      return { record, rendered: JSON.stringify(payload, null, 2) };
    }
    return { record, rendered: renderTask(record, { raw: opts.raw, quota }) };
  } finally {
    store.close();
  }
}

export function withoutRaw(result: unknown): unknown {
  if (!result || typeof result !== "object" || !("raw" in result)) return result;
  const { raw: _raw, ...rest } = result as Record<string, unknown>;
  return rest;
}

/**
 * `ebb queue unread <id>`: clear a task's read marker so it shows in the
 * inbox again. Throws on an unknown id.
 */
export async function runQueueUnread(
  taskId: string,
  opts: { db?: string } = {},
): Promise<string> {
  const store = new TaskStore({ dbPath: opts.db ?? defaultDbPath() });
  try {
    if (!store.get(taskId)) {
      throw new Error(`queue unread: no task with id ${JSON.stringify(taskId)}`);
    }
    return store.markUnread(taskId)
      ? `${safe(taskId)}: marked unread`
      : `${safe(taskId)}: already unread`;
  } finally {
    store.close();
  }
}
