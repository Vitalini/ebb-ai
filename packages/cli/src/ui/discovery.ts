/**
 * Discovery file for `tidegap ui` (native clients KTD4). While the server
 * runs, `<tidegap home>/ui.json` (mode 0600) names its pid and port so the
 * Mac app can find it without the user typing anything. It holds no token.
 * The file is removed on close only when it still names this process, so a
 * second server's file is never deleted by the first one.
 */

import { randomBytes } from "node:crypto";
import { chmodSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const DISCOVERY_FILE = "ui.json";

/** Default port of `tidegap ui`; clients look here first. */
export const DEFAULT_UI_PORT = 47821;

export interface UiDiscovery {
  version: 1;
  pid: number;
  port: number;
  url: string;
  started_at: string;
  cli_version: string;
}

export function discoveryPath(stateDir: string): string {
  return join(stateDir, DISCOVERY_FILE);
}

export function writeDiscovery(stateDir: string, info: Omit<UiDiscovery, "version">): void {
  mkdirSync(stateDir, { recursive: true, mode: 0o700 });
  const path = discoveryPath(stateDir);
  const tmp = `${path}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`;
  writeFileSync(tmp, `${JSON.stringify({ version: 1, ...info }, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  chmodSync(tmp, 0o600);
  renameSync(tmp, path);
}

/** The discovery record, or `undefined` when the file is missing or malformed. */
export function readDiscovery(stateDir: string): UiDiscovery | undefined {
  try {
    const d = JSON.parse(readFileSync(discoveryPath(stateDir), "utf8")) as Partial<UiDiscovery>;
    return d.version === 1 && Number.isInteger(d.pid) && Number.isInteger(d.port) ? (d as UiDiscovery) : undefined;
  } catch {
    return undefined;
  }
}

/** Remove the file when it names `pid`; leave another server's file alone. */
export function removeDiscovery(stateDir: string, pid: number = process.pid): void {
  if (readDiscovery(stateDir)?.pid !== pid) return;
  try {
    unlinkSync(discoveryPath(stateDir));
  } catch {
    // already gone
  }
}
