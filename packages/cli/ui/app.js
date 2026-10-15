// ebb ui front end. Dependency-free ES module.
//
// Every task string (title, prompt, result, error) is untrusted: it comes
// from prompts and model output. It is rendered through textContent only;
// this file never assigns HTML markup from data.

const SVG_NS = "http://www.w3.org/2000/svg";
const PENDING = "queued,scheduled,submitted";

let token = null;
let lastView = "timeline";
let status = null;
let expired = false;
let renderSeq = 0;
const markedRead = new Set();

// ── helpers ────────────────────────────────────────────────────────────────

function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === "class") el.className = v;
    else el.setAttribute(k, v === true ? "" : String(v));
  }
  for (const c of children.flat()) {
    if (c === undefined || c === null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

function s(tag, attrs = {}, text) {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  if (text !== undefined) el.textContent = String(text);
  return el;
}

function fmtTime(iso) {
  if (!iso) return "-";
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function ago(iso) {
  const ms = Date.now() - Date.parse(iso);
  if (!Number.isFinite(ms)) return iso;
  const min = Math.round(ms / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min} min ago`;
  const hr = Math.round(min / 60);
  if (hr < 48) return `${hr} h ago`;
  return `${Math.round(hr / 24)} days ago`;
}

function taskName(t) {
  return t.title || t.task_id;
}

class SessionExpired extends Error {}

async function api(path, init = {}) {
  if (!token) throw new SessionExpired();
  const res = await fetch(path, {
    ...init,
    headers: { authorization: `Bearer ${token}` },
  });
  if (res.status === 401) throw new SessionExpired();
  return res;
}

async function apiJson(path) {
  const res = await api(path);
  if (!res.ok) {
    const err = new Error(`HTTP ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return res.json();
}

function showExpired() {
  expired = true;
  document.getElementById("drawer").hidden = true;
  document.getElementById("conn").hidden = true;
  document.getElementById("view").replaceChildren(
    h("div", { class: "full" },
      h("h1", {}, "Session expired."),
      h("p", {}, "Run ", h("code", {}, "ebb ui"), " again to get a new link.")),
  );
}

// ── header: unread badge, last tick, daemon banner ─────────────────────────

async function refreshHeader() {
  const [st, unread] = await Promise.all([apiJson("/api/status"), apiJson("/api/tasks?unread=1")]);
  status = st;
  const badge = document.getElementById("unread-badge");
  badge.textContent = String(unread.tasks.length);
  badge.hidden = unread.tasks.length === 0;
  badge.setAttribute("aria-label", `${unread.tasks.length} unread`);
  document.getElementById("last-tick").textContent = st.last_tick_at
    ? `Dispatcher last ran ${ago(st.last_tick_at)}`
    : "Dispatcher has not run yet";
  const banner = document.getElementById("banner");
  if (st.daemon === "not_installed") {
    banner.replaceChildren(
      "No tick daemon is installed, so nothing will dispatch scheduled tasks. Run ",
      h("code", {}, "ebb install --laptop"),
      " (or ",
      h("code", {}, "--server"),
      ").",
    );
    banner.hidden = false;
  } else {
    banner.hidden = true;
  }
}

// ── timeline ───────────────────────────────────────────────────────────────

function pickRegion(tasks) {
  const counts = new Map();
  for (const t of tasks) counts.set(t.region, (counts.get(t.region) || 0) + 1);
  let best = status ? status.default_region : undefined;
  let n = 0;
  for (const [r, c] of counts) if (c > n) [best, n] = [r, c];
  return best;
}

function chart(points, tasks, region) {
  const W = 960, H = 240, L = 44, R = 12, T = 12, B = 28;
  const t0 = Date.parse(points[0].t);
  const t1 = Date.parse(points[points.length - 1].t) + 3600000;
  const gMax = Math.max(...points.map((p) => p.g)) * 1.1 || 1;
  const x = (ms) => L + ((ms - t0) / (t1 - t0)) * (W - L - R);
  const y = (g) => T + (1 - g / gMax) * (H - T - B);
  const svg = s("svg", {
    class: "chart",
    viewBox: `0 0 ${W} ${H}`,
    role: "img",
    "aria-label": `Forecast carbon intensity for ${region}, with queued tasks at their scheduled hour. The same tasks are listed below.`,
  });
  svg.append(s("line", { class: "axis", x1: L, y1: H - B, x2: W - R, y2: H - B }));
  svg.append(s("text", { x: 4, y: T + 10 }, `${Math.round(gMax)} g`));
  svg.append(s("text", { x: 4, y: H - B }, "0"));
  for (let ms = t0; ms <= t1; ms += 6 * 3600000) {
    svg.append(s("text", { x: x(ms) - 14, y: H - 8 }, new Date(ms).toLocaleTimeString(undefined, { hour: "2-digit" })));
  }
  const d = points
    .map((p, i) => `${i ? "L" : "M"}${x(Date.parse(p.t) + 1800000).toFixed(1)},${y(p.g).toFixed(1)}`)
    .join(" ");
  svg.append(s("path", { class: "curve", d }));
  const slots = new Map();
  for (const t of tasks) {
    if (t.status === "submitted") continue;
    const ms = Date.parse(t.scheduled_for);
    if (!Number.isFinite(ms) || ms < t0 || ms > t1) continue;
    const slot = Math.floor(ms / 3600000);
    slots.set(slot, [...(slots.get(slot) || []), t]);
    const dl = Date.parse(t.deadline);
    if (Number.isFinite(dl) && dl >= t0 && dl <= t1) {
      svg.append(s("line", { class: "deadline", x1: x(dl), y1: T, x2: x(dl), y2: H - B }));
    }
  }
  for (const [slot, group] of slots) {
    const ms = slot * 3600000 + 1800000;
    const p = points.find((q) => Math.floor(Date.parse(q.t) / 3600000) === slot);
    const cy = p ? y(p.g) : H - B;
    const link = s("a", { href: `#/task/${encodeURIComponent(group[0].task_id)}` });
    const title = s("title", {}, group.map(taskName).join("\n"));
    link.append(title, s("circle", { class: "marker", cx: x(ms), cy, r: group.length > 1 ? 9 : 6 }));
    if (group.length > 1) {
      link.append(s("text", { class: "marker-count", x: x(ms) - 3, y: cy + 3.5 }, group.length));
    }
    svg.append(link);
  }
  return svg;
}

function taskRow(t, meta) {
  return h("li", {},
    h("a", { href: `#/task/${encodeURIComponent(t.task_id)}` },
      h("span", { class: "t-title" }, taskName(t)),
      h("span", { class: "t-meta" }, meta)));
}

function list(tasks, meta) {
  return h("ul", { class: "tasks" }, tasks.map((t) => taskRow(t, meta(t))));
}

async function renderTimeline(view) {
  const { tasks } = await apiJson(`/api/tasks?status=${PENDING}`);
  view.replaceChildren(h("h1", {}, "Timeline"));
  if (tasks.length === 0) {
    view.append(h("p", { class: "muted" }, "No queued tasks."));
    return;
  }
  const region = pickRegion(tasks);
  const latest = Math.max(...tasks.map((t) => Date.parse(t.deadline || t.scheduled_for) || 0));
  const hours = Math.min(72, Math.max(24, Math.ceil((latest - Date.now()) / 3600000) + 1));
  try {
    const f = await apiJson(`/api/forecast?region=${encodeURIComponent(region)}&hours=${hours}`);
    if (f.points.length > 1) {
      view.append(chart(f.points, tasks, f.region));
      view.append(h("p", { class: "muted" },
        `${f.region}, gCO2e/kWh, source ${f.source}${f.source === "mock" ? " (synthetic, not a measurement)" : ""}. Dots are tasks at their scheduled hour; dashed lines are deadlines.`));
    }
  } catch (err) {
    if (err instanceof SessionExpired) throw err;
    view.append(h("p", { class: "muted" }, "Forecast unavailable."));
  }
  const byTime = (a, b) => (Date.parse(a.scheduled_for) || 0) - (Date.parse(b.scheduled_for) || 0);
  const scheduled = tasks.filter((t) => t.status !== "submitted").sort(byTime);
  const absolute = scheduled.filter((t) => t.deadline_kind !== "quota_reset");
  const quota = tasks.filter((t) => t.deadline_kind === "quota_reset").sort(byTime);
  const submitted = tasks.filter((t) => t.status === "submitted");
  const runs = (t) => `${t.status} · runs ${fmtTime(t.scheduled_for)} · deadline ${fmtTime(t.deadline)}`;

  if (absolute.length) {
    view.append(h("h2", {}, "By deadline"), list(absolute, runs));
  }
  if (quota.length) {
    view.append(h("h2", {}, "Before quota reset"));
    const labels = [...new Set(quota.map((t) => t.quota_provider || "unknown"))];
    for (const label of labels) {
      const cfg = status && status.quota.find((q) => q.label === label);
      view.append(h("p", { class: "muted" },
        cfg
          ? `quota reset (${label}): next reset ${fmtTime(cfg.next_reset)}, margin ${cfg.margin_h} h`
          : `quota reset (${label}): not configured in ~/.ebb-ai/config`));
      view.append(list(quota.filter((t) => (t.quota_provider || "unknown") === label), runs));
    }
  }
  if (submitted.length) {
    view.append(h("h2", {}, "Submitted to provider batch (runs within 24 h)"),
      list(submitted, (t) => `submitted · deadline ${fmtTime(t.deadline)}`));
  }
}

// ── inbox ──────────────────────────────────────────────────────────────────

async function renderInbox(view) {
  const { tasks } = await apiJson("/api/tasks?unread=1");
  tasks.sort((a, b) => (Date.parse(b.completed_at) || 0) - (Date.parse(a.completed_at) || 0));
  view.replaceChildren(h("h1", {}, "Inbox"));
  if (tasks.length === 0) {
    view.append(h("p", { class: "muted" }, "Nothing unread."));
    return;
  }
  view.append(list(tasks, (t) => `${t.status} · ${fmtTime(t.completed_at)}`));
}

// ── detail drawer ──────────────────────────────────────────────────────────

function kv(pairs) {
  const dl = h("dl", { class: "kv" });
  for (const [k, v] of pairs) {
    if (v === undefined || v === null || v === "") continue;
    dl.append(h("dt", {}, k), h("dd", {}, String(v)));
  }
  return dl;
}

function receiptBlock(r, taskId) {
  return [
    h("h2", {}, "Receipt"),
    kv([
      ["ran at", r.ranAt && fmtTime(r.ranAt)],
      ["model", r.provider || r.model ? `${r.provider || "?"}:${r.model || "?"}` : undefined],
      ["estimated", r.estimatedCarbonGCo2 !== undefined ? `${r.estimatedCarbonGCo2} gCO2e` : undefined],
      ["actual", r.actualCarbonGCo2 !== undefined ? `${r.actualCarbonGCo2} gCO2e` : undefined],
      ["intensity", r.intensityGCo2PerKwh !== undefined ? `${r.intensityGCo2PerKwh} gCO2/kWh` : undefined],
      ["grid source", r.gridSource === "mock" ? "mock (synthetic, not a measurement)" : r.gridSource],
      ["signature", r.signature ? "signed (Ed25519)" : "not signed"],
    ]),
    r.signature ? h("p", { class: "muted" }, "Check it: ", h("code", {}, `ebb verify ${taskId}`)) : null,
  ];
}

async function renderDrawer(taskId) {
  const drawer = document.getElementById("drawer");
  const back = h("a", { href: `#/${lastView}` }, "← Back");
  let t;
  try {
    t = await apiJson(`/api/tasks/${encodeURIComponent(taskId)}`);
  } catch (err) {
    if (err instanceof SessionExpired) throw err;
    drawer.replaceChildren(back, h("h1", {}, "Task not found"), h("a", { href: "#/timeline" }, "Go to the timeline"));
    drawer.hidden = false;
    return;
  }
  const finished = t.status === "completed" || t.status === "failed";
  const parts = [
    back,
    h("h1", {}, taskName(t)),
    h("p", {}, h("span", { class: `status ${t.status}` }, t.status)),
    kv([
      ["task id", t.task_id],
      ["origin", t.origin_host ? `${t.origin_host}${t.origin_cwd ? ` (${t.origin_cwd})` : ""}` : undefined],
      ["parent", t.parent_task_id],
      ["region", t.region],
      ["enqueued", fmtTime(t.enqueued_at)],
      ["scheduled for", t.scheduled_for && fmtTime(t.scheduled_for)],
      ["deadline", t.deadline && `${fmtTime(t.deadline)} (${t.deadline_label})`],
      ["completed", t.completed_at && fmtTime(t.completed_at)],
    ]),
  ];
  if (t.status !== "running") {
    if (t.prompt !== null) parts.push(h("h2", {}, "Prompt"), h("pre", {}, t.prompt));
    const prior = t.history.slice(0, Math.max(0, t.history.length - 1 - (t.result_text !== null && t.status === "completed" ? 1 : 0)));
    if (prior.length) {
      parts.push(h("h2", {}, "Earlier turns"));
      for (const m of prior) parts.push(h("p", { class: "muted" }, m.role), h("pre", {}, m.content));
    }
    if (t.result_text !== null) parts.push(h("h2", {}, "Result"), h("pre", {}, t.result_text));
    else if (t.status === "completed" && t.result !== null) parts.push(h("h2", {}, "Result"), h("pre", {}, JSON.stringify(t.result, null, 2)));
    if (t.error) parts.push(h("h2", {}, "Error"), h("pre", {}, t.error));
    if (t.receipt) parts.push(...receiptBlock(t.receipt, t.task_id));
    if (t.routing) parts.push(h("h2", {}, "Routing"), kv([["chosen", t.routing.chosen], ["reasoning", t.routing.reasoning]]));
    if (t.raw !== null) {
      parts.push(h("details", {}, h("summary", {}, "Raw vendor response"), h("pre", {}, JSON.stringify(t.raw, null, 2))));
    }
  }
  drawer.replaceChildren(...parts.filter(Boolean));
  drawer.hidden = false;
  if (finished && !t.read_at && !markedRead.has(t.task_id)) {
    markedRead.add(t.task_id);
    // A failed mark-read is ignored; the task just stays in the inbox.
    api(`/api/tasks/${encodeURIComponent(t.task_id)}/read`, { method: "POST" }).catch(() => {});
  }
}

// ── routing ────────────────────────────────────────────────────────────────

function route() {
  const m = /^#\/(timeline|inbox|task\/(.+))$/.exec(location.hash);
  if (!m) return { view: "timeline" };
  if (m[2]) return { view: lastView, taskId: decodeURIComponent(m[2]) };
  return { view: m[1] };
}

async function render() {
  if (expired) return;
  const seq = ++renderSeq;
  const r = route();
  lastView = r.view;
  for (const v of ["timeline", "inbox"]) {
    const a = document.getElementById(`nav-${v}`);
    if (v === r.view) a.setAttribute("aria-current", "page");
    else a.removeAttribute("aria-current");
  }
  const view = document.getElementById("view");
  try {
    const next = h("div");
    await (r.view === "inbox" ? renderInbox(next) : renderTimeline(next));
    if (seq !== renderSeq) return;
    view.replaceChildren(...next.childNodes);
    if (r.taskId) await renderDrawer(r.taskId);
    else document.getElementById("drawer").hidden = true;
    await refreshHeader();
  } catch (err) {
    if (err instanceof SessionExpired) showExpired();
    else view.replaceChildren(h("p", { class: "muted" }, `Could not load: ${err.message}`));
  }
}

// ── change stream (SSE over fetch, so the bearer header applies) ───────────

async function stream() {
  let delay = 1000;
  const conn = document.getElementById("conn");
  while (!expired) {
    try {
      const res = await api("/api/events");
      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
      conn.hidden = true;
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
          if (/^event: tasks$/m.test(msg)) render();
        }
      }
    } catch (err) {
      if (err instanceof SessionExpired) {
        showExpired();
        return;
      }
    }
    conn.hidden = false;
    await new Promise((r) => setTimeout(r, delay));
    delay = Math.min(delay * 2, 30000);
  }
}

// ── boot ───────────────────────────────────────────────────────────────────

// A new link pasted into this tab only changes the fragment; reload to use it.
window.addEventListener("hashchange", () => {
  if (/^#token=/.test(location.hash)) location.reload();
});

const m = /^#token=([A-Za-z0-9_-]+)$/.exec(location.hash);
if (m) {
  token = m[1];
  // Keep the token in memory only; drop it from the address bar and history.
  history.replaceState(null, "", `${location.pathname}#/timeline`);
}
if (!token) {
  showExpired();
} else {
  window.addEventListener("hashchange", render);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !document.getElementById("drawer").hidden) location.hash = `#/${lastView}`;
  });
  render();
  stream();
}
