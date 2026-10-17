import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { build, coreVersion, manifestFor, zipName } from "../scripts/build.mjs";

const version = coreVersion();
let out;
let results;

before(() => {
  out = mkdtempSync(join(tmpdir(), "tidegap-ext-build-"));
  results = Object.fromEntries(build({ outDir: out }).map((r) => [r.target, r]));
});
after(() => rmSync(out, { recursive: true, force: true }));

const manifest = (target) => JSON.parse(readFileSync(join(results[target].dir, "manifest.json"), "utf8"));

describe("build", () => {
  it("the Chrome manifest has a service worker and no background scripts", () => {
    const m = manifest("chrome");
    assert.equal(m.manifest_version, 3);
    assert.equal(m.background.service_worker, "background.js");
    assert.equal(m.background.scripts, undefined);
    assert.equal(m.browser_specific_settings, undefined);
  });

  it("the Firefox manifest has background scripts, the gecko id and min version 121", () => {
    const m = manifest("firefox");
    assert.deepEqual(m.background.scripts, ["background.js"]);
    assert.equal(m.background.service_worker, undefined);
    assert.equal(m.browser_specific_settings.gecko.id, "extension@tidegap.com");
    assert.equal(m.browser_specific_settings.gecko.strict_min_version, "121.0");
  });

  it("the Safari manifest has a service worker and no notifications permission", () => {
    const m = manifest("safari");
    assert.equal(m.background.service_worker, "background.js");
    assert.deepEqual([...m.permissions].sort(), ["alarms", "storage"]);
    assert.deepEqual(m.host_permissions, ["http://127.0.0.1/*"]);
  });

  for (const target of ["chrome", "firefox", "safari"]) {
    it(`${target}: version is the core version and every icon path exists`, () => {
      const m = manifest(target);
      assert.equal(m.version, version.split("-")[0]);
      const paths = [...Object.values(m.icons), ...Object.values(m.action.default_icon), m.action.default_popup, m.options_ui.page];
      for (const p of paths) assert.ok(existsSync(join(results[target].dir, p)), `${target}: ${p} is missing`);
      assert.ok(existsSync(join(results[target].dir, "background.js")));
      assert.ok(!existsSync(join(results[target].dir, "manifest.base.json")));
    });

    it(`${target}: asks for no broad permission`, () => {
      const m = manifest(target);
      const all = [...(m.permissions ?? []), ...(m.host_permissions ?? []), ...(m.optional_permissions ?? [])];
      for (const bad of ["<all_urls>", "tabs", "cookies"]) assert.ok(!all.includes(bad), `${target} asks for ${bad}`);
      assert.deepEqual(m.host_permissions, ["http://127.0.0.1/*"]);
      const expected = target === "safari" ? ["alarms", "storage"] : ["alarms", "notifications", "storage"];
      assert.deepEqual([...m.permissions].sort(), expected);
    });

    it(`${target}: zip is named by target and version, with manifest.json at its root`, () => {
      assert.equal(results[target].zip, join(out, zipName(target, version)));
      assert.equal(zipName(target, "1.2.3"), `tidegap-extension-${target}-1.2.3.zip`);
      const listing = execFileSync("unzip", ["-Z1", results[target].zip], { encoding: "utf8" }).split("\n");
      assert.ok(listing.includes("manifest.json"));
      assert.ok(listing.includes("popup/popup.html"));
    });
  }

  it("drops a prerelease suffix from the browser version", () => {
    assert.equal(manifestFor("chrome", "0.19.0-rc.1").version, "0.19.0");
    assert.equal(manifestFor("chrome", "0.19.0-rc.1").version_name, "0.19.0-rc.1");
    assert.equal(manifestFor("firefox", "0.19.0-rc.1").version, "0.19.0");
  });
});

describe("sources", () => {
  it("never build HTML from strings or use page storage", () => {
    const files = execFileSync("find", [join(import.meta.dirname, "../src"), "-name", "*.js"], { encoding: "utf8" }).trim().split("\n");
    const banned = /innerHTML|outerHTML|insertAdjacentHTML|document\.write|eval\(|new Function|localStorage|sessionStorage|document\.cookie/;
    for (const f of files) assert.ok(!banned.test(readFileSync(f, "utf8")), `${f} uses a banned API`);
  });
});
