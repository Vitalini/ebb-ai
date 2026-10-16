#!/usr/bin/env node
// Drift check for the generated repo and site images (Node built-ins only;
// runs in CI without `pnpm install` and without a browser).
//
// `scripts/render-images.mjs` renders the PNGs on the maintainer's machine and
// records them in `assets/images.lock.json`, together with the brand outputs
// that `scripts/build-brand.mjs` wrote just before. This check fails when:
//   - a template, the render script, a brand SVG it reads or the forecast data
//     changed without a re-render (the inputs hash no longer matches the lock);
//   - the brand generator or its font changed without a re-run (brand inputs
//     hash), or a brand SVG, `brand.generated.ts` or the `brand-mark` block in
//     the `tidegap ui` page differs from what the generator wrote (sha256);
//   - a committed image differs from the one recorded at render time (sha256);
//   - a PNG has the wrong dimensions (IHDR chunk; the logo PNGs are 2x their
//     SVG viewBox), or favicon.ico is not an ICO with 16, 32 and 48 px entries;
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

// Brand outputs written by scripts/build-brand.mjs.
export const BRAND = {
  script: "scripts/build-brand.mjs",
  font: "assets/brand/fonts/Poppins-Medium.ttf",
  svgs: {
    logoDark: "assets/brand/tidegap-logo-dark.svg",
    logoLight: "assets/brand/tidegap-logo-light.svg",
    mark: "assets/brand/tidegap-mark.svg",
    icon: "assets/brand/tidegap-icon.svg",
    webIcon: "apps/web/public/icon.svg",
  },
  module: "apps/web/src/lib/brand.generated.ts",
  uiHtml: "packages/cli/ui/index.html",
  uiStart: "<!-- brand-mark:start -->",
  uiEnd: "<!-- brand-mark:end -->",
};

// kind "card": an HTML template with the chart and the dark lockup;
// kind "svg": one brand SVG rendered alone (size fixed, or `scale` x viewBox);
// kind "ico": one brand SVG rendered at each size and packed into an ICO.
export const OUTPUTS = {
  "assets/social-preview.png": { kind: "card", width: 1280, height: 640, template: "social-preview.html" },
  "assets/readme-hero.png": { kind: "card", width: 1600, height: 500, template: "readme-hero.html" },
  "apps/web/public/og-image.png": { kind: "card", width: 1200, height: 630, template: "og-image.html" },
  "assets/brand/tidegap-logo-dark.png": { kind: "svg", source: BRAND.svgs.logoDark, scale: 2, transparent: true },
  "assets/brand/tidegap-logo-light.png": { kind: "svg", source: BRAND.svgs.logoLight, scale: 2, transparent: true },
  "apps/web/public/apple-touch-icon.png": { kind: "svg", source: BRAND.svgs.icon, width: 180, height: 180 },
  "apps/web/public/icon-192.png": { kind: "svg", source: BRAND.svgs.icon, width: 192, height: 192 },
  "apps/web/public/icon-512.png": { kind: "svg", source: BRAND.svgs.icon, width: 512, height: 512 },
  "apps/web/public/favicon.ico": { kind: "ico", source: BRAND.svgs.icon, sizes: [16, 32, 48] },
};

// The cards embed the dark lockup.
export const CARD_LOGO = BRAND.svgs.logoDark;

const SOCIAL_PREVIEW_MAX_BYTES = 1024 * 1024;

// Exactly the files render-images.mjs reads. A directory listing would also
// pick up untracked files (.DS_Store, editor swap files) and break the hash.
export function inputPaths() {
  const specs = Object.values(OUTPUTS);
  const templates = ["base.css", ...specs.filter((spec) => spec.template).map((spec) => spec.template)]
    .map((name) => `${TEMPLATES_DIR}/${name}`);
  const sources = specs.filter((spec) => spec.source).map((spec) => spec.source);
  return [...new Set([...templates, ...sources, CARD_LOGO, "scripts/render-images.mjs", DATA_PATH])].sort();
}

function hashFiles(paths) {
  const hash = createHash("sha256");
  for (const path of paths) {
    hash.update(`${path}\0`);
    hash.update(readFileSync(join(ROOT, path)));
    hash.update("\0");
  }
  return hash.digest("hex");
}

export function inputsSha256() {
  return hashFiles(inputPaths());
}

// Inputs of scripts/build-brand.mjs; its outputs are the brand SVGs, the site
// module and the `brand-mark` block of the `tidegap ui` page.
export const BRAND_INPUTS = [BRAND.script, BRAND.font];
export const BRAND_FILES = [...Object.values(BRAND.svgs), BRAND.module];

export function brandInputsSha256() {
  return hashFiles(BRAND_INPUTS);
}

// The text between the brand-mark markers, or null when a marker is missing.
export function uiBrandBlock() {
  const html = readFileSync(join(ROOT, BRAND.uiHtml), "utf8");
  const start = html.indexOf(BRAND.uiStart);
  const end = html.indexOf(BRAND.uiEnd);
  if (start < 0 || end < start) return null;
  return html.slice(start + BRAND.uiStart.length, end);
}

// The `brand` block of the lock file, computed from the tree.
export function brandRecord() {
  const block = uiBrandBlock();
  return {
    inputsSha256: brandInputsSha256(),
    outputs: Object.fromEntries(
      BRAND_FILES.map((path) => [path, { sha256: sha256(readFileSync(join(ROOT, path))) }]),
    ),
    uiBlock: { path: BRAND.uiHtml, sha256: block === null ? null : sha256(block) },
  };
}

// Width and height of a "card" or "svg" output.
export function expectedSize(spec) {
  if (!spec.scale) return { width: spec.width, height: spec.height };
  const svg = readFileSync(join(ROOT, spec.source), "utf8");
  const viewBox = /viewBox="[-\d.]+ [-\d.]+ ([\d.]+) ([\d.]+)"/.exec(svg);
  if (!viewBox) throw new Error(`${spec.source}: no viewBox`);
  return { width: Math.round(Number(viewBox[1]) * spec.scale), height: Math.round(Number(viewBox[2]) * spec.scale) };
}

export function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

// Entry sizes of an ICO file (0 in the directory means 256), or null.
export function icoSizes(buffer) {
  if (buffer.length < 6 || buffer.readUInt16LE(0) !== 0 || buffer.readUInt16LE(2) !== 1) return null;
  const count = buffer.readUInt16LE(4);
  if (buffer.length < 6 + 16 * count) return null;
  return Array.from({ length: count }, (_, i) => {
    const width = buffer[6 + 16 * i] || 256;
    const height = buffer[7 + 16 * i] || 256;
    return width === height ? width : `${width}x${height}`;
  });
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

  const brand = brandRecord();
  if (lock.brand?.inputsSha256 !== brand.inputsSha256) {
    problems.push(
      `brand inputs hash ${brand.inputsSha256.slice(0, 12)} != lock ` +
        `${String(lock.brand?.inputsSha256).slice(0, 12)} (${BRAND_INPUTS.join(" or ")} changed since the last run)`,
    );
  }
  for (const [path, { sha256: actual }] of Object.entries(brand.outputs)) {
    if (lock.brand?.outputs?.[path]?.sha256 !== actual) {
      problems.push(`${path}: sha256 differs from the brand block of ${LOCK_PATH}`);
    }
  }
  if (brand.uiBlock.sha256 === null) {
    problems.push(`${BRAND.uiHtml}: brand-mark block missing (${BRAND.uiStart} ... ${BRAND.uiEnd})`);
  } else if (lock.brand?.uiBlock?.sha256 !== brand.uiBlock.sha256) {
    problems.push(`${BRAND.uiHtml}: brand-mark block differs from the brand block of ${LOCK_PATH}`);
  }

  for (const [path, expected] of Object.entries(OUTPUTS)) {
    let buffer;
    try {
      buffer = readFileSync(join(ROOT, path));
    } catch {
      problems.push(`${path}: missing`);
      continue;
    }
    if (expected.kind === "ico") {
      const sizes = icoSizes(buffer);
      if (!sizes) {
        problems.push(`${path}: not an ICO`);
      } else if (sizes.join(",") !== expected.sizes.join(",")) {
        problems.push(`${path}: sizes ${sizes.join(", ")}, expected ${expected.sizes.join(", ")}`);
      }
    } else {
      const want = expectedSize(expected);
      const size = pngSize(buffer);
      if (!size) {
        problems.push(`${path}: not a PNG`);
      } else if (size.width !== want.width || size.height !== want.height) {
        problems.push(`${path}: ${size.width}x${size.height}, expected ${want.width}x${want.height}`);
      }
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
  console.log(
    `check-images: ${Object.keys(OUTPUTS).length} images and ${BRAND_FILES.length + 1} brand outputs match ${LOCK_PATH}`,
  );
}

// realpath on both sides: a symlinked path (macOS /tmp) must still run the check.
if (
  process.argv[1] &&
  realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1])
) {
  check();
}
