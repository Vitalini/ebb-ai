// Native HTML5 drag and drop: a row onto a day header (move to that day)
// or onto the "Run now" zone. While a row is dragged, a dock under the
// header shows Run now plus the next seven days, and every day header in
// the Agenda is outlined. Only valid targets accept the drop. Touch and
// keyboard use the move-to list (dialog.js) instead.

import { dayLabel, dayOffset, h, parse, relDay } from "./dom.js";
import { dayBounds } from "./dialog.js";

const MIME = "text/x-tidegap-task";
let drag = null;

export function isDragging() {
  return drag !== null;
}

/**
 * Wire drag and drop on the page.
 *   findTask(id) -> task
 *   onMove(task, dayStartMs, bounds)
 *   onRunNow(task)
 *   onEnd()     re-render deferred while dragging
 */
export function initDnd({ findTask, onMove, onRunNow, onEnd }) {
  const dock = document.getElementById("drop-dock");

  document.addEventListener("dragstart", (e) => {
    const row = e.target instanceof Element ? e.target.closest(".row[draggable='true']") : null;
    if (!row) return;
    const task = findTask(row.dataset.taskId);
    if (!task?.actions?.reschedule) {
      e.preventDefault();
      return;
    }
    const at = parse(task.scheduled_for);
    drag = { task, row, day: Number.isFinite(at) ? dayOffset(0, at) : null };
    e.dataTransfer.setData(MIME, task.task_id);
    e.dataTransfer.setData("text/plain", task.display_title || task.task_id);
    e.dataTransfer.effectAllowed = "move";
    buildDock(dock, task, drag.day);
    // Let the browser snapshot the row before it fades.
    requestAnimationFrame(() => {
      if (!drag) return;
      row.classList.add("is-dragging");
      document.body.classList.add("dragging");
      dock.hidden = false;
    });
  });

  document.addEventListener("dragover", (e) => {
    if (!drag) return;
    const target = dropTarget(e.target);
    clearOver(target);
    if (!target || !valid(target)) {
      e.dataTransfer.dropEffect = "none";
      return;
    }
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    target.classList.add("drop-over");
  });

  document.addEventListener("dragleave", (e) => {
    const target = dropTarget(e.target);
    // Chrome often sends no relatedTarget; the next dragover clears stale outlines.
    if (target && e.relatedTarget && !target.contains(e.relatedTarget)) target.classList.remove("drop-over");
  });

  document.addEventListener("drop", (e) => {
    if (!drag) return;
    const target = dropTarget(e.target);
    if (!target || !valid(target)) return;
    e.preventDefault();
    const task = drag.task;
    finish();
    if (target.dataset.dropRun !== undefined) onRunNow(task);
    else {
      const start = Number(target.dataset.dropDay);
      onMove(task, start, dayBounds(start));
    }
  });

  document.addEventListener("dragend", () => {
    if (drag) finish();
  });

  function finish() {
    drag?.row.classList.remove("is-dragging");
    drag = null;
    document.body.classList.remove("dragging");
    clearOver(null);
    dock.hidden = true;
    dock.replaceChildren();
    onEnd();
  }
}

function dropTarget(node) {
  return node instanceof Element ? node.closest("[data-drop-day], [data-drop-run]") : null;
}

function valid(target) {
  if (!drag) return false;
  if (target.dataset.dropRun !== undefined) return !!drag.task.actions?.runNow;
  const start = Number(target.dataset.dropDay);
  if (!Number.isFinite(start) || start === drag.day) return false;
  return dayBounds(start) !== null;
}

function clearOver(keep) {
  for (const el of document.querySelectorAll(".drop-over")) if (el !== keep) el.classList.remove("drop-over");
}

function buildDock(dock, task, currentDay) {
  const now = Date.now();
  const items = [];
  if (task.actions?.runNow) {
    items.push(h("div", { class: "dock-target dock-run", "data-drop-run": "" }, h("span", { class: "dock-glyph" }, "▶"), "Run now"));
  }
  for (let i = 0; i < 7; i++) {
    const start = dayOffset(i, now);
    if (!dayBounds(start, now)) continue;
    const same = start === currentDay;
    items.push(h("div", {
      class: ["dock-target", same && "is-current"],
      "data-drop-day": String(start),
      "aria-label": same ? `${dayLabel(start)} (current day)` : `Move to ${dayLabel(start)}`,
    }, h("span", { class: "dock-day" }, i < 2 ? relDay(start, now) : dayLabel(start).split(" ")[0]), h("span", { class: "dock-date" }, dayLabel(start).split(" ").slice(1).join(" "))));
  }
  dock.replaceChildren(h("span", { class: "dock-label" }, "Drop on"), ...items);
}
