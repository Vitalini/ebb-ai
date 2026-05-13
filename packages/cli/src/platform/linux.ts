/**
 * Linux platform stubs. v0.4 emits TODO notices; full systemd timer +
 * `rtcwake` integration is planned for v0.5.
 */

export const TODO_NOTE =
  "[ebb-ai/cli] Linux support is planned for v0.5. " +
  "Run `ebb tick --daemon` under your favourite supervisor for now.";

export async function caffeinateWhilePending(
  _durationSec: number,
): Promise<() => void> {
  // No portable equivalent on Linux. Some desktops support
  // `systemd-inhibit --what=idle` — we'll wire it in v0.5.
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
    command: `# TODO: rtcwake -m no -t <epoch>  (planned for v0.5)`,
    ok: false,
    stderr: "linux wake registration not implemented",
  };
}

export function systemdServiceTemplate(opts: {
  ebbBinaryPath: string;
  dbPath: string;
  tickIntervalSec: number;
}): string {
  return `# TODO: planned for v0.5. Drop these into /etc/systemd/system/.
#
# /etc/systemd/system/ebb-tick.service
# -------------------------------------
# [Unit]
# Description=ebb-ai cron-tick drain
# After=network.target
#
# [Service]
# Type=oneshot
# ExecStart=${opts.ebbBinaryPath} tick --db ${opts.dbPath} --once
#
# /etc/systemd/system/ebb-tick.timer
# -----------------------------------
# [Unit]
# Description=Run ebb-tick every ${opts.tickIntervalSec} seconds
#
# [Timer]
# OnBootSec=30s
# OnUnitActiveSec=${opts.tickIntervalSec}s
# Unit=ebb-tick.service
#
# [Install]
# WantedBy=timers.target
#
# Then:
#   systemctl --user daemon-reload
#   systemctl --user enable --now ebb-tick.timer
`;
}
