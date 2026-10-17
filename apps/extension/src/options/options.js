import { api } from "../lib/api.js";
import { ext, needsHostGrant } from "../lib/browser.js";
import { connectionPatch, loadSettings, parsePort, saveSettings } from "../lib/settings.js";

const HOST_ACCESS = { origins: ["http://127.0.0.1/*"] };

const $ = (id) => document.getElementById(id);

function show(text, bad = false) {
  $("status").textContent = text;
  $("status").className = bad ? "bad" : "";
}

function formValues() {
  return {
    port: parsePort($("port").value),
    token: $("token").value.trim(),
    notify: { finished: $("notify-finished").checked, cleanWindow: $("notify-window").checked },
  };
}

/** The result of a summary call, in words. */
function describe(result) {
  if (result.state !== "ok") return result.message;
  const n = result.body?.active ?? 0;
  return `Connected. ${n} active ${n === 1 ? "task" : "tasks"}.`;
}

async function save(hostAccess) {
  const values = formValues();
  if (values.port === null) return show("Port must be a number from 1 to 65535.", true);
  await saveSettings(connectionPatch(await loadSettings(), values));
  let granted = true;
  try {
    granted = await hostAccess;
  } catch {
    granted = false;
  }
  show(granted ? "Saved." : "Saved, but access to 127.0.0.1 was not granted. Click Save again and allow it.", !granted);
}

async function test() {
  const values = formValues();
  if (values.port === null) return show("Port must be a number from 1 to 65535.", true);
  if (needsHostGrant() && !(await ext.permissions.contains(HOST_ACCESS))) {
    return show("Access to 127.0.0.1 is not granted yet. Click Save and allow it.", true);
  }
  $("test").disabled = true;
  show("Testing…");
  try {
    const result = await api.summary(values);
    show(describe(result), result.state !== "ok");
  } finally {
    $("test").disabled = false;
  }
}

async function init() {
  const s = await loadSettings();
  $("port").value = String(s.port);
  $("token").value = s.token;
  $("notify-finished").checked = s.notify.finished;
  $("notify-window").checked = s.notify.cleanWindow;
  // Safari has no notifications API; the Tidegap Mac app sends them there.
  if (!ext.notifications) $("notifications").hidden = true;
  $("form").addEventListener("submit", (e) => {
    e.preventDefault();
    // First, before any await: Firefox and Safari grant host access only from
    // a user gesture, not at install (KTD9). Chrome granted it at install, so
    // this resolves true there.
    const hostAccess = ext.permissions.request(HOST_ACCESS);
    save(hostAccess);
  });
  $("test").addEventListener("click", () => test());
}

init();
