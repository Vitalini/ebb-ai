import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { NO_TOKEN_MESSAGE, OFFLINE_MESSAGE, UNPAIRED_MESSAGE, api, pageUrl, request } from "../src/lib/api.js";

const settings = { port: 47999, token: "tgc_abc" };

function stub(status, body) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    return new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  };
  return { calls, fetchImpl };
}

describe("api", () => {
  it("200 gives ok with the parsed body", async () => {
    const { fetchImpl } = stub(200, { active: 3 });
    assert.deepEqual(await request(settings, "/api/summary", { fetchImpl }), { state: "ok", status: 200, body: { active: 3 } });
  });

  it("a refused connection gives offline", async () => {
    const fetchImpl = async () => {
      throw new TypeError("Failed to fetch");
    };
    assert.deepEqual(await request(settings, "/api/summary", { fetchImpl }), { state: "offline", message: OFFLINE_MESSAGE });
  });

  it("401 gives unpaired with the revoked-or-older message", async () => {
    const { fetchImpl } = stub(401, { error: "unauthorized" });
    const r = await request(settings, "/api/summary", { fetchImpl });
    assert.equal(r.state, "unpaired");
    assert.equal(r.message, UNPAIRED_MESSAGE);
    assert.match(r.message, /revoked, or tidegap is older than 0\.19/);
  });

  it("500 gives error without the body text", async () => {
    const { fetchImpl } = stub(500, { error: "secret stack /Users/x" });
    const r = await request(settings, "/api/summary", { fetchImpl });
    assert.equal(r.state, "error");
    assert.equal(r.status, 500);
    assert.doesNotMatch(r.message, /secret|Users/);
  });

  it("400 shows the server's one-line message", async () => {
    const { fetchImpl } = stub(400, { error: "prompt must not be blank\nsecond line" });
    const r = await request(settings, "/api/tasks", { method: "POST", body: { prompt: " " }, fetchImpl });
    assert.deepEqual(r, { state: "error", status: 400, message: "prompt must not be blank" });
  });

  it("every request carries the bearer token and goes to the configured port", async () => {
    const { calls, fetchImpl } = stub(200, {});
    await api.summary(settings, "2026-10-17T10:00:00.000Z", { fetchImpl });
    await api.activeTasks(settings, { fetchImpl });
    assert.equal(calls[0].url, "http://127.0.0.1:47999/api/summary?since=2026-10-17T10%3A00%3A00.000Z");
    assert.equal(calls[1].url, "http://127.0.0.1:47999/api/tasks?status=queued,scheduled,running,submitted&limit=20");
    for (const c of calls) assert.equal(c.init.headers.authorization, "Bearer tgc_abc");
    assert.equal(calls[0].init.headers["content-type"], undefined);
  });

  it("no token makes no request and gives unpaired", async () => {
    const { calls, fetchImpl } = stub(200, {});
    const r = await request({ port: 47821, token: "" }, "/api/summary", { fetchImpl });
    assert.deepEqual(r, { state: "unpaired", message: NO_TOKEN_MESSAGE });
    assert.equal(calls.length, 0);
  });

  it("a JSON POST sets content-type application/json", async () => {
    const { calls, fetchImpl } = stub(201, { task_id: "t1" });
    const r = await api.addTask(settings, { prompt: "hi", deadline: "2026-10-18T10:00:00.000Z" }, { fetchImpl });
    assert.equal(r.state, "ok");
    assert.equal(calls[0].init.method, "POST");
    assert.equal(calls[0].init.headers["content-type"], "application/json");
    assert.deepEqual(JSON.parse(calls[0].init.body), { prompt: "hi", deadline: "2026-10-18T10:00:00.000Z" });
  });

  it("the page link carries the token in the fragment", () => {
    assert.equal(pageUrl({ port: 47821, token: "tgc_a+b" }), "http://127.0.0.1:47821/#token=tgc_a%2Bb");
  });
});
