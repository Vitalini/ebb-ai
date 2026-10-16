/**
 * The 0.18 `ebb` bin alias (KTD2): both bins point at one file, and the
 * program prints one deprecation line on stderr only when started as `ebb`.
 * Runs the built entry (`pnpm build` first) through real symlinks, the way
 * npm links a global install.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const cliRoot = resolve(here, "..");
const entry = join(cliRoot, "dist", "index.js");

function bins(pkgPath: string): Record<string, string> {
  return (JSON.parse(readFileSync(pkgPath, "utf8")) as { bin: Record<string, string> }).bin;
}

describe("bin entries", () => {
  it("@tidegap/cli bins tidegap and ebb point at the same file", () => {
    const b = bins(join(cliRoot, "package.json"));
    expect(Object.keys(b).sort()).toEqual(["ebb", "tidegap"]);
    expect(b.ebb).toBe(b.tidegap);
  });

  it("@tidegap/mcp bins tidegap-mcp and ebb-mcp point at the same file", () => {
    const b = bins(resolve(cliRoot, "..", "mcp-server", "package.json"));
    expect(Object.keys(b).sort()).toEqual(["ebb-mcp", "tidegap-mcp"]);
    expect(b["ebb-mcp"]).toBe(b["tidegap-mcp"]);
  });
});

describe("ebb alias at run time", () => {
  let dir: string;
  beforeAll(() => {
    if (!existsSync(entry)) throw new Error(`build the CLI first: ${entry} is missing`);
    dir = mkdtempSync(join(tmpdir(), "tidegap-bin-alias-"));
    symlinkSync(entry, join(dir, "ebb"));
    symlinkSync(entry, join(dir, "tidegap"));
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  const run = (name: string) =>
    spawnSync(process.execPath, [join(dir, name), "--version"], { encoding: "utf8" });

  it("as `ebb`: one stderr line naming tidegap, normal stdout", () => {
    const r = run("ebb");
    expect(r.status).toBe(0);
    const lines = r.stderr.split("\n").filter((l) => l.trim() !== "");
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("tidegap");
    expect(r.stdout.trim()).toMatch(/^\d+\.\d+\.\d+/);
  });

  it("as `tidegap`: no deprecation line", () => {
    const r = run("tidegap");
    expect(r.status).toBe(0);
    expect(r.stderr).toBe("");
    expect(r.stdout.trim()).toMatch(/^\d+\.\d+\.\d+/);
  });
});
