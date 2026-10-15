#!/usr/bin/env node
// Drift check for the generated repo and site images (Node built-ins only;
// runs in CI without `pnpm install` and without a browser).
//
// `scripts/render-images.mjs` renders the PNGs on the maintainer's machine and
// records them in `assets/images.lock.json`. This check fails when:
//   - a template, the render script or the forecast data changed without a
//     re-render (the inputs hash no longer matches the lock file);
//   - a committed PNG differs from the one recorded at render time (sha256);
//   - a PNG has the wrong dimensions (read from its IHDR chunk);
//   - assets/social-preview.png is 1 MB or larger (GitHub's upload limit).
//
// It does not re-render: pixel output depends on the OS font rasteriser and
// the Chrome build, so a re-render-and-diff would fail across machines. A
// change in how Chrome draws the same input is therefore not detected.

import { createHash } from "node:crypto";
import { readFileSync, realpathSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
export const LOCK_PATH = "assets/images.lock.json";
export const TEMPLATES_DIR = "assets/templates";
export const DATA_PATH = "docs/examples/2026-09-30-GB-tick/forecast.json";

export const OUTPUTS = {
  "assets/social-preview.png": { width: 1280, height: 640, template: "social-preview.html" },
  "assets/readme-hero.png": { width: 1600, height: 500, template: "readme-hero.html" },
  "apps/web/public/og-image.png": { width: 1200, height: 630, template: "og-image.html" },
};

const SOCIAL_PREVIEW_MAX_BYTES = 1024 * 1024;

// Exactly the files render-images.mjs reads. A directory listing would also
// pick up untracked files (.DS_Store, editor swap files) and break the hash.
export function inputPaths() {
  const templates = ["base.css", ...Object.values(OUTPUTS).map((spec) => spec.template)]
    .map((name) => `${TEMPLATES_DIR}/${name}`);
  return [...templates, "scripts/render-images.mjs", DATA_PATH].sort();
}

export function inputsSha256() {
  const hash = createHash("sha256");
  for (const path of inputPaths()) {
    hash.update(`${path}\0`);
    hash.update(readFileSync(join(ROOT, path)));
    hash.update("\0");
  }
  return hash.digest("hex");
}

export function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

export function pngSize(buffer) {
  const signature = "89504e470d0a1a0a";
  if (buffer.length < 24 || buffer.subarray(0, 8).toString("hex") !== signature) {
    return null;
  }
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

function check() {
  const fix = "run `pnpm gen:images` and commit the result";
  const problems = [];
  let lock;
  try {
    lock = JSON.parse(readFileSync(join(ROOT, LOCK_PATH), "utf8"));
  } catch (error) {
    console.error(`check-images: cannot read ${LOCK_PATH} (${error.message}); ${fix}`);
    process.exit(1);
  }

  const inputs = inputsSha256();
  if (lock.inputsSha256 !== inputs) {
    problems.push(
      `inputs hash ${inputs.slice(0, 12)} != lock ${String(lock.inputsSha256).slice(0, 12)} ` +
        `(one of ${inputPaths().join(", ")} changed since the last render)`,
    );
  }

  for (const [path, expected] of Object.entries(OUTPUTS)) {
    let buffer;
    try {
      buffer = readFileSync(join(ROOT, path));
    } catch {
      problems.push(`${path}: missing`);
      continue;
    }
    const size = pngSize(buffer);
    if (!size) {
      problems.push(`${path}: not a PNG`);
    } else if (size.width !== expected.width || size.height !== expected.height) {
      problems.push(
        `${path}: ${size.width}x${size.height}, expected ${expected.width}x${expected.height}`,
      );
    }
    const recorded = lock.outputs?.[path];
    if (!recorded) {
      problems.push(`${path}: not recorded in ${LOCK_PATH}`);
    } else if (recorded.sha256 !== sha256(buffer)) {
      problems.push(`${path}: sha256 differs from ${LOCK_PATH}`);
    }
    if (path === "assets/social-preview.png" && buffer.length >= SOCIAL_PREVIEW_MAX_BYTES) {
      problems.push(`${path}: ${buffer.length} bytes, must be under 1 MB`);
    }
  }

  if (problems.length > 0) {
    for (const problem of problems) console.error(`check-images: ${problem}`);
    console.error(`check-images: ${fix}`);
    process.exit(1);
  }
  console.log(`check-images: ${Object.keys(OUTPUTS).length} images match ${LOCK_PATH}`);
}

// realpath on both sides: a symlinked path (macOS /tmp) must still run the check.
if (
  process.argv[1] &&
  realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1])
) {
  check();
}
