#!/usr/bin/env node
/**
 * Lockstep version check, run first in `pnpm preflight`.
 *
 * `packages/core-ts/package.json` is the source of truth. Every published
 * manifest, the README status line and the newest dated CHANGELOG heading
 * must carry the same version; the script names each file that differs
 * and exits 1. Dependency-free (Node built-ins only).
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const repo = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (path) => readFileSync(join(repo, path), "utf8");
const json = (path) => JSON.parse(read(path));
const match = (path, re) => read(path).match(re)?.[1] ?? "(not found)";

const SOURCE = "packages/core-ts/package.json";
const expected = json(SOURCE).version;

const found = {
  "packages/cli/package.json": json("packages/cli/package.json").version,
  "packages/mcp-server/package.json": json("packages/mcp-server/package.json").version,
  "packages/openclaw-plugin/package.json": json("packages/openclaw-plugin/package.json").version,
  "packages/openclaw-plugin/openclaw.plugin.json": json("packages/openclaw-plugin/openclaw.plugin.json").version,
  "packages/claude-code-plugin/.claude-plugin/plugin.json": json("packages/claude-code-plugin/.claude-plugin/plugin.json").version,
  ".claude-plugin/marketplace.json": json(".claude-plugin/marketplace.json").plugins.find((p) => p.name === "ebb-ai")?.version ?? "(not found)",
  "packages/core-py/pyproject.toml": match("packages/core-py/pyproject.toml", /^version = "([^"]+)"/m),
  "README.md (status line)": match("README.md", /^> \*\*Status:\*\* v(\S+)/m),
  "CHANGELOG.md (newest dated heading)": match("CHANGELOG.md", /^## \[(\d[^\]]*)\] — \d{4}-\d{2}-\d{2}/m),
};

const mismatches = Object.entries(found).filter(([, version]) => version !== expected);
if (mismatches.length > 0) {
  console.error(`check-versions: expected ${expected} (from ${SOURCE})`);
  for (const [file, version] of mismatches) console.error(`  ${file}: ${version}`);
  process.exit(1);
}
console.log(`check-versions: ${expected} everywhere (${Object.keys(found).length + 1} files)`);
