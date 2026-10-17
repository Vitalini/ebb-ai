/**
 * Left-over 0.17 names on the MCP host since 0.19: an EBB_* variable is never
 * used and is named in one stderr line, and a server started with only
 * EBB_DB_PATH opens the default ledger and keeps stdout for the protocol.
 * The stdio case runs the built server (`pnpm build` first).
 */
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { readEnvCredentials } from "../src/env.js";

const SERVER = resolve(dirname(fileURLToPath(import.meta.url)), "..", "dist", "server.js");
const NAMES = ["DB_PATH", "DEFAULT_REGION", "DEFAULT_MODEL", "ENTSOE_SECURITY_TOKEN"] as const;

/** Run `fn` with stdout and stderr captured; returns what each received. */
function captureStreams(fn: () => void): { out: string[]; err: string[] } {
  const out: string[] = [];
  const err: string[] = [];
  const writeOut = process.stdout.write.bind(process.stdout);
  const writeErr = process.stderr.write.bind(process.stderr);
  process.stdout.write = ((c: string | Uint8Array) => (out.push(String(c)), true)) as typeof process.stdout.write;
  process.stderr.write = ((c: string | Uint8Array) => (err.push(String(c)), true)) as typeof process.stderr.write;
  try {
    fn();
  } finally {
    process.stdout.write = writeOut;
    process.stderr.write = writeErr;
  }
  return { out, err };
}

describe("left-over EBB_* names (MCP)", () => {
  const saved = new Map<string, string | undefined>();
  beforeEach(() => {
    for (const n of NAMES) {
      for (const key of [`TIDEGAP_${n}`, `EBB_${n}`]) {
        saved.set(key, process.env[key]);
        delete process.env[key];
      }
    }
  });
  afterEach(() => {
    for (const [key, value] of saved) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    saved.clear();
  });

  it("only EBB_ names: no values, and one line naming them", () => {
    process.env.EBB_DB_PATH = "/tmp/q.db";
    process.env.EBB_DEFAULT_REGION = "FR";
    const lines: string[] = [];
    const env = readEnvCredentials((l) => lines.push(l));
    expect(env.dbPath).toBeUndefined();
    expect(env.defaultRegion).toBeUndefined();
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("EBB_DB_PATH -> TIDEGAP_DB_PATH");
    expect(lines[0]).toContain("EBB_DEFAULT_REGION -> TIDEGAP_DEFAULT_REGION");
  });

  it("the default writer prints one stderr line per process and nothing on stdout", () => {
    process.env.EBB_DEFAULT_REGION = "FR";
    const { out, err } = captureStreams(() => {
      readEnvCredentials();
      readEnvCredentials();
    });
    expect(err).toHaveLength(1);
    expect(err[0]).toContain("EBB_DEFAULT_REGION -> TIDEGAP_DEFAULT_REGION");
    expect(out).toEqual([]);
  });

  it("both set: the TIDEGAP_ value and no line", () => {
    process.env.EBB_DEFAULT_MODEL = "old";
    process.env.TIDEGAP_DEFAULT_MODEL = "new";
    const lines: string[] = [];
    expect(readEnvCredentials((l) => lines.push(l)).defaultModel).toBe("new");
    expect(lines).toEqual([]);
  });
});

describe("stdio server with only EBB_DB_PATH", () => {
  let dir: string;
  beforeEach(() => {
    if (!existsSync(SERVER)) throw new Error(`build the MCP server first: ${SERVER} is missing`);
    dir = mkdtempSync(join(tmpdir(), "tidegap-mcp-legacy-"));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("opens the default ledger, names EBB_DB_PATH on stderr, and writes only JSON-RPC to stdout", async () => {
    const dbPath = join(dir, "legacy.db");
    const defaultDb = join(dir, ".tidegap", "queue.db");
    const env: NodeJS.ProcessEnv = { PATH: process.env.PATH, HOME: dir, EBB_DB_PATH: dbPath };
    const child = spawn(process.execPath, [SERVER], { env, stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (b: Buffer) => (stdout += b.toString()));
    child.stderr.on("data", (b: Buffer) => (stderr += b.toString()));
    child.stdin.write(
      `${JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "0" } },
      })}\n`,
    );
    const deadline = Date.now() + 15_000;
    while (!stdout.includes("\n") && Date.now() < deadline) await new Promise((r) => setTimeout(r, 50));
    child.kill();
    const first = stdout.split("\n")[0]!;
    const msg = JSON.parse(first) as { id: number; result: { serverInfo: { name: string } } };
    expect(msg.id).toBe(1);
    expect(msg.result.serverInfo.name).toBe("tidegap");
    expect(stderr).toContain("EBB_DB_PATH -> TIDEGAP_DB_PATH");
    expect(stderr).toContain(`db=${defaultDb}`);
    expect(existsSync(dbPath)).toBe(false);
  }, 20_000);
});
