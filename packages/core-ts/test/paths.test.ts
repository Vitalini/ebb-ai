/**
 * Home-dir resolution since 0.19: always `~/.tidegap`. A 0.17 `~/.ebb-ai`
 * directory is never moved or read; it only earns one notice line.
 */
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { resolveTidegapHome } from "../src/paths.js";

let home: string;
let warnings: string[];
const warn = (line: string) => warnings.push(line);
const old = () => join(home, ".ebb-ai");
const target = () => join(home, ".tidegap");

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "tidegap-paths-"));
  warnings = [];
});
afterEach(() => rmSync(home, { recursive: true, force: true }));

describe("resolveTidegapHome", () => {
  it("neither dir exists: returns ~/.tidegap, creates nothing, no line", () => {
    expect(resolveTidegapHome({ home, warn })).toBe(target());
    expect(existsSync(target())).toBe(false);
    expect(warnings).toEqual([]);
  });

  it("a 0.17 ~/.ebb-ai dir is left in place and named in one line", () => {
    mkdirSync(old());
    writeFileSync(join(old(), "queue.db"), "Q");
    expect(resolveTidegapHome({ home, warn })).toBe(target());
    expect(existsSync(join(old(), "queue.db"))).toBe(true);
    expect(existsSync(target())).toBe(false);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain(old());
    expect(warnings[0]).toContain(`rename ${old()} to ${target()}`);
  });

  it("a user's own ~/.ebb-ai link to another directory is named with its target", () => {
    const elsewhere = join(home, "disk", "ebb-data");
    mkdirSync(elsewhere, { recursive: true });
    writeFileSync(join(elsewhere, "queue.db"), "Q");
    symlinkSync(elsewhere, old(), "dir");
    expect(resolveTidegapHome({ home, warn })).toBe(target());
    expect(existsSync(join(elsewhere, "queue.db"))).toBe(true);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain(`${old()} (a link to ${realpathSync(elsewhere)})`);
  });

  it("a dangling ~/.ebb-ai link is ignored without a line", () => {
    symlinkSync(join(home, "gone"), old(), "dir");
    expect(resolveTidegapHome({ home, warn })).toBe(target());
    expect(warnings).toEqual([]);
  });

  it("a ~/.ebb-ai link left by 0.18 is ignored without a line", () => {
    mkdirSync(target());
    symlinkSync(target(), old(), "dir");
    expect(resolveTidegapHome({ home, warn })).toBe(target());
    expect(warnings).toEqual([]);
  });

  it("the default writer reports once per process and home", () => {
    mkdirSync(old());
    const lines: string[] = [];
    const write = process.stderr.write.bind(process.stderr);
    process.stderr.write = ((chunk: string | Uint8Array) => {
      lines.push(String(chunk));
      return true;
    }) as typeof process.stderr.write;
    try {
      resolveTidegapHome({ home });
      resolveTidegapHome({ home });
    } finally {
      process.stderr.write = write;
    }
    expect(lines).toHaveLength(1);
  });
});
