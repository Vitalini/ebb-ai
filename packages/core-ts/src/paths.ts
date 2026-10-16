/**
 * The Tidegap data directory and the one-time move from the 0.17 name.
 *
 * 0.17 kept its state (queue.db, signing.key, config, delivery.db, logs) in
 * `~/.ebb-ai`. 0.18 uses `~/.tidegap`. The first 0.18 process that needs the
 * directory moves the old one and leaves `~/.ebb-ai` as a link to the new one,
 * so a 0.17 process (or a 0.17 daemon unit pinning `--db ~/.ebb-ai/queue.db`)
 * keeps reading and writing the same ledger.
 *
 * Rules, decided by the state of `~/.ebb-ai` (0.18 code may create
 * `~/.tidegap` first, for example the daemon log dir):
 *   - `~/.ebb-ai` absent, or already a link: use `~/.tidegap`.
 *   - `~/.ebb-ai` a real dir, `~/.tidegap` absent: rename, then link back.
 *   - `~/.ebb-ai` a real dir, `~/.tidegap` present without queue.db and
 *     signing.key: move each entry in (directories merge), remove the empty
 *     `~/.ebb-ai`, link back. A file present in both stops the move.
 *   - Both hold a queue.db or a signing.key: change nothing, use `~/.tidegap`.
 *   - The link cannot be made: move the data back, use `~/.ebb-ai` in place.
 *     Rename and link succeed or fail together, because SQLite refuses writes
 *     once an open path stops resolving to the same file.
 *   - A rename that loses a race (source gone, target appeared): re-check.
 *   - Any other rename failure: use `~/.ebb-ai` in place.
 * Nothing is ever deleted except the emptied `~/.ebb-ai` directory itself.
 *
 * Environment-pure: the home directory comes from `os.homedir()`, never from
 * an environment variable. The Python core mirrors these rules in
 * `tidegap/paths.py`.
 */

import * as nodeFs from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/** Name of the data directory under the home directory. */
export const TIDEGAP_HOME_DIR = ".tidegap";
/** The 0.17 name, kept as a link to {@link TIDEGAP_HOME_DIR} until 0.19. */
export const LEGACY_HOME_DIR = ".ebb-ai";

/** The filesystem calls the resolver makes; tests replace single calls. */
export interface HomeFs {
  lstatSync(path: string): nodeFs.Stats;
  readdirSync(path: string): string[];
  renameSync(from: string, to: string): void;
  rmdirSync(path: string): void;
  mkdirSync(path: string): void;
  symlinkSync(target: string, path: string, type?: "dir" | "junction"): void;
}

export interface ResolveHomeOptions {
  /** Home directory; default `os.homedir()`. */
  home?: string;
  /** Replace single filesystem calls (tests). */
  fs?: Partial<HomeFs>;
  /** Where the one-line notices go; default stderr. */
  warn?: (line: string) => void;
  /** Platform for the link type; default `process.platform`. */
  platform?: NodeJS.Platform;
}

const realFs: HomeFs = {
  lstatSync: (p) => nodeFs.lstatSync(p),
  readdirSync: (p) => nodeFs.readdirSync(p),
  renameSync: (a, b) => nodeFs.renameSync(a, b),
  rmdirSync: (p) => nodeFs.rmdirSync(p),
  mkdirSync: (p) => nodeFs.mkdirSync(p),
  symlinkSync: (t, p, type) => nodeFs.symlinkSync(t, p, type),
};

const DATA_FILES = ["queue.db", "signing.key"];
const RACE_CODES = new Set(["ENOENT", "EEXIST", "ENOTEMPTY"]);
const MAX_ATTEMPTS = 3;

/** Resolved home per home path, so each process migrates and warns once. */
const resolved = new Map<string, string>();

function errCode(err: unknown): string | undefined {
  return (err as NodeJS.ErrnoException | undefined)?.code;
}

function defaultWarn(line: string): void {
  // stderr only: on the MCP server stdout is the protocol channel.
  process.stderr.write(`${line}\n`);
}

/**
 * The Tidegap data directory (`~/.tidegap`), after moving a 0.17
 * `~/.ebb-ai` into it when needed. Returns `~/.ebb-ai` only when the move
 * could not be completed safely; callers then keep using the old directory.
 * Creates nothing when neither directory exists.
 */
export function resolveTidegapHome(opts: ResolveHomeOptions = {}): string {
  const home = opts.home ?? homedir();
  const cacheable = opts.fs === undefined && opts.warn === undefined;
  if (cacheable) {
    const hit = resolved.get(home);
    if (hit) return hit;
  }
  const fs: HomeFs = { ...realFs, ...opts.fs };
  const warn = opts.warn ?? defaultWarn;
  const platform = opts.platform ?? process.platform;
  const result = migrate(home, fs, warn, platform);
  if (cacheable) resolved.set(home, result);
  return result;
}

/** A path inside the Tidegap data directory, e.g. `tidegapPath("queue.db")`. */
export function tidegapPath(...segments: string[]): string {
  return join(resolveTidegapHome(), ...segments);
}

function lstat(fs: HomeFs, path: string): nodeFs.Stats | undefined {
  try {
    return fs.lstatSync(path);
  } catch {
    return undefined;
  }
}

function migrate(home: string, fs: HomeFs, warn: (l: string) => void, platform: NodeJS.Platform): string {
  const legacy = join(home, LEGACY_HOME_DIR);
  const target = join(home, TIDEGAP_HOME_DIR);
  const inPlace = (why: string): string => {
    warn(`tidegap: could not move ${legacy} to ${target} (${why}); using ${legacy} for now.`);
    return legacy;
  };
  const link = (): boolean => {
    try {
      fs.symlinkSync(target, legacy, platform === "win32" ? "junction" : "dir");
      return true;
    } catch {
      return false;
    }
  };

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const old = lstat(fs, legacy);
    if (!old || old.isSymbolicLink() || !old.isDirectory()) return target;

    if (!lstat(fs, target)) {
      try {
        fs.renameSync(legacy, target);
      } catch (err) {
        if (RACE_CODES.has(errCode(err) ?? "")) continue;
        return inPlace(errCode(err) ?? String(err));
      }
      if (link()) return target;
      try {
        fs.renameSync(target, legacy);
      } catch (err) {
        warn(`tidegap: moved ${legacy} to ${target} but could not link it back or undo the move (${errCode(err) ?? String(err)}).`);
        return target;
      }
      return inPlace("cannot create the link");
    }

    if (DATA_FILES.some((f) => lstat(fs, join(target, f)))) {
      warn(`tidegap: both ${legacy} and ${target} hold data; using ${target}. Move anything you need from ${legacy} by hand.`);
      return target;
    }

    const plan = planMerge(fs, legacy, target);
    if (typeof plan === "string") return inPlace(plan);
    const done: Array<[string, string]> = [];
    const undo = (): void => {
      for (const [from, to] of done.reverse()) {
        try {
          fs.renameSync(to, from);
        } catch {
          // Best effort; the warning below names both directories.
        }
      }
    };
    try {
      for (const [from, to] of plan) {
        fs.renameSync(from, to);
        done.push([from, to]);
      }
    } catch (err) {
      undo();
      if (RACE_CODES.has(errCode(err) ?? "")) continue;
      return inPlace(errCode(err) ?? String(err));
    }
    const emptied = emptyDirs(fs, legacy);
    try {
      for (const dir of emptied) fs.rmdirSync(dir);
    } catch (err) {
      // Something new appeared in ~/.ebb-ai meanwhile: put everything back.
      for (const dir of [...emptied].reverse()) {
        if (!lstat(fs, dir)) fs.mkdirSync(dir);
      }
      undo();
      return inPlace(errCode(err) ?? String(err));
    }
    if (link()) return target;
    for (const dir of [...emptied].reverse()) {
      if (!lstat(fs, dir)) fs.mkdirSync(dir);
    }
    undo();
    return inPlace("cannot create the link");
  }
  return inPlace("the directory kept changing");
}

/**
 * The renames that move every entry of `from` into `to`, merging directories
 * present in both. Returns a reason string when a non-directory exists on
 * both sides, so nothing would be overwritten.
 */
function planMerge(fs: HomeFs, from: string, to: string): Array<[string, string]> | string {
  const out: Array<[string, string]> = [];
  for (const name of fs.readdirSync(from)) {
    const src = join(from, name);
    const dst = join(to, name);
    const there = lstat(fs, dst);
    if (!there) {
      out.push([src, dst]);
      continue;
    }
    const here = lstat(fs, src);
    if (here?.isDirectory() && !here.isSymbolicLink() && there.isDirectory() && !there.isSymbolicLink()) {
      const inner = planMerge(fs, src, dst);
      if (typeof inner === "string") return inner;
      out.push(...inner);
      continue;
    }
    return `${name} exists in both`;
  }
  return out;
}

/** `dir` and the directories under it that a merge left empty, deepest first. */
function emptyDirs(fs: HomeFs, dir: string): string[] {
  const out: string[] = [];
  for (const name of fs.readdirSync(dir)) {
    const sub = join(dir, name);
    if (lstat(fs, sub)?.isDirectory()) out.push(...emptyDirs(fs, sub));
  }
  out.push(dir);
  return out;
}
