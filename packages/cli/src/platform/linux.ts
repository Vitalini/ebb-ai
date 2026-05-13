/**
 * Linux platform helpers — `systemd-inhibit`, `rtcwake`, and
 * user-systemd unit-file generation.
 *
 * Like the macOS module, these wrap shell-outs and string-templating.
 * The only side-effects are spawning subprocesses; nothing here writes
 * a file. The `install` command places the unit files on disk.
 */

import { spawn } from "node:child_process";

/**
 * Spawn `systemd-inhibit --what=idle` so the system stays awake.
 * Returns a kill() function. If `systemd-inhibit` is not available,
 * the returned kill() is a no-op.
 *
 * Note: many Linux desktops will honour this; headless servers may
 * have no idle-sleep policy at all, in which case the inhibit is a
 * functional no-op.
 */
export async function caffeinateWhilePending(
  durationSec: number,
): Promise<() => void> {
  const seconds = Math.max(1, Math.floor(durationSec));
  const args = [
    "--what=idle",
    "--why=ebb-ai pending tasks",
    "--mode=block",
    "sleep",
    String(seconds),
  ];
  let child: ReturnType<typeof spawn> | undefined;
  try {
    child = spawn("systemd-inhibit", args, {
      stdio: "ignore",
      detached: false,
    });
    child.on("error", () => {
      // systemd-inhibit missing — no-op.
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
 * Build the exact `rtcwake -m no -t <epoch-seconds>` command for a
 * given date. `-m no` tells rtcwake to *only* arm the RTC alarm without
 * suspending the machine itself.
 */
export function rtcwakeCommand(at: Date): string {
  const epoch = Math.floor(at.getTime() / 1000);
  return `rtcwake -m no -t ${epoch}`;
}

/**
 * Run `rtcwake -m no -t <epoch>`. Requires CAP_SYS_TIME / root; we
 * don't sudo on the user's behalf. If the process is not euid 0, we
 * return `{ ok: false, stderr: "sudo required" }` so the caller can
 * prompt.
 */
export async function rtcwakeScheduleWake(
  at: Date,
): Promise<{ command: string; ok: boolean; stderr: string }> {
  const command = rtcwakeCommand(at);
  const uid = typeof process.getuid === "function" ? process.getuid() : -1;
  if (uid !== 0) {
    return { command, ok: false, stderr: "sudo required" };
  }
  const epoch = Math.floor(at.getTime() / 1000);
  return await new Promise((resolve) => {
    const child = spawn("rtcwake", ["-m", "no", "-t", String(epoch)], {
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

/**
 * Compatibility alias for the cross-platform `getPlatform` shim so
 * callers can keep using one name regardless of OS.
 */
export const pmsetScheduleWake = rtcwakeScheduleWake;

export interface SystemdServiceOptions {
  ebbBinaryPath: string;
  dbPath: string;
  /** Absolute path to write stdout/stderr logs. Defaults to ~/.ebb/tick.log. */
  logPath?: string;
  /** Optional env vars added as `Environment=KEY=VAL` lines. */
  env?: Record<string, string>;
}

/**
 * Render the `ebb-tick.service` unit file. `Type=oneshot` because the
 * service runs `ebb tick --once` and exits; the companion timer is
 * responsible for cadence. `EnvironmentFile=` references a user-owned
 * env file so secrets never land in the service unit itself.
 */
export function systemdService(opts: SystemdServiceOptions): string {
  const logPath = opts.logPath ?? `${homeDir()}/.ebb/tick.log`;
  const envLines = opts.env
    ? Object.entries(opts.env)
        .map(([k, v]) => `Environment=${k}=${v}`)
        .join("\n")
    : "";
  const envBlock = envLines ? `${envLines}\n` : "";
  return `[Unit]
Description=ebb-ai cron-tick drain
After=network.target

[Service]
Type=oneshot
ExecStart=${opts.ebbBinaryPath} tick --db ${opts.dbPath} --once
EnvironmentFile=-%h/.config/ebb/env
${envBlock}StandardOutput=append:${logPath}
StandardError=append:${logPath}

[Install]
WantedBy=default.target
`;
}

export interface SystemdTimerOptions {
  tickIntervalSec: number;
}

/**
 * Render the `ebb-tick.timer` unit file. Uses `OnUnitActiveSec=<n>s`
 * so the cadence matches the launchd `StartInterval` — fires every N
 * seconds regardless of wall-clock alignment. `OnBootSec=30s` covers
 * the case where the user-session starts before the network does.
 */
export function systemdTimer(opts: SystemdTimerOptions): string {
  const interval = Math.max(1, Math.floor(opts.tickIntervalSec));
  return `[Unit]
Description=Run ebb-tick every ${interval} seconds

[Timer]
OnBootSec=30s
OnUnitActiveSec=${interval}s
Unit=ebb-tick.service

[Install]
WantedBy=timers.target
`;
}

function homeDir(): string {
  return process.env.HOME ?? "/tmp";
}
