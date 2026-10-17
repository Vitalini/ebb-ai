// The popup's view model. Pure: no DOM and no extension API, so it is tested
// directly (test/popup.test.js).

import { clock, windowText } from "../lib/summary.js";

export const PRESETS = Object.freeze({ "6h": 6, "24h": 24, "3d": 72 });
export const DEFAULT_PRESET = "24h";

/** The ISO deadline for a preset at `now` (epoch ms). */
export function deadlineFor(preset, now = Date.now()) {
  const hours = PRESETS[preset] ?? PRESETS[DEFAULT_PRESET];
  return new Date(now + hours * 3_600_000).toISOString();
}

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** "14:00" today, "Sat 14:00" another day, "" without a time. */
export function runLabel(iso, now = Date.now()) {
  const d = new Date(iso ?? NaN);
  if (!Number.isFinite(d.getTime())) return "";
  const today = new Date(now);
  const sameDay = d.getFullYear() === today.getFullYear() && d.getMonth() === today.getMonth() && d.getDate() === today.getDate();
  return sameDay ? clock(iso) : `${DAYS[d.getDay()]} ${clock(iso)}`;
}

/** Rows from a /api/tasks answer, earliest run first; rows without a time last. */
export function rowsFrom(body, now = Date.now()) {
  const tasks = Array.isArray(body?.tasks) ? body.tasks : [];
  const at = (t) => {
    const ms = Date.parse(t.scheduled_for ?? "");
    return Number.isFinite(ms) ? ms : Infinity;
  };
  return [...tasks]
    .sort((a, b) => at(a) - at(b))
    .map((t) => ({
      id: t.task_id,
      title: String(t.display_title || t.title || t.task_id),
      status: t.status,
      when: t.status === "running" || t.status === "submitted" ? t.status : runLabel(t.scheduled_for, now),
    }));
}

/** The header line: the clean window, or why there is none. */
export function headerLine(summary) {
  if (!summary) return "";
  if (summary.clean_window) return windowText(summary.clean_window, summary.region);
  return summary.forecast_ok === false ? "Forecast unavailable" : "";
}

/**
 * The status block for a failed call: { kind, text, options }. `options`
 * means "show a link to the options page".
 */
export function statusFor(result) {
  if (result.state === "unpaired") return { kind: "unpaired", text: result.message, options: true };
  if (result.state === "offline") return { kind: "offline", text: result.message, options: false };
  return { kind: "error", text: result.message, options: result.status === 403 };
}

/** null when the prompt can be sent, else the reason. */
export function promptProblem(prompt) {
  return prompt.trim() ? null : "Write a prompt first.";
}
