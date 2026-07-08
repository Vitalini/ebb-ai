/**
 * `ebb install` — write a launchd plist (macOS) or systemd user units
 * (Linux). Windows is not auto-installed: it prints a ready-to-paste
 * `schtasks` command instead.
 *
 * The daemon's invocation is resolved at install time to
 * `[process.execPath, realpathSync(process.argv[1])]` — the exact node
 * interpreter plus the real dist entry. This is immune to launchd's bare
 * PATH and to `#!/usr/bin/env node` shebangs (the historical bug: a
 * hardcoded `/usr/local/bin/ebb` that does not exist on Apple Silicon /
 * homebrew / nvm). `EBB_BINARY` remains as a documented override.
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
import {
  currentPlatform,
  type PlatformName,
} from "../platform/index.js";
import { launchdPlist } from "../platform/macos.js";
import { systemdService, systemdTimer } from "../platform/linux.js";
import { schtasksTemplate } from "../platform/windows.js";
import { defaultDbPath } from "./tick.js";
import { ensureEnvFile } from "./env-file.js";

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
}

export interface InstallArtifacts {
  platform: PlatformName;
  /** Resolved launcher argv used for the daemon invocation. */
  launcher: string[];
  /** Warnings surfaced during resolution (e.g. a launcher path that does not exist). */
  warnings: string[];
  /** Path to the standardized secrets file (~/.config/ebb/env). */
  envFilePath: string;
  /** True when this run created the secrets file. */
  envFileCreated: boolean;
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
 *   2. `EBB_BINARY` env — a single documented override binary,
 *   3. `[process.execPath, realpathSync(process.argv[1])]` — pin the
 *      exact node + the real dist entry.
 *
 * Pushes a loud warning onto `warnings` if a resolved path does not
 * exist on disk.
 */
function resolveLauncher(
  override: string[] | undefined,
  warnings: string[],
): string[] {
  if (override && override.length > 0) return override;

  const envBinary = process.env.EBB_BINARY;
  if (envBinary) {
    if (!existsSync(envBinary)) {
      warnings.push(
        `EBB_BINARY points at ${envBinary}, which does not exist — the daemon will fail to launch.`,
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
      "Could not resolve the ebb entry script (process.argv[1] was empty); " +
        "set EBB_BINARY to the ebb executable and re-run.",
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
      `Resolved ebb entry ${script} does not exist — the daemon will fail to launch.`,
    );
  }
  return [node, script];
}

/** Shell-quote a single argv token for embedding in the helper script. */
function shq(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

function helperScript(opts: { launcher: string[]; dbPath: string }): string {
  const ebb = opts.launcher.map(shq).join(" ");
  const db = shq(opts.dbPath);
  return `#!/usr/bin/env bash
# laptop-wake.sh — register wake events for newly-scheduled ebb tasks.
# Generated by \`ebb install --laptop\`. Re-run any time.

set -euo pipefail

DB=${db}
EBB=(${ebb})

# List scheduled tasks and extract their task ids. The queue table has a
# header row + a separator row, so we skip the first two lines (\`tail -n
# +3\`); the id is the first whitespace-delimited column. \`--db "$DB"\` is
# passed to BOTH invocations so a custom queue path is honoured.
# register-wake needs a sudoers entry for pmset/rtcwake; it prints the
# exact command if not authorized.
"\${EBB[@]}" queue list --db "$DB" --status scheduled \\
  | tail -n +3 \\
  | awk 'NF { print $1 }' \\
  | while read -r TASK_ID; do
      [ -n "$TASK_ID" ] || continue
      "\${EBB[@]}" register-wake --db "$DB" "$TASK_ID" || true
    done
`;
}

export async function runInstall(
  opts: InstallOptions,
): Promise<InstallArtifacts> {
  const platform = opts.platform ?? currentPlatform();
  const warnings: string[] = [];
  const launcher = resolveLauncher(opts.launcher, warnings);
  const dbPath = opts.dbPath ?? defaultDbPath();
  const tickInterval = opts.tickIntervalSec ?? 300;

  // Create the standardized secrets file (0600) if absent. Never on
  // dry-run (tests).
  const envPath = join(homedir(), ".config", "ebb", "env");
  let envFileCreated = false;
  if (!opts.dryRun) {
    const r = ensureEnvFile(envPath);
    envFileCreated = r.created;
  }
  const secretsNote =
    `\nProvider keys: ${
      envFileCreated ? "created" : "expected at"
    } ${envPath} (0600).\n` +
    `   Add ANTHROPIC_API_KEY / OPENAI_API_KEY there; \`ebb tick\` loads it on startup.`;
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
    });
    const plistPath = join(
      homedir(),
      "Library",
      "LaunchAgents",
      "com.ebb-ai.tick.plist",
    );
    const helperContent =
      opts.mode === "laptop" ? helperScript({ launcher, dbPath }) : "";
    const helperPath =
      opts.mode === "laptop" ? join(homedir(), ".ebb", "laptop-wake.sh") : "";

    if (!opts.dryRun) {
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
          `    password prompt — see \`ebb register-wake\` output for the exact line.)`
        : "";
    const nextSteps =
      warnBlock +
      `Wrote ${plistPath}.\n` +
      secretsNote +
      `\n\nNext steps:\n` +
      `1. Reload launchd:\n` +
      `     launchctl load ${plistPath}\n` +
      `2. (optional) Tail the log:\n` +
      `     tail -f ~/.ebb/tick.log${wakeNote}\n`;

    return {
      platform,
      launcher,
      warnings,
      envFilePath: envPath,
      envFileCreated,
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
    });
    const timerContent = systemdTimer({
      tickIntervalSec: tickInterval,
    });
    const systemdDir = join(homedir(), ".config", "systemd", "user");
    const servicePath = join(systemdDir, "ebb-tick.service");
    const timerPath = join(systemdDir, "ebb-tick.timer");
    const helperContent =
      opts.mode === "laptop" ? helperScript({ launcher, dbPath }) : "";
    const helperPath =
      opts.mode === "laptop" ? join(homedir(), ".ebb", "laptop-wake.sh") : "";

    if (!opts.dryRun) {
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
          `    prompt — see \`ebb register-wake\` output for the exact line.)`
        : "";
    const nextSteps =
      warnBlock +
      `Wrote ${servicePath}\n` +
      `Wrote ${timerPath}` +
      secretsNote +
      `\n\nNext steps:\n` +
      `1. Reload systemd and enable the timer:\n` +
      `     systemctl --user daemon-reload && systemctl --user enable --now ebb-tick.timer\n` +
      `2. (optional) Tail the log:\n` +
      `     tail -f ~/.ebb/tick.log${wakeNote}\n`;

    return {
      platform,
      launcher,
      warnings,
      envFilePath: envPath,
      envFileCreated,
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
