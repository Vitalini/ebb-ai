/**
 * Host side of the claude-code provider: find the `claude` binary, build
 * the child environment, and parse the budget cap. `tidegap tick` uses
 * these to construct {@link ClaudeCodeAdapter}.
 */

import { spawnSync } from "node:child_process";
import { accessSync, constants, statSync } from "node:fs";
import { homedir, platform as osPlatform } from "node:os";
import { delimiter, isAbsolute, join } from "node:path";
import { underTest, type EnvCredentials } from "./env.js";

/** Lookup inputs. Tests inject them; production uses the real machine. */
export interface ClaudeLookup {
  /** The `PATH` to search. */
  path?: string;
  home?: string;
  platform?: NodeJS.Platform;
  isExecutable?: (path: string) => boolean;
  /** macOS login-shell lookup: the path `command -v claude` prints, or undefined. */
  loginShell?: () => string | undefined;
}

const LOGIN_SHELL_TIMEOUT_MS = 5_000;
const MARKER = "__TIDEGAP_CLAUDE__";

function isExecutableFile(path: string): boolean {
  try {
    if (!statSync(path).isFile()) return false;
    accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/** The same lookup as the Mac app's `ServerLauncher.queryLoginShell`. */
function queryLoginShell(): string | undefined {
  const out = spawnSync("/bin/zsh", ["-ilc", `printf '${MARKER}%s\\n' "$(command -v claude)"`], {
    encoding: "utf8",
    timeout: LOGIN_SHELL_TIMEOUT_MS,
    stdio: ["ignore", "pipe", "ignore"],
  });
  const line = (out.stdout ?? "").split("\n").reverse().find((l) => l.startsWith(MARKER));
  const value = line?.slice(MARKER.length).trim();
  return value ? value : undefined;
}

/** Steps 2-4 of the lookup: PATH, known locations, the macOS login shell. */
function searchMachine(lookup: Required<ClaudeLookup>, needsClaude: () => boolean): string | undefined {
  const { home, isExecutable } = lookup;
  const candidates = [
    ...(lookup.path ?? "").split(delimiter).filter(Boolean).map((dir) => join(dir, "claude")),
    join(home, ".local", "bin", "claude"),
    join(home, ".claude", "local", "claude"),
    "/opt/homebrew/bin/claude",
    "/usr/local/bin/claude",
  ];
  const hit = candidates.find((p) => isExecutable(p));
  if (hit) return hit;
  // The login shell sources the user's interactive zsh config, so it runs
  // only when a pending task actually needs Claude Code.
  if (lookup.platform !== "darwin" || !needsClaude()) return undefined;
  const fromShell = lookup.loginShell();
  return fromShell && isAbsolute(fromShell) && isExecutable(fromShell) ? fromShell : undefined;
}

let cachedHit: string | undefined;

/**
 * The `claude` binary for the claude-code adapter, or undefined.
 *
 * Order: `TIDEGAP_CLAUDE_BIN`, then each `PATH` directory, then the known
 * install locations, then (macOS only, and only when `needsClaude()` says a
 * pending task needs it) the login shell. `TIDEGAP_CLAUDE_CODE=0` turns the
 * lookup off. A hit is cached for the process. Under a test runner nothing
 * is looked up unless the test injects `lookup`, so no test finds the
 * developer's real `claude`.
 */
export function findClaudeBinary(
  env: Pick<EnvCredentials, "claudeBin" | "claudeCodeDisabled">,
  needsClaude: () => boolean,
  lookup?: ClaudeLookup,
): string | undefined {
  if (env.claudeCodeDisabled) return undefined;
  if (!lookup && underTest()) return undefined;
  if (env.claudeBin) return env.claudeBin;
  if (!lookup && cachedHit) return cachedHit;
  const found = searchMachine(
    {
      path: process.env.PATH ?? "",
      home: homedir(),
      platform: osPlatform(),
      isExecutable: isExecutableFile,
      loginShell: queryLoginShell,
      ...lookup,
    },
    needsClaude,
  );
  if (!lookup) cachedHit = found;
  return found;
}

/** Variables the child must not see: an API key would bypass the subscription login. */
const DROPPED_FOR_CHILD = ["ANTHROPIC_API_KEY", "CLAUDECODE", "CLAUDE_CODE_ENTRYPOINT"];

/** A copy of `source` for the `claude` child process, without the dropped variables. */
export function claudeChildEnv(
  source: Record<string, string | undefined> = process.env,
): Record<string, string | undefined> {
  const out = { ...source };
  for (const key of DROPPED_FOR_CHILD) delete out[key];
  return out;
}

export const DEFAULT_MAX_BUDGET_USD = 1;

/** Parse `TIDEGAP_CLAUDE_CODE_MAX_BUDGET_USD`; an invalid value falls back to the default with a warning. */
export function claudeMaxBudget(raw: string | undefined): { usd: number; warning?: string } {
  if (raw === undefined) return { usd: DEFAULT_MAX_BUDGET_USD };
  const n = Number(raw);
  if (Number.isFinite(n) && n > 0) return { usd: n };
  return {
    usd: DEFAULT_MAX_BUDGET_USD,
    warning: `!! WARNING: TIDEGAP_CLAUDE_CODE_MAX_BUDGET_USD=${JSON.stringify(raw)} is not a positive number; using ${DEFAULT_MAX_BUDGET_USD}.`,
  };
}
