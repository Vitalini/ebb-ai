/**
 * Windows platform helpers.
 *
 * There is no automated daemon install on Windows: `ebb install` does
 * not register a Task Scheduler job or an nssm service for you. Instead
 * it prints a ready-to-paste `schtasks` command, built from the real
 * node interpreter + the resolved `ebb` entry, that you run yourself
 * from an elevated prompt. `caffeinate`/wake-event equivalents
 * (SetThreadExecutionState, waitable timers) are not wired.
 */

export const TODO_NOTE =
  "[ebb-ai/cli] Windows daemon install is not supported. " +
  "Run `ebb tick` under Task Scheduler or nssm manually — " +
  "`ebb install` prints a ready-to-paste schtasks command.";

export async function caffeinateWhilePending(
  _durationSec: number,
): Promise<() => void> {
  // SetThreadExecutionState(ES_SYSTEM_REQUIRED) would be the equivalent
  // here; not wired. Idle-sleep prevention is a no-op on Windows.
  // eslint-disable-next-line no-console
  console.warn(TODO_NOTE);
  return () => {
    // no-op
  };
}

export async function pmsetScheduleWake(
  _at: Date,
): Promise<{ command: string; ok: boolean; stderr: string }> {
  // eslint-disable-next-line no-console
  console.warn(TODO_NOTE);
  return {
    command: "",
    ok: false,
    stderr: "wake-event registration is not supported on Windows",
  };
}

/**
 * Build a ready-to-paste `schtasks` command for running `ebb tick`
 * periodically. `launcher` is the resolved invocation
 * (`[process.execPath, realpath(argv[1])]` for a pinned-node install),
 * so the task runs the exact interpreter + entry rather than relying on
 * a POSIX-style `/usr/local/bin/ebb` path that never exists on Windows.
 */
export function schtasksTemplate(opts: {
  launcher?: string[];
  ebbBinaryPath?: string;
  dbPath: string;
  tickIntervalSec: number;
}): string {
  const launcher =
    opts.launcher && opts.launcher.length > 0
      ? opts.launcher
      : [opts.ebbBinaryPath ?? "ebb"];
  const quote = (s: string) => (/\s/.test(s) ? `\\"${s}\\"` : s);
  const run = [...launcher, "tick", "--db", opts.dbPath, "--once"]
    .map(quote)
    .join(" ");
  const everyMin = Math.max(1, Math.floor(opts.tickIntervalSec / 60));
  return `Windows daemon install is not supported. Run \`ebb tick\` yourself under
Task Scheduler or nssm. From an elevated PowerShell / CMD:

  schtasks /create /TN "ebb-tick" /TR "${run}" /SC MINUTE /MO ${everyMin} /F

Provide provider keys via %USERPROFILE%\\.config\\ebb\\env (KEY=VALUE lines);
\`ebb tick\` loads that file on startup. Wake-from-sleep events are not
supported on Windows.
`;
}
