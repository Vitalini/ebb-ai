/**
 * macOS platform helpers — `caffeinate`, `pmset schedule wake`, and
 * launchd plist generation.
 *
 * These wrap shell-outs and string-templating. The only side-effects are
 * spawning subprocesses; nothing here writes a file. The `install`
 * command is responsible for placing the plist on disk.
 */

import { spawn } from "node:child_process";

/**
 * Spawn `caffeinate -i` so the system stays awake (idle-sleep is
 * prevented; display can still sleep). Returns a kill() function. If
 * caffeinate is not available (we're not on macOS), the returned kill()
 * is a no-op.
 */
export async function caffeinateWhilePending(
  durationSec: number,
): Promise<() => void> {
  const args = ["-i", "-t", String(Math.max(1, Math.floor(durationSec)))];
  let child: ReturnType<typeof spawn> | undefined;
  try {
    child = spawn("caffeinate", args, { stdio: "ignore", detached: false });
    child.on("error", () => {
      // caffeinate missing — no-op.
    });
  } catch {
    // unavailable; return a no-op killer.
  }
  return () => {
    if (child && child.exitCode === null && !child.killed) {
      try {
        child.kill("SIGTERM");
      } catch {
        // ignore
      }
    }
  };
}

/**
 * Format a Date as `MM/dd/yy HH:mm:ss` — the format `pmset schedule wake`
 * expects. Times are interpreted in the local timezone by `pmset`.
 */
export function formatPmsetDate(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  const mm = pad(d.getMonth() + 1);
  const dd = pad(d.getDate());
  const yy = pad(d.getFullYear() % 100);
  const hh = pad(d.getHours());
  const mi = pad(d.getMinutes());
  const ss = pad(d.getSeconds());
  return `${mm}/${dd}/${yy} ${hh}:${mi}:${ss}`;
}

/**
 * Build the exact `pmset schedule wake "..."` command for a given date.
 */
export function pmsetCommand(at: Date): string {
  return `pmset schedule wake "${formatPmsetDate(at)}"`;
}

/**
 * Run `pmset schedule wake <at>`. `pmset` needs root. If we are euid 0
 * we run it directly; otherwise we try `sudo -n` (non-interactive — it
 * succeeds only if a sudoers rule pre-authorizes the command without a
 * password) and, on failure, hand the caller a non-ok result so it can
 * print the exact sudoers one-liner.
 */
export async function pmsetScheduleWake(
  at: Date,
): Promise<{ command: string; ok: boolean; stderr: string }> {
  const command = pmsetCommand(at);
  const uid = typeof process.getuid === "function" ? process.getuid() : -1;
  const bare = ["schedule", "wake", formatPmsetDate(at)];
  const [bin, args] =
    uid === 0
      ? (["pmset", bare] as const)
      : (["sudo", ["-n", "pmset", ...bare]] as const);
  return await new Promise((resolve) => {
    const child = spawn(bin, args, {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stderr = "";
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on("error", (err) => {
      resolve({ command, ok: false, stderr: err.message });
    });
    child.on("close", (code) => {
      resolve({ command, ok: code === 0, stderr });
    });
  });
}

export interface LaunchdPlistOptions {
  tickIntervalSec: number;
  dbPath: string;
  /**
   * The argv[0..n] that invoke `ebb`, resolved at install time. For a
   * pinned node install this is `[process.execPath, realpath(argv[1])]`
   * — the exact interpreter plus the real dist entry — which is immune
   * to launchd's bare PATH and `#!/usr/bin/env node` shebangs. When the
   * caller only has a single wrapper binary on PATH, pass a one-element
   * array. Falls back to `ebbBinaryPath` (single element) if omitted.
   */
  launcher?: string[];
  /** Legacy single-binary launcher. Prefer `launcher`. */
  ebbBinaryPath?: string;
  /** Absolute path to write stdout/stderr logs. Defaults to ~/.ebb/tick.log. */
  logPath?: string;
  /** Optional env vars (e.g. ANTHROPIC_API_KEY) added to the plist. */
  env?: Record<string, string>;
}

/**
 * Generate a launchd plist that runs `ebb tick` on a fixed interval.
 *
 * The plist intentionally uses `StartInterval` (not `StartCalendarInterval`)
 * so the agent fires every N seconds regardless of wall-clock alignment.
 * `RunAtLoad` means tasks queued before the user logs in still drain on
 * first session.
 */
export function launchdPlist(opts: LaunchdPlistOptions): string {
  const logPath = opts.logPath ?? `${homeDir()}/.ebb/tick.log`;
  const launcher =
    opts.launcher && opts.launcher.length > 0
      ? opts.launcher
      : [opts.ebbBinaryPath ?? "ebb"];
  const programArgs = [...launcher, "tick", "--db", opts.dbPath, "--once"];
  const argBlock = programArgs
    .map((a) => `    <string>${escapeXml(a)}</string>`)
    .join("\n");
  const envBlock = opts.env
    ? Object.entries(opts.env)
        .map(
          ([k, v]) =>
            `      <key>${escapeXml(k)}</key>\n      <string>${escapeXml(v)}</string>`,
        )
        .join("\n")
    : "";
  const envFragment = envBlock
    ? `  <key>EnvironmentVariables</key>\n  <dict>\n${envBlock}\n  </dict>\n`
    : "";
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.ebb-ai.tick</string>
  <key>ProgramArguments</key>
  <array>
${argBlock}
  </array>
  <key>StartInterval</key>
  <integer>${Math.max(1, Math.floor(opts.tickIntervalSec))}</integer>
  <key>RunAtLoad</key>
  <true/>
${envFragment}  <key>StandardOutPath</key>
  <string>${escapeXml(logPath)}</string>
  <key>StandardErrorPath</key>
  <string>${escapeXml(logPath)}</string>
</dict>
</plist>
`;
}

function homeDir(): string {
  return process.env.HOME ?? "/tmp";
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
