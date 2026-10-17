// Background: poll /api/summary every minute (MV3 workers stop when idle and
// cannot hold an SSE stream, KTD9), set the badge, send notifications.

import { api } from "./lib/api.js";
import { ext } from "./lib/browser.js";
import { WINDOW_ALARM_PREFIX, notificationChannels } from "./lib/notify.js";
import { createPoller } from "./lib/poller.js";

const POLL_ALARM = "poll";

async function setBadge({ text, color, title }) {
  await ext.action.setBadgeText({ text });
  await ext.action.setBadgeBackgroundColor({ color });
  await ext.action.setTitle({ title });
}

const { poll, cleanWindowStarted } = createPoller({
  api,
  storage: ext.storage.local,
  alarms: ext.alarms,
  setBadge,
  channels: notificationChannels(ext),
});

function start() {
  ext.alarms.create(POLL_ALARM, { periodInMinutes: 1 });
  poll();
}

ext.runtime.onInstalled.addListener(start);
ext.runtime.onStartup.addListener(start);

// A disable/re-enable fires neither event above, and the browser can drop
// alarms: make sure the poll alarm exists each time the worker starts.
ext.alarms.get(POLL_ALARM).then((alarm) => {
  if (!alarm) start();
});

ext.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === POLL_ALARM) poll();
  else if (alarm.name.startsWith(WINDOW_ALARM_PREFIX)) cleanWindowStarted(alarm.name);
});

ext.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && (changes.token || changes.port)) poll();
});

// Firefox and Safari grant 127.0.0.1 after the options Save stored the token:
// poll again. Optional, so a browser without the event still registers the
// message listener below.
ext.permissions?.onAdded?.addListener(() => poll());

// The popup asks for a poll when it opens, so the badge is fresh.
ext.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (sender.id !== ext.runtime.id || message?.type !== "poll") return false;
  poll().then((state) => sendResponse({ state }));
  return true;
});
