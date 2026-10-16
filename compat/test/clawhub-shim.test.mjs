// Tests for the @vitalini/ebb 0.17.1 ClawHub pointer release.
// Run: node --test compat/test/clawhub-shim.test.mjs (no build needed)
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const shim = join(repo, "compat", "clawhub", "ebb");
const json = (p) => JSON.parse(readFileSync(join(repo, p), "utf8"));
const MESSAGE =
  "ebb was renamed to Tidegap. Install clawhub:@vitalini/tidegap and move your " +
  "plugins.entries.ebb config block to plugins.entries.tidegap. Tidegap moves " +
  "your ~/.ebb-ai queue to ~/.tidegap on first run; nothing else to migrate.";

function fakeApi(registrationMode) {
  const warnings = [];
  return { warnings, api: { registrationMode, logger: { info() {}, warn: (m) => warnings.push(m), error() {} } } };
}

test("manifest keeps runtime id ebb, declares no tools and accepts any config block", () => {
  const manifest = json("compat/clawhub/ebb/openclaw.plugin.json");
  const pkg = json("compat/clawhub/ebb/package.json");
  assert.equal(manifest.id, "ebb");
  assert.equal(manifest.version, "0.17.1");
  assert.equal(pkg.name, "@vitalini/ebb");
  assert.equal(pkg.version, "0.17.1");
  assert.equal(pkg.description, "Renamed to @vitalini/tidegap — https://github.com/tidegap/tidegap");
  assert.equal(manifest.contracts, undefined);
  assert.equal(manifest.configSchema.additionalProperties, true);
  assert.equal(manifest.configSchema.required, undefined);
  assert.deepEqual(Object.keys(pkg.dependencies ?? {}), []);
  assert.deepEqual(pkg.openclaw.extensions, ["./dist/index.js"]);
});

test("plugin entry accepts a 0.17 plugins.entries.ebb block and logs the pointer once", async () => {
  const { default: plugin } = await import(pathToFileURL(join(shim, "dist", "index.js")).href);
  assert.equal(plugin.id, "ebb");

  // Every key the 0.17 manifest declared still parses.
  const old = { dbPath: "/tmp/q.db", defaultRegion: "GB", eiaApiKey: "x", carbonBudgetG: 5, disableStartupDispatch: true };
  assert.deepEqual(plugin.configSchema.safeParse(old), { success: true, data: old });
  assert.equal(plugin.configSchema.safeParse(undefined).success, true);
  assert.equal(plugin.configSchema.safeParse("nope").success, false);

  const discovery = fakeApi("discovery");
  plugin.register(discovery.api);
  assert.deepEqual(discovery.warnings, []);

  const full = fakeApi("full");
  plugin.register(full.api);
  plugin.register(full.api);
  assert.deepEqual(full.warnings, [MESSAGE]);
});
