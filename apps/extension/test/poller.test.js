process.env.TZ = "UTC";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createPoller } from "../src/lib/poller.js";

const NOW = Date.parse("2026-10-17T09:00:00.000Z");
const iso = (h) => new Date(NOW + h * 3_600_000).toISOString();
const win = (h) => ({ start: iso(h), end: iso(h + 3), band: "clean", g: 40, now: false, fallback: false });
const done = (id) => ({ task_id: id, title: `Task ${id}`, status: "completed", completed_at: iso(-1) });
const ok = (body) => ({ state: "ok", status: 200, body: { active: 0, finished: [], cursor: "c1", clean_window: null, region: "FR", ...body } });

/** Fakes for storage.local, alarms, the badge, one channel and api.summary. */
function harness(answers, initial = { token: "tgc_a" }) {
  const data = structuredClone(initial);
  const storage = {
    get: async (keys) => Object.fromEntries(keys.filter((k) => k in data).map((k) => [k, structuredClone(data[k])])),
    set: async (patch) => Object.assign(data, structuredClone(patch)),
  };
  const alarmNames = [];
  const alarms = {
    getAll: async () => alarmNames.map((name) => ({ name })),
    clear: async (name) => alarmNames.splice(alarmNames.indexOf(name), 1),
    create: async (name) => alarmNames.push(name),
  };
  const badges = [];
  const sent = [];
  const calls = [];
  const api = {
    summary: async (s, since) => {
      calls.push({ token: s.token, since });
      const next = answers.shift();
      return typeof next === "function" ? next() : next;
    },
  };
  const now = { value: NOW };
  const poller = createPoller({
    api,
    storage,
    alarms,
    setBadge: async (b) => badges.push(b),
    channels: [{ name: "rec", send: async (e) => sent.push(e) }],
    now: () => now.value,
  });
  return { ...poller, data, storage, alarmNames, badges, sent, calls, now };
}

describe("poll", () => {
  it("the first poll after pairing stores the cursor and notifies nothing; the next notifies once", async () => {
    const h = harness([
      ok({ finished: [done("a")], cursor: "c1" }),
      ok({ finished: [done("b"), done("a")], cursor: "c2" }),
      ok({ finished: [done("b")], cursor: "c2" }),
    ]);
    assert.equal(await h.poll(), "ok");
    assert.equal(h.data.cursor, "c1");
    assert.deepEqual(h.sent, []);
    await h.poll();
    assert.deepEqual(h.calls.map((c) => c.since), [null, "c1"]);
    assert.deepEqual(h.sent.map((e) => e.task.task_id), ["b"]);
    await h.poll();
    assert.equal(h.sent.length, 1);
    assert.equal(h.data.cursor, "c2");
  });

  it("a failed poll sets the badge and saves nothing", async () => {
    const h = harness([{ state: "offline", message: "tidegap ui is not running." }], { token: "tgc_a", cursor: "c1", seen: ["a"] });
    assert.equal(await h.poll(), "offline");
    assert.equal(h.badges.at(-1).text, "off");
    assert.deepEqual(h.data, { token: "tgc_a", cursor: "c1", seen: ["a"] });
  });

  it("a future clean window schedules its alarm", async () => {
    const h = harness([ok({ clean_window: win(3) })]);
    await h.poll();
    assert.deepEqual(h.alarmNames, [`clean-${iso(3)}`]);
    assert.deepEqual(h.data.lastWindow, win(3));
  });

  it("calls during a poll share one trailing poll", async () => {
    let release;
    const h = harness([() => new Promise((r) => (release = () => r(ok({})))), ok({ cursor: "c2" })]);
    const first = h.poll();
    const second = h.poll();
    const third = h.poll();
    assert.equal(second, third);
    await new Promise((r) => setImmediate(r));
    release();
    await Promise.all([first, second, third]);
    assert.equal(h.calls.length, 2);
    assert.equal(h.data.cursor, "c2");
  });

  it("a new token saved during a poll drops that poll's answer; the trailing poll starts fresh", async () => {
    let release;
    const h = harness(
      [() => new Promise((r) => (release = () => r(ok({ finished: [done("old")], cursor: "c9" })))), ok({ finished: [done("x")], cursor: "n1" })],
      { token: "tgc_old", cursor: "c1", seen: ["a"] },
    );
    const first = h.poll();
    await new Promise((r) => setImmediate(r));
    // What the options page writes (connectionPatch with a new token), then the onChanged poll.
    await h.storage.set({ token: "tgc_new", cursor: null, seen: [], notifiedStart: null });
    const trailing = h.poll();
    release();
    assert.equal(await first, "stale");
    assert.equal(await trailing, "ok");
    assert.deepEqual(h.calls, [{ token: "tgc_old", since: "c1" }, { token: "tgc_new", since: null }]);
    assert.equal(h.data.cursor, "n1");
    assert.deepEqual(h.data.seen, ["x"]);
    assert.deepEqual(h.sent, []);
  });
});

describe("clean window alarm", () => {
  const state = { token: "tgc_a", lastWindow: win(3), region: "FR" };

  it("the same alarm twice notifies once", async () => {
    const h = harness([], state);
    h.now.value = NOW + 3 * 3_600_000;
    await h.cleanWindowStarted(`clean-${iso(3)}`);
    await h.cleanWindowStarted(`clean-${iso(3)}`);
    assert.equal(h.sent.length, 1);
    assert.equal(h.sent[0].kind, "clean_window");
    assert.equal(h.data.notifiedStart, iso(3));
  });

  it("an alarm that fires after the window ended notifies nothing", async () => {
    const h = harness([], state);
    h.now.value = NOW + 9 * 3_600_000;
    await h.cleanWindowStarted(`clean-${iso(3)}`);
    assert.deepEqual(h.sent, []);
  });
});
