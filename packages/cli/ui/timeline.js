// Timeline: the forecast curve for the next hours with every pending task
// placed at its scheduled hour. The area under the curve takes the carbon
// band colour of each hour. Clicking a marker selects its row in the list
// under the chart (same row anatomy as the Agenda).

import {
  by,
  BAND_LABEL,
  bandChip,
  dayLabel,
  h,
  hm,
  nextDayStart,
  parse,
  s,
  title,
  when,
} from "./dom.js";
import { runAt } from "./agenda.js";
import { statusTag, taskRow } from "./row.js";
import { notify, pendingTasks, state } from "./state.js";
import { emptyState, errorCard, skeletonRows } from "./views.js";

const HOUR = 3_600_000;
let selected = null;

export function selectMarker(id) {
  selected = id;
  notify();
  requestAnimationFrame(() => {
    const row = document.querySelector(`#view .row[data-task-id="${CSS.escape(id)}"]`);
    if (row) {
      row.scrollIntoView({ block: "nearest", behavior: "smooth" });
      row.focus({ preventScroll: true });
    }
  });
}

function primaryRegion(tasks) {
  const counts = new Map();
  for (const t of tasks) counts.set(t.region, (counts.get(t.region) || 0) + 1);
  let best = state.status?.default_region;
  let n = 0;
  for (const [r, c] of counts) if (c > n) [best, n] = [r, c];
  return best;
}

export function renderTimeline(root, { selectedId, width } = {}) {
  root.append(h("div", { class: "view-head" }, h("h1", { class: "view-title" }, "Timeline")));
  if (!state.loaded) {
    root.append(state.error ? errorCard("Could not load tasks.") : h("div", { class: "sk sk-chart", "aria-busy": "true", "aria-label": "Loading forecast" }), skeletonRows(3));
    return;
  }
  const tasks = pendingTasks().sort((a, b) => (runAt(a) || 0) - (runAt(b) || 0));
  const region = primaryRegion(tasks);
  const f = state.forecasts.get(region);
  const head = root.firstElementChild;
  head.append(h("p", { class: "view-sub" }, `${region} · gCO2e per kWh · next ${f?.points?.length || 72} h`));

  if (!f) {
    root.append(h("div", { class: "sk sk-chart", "aria-busy": "true", "aria-label": "Loading forecast" }));
  } else if (f.error || f.points.length < 2) {
    root.append(errorCard("Forecast unavailable. The task list below is still current."));
  } else {
    const chartWrap = h("figure", { class: "chart-wrap" });
    chartWrap.append(chart(f.points, tasks, region, width, selectedId || selected));
    const inRange = tasks.filter((t) => markerTime(t, f.points) !== null).length;
    if (inRange === 0) chartWrap.append(h("p", { class: "chart-empty" }, "No tasks in the next 72 h"));
    chartWrap.append(h("figcaption", { class: "chart-legend" },
      Object.keys(BAND_LABEL).map((b) => bandChip(b)),
      h("span", { class: "legend-note" },
        `source ${f.source}${f.source === "mock" ? " (synthetic, not a measurement)" : ""} · dots are tasks at their scheduled hour, ticks are deadlines`)));
    root.append(chartWrap);
  }

  if (tasks.length === 0) {
    root.append(emptyState({ title: "No pending tasks.", body: "Deferred tasks appear on the curve at the hour tidegap picked.", glyph: "∿" }));
    return;
  }
  const list = h("ul", { class: "rows" });
  for (const t of tasks) {
    const at = runAt(t);
    list.append(taskRow(t, {
      ctx: "timeline",
      time: Number.isFinite(at) ? hm(at) : "",
      meta: [
        t.status === "running" || t.status === "submitted" ? statusTag(t) : null,
        Number.isFinite(at) ? when(at) : null,
        Number.isFinite(parse(t.deadline)) ? by(parse(t.deadline)) : null,
      ].filter(Boolean),
      selected: t.task_id === (selectedId || selected),
    }));
  }
  root.append(h("section", { class: "group" }, h("div", { class: "day-head" }, h("h2", { class: "day-title" }, "Pending, by run time"), h("span", { class: "day-count" }, String(tasks.length))), list));
}

/** Scheduled hour of `t` when the forecast covers it, else null. */
function markerTime(t, points) {
  if (t.status === "submitted") return null;
  const at = runAt(t);
  const t0 = Date.parse(points[0].t);
  const t1 = Date.parse(points[points.length - 1].t) + HOUR;
  return Number.isFinite(at) && at >= t0 && at < t1 ? at : null;
}

function chart(points, tasks, region, width = 960, selectedId) {
  const W = Math.max(320, Math.round(width));
  const H = W < 720 ? 160 : 220;
  const L = 36, R = 12, T = 18, B = 26;
  const t0 = Date.parse(points[0].t);
  const t1 = Date.parse(points[points.length - 1].t) + HOUR;
  const gMax = Math.max(...points.map((p) => p.g)) * 1.15 || 1;
  const x = (ms) => L + ((ms - t0) / (t1 - t0)) * (W - L - R);
  const y = (g) => T + (1 - g / gMax) * (H - T - B);
  const base = H - B;

  const svg = s("svg", {
    class: "chart",
    width: W,
    height: H,
    viewBox: `0 0 ${W} ${H}`,
    role: "img",
    "aria-label": `Forecast carbon intensity for ${region} with pending tasks at their scheduled hour. The same tasks are listed below the chart.`,
  });

  // Band thresholds as faint guides.
  for (const g of [100, 250, 450, 700]) {
    if (g >= gMax) break;
    svg.append(s("line", { class: "guide", x1: L, x2: W - R, y1: y(g), y2: y(g) }));
    svg.append(s("text", { class: "axis-label", x: L - 6, y: y(g) + 4, "text-anchor": "end" }, String(g)));
  }
  svg.append(s("text", { class: "axis-label", x: L - 6, y: base + 4, "text-anchor": "end" }, "0"));

  // Band-coloured area, one segment per hour, under a smooth-ish curve.
  const mids = points.map((p) => ({ x: x(Date.parse(p.t) + HOUR / 2), y: y(p.g), band: p.band }));
  const pts = [{ x: L, y: mids[0].y, band: mids[0].band }, ...mids, { x: x(t1), y: mids[mids.length - 1].y, band: mids[mids.length - 1].band }];
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1];
    svg.append(s("path", {
      class: `area area-${i === 0 ? b.band : a.band}`,
      d: `M${a.x.toFixed(1)},${base} L${a.x.toFixed(1)},${a.y.toFixed(1)} L${b.x.toFixed(1)},${b.y.toFixed(1)} L${b.x.toFixed(1)},${base} Z`,
    }));
  }
  svg.append(s("path", { class: "curve", d: pts.map((p, i) => `${i ? "L" : "M"}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ") }));
  svg.append(s("line", { class: "axis", x1: L, x2: W - R, y1: base, y2: base }));

  // Day boundaries and hour labels.
  for (let d = nextDayStart(t0); d < t1; d = nextDayStart(d)) {
    svg.append(s("line", { class: "day-line", x1: x(d), x2: x(d), y1: T - 6, y2: base }));
    svg.append(s("text", { class: "day-label", x: x(d) + 4, y: T - 6 }, dayLabel(d)));
  }
  const step = W < 720 ? 12 : 6;
  for (let ms = Math.ceil(t0 / HOUR) * HOUR; ms < t1; ms += HOUR) {
    const hr = new Date(ms).getHours();
    if (hr % step !== 0 || hr === 0) continue;
    svg.append(s("text", { class: "axis-label", x: x(ms), y: H - 8, "text-anchor": "middle" }, hm(ms)));
  }

  // Now.
  const now = Date.now();
  if (now >= t0 && now <= t1) {
    svg.append(s("line", { class: "now-line", x1: x(now), x2: x(now), y1: T - 6, y2: base }));
    svg.append(s("text", { class: "now-label", x: x(now) + 4, y: base - 6 }, "now"));
  }

  // Deadline ticks.
  for (const t of tasks) {
    const dl = parse(t.deadline);
    if (!Number.isFinite(dl) || dl < t0 || dl > t1) continue;
    svg.append(s("line", { class: "deadline-tick", x1: x(dl), x2: x(dl), y1: base - 8, y2: base + 4 },
      s("title", {}, `Deadline: ${title(t)} by ${when(dl)}`)));
  }

  // Task markers, grouped per hour.
  const slots = new Map();
  for (const t of tasks) {
    const at = markerTime(t, points);
    if (at === null) continue;
    const slot = Math.floor(at / HOUR);
    slots.set(slot, [...(slots.get(slot) || []), t]);
  }
  for (const [slot, group] of slots) {
    const p = points.find((q) => Math.floor(Date.parse(q.t) / HOUR) === slot);
    const cx = x(slot * HOUR + HOUR / 2);
    const cy = p ? y(p.g) : base;
    const ids = group.map((t) => t.task_id);
    const isSel = ids.includes(selectedId);
    const label = `${group.map(title).join(", ")} at ${hm(slot * HOUR)}${p ? `, ${BAND_LABEL[p.band]}` : ""}`;
    const g = s("g", {
      class: ["marker", p && `marker-${p.band}`, isSel && "is-selected"].filter(Boolean).join(" "),
      tabindex: "0",
      role: "button",
      "aria-label": label,
      "data-select": ids[0],
    }, s("title", {}, label));
    g.append(s("circle", { class: "marker-halo", cx, cy, r: group.length > 1 ? 13 : 10 }));
    g.append(s("circle", { class: "marker-dot", cx, cy, r: group.length > 1 ? 8 : 5 }));
    if (group.length > 1) g.append(s("text", { class: "marker-count", x: cx, y: cy + 3.5, "text-anchor": "middle" }, String(group.length)));
    svg.append(g);
  }
  return svg;
}
