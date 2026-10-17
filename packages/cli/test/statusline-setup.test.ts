/** `tidegap install`'s statusLine offer (D1). Only temp settings files are touched. */

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { offerStatuslineHook, statuslineCommand, statuslineSnippet } from "../src/commands/statusline-setup.js";

const LAUNCHER = ["/opt/node/bin/node", "/opt/lib/node_modules/@tidegap/cli/dist/index.js"];

describe("statusLine offer", () => {
  let dir: string;
  let path: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "tidegap-statusline-"));
    mkdirSync(join(dir, ".claude"));
    path = join(dir, ".claude", "settings.json");
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("a no writes nothing", async () => {
    const r = await offerStatuslineHook({ launcher: LAUNCHER, confirm: async () => false, settingsPath: path });
    expect(r.status).toBe("declined");
    expect(() => readFileSync(path)).toThrow();
  });

  it("a yes adds statusLine and keeps the other keys", async () => {
    writeFileSync(path, JSON.stringify({ model: "opus", hooks: { a: 1 } }));
    const r = await offerStatuslineHook({ launcher: LAUNCHER, confirm: async () => true, settingsPath: path });
    expect(r.status).toBe("registered");
    const s = JSON.parse(readFileSync(path, "utf8"));
    expect(s.model).toBe("opus");
    expect(s.hooks).toEqual({ a: 1 });
    expect(s.statusLine).toEqual({ type: "command", command: `${LAUNCHER.join(" ")} usage hook` });
  });

  it("wraps an existing statusLine command and keeps its other fields", async () => {
    writeFileSync(path, JSON.stringify({ statusLine: { type: "command", command: "bash ~/.claude/x.sh | head -1", padding: 2 } }));
    await offerStatuslineHook({ launcher: LAUNCHER, confirm: async () => true, settingsPath: path });
    const s = JSON.parse(readFileSync(path, "utf8"));
    expect(s.statusLine.padding).toBe(2);
    expect(s.statusLine.command).toBe(`${LAUNCHER.join(" ")} usage hook -- sh -c 'bash ~/.claude/x.sh | head -1'`);
  });

  it("already registered: no question", async () => {
    writeFileSync(path, JSON.stringify({ statusLine: { type: "command", command: statuslineCommand(["tidegap"]) } }));
    let asked = false;
    const r = await offerStatuslineHook({ launcher: LAUNCHER, confirm: async () => ((asked = true), true), settingsPath: path });
    expect(r.status).toBe("already");
    expect(asked).toBe(false);
  });

  it("an unparseable settings file is left alone", async () => {
    writeFileSync(path, "{ // comment\n}");
    const r = await offerStatuslineHook({ launcher: LAUNCHER, confirm: async () => true, settingsPath: path });
    expect(r.status).toBe("unreadable");
    expect(readFileSync(path, "utf8")).toBe("{ // comment\n}");
  });

  it("the manual snippet", () => {
    expect(JSON.parse(statuslineSnippet())).toEqual({ statusLine: { type: "command", command: "tidegap usage hook" } });
  });
});
