process.env.TZ = "UTC";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { browserNotifications, dispatch, finishedEvents, planWindowAlarm, toNotification, windowEvent } from "../src/lib/notify.js";

const NOW = Date.parse("2026-10-17T09:00:00.000Z");
const iso = (h) => new Date(NOW + h * 3_600_000).toISOString();
const win = (h, extra = {}) => ({ start: iso(h), end: iso(h + 3), band: "clean", g: 40, now: false, fallback: false, ...extra });
const task = (id, title = `Task ${id}`, status = "completed") => ({ task_id: id, title, status, completed_at: iso(-1) });
const ALL = { finished: true, cleanWindow: true };

function recorder() {
  const sent = [];
  return { sent, channel: { name: "rec", send: async (e) => sent.push(e) } };
}

describe("finished events", () => {
  it("two finished tasks give two events; the same ids again give none", () => {
    const body = { finished: [task("a"), task("b")] };
    const first = finishedEvents(body, { hadCursor: true, seen: [] });
    assert.deepEqual(first.events.map((e) => [e.kind, e.task.task_id]), [["task_finished", "a"], ["task_finished", "b"]]);
    const again = finishedEvents(body, { hadCursor: true, seen: first.seen });
    assert.deepEqual(again.events, []);
  });

  it("the first summary without a cursor gives no events", () => {
    const r = finishedEvents({ finished: [task("a")] }, { hadCursor: false, seen: [] });
    assert.deepEqual(r.events, []);
    assert.deepEqual(r.seen, ["a"]);
  });
});

describe("clean window alarm", () => {
  it("a window start in 3 h schedules one alarm", () => {
    const plan = planWindowAlarm(["poll"], win(3), NOW, null);
    assert.deepEqual(plan, { clear: [], create: { name: `clean-${iso(3)}`, when: NOW + 3 * 3_600_000 } });
  });

  it("a new window replaces the old alarm", () => {
    const plan = planWindowAlarm(["poll", `clean-${iso(3)}`], win(5), NOW, null);
    assert.deepEqual(plan.clear, [`clean-${iso(3)}`]);
    assert.equal(plan.create.name, `clean-${iso(5)}`);
  });

  it("an existing alarm for the same window is kept as is", () => {
    assert.deepEqual(planWindowAlarm([`clean-${iso(3)}`], win(3), NOW, null), { clear: [], create: null });
  });

  it("a fallback window schedules no alarm", () => {
    assert.deepEqual(planWindowAlarm([`clean-${iso(3)}`], win(3, { fallback: true }), NOW, null), { clear: [`clean-${iso(3)}`], create: null });
  });

  it("a fired alarm for an already notified start sends nothing", () => {
    assert.equal(windowEvent(`clean-${iso(3)}`, { notifiedStart: iso(3), lastWindow: win(3), region: "FR" }), null);
    const e = windowEvent(`clean-${iso(3)}`, { notifiedStart: null, lastWindow: win(3), region: "FR" });
    assert.equal(e.kind, "clean_window");
    assert.equal(e.window.end, iso(6));
  });
});

describe("dispatch", () => {
  it("notify.finished = false drops task_finished events", async () => {
    const { sent, channel } = recorder();
    const events = [{ kind: "task_finished", task: task("a") }, { kind: "clean_window", window: win(0), region: "FR" }];
    await dispatch(events, [channel], { finished: false, cleanWindow: true });
    assert.deepEqual(sent.map((e) => e.kind), ["clean_window"]);
  });

  it("zero channels do not throw, and a failing channel does not stop the next", async () => {
    await dispatch([{ kind: "task_finished", task: task("a") }], [], ALL);
    const { sent, channel } = recorder();
    const broken = { name: "broken", send: async () => { throw new Error("no"); } };
    await dispatch([{ kind: "task_finished", task: task("a") }], [broken, channel], ALL);
    assert.equal(sent.length, 1);
  });
});

describe("notification text", () => {
  it("a title holding <b>x</b> passes through as literal text", async () => {
    const created = [];
    const ext = { runtime: { getURL: (p) => `chrome-extension://id/${p}` }, notifications: { create: async (id, opts) => created.push({ id, opts }) } };
    await browserNotifications(ext).send({ kind: "task_finished", task: task("a", "<b>x</b>") });
    assert.equal(created[0].id, "tidegap-task-a");
    assert.equal(created[0].opts.title, "Done: <b>x</b>");
    assert.equal(created[0].opts.type, "basic");
  });

  it("titles stop at 100 characters and bodies at 200, on one line", () => {
    const n = toNotification({ kind: "task_finished", task: task("a", `${"x".repeat(150)}\nline2`, "failed") });
    assert.equal(n.title.length, 100);
    assert.ok(n.title.startsWith("Failed: "));
    assert.ok(n.message.length <= 200);
    const w = toNotification({ kind: "clean_window", window: win(0), region: "FR" });
    assert.equal(w.message, "The grid in FR is clean until 12:00. A good time for queued work.");
  });
});
