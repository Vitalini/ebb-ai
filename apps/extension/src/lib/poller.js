// The poll and the clean-window alarm handler, with the extension APIs passed
// in so tests can run them with fakes. background.js only wires listeners.

import { badgeFor } from "./summary.js";
import { dispatch, finishedEvents, planWindowAlarm, windowEvent } from "./notify.js";
import { loadSettings, saveSettings } from "./settings.js";

/**
 * `api` is lib/api.js's api, `storage` a storage.local, `alarms` the alarms
 * API, `setBadge` sets text/color/title, `channels` the notification channels.
 * Returns { poll, cleanWindowStarted }.
 */
export function createPoller({ api, storage, alarms, setBadge, channels, now = () => Date.now() }) {
  async function syncWindowAlarm(cw, settings) {
    const existing = (await alarms.getAll()).map((a) => a.name);
    const plan = planWindowAlarm(existing, cw, now(), settings.notifiedStart);
    for (const name of plan.clear) await alarms.clear(name);
    if (plan.create) await alarms.create(plan.create.name, { when: plan.create.when });
  }

  async function pollOnce() {
    const settings = await loadSettings(storage);
    const result = await api.summary(settings, settings.cursor);
    // The token or port changed during the request: drop this answer so it
    // cannot overwrite the reset cursor. The queued poll uses the new settings.
    const current = await loadSettings(storage);
    if (current.token !== settings.token || current.port !== settings.port) return "stale";
    await setBadge(badgeFor(result, now()));
    if (result.state !== "ok") return result.state;
    const body = result.body;
    const { events, seen } = finishedEvents(body, { hadCursor: settings.cursor !== null, seen: settings.seen });
    await dispatch(events, channels, settings.notify);
    await syncWindowAlarm(body.clean_window, settings);
    await saveSettings({ cursor: body.cursor ?? settings.cursor, seen, lastWindow: body.clean_window ?? null, region: body.region ?? null }, storage);
    return result.state;
  }

  // One poll at a time: an alarm, a settings change and the popup can all ask.
  // A request during a poll runs one more poll after it, so a new token or
  // port is never answered by a poll that started before the change.
  let running = null;
  let queued = null;
  function poll() {
    if (running) {
      queued ??= running.then(() => {
        queued = null;
        return poll();
      });
      return queued;
    }
    running = pollOnce()
      .catch(() => "error")
      .finally(() => {
        running = null;
      });
    return running;
  }

  async function cleanWindowStarted(alarmName) {
    const settings = await loadSettings(storage);
    const event = windowEvent(alarmName, settings, now());
    if (!event) return;
    await saveSettings({ notifiedStart: event.window.start }, storage);
    await dispatch([event], channels, settings.notify);
  }

  return { poll, cleanWindowStarted };
}
