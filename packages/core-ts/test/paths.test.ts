/**
 * Home-dir resolution and the one-time `~/.ebb-ai` → `~/.tidegap` move
 * (plan KTD3). Real temp dirs for the normal branches; an fs seam for the
 * race and failure branches a real run cannot hit reliably.
 */
import * as fs from "node:fs";
import { lstatSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { TaskStore } from "../src/index.js";
import { resolveTidegapHome, type HomeFs } from "../src/paths.js";

let home: string;
let warnings: string[];
const warn = (line: string) => warnings.push(line);
const legacy = () => join(home, ".ebb-ai");
const target = () => join(home, ".tidegap");

function seedLegacy(files: Record<string, string>): void {
  mkdirSync(legacy(), { recursive: true });
  for (const [name, body] of Object.entries(files)) writeFileSync(join(legacy(), name), body);
}

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "tidegap-paths-"));
  warnings = [];
});
afterEach(() => rmSync(home, { recursive: true, force: true }));

describe("resolveTidegapHome", () => {
  it("neither dir exists: returns ~/.tidegap and creates nothing", () => {
    expect(resolveTidegapHome({ home, warn })).toBe(target());
    expect(fs.existsSync(target())).toBe(false);
    expect(fs.existsSync(legacy())).toBe(false);
    expect(warnings).toEqual([]);
  });

  it("only ~/.ebb-ai: moves everything and leaves a back-link", () => {
    seedLegacy({ "queue.db": "Q", "signing.key": "K", config: "C" });
    expect(resolveTidegapHome({ home, warn })).toBe(target());
    expect(readFileSync(join(target(), "queue.db"), "utf8")).toBe("Q");
    expect(readFileSync(join(target(), "signing.key"), "utf8")).toBe("K");
    expect(readFileSync(join(target(), "config"), "utf8")).toBe("C");
    expect(lstatSync(legacy()).isSymbolicLink()).toBe(true);
    expect(realpathSync(legacy())).toBe(realpathSync(target()));
    // A 0.17-style path still reads the migrated file through the link.
    expect(readFileSync(join(legacy(), "queue.db"), "utf8")).toBe("Q");
    expect(warnings).toEqual([]);
  });

  it("is idempotent: a second call changes nothing", () => {
    seedLegacy({ "queue.db": "Q" });
    resolveTidegapHome({ home, warn });
    const link = readlinkSync(legacy());
    expect(resolveTidegapHome({ home, warn })).toBe(target());
    expect(readlinkSync(legacy())).toBe(link);
    expect(warnings).toEqual([]);
  });

  it("~/.tidegap holds only logs/: the ledger and key move in, ~/.ebb-ai becomes a link", () => {
    seedLegacy({ "queue.db": "Q", "signing.key": "K" });
    mkdirSync(join(legacy(), "logs"));
    writeFileSync(join(legacy(), "logs", "ui-tick.log"), "old log");
    mkdirSync(join(target(), "logs"), { recursive: true });
    writeFileSync(join(target(), "logs", "tick.log"), "new log");
    expect(resolveTidegapHome({ home, warn })).toBe(target());
    expect(readFileSync(join(target(), "queue.db"), "utf8")).toBe("Q");
    expect(readFileSync(join(target(), "signing.key"), "utf8")).toBe("K");
    expect(readFileSync(join(target(), "logs", "ui-tick.log"), "utf8")).toBe("old log");
    expect(readFileSync(join(target(), "logs", "tick.log"), "utf8")).toBe("new log");
    expect(lstatSync(legacy()).isSymbolicLink()).toBe(true);
    expect(warnings).toEqual([]);
  });

  it("both hold a queue.db: nothing moves, ~/.tidegap wins, one warning names both", () => {
    seedLegacy({ "queue.db": "OLD" });
    mkdirSync(target());
    writeFileSync(join(target(), "queue.db"), "NEW");
    expect(resolveTidegapHome({ home, warn })).toBe(target());
    expect(readFileSync(join(legacy(), "queue.db"), "utf8")).toBe("OLD");
    expect(lstatSync(legacy()).isDirectory()).toBe(true);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain(legacy());
    expect(warnings[0]).toContain(target());
  });

  it("a file present in both dirs: nothing moves, ~/.ebb-ai is used in place", () => {
    seedLegacy({ "queue.db": "Q", config: "OLD" });
    mkdirSync(target());
    writeFileSync(join(target(), "config"), "NEW");
    expect(resolveTidegapHome({ home, warn })).toBe(legacy());
    expect(readFileSync(join(legacy(), "queue.db"), "utf8")).toBe("Q");
    expect(readFileSync(join(target(), "config"), "utf8")).toBe("NEW");
    expect(warnings).toHaveLength(1);
  });

  it("rename loses a race (EEXIST, another process won): re-checks, returns ~/.tidegap, no warning", () => {
    seedLegacy({ "queue.db": "Q" });
    const racing: Partial<HomeFs> = {
      renameSync: (from, to) => {
        // The other process moves and links first.
        fs.renameSync(from, to);
        fs.symlinkSync(to, from);
        const err = new Error("exists") as NodeJS.ErrnoException;
        err.code = "EEXIST";
        throw err;
      },
    };
    expect(resolveTidegapHome({ home, warn, fs: racing })).toBe(target());
    expect(warnings).toEqual([]);
  });

  it("rename fails with EPERM: returns ~/.ebb-ai with one warning", () => {
    seedLegacy({ "queue.db": "Q" });
    const denied: Partial<HomeFs> = {
      renameSync: () => {
        const err = new Error("denied") as NodeJS.ErrnoException;
        err.code = "EPERM";
        throw err;
      },
    };
    expect(resolveTidegapHome({ home, warn, fs: denied })).toBe(legacy());
    expect(readFileSync(join(legacy(), "queue.db"), "utf8")).toBe("Q");
    expect(warnings).toHaveLength(1);
  });

  it("back-link fails after the move: data goes back to ~/.ebb-ai, one warning", () => {
    seedLegacy({ "queue.db": "Q", "signing.key": "K" });
    const noLinks: Partial<HomeFs> = {
      symlinkSync: () => {
        const err = new Error("no links") as NodeJS.ErrnoException;
        err.code = "EPERM";
        throw err;
      },
    };
    expect(resolveTidegapHome({ home, warn, fs: noLinks })).toBe(legacy());
    expect(lstatSync(legacy()).isDirectory()).toBe(true);
    expect(readFileSync(join(legacy(), "queue.db"), "utf8")).toBe("Q");
    expect(readFileSync(join(legacy(), "signing.key"), "utf8")).toBe("K");
    expect(fs.existsSync(target())).toBe(false);
    expect(warnings).toHaveLength(1);
  });

  it("back-link fails after an entry-by-entry move: entries go back, ~/.tidegap keeps its own", () => {
    seedLegacy({ "queue.db": "Q" });
    mkdirSync(join(target(), "logs"), { recursive: true });
    const noLinks: Partial<HomeFs> = {
      symlinkSync: () => {
        throw Object.assign(new Error("no links"), { code: "EPERM" });
      },
    };
    expect(resolveTidegapHome({ home, warn, fs: noLinks })).toBe(legacy());
    expect(readFileSync(join(legacy(), "queue.db"), "utf8")).toBe("Q");
    expect(fs.existsSync(join(target(), "queue.db"))).toBe(false);
    expect(fs.existsSync(join(target(), "logs"))).toBe(true);
    expect(warnings).toHaveLength(1);
  });

  it("the queue opens with its rows after the move, from both paths", () => {
    mkdirSync(legacy());
    const before = new TaskStore({ dbPath: join(legacy(), "queue.db") });
    before.upsert({ taskId: "t1", status: "queued", enqueuedAt: "2026-10-16T00:00:00.000Z", region: "GB" });
    before.close();
    expect(resolveTidegapHome({ home, warn })).toBe(target());
    const after = new TaskStore({ dbPath: join(target(), "queue.db") });
    expect(after.get("t1")?.status).toBe("queued");
    after.close();
    const old = new TaskStore({ dbPath: join(legacy(), "queue.db") });
    expect(old.get("t1")?.status).toBe("queued");
    old.close();
  });
});
