import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";

import { readCliVersion, buildProgram } from "../src/index.js";

const pkg = JSON.parse(
  readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), "..", "package.json"),
    "utf8",
  ),
) as { version: string };

describe("CLI version", () => {
  it("reads the version from package.json (no hardcoded constant)", () => {
    expect(readCliVersion()).toBe(pkg.version);
  });

  it("wires that version into the commander program", () => {
    expect(buildProgram().version()).toBe(pkg.version);
  });
});
