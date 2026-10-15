// Journal: every finished task (completed, failed, cancelled), newest
// first, grouped by day. Filters live in the hash query
// (#/journal?status=failed&provider=openai&kind=repeating). A row expands
// to the result's first lines, the receipt state and the carbon figure.

import { api, SessionExpired } from "./api.js";
import {
  bandChip,
  bandOf,
  dayLabel,
  dayStart,
  grams,
  h,
  hm,
  isUnread,
  parse,
  relDay,
  taskHref,
} from "./dom.js";
import { joinMeta, taskRow } from "./row.js";
import { finishedTasks, notify, state } from "./state.js";
import { emptyState, errorCard, skeletonRows } from "./views.js";

const STATUS_GLYPH = { completed: "✓", failed: "✕", cancelled: "⊘" };
const RESULT_LINES = 6;

const expanded = new Set();
/** task id -> detail body, or {error} */
const details = new Map();

function journalFilters() {
  const q = new URLSearchParams(location.hash.split("?")[1] || "");
  return { status: q.get("status") || "", provider: q.get("provider") || "", kind: q.get("kind") || "" };
}

function setFilter(name, value) {
  const f = { ...journalFilters(), [name]: value };
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(f)) if (v) q.set(k, v);
  const qs = q.toString();
  location.hash = `#/journal${qs ? `?${qs}` : ""}`;
}

function matches(t, f) {
  if (f.status === "unread" ? !isUnread(t) : f.status && t.status !== f.status) return false;
  if (f.provider && (t.provider || "none") !== f.provider) return false;
  if (f.kind === "repeating" && !(t.repeat && t.repeat !== "none") && !t.series_id) return false;
  if (f.kind === "quota_reset" && t.deadline_kind !== "quota_reset") return false;
  if (f.kind === "absolute" && t.deadline_kind === "quota_reset") return false;
  return true;
}

function select(name, label, value, options) {
  const sel = h("select", { class: "select", name, id: `filter-${name}`, "data-filter": name, onchange: (e) => setFilter(name, e.target.value) },
    options.map(([v, text]) => h("option", { value: v, selected: v === value ? true : undefined }, text)));
  return h("label", { class: "filter" }, h("span", { class: "filter-label" }, label), sel);
}

function finishedAt(t) {
  const at = parse(t.completed_at);
  return Number.isFinite(at) ? at : parse(t.scheduled_for);
}

export function renderJournal(root, { selectedId } = {}) {
  const head = h("div", { class: "view-head" }, h("h1", { class: "view-title" }, "Journal"));
  root.append(head);
  if (!state.loaded) {
    root.append(state.error ? errorCard("Could not load the journal.") : skeletonRows(6));
    return;
  }
  if (state.error) root.append(errorCard("Could not refresh the journal. Showing the last data."));

  const all = finishedTasks();
  const f = journalFilters();
  const providers = [...new Set(all.map((t) => t.provider || "none"))].sort();
  const unread = all.filter(isUnread).length;
  const rows = all.filter((t) => matches(t, f)).sort((a, b) => finishedAt(b) - finishedAt(a));

  head.append(h("p", { class: "view-sub" },
    rows.length === all.length ? `${all.length} tasks` : `${rows.length} of ${all.length} tasks`,
    unread ? ` · ${unread} unread` : ""));

  if (all.length === 0) {
    root.append(emptyState({
      title: "Nothing finished yet.",
      body: "Completed, failed and cancelled tasks land here with their result and carbon receipt.",
      link: { href: "#/agenda", text: "Back to the Agenda →" },
      glyph: "✓",
    }));
    return;
  }

  root.append(h("div", { class: "filters", role: "group", "aria-label": "Journal filters" },
    select("status", "Status", f.status, [["", "All"], ["completed", "Completed"], ["failed", "Failed"], ["cancelled", "Cancelled"], ["unread", "Unread"]]),
    select("provider", "Provider", f.provider, [["", "All"], ...providers.map((p) => [p, p === "none" ? "No provider" : p])]),
    select("kind", "Kind", f.kind, [["", "All"], ["absolute", "Deadline"], ["quota_reset", "Quota reset"], ["repeating", "Repeating"]]),
    f.status || f.provider || f.kind ? h("a", { class: "btn btn-ghost btn-sm", href: "#/journal" }, "Clear") : null));

  if (rows.length === 0) {
    root.append(emptyState({ title: "No task matches these filters.", link: { href: "#/journal", text: "Clear filters" }, glyph: "∅" }));
    return;
  }

  let day = null;
  let list = null;
  for (const t of rows) {
    const at = finishedAt(t);
    const d = Number.isFinite(at) ? dayStart(at) : 0;
    if (d !== day || !list) {
      day = d;
      list = h("ul", { class: "rows" });
      root.append(h("section", { class: "group" },
        h("div", { class: "day-head" }, h("h2", { class: "day-title" }, d ? relDay(d) : "Unknown day", d && relDay(d) !== dayLabel(d) ? h("span", { class: "day-sub" }, ` · ${dayLabel(d)}`) : null)),
        list));
    }
    const open = expanded.has(t.task_id);
    const row = taskRow(t, {
      ctx: "journal",
      time: `${STATUS_GLYPH[t.status] || ""} ${Number.isFinite(at) ? hm(at) : ""}`,
      band: t.status === "completed" && bandOf(t.intensity_g_per_kwh) ? { band: bandOf(t.intensity_g_per_kwh), g: t.intensity_g_per_kwh, from: "receipt" } : null,
      meta: journalMeta(t),
      selected: t.task_id === selectedId,
    });
    const actions = row.querySelector(".row-actions");
    actions.replaceChildren(h("button", {
      type: "button",
      class: ["row-btn", "row-expand", open && "is-open"],
      "data-action": "expand",
      "aria-expanded": open ? "true" : "false",
      "aria-label": open ? "Collapse" : "Expand",
      tabindex: "-1",
    }, "›"));
    list.append(row);
    if (open) list.append(expansion(t));
  }
}

function journalMeta(t) {
  const parts = [h("span", { class: `tag tag-${t.status}` }, t.status)];
  if (t.status === "completed" && typeof t.carbon_g === "number") parts.push(h("span", { class: "num" }, grams(t.carbon_g)));
  if (t.series_id) parts.push("↻ series");
  if (t.parent_task_id) parts.push("reply");
  if (t.origin_host) parts.push(t.origin_host);
  return parts;
}

export function toggleExpand(id) {
  if (expanded.has(id)) expanded.delete(id);
  else {
    expanded.add(id);
    if (!details.has(id)) void loadDetail(id);
  }
  notify();
}

async function loadDetail(id) {
  try {
    details.set(id, await api.task(id));
  } catch (err) {
    if (err instanceof SessionExpired) state.expired = true;
    else details.set(id, { error: err.message || "Could not load" });
  }
  notify();
}

/** Forget cached expansions for changed tasks. */
export function invalidateJournal(ids) {
  for (const id of ids) {
    details.delete(id);
    if (expanded.has(id)) void loadDetail(id);
  }
}

function expansion(t) {
  const d = details.get(t.task_id);
  const box = h("li", { class: "expand", "data-expand-for": t.task_id });
  if (!d) {
    box.append(h("span", { class: "sk sk-line" }), h("span", { class: "sk sk-line sk-short" }));
    return box;
  }
  if (d.error && !d.task_id) {
    box.append(h("p", { class: "muted" }, "Could not load this task."));
    return box;
  }
  const text = d.result_text ?? d.error ?? (d.status === "cancelled" ? "Cancelled before it ran." : null);
  if (text) {
    const lines = String(text).split("\n");
    const cut = lines.length > RESULT_LINES;
    box.append(h("pre", { class: ["expand-text", d.status === "failed" && "is-error"] }, lines.slice(0, RESULT_LINES).join("\n") + (cut ? "\n…" : "")));
  }
  const r = d.receipt;
  const facts = [];
  if (r) {
    facts.push(h("span", { class: ["tag", r.signature ? "tag-completed" : "tag-muted"] }, r.signature ? "receipt signed ✓" : "receipt unsigned"));
    const g = r.actualCarbonGCo2 ?? r.estimatedCarbonGCo2;
    if (typeof g === "number") {
      facts.push(h("span", { class: "num" }, `${grams(g)} CO2e`, typeof r.intensityGCo2PerKwh === "number" ? ` at ${Math.round(r.intensityGCo2PerKwh)} g/kWh` : ""));
      const band = bandOf(r.intensityGCo2PerKwh);
      if (band) facts.push(bandChip(band));
    }
    if (r.gridSource === "mock") facts.push(h("span", { class: "muted" }, "synthetic grid data"));
  } else if (d.status === "completed") {
    facts.push(h("span", { class: "muted" }, "no receipt"));
  }
  box.append(h("div", { class: "expand-facts" }, joinMeta(facts), h("a", { class: "btn btn-sm", href: taskHref(t.task_id) }, "Open")));
  return box;
}
