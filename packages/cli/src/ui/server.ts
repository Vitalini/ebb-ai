/**
 * `ebb ui` HTTP server (KTD8, KTD9). Loopback only, read-only.
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
 *   - static files come from a fixed map; no request path touches the disk.
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

import { handleApi, type ApiContext } from "./api.js";
import { TaskEvents } from "./events.js";

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
  extends Omit<ApiContext, "store"> {
  token: string;
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

export async function startUiServer(opts: UiServerOptions): Promise<UiServer> {
  const store = new TaskStore({ dbPath: opts.dbPath });
  const events = new TaskEvents(store, opts.pollMs);
  const ctx: ApiContext = { ...opts, store };
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
        const out = await handleApi(ctx, method, url.pathname, url.searchParams);
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
      store.close();
    },
  };
}
