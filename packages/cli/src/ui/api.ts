/**
 * JSON API handlers for `ebb ui`. Read-only over the ledger except for the
 * read marker (`POST /api/tasks/:id/read` and `/unread`). Nothing here
 * dispatches, cancels or reschedules a task.
 *
 * Task strings are untrusted (prompts and model output). They leave here as
 * JSON values; the page renders them with `textContent` only.
 */

import {
  deadlineKindLabel,
  LAST_TICK_META_KEY,
  nextQuotaReset,
  taskHistory,
  taskPrompt,
  taskResultText,
  type DeadlineKind,
  type GridFeed,
  type QuotaResetConfig,
  type TaskRecord,
  type TaskStatus,
  type TaskStore,
} from "@ebb-ai/core";

import {
  rawPayload,
  taskSummary,
  VALID_KINDS,
  VALID_STATUSES,
  withoutRaw,
} from "../commands/queue.js";
import type { DaemonStatus } from "../platform/index.js";

export interface ApiContext {
  store: TaskStore;
  dbPath: string;
  feed: GridFeed;
  defaultRegion: string;
  /** Read per request so a config edit shows without a restart. */
  quota: () => QuotaResetConfig;
  daemonStatus: () => DaemonStatus;
  now?: () => Date;
}

export interface ApiResponse {
  status: number;
  body?: unknown;
}

/** Most hours of forecast one request returns. */
export const MAX_FORECAST_HOURS = 72;

const REGION_RE = /^[A-Za-z0-9_-]{1,64}$/;

function error(status: number, message: string): ApiResponse {
  return { status, body: { error: message } };
}

function listSummary(r: TaskRecord<unknown>): Record<string, unknown> {
  return {
    ...taskSummary(r),
    parent_task_id: r.parentTaskId ?? null,
    estimated_carbon_g: r.estimatedCarbonGCo2 ?? null,
  };
}

function listTasks(ctx: ApiContext, params: URLSearchParams): ApiResponse {
  const statuses = (params.get("status") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  for (const s of statuses) {
    if (!VALID_STATUSES.has(s as TaskStatus)) return error(400, `unknown status ${s}`);
  }
  const kind = params.get("kind") ?? undefined;
  if (kind !== undefined && !VALID_KINDS.has(kind as DeadlineKind)) {
    return error(400, `unknown kind ${kind}`);
  }
  const unread = params.get("unread") === "1" || params.get("unread") === "true";
  const base = {
    ...(kind ? { deadlineKind: kind as DeadlineKind } : {}),
    ...(unread ? { unread: true } : {}),
  };
  const rows =
    statuses.length === 0
      ? ctx.store.list(base)
      : statuses.flatMap((status) => ctx.store.list({ ...base, status: status as TaskStatus }));
  return {
    status: 200,
    body: {
      last_tick_at: ctx.store.getMeta(LAST_TICK_META_KEY) ?? null,
      tasks: rows.map(listSummary),
    },
  };
}

function taskDetail(ctx: ApiContext, taskId: string): ApiResponse {
  const r = ctx.store.get(taskId);
  if (!r) return error(404, "task not found");
  const quota = ctx.quota();
  const schedule = r.deadlineKind === "quota_reset" ? quota[r.quotaProvider ?? ""] : undefined;
  return {
    status: 200,
    body: {
      ...listSummary(r),
      enqueued_at: r.enqueuedAt,
      origin_cwd: r.originCwd ?? null,
      deadline_label: deadlineKindLabel(r, quota),
      quota_margin_h: schedule?.marginH ?? null,
      prompt: taskPrompt(r) ?? null,
      history: taskHistory(r),
      result_text: taskResultText(r) ?? null,
      result: withoutRaw(r.result) ?? null,
      error: r.error ?? null,
      receipt: r.receipt ?? null,
      routing: r.receipt?.routing ?? r.routingDecision ?? null,
      raw: rawPayload(r) ?? null,
    },
  };
}

function setRead(ctx: ApiContext, taskId: string, read: boolean): ApiResponse {
  const r = ctx.store.get(taskId);
  if (!r) return error(404, "task not found");
  if (r.status !== "completed" && r.status !== "failed") {
    return error(409, "only a completed or failed task has a read marker");
  }
  if (read) ctx.store.markRead(taskId, ctx.now?.() ?? new Date());
  else ctx.store.markUnread(taskId);
  return { status: 204 };
}

async function forecast(ctx: ApiContext, params: URLSearchParams): Promise<ApiResponse> {
  const region = params.get("region") || ctx.defaultRegion;
  if (!REGION_RE.test(region)) return error(400, "invalid region");
  const rawHours = Number(params.get("hours") ?? 24);
  const hours = Math.min(MAX_FORECAST_HOURS, Math.max(1, Number.isFinite(rawHours) ? Math.ceil(rawHours) : 24));
  try {
    const f = await ctx.feed.fetchForecast(region, hours);
    return {
      status: 200,
      body: {
        region: f.region,
        source: f.source,
        generated_at: f.generatedAt,
        points: f.entries.slice(0, hours).map((e) => ({
          t: e.datetime,
          g: e.carbonIntensityGCo2PerKwh,
          band: e.band,
        })),
      },
    };
  } catch (err) {
    return error(502, `forecast unavailable: ${(err as Error).message}`);
  }
}

function status(ctx: ApiContext): ApiResponse {
  const now = ctx.now?.() ?? new Date();
  const quota = ctx.quota();
  return {
    status: 200,
    body: {
      daemon: ctx.daemonStatus(),
      db_path: ctx.dbPath,
      default_region: ctx.defaultRegion,
      last_tick_at: ctx.store.getMeta(LAST_TICK_META_KEY) ?? null,
      quota: Object.entries(quota).map(([label, s]) => ({
        label,
        next_reset: nextQuotaReset(s, now).toISOString(),
        margin_h: s.marginH,
      })),
    },
  };
}

/**
 * Route one authenticated `/api/*` request (SSE is handled by the server).
 * Returns 404 for an unknown path and 405 for a wrong method.
 */
export async function handleApi(
  ctx: ApiContext,
  method: string,
  pathname: string,
  params: URLSearchParams,
): Promise<ApiResponse> {
  const parts = pathname.split("/").filter(Boolean); // ["api", ...]
  const route = parts.slice(1);
  const get = method === "GET";
  if (route.length === 1 && route[0] === "tasks") return get ? listTasks(ctx, params) : error(405, "method not allowed");
  if (route.length === 1 && route[0] === "forecast") return get ? forecast(ctx, params) : error(405, "method not allowed");
  if (route.length === 1 && route[0] === "status") return get ? status(ctx) : error(405, "method not allowed");
  if (route[0] === "tasks" && route.length >= 2) {
    let taskId: string;
    try {
      taskId = decodeURIComponent(route[1]!);
    } catch {
      return error(400, "bad task id");
    }
    if (route.length === 2) return get ? taskDetail(ctx, taskId) : error(405, "method not allowed");
    if (route.length === 3 && (route[2] === "read" || route[2] === "unread")) {
      return method === "POST" ? setRead(ctx, taskId, route[2] === "read") : error(405, "method not allowed");
    }
  }
  return error(404, "not found");
}
