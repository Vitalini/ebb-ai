/**
 * 0.17 compatibility on the CLI host (plan U2): EBB_* fallback, the
 * ~/.config/ebb/env secrets file, the daemon units and the data dir under a
 * temp home.
 */
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { runInstall } from "../src/commands/install.js";
import { ensureEnvFile, envFilePath, legacyEnvFilePath, resolveEnvFilePath } from "../src/commands/env-file.js";
import { readEnvCredentials } from "../src/env.js";
import { daemonStatus } from "../src/platform/index.js";

const LAUNCHER = ["/usr/bin/node", "/opt/tidegap/dist/index.js"];
const NAMES = ["EIA_API_KEY", "CARBON_BUDGET_G", "BINARY"] as const;

describe("EBB_* fallback (CLI)", () => {
  const saved = new Map<string, string | undefined>();
  beforeEach(() => {
    for (const n of NAMES) {
      for (const key of [`TIDEGAP_${n}`, `EBB_${n}`]) {
        saved.set(key, process.env[key]);
        delete process.env[key];
      }
    }
  });
  afterEach(() => {
    for (const [key, value] of saved) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    saved.clear();
  });

  it("only EBB_EIA_API_KEY: the key, and one line naming it", () => {
    process.env.EBB_EIA_API_KEY = "old";
    const lines: string[] = [];
    expect(readEnvCredentials((l) => lines.push(l)).grid.eiaApiKey).toBe("old");
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("EBB_EIA_API_KEY");
    expect(lines[0]).toContain("TIDEGAP_EIA_API_KEY");
  });

  it("both set: the TIDEGAP_ value and no line", () => {
    process.env.EBB_EIA_API_KEY = "old";
    process.env.TIDEGAP_EIA_API_KEY = "new";
    const lines: string[] = [];
    expect(readEnvCredentials((l) => lines.push(l)).grid.eiaApiKey).toBe("new");
    expect(lines).toEqual([]);
  });

  it("neither set: undefined and no line", () => {
    const lines: string[] = [];
    const env = readEnvCredentials((l) => lines.push(l));
    expect(env.grid.eiaApiKey).toBeUndefined();
    expect(env.carbonBudget.TIDEGAP_CARBON_BUDGET_G).toBeUndefined();
    expect(lines).toEqual([]);
  });

  it("several fallbacks still make one line", () => {
    process.env.EBB_EIA_API_KEY = "k";
    process.env.EBB_CARBON_BUDGET_G = "500";
    process.env.EBB_BINARY = "/usr/local/bin/tidegap";
    const lines: string[] = [];
    const env = readEnvCredentials((l) => lines.push(l));
    expect(env.carbonBudget.TIDEGAP_CARBON_BUDGET_G).toBe("500");
    expect(env.binary).toBe("/usr/local/bin/tidegap");
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/EBB_EIA_API_KEY.*EBB_CARBON_BUDGET_G.*EBB_BINARY/);
  });
});

describe("secrets file", () => {
  let home: string;
  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "tidegap-secrets-"));
  });
  afterEach(() => rmSync(home, { recursive: true, force: true }));

  it("only ~/.config/ebb/env: tick reads it; ensureEnvFile copies it 0600", () => {
    const legacy = legacyEnvFilePath(home);
    mkdirSync(join(home, ".config", "ebb"), { recursive: true });
    writeFileSync(legacy, "ANTHROPIC_API_KEY=sk-old\n", { mode: 0o644 });
    expect(resolveEnvFilePath(home)).toBe(legacy);

    const r = ensureEnvFile(envFilePath(home), legacy);
    expect(r).toEqual({ path: envFilePath(home), created: true, copiedFrom: legacy });
    expect(readFileSync(envFilePath(home), "utf8")).toBe("ANTHROPIC_API_KEY=sk-old\n");
    expect(statSync(envFilePath(home)).mode & 0o777).toBe(0o600);
    expect(existsSync(legacy)).toBe(true);
    expect(resolveEnvFilePath(home)).toBe(envFilePath(home));
  });

  it("neither file: the new path", () => {
    expect(resolveEnvFilePath(home)).toBe(envFilePath(home));
  });
});

describe("tidegap install with a 0.17 home", () => {
  let home: string;
  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "tidegap-install-"));
  });
  afterEach(() => rmSync(home, { recursive: true, force: true }));

  for (const platform of ["macos", "linux"] as const) {
    it(`${platform}: an empty home gets ~/.tidegap/logs before the unit is written`, async () => {
      const r = await runInstall({ mode: "server", platform, launcher: LAUNCHER, home });
      expect(lstatSync(join(home, ".tidegap", "logs")).isDirectory()).toBe(true);
      expect(r.logPath).toBe(join(home, ".tidegap", "logs", "tick.log"));
      const unit = platform === "macos" ? r.plistContent : r.serviceContent;
      expect(unit).toContain(join(home, ".tidegap", "logs", "tick.log"));
      expect(unit).toContain(join(home, ".tidegap", "queue.db"));
    });
  }

  it("macOS with an old com.ebb-ai.tick.plist: writes the new plist and prints the cleanup", async () => {
    const agents = join(home, "Library", "LaunchAgents");
    mkdirSync(agents, { recursive: true });
    const old = join(agents, "com.ebb-ai.tick.plist");
    writeFileSync(old, "<plist/>");
    const r = await runInstall({ mode: "server", platform: "macos", launcher: LAUNCHER, home });
    expect(existsSync(join(agents, "com.tidegap.tick.plist"))).toBe(true);
    expect(existsSync(old)).toBe(true);
    expect(r.nextSteps).toContain(`launchctl unload ${old}`);
    expect(r.nextSteps).toContain(`rm ${old}`);
  });

  it("macOS without an old plist: no cleanup lines", async () => {
    const r = await runInstall({ mode: "server", platform: "macos", launcher: LAUNCHER, home });
    expect(r.nextSteps).not.toContain("launchctl unload");
    expect(r.nextSteps).not.toContain("com.ebb-ai");
  });

  it("Linux with an old ebb-tick.timer: prints disable and rm", async () => {
    const units = join(home, ".config", "systemd", "user");
    mkdirSync(units, { recursive: true });
    writeFileSync(join(units, "ebb-tick.timer"), "[Timer]");
    writeFileSync(join(units, "ebb-tick.service"), "[Service]");
    const r = await runInstall({ mode: "server", platform: "linux", launcher: LAUNCHER, home });
    expect(existsSync(join(units, "tidegap-tick.timer"))).toBe(true);
    expect(r.nextSteps).toContain("systemctl --user disable --now ebb-tick.timer");
    expect(r.nextSteps).toContain(`rm ${join(units, "ebb-tick.service")} ${join(units, "ebb-tick.timer")}`);
  });

  it("moves a 0.17 ~/.ebb-ai and copies the 0.17 secrets file", async () => {
    mkdirSync(join(home, ".ebb-ai"));
    writeFileSync(join(home, ".ebb-ai", "queue.db"), "Q");
    mkdirSync(join(home, ".config", "ebb"), { recursive: true });
    writeFileSync(join(home, ".config", "ebb", "env"), "OPENAI_API_KEY=o\n");
    const r = await runInstall({ mode: "server", platform: "linux", launcher: LAUNCHER, home });
    expect(readFileSync(join(home, ".tidegap", "queue.db"), "utf8")).toBe("Q");
    expect(lstatSync(join(home, ".ebb-ai")).isSymbolicLink()).toBe(true);
    expect(readFileSync(join(home, ".config", "tidegap", "env"), "utf8")).toBe("OPENAI_API_KEY=o\n");
    expect(r.nextSteps).toContain(`copied from ${join(home, ".config", "ebb", "env")}`);
  });
});

describe("daemonStatus", () => {
  const probe = (platform: NodeJS.Platform, present: string[]) =>
    daemonStatus({ platform, home: "/h", exists: (p) => present.includes(p) });

  it("macOS: new plist, old plist, neither", () => {
    expect(probe("darwin", ["/h/Library/LaunchAgents/com.tidegap.tick.plist"])).toBe("installed");
    expect(probe("darwin", ["/h/Library/LaunchAgents/com.ebb-ai.tick.plist"])).toBe("installed");
    expect(probe("darwin", [])).toBe("not_installed");
  });

  it("Linux: new timer, old timer, neither", () => {
    expect(probe("linux", ["/h/.config/systemd/user/tidegap-tick.timer"])).toBe("installed");
    expect(probe("linux", ["/h/.config/systemd/user/ebb-tick.timer"])).toBe("installed");
    expect(probe("linux", [])).toBe("not_installed");
  });
});
