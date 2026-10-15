// Page state: the task lists, dispatcher status, forecasts and series
// projections, plus optimistic writes.
//
// A write is an "op": its patch is applied to the task at read time, so a
// refresh that lands before the server has the change cannot flash the old
// state back. The op is confirmed when the change stream names the task and
// a re-fetch shows the new state; a 4xx/5xx removes the patch (rollback)
// and shows the server's message. Cancel is a delayed commit: the POST is
// sent after the 5 s Undo window, or on pagehide.

import { api, ApiError, postKeepalive, request, SessionExpired, tasksPath } from "./api.js";
import { FINISHED, PENDING, title } from "./dom.js";
import { errorToast, toast } from "./toast.js";

const FORECAST_TTL_MS = 10 * 60_000;
const CONFIRM_FALLBACK_MS = 5_000;
const UNDO_MS = 5_000;

export const state = {
  loaded: false,
  error: null,
  expired: false,
  connected: true,
  pending: [],
  finished: [],
  status: null,
  /** region -> {at, points, source, error} */
  forecasts: new Map(),
  /** series id -> /api/series body */
  series: new Map(),
  /** task id -> op */
  ops: new Map(),
};

const listeners = new Set();
const taskListeners = new Set();

/** Re-render hook: called after every state change. */
export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Called with the ids of every change-stream event (after the re-fetch). */
export function onTaskEvent(fn) {
  taskListeners.add(fn);
  return () => taskListeners.delete(fn);
}

let notifyQueued = false;
export function notify() {
  if (notifyQueued) return;
  notifyQueued = true;
  queueMicrotask(() => {
    notifyQueued = false;
    for (const fn of listeners) fn();
  });
}

// ── reads ───────────────────────────────────────────────────────────────

/** Every known task with optimistic patches applied, keyed by id. */
function allTasks() {
  const out = new Map();
  for (const t of [...state.finished, ...state.pending]) out.set(t.task_id, t);
  for (const [id, op] of state.ops) {
    const t = out.get(id);
    if (t) out.set(id, { ...t, ...op.patch, _op: op });
  }
  return out;
}

export function pendingTasks() {
  return [...allTasks().values()].filter((t) => PENDING.includes(t.status));
}

export function finishedTasks() {
  return [...allTasks().values()].filter((t) => FINISHED.includes(t.status));
}

export function findTask(id) {
  return allTasks().get(id);
}

let seq = 0;

/** Re-fetch lists and status. Older answers that land late are dropped. */
export async function refresh() {
  const mine = ++seq;
  try {
    const [p, f, st] = await Promise.all([
      api.list(`status=${PENDING.join(",")}`),
      api.list(`status=${FINISHED.join(",")}&limit=1000`),
      api.status(),
    ]);
    if (mine !== seq) return false;
    state.pending = p.tasks;
    state.finished = f.tasks;
    state.status = st;
    state.loaded = true;
    state.error = null;
    notify();
    void loadSeries();
    void loadForecasts();
    return true;
  } catch (err) {
    if (mine !== seq) return false;
    if (err instanceof SessionExpired) state.expired = true;
    else state.error = err;
    notify();
    return false;
  }
}

export async function refreshStatus() {
  try {
    state.status = await api.status();
    notify();
  } catch (err) {
    if (err instanceof SessionExpired) {
      state.expired = true;
      notify();
    }
  }
}

async function loadSeries() {
  const ids = new Set(
    state.pending.filter((t) => t.series_id && t.repeat && t.repeat !== "none").map((t) => t.series_id),
  );
  for (const id of [...state.series.keys()]) if (!ids.has(id)) state.series.delete(id);
  await Promise.all(
    [...ids].map(async (id) => {
      try {
        state.series.set(id, await api.series(id));
      } catch {
        state.series.delete(id);
      }
    }),
  );
  notify();
}

/** Regions with pending work, plus the default region. */
function regions() {
  const out = new Set(state.pending.map((t) => t.region).filter(Boolean));
  if (state.status?.default_region) out.add(state.status.default_region);
  return [...out];
}

async function loadForecasts() {
  const now = Date.now();
  const todo = regions().filter((r) => {
    const f = state.forecasts.get(r);
    return !f || now - f.at > FORECAST_TTL_MS;
  });
  if (todo.length === 0) return;
  await Promise.all(
    todo.map(async (region) => {
      try {
        const f = await api.forecast(region, 72);
        state.forecasts.set(region, { at: now, points: f.points, source: f.source, region: f.region, error: null });
      } catch (err) {
        state.forecasts.set(region, { at: now, points: [], source: null, region, error: err });
      }
    }),
  );
  notify();
}

/** Forecast point covering `ms` for `region`, or undefined. */
export function forecastAt(region, ms) {
  const f = state.forecasts.get(region);
  if (!f || !Number.isFinite(ms)) return undefined;
  const hour = Math.floor(ms / 3_600_000);
  return f.points.find((p) => Math.floor(Date.parse(p.t) / 3_600_000) === hour);
}

// ── writes ──────────────────────────────────────────────────────────────

/**
 * Run one optimistic write.
 *   id       task id
 *   patch    fields applied to the row at once
 *   label    pending text shown in the row ("Moving…")
 *   send     () => Promise (the POST)
 *   confirm  (freshTask) => toast text once the stream confirms
 * Returns the POST result, or undefined when it failed.
 */
export async function perform({ id, patch, label, send, confirm, action }) {
  const op = { id, patch: patch || {}, label, confirm, action, posted: false, timer: null };
  state.ops.set(id, op);
  notify();
  return commit(op, send);
}

async function commit(op, send) {
  try {
    const out = await send();
    op.posted = true;
    op.result = out;
    // The stream normally confirms within a second; if it is down, a plain
    // re-fetch confirms instead.
    // The server emits before it answers, so the event may already be here.
    if (op.seen) void confirmOps([op.id]);
    else op.timer = setTimeout(() => confirmOps([op.id]), CONFIRM_FALLBACK_MS);
    return out;
  } catch (err) {
    state.ops.delete(op.id);
    notify();
    if (err instanceof SessionExpired) {
      state.expired = true;
      notify();
    } else {
      // 409 carries the core's one-line refusal; other statuses (500 "action
      // failed", 400 validation) say only that the server did not apply it.
      const msg = !(err instanceof ApiError)
        ? "Network error; nothing changed."
        : err.status === 409 || err.status === 400
          ? err.message
          : "the server could not apply it; nothing changed.";
      errorToast(`${capital(op.action || "Action")} failed: ${msg}`);
      void refresh();
    }
    return undefined;
  }
}

async function confirmOps(ids) {
  const ready = ids.map((id) => state.ops.get(id)).filter((op) => op && op.posted);
  if (ready.length === 0) return;
  await refresh();
  for (const op of ready) {
    if (state.ops.get(op.id) !== op) continue;
    clearTimeout(op.timer);
    state.ops.delete(op.id);
    const fresh = findTask(op.id) || op.result;
    if (op.confirm) {
      const msg = op.confirm(fresh);
      if (msg) toast(msg.text || msg, msg.action ? { action: msg.action } : {});
    }
  }
  notify();
}

function capital(s) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Delayed cancels: id -> {op, toast, series} */
const delayed = new Map();

/**
 * Cancel with Undo (KTD12). The row looks cancelled at once; the POST goes
 * out when the toast expires. Undo drops the patch and sends nothing.
 */
export function cancelWithUndo(task, { series = false } = {}) {
  if (delayed.has(task.task_id)) return;
  const id = task.task_id;
  const op = {
    id,
    patch: { status: "cancelled", completed_at: new Date().toISOString(), repeat: series ? "none" : task.repeat },
    label: "Cancelling…",
    action: series ? "stop series" : "cancel",
    posted: false,
    timer: null,
    delayed: true,
    confirm: () => (series ? `Series stopped: “${title(task)}”` : `Cancelled “${title(task)}”`),
  };
  state.ops.set(id, op);
  notify();
  const t = toast(series ? `Stopping series “${title(task)}”` : `Cancelled “${title(task)}”`, {
    timeout: UNDO_MS,
    countdown: true,
    action: {
      label: "Undo",
      run: () => {
        delayed.delete(id);
        state.ops.delete(id);
        notify();
        toast(`Kept “${title(task)}”`);
      },
    },
    onTimeout: () => {
      if (!delayed.has(id)) return;
      delayed.delete(id);
      op.delayed = false;
      op.label = "Cancelling…";
      void commit(op, () => api.cancel(id, series));
    },
  });
  delayed.set(id, { op, toast: t, series });
}

/** True while a cancel for `id` waits in its Undo window. */
export function cancelPending(id) {
  return delayed.has(id);
}

/** Send every delayed cancel now (the page is going away). */
export function flushDelayed() {
  for (const [id, d] of delayed) {
    postKeepalive(tasksPath(id, "cancel"), d.series ? { series: true } : {});
  }
  delayed.clear();
}

// ── change stream (SSE read over fetch so the bearer header applies) ─────

export async function stream() {
  let delay = 1000;
  let reconnect = false;
  while (!state.expired) {
    try {
      const res = await request("/api/events");
      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
      state.connected = true;
      notify();
      delay = 1000;
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let i;
        while ((i = buf.indexOf("\n\n")) >= 0) {
          const msg = buf.slice(0, i);
          buf = buf.slice(i + 2);
          handleEvent(msg, reconnect);
        }
      }
    } catch (err) {
      if (err instanceof SessionExpired) {
        state.expired = true;
        notify();
        return;
      }
    }
    state.connected = false;
    notify();
    reconnect = true;
    await new Promise((r) => setTimeout(r, delay));
    delay = Math.min(delay * 2, 30_000);
  }
}

function handleEvent(msg, reconnect) {
  const event = /^event: (.+)$/m.exec(msg)?.[1];
  const data = /^data: (.*)$/m.exec(msg)?.[1];
  if (event === "hello") {
    // Changes made while the stream was down produce no event of their own.
    if (reconnect) void refresh().then(() => emitTaskEvent([]));
    return;
  }
  if (event !== "tasks") return;
  let ids = [];
  try {
    ids = JSON.parse(data || "{}").ids || [];
  } catch {
    ids = [];
  }
  for (const id of ids) {
    const op = state.ops.get(id);
    if (op && !op.posted) op.seen = true;
  }
  const mine = ids.filter((id) => state.ops.get(id)?.posted);
  const work = mine.length ? confirmOps(mine) : refresh();
  void work.then(() => emitTaskEvent(ids));
}

function emitTaskEvent(ids) {
  for (const fn of taskListeners) fn(ids);
}
