/**
 * Shared secrets file: `~/.config/tidegap/env`.
 *
 * 0.17 kept it at `~/.config/ebb/env`. That file is read, never moved: a
 * 0.17 systemd unit still names it in `EnvironmentFile=`. `tidegap tick`
 * reads the new file, else the old one; `tidegap install` creates the new
 * file as a copy of the old one when only the old one exists.
 *
 * A single standardized location for provider API keys that works
 * uniformly across launchd, systemd, and manual cron:
 *
 *   - `tidegap install` creates it (0600) with a commented template if it
 *     does not already exist, so the user has one obvious place to drop
 *     `ANTHROPIC_API_KEY=…`.
 *   - `tidegap tick` loads it at startup into `process.env` for any key not
 *     already present — this covers launchd (which passes a bare
 *     environment) AND systemd (belt-and-braces with `EnvironmentFile=`)
 *     AND a hand-rolled crontab entry.
 *
 * The parser is intentionally tiny (no dotenv dependency): `KEY=VALUE`
 * lines, `#` comments, blank lines, optional surrounding quotes.
 */

import { copyFileSync, chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

/** Absolute path to the standardized secrets file. */
export function envFilePath(home: string = homedir()): string {
  return join(home, ".config", "tidegap", "env");
}

/** The 0.17 secrets file, read when the new one is absent (until 0.19). */
export function legacyEnvFilePath(home: string = homedir()): string {
  return join(home, ".config", "ebb", "env");
}

/** The secrets file to load: the new one, else the 0.17 one if present. */
export function resolveEnvFilePath(home: string = homedir()): string {
  const current = envFilePath(home);
  const legacy = legacyEnvFilePath(home);
  return !existsSync(current) && existsSync(legacy) ? legacy : current;
}

/** The commented template written when the file is first created. */
export function envFileTemplate(): string {
  return `# Tidegap secrets — KEY=VALUE per line. Loaded by \`tidegap tick\` at startup
# (and referenced by the systemd unit's EnvironmentFile=). This file is
# created 0600; keep it that way. Uncomment and fill the keys you use.
#
# Direct provider keys:
#ANTHROPIC_API_KEY=
#OPENAI_API_KEY=
#
# Per-region grid-data feed keys (only for the regions you schedule into):
#TIDEGAP_ELECTRICITY_MAPS_API_KEY=
#TIDEGAP_EIA_API_KEY=
#TIDEGAP_ENTSOE_SECURITY_TOKEN=
# WattTime marginal-emissions (US ISOs) — HTTP Basic login, takes
# precedence over EIA for the zones it covers. Username + password, not
# a single key:
#WATTTIME_USERNAME=
#WATTTIME_PASSWORD=
`;
}

/**
 * Parse `KEY=VALUE` lines. Ignores blank lines and `#` comments.
 * Strips one layer of surrounding single/double quotes from the value.
 */
export function parseEnvFile(contents: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const rawLine of contents.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    if (!key) continue;
    let value = line.slice(eq + 1).trim();
    if (
      value.length >= 2 &&
      ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'")))
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

/**
 * Load the env file into `process.env` for any key not already set.
 * Returns the keys that were applied. Missing file is a silent no-op.
 */
export function loadEnvFileIntoProcess(path: string = resolveEnvFilePath()): string[] {
  if (!existsSync(path)) return [];
  let parsed: Record<string, string>;
  try {
    parsed = parseEnvFile(readFileSync(path, "utf8"));
  } catch {
    return [];
  }
  const applied: string[] = [];
  for (const [k, v] of Object.entries(parsed)) {
    if (process.env[k] === undefined) {
      process.env[k] = v;
      applied.push(k);
    }
  }
  return applied;
}

export interface EnsureEnvFileResult {
  path: string;
  created: boolean;
  /** The 0.17 file the new one was copied from, when it was. */
  copiedFrom?: string;
}

/**
 * Create the secrets file (0600) if it does not already exist: a copy of the
 * 0.17 file `legacy` when that exists, else the commented template.
 * Idempotent: never overwrites an existing file, never touches `legacy`.
 */
export function ensureEnvFile(
  path: string = envFilePath(),
  legacy: string = legacyEnvFilePath(),
): EnsureEnvFileResult {
  if (existsSync(path)) return { path, created: false };
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  if (existsSync(legacy)) {
    copyFileSync(legacy, path);
    chmodSync(path, 0o600);
    return { path, created: true, copiedFrom: legacy };
  }
  writeFileSync(path, envFileTemplate(), { encoding: "utf8", mode: 0o600 });
  return { path, created: true };
}
