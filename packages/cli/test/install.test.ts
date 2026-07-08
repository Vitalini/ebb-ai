import { describe, expect, it } from "vitest";
import { runInstall } from "../src/commands/install.js";

// A test launcher that stands in for `[process.execPath, realpath(argv1)]`.
const LAUNCHER = ["/usr/bin/node", "/opt/ebb/dist/index.js"];

describe("ebb install (macOS, dry-run)", () => {
  it("produces a plist + helper script for --laptop", async () => {
    const r = await runInstall({
      mode: "laptop",
      platform: "macos",
      launcher: LAUNCHER,
      dbPath: "/Users/test/.ebb/queue.sqlite",
      tickIntervalSec: 300,
      dryRun: true,
    });
    expect(r.platform).toBe("macos");
    expect(r.plistPath).toContain("Library/LaunchAgents/com.ebb-ai.tick.plist");
    expect(r.plistContent).toContain("<key>StartInterval</key>");
    expect(r.helperPath).toContain(".ebb/laptop-wake.sh");
    expect(r.helperContent).toContain("register-wake");
    expect(r.nextSteps).toContain("launchctl load");
  });

  it("pins the exact node interpreter + resolved script in ProgramArguments", async () => {
    const r = await runInstall({
      mode: "server",
      platform: "macos",
      launcher: LAUNCHER,
      dbPath: "/Users/test/.ebb/queue.sqlite",
      dryRun: true,
    });
    // Both launcher elements appear as separate <string> tokens, before `tick`.
    expect(r.plistContent).toContain("<string>/usr/bin/node</string>");
    expect(r.plistContent).toContain("<string>/opt/ebb/dist/index.js</string>");
    expect(r.plistContent).toContain("<string>tick</string>");
    expect(r.plistContent).toContain("<string>--once</string>");
    // The old hardcoded fallback must be gone.
    expect(r.plistContent).not.toContain("/usr/local/bin/ebb");
    expect(r.launcher).toEqual(LAUNCHER);
  });

  it("resolves process.execPath + realpath(argv1) when no launcher override", async () => {
    const r = await runInstall({
      mode: "server",
      platform: "macos",
      dbPath: "/Users/test/.ebb/queue.sqlite",
      dryRun: true,
    });
    // First element is the real node binary.
    expect(r.launcher[0]).toBe(process.execPath);
    expect(r.launcher.length).toBeGreaterThanOrEqual(1);
    expect(r.plistContent).toContain(`<string>${process.execPath}</string>`);
  });

  it("omits the wake helper for --server", async () => {
    const r = await runInstall({
      mode: "server",
      platform: "macos",
      launcher: LAUNCHER,
      dbPath: "/srv/.ebb/queue.sqlite",
      dryRun: true,
    });
    expect(r.helperPath).toBe("");
    expect(r.helperContent).toBe("");
    expect(r.nextSteps).not.toContain("register-wake");
  });

  it("mentions the ~/.config/ebb/env secrets path in next-steps", async () => {
    const r = await runInstall({
      mode: "server",
      platform: "macos",
      launcher: LAUNCHER,
      dbPath: "/srv/.ebb/queue.sqlite",
      dryRun: true,
    });
    expect(r.envFilePath).toContain(".config/ebb/env");
    expect(r.nextSteps).toContain(".config/ebb/env");
    expect(r.nextSteps).toContain("ANTHROPIC_API_KEY");
  });
});

describe("ebb install (linux, dry-run)", () => {
  it("produces a service + timer + helper for --laptop", async () => {
    const r = await runInstall({
      mode: "laptop",
      platform: "linux",
      launcher: LAUNCHER,
      dbPath: "/var/lib/ebb/queue.sqlite",
      tickIntervalSec: 300,
      dryRun: true,
    });
    expect(r.platform).toBe("linux");
    expect(r.plistContent).toBe("");
    expect(r.servicePath).toContain(".config/systemd/user/ebb-tick.service");
    expect(r.timerPath).toContain(".config/systemd/user/ebb-tick.timer");
    expect(r.serviceContent).toContain(
      "ExecStart=/usr/bin/node /opt/ebb/dist/index.js tick --db /var/lib/ebb/queue.sqlite --once",
    );
    expect(r.serviceContent).not.toContain("/usr/local/bin/ebb");
    expect(r.serviceContent).toContain("EnvironmentFile=-%h/.config/ebb/env");
    expect(r.timerContent).toContain("OnUnitActiveSec=300s");
    expect(r.helperPath).toContain(".ebb/laptop-wake.sh");
    expect(r.helperContent).toContain("register-wake");
    expect(r.nextSteps).toContain(
      "systemctl --user daemon-reload && systemctl --user enable --now ebb-tick.timer",
    );
  });

  it("omits the wake helper for --server", async () => {
    const r = await runInstall({
      mode: "server",
      platform: "linux",
      launcher: LAUNCHER,
      dbPath: "/srv/.ebb/queue.sqlite",
      dryRun: true,
    });
    expect(r.helperPath).toBe("");
    expect(r.helperContent).toBe("");
    expect(r.nextSteps).not.toContain("register-wake");
    expect(r.serviceContent).toContain("ExecStart=");
  });
});

describe("ebb install (windows = template only)", () => {
  it("returns an honest schtasks template built from the launcher", async () => {
    const r = await runInstall({
      mode: "server",
      platform: "windows",
      launcher: ["C:\\Program Files\\nodejs\\node.exe", "C:\\ebb\\index.js"],
      dbPath: "C:\\ProgramData\\ebb\\queue.sqlite",
      dryRun: true,
    });
    expect(r.plistContent).toBe("");
    expect(r.nextSteps.toLowerCase()).toContain("schtasks");
    expect(r.nextSteps.toLowerCase()).toContain("not supported");
    // No leftover POSIX path, no "planned for v0.5".
    expect(r.nextSteps).not.toContain("/usr/local/bin/ebb");
    expect(r.nextSteps).not.toContain("v0.5");
    expect(r.nextSteps).toContain("index.js");
  });
});

describe("ebb install laptop helper script", () => {
  it("skips the header AND the separator row (tail -n +3, not +2)", async () => {
    const r = await runInstall({
      mode: "laptop",
      platform: "macos",
      launcher: LAUNCHER,
      dbPath: "/Users/test/.ebb/queue.sqlite",
      dryRun: true,
    });
    // Regression: the old script used `tail -n +2`, feeding the table
    // separator row in as a bogus task id.
    expect(r.helperContent).toContain("tail -n +3");
    expect(r.helperContent).not.toContain("tail -n +2");
  });

  it("passes --db to BOTH queue list and register-wake", async () => {
    const r = await runInstall({
      mode: "laptop",
      platform: "linux",
      launcher: LAUNCHER,
      dbPath: "/custom/path/queue.db",
      dryRun: true,
    });
    // The custom db path is bound to $DB and threaded through both invocations.
    expect(r.helperContent).toContain(`DB='/custom/path/queue.db'`);
    expect(r.helperContent).toContain(`queue list --db "$DB"`);
    expect(r.helperContent).toContain(`register-wake --db "$DB"`);
  });

  it("shell-quotes each launcher token into an EBB array", async () => {
    const r = await runInstall({
      mode: "laptop",
      platform: "macos",
      launcher: LAUNCHER,
      dbPath: "/Users/test/.ebb/queue.sqlite",
      dryRun: true,
    });
    expect(r.helperContent).toContain(`EBB=('/usr/bin/node' '/opt/ebb/dist/index.js')`);
    expect(r.helperContent).toContain(`"\${EBB[@]}"`);
  });
});
