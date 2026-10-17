// Background: poll /api/summary every minute (MV3 workers stop when idle and
// cannot hold an SSE stream, KTD9), set the badge, send notifications.

import { api } from "./lib/api.js";
import { ext } from "./lib/browser.js";
import { WINDOW_ALARM_PREFIX, browserNotifications, dispatch, finishedEvents, planWindowAlarm, windowEvent } from "./lib/notify.js";
import { loadSettings, saveSettings } from "./lib/settings.js";
import { badgeFor } from "./lib/summary.js";

const POLL_ALARM = "poll";
const CHANNELS = [browserNotifications(ext)];

async function setBadge({ text, color, title }) {
  await ext.action.setBadgeText({ text });
  await ext.action.setBadgeBackgroundColor({ color });
  await ext.action.setTitle({ title });
}

async function syncWindowAlarm(cw, settings) {
  const existing = (await ext.alarms.getAll()).map((a) => a.name);
  const plan = planWindowAlarm(existing, cw, Date.now(), settings.notifiedStart);
  for (const name of plan.clear) await ext.alarms.clear(name);
  if (plan.create) await ext.alarms.create(plan.create.name, { when: plan.create.when });
}

async function pollOnce() {
  const settings = await loadSettings();
  const result = await api.summary(settings, settings.cursor);
  await setBadge(badgeFor(result));
  if (result.state !== "ok") return result.state;
  const body = result.body;
  const { events, seen } = finishedEvents(body, { hadCursor: settings.cursor !== null, seen: settings.seen });
  await dispatch(events, CHANNELS, settings.notify);
  await syncWindowAlarm(body.clean_window, settings);
  await saveSettings({ cursor: body.cursor ?? settings.cursor, seen, lastWindow: body.clean_window ?? null, region: body.region ?? null });
  return result.state;
}

// One poll at a time: an alarm, a settings change and the popup can all ask.
let running = null;
function poll() {
  running ??= pollOnce()
    .catch(() => "error")
    .finally(() => {
      running = null;
    });
  return running;
}

async function cleanWindowStarted(alarmName) {
  const settings = await loadSettings();
  const event = windowEvent(alarmName, settings);
  if (!event) return;
  await saveSettings({ notifiedStart: event.window.start });
  await dispatch([event], CHANNELS, settings.notify);
}

function start() {
  ext.alarms.create(POLL_ALARM, { periodInMinutes: 1 });
  poll();
}

ext.runtime.onInstalled.addListener(start);
ext.runtime.onStartup.addListener(start);

ext.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === POLL_ALARM) poll();
  else if (alarm.name.startsWith(WINDOW_ALARM_PREFIX)) cleanWindowStarted(alarm.name);
});

ext.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && (changes.token || changes.port)) poll();
});

// The popup asks for a poll when it opens, so the badge is fresh.
ext.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (sender.id !== ext.runtime.id || message?.type !== "poll") return false;
  poll().then((state) => sendResponse({ state }));
  return true;
});
