/**
 * The Tidegap data directory, `~/.tidegap`.
 *
 * 0.17 kept its state (queue.db, signing.key, config, delivery.db, logs) in
 * `~/.ebb-ai`. 0.18 moved it to `~/.tidegap` on first use and left a link
 * back. 0.19 removed that move: `~/.ebb-ai` is never read. When it still
 * holds data (a real directory, or a user's own link to a directory other
 * than `~/.tidegap`), the process prints one stderr line naming it, so a
 * 0.17 install that skipped 0.18 does not silently start an empty ledger. A
 * `~/.ebb-ai` link back to `~/.tidegap`, left by 0.18, is ignored without a
 * line.
 *
 * Environment-pure: the home directory comes from `os.homedir()`, never from
 * an environment variable. The Python core mirrors this in
 * `tidegap/paths.py`.
 */

import { lstatSync, realpathSync, statSync } from "node:fs";
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

/**
 * Where a 0.17 `~/.ebb-ai` still holds data: `old` itself when it is a real
 * directory, the directory it links to when that is not `target`, else
 * `undefined` (absent, a 0.18 link back to `target`, or a dangling link).
 * Node reports a Windows junction as a symbolic link.
 */
function oldHomeData(old: string, target: string): string | undefined {
  let points: string;
  try {
    const st = lstatSync(old);
    if (!st.isSymbolicLink()) return st.isDirectory() ? old : undefined;
    points = realpathSync(old);
    if (!statSync(points).isDirectory()) return undefined;
  } catch {
    return undefined;
  }
  try {
    if (realpathSync(target) === points) return undefined;
  } catch {
    // No ~/.tidegap yet: the link points somewhere else.
  }
  return points;
}

/**
 * The Tidegap data directory (`~/.tidegap`). Creates nothing. Prints one line
 * when a 0.17 `~/.ebb-ai` still holds data (once per process and home,
 * unless `opts.warn` is given).
 */
export function resolveTidegapHome(opts: ResolveHomeOptions = {}): string {
  const home = opts.home ?? homedir();
  const target = join(home, TIDEGAP_HOME_DIR);
  if (opts.warn === undefined) {
    if (checked.has(home)) return target;
    checked.add(home);
  }
  const old = join(home, OLD_HOME_DIR);
  const data = oldHomeData(old, target);
  if (data !== undefined) {
    const label = data === old ? old : `${old} (a link to ${data})`;
    (opts.warn ?? defaultWarn)(
      `tidegap: ${label} is no longer read (removed in 0.19); tidegap uses ${target}. ` +
        `To keep its data, stop tidegap (daemon and MCP hosts), move ${target} aside, then rename ${old} to ${target}. ` +
        `Otherwise move ${old} out of your home directory to hide this line.`,
    );
  }
  return target;
}

/** A path inside the Tidegap data directory, e.g. `tidegapPath("queue.db")`. */
export function tidegapPath(...segments: string[]): string {
  return join(resolveTidegapHome(), ...segments);
}
