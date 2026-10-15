/**
 * `ebb ui` HTTP server (KTD8, KTD9). Loopback only. Writes by POST, never
 * dispatches: actions go through a Scheduler with no adapters, and the
 * dispatcher (`ebb tick` or the OpenClaw loop) runs the task.
 *
 * Security model:
 *   - binds 127.0.0.1 only; there is no host option;
 *   - every `/api/*` request (JSON and SSE) needs `Authorization: Bearer
 *     <token>`; the token is random per run and compared in constant time;
 *   - a `Host` header whose name is not 127.0.0.1, localhost or [::1] (with
 *     no port or this server's port) gets 403, which blocks DNS-rebinding
 *     pages; an `Origin` header, when sent, must name the same loopback
 *     host, so a page on another origin gets 403 too;
 *   - no CORS headers, so other origins cannot read responses;
 *   - static files come from a fixed map; no request path touches the disk;
 *   - every write is a POST with the bearer header; routes that read a body
 *     (cancel, reschedule, reply) need `Content-Type: application/json`
 *     (415 otherwise: a cross-site form cannot send it without a preflight,
 *     which gets no CORS answer) and at most 64 KiB (413); body-less routes
 *     (read, unread, run-now, dispatcher/start) refuse a non-empty body
 *     (400); bodies are strict JSON objects. No cookie is ever set.
 * The static page holds no data; it reads the token from the URL fragment,
 * which browsers never send to the server.
 */

import { createHash, timingSafeEqual } from "node:crypto";
import { readFileSync } from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { TaskStore } from "@ebb-ai/core";

import { resolveLauncher } from "../commands/install.js";
import { actionScheduler } from "../commands/queue.js";
import { handleApi, postBodyKind, type ApiContext } from "./api.js";
import { DispatcherControl, type Spawner } from "./dispatcher.js";
import { TaskEvents } from "./events.js";

/** Largest POST body read, in bytes. */
export const MAX_BODY_BYTES = 64 * 1024;

export const LOOPBACK = "127.0.0.1";

const SECURITY_HEADERS: Record<string, string> = {
  "content-security-policy":
    "default-src 'self'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
  "cache-control": "no-store",
};

const STATIC_FILES: Record<string, { file: string; type: string }> = {
  "/": { file: "index.html", type: "text/html; charset=utf-8" },
  "/app.js": { file: "app.js", type: "text/javascript; charset=utf-8" },
  "/app.css": { file: "app.css", type: "text/css; charset=utf-8" },
};

/** `packages/cli/ui`, from both `src/ui` (tests) and `dist/ui` (published). */
export function defaultAssetDir(): string {
  return join(dirname(fileURLToPath(import.meta.url)), "..", "..", "ui");
}

export interface UiServerOptions
  extends Omit<ApiContext, "store" | "dispatcher"> {
  token: string;
  /** `ebb` launcher for Start dispatcher; default: the install step's. */
  launcher?: string[];
  /** Inject the dispatcher spawner, liveness probe and log dir (tests). */
  spawn?: Spawner;
  isAlive?: (pid: number) => boolean;
  logDir?: string;
  /** 0 (default) picks a free port. */
  port?: number;
  assetDir?: string;
  /** data_version poll interval for the change stream. */
  pollMs?: number;
}

export interface UiServer {
  port: number;
  address: string;
  url: string;
  server: Server;
  events: TaskEvents;
  close(): Promise<void>;
}

function digest(s: string): Buffer {
  return createHash("sha256").update(s).digest();
}

const LOOPBACK_NAMES = new Set([LOOPBACK, "localhost", "[::1]"]);

/**
 * True when `host` (a Host header, or the host part of an Origin) names a
 * loopback address with no port or with `port`. Anything else, including a
 * DNS name that resolves to 127.0.0.1, is refused.
 */
export function isLoopbackHost(host: string, port: number): boolean {
  const m = /^(\[::1\]|[^:]+)(?::(\d+))?$/.exec(host.trim().toLowerCase());
  if (!m || !LOOPBACK_NAMES.has(m[1]!)) return false;
  return m[2] === undefined || Number(m[2]) === port;
}

function send(res: ServerResponse, status: number, body?: unknown, type = "application/json; charset=utf-8"): void {
  res.writeHead(status, { ...SECURITY_HEADERS, ...(body === undefined ? {} : { "content-type": type }) });
  if (body === undefined) res.end();
  else res.end(typeof body === "string" || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}

/** Read a request body, keeping at most `max + 1` bytes; `null` when over `max`. */
function readBody(req: IncomingMessage, max: number): Promise<Buffer | null> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      // Keep draining past the cap so the client can read the 413.
      if (size <= max) chunks.push(chunk);
    });
    req.on("end", () => resolve(size > max ? null : Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

type BodyCheck = { ok: true; body: Record<string, unknown> } | { ok: false; status: number; error: string };

/** KTD9 body rules for one POST route. */
async function checkBody(req: IncomingMessage, kind: "json" | "none"): Promise<BodyCheck> {
  if (kind === "json") {
    const type = (req.headers["content-type"] ?? "").split(";")[0]!.trim().toLowerCase();
    if (type !== "application/json") {
      return { ok: false, status: 415, error: "content-type must be application/json" };
    }
  }
  const raw = await readBody(req, MAX_BODY_BYTES);
  if (raw === null) return { ok: false, status: 413, error: "body too large" };
  if (kind === "none") {
    return raw.length === 0 ? { ok: true, body: {} } : { ok: false, status: 400, error: "this route takes no body" };
  }
  if (raw.length === 0) return { ok: true, body: {} };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.toString("utf8"));
  } catch {
    return { ok: false, status: 400, error: "body is not JSON" };
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { ok: false, status: 400, error: "body must be a JSON object" };
  }
  return { ok: true, body: parsed as Record<string, unknown> };
}

export async function startUiServer(opts: UiServerOptions): Promise<UiServer> {
  const store = new TaskStore({ dbPath: opts.dbPath });
  const events = new TaskEvents(store, opts.pollMs);
  // Writes go through a Scheduler built WITHOUT adapters (KTD8): it can
  // cancel, move, mark run-now and enqueue a reply, never dispatch.
  const ownScheduler = opts.scheduler === undefined;
  const scheduler =
    opts.scheduler ??
    actionScheduler({ dbPath: opts.dbPath, feed: opts.feed, region: opts.defaultRegion });
  const dispatcher = new DispatcherControl(store, {
    launcher: opts.launcher ?? resolveLauncher(undefined, []),
    dbPath: opts.dbPath,
    daemonStatus: opts.daemonStatus,
    ...(opts.spawn ? { spawn: opts.spawn } : {}),
    ...(opts.isAlive ? { isAlive: opts.isAlive } : {}),
    ...(opts.logDir ? { logDir: opts.logDir } : {}),
    ...(opts.now ? { now: opts.now } : {}),
  });
  const ctx: ApiContext = { ...opts, store, scheduler, dispatcher };
  const assetDir = opts.assetDir ?? defaultAssetDir();
  const tokenDigest = digest(opts.token);
  let port = 0;

  const authorized = (req: IncomingMessage): boolean => {
    const h = req.headers.authorization ?? "";
    const m = /^Bearer (.+)$/.exec(h);
    return !!m && timingSafeEqual(digest(m[1]!), tokenDigest);
  };

  const hostAllowed = (req: IncomingMessage): boolean => {
    if (!isLoopbackHost(req.headers.host ?? "", port)) return false;
    const origin = req.headers.origin;
    if (origin === undefined) return true;
    const m = /^http:\/\/([^/]+)$/i.exec(origin);
    return !!m && isLoopbackHost(m[1]!, port);
  };

  const openStream = (req: IncomingMessage, res: ServerResponse): void => {
    res.writeHead(200, {
      ...SECURITY_HEADERS,
      "content-type": "text/event-stream; charset=utf-8",
      connection: "keep-alive",
    });
    res.write(`event: hello\ndata: {}\n\n`);
    const unsubscribe = events.subscribe((ids) => {
      res.write(`event: tasks\ndata: ${JSON.stringify({ ids })}\n\n`);
    });
    const keepAlive = setInterval(() => res.write(`: keep-alive\n\n`), 15_000);
    keepAlive.unref();
    req.on("close", () => {
      clearInterval(keepAlive);
      unsubscribe();
    });
  };

  const server = createServer((req, res) => {
    void (async () => {
      if (!hostAllowed(req)) return send(res, 403, { error: "forbidden host" });
      const url = new URL(req.url ?? "/", `http://${LOOPBACK}`);
      const method = req.method ?? "GET";
      if (url.pathname === "/api" || url.pathname.startsWith("/api/")) {
        if (!authorized(req)) return send(res, 401, { error: "unauthorized" });
        if (url.pathname === "/api/events") {
          return method === "GET" ? openStream(req, res) : send(res, 405, { error: "method not allowed" });
        }
        let body: Record<string, unknown> = {};
        const kind = method === "POST" ? postBodyKind(url.pathname) : undefined;
        if (kind) {
          const checked = await checkBody(req, kind);
          if (!checked.ok) return send(res, checked.status, { error: checked.error });
          body = checked.body;
        }
        const out = await handleApi(ctx, method, url.pathname, url.searchParams, body);
        if (out.changedIds) events.emit(out.changedIds);
        return send(res, out.status, out.body);
      }
      const asset = STATIC_FILES[url.pathname];
      if (!asset) return send(res, 404, "not found", "text/plain; charset=utf-8");
      if (method !== "GET" && method !== "HEAD") return send(res, 405, "method not allowed", "text/plain; charset=utf-8");
      try {
        return send(res, 200, readFileSync(join(assetDir, asset.file)), asset.type);
      } catch {
        return send(res, 404, "not found", "text/plain; charset=utf-8");
      }
    })().catch(() => {
      // No error text in the response: it can carry paths or provider detail.
      if (!res.headersSent) send(res, 500, { error: "internal error" });
      else res.end();
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(opts.port ?? 0, LOOPBACK, () => resolve());
  });
  const addr = server.address() as AddressInfo;
  port = addr.port;
  events.start();

  return {
    port,
    address: addr.address,
    url: `http://${LOOPBACK}:${port}/`,
    server,
    events,
    close: async () => {
      events.stop();
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      if (ownScheduler) scheduler.shutdown();
      store.close();
    },
  };
}
