// Tests for scripts/check-versions.mjs --tag (node --test).
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const script = fileURLToPath(new URL("./check-versions.mjs", import.meta.url));
const version = JSON.parse(
  readFileSync(new URL("../packages/core-ts/package.json", import.meta.url), "utf8"),
).version;
const run = (...args) => spawnSync(process.execPath, [script, ...args], { encoding: "utf8" });

test("no --tag: lockstep check only", () => {
  const r = run();
  assert.equal(r.status, 0, r.stderr);
  assert.doesNotMatch(r.stdout, /tag/);
});

test("--tag v<version> passes", () => {
  const r = run("--tag", `v${version}`);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, new RegExp(`tag v${version.replace(/\./g, "\\.")} matches`));
});

test("--tag=v<version> passes", () => {
  assert.equal(run(`--tag=v${version}`).status, 0);
});

test("a different version fails and names both", () => {
  const r = run("--tag", "v0.0.0");
  assert.equal(r.status, 1);
  assert.match(r.stderr, /tag v0\.0\.0 does not match v/);
});

test("--tag=<other> fails", () => {
  assert.equal(run("--tag=v0.0.0").status, 1);
});

test("a tag without the v prefix fails", () => {
  assert.equal(run("--tag", version).status, 1);
});

test("--tag with no value fails", () => {
  assert.equal(run("--tag").status, 1);
  assert.equal(run("--tag", "--other").status, 1);
  assert.equal(run("--tag=").status, 1);
});

test("a misspelled or repeated tag option fails", () => {
  assert.equal(run("--tags", `v${version}`).status, 1);
  assert.equal(run("--tag", `v${version}`, "--tag", `v${version}`).status, 1);
});
