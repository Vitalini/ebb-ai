import { describe, expect, it } from "vitest";
import { TODO_NOTE, schtasksTemplate } from "../src/platform/windows.js";

describe("windows honesty (P16)", () => {
  it("TODO_NOTE states support is not available (no 'planned for v0.5')", () => {
    expect(TODO_NOTE).not.toContain("v0.5");
    expect(TODO_NOTE.toLowerCase()).toContain("not supported");
    expect(TODO_NOTE.toLowerCase()).toContain("task scheduler");
  });

  it("schtasks template builds from the resolved launcher, not a POSIX path", () => {
    const t = schtasksTemplate({
      launcher: ["C:\\Program Files\\nodejs\\node.exe", "C:\\ebb\\index.js"],
      dbPath: "C:\\ProgramData\\ebb\\queue.db",
      tickIntervalSec: 300,
    });
    expect(t).toContain("schtasks /create");
    expect(t).toContain("index.js");
    expect(t).toContain("tick");
    expect(t).not.toContain("/usr/local/bin/ebb");
    expect(t).not.toContain("planned for v0.5");
    // 300s → every 5 minutes.
    expect(t).toContain("/MO 5");
  });
});
