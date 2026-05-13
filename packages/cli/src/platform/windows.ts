/**
 * Windows platform stubs. v0.4 emits TODO notices; full Task Scheduler
 * integration is planned for v0.5.
 */

export const TODO_NOTE =
  "[ebb-ai/cli] Windows support is planned for v0.5. " +
  "Run `ebb tick --daemon` under nssm / a Task Scheduler entry for now.";

export async function caffeinateWhilePending(
  _durationSec: number,
): Promise<() => void> {
  // PowerSetThreadExecutionState / SetThreadExecutionState would be the
  // equivalent here; deferred to v0.5.
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
    command: `REM TODO: schtasks /create /SC ONCE /TN ebb-wake ... (planned for v0.5)`,
    ok: false,
    stderr: "windows wake registration not implemented",
  };
}

export function schtasksTemplate(opts: {
  ebbBinaryPath: string;
  dbPath: string;
  tickIntervalSec: number;
}): string {
  return `REM TODO: planned for v0.5.
REM Run from an elevated CMD:
REM
REM   schtasks /create /TN "ebb-tick" /TR "${opts.ebbBinaryPath} tick --db ${opts.dbPath} --once" ^
REM     /SC MINUTE /MO ${Math.max(1, Math.floor(opts.tickIntervalSec / 60))} /F
`;
}
