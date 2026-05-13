import { describe, expect, it } from "vitest";
import { runInstall } from "../src/commands/install.js";

describe("ebb install (macOS, dry-run)", () => {
  it("produces a plist + helper script for --laptop", async () => {
    const r = await runInstall({
      mode: "laptop",
      platform: "macos",
      ebbBinaryPath: "/usr/local/bin/ebb",
      dbPath: "/Users/test/.ebb/queue.sqlite",
      tickIntervalSec: 300,
      dryRun: true,
    });
    expect(r.platform).toBe("macos");
    expect(r.plistPath).toContain("Library/LaunchAgents/com.ebb-ai.tick.plist");
    expect(r.plistContent).toContain("<key>StartInterval</key>");
    expect(r.helperPath).toContain(".ebb/laptop-wake.sh");
    expect(r.helperContent).toContain("ebb register-wake");
    expect(r.nextSteps).toContain("launchctl load");
  });

  it("omits the wake helper for --server", async () => {
    const r = await runInstall({
      mode: "server",
      platform: "macos",
      ebbBinaryPath: "/usr/local/bin/ebb",
      dbPath: "/srv/.ebb/queue.sqlite",
      dryRun: true,
    });
    expect(r.helperPath).toBe("");
    expect(r.helperContent).toBe("");
    expect(r.nextSteps).not.toContain("register-wake");
  });
});

describe("ebb install (linux + windows = template only)", () => {
  it("returns a systemd template for linux", async () => {
    const r = await runInstall({
      mode: "laptop",
      platform: "linux",
      ebbBinaryPath: "/usr/local/bin/ebb",
      dbPath: "/var/lib/ebb/queue.sqlite",
      dryRun: true,
    });
    expect(r.plistContent).toBe("");
    expect(r.nextSteps.toLowerCase()).toContain("systemd");
  });

  it("returns a schtasks template for windows", async () => {
    const r = await runInstall({
      mode: "server",
      platform: "windows",
      ebbBinaryPath: "C:\\Program Files\\ebb\\ebb.exe",
      dbPath: "C:\\ProgramData\\ebb\\queue.sqlite",
      dryRun: true,
    });
    expect(r.plistContent).toBe("");
    expect(r.nextSteps.toLowerCase()).toContain("schtasks");
  });
});
