import { describe, expect, it } from "vitest";
import {
  formatPmsetDate,
  launchdPlist,
  pmsetCommand,
} from "../src/platform/macos.js";

describe("formatPmsetDate", () => {
  it("pads single-digit components and uses MM/dd/yy HH:mm:ss", () => {
    expect(formatPmsetDate(new Date("2026-05-13T03:07:09Z"))).toMatch(
      /^\d{2}\/\d{2}\/26 \d{2}:\d{2}:\d{2}$/,
    );
  });

  it("is stable for a fixed UTC input in any local timezone", () => {
    const d = new Date(2026, 4, 13, 3, 7, 9);
    expect(formatPmsetDate(d)).toBe("05/13/26 03:07:09");
  });
});

describe("pmsetCommand", () => {
  it("builds the exact shell-quoted command", () => {
    const d = new Date(2026, 4, 13, 3, 7, 9);
    expect(pmsetCommand(d)).toBe('pmset schedule wake "05/13/26 03:07:09"');
  });
});

describe("launchdPlist", () => {
  it("renders a complete plist for laptop install", () => {
    const xml = launchdPlist({
      tickIntervalSec: 300,
      ebbBinaryPath: "/usr/local/bin/ebb",
      dbPath: "/Users/test/.ebb/queue.sqlite",
      logPath: "/Users/test/.ebb/tick.log",
    });
    expect(xml).toContain("<key>Label</key>");
    expect(xml).toContain("<string>com.ebb-ai.tick</string>");
    expect(xml).toContain("<string>/usr/local/bin/ebb</string>");
    expect(xml).toContain("<string>tick</string>");
    expect(xml).toContain("<string>--once</string>");
    expect(xml).toContain("<integer>300</integer>");
    expect(xml).toContain("<true/>");
    expect(xml).toContain("/Users/test/.ebb/queue.sqlite");
    expect(xml).toContain("/Users/test/.ebb/tick.log");
  });

  it("XML-escapes paths that contain & < > characters", () => {
    const xml = launchdPlist({
      tickIntervalSec: 60,
      ebbBinaryPath: "/usr/bin/ebb",
      dbPath: "/tmp/a&b/<x>/queue.sqlite",
    });
    expect(xml).toContain("a&amp;b");
    expect(xml).toContain("&lt;x&gt;");
    expect(xml).not.toContain("<x>");
    expect(xml).not.toContain("a&b/");
  });

  it("emits an EnvironmentVariables block when env is supplied", () => {
    const xml = launchdPlist({
      tickIntervalSec: 60,
      ebbBinaryPath: "/usr/bin/ebb",
      dbPath: "/tmp/q.sqlite",
      env: { ANTHROPIC_API_KEY: "sk-test", FOO: "bar" },
    });
    expect(xml).toContain("<key>EnvironmentVariables</key>");
    expect(xml).toContain("<key>ANTHROPIC_API_KEY</key>");
    expect(xml).toContain("<string>sk-test</string>");
    expect(xml).toContain("<key>FOO</key>");
  });

  it("omits EnvironmentVariables when env is not supplied", () => {
    const xml = launchdPlist({
      tickIntervalSec: 60,
      ebbBinaryPath: "/usr/bin/ebb",
      dbPath: "/tmp/q.sqlite",
    });
    expect(xml).not.toContain("<key>EnvironmentVariables</key>");
  });

  it("clamps tickIntervalSec to at least 1 second", () => {
    const xml = launchdPlist({
      tickIntervalSec: 0,
      ebbBinaryPath: "/usr/bin/ebb",
      dbPath: "/tmp/q.sqlite",
    });
    expect(xml).toContain("<integer>1</integer>");
  });
});
