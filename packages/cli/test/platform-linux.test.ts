import { describe, expect, it } from "vitest";
import {
  rtcwakeCommand,
  systemdService,
  systemdTimer,
} from "../src/platform/linux.js";

describe("rtcwakeCommand", () => {
  it("builds an `rtcwake -m no -t <epoch>` for a fixed UTC date", () => {
    // 2026-05-13T03:07:09Z → 1778288829
    const d = new Date("2026-05-13T03:07:09Z");
    const epoch = Math.floor(d.getTime() / 1000);
    expect(rtcwakeCommand(d)).toBe(`rtcwake -m no -t ${epoch}`);
  });

  it("uses `-m no` so the machine is not actually suspended", () => {
    const d = new Date(0);
    expect(rtcwakeCommand(d)).toContain("-m no");
    expect(rtcwakeCommand(d)).not.toContain("-m mem");
  });
});

describe("systemdService", () => {
  it("renders a complete oneshot service unit", () => {
    const unit = systemdService({
      ebbBinaryPath: "/usr/local/bin/ebb",
      dbPath: "/home/test/.ebb/queue.sqlite",
      logPath: "/home/test/.ebb/tick.log",
    });
    expect(unit).toContain("[Unit]");
    expect(unit).toContain("Description=ebb-ai cron-tick drain");
    expect(unit).toContain("[Service]");
    expect(unit).toContain("Type=oneshot");
    expect(unit).toContain(
      "ExecStart=/usr/local/bin/ebb tick --db /home/test/.ebb/queue.sqlite --once",
    );
    expect(unit).toContain("EnvironmentFile=-%h/.config/ebb/env");
    expect(unit).toContain("StandardOutput=append:/home/test/.ebb/tick.log");
    expect(unit).toContain("StandardError=append:/home/test/.ebb/tick.log");
    expect(unit).toContain("[Install]");
    expect(unit).toContain("WantedBy=default.target");
  });

  it("emits Environment= lines when env is supplied", () => {
    const unit = systemdService({
      ebbBinaryPath: "/usr/bin/ebb",
      dbPath: "/tmp/q.sqlite",
      env: { ANTHROPIC_API_KEY: "sk-test", FOO: "bar" },
    });
    expect(unit).toContain("Environment=ANTHROPIC_API_KEY=sk-test");
    expect(unit).toContain("Environment=FOO=bar");
  });

  it("omits Environment= lines when env is not supplied", () => {
    const unit = systemdService({
      ebbBinaryPath: "/usr/bin/ebb",
      dbPath: "/tmp/q.sqlite",
    });
    expect(unit).not.toMatch(/^Environment=/m);
  });
});

describe("systemdTimer", () => {
  it("renders a complete timer unit with OnUnitActiveSec", () => {
    const unit = systemdTimer({ tickIntervalSec: 300 });
    expect(unit).toContain("[Unit]");
    expect(unit).toContain("Description=Run ebb-tick every 300 seconds");
    expect(unit).toContain("[Timer]");
    expect(unit).toContain("OnBootSec=30s");
    expect(unit).toContain("OnUnitActiveSec=300s");
    expect(unit).toContain("Unit=ebb-tick.service");
    expect(unit).toContain("[Install]");
    expect(unit).toContain("WantedBy=timers.target");
  });

  it("clamps tickIntervalSec to at least 1 second", () => {
    const unit = systemdTimer({ tickIntervalSec: 0 });
    expect(unit).toContain("OnUnitActiveSec=1s");
  });
});
