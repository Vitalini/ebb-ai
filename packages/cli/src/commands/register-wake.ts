/**
 * `ebb register-wake <task-id>` — schedule an RTC/pmset wake event 30s
 * before the task's `scheduledFor`. macOS uses `pmset schedule wake`;
 * Linux uses `rtcwake -m no -t <epoch>`.
 */

import { TaskStore } from "@ebb-ai/core";
import {
  currentPlatform,
  type PlatformName,
} from "../platform/index.js";
import { pmsetCommand, pmsetScheduleWake } from "../platform/macos.js";
import {
  rtcwakeCommand,
  rtcwakeScheduleWake,
} from "../platform/linux.js";
import { defaultDbPath } from "./tick.js";

export interface RegisterWakeOptions {
  taskId: string;
  db?: string;
  platform?: PlatformName;
  /** If true, only print the command — don't run pmset. */
  dryRun?: boolean;
}

export interface RegisterWakeResult {
  command: string;
  ok: boolean;
  stderr: string;
  message: string;
}

export async function runRegisterWake(
  opts: RegisterWakeOptions,
): Promise<RegisterWakeResult> {
  const platform = opts.platform ?? currentPlatform();
  if (platform === "windows") {
    return {
      command: "",
      ok: false,
      stderr: "non-posix",
      message:
        `[ebb-ai/cli] register-wake is not supported on Windows — there is no ` +
        `pmset/rtcwake equivalent wired. Use Task Scheduler's "Wake the ` +
        `computer to run this task" option on your ebb-tick job instead.`,
    };
  }

  const dbPath = opts.db ?? defaultDbPath();
  const store = new TaskStore({ dbPath });
  let scheduledFor: string | undefined;
  try {
    const rec = store.get(opts.taskId);
    if (!rec) {
      throw new Error(`register-wake: task ${opts.taskId} not found in ${dbPath}`);
    }
    if (!rec.scheduledFor) {
      throw new Error(
        `register-wake: task ${opts.taskId} has no scheduled_for; nothing to register against`,
      );
    }
    scheduledFor = rec.scheduledFor;
  } finally {
    store.close();
  }

  const at = new Date(new Date(scheduledFor).getTime() - 30 * 1000);
  const command =
    platform === "macos" ? pmsetCommand(at) : rtcwakeCommand(at);
  if (opts.dryRun) {
    return {
      command,
      ok: true,
      stderr: "",
      message: `(dry-run) ${command}`,
    };
  }
  const res =
    platform === "macos"
      ? await pmsetScheduleWake(at)
      : await rtcwakeScheduleWake(at);
  return {
    command: res.command,
    ok: res.ok,
    stderr: res.stderr,
    message: res.ok
      ? `registered: ${res.command}`
      : `failed (${res.stderr}).\n` +
        `Run as root, or pre-authorize password-less wake scheduling — add this\n` +
        `line via \`sudo visudo\` (replace ${whoami()} with your login):\n` +
        `    ${sudoersLine(platform)}`,
  };
}

/** Best-effort current username for the sudoers hint. */
function whoami(): string {
  return (
    process.env.SUDO_USER ??
    process.env.USER ??
    process.env.LOGNAME ??
    "youruser"
  );
}

/** The exact NOPASSWD sudoers line the user should paste. */
function sudoersLine(platform: PlatformName): string {
  const bin =
    platform === "macos" ? "/usr/bin/pmset" : "/usr/sbin/rtcwake";
  return `${whoami()} ALL=(root) NOPASSWD: ${bin}`;
}
