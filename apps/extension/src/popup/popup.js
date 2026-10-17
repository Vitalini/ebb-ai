import { api, pageUrl } from "../lib/api.js";
import { ext } from "../lib/browser.js";
import { fill, h } from "../lib/dom.js";
import { loadSettings } from "../lib/settings.js";
import { deadlineFor, headerLine, promptProblem, rowsFrom, statusFor } from "./model.js";

const $ = (id) => document.getElementById(id);
let settings = null;

function showStatus(result) {
  const st = statusFor(result);
  const box = $("status");
  box.hidden = false;
  box.className = `bad status-${st.kind}`;
  fill(box, h("p", {}, st.text), st.options ? h("button", { type: "button", class: "link", onclick: () => ext.runtime.openOptionsPage() }, "Open options") : null);
  $("queue").hidden = true;
  $("add").hidden = st.kind !== "error";
}

function clearStatus() {
  $("status").hidden = true;
  $("queue").hidden = false;
  $("add").hidden = false;
}

function renderRows(rows) {
  fill(
    $("rows"),
    rows.map((r) =>
      h(
        "li",
        { "data-task": r.id },
        h("span", { class: "row-title", title: r.title }, r.title),
        h("span", { class: "row-meta" }, r.when || r.status),
      ),
    ),
  );
  $("empty").hidden = rows.length > 0;
}

async function refresh() {
  const [summary, list] = await Promise.all([api.summary(settings), api.activeTasks(settings)]);
  const failed = [summary, list].find((r) => r.state !== "ok");
  if (failed) return showStatus(failed);
  clearStatus();
  $("window").textContent = headerLine(summary.body);
  renderRows(rowsFrom(list.body));
}

async function add(e) {
  e.preventDefault();
  const prompt = $("prompt").value;
  const msg = $("add-msg");
  const problem = promptProblem(prompt);
  if (problem) {
    msg.textContent = problem;
    msg.className = "bad";
    return;
  }
  $("add-btn").disabled = true;
  msg.textContent = "Adding…";
  msg.className = "";
  try {
    const result = await api.addTask(settings, { prompt, deadline: deadlineFor($("preset").value) });
    if (result.state !== "ok") {
      msg.textContent = result.message;
      msg.className = "bad";
      return;
    }
    $("prompt").value = "";
    msg.textContent = "Queued.";
    await refresh();
    ext.runtime.sendMessage({ type: "poll" }).catch(() => {});
  } finally {
    $("add-btn").disabled = false;
  }
}

async function init() {
  settings = await loadSettings();
  $("add").addEventListener("submit", add);
  $("options").addEventListener("click", () => ext.runtime.openOptionsPage());
  $("open").addEventListener("click", () => {
    if (settings.token) ext.tabs.create({ url: pageUrl(settings) });
    else ext.runtime.openOptionsPage();
  });
  // Refresh the badge too; the popup does not wait for it.
  ext.runtime.sendMessage({ type: "poll" }).catch(() => {});
  await refresh();
}

init();
