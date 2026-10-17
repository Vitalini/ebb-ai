import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DEFAULT_PORT, connectionPatch, loadSettings, normalize, parsePort } from "../src/lib/settings.js";

const NOTIFY = { finished: true, cleanWindow: true };

describe("parsePort", () => {
  it("takes 1-65535 as a number or a trimmed string, nothing else", () => {
    assert.equal(parsePort(47821), 47821);
    assert.equal(parsePort("47821 "), 47821);
    assert.equal(parsePort("1"), 1);
    assert.equal(parsePort("65535"), 65535);
    for (const bad of ["0", "65536", "abc", "", "1.5", -1, null, undefined]) assert.equal(parsePort(bad), null, String(bad));
  });
});

describe("normalize", () => {
  it("an empty store gives the defaults", () => {
    assert.deepEqual(normalize({}), {
      port: DEFAULT_PORT,
      token: "",
      notify: NOTIFY,
      cursor: null,
      seen: [],
      lastWindow: null,
      region: null,
      notifiedStart: null,
    });
  });

  it("drops malformed values and keeps the notify flags on unless set to false", () => {
    const s = normalize({
      port: "99999",
      token: "  tgc_a ",
      notify: { finished: false },
      cursor: 5,
      seen: ["a", 3, null, "b"],
      lastWindow: "soon",
      region: 7,
      notifiedStart: {},
    });
    assert.equal(s.port, DEFAULT_PORT);
    assert.equal(s.token, "tgc_a");
    assert.deepEqual(s.notify, { finished: false, cleanWindow: true });
    assert.equal(s.cursor, null);
    assert.deepEqual(s.seen, ["a", "b"]);
    assert.equal(s.lastWindow, null);
    assert.equal(s.region, null);
    assert.equal(s.notifiedStart, null);
    assert.deepEqual(normalize({ notify: "off" }).notify, NOTIFY);
  });

  it("loadSettings reads every key from the given storage", async () => {
    const keys = [];
    const storage = { get: async (k) => (keys.push(...k), { port: 48000, cursor: "c1" }) };
    const s = await loadSettings(storage);
    assert.equal(s.port, 48000);
    assert.equal(s.cursor, "c1");
    assert.ok(keys.includes("token") && keys.includes("seen") && keys.includes("notifiedStart"));
  });
});

describe("connectionPatch", () => {
  const current = normalize({ token: "tgc_old", cursor: "c1", seen: ["a"], notifiedStart: "2026-10-17T12:00:00.000Z" });

  it("the same token keeps cursor, seen and notifiedStart", () => {
    const patch = connectionPatch(current, { port: 48000, token: "tgc_old", notify: NOTIFY });
    assert.deepEqual(patch, { port: 48000, token: "tgc_old", notify: NOTIFY });
  });

  it("a new token resets cursor, seen and notifiedStart", () => {
    const patch = connectionPatch(current, { port: DEFAULT_PORT, token: "tgc_new", notify: NOTIFY });
    assert.deepEqual(patch, { port: DEFAULT_PORT, token: "tgc_new", notify: NOTIFY, cursor: null, seen: [], notifiedStart: null });
  });
});
