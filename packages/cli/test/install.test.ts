import { describe, expect, it } from "vitest";
import { runInstall } from "../src/commands/install.js";

// A test launcher that stands in for `[process.execPath, realpath(argv1)]`.
const LAUNCHER = ["/usr/bin/node", "/opt/tidegap/dist/index.js"];

describe("tidegap install (macOS, dry-run)", () => {
  it("produces a plist + helper script for --laptop", async () => {
    const r = await runInstall({
      mode: "laptop",
      platform: "macos",
      launcher: LAUNCHER,
      dbPath: "/Users/test/.tidegap/queue.sqlite",
      tickIntervalSec: 300,
      dryRun: true,
    });
    expect(r.platform).toBe("macos");
    expect(r.plistPath).toContain("Library/LaunchAgents/com.tidegap.tick.plist");
    expect(r.plistContent).toContain("<key>StartInterval</key>");
    expect(r.helperPath).toContain(".tidegap/laptop-wake.sh");
    expect(r.helperContent).toContain("register-wake");
    expect(r.nextSteps).toContain("launchctl load");
  });

  it("pins the exact node interpreter + resolved script in ProgramArguments", async () => {
    const r = await runInstall({
      mode: "server",
      platform: "macos",
      launcher: LAUNCHER,
      dbPath: "/Users/test/.tidegap/queue.sqlite",
      dryRun: true,
    });
    // Both launcher elements appear as separate <string> tokens, before `tick`.
    expect(r.plistContent).toContain("<string>/usr/bin/node</string>");
    expect(r.plistContent).toContain("<string>/opt/tidegap/dist/index.js</string>");
    expect(r.plistContent).toContain("<string>tick</string>");
    expect(r.plistContent).toContain("<string>--once</string>");
    // The old hardcoded fallback must be gone.
    expect(r.plistContent).not.toContain("/usr/local/bin/tidegap");
    expect(r.launcher).toEqual(LAUNCHER);
  });

  it("resolves process.execPath + realpath(argv1) when no launcher override", async () => {
    const r = await runInstall({
      mode: "server",
      platform: "macos",
      dbPath: "/Users/test/.tidegap/queue.sqlite",
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
      dbPath: "/srv/.tidegap/queue.sqlite",
      dryRun: true,
    });
    expect(r.helperPath).toBe("");
    expect(r.helperContent).toBe("");
    expect(r.nextSteps).not.toContain("register-wake");
  });

  it("mentions the ~/.config/tidegap/env secrets path in next-steps", async () => {
    const r = await runInstall({
      mode: "server",
      platform: "macos",
      launcher: LAUNCHER,
      dbPath: "/srv/.tidegap/queue.sqlite",
      dryRun: true,
    });
    expect(r.envFilePath).toContain(".config/tidegap/env");
    expect(r.nextSteps).toContain(".config/tidegap/env");
    expect(r.nextSteps).toContain("ANTHROPIC_API_KEY");
  });
});

describe("tidegap install (linux, dry-run)", () => {
  it("produces a service + timer + helper for --laptop", async () => {
    const r = await runInstall({
      mode: "laptop",
      platform: "linux",
      launcher: LAUNCHER,
      dbPath: "/var/lib/tidegap/queue.sqlite",
      tickIntervalSec: 300,
      dryRun: true,
    });
    expect(r.platform).toBe("linux");
    expect(r.plistContent).toBe("");
    expect(r.servicePath).toContain(".config/systemd/user/tidegap-tick.service");
    expect(r.timerPath).toContain(".config/systemd/user/tidegap-tick.timer");
    expect(r.serviceContent).toContain(
      "ExecStart=/usr/bin/node /opt/tidegap/dist/index.js tick --db /var/lib/tidegap/queue.sqlite --once",
    );
    expect(r.serviceContent).not.toContain("/usr/local/bin/tidegap");
    expect(r.serviceContent).toContain("EnvironmentFile=-%h/.config/tidegap/env");
    expect(r.timerContent).toContain("OnUnitActiveSec=300s");
    expect(r.helperPath).toContain(".tidegap/laptop-wake.sh");
    expect(r.helperContent).toContain("register-wake");
    expect(r.nextSteps).toContain(
      "systemctl --user daemon-reload && systemctl --user enable --now tidegap-tick.timer",
    );
  });

  it("omits the wake helper for --server", async () => {
    const r = await runInstall({
      mode: "server",
      platform: "linux",
      launcher: LAUNCHER,
      dbPath: "/srv/.tidegap/queue.sqlite",
      dryRun: true,
    });
    expect(r.helperPath).toBe("");
    expect(r.helperContent).toBe("");
    expect(r.nextSteps).not.toContain("register-wake");
    expect(r.serviceContent).toContain("ExecStart=");
  });
});

describe("tidegap install (windows = template only)", () => {
  it("returns an honest schtasks template built from the launcher", async () => {
    const r = await runInstall({
      mode: "server",
      platform: "windows",
      launcher: ["C:\\Program Files\\nodejs\\node.exe", "C:\\tidegap\\index.js"],
      dbPath: "C:\\ProgramData\\tidegap\\queue.sqlite",
      dryRun: true,
    });
    expect(r.plistContent).toBe("");
    expect(r.nextSteps.toLowerCase()).toContain("schtasks");
    expect(r.nextSteps.toLowerCase()).toContain("not supported");
    // No leftover POSIX path, no "planned for v0.5".
    expect(r.nextSteps).not.toContain("/usr/local/bin/tidegap");
    expect(r.nextSteps).not.toContain("v0.5");
    expect(r.nextSteps).toContain("index.js");
  });
});

describe("tidegap install laptop helper script", () => {
  it("skips the header AND the separator row (tail -n +3, not +2)", async () => {
    const r = await runInstall({
      mode: "laptop",
      platform: "macos",
      launcher: LAUNCHER,
      dbPath: "/Users/test/.tidegap/queue.sqlite",
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

  it("shell-quotes each launcher token into a TIDEGAP array", async () => {
    const r = await runInstall({
      mode: "laptop",
      platform: "macos",
      launcher: LAUNCHER,
      dbPath: "/Users/test/.tidegap/queue.sqlite",
      dryRun: true,
    });
    expect(r.helperContent).toContain(`TIDEGAP=('/usr/bin/node' '/opt/tidegap/dist/index.js')`);
    expect(r.helperContent).toContain(`"\${TIDEGAP[@]}"`);
  });
});

describe("tidegap install through the @ebb-ai/cli shim", () => {
  it("warns that the unit would pin a script inside @ebb-ai/cli", async () => {
    const { mkdtempSync, mkdirSync, writeFileSync, rmSync } = await import("node:fs");
    const { join } = await import("node:path");
    const { tmpdir } = await import("node:os");
    const { resolveLauncher } = await import("../src/commands/install.js");
    const root = mkdtempSync(join(tmpdir(), "tidegap-shim-"));
    const entry = join(root, "node_modules", "@ebb-ai", "cli", "node_modules", "@tidegap", "cli", "dist", "index.js");
    mkdirSync(join(entry, ".."), { recursive: true });
    writeFileSync(entry, "");
    const saved = process.argv[1];
    process.argv[1] = entry;
    try {
      const warnings: string[] = [];
      resolveLauncher(undefined, warnings);
      expect(warnings.some((w) => w.includes("@ebb-ai/cli") && w.includes("npm install -g @tidegap/cli"))).toBe(true);
    } finally {
      process.argv[1] = saved;
      rmSync(root, { recursive: true, force: true });
    }
  });
});
