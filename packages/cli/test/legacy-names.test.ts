/**
 * 0.17 names on the CLI host since 0.19: a left-over EBB_* variable or
 * ~/.tidegap/config key is never used and is named in one stderr line; the
 * ~/.config/ebb/env secrets file and ~/.ebb-ai are no longer read; 0.17 daemon
 * units are still detected. All under a temp home.
 */
import { existsSync, lstatSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { runInstall } from "../src/commands/install.js";
import { ensureEnvFile, envFilePath, loadEnvFileIntoProcess, oldEnvFileNotice } from "../src/commands/env-file.js";
import { readEnvCredentials } from "../src/env.js";
import { daemonStatus } from "../src/platform/index.js";

const LAUNCHER = ["/usr/bin/node", "/opt/tidegap/dist/index.js"];
const NAMES = ["EIA_API_KEY", "CARBON_BUDGET_G", "BINARY"] as const;

describe("left-over EBB_* names (CLI)", () => {
  const saved = new Map<string, string | undefined>();
  const configPath = () => join(homedir(), ".tidegap", "config");
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
    rmSync(configPath(), { force: true });
  });

  it("only EBB_EIA_API_KEY: no key, and one line naming both names", () => {
    process.env.EBB_EIA_API_KEY = "old";
    const lines: string[] = [];
    expect(readEnvCredentials((l) => lines.push(l)).grid.eiaApiKey).toBeUndefined();
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("EBB_EIA_API_KEY");
    expect(lines[0]).toContain("TIDEGAP_EIA_API_KEY");
    expect(lines[0]).not.toContain("old");
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

  it("several left-over names make one line", () => {
    process.env.EBB_EIA_API_KEY = "k";
    process.env.EBB_CARBON_BUDGET_G = "500";
    process.env.EBB_BINARY = "/usr/local/bin/tidegap";
    const lines: string[] = [];
    const env = readEnvCredentials((l) => lines.push(l));
    expect(env.carbonBudget.TIDEGAP_CARBON_BUDGET_G).toBeUndefined();
    expect(env.binary).toBeUndefined();
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/EBB_EIA_API_KEY.*EBB_CARBON_BUDGET_G.*EBB_BINARY/);
  });

  it("an EBB_* key in the secrets file is loaded but never used, and is named", () => {
    const dir = mkdtempSync(join(tmpdir(), "tidegap-envfile-"));
    try {
      const file = join(dir, "env");
      writeFileSync(file, "EBB_EIA_API_KEY=k\n");
      expect(loadEnvFileIntoProcess(file)).toEqual(["EBB_EIA_API_KEY"]);
      const lines: string[] = [];
      expect(readEnvCredentials((l) => lines.push(l)).grid.eiaApiKey).toBeUndefined();
      expect(lines).toHaveLength(1);
      expect(lines[0]).toContain("EBB_EIA_API_KEY -> TIDEGAP_EIA_API_KEY");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("an EBB_* key in ~/.tidegap/config is named; TIDEGAP_* keys alone make no line", () => {
    mkdirSync(join(homedir(), ".tidegap"), { recursive: true });
    writeFileSync(configPath(), "EBB_CARBON_BUDGET_G=500\n");
    const lines: string[] = [];
    readEnvCredentials((l) => lines.push(l));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("EBB_CARBON_BUDGET_G -> TIDEGAP_CARBON_BUDGET_G");

    writeFileSync(configPath(), "TIDEGAP_CARBON_BUDGET_G=500\n");
    const none: string[] = [];
    readEnvCredentials((l) => none.push(l));
    expect(none).toEqual([]);
  });
});

describe("0.17 secrets file", () => {
  let home: string;
  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "tidegap-secrets-"));
  });
  afterEach(() => rmSync(home, { recursive: true, force: true }));

  it("only ~/.config/ebb/env: not copied, and named in the notice", () => {
    const old = join(home, ".config", "ebb", "env");
    mkdirSync(join(home, ".config", "ebb"), { recursive: true });
    writeFileSync(old, "ANTHROPIC_API_KEY=sk-old\n");
    expect(oldEnvFileNotice(home)).toContain(old);

    const r = ensureEnvFile(envFilePath(home));
    expect(r).toEqual({ path: envFilePath(home), created: true });
    expect(oldEnvFileNotice(home)).toBeUndefined();
  });

  it("neither file: no notice", () => {
    expect(oldEnvFileNotice(home)).toBeUndefined();
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

  it("leaves a 0.17 ~/.ebb-ai and ~/.config/ebb/env alone and warns about the secrets file", async () => {
    mkdirSync(join(home, ".ebb-ai"));
    writeFileSync(join(home, ".ebb-ai", "queue.db"), "Q");
    mkdirSync(join(home, ".config", "ebb"), { recursive: true });
    writeFileSync(join(home, ".config", "ebb", "env"), "OPENAI_API_KEY=o\n");
    const r = await runInstall({ mode: "server", platform: "linux", launcher: LAUNCHER, home });
    expect(existsSync(join(home, ".tidegap", "queue.db"))).toBe(false);
    expect(lstatSync(join(home, ".ebb-ai")).isSymbolicLink()).toBe(false);
    expect(r.nextSteps).toContain(`${join(home, ".config", "ebb", "env")} is no longer read`);
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
