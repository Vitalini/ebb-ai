process.env.TZ = "UTC";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { NO_TOKEN_MESSAGE, OFFLINE_MESSAGE, UNPAIRED_MESSAGE } from "../src/lib/api.js";
import { deadlineFor, headerLine, promptProblem, rowsFrom, statusFor } from "../src/popup/model.js";

const NOW = Date.parse("2026-10-17T09:00:00.000Z");

describe("popup model", () => {
  it("maps a list answer to rows in scheduled_for order, titles as text", () => {
    const body = {
      tasks: [
        { task_id: "c", display_title: "Later", status: "scheduled", scheduled_for: "2026-10-18T14:00:00.000Z" },
        { task_id: "a", display_title: "<i>Soon</i>", status: "queued", scheduled_for: "2026-10-17T11:00:00.000Z" },
        { task_id: "b", display_title: "Busy", status: "running", scheduled_for: null },
      ],
    };
    assert.deepEqual(rowsFrom(body, NOW), [
      { id: "a", title: "<i>Soon</i>", status: "queued", when: "11:00" },
      { id: "c", title: "Later", status: "scheduled", when: "Sun 14:00" },
      { id: "b", title: "Busy", status: "running", when: "running" },
    ]);
  });

  it("preset 24 h gives a deadline exactly 24 h later", () => {
    assert.equal(deadlineFor("24h", NOW), "2026-10-18T09:00:00.000Z");
    assert.equal(deadlineFor("6h", NOW), "2026-10-17T15:00:00.000Z");
    assert.equal(deadlineFor("3d", NOW), "2026-10-20T09:00:00.000Z");
  });

  it("an empty prompt is refused before any request", () => {
    assert.equal(promptProblem("   "), "Write a prompt first.");
    assert.equal(promptProblem("do it"), null);
  });

  it("a 400 shows the server's message", () => {
    assert.deepEqual(statusFor({ state: "error", status: 400, message: "deadline must be in the future" }), { kind: "error", text: "deadline must be in the future", options: false });
  });

  it("each status maps to its message", () => {
    assert.deepEqual(statusFor({ state: "unpaired", message: UNPAIRED_MESSAGE }), { kind: "unpaired", text: UNPAIRED_MESSAGE, options: true });
    assert.match(statusFor({ state: "unpaired", message: NO_TOKEN_MESSAGE }).text, /not paired/i);
    assert.match(statusFor({ state: "unpaired", message: UNPAIRED_MESSAGE }).text, /not paired.*revoked, or tidegap is older than 0\.19/i);
    assert.deepEqual(statusFor({ state: "offline", message: OFFLINE_MESSAGE }), { kind: "offline", text: OFFLINE_MESSAGE, options: false });
    assert.match(OFFLINE_MESSAGE, /run `tidegap ui`/i);
  });

  it("the header line shows the clean window", () => {
    assert.equal(headerLine({ region: "FR", clean_window: { start: "2026-10-17T14:00:00.000Z", end: "2026-10-17T17:00:00.000Z", now: false, fallback: false } }), "clean 14:00-17:00 FR");
    assert.equal(headerLine({ clean_window: null, forecast_ok: false }), "Forecast unavailable");
  });
});
