/**
 * `ebb ui` — serve the local task page (timeline, inbox, task detail) on
 * 127.0.0.1 with a per-run bearer token. The page can cancel, reschedule,
 * run now and reply (ui v2): each action writes the ledger through a
 * Scheduler with no adapters. It never dispatches; `ebb tick` (or the
 * OpenClaw loop) does, and the page can start `ebb tick --daemon` when no
 * dispatcher is running.
 */

import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";

import {
  buildDefaultGridFeed,
  loadQuotaResetConfig,
  resolveRegion,
} from "@ebb-ai/core";

import { readEnvCredentials } from "../env.js";
import { daemonStatus } from "../platform/index.js";
import { startUiServer, type UiServer } from "../ui/server.js";
import { loadEnvFileIntoProcess } from "./env-file.js";
import { resolveLauncher } from "./install.js";
import { actionScheduler } from "./queue.js";
import { defaultDbPath } from "./tick.js";

export interface UiCommandOptions {
  db?: string;
  port?: number;
  /** `false` (`--no-open`) only prints the URL. */
  open?: boolean;
  region?: string;
}

/** Open a URL in the default browser; failure is silent (the URL is printed). */
export function openBrowser(url: string, platform: NodeJS.Platform = process.platform): void {
  const [cmd, args] =
    platform === "darwin"
      ? ["open", [url]]
      : platform === "win32"
        ? ["cmd", ["/c", "start", "", url]]
        : ["xdg-open", [url]];
  try {
    const child = spawn(cmd, args as string[], { stdio: "ignore", detached: true });
    child.on("error", () => {});
    child.unref();
  } catch {
    // ignore: the URL is on the terminal
  }
}

export function newToken(): string {
  return randomBytes(32).toString("base64url");
}

export async function startUi(opts: UiCommandOptions = {}): Promise<{ server: UiServer; link: string }> {
  // Grid-feed credentials live in the same secrets file the tick reads.
  loadEnvFileIntoProcess();
  const env = readEnvCredentials();
  const token = newToken();
  const dbPath = opts.db ?? defaultDbPath();
  const feed = buildDefaultGridFeed(env.grid);
  const defaultRegion = resolveRegion(undefined, opts.region).region;
  const scheduler = actionScheduler({ dbPath, feed, region: defaultRegion });
  const server = await startUiServer({
    token,
    port: opts.port ?? 0,
    dbPath,
    feed,
    defaultRegion,
    quota: () => loadQuotaResetConfig(),
    daemonStatus: () => daemonStatus(),
    // Writes only: this scheduler has no adapters and never dispatches.
    scheduler,
    // Start dispatcher spawns this same binary: `<launcher> tick --daemon`.
    launcher: resolveLauncher(undefined, []),
  });
  const close = server.close.bind(server);
  server.close = async () => {
    await close();
    scheduler.shutdown();
  };
  return { server, link: `${server.url}#token=${token}` };
}

export async function runUi(opts: UiCommandOptions = {}): Promise<number> {
  const { server, link } = await startUi(opts);
  // eslint-disable-next-line no-console
  console.log(
    `ebb ui: ${link}\n` +
      `Serving on 127.0.0.1 only. The link carries a one-run access token; ` +
      `do not share it. Press Ctrl-C to stop.`,
  );
  if (opts.open !== false) openBrowser(link);
  await new Promise<void>((resolve) => {
    const stop = () => resolve();
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
  });
  await server.close();
  return 0;
}
