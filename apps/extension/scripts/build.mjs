#!/usr/bin/env node
// Build the extension per target (KTD9): copy src/ and icons/ into
// dist/<target>/, write that target's manifest, and zip it.
//
//   node scripts/build.mjs                  chrome (also Edge), firefox and safari
//   node scripts/build.mjs firefox          one target
//   --out <dir>                             output folder (default: dist)
//
// No bundler: the sources are plain ES modules. The version follows the
// lockstep version in packages/core-ts/package.json.

import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
export const EXT_ROOT = resolve(here, "..");
const REPO_ROOT = resolve(EXT_ROOT, "../..");

export const TARGETS = ["chrome", "firefox", "safari"];

/** The lockstep version, e.g. "0.19.0". */
export function coreVersion() {
  return JSON.parse(readFileSync(join(REPO_ROOT, "packages/core-ts/package.json"), "utf8")).version;
}

/** The manifest for one target. A prerelease suffix is dropped from `version` (browsers take digits only). */
export function manifestFor(target, version) {
  const base = JSON.parse(readFileSync(join(EXT_ROOT, "src/manifest.base.json"), "utf8"));
  const numeric = version.split(/[-+]/)[0];
  const out = { ...base, version: numeric };
  if (target === "chrome") {
    out.background = { service_worker: "background.js", type: "module" };
    if (numeric !== version) out.version_name = version;
  } else if (target === "firefox") {
    out.background = { scripts: ["background.js"], type: "module" };
    out.browser_specific_settings = {
      gecko: {
        id: "extension@tidegap.com",
        strict_min_version: "121.0",
        // Tidegap collects nothing. Firefox before 140 ignores this key (a lint warning).
        data_collection_permissions: { required: ["none"] },
      },
    };
  } else if (target === "safari") {
    // Packaged into Tidegap.app by apps/macos/scripts/sync-safari-extension.sh.
    // Safari has no notifications API; the Mac app sends them instead (R15).
    out.background = { service_worker: "background.js", type: "module" };
    out.permissions = base.permissions.filter((p) => p !== "notifications");
  } else {
    throw new Error(`unknown target ${target}`);
  }
  return out;
}

export function zipName(target, version) {
  return `tidegap-extension-${target}-${version}.zip`;
}

/** Build the targets into `outDir`. Returns [{target, dir, zip}]. */
export function build({ targets = TARGETS, outDir = join(EXT_ROOT, "dist") } = {}) {
  const version = coreVersion();
  const results = [];
  for (const target of targets) {
    const dir = join(outDir, target);
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
    cpSync(join(EXT_ROOT, "src"), dir, {
      recursive: true,
      filter: (src) => !src.endsWith("manifest.base.json"),
    });
    cpSync(join(EXT_ROOT, "icons"), join(dir, "icons"), { recursive: true });
    writeFileSync(join(dir, "manifest.json"), `${JSON.stringify(manifestFor(target, version), null, 2)}\n`);
    const zip = join(outDir, zipName(target, version));
    rmSync(zip, { force: true });
    // -X drops extra file attributes; the archive root is the extension root.
    execFileSync("zip", ["-q", "-r", "-X", zip, "."], { cwd: dir });
    results.push({ target, dir, zip });
  }
  return results;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const outIdx = args.indexOf("--out");
  const outDir = outIdx >= 0 ? resolve(args[outIdx + 1]) : undefined;
  const named = args.filter((a, i) => !a.startsWith("--") && i !== outIdx + 1);
  const bad = named.filter((t) => !TARGETS.includes(t));
  if (bad.length) {
    console.error(`build: unknown target ${bad.join(", ")} (use ${TARGETS.join(", ")})`);
    process.exit(1);
  }
  if (!existsSync(join(EXT_ROOT, "icons/icon-128.png"))) {
    console.error("build: icons/ is missing (render them with scripts/render-app-icons.mjs).");
    process.exit(1);
  }
  for (const r of build({ targets: named.length ? named : TARGETS, outDir })) {
    console.log(`${r.target}: ${r.dir}\n${r.target}: ${r.zip}`);
  }
}
