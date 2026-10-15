/**
 * `ebb ui` write API (ui v2, U8): POST hardening, every action against a
 * real ledger, the change stream, the series route and Start dispatcher.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { mockGridFeed, TaskStore, type GridFeed, type TaskRecord } from "@ebb-ai/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { startUiServer, type UiServer } from "../src/ui/server.js";

const TOKEN = "test-token-actions-0123456789";
const H = 3_600_000;
const spec = (prompt: string) =>
  JSON.stringify({ type: "provider_call", provider: "anthropic", model: "claude-sonnet-4-6", prompt });

function seed(dbPath: string): void {
  const store = new TaskStore({ dbPath });
  const now = Date.now();
  const base = (id: string, extra: Partial<TaskRecord<unknown>> = {}): TaskRecord<unknown> => ({
    taskId: id,
    status: "scheduled",
    enqueuedAt: new Date(now - 60_000).toISOString(),
    scheduledFor: new Date(now + H).toISOString(),
    deadline: new Date(now + 6 * H).toISOString(),
    region: "FR",
    bodyJson: spec(`Prompt line of ${id}\nsecond`),
    ...extra,
  });
  store.upsert(base("a"));
  store.upsert(base("b"));
  store.upsert(base("w", { seriesId: "w", repeat: "weekly", title: "Weekly limits" }));
  store.upsert(base("run", { status: "running" }));
  store.upsert(
    base("done", {
      status: "completed",
      completedAt: new Date(now - 1_000).toISOString(),
      result: { text: "the answer" },
      originCwd: "/work",
      originSessionId: "sess-12345678",
    }),
  );
  store.upsert(base("bad", { status: "failed", completedAt: new Date(now).toISOString(), error: "x" }));
  store.close();
}

describe("ebb ui write API", () => {
  let dir: string;
  let dbPath: string;
  let ui: UiServer;
  let spawned: Array<{ argv: string[]; log: string }>;
  let alive: Set<number>;
  let feedCalls: number;

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), "ebb-ui-actions-"));
    dbPath = join(dir, "queue.db");
    const assetDir = join(dir, "ui");
    mkdirSync(assetDir);
    writeFileSync(join(assetDir, "index.html"), "<!doctype html><title>ebb</title>");
    seed(dbPath);
    spawned = [];
    alive = new Set();
    feedCalls = 0;
    const inner = mockGridFeed();
    const feed: GridFeed = {
      source: "mock",
      fetchForecast: (r, h) => {
        feedCalls++;
        return inner.fetchForecast(r, h);
      },
    };
    ui = await startUiServer({
      token: TOKEN,
      dbPath,
      assetDir,
      feed,
      defaultRegion: "FR",
      quota: () => ({}),
      daemonStatus: () => "not_installed",
      pollMs: 50,
      launcher: ["/usr/bin/node", "/opt/ebb/dist/index.js"],
      logDir: join(dir, "logs"),
      spawn: (argv, log) => {
        spawned.push({ argv, log });
        const pid = 40_000 + spawned.length;
        alive.add(pid);
        return pid;
      },
      isAlive: (pid) => alive.has(pid),
    });
  });

  afterEach(async () => {
    await ui.close();
    rmSync(dir, { recursive: true, force: true });
  });

  const post = (path: string, body?: unknown, headers: Record<string, string> = {}, token: string | null = TOKEN) =>
    fetch(`${ui.url.replace(/\/$/, "")}${path}`, {
      method: "POST",
      headers: {
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...(body !== undefined ? { "content-type": "application/json" } : {}),
        ...headers,
      },
      ...(body !== undefined ? { body: typeof body === "string" ? body : JSON.stringify(body) } : {}),
    });
  const get = (path: string) =>
    fetch(`${ui.url.replace(/\/$/, "")}${path}`, { headers: { authorization: `Bearer ${TOKEN}` } });
  const row = (id: string) => {
    const store = new TaskStore({ dbPath });
    try {
      return store.get(id);
    } finally {
      store.close();
    }
  };
  const raw = (path: string, headers: Record<string, string>, method = "POST", body = "") =>
    new Promise<number>((resolve, reject) => {
      const req = request({ host: "127.0.0.1", port: ui.port, path, method, headers }, (res) => {
        res.resume();
        resolve(res.statusCode ?? 0);
      });
      req.on("error", reject);
      req.end(body);
    });

  describe("POST hardening (KTD9)", () => {
    const routes = [
      ["/api/tasks/a/cancel", {}],
      ["/api/tasks/a/reschedule", { at: new Date(Date.now() + 9 * H).toISOString() }],
      ["/api/tasks/done/reply", { text: "hi" }],
      ["/api/tasks/a/run-now", undefined],
      ["/api/tasks/done/read", undefined],
      ["/api/dispatcher/start", undefined],
    ] as const;

    it("every POST without the token is 401", async () => {
      for (const [path, body] of routes) {
        expect((await post(path, body, {}, null)).status, path).toBe(401);
      }
    });

    it("every POST with a wrong Host or Origin is 403", async () => {
      for (const [path] of routes) {
        const auth = { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" };
        expect(await raw(path, { ...auth, host: `evil.example:${ui.port}` }, "POST", "{}"), path).toBe(403);
        expect(
          await raw(path, { ...auth, host: `127.0.0.1:${ui.port}`, origin: "https://evil.example" }, "POST", "{}"),
          path,
        ).toBe(403);
      }
    });

    it("body routes: text/plain 415, 70 KiB 413, unknown field 400, bad JSON 400", async () => {
      for (const path of ["/api/tasks/a/cancel", "/api/tasks/a/reschedule", "/api/tasks/done/reply"]) {
        expect((await post(path, "{}", { "content-type": "text/plain" })).status, path).toBe(415);
        expect((await post(path, { text: "x".repeat(70 * 1024) })).status, path).toBe(413);
        expect((await post(path, { nope: 1 })).status, path).toBe(400);
        expect((await post(path, "{not json")).status, path).toBe(400);
        expect((await post(path, "[1]")).status, path).toBe(400);
      }
      expect(row("a")?.status).toBe("scheduled");
    });

    it("body-less routes refuse a body (400); GET on a POST route is 405", async () => {
      expect((await post("/api/tasks/a/run-now", { x: 1 })).status).toBe(400);
      for (const path of ["/api/tasks/a/cancel", "/api/tasks/a/reschedule", "/api/tasks/a/run-now", "/api/tasks/done/reply", "/api/dispatcher/start"]) {
        expect((await get(path)).status, path).toBe(405);
      }
    });

    it("the v1 page's body-less mark-read with only the bearer header still returns 204", async () => {
      expect(await raw("/api/tasks/done/read", { authorization: `Bearer ${TOKEN}`, host: `127.0.0.1:${ui.port}` })).toBe(204);
    });

    it("never sets a cookie", async () => {
      const res = await post("/api/tasks/a/cancel", {});
      expect(res.headers.get("set-cookie")).toBeNull();
      expect(res.headers.get("access-control-allow-origin")).toBeNull();
    });
  });

  describe("actions", () => {
    it("cancel: 200 summary, then 409 on repeat; unknown task 404", async () => {
      const first = await post("/api/tasks/a/cancel", {});
      expect(first.status).toBe(200);
      expect(((await first.json()) as { status: string }).status).toBe("cancelled");
      const again = await post("/api/tasks/a/cancel", {});
      expect(again.status).toBe(409);
      expect(((await again.json()) as { error: string }).error).toMatch(/cancel: task a is cancelled/);
      expect((await post("/api/tasks/nope/cancel", {})).status).toBe(404);
    });

    it("cancel with series ends the series; a plain cancel skips and rolls", async () => {
      expect((await post("/api/tasks/w/cancel", { series: true })).status).toBe(200);
      expect(row("w")?.repeat).toBe("none");
      expect(row("w~2")).toBeUndefined();
    });

    it("run-now: 200, due now and expedited; the row stays scheduled (no dispatch here)", async () => {
      const res = await post("/api/tasks/a/run-now");
      expect(res.status).toBe(200);
      const r = row("a")!;
      expect(r.status).toBe("scheduled");
      expect(r.intensitySource).toBe("expedited");
      expect(Date.parse(r.scheduledFor!)).toBeLessThanOrEqual(Date.now());
      expect((await post("/api/tasks/run/run-now")).status).toBe(409);
    });

    it("reschedule by deadline, exact time and day bounds", async () => {
      const deadline = new Date(Date.now() + 30 * H).toISOString();
      expect((await post("/api/tasks/a/reschedule", { deadline })).status).toBe(200);
      expect(row("a")?.deadline).toBe(deadline);
      const at = new Date(Date.now() + 10 * H).toISOString();
      expect((await post("/api/tasks/b/reschedule", { at })).status).toBe(200);
      expect(row("b")?.scheduledFor).toBe(at);
      const dayStart = new Date(Date.now() + 26 * H);
      const dayEnd = new Date(dayStart.getTime() + 24 * H);
      const res = await post("/api/tasks/a/reschedule", {
        day_start: dayStart.toISOString(),
        day_end: dayEnd.toISOString(),
      });
      expect(res.status).toBe(200);
      const t = Date.parse(row("a")!.scheduledFor!);
      expect(t).toBeGreaterThanOrEqual(dayStart.getTime());
      expect(t).toBeLessThanOrEqual(dayEnd.getTime());
      expect((await post("/api/tasks/a/reschedule", { at, deadline })).status).toBe(400);
      expect((await post("/api/tasks/a/reschedule", { at: "tomorrow" })).status).toBe(400);
      expect(
        (await post("/api/tasks/a/reschedule", { day_start: dayStart.toISOString(), day_end: dayStart.toISOString() })).status,
      ).toBe(400);
      expect((await post("/api/tasks/run/reschedule", { at })).status).toBe(409);
    });

    it("reply: 201 child; the child appears in the parent's children; failed parent 409", async () => {
      const res = await post("/api/tasks/done/reply", { text: "and then?" });
      expect(res.status).toBe(201);
      const child = (await res.json()) as { task_id: string; parent_task_id: string };
      expect(child.parent_task_id).toBe("done");
      const detail = (await (await get("/api/tasks/done")).json()) as {
        children: Array<{ task_id: string }>;
        resume_command: string;
        actions: { reply: boolean };
      };
      expect(detail.children.map((c) => c.task_id)).toEqual([child.task_id]);
      expect(detail.resume_command).toBe("cd /work && claude --resume sess-12345678");
      expect(detail.actions.reply).toBe(true);
      const bad = await post("/api/tasks/bad/reply", { text: "again" });
      expect(bad.status).toBe(409);
      expect((await post("/api/tasks/done/reply", { text: "" })).status).toBe(400);
    });

    it("the server never dispatches: actions call no adapter and touch no receipt", async () => {
      await post("/api/tasks/a/run-now");
      await post("/api/tasks/b/cancel", {});
      const before = feedCalls;
      await new Promise((r) => setTimeout(r, 120));
      expect(feedCalls).toBe(before);
      expect(row("a")?.receipt).toBeUndefined();
      expect(row("a")?.status).toBe("scheduled");
    });

    it("an action pushes its id on the change stream", async () => {
      const res = await get("/api/events");
      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      while (!buf.includes("event: hello")) buf += decoder.decode((await reader.read()).value);
      await post("/api/tasks/a/cancel", {});
      const until = Date.now() + 3_000;
      while (!buf.includes('"a"') && Date.now() < until) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value);
      }
      await reader.cancel();
      expect(buf).toMatch(/event: tasks\ndata: \{"ids":\[[^\]]*"a"/);
    });
  });

  describe("reads (ui v2 fields)", () => {
    it("list gives display_title from the prompt, actions, and no prompt field", async () => {
      const text = await (await get("/api/tasks?status=scheduled")).text();
      expect(text).not.toContain('"prompt"');
      const body = JSON.parse(text) as { tasks: Array<Record<string, unknown>> };
      const a = body.tasks.find((t) => t.task_id === "a")!;
      expect(a.display_title).toBe("Prompt line of a");
      expect(a.provider).toBe("anthropic");
      expect(a.model).toBe("claude-sonnet-4-6");
      expect(a.actions).toMatchObject({ cancel: true, reschedule: true, runNow: true, reply: false });
    });

    it("list accepts series= and limit=", async () => {
      await post("/api/tasks/w/cancel", {});
      const s = (await (await get("/api/tasks?series=w")).json()) as { tasks: Array<{ task_id: string }> };
      expect(s.tasks.map((t) => t.task_id)).toEqual(["w", "w~2"]);
      const l = (await (await get("/api/tasks?limit=2")).json()) as { tasks: unknown[] };
      expect(l.tasks).toHaveLength(2);
      expect((await get("/api/tasks?limit=0")).status).toBe(400);
    });

    it("GET /api/series/:id returns the rule, occurrences and next deadlines", async () => {
      const body = (await (await get("/api/series/w")).json()) as {
        repeat: string;
        occurrences: Array<{ task_id: string }>;
        next_deadlines: string[];
      };
      expect(body.repeat).toBe("weekly");
      expect(body.occurrences.map((o) => o.task_id)).toEqual(["w"]);
      expect(body.next_deadlines).toHaveLength(8);
      expect(Date.parse(body.next_deadlines[1]!) - Date.parse(body.next_deadlines[0]!)).toBe(7 * 24 * H);
      expect((await get("/api/series/none")).status).toBe(404);
    });
  });

  describe("Start dispatcher (KTD13)", () => {
    it("never ran: state never; start spawns the same binary detached, 201; second start 409", async () => {
      let status = (await (await get("/api/status")).json()) as { dispatcher: { state: string; ui_child: unknown } };
      expect(status.dispatcher.state).toBe("never");
      expect(status.dispatcher.ui_child).toBeNull();
      const res = await post("/api/dispatcher/start");
      expect(res.status).toBe(201);
      const meta = (await res.json()) as { pid: number; log: string; started_at: string };
      expect(meta.log).toBe(join(dir, "logs", "ui-tick.log"));
      expect(spawned[0]!.argv).toEqual([
        "/usr/bin/node",
        "/opt/ebb/dist/index.js",
        "tick",
        "--daemon",
        "--interval",
        "60",
        "--db",
        dbPath,
      ]);
      expect((await post("/api/dispatcher/start")).status).toBe(409);
      status = (await (await get("/api/status")).json()) as typeof status;
      expect(status.dispatcher.state).toBe("running");
      expect(status.dispatcher.ui_child).toMatchObject({ pid: meta.pid, alive: true });
      // Once that child is gone, a new start is allowed.
      alive.delete(meta.pid);
      expect((await post("/api/dispatcher/start")).status).toBe(201);
    });

    it("another ticker ticked recently: start is refused (409) and nothing is spawned", async () => {
      const store = new TaskStore({ dbPath });
      store.setMeta("last_tick_at", new Date(Date.now() - 30_000).toISOString());
      store.close();
      const res = await post("/api/dispatcher/start");
      expect(res.status).toBe(409);
      expect(((await res.json()) as { error: string }).error).toMatch(/already ticking/);
      expect(spawned).toHaveLength(0);
    });

    it("a recycled pid (alive, but no recent start or tick) does not block start", async () => {
      const store = new TaskStore({ dbPath });
      store.setMeta(
        "ui_dispatcher",
        JSON.stringify({ pid: 777, log: "/x.log", started_at: new Date(Date.now() - 3 * H).toISOString() }),
      );
      store.setMeta("last_tick_at", new Date(Date.now() - 3 * H).toISOString());
      store.close();
      alive.add(777);
      const status = (await (await get("/api/status")).json()) as {
        dispatcher: { state: string; ui_child: { alive: boolean } };
      };
      expect(status.dispatcher.ui_child.alive).toBe(false);
      expect(status.dispatcher.state).toBe("stale");
      expect((await post("/api/dispatcher/start")).status).toBe(201);
    });

    it("a stale last tick and no child gives stale", async () => {
      const store = new TaskStore({ dbPath });
      store.setMeta("last_tick_at", new Date(Date.now() - 3 * H).toISOString());
      store.close();
      const status = (await (await get("/api/status")).json()) as {
        dispatcher: { state: string; interval_s: number };
      };
      expect(status.dispatcher.state).toBe("stale");
      expect(status.dispatcher.interval_s).toBe(60);
    });
  });
});
