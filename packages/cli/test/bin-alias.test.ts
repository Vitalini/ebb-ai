/**
 * 0.19 removed the 0.18 `ebb` and `ebb-mcp` bin aliases: each package ships
 * exactly one bin. Runs the built entry (`pnpm build` first) through a real
 * symlink, the way npm links a global install.
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
  it("@tidegap/cli ships only the tidegap bin", () => {
    expect(Object.keys(bins(join(cliRoot, "package.json")))).toEqual(["tidegap"]);
  });

  it("@tidegap/mcp ships only the tidegap-mcp bin", () => {
    const b = bins(resolve(cliRoot, "..", "mcp-server", "package.json"));
    expect(Object.keys(b)).toEqual(["tidegap-mcp"]);
  });
});

describe("entry started under another name", () => {
  let dir: string;
  beforeAll(() => {
    if (!existsSync(entry)) throw new Error(`build the CLI first: ${entry} is missing`);
    dir = mkdtempSync(join(tmpdir(), "tidegap-bin-alias-"));
    symlinkSync(entry, join(dir, "ebb"));
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it("a symlink named `ebb` prints no deprecation line", () => {
    const r = spawnSync(process.execPath, [join(dir, "ebb"), "--version"], { encoding: "utf8" });
    expect(r.status).toBe(0);
    expect(r.stderr).toBe("");
    expect(r.stdout.trim()).toMatch(/^\d+\.\d+\.\d+/);
  });
});
