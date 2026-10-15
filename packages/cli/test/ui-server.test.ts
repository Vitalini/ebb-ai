import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { mockGridFeed, TaskStore, type TaskRecord } from "@ebb-ai/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { daemonStatus } from "../src/platform/index.js";
import { startUiServer, type UiServer } from "../src/ui/server.js";

const TOKEN = "test-token-0123456789";

function seed(dbPath: string): void {
  const store = new TaskStore({ dbPath });
  const now = Date.now();
  const base = (id: string, extra: Partial<TaskRecord<unknown>>): TaskRecord<unknown> => ({
    taskId: id,
    status: "scheduled",
    enqueuedAt: new Date(now - 60_000).toISOString(),
    scheduledFor: new Date(now + 3_600_000).toISOString(),
    region: "FR",
    title: `title ${id}`,
    bodyJson: JSON.stringify({ type: "provider_call", provider: "anthropic", model: "m", prompt: `prompt of ${id}` }),
    ...extra,
  });
  store.upsert(base("sched-abs", { deadline: new Date(now + 7_200_000).toISOString() }));
  store.upsert(
    base("sched-quota", {
      deadline: new Date(now + 86_400_000).toISOString(),
      deadlineKind: "quota_reset",
      quotaProvider: "claude",
    }),
  );
  store.upsert(
    base("done-1", {
      status: "completed",
      completedAt: new Date(now - 1_000).toISOString(),
      result: { text: "the answer", raw: { id: "msg_1" } },
      receipt: { taskId: "done-1", actualCarbonGCo2: 1.2 } as never,
    }),
  );
  store.close();
}

describe("ebb ui server", () => {
  let dir: string;
  let dbPath: string;
  let assetDir: string;
  let ui: UiServer;
  let probe: ReturnType<typeof daemonStatus>;

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), "ebb-ui-"));
    dbPath = join(dir, "queue.db");
    assetDir = join(dir, "ui");
    mkdirSync(assetDir);
    writeFileSync(join(assetDir, "index.html"), "<!doctype html><title>ebb</title>");
    writeFileSync(join(dir, "package.json"), "{}");
    seed(dbPath);
    probe = "not_installed";
    ui = await startUiServer({
      token: TOKEN,
      dbPath,
      assetDir,
      feed: mockGridFeed(),
      defaultRegion: "FR",
      quota: () => ({}),
      daemonStatus: () => probe,
      pollMs: 50,
    });
  });

  afterEach(async () => {
    await ui.close();
    rmSync(dir, { recursive: true, force: true });
  });

  const api = (path: string, init: RequestInit = {}, token: string | null = TOKEN) =>
    fetch(`${ui.url.replace(/\/$/, "")}${path}`, {
      ...init,
      headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(init.headers ?? {}) },
    });

  it("binds 127.0.0.1 only", () => {
    expect(ui.address).toBe("127.0.0.1");
  });

  it("requires the bearer token on the API (AE6)", async () => {
    expect((await api("/api/tasks", {}, null)).status).toBe(401);
    expect((await api("/api/tasks", {}, "wrong")).status).toBe(401);
    expect((await api("/api/events", {}, null)).status).toBe(401);
    expect((await api("/api/tasks")).status).toBe(200);
  });

  it("refuses a foreign Host header (DNS rebinding, AE6)", async () => {
    const status = await new Promise<number>((resolve, reject) => {
      const req = request(
        { host: "127.0.0.1", port: ui.port, path: "/api/tasks", headers: { host: `evil.example:${ui.port}`, authorization: `Bearer ${TOKEN}` } },
        (res) => {
          res.resume();
          resolve(res.statusCode ?? 0);
        },
      );
      req.on("error", reject);
      req.end();
    });
    expect(status).toBe(403);
  });

  it("filters by kind and unread, and the list carries no prompt", async () => {
    const quota = (await (await api("/api/tasks?kind=quota_reset")).json()) as { tasks: Array<{ task_id: string }> };
    expect(quota.tasks.map((t) => t.task_id)).toEqual(["sched-quota"]);
    const unread = (await (await api("/api/tasks?unread=1")).json()) as { tasks: Array<{ task_id: string }> };
    expect(unread.tasks.map((t) => t.task_id)).toEqual(["done-1"]);
    const pending = await api("/api/tasks?status=queued,scheduled,submitted");
    const text = await pending.text();
    expect(text).not.toContain("prompt of");
    expect((JSON.parse(text) as { tasks: unknown[] }).tasks).toHaveLength(2);
    expect((await api("/api/tasks?status=bogus")).status).toBe(400);
  });

  it("returns detail with history, receipt and raw payload", async () => {
    const res = await api("/api/tasks/done-1");
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.prompt).toBe("prompt of done-1");
    expect(body.history).toEqual([
      { role: "user", content: "prompt of done-1" },
      { role: "assistant", content: "the answer" },
    ]);
    expect((body.receipt as { actualCarbonGCo2: number }).actualCarbonGCo2).toBe(1.2);
    expect(body.raw).toEqual({ id: "msg_1" });
    expect((await api("/api/tasks/nope")).status).toBe(404);
  });

  it("marks a finished task read (204) and refuses a scheduled one (409)", async () => {
    expect((await api("/api/tasks/done-1/read", { method: "POST" })).status).toBe(204);
    const store = new TaskStore({ dbPath });
    expect(store.get("done-1")!.readAt).toBeDefined();
    store.close();
    expect((await api("/api/tasks/sched-abs/read", { method: "POST" })).status).toBe(409);
    expect((await api("/api/tasks/done-1/unread", { method: "POST" })).status).toBe(204);
  });

  async function nextTasksEvent(trigger: () => void | Promise<void>): Promise<string> {
    const res = await api("/api/events");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    // Wait for the hello event, so the subscription exists before the change.
    while (!buf.includes("event: hello")) buf += decoder.decode((await reader.read()).value);
    await trigger();
    const deadline = Date.now() + 3_000;
    while (!buf.includes("event: tasks") && Date.now() < deadline) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value);
    }
    await reader.cancel();
    return buf;
  }

  it("streams a tasks event when another connection completes a task", async () => {
    const buf = await nextTasksEvent(() => {
      const other = new TaskStore({ dbPath });
      const rec = other.get("sched-abs")!;
      other.upsert({ ...rec, status: "completed", completedAt: new Date().toISOString(), result: { text: "x" } });
      other.close();
    });
    expect(buf).toMatch(/event: tasks\ndata: \{"ids":\["sched-abs"\]\}/);
  });

  it("streams a tasks event after its own mark-read", async () => {
    const buf = await nextTasksEvent(async () => {
      await api("/api/tasks/done-1/read", { method: "POST" });
    });
    expect(buf).toContain('"ids":["done-1"]');
  });

  it("reports daemon status, last tick and quota labels (AE7)", async () => {
    const body = (await (await api("/api/status")).json()) as Record<string, unknown>;
    expect(body.daemon).toBe("not_installed");
    expect(body).toHaveProperty("last_tick_at", null);
    expect(daemonStatus({ platform: "win32" })).toBe("unknown");
    expect(daemonStatus({ platform: "darwin", home: dir, exists: () => false })).toBe("not_installed");
    expect(daemonStatus({ platform: "linux", home: dir, exists: () => true })).toBe("installed");
  });

  it("serves a capped forecast", async () => {
    const body = (await (await api("/api/forecast?region=FR&hours=500")).json()) as { points: unknown[] };
    expect(body.points.length).toBeLessThanOrEqual(72);
    expect(body.points.length).toBeGreaterThan(0);
    expect((await api("/api/forecast?region=../x")).status).toBe(400);
  });

  it("serves only the fixed static map, with the CSP header", async () => {
    const page = await fetch(ui.url);
    expect(page.status).toBe(200);
    expect(page.headers.get("content-security-policy")).toContain("default-src 'self'");
    expect(page.headers.get("x-content-type-options")).toBe("nosniff");
    expect(page.headers.get("access-control-allow-origin")).toBeNull();
    for (const path of ["/..%2f..%2fpackage.json", "/%2e%2e/%2e%2e/package.json", "/package.json", "/src/index.ts"]) {
      const r = await new Promise<number>((resolve, reject) => {
        const req = request({ host: "127.0.0.1", port: ui.port, path }, (res) => {
          res.resume();
          resolve(res.statusCode ?? 0);
        });
        req.on("error", reject);
        req.end();
      });
      expect([path, r]).toEqual([path, 404]);
    }
  });
});

describe("ebb ui assets", () => {
  const dir = join(__dirname, "..", "ui");
  const read = (f: string) => readFileSync(join(dir, f), "utf8");

  it("index.html references only relative asset paths", () => {
    const html = read("index.html");
    const refs = [...html.matchAll(/(?:src|href)="([^"]+)"/g)].map((m) => m[1]!);
    expect(refs.length).toBeGreaterThan(0);
    for (const ref of refs) expect(ref).toMatch(/^(#|data:,$|[a-z]+\.(js|css)$)/);
    expect(html).not.toMatch(/https?:\/\//);
  });

  it("app.js loads nothing remote and never writes HTML from data", () => {
    const js = read("app.js");
    // The SVG namespace URI is an identifier, not a request.
    expect(js.replaceAll("http://www.w3.org/2000/svg", "")).not.toMatch(/https?:\/\//);
    expect(js).not.toMatch(/innerHTML|outerHTML|insertAdjacentHTML|document\.write|\beval\(|new Function/);
  });

  it("app.css loads no web font or remote resource", () => {
    const css = read("app.css");
    expect(css).not.toMatch(/@import|@font-face|url\(/);
  });

  it("the real asset directory is served", async () => {
    const tmp = mkdtempSync(join(tmpdir(), "ebb-ui-assets-"));
    const ui = await startUiServer({
      token: TOKEN,
      dbPath: join(tmp, "queue.db"),
      feed: mockGridFeed(),
      defaultRegion: "FR",
      quota: () => ({}),
      daemonStatus: () => "unknown",
    });
    try {
      for (const [path, type] of [["/", "text/html"], ["/app.js", "text/javascript"], ["/app.css", "text/css"]] as const) {
        const res = await fetch(`${ui.url.replace(/\/$/, "")}${path}`);
        expect(res.status).toBe(200);
        expect(res.headers.get("content-type")).toContain(type);
      }
    } finally {
      await ui.close();
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
