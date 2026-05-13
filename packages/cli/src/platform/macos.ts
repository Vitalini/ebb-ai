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
 * Run `pmset schedule wake <at>`. Requires root; we don't sudo on
 * the user's behalf. If the process is not euid 0, we return `{ ok:
 * false, stderr: "sudo required" }` so the caller can prompt.
 */
export async function pmsetScheduleWake(
  at: Date,
): Promise<{ command: string; ok: boolean; stderr: string }> {
  const command = pmsetCommand(at);
  const uid = typeof process.getuid === "function" ? process.getuid() : -1;
  if (uid !== 0) {
    return { command, ok: false, stderr: "sudo required" };
  }
  return await new Promise((resolve) => {
    const child = spawn("pmset", ["schedule", "wake", formatPmsetDate(at)], {
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
  ebbBinaryPath: string;
  dbPath: string;
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
    <string>${escapeXml(opts.ebbBinaryPath)}</string>
    <string>tick</string>
    <string>--db</string>
    <string>${escapeXml(opts.dbPath)}</string>
    <string>--once</string>
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
