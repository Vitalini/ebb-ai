// Notification events and channels (KTD8). Summary changes become events
//   { kind: "task_finished", task } | { kind: "clean_window", window, region }
// that go to a list of channels. v1 has one channel, browser notifications;
// the Integrations registry can replace the list later without touching the
// event derivation. Pure apart from the channel itself.

import { clock } from "./summary.js";

export const WINDOW_ALARM_PREFIX = "clean-";
const SEEN_MAX = 100;
const TITLE_MAX = 100;
const MESSAGE_MAX = 200;
// A clean-window alarm with no known end still counts as "now" this long after the start.
const WINDOW_GRACE_MS = 15 * 60_000;

/** Plain text, one line, at most `max` characters. Task titles come from prompts. */
export function plain(text, max) {
  const one = String(text ?? "").replace(/[\u0000-\u001f\u007f]+/g, " ").trim();
  return one.length > max ? `${one.slice(0, max - 1)}…` : one;
}

/**
 * task_finished events from one summary. The first poll after pairing (no
 * stored cursor) only records; ids already notified send nothing again.
 * Returns { events, seen } with the updated seen list.
 */
export function finishedEvents(body, { hadCursor, seen = [] }) {
  const finished = Array.isArray(body.finished) ? body.finished : [];
  const known = new Set(seen);
  const fresh = finished.filter((t) => t && typeof t.task_id === "string" && !known.has(t.task_id));
  const nextSeen = [...fresh.map((t) => t.task_id), ...seen].slice(0, SEEN_MAX);
  if (!hadCursor) return { events: [], seen: nextSeen };
  return { events: fresh.map((task) => ({ kind: "task_finished", task })), seen: nextSeen };
}

export function windowAlarmName(cw) {
  return `${WINDOW_ALARM_PREFIX}${cw.start}`;
}

/**
 * Which window alarms to clear and which to create. One alarm at the start of
 * the next real clean window; a fallback window, a window already running or
 * one already notified sets none (KTD5).
 */
export function planWindowAlarm(existing, cw, now, notifiedStart) {
  const start = cw ? Date.parse(cw.start) : NaN;
  const want =
    cw && !cw.fallback && !cw.now && Number.isFinite(start) && start > now && cw.start !== notifiedStart
      ? { name: windowAlarmName(cw), when: start }
      : null;
  return {
    clear: existing.filter((n) => n.startsWith(WINDOW_ALARM_PREFIX) && n !== want?.name),
    create: want && !existing.includes(want.name) ? want : null,
  };
}

/**
 * The clean_window event for a fired alarm, or null when that start was
 * already notified or the alarm fired late (missed alarms fire on wake): after
 * the window end, or WINDOW_GRACE_MS after the start when the end is unknown.
 */
export function windowEvent(alarmName, { notifiedStart, lastWindow, region }, now = Date.now()) {
  const start = alarmName.slice(WINDOW_ALARM_PREFIX.length);
  if (!start || start === notifiedStart) return null;
  const window = lastWindow && lastWindow.start === start ? lastWindow : { start, end: null };
  const end = Date.parse(window.end);
  const late = Number.isFinite(end) ? end <= now : now - Date.parse(start) > WINDOW_GRACE_MS;
  if (late) return null;
  return { kind: "clean_window", window, region };
}

/** { id, title, message } in plain text. */
export function toNotification(event) {
  if (event.kind === "task_finished") {
    const t = event.task;
    const name = t.title || t.task_id;
    return {
      id: `tidegap-task-${t.task_id}`,
      title: plain(`${t.status === "failed" ? "Failed" : "Done"}: ${name}`, TITLE_MAX),
      message: plain(t.status === "failed" ? "The task failed. Open tidegap ui for details." : "Open tidegap ui to read the result.", MESSAGE_MAX),
    };
  }
  const w = event.window;
  const until = w.end ? ` until ${clock(w.end)}` : "";
  const where = event.region ? ` in ${event.region}` : "";
  return {
    id: `tidegap-window-${w.start}`,
    title: plain("Clean grid window now", TITLE_MAX),
    message: plain(`The grid${where} is clean${until}. A good time for queued work.`, MESSAGE_MAX),
  };
}

/** The v1 channel: notifications from the extension itself. */
export function browserNotifications(ext) {
  return {
    name: "browser",
    async send(event) {
      const n = toNotification(event);
      await ext.notifications.create(n.id, {
        type: "basic",
        iconUrl: ext.runtime.getURL("icons/icon-128.png"),
        title: n.title,
        message: n.message,
      });
    },
  };
}

/**
 * Send the events the settings allow to every channel. A failing channel does
 * not stop the others.
 */
export async function dispatch(events, channels, notify) {
  const allowed = events.filter((e) => (e.kind === "task_finished" ? notify.finished : notify.cleanWindow));
  for (const event of allowed) {
    for (const channel of channels) {
      try {
        await channel.send(event);
      } catch {
        // a failed notification is not a poll error
      }
    }
  }
}
