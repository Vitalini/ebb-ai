/**
 * `ebb ui` — serve the local task page (timeline, inbox, task detail) on
 * 127.0.0.1 with a per-run bearer token. Read-only: the page never
 * dispatches or cancels; only `ebb tick` dispatches.
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
  const server = await startUiServer({
    token,
    port: opts.port ?? 0,
    dbPath: opts.db ?? defaultDbPath(),
    feed: buildDefaultGridFeed(env.grid),
    defaultRegion: resolveRegion(undefined, opts.region).region,
    quota: () => loadQuotaResetConfig(),
    daemonStatus: () => daemonStatus(),
  });
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
