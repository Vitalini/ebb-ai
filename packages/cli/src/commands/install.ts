/**
 * `tidegap install` — write a launchd plist (macOS) or systemd user units
 * (Linux). Windows is not auto-installed: it prints a ready-to-paste
 * `schtasks` command instead.
 *
 * The daemon's invocation is resolved at install time to
 * `[process.execPath, realpathSync(process.argv[1])]` — the exact node
 * interpreter plus the real dist entry. This is immune to launchd's bare
 * PATH and to `#!/usr/bin/env node` shebangs (the historical bug: a
 * hardcoded `/usr/local/bin/ebb` (0.17 name) that does not exist on Apple Silicon /
 * homebrew / nvm). `TIDEGAP_BINARY` remains as a documented override
 * (0.17 name `EBB_BINARY` still read).
 *
 * A 0.17 unit (`com.ebb-ai.tick`, `ebb-tick.timer`) is detected, never
 * removed: the next steps print the commands that unload and remove it.
 *
 * In --laptop mode we additionally drop a tiny helper script and print
 * the wake-event story (which needs a sudoers entry); --server skips it.
 */

import {
  existsSync,
  mkdirSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { resolveTidegapHome, TIDEGAP_HOME_DIR } from "@tidegap/core";
import { readEnvCredentials } from "../env.js";
import {
  currentPlatform,
  type PlatformName,
} from "../platform/index.js";
import { LAUNCHD_LABEL, LEGACY_LAUNCHD_LABEL, launchdPlist } from "../platform/macos.js";
import { LEGACY_SYSTEMD_UNIT, SYSTEMD_UNIT, systemdService, systemdTimer } from "../platform/linux.js";
import { schtasksTemplate } from "../platform/windows.js";
import { defaultDbPath } from "./tick.js";
import { ensureEnvFile, envFilePath, legacyEnvFilePath } from "./env-file.js";

export type InstallMode = "laptop" | "server";

export interface InstallOptions {
  mode: InstallMode;
  /** Override platform detection (tests). */
  platform?: PlatformName;
  /**
   * Override the resolved launcher argv (tests). When set, this is used
   * verbatim as the leading `ProgramArguments` / `ExecStart` tokens
   * instead of resolving `process.execPath` + the real script path.
   */
  launcher?: string[];
  /** Override the SQLite path (tests). */
  dbPath?: string;
  /** Override the tick interval. Defaults to 300s. */
  tickIntervalSec?: number;
  /** If true, do not write any files; only return the rendered strings. */
  dryRun?: boolean;
  /** Override the home directory (tests). */
  home?: string;
}

export interface InstallArtifacts {
  platform: PlatformName;
  /** Resolved launcher argv used for the daemon invocation. */
  launcher: string[];
  /** Warnings surfaced during resolution (e.g. a launcher path that does not exist). */
  warnings: string[];
  /** Path to the standardized secrets file (~/.config/tidegap/env). */
  envFilePath: string;
  /** True when this run created the secrets file. */
  envFileCreated: boolean;
  /** Where the daemon writes its log (`~/.tidegap/logs/tick.log`). */
  logPath: string;
  /** Path that would be written, or "" for non-macOS. */
  plistPath: string;
  /** The rendered plist XML, or "" for non-macOS. */
  plistContent: string;
  /** Path for the systemd `.service` unit, or "" for non-linux. */
  servicePath: string;
  /** The rendered `.service` unit content, or "" for non-linux. */
  serviceContent: string;
  /** Path for the systemd `.timer` unit, or "" for non-linux. */
  timerPath: string;
  /** The rendered `.timer` unit content, or "" for non-linux. */
  timerContent: string;
  /** Path for the laptop-wake helper script, or "" if --server or unsupported. */
  helperPath: string;
  /** Rendered helper script content, or "" if --server or unsupported. */
  helperContent: string;
  /** Human-facing next-steps message. */
  nextSteps: string;
}

/**
 * Resolve the daemon invocation. Preference order:
 *   1. explicit `override` (tests),
 *   2. `TIDEGAP_BINARY` env (0.17: `EBB_BINARY`) — a single documented override binary,
 *   3. `[process.execPath, realpathSync(process.argv[1])]` — pin the
 *      exact node + the real dist entry.
 *
 * Pushes a loud warning onto `warnings` if a resolved path does not
 * exist on disk.
 */
export function resolveLauncher(
  override: string[] | undefined,
  warnings: string[],
): string[] {
  if (override && override.length > 0) return override;

  const envBinary = readEnvCredentials().binary;
  if (envBinary) {
    if (!existsSync(envBinary)) {
      warnings.push(
        `TIDEGAP_BINARY points at ${envBinary}, which does not exist — the daemon will fail to launch.`,
      );
    }
    return [envBinary];
  }

  const node = process.execPath;
  const argv1 = process.argv[1];
  let script: string | undefined;
  if (argv1) {
    try {
      script = realpathSync(argv1);
    } catch {
      script = argv1;
    }
  }
  if (!script) {
    warnings.push(
      "Could not resolve the tidegap entry script (process.argv[1] was empty); " +
        "set TIDEGAP_BINARY to the tidegap executable and re-run.",
    );
    return [node];
  }
  if (!existsSync(node)) {
    warnings.push(
      `Resolved node interpreter ${node} does not exist — the daemon will fail to launch.`,
    );
  }
  if (!existsSync(script)) {
    warnings.push(
      `Resolved tidegap entry ${script} does not exist — the daemon will fail to launch.`,
    );
  }
  return [node, script];
}

/** Shell-quote a single argv token for embedding in the helper script. */
function shq(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

function helperScript(opts: { launcher: string[]; dbPath: string }): string {
  const tidegap = opts.launcher.map(shq).join(" ");
  const db = shq(opts.dbPath);
  return `#!/usr/bin/env bash
# laptop-wake.sh — register wake events for newly-scheduled Tidegap tasks.
# Generated by \`tidegap install --laptop\`. Re-run any time.

set -euo pipefail

DB=${db}
TIDEGAP=(${tidegap})

# List scheduled tasks and extract their task ids. The queue table has a
# header row + a separator row, so we skip the first two lines (\`tail -n
# +3\`); the id is the first whitespace-delimited column. \`--db "$DB"\` is
# passed to BOTH invocations so a custom queue path is honoured.
# register-wake needs a sudoers entry for pmset/rtcwake; it prints the
# exact command if not authorized.
"\${TIDEGAP[@]}" queue list --db "$DB" --status scheduled \\
  | tail -n +3 \\
  | awk 'NF { print $1 }' \\
  | while read -r TASK_ID; do
      [ -n "$TASK_ID" ] || continue
      "\${TIDEGAP[@]}" register-wake --db "$DB" "$TASK_ID" || true
    done
`;
}

export async function runInstall(
  opts: InstallOptions,
): Promise<InstallArtifacts> {
  const platform = opts.platform ?? currentPlatform();
  const home = opts.home ?? homedir();
  const warnings: string[] = [];
  const launcher = resolveLauncher(opts.launcher, warnings);
  // A real install moves a 0.17 ~/.ebb-ai into ~/.tidegap first, so the unit
  // pins the new path. A dry run touches nothing.
  const dataHome = opts.dryRun
    ? join(home, TIDEGAP_HOME_DIR)
    : resolveTidegapHome(opts.home !== undefined ? { home } : {});
  const dbPath =
    opts.dbPath ?? (opts.dryRun || opts.home !== undefined ? join(dataHome, "queue.db") : defaultDbPath());
  const logPath = join(dataHome, "logs", "tick.log");
  const tickInterval = opts.tickIntervalSec ?? 300;

  // Create the standardized secrets file (0600) if absent, as a copy of the
  // 0.17 file when only that exists. Never on dry-run (tests).
  const envPath = envFilePath(home);
  let envFileCreated = false;
  let envCopiedFrom: string | undefined;
  if (!opts.dryRun) {
    const r = ensureEnvFile(envPath, legacyEnvFilePath(home));
    envFileCreated = r.created;
    envCopiedFrom = r.copiedFrom;
  }
  const secretsNote =
    `\nProvider keys: ${
      envCopiedFrom ? `copied from ${envCopiedFrom} to` : envFileCreated ? "created" : "expected at"
    } ${envPath} (0600).\n` +
    `   Add ANTHROPIC_API_KEY / OPENAI_API_KEY there; \`tidegap tick\` loads it on startup.`;
  const warnBlock =
    warnings.length > 0
      ? `\n!! WARNING:\n` +
        warnings.map((w) => `   - ${w}`).join("\n") +
        `\n`
      : "";

  if (platform === "macos") {
    const plistContent = launchdPlist({
      tickIntervalSec: tickInterval,
      launcher,
      dbPath,
      logPath,
    });
    const agentsDir = join(home, "Library", "LaunchAgents");
    const plistPath = join(agentsDir, `${LAUNCHD_LABEL}.plist`);
    const legacyPlist = join(agentsDir, `${LEGACY_LAUNCHD_LABEL}.plist`);
    const helperContent =
      opts.mode === "laptop" ? helperScript({ launcher, dbPath }) : "";
    const helperPath =
      opts.mode === "laptop" ? join(dataHome, "laptop-wake.sh") : "";

    if (!opts.dryRun) {
      // launchd does not create the StandardOutPath parent directory.
      mkdirSync(dirname(logPath), { recursive: true });
      mkdirSync(dirname(plistPath), { recursive: true });
      writeFileSync(plistPath, plistContent, "utf8");
      mkdirSync(dirname(dbPath), { recursive: true });
      if (helperPath) {
        mkdirSync(dirname(helperPath), { recursive: true });
        writeFileSync(helperPath, helperContent, {
          encoding: "utf8",
          mode: 0o755,
        });
      }
    }

    const wakeNote =
      opts.mode === "laptop"
        ? `\n3. Pre-register wake events as tasks are scheduled:\n` +
          `     ${helperPath}\n` +
          `   (Requires a sudoers entry so \`pmset schedule wake\` runs without a\n` +
          `    password prompt — see \`tidegap register-wake\` output for the exact line.)`
        : "";
    const cleanup = existsSync(legacyPlist)
      ? `\n${opts.mode === "laptop" ? 4 : 3}. Remove the 0.17 agent (it ticks the same ledger):\n` +
        `     launchctl unload ${legacyPlist}\n` +
        `     rm ${legacyPlist}`
      : "";
    const nextSteps =
      warnBlock +
      `Wrote ${plistPath}.\n` +
      secretsNote +
      `\n\nNext steps:\n` +
      `1. Reload launchd:\n` +
      `     launchctl load ${plistPath}\n` +
      `2. (optional) Tail the log:\n` +
      `     tail -f ${logPath}${wakeNote}${cleanup}\n`;

    return {
      platform,
      launcher,
      warnings,
      envFilePath: envPath,
      envFileCreated,
      logPath,
      plistPath,
      plistContent,
      servicePath: "",
      serviceContent: "",
      timerPath: "",
      timerContent: "",
      helperPath,
      helperContent,
      nextSteps,
    };
  }

  if (platform === "linux") {
    const serviceContent = systemdService({
      launcher,
      dbPath,
      logPath,
    });
    const timerContent = systemdTimer({
      tickIntervalSec: tickInterval,
    });
    const systemdDir = join(home, ".config", "systemd", "user");
    const servicePath = join(systemdDir, `${SYSTEMD_UNIT}.service`);
    const timerPath = join(systemdDir, `${SYSTEMD_UNIT}.timer`);
    const legacyService = join(systemdDir, `${LEGACY_SYSTEMD_UNIT}.service`);
    const legacyTimer = join(systemdDir, `${LEGACY_SYSTEMD_UNIT}.timer`);
    const helperContent =
      opts.mode === "laptop" ? helperScript({ launcher, dbPath }) : "";
    const helperPath =
      opts.mode === "laptop" ? join(dataHome, "laptop-wake.sh") : "";

    if (!opts.dryRun) {
      // systemd `StandardOutput=append:` does not create the parent directory.
      mkdirSync(dirname(logPath), { recursive: true });
      mkdirSync(systemdDir, { recursive: true });
      writeFileSync(servicePath, serviceContent, "utf8");
      writeFileSync(timerPath, timerContent, "utf8");
      mkdirSync(dirname(dbPath), { recursive: true });
      if (helperPath) {
        mkdirSync(dirname(helperPath), { recursive: true });
        writeFileSync(helperPath, helperContent, {
          encoding: "utf8",
          mode: 0o755,
        });
      }
    }

    const wakeNote =
      opts.mode === "laptop"
        ? `\n3. Pre-register wake events as tasks are scheduled:\n` +
          `     ${helperPath}\n` +
          `   (Requires a sudoers entry so \`rtcwake\` runs without a password\n` +
          `    prompt — see \`tidegap register-wake\` output for the exact line.)`
        : "";
    const cleanup = existsSync(legacyTimer) || existsSync(legacyService)
      ? `\n${opts.mode === "laptop" ? 4 : 3}. Remove the 0.17 timer (it ticks the same ledger):\n` +
        `     systemctl --user disable --now ${LEGACY_SYSTEMD_UNIT}.timer\n` +
        `     rm ${legacyService} ${legacyTimer}\n` +
        `     systemctl --user daemon-reload`
      : "";
    const nextSteps =
      warnBlock +
      `Wrote ${servicePath}\n` +
      `Wrote ${timerPath}` +
      secretsNote +
      `\n\nNext steps:\n` +
      `1. Reload systemd and enable the timer:\n` +
      `     systemctl --user daemon-reload && systemctl --user enable --now ${SYSTEMD_UNIT}.timer\n` +
      `2. (optional) Tail the log:\n` +
      `     tail -f ${logPath}${wakeNote}${cleanup}\n`;

    return {
      platform,
      launcher,
      warnings,
      envFilePath: envPath,
      envFileCreated,
      logPath,
      plistPath: "",
      plistContent: "",
      servicePath,
      serviceContent,
      timerPath,
      timerContent,
      helperPath,
      helperContent,
      nextSteps,
    };
  }

  // windows — no auto-install; print a ready-to-paste schtasks command.
  const template = schtasksTemplate({
    launcher,
    dbPath,
    tickIntervalSec: tickInterval,
  });
  return {
    platform,
    launcher,
    warnings,
    envFilePath: envPath,
    envFileCreated,
    logPath,
    plistPath: "",
    plistContent: "",
    servicePath: "",
    serviceContent: "",
    timerPath: "",
    timerContent: "",
    helperPath: "",
    helperContent: "",
    nextSteps: warnBlock + template,
  };
}
