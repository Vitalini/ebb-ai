/**
 * The Tidegap data directory, `~/.tidegap`.
 *
 * 0.17 kept its state (queue.db, signing.key, config, delivery.db, logs) in
 * `~/.ebb-ai`. 0.18 moved it to `~/.tidegap` on first use and left a link
 * back. 0.19 removed that move: a real `~/.ebb-ai` directory is never read.
 * When one is found, the process prints one stderr line naming it, so a 0.17
 * install that skipped 0.18 does not silently start an empty ledger. A
 * `~/.ebb-ai` link left behind by 0.18 is ignored without a line.
 *
 * Environment-pure: the home directory comes from `os.homedir()`, never from
 * an environment variable. The Python core mirrors this in
 * `tidegap/paths.py`.
 */

import { lstatSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/** Name of the data directory under the home directory. */
export const TIDEGAP_HOME_DIR = ".tidegap";

/** The 0.17 directory name; only checked to print the notice. */
const OLD_HOME_DIR = ".ebb-ai";

export interface ResolveHomeOptions {
  /** Home directory; default `os.homedir()`. */
  home?: string;
  /** Where the one-line notice goes; default stderr, once per process. */
  warn?: (line: string) => void;
}

/** Homes already checked for a 0.17 directory, so each process warns once. */
const checked = new Set<string>();

function defaultWarn(line: string): void {
  // stderr only: on the MCP server stdout is the protocol channel.
  process.stderr.write(`${line}\n`);
}

function isRealDir(path: string): boolean {
  try {
    const st = lstatSync(path);
    return st.isDirectory() && !st.isSymbolicLink();
  } catch {
    return false;
  }
}

/**
 * The Tidegap data directory (`~/.tidegap`). Creates nothing. Prints one line
 * when a 0.17 `~/.ebb-ai` directory is still there (once per process and
 * home, unless `opts.warn` is given).
 */
export function resolveTidegapHome(opts: ResolveHomeOptions = {}): string {
  const home = opts.home ?? homedir();
  const target = join(home, TIDEGAP_HOME_DIR);
  if (opts.warn === undefined) {
    if (checked.has(home)) return target;
    checked.add(home);
  }
  const old = join(home, OLD_HOME_DIR);
  if (isRealDir(old)) {
    (opts.warn ?? defaultWarn)(
      `tidegap: ${old} is no longer read (removed in 0.19); tidegap uses ${target}. ` +
        `Upgrade through 0.18 once, or move its contents to ${target} by hand.`,
    );
  }
  return target;
}

/** A path inside the Tidegap data directory, e.g. `tidegapPath("queue.db")`. */
export function tidegapPath(...segments: string[]): string {
  return join(resolveTidegapHome(), ...segments);
}
