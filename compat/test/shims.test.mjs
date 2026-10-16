// Tests for the @ebb-ai/* 0.17.1 npm shims and the ebb-ai PyPI shim.
// Run after `pnpm build`: node --test compat/test/shims.test.mjs
//
// The shims are copied into a temp node_modules next to symlinks to the
// built workspace @tidegap/* packages, which is the layout npm produces.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const shims = join(repo, "compat", "npm");
let tmp;
let home;

before(() => {
  for (const p of ["core-ts/dist/index.js", "cli/dist/index.js", "mcp-server/dist/server.js"]) {
    assert.ok(existsSync(join(repo, "packages", p)), `run pnpm build first: packages/${p} is missing`);
  }
  tmp = mkdtempSync(join(tmpdir(), "tidegap-compat-"));
  home = join(tmp, "home");
  mkdirSync(home);
  const nm = join(tmp, "node_modules");
  mkdirSync(join(nm, "@tidegap"), { recursive: true });
  mkdirSync(join(nm, "@ebb-ai"), { recursive: true });
  symlinkSync(join(repo, "packages", "core-ts"), join(nm, "@tidegap", "core"), "dir");
  symlinkSync(join(repo, "packages", "cli"), join(nm, "@tidegap", "cli"), "dir");
  symlinkSync(join(repo, "packages", "mcp-server"), join(nm, "@tidegap", "mcp"), "dir");
  for (const name of ["core", "cli", "mcp"]) cpSync(join(shims, name), join(nm, "@ebb-ai", name), { recursive: true });
  mkdirSync(join(tmp, "bin"));
  symlinkSync(join(nm, "@ebb-ai", "cli", "dist", "index.js"), join(tmp, "bin", "ebb"));
});

after(() => rmSync(tmp, { recursive: true, force: true }));

const env = () => ({ PATH: process.env.PATH, HOME: home, USERPROFILE: home });
const lines = (s, needle) => s.split("\n").filter((l) => l.includes(needle));

function runNode(args, opts = {}) {
  return spawnSync(process.execPath, args, { cwd: tmp, env: env(), encoding: "utf8", ...opts });
}

test("@ebb-ai/core exposes the same exports as @tidegap/core and warns once", () => {
  const script = join(tmp, "core-check.mjs");
  writeFileSync(
    script,
    `const a = await import("@ebb-ai/core");
     await import("@ebb-ai/core");
     const g = await import("@ebb-ai/core/grid");
     const b = await import("@tidegap/core");
     const bg = await import("@tidegap/core/grid");
     console.log(JSON.stringify({
       same: JSON.stringify(Object.keys(a).sort()) === JSON.stringify(Object.keys(b).sort()),
       grid: JSON.stringify(Object.keys(g).sort()) === JSON.stringify(Object.keys(bg).sort()),
       count: Object.keys(a).length,
     }));`,
  );
  const r = runNode([script]);
  assert.equal(r.status, 0, r.stderr);
  const out = JSON.parse(r.stdout.trim());
  assert.equal(out.same, true);
  assert.equal(out.grid, true);
  assert.ok(out.count > 20);
  assert.equal(lines(r.stderr, "@ebb-ai/core is now @tidegap/core").length, 1);
});

test("@ebb-ai/cli bin `ebb queue list --help` exits 0 with one deprecation line", () => {
  const r = runNode([join(tmp, "bin", "ebb"), "queue", "list", "--help"]);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /Usage: tidegap queue list/);
  assert.equal(lines(r.stderr, "is now").length, 1);
  assert.equal(lines(r.stderr, "@ebb-ai/cli is now @tidegap/cli").length, 1);
});

test("the 0.17 daemon path dist/index.js runs `tick --help` with one deprecation line", () => {
  const r = runNode([join(tmp, "node_modules", "@ebb-ai", "cli", "dist", "index.js"), "tick", "--help"]);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /Drain due provider-call tasks/);
  assert.equal(lines(r.stderr, "is now").length, 1);
});

test("@ebb-ai/mcp bin answers initialize with serverInfo tidegap; stdout is JSON-RPC only", async () => {
  const child = spawn(process.execPath, [join(tmp, "node_modules", "@ebb-ai", "mcp", "bin.js")], {
    cwd: tmp,
    env: { ...env(), TIDEGAP_DB_PATH: ":memory:" },
    stdio: ["pipe", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (b) => (stdout += b));
  child.stderr.on("data", (b) => (stderr += b));
  child.stdin.write(
    JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "compat-test", version: "0" } },
    }) + "\n",
  );
  const deadline = Date.now() + 15_000;
  while (!stdout.includes("\n") && Date.now() < deadline) await new Promise((r) => setTimeout(r, 50));
  child.kill();
  const [first, ...rest] = stdout.split("\n").filter((l) => l.trim() !== "");
  const msg = JSON.parse(first);
  assert.equal(msg.result.serverInfo.name, "tidegap");
  for (const l of rest) JSON.parse(l);
  assert.equal(lines(stderr, "@ebb-ai/mcp is now @tidegap/mcp").length, 1);
});

test("ebb-ai PyPI shim: import ebb_ai.grid works and warns once", (t) => {
  const python = join(repo, "packages", "core-py", ".venv", "bin", "python");
  if (!existsSync(python)) {
    t.skip("packages/core-py/.venv is missing (see CONTRIBUTING: the Python dev install)");
    return;
  }
  const r = spawnSync(
    python,
    ["-c", "import ebb_ai.grid, ebb_ai, tidegap.grid; from ebb_ai.grid import *; assert ebb_ai.grid is tidegap.grid; assert ebb_ai.Scheduler is tidegap.Scheduler"],
    { env: { ...env(), PYTHONPATH: join(repo, "compat", "pypi", "ebb-ai", "src") }, encoding: "utf8" },
  );
  assert.equal(r.status, 0, r.stderr);
  assert.equal(lines(r.stderr, "ebb-ai is now tidegap").length, 1);
});
