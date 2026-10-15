// Agenda: the default view. Pending tasks grouped by local day (Today,
// Tomorrow, weekday + date, Later), with overdue tasks and unread failures
// in "Needs attention" on top, and projected rows for upcoming occurrences
// of repeating series. Day headers are drop targets (dnd.js).

import {
  by,
  bandChip,
  dayLabel,
  dayStart,
  daysFromToday,
  h,
  hm,
  nextDayStart,
  parse,
  relDay,
  when,
} from "./dom.js";
import { projectedRow, shortDay, statusTag, taskRow } from "./row.js";
import { finishedTasks, pendingTasks, state } from "./state.js";
import { emptyState, errorCard, skeletonRows } from "./views.js";

const PROJECT_DAYS = 14;
const LATER = "later";

/** Ids the user sent "Run now" from this page; they read "runs on the next tick". */
export const ranNow = new Set();

/** Seconds between dispatcher ticks, from /api/status. */
function tickInterval() {
  return state.status?.dispatcher?.interval_s ?? 300;
}

function dispatcherRunning() {
  return state.status?.dispatcher?.state === "running";
}

/** When a task runs, in ms: its scheduled hour, else its deadline. */
export function runAt(t) {
  const at = parse(t.scheduled_for);
  return Number.isFinite(at) ? at : parse(t.deadline);
}

/** Pending, due, but no tick picked it up in two intervals (or none runs). */
function isOverdue(t, now = Date.now()) {
  if (t.status !== "queued" && t.status !== "scheduled") return false;
  if (t._op || ranNow.has(t.task_id)) return false;
  const at = runAt(t);
  if (!Number.isFinite(at) || at > now) return false;
  return !dispatcherRunning() || now - at > 2 * tickInterval() * 1000;
}

function isDue(t, now) {
  const at = runAt(t);
  return (t.status === "queued" || t.status === "scheduled") && Number.isFinite(at) && at <= now;
}

/** Region whose forecast colours the day headers: the most common pending one. */
function primaryRegion(tasks) {
  const counts = new Map();
  for (const t of tasks) counts.set(t.region, (counts.get(t.region) || 0) + 1);
  let best = state.status?.default_region;
  let n = 0;
  for (const [r, c] of counts) if (c > n) [best, n] = [r, c];
  return best;
}

/** Cleanest forecast hour in [from, to) for `region`, or null. */
export function cleanest(region, from, to) {
  const f = state.forecasts.get(region);
  if (!f || f.points.length === 0) return null;
  let best = null;
  for (const p of f.points) {
    const t = Date.parse(p.t);
    if (t + 3_600_000 <= from || t >= to) continue;
    if (!best || p.g < best.g) best = { ...p, ms: t };
  }
  return best;
}

function dayHeader(key, label, sub, count, region, now) {
  const isDay = key !== LATER;
  const start = isDay ? Number(key) : NaN;
  const attrs = { class: "day-head" };
  if (isDay) {
    attrs["data-drop-day"] = String(start);
    const rel = relDay(start, now);
    // Weekday names already are the date ("Sat 17 Oct"); only Today and
    // Tomorrow need it added.
    attrs["data-drop-label"] = rel === dayLabel(start) ? rel : `${rel} · ${dayLabel(start)}`;
  }
  const head = h("div", attrs,
    h("h2", { class: "day-title" }, label, sub ? h("span", { class: "day-sub" }, ` · ${sub}`) : null),
    count ? h("span", { class: "day-count", "aria-label": `${count} tasks` }, String(count)) : null);
  if (isDay) {
    const best = cleanest(region, Math.max(start, now), nextDayStart(start));
    const forecastLoaded = state.forecasts.has(region);
    head.append(
      best
        ? h("span", { class: "day-clean" }, "cleanest ", h("span", { class: "num" }, hm(best.ms)), " ", bandChip(best.band))
        : forecastLoaded
          ? h("span", { class: "day-clean muted" }, "forecast not available yet")
          : null,
    );
  }
  head.append(h("span", { class: "drop-hint", "aria-hidden": "true" }, isDay ? `Move to ${relDay(start, now)}` : ""));
  return head;
}

function agendaMeta(t, now) {
  const dl = parse(t.deadline);
  const parts = [];
  if (t.status === "running" || t.status === "submitted") parts.push(statusTag(t));
  if (ranNow.has(t.task_id) && isDue(t, now)) parts.push(h("span", { class: "tag tag-accent" }, "runs on the next tick"));
  else if (isOverdue(t, now)) parts.push(h("span", { class: "tag tag-warn" }, `overdue since ${when(runAt(t), now)}`));
  else if (isDue(t, now)) parts.push(h("span", { class: "tag tag-accent" }, "due · runs on the next tick"));
  if (Number.isFinite(dl)) parts.push(by(dl, now));
  if (t.origin_host) parts.push(t.origin_host);
  return parts;
}

function timeLabel(t, key, now) {
  if (isDue(t, now) || t.status === "running") return "now";
  if (t.status === "submitted") return "batch";
  const at = runAt(t);
  if (key === LATER) return shortDay(at);
  return hm(at);
}

export function renderAgenda(root, { selectedId } = {}) {
  const now = Date.now();
  const header = h("div", { class: "view-head" }, h("h1", { class: "view-title" }, "Agenda"));
  root.append(header);

  if (!state.loaded) {
    root.append(state.error ? errorCard("Could not load tasks.") : skeletonGroups());
    return;
  }
  if (state.error) root.append(errorCard("Could not refresh tasks. Showing the last data."));

  const pend = pendingTasks();
  const attention = [];
  const upcoming = [];
  for (const t of pend) (isOverdue(t, now) ? attention : upcoming).push(t);
  const failed = finishedTasks()
    .filter((t) => t.status === "failed" && !t.read_at)
    .sort((a, b) => parse(b.completed_at) - parse(a.completed_at));

  const nextRun = upcoming.map(runAt).filter((x) => Number.isFinite(x) && x > now).sort((a, b) => a - b)[0];
  header.append(
    h("p", { class: "view-sub" },
      upcoming.length === 0
        ? "Nothing scheduled"
        : `${upcoming.length} scheduled${nextRun ? ` · next run ${when(nextRun, now)}` : ""}`),
  );

  if (attention.length || failed.length) {
    const section = h("section", { class: "group group-attention", "aria-label": "Needs attention" },
      h("div", { class: "day-head day-head-attention" },
        h("h2", { class: "day-title" }, "Needs attention"),
        h("span", { class: "day-count" }, String(attention.length + failed.length))));
    const list = h("ul", { class: "rows" });
    for (const t of attention.sort((a, b) => runAt(a) - runAt(b))) {
      list.append(taskRow(t, {
        ctx: "attention",
        time: "▲ " + hm(runAt(t)),
        meta: agendaMeta(t, now),
        selected: t.task_id === selectedId,
      }));
    }
    for (const t of failed) {
      list.append(taskRow(t, {
        ctx: "attention",
        time: "✕ failed",
        band: null,
        meta: [`failed ${when(parse(t.completed_at), now)}`, t.origin_host].filter(Boolean),
        selected: t.task_id === selectedId,
      }));
    }
    section.append(list);
    root.append(section);
  }

  // Group upcoming tasks and projected series occurrences by local day.
  const groups = new Map();
  const put = (key, item) => {
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  };
  const keyOf = (ms) => {
    const at = Number.isFinite(ms) ? Math.max(ms, now) : now;
    return daysFromToday(at, now) > 6 ? LATER : String(dayStart(at));
  };
  for (const t of upcoming) put(keyOf(runAt(t)), { at: Math.max(runAt(t) || now, 0), task: t });
  for (const s of state.series.values()) {
    if (s.ended || !s.next_deadlines) continue;
    const head = s.occurrences?.[s.occurrences.length - 1];
    if (!head || !pend.some((t) => t.series_id === s.series_id)) continue;
    for (const iso of s.next_deadlines) {
      const ms = parse(iso);
      if (!Number.isFinite(ms) || ms - now > PROJECT_DAYS * 86_400_000) break;
      put(keyOf(ms - 3_600_000), { at: ms - 3_600_000, projected: { ...s, head }, deadline: ms });
    }
  }

  if (upcoming.length === 0) {
    const journalCount = finishedTasks().length;
    root.append(
      emptyState({
        title: "Nothing scheduled.",
        body: [
          "Defer work from Claude Code with ",
          h("code", {}, "/ebb-ai:defer <task> --by 6h"),
          ", or from any MCP client with ",
          h("code", {}, "schedule_task"),
          ". It shows up here with the hour ebb picked.",
        ],
        link: journalCount ? { href: "#/journal", text: `${journalCount} finished in the Journal →` } : null,
      }),
    );
    if (groups.size === 0) return;
  }

  const region = primaryRegion(pend);
  const keys = [...groups.keys()].sort((a, b) => (a === LATER ? 1 : b === LATER ? -1 : Number(a) - Number(b)));
  for (const key of keys) {
    const items = groups.get(key).sort((a, b) => a.at - b.at);
    const start = key === LATER ? NaN : Number(key);
    const label = key === LATER ? "Later" : relDay(start, now);
    const sub = key === LATER ? "" : daysFromToday(start, now) < 2 ? dayLabel(start) : "";
    const section = h("section", { class: "group", "aria-label": key === LATER ? "Later" : `${label} ${dayLabel(start)}` });
    section.append(dayHeader(key, key === LATER ? label : daysFromToday(start, now) < 2 ? label : dayLabel(start), sub, items.filter((i) => i.task).length, region, now));
    const list = h("ul", { class: "rows" });
    for (const item of items) {
      if (item.task) {
        list.append(taskRow(item.task, {
          time: timeLabel(item.task, key, now),
          meta: agendaMeta(item.task, now),
          selected: item.task.task_id === selectedId,
        }));
      } else {
        list.append(projectedRow(item.projected, item.deadline, key === LATER));
      }
    }
    section.append(list);
    root.append(section);
  }
}

function skeletonGroups() {
  const wrap = h("div", { class: "skeleton-wrap", "aria-busy": "true", "aria-label": "Loading tasks" });
  for (let g = 0; g < 3; g++) {
    wrap.append(h("div", { class: "day-head skeleton-head" }, h("span", { class: "sk sk-title" })), skeletonRows(2));
  }
  return wrap;
}
