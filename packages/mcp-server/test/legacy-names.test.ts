/**
 * 0.17 compatibility on the MCP host (plan U2): EBB_* fallback, and a server
 * started with only EBB_DB_PATH keeps stdout for the protocol. The stdio
 * case runs the built server (`pnpm build` first).
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

describe("EBB_* fallback (MCP)", () => {
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

  it("only EBB_ names: values, and one line naming them", () => {
    process.env.EBB_DB_PATH = "/tmp/q.db";
    process.env.EBB_DEFAULT_REGION = "FR";
    const lines: string[] = [];
    const env = readEnvCredentials((l) => lines.push(l));
    expect(env.dbPath).toBe("/tmp/q.db");
    expect(env.defaultRegion).toBe("FR");
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("EBB_DB_PATH -> TIDEGAP_DB_PATH");
    expect(lines[0]).toContain("EBB_DEFAULT_REGION -> TIDEGAP_DEFAULT_REGION");
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

  it("uses that path, warns on stderr, and writes only JSON-RPC to stdout", async () => {
    const dbPath = join(dir, "legacy.db");
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
    expect(stderr).toContain("EBB_DB_PATH -> TIDEGAP_DB_PATH");
    expect(stderr).toContain(`db=${dbPath}`);
    expect(existsSync(dbPath)).toBe(true);
  }, 20_000);
});
