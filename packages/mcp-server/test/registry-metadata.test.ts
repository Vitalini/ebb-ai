/**
 * The MCP Registry rejects a publish whose `server.json` name differs from
 * the npm package's `mcpName`, or whose package identifier is not this
 * package. Pin both, plus the version lockstep inside server.json.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as {
  name: string;
  version: string;
  mcpName: string;
};
const server = JSON.parse(readFileSync(join(root, "server.json"), "utf8")) as {
  name: string;
  version: string;
  packages: Array<{ identifier: string; version: string }>;
};

describe("server.json", () => {
  it("name equals package.json mcpName", () => {
    expect(server.name).toBe(pkg.mcpName);
  });

  it("points at this npm package and version", () => {
    expect(server.packages[0]?.identifier).toBe(pkg.name);
    expect(server.packages[0]?.version).toBe(pkg.version);
    expect(server.version).toBe(pkg.version);
  });
});
