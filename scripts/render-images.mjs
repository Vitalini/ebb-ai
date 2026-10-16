#!/usr/bin/env node
// Render the repo and site images from HTML templates, one real forecast and
// the brand SVGs that scripts/build-brand.mjs writes (`pnpm gen:images` runs
// the generator first).
//
//   assets/social-preview.png     1280x640  GitHub social preview (manual upload)
//   assets/readme-hero.png        1600x500  README hero
//   apps/web/public/og-image.png  1200x630  site Open Graph / Twitter card
//   assets/brand/tidegap-logo-{dark,light}.png   2x lockup, transparent
//   apps/web/public/{apple-touch-icon,icon-192,icon-512}.png  icon tile
//   apps/web/public/favicon.ico   16, 32, 48 px icon tile
//
// Inputs: assets/templates/*, this script, the brand SVGs listed in OUTPUTS and
// docs/examples/2026-09-30-GB-tick/forecast.json. The chart is computed from
// the data; every number on an image is backed by docs/claims.md row 31.
//
// Renderer: playwright-core driving the installed Google Chrome
// (`channel: "chrome"`), or the browser at TIDEGAP_CHROME_PATH. Fonts are the
// site's system stacks, so output bytes depend on the OS and the Chrome build;
// CI does not render, it runs scripts/check-images.mjs against the lock file
// this script writes.

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createRequire } from "node:module";
import { chromium } from "playwright-core";
import {
  CARD_LOGO,
  DATA_PATH,
  LOCK_PATH,
  OUTPUTS,
  ROOT,
  TEMPLATES_DIR,
  brandRecord,
  expectedSize,
  inputsSha256,
  pngSize,
  sha256,
} from "./check-images.mjs";

const CAPTION = "GB, 2026-09-30 · forecast (projected) · one run";

// The hour recommendWindow picked in this run (docs/examples/2026-09-30-GB-tick/
// output.txt line 16). It is a constant because the pick inside the clean band
// is random; the assertions below check it against the data.
const RECOMMENDED_AT = "2026-10-02T09:00:00.000Z";
const EXPECTED_PEAK = { at: "2026-10-01T17:00:00.000Z", value: 183 };
const EXPECTED_RECOMMENDED = 88;

// Per-image chart geometry, in CSS px (deviceScaleFactor 1).
const CHARTS = {
  "assets/social-preview.png": { width: 612, height: 404, label: 28, tick: 22, stroke: 4 },
  "assets/readme-hero.png": { width: 1040, height: 320, label: 30, tick: 24, stroke: 4 },
  "apps/web/public/og-image.png": { width: 572, height: 396, label: 27, tick: 22, stroke: 4 },
};

function loadForecast() {
  const { entries } = JSON.parse(readFileSync(join(ROOT, DATA_PATH), "utf8"));
  const points = entries.map((entry) => ({
    at: entry.datetime,
    value: entry.carbonIntensityGCo2PerKwh,
  }));

  const peak = points.reduce((best, point) => (point.value > best.value ? point : best));
  const min = Math.min(...points.map((point) => point.value));
  // Same rule as packages/core-ts/src/select-window.ts: the clean band is every
  // entry within max(cheapest x 0.15, 30) of the cheapest. Re-implemented here
  // so this script needs no build of @tidegap/core.
  const ceiling = min + Math.max(min * 0.15, 30);
  const bandIdx = points.flatMap((point, i) => (point.value <= ceiling ? [i] : []));
  const recIdx = points.findIndex((point) => point.at === RECOMMENDED_AT);

  const fail = (message) => {
    throw new Error(`render-images: ${message}; the image would not match docs/claims.md row 31`);
  };
  if (peak.at !== EXPECTED_PEAK.at || peak.value !== EXPECTED_PEAK.value) {
    fail(`peak is ${peak.value} at ${peak.at}, expected ${EXPECTED_PEAK.value} at ${EXPECTED_PEAK.at}`);
  }
  if (recIdx < 0 || points[recIdx].value !== EXPECTED_RECOMMENDED) {
    fail(`recommended entry ${RECOMMENDED_AT} is not ${EXPECTED_RECOMMENDED}`);
  }
  const bandStart = bandIdx[0];
  const bandEnd = bandIdx[bandIdx.length - 1];
  if (bandEnd - bandStart + 1 !== bandIdx.length) fail("the clean band is not contiguous");
  if (recIdx < bandStart || recIdx > bandEnd) fail("the recommended hour is outside the clean band");

  return { points, peakIdx: points.indexOf(peak), recIdx, bandStart, bandEnd };
}

const fmt = (n) => Number(n.toFixed(1));

function buildChart(data, { width, height, label, tick, stroke }) {
  const { points, peakIdx, recIdx, bandStart, bandEnd } = data;
  const dot = Math.round(label * 0.3);
  const top = Math.round(label * 1.7); // room for the "peak" label
  const bottom = height - Math.round(tick * 1.9); // room for the date ticks
  const left = dot;
  const right = width - dot;
  const peakValue = points[peakIdx].value;
  const x = (i) => fmt(left + ((right - left) * i) / (points.length - 1));
  const y = (v) => fmt(bottom - ((bottom - top) * v) / peakValue);

  const line = points.map((p, i) => `${i === 0 ? "M" : "L"}${x(i)} ${y(p.value)}`).join(" ");
  const area = `${line} L${x(points.length - 1)} ${bottom} L${x(0)} ${bottom} Z`;

  const ticks = points
    .map((p, i) => ({ p, i }))
    .filter(({ p }) => p.at.endsWith("T00:00:00.000Z"))
    .map(({ p, i }) => {
      const day = Number(p.at.slice(8, 10));
      const month = new Date(p.at).toLocaleString("en-GB", { month: "short", timeZone: "UTC" });
      return (
        `<line class="tick" x1="${x(i)}" y1="${bottom}" x2="${x(i)}" y2="${bottom + 8}" stroke-width="2"/>` +
        `<text class="tick-label" x="${x(i)}" y="${bottom + 8 + tick}" font-size="${tick}" text-anchor="middle">${day} ${month}</text>`
      );
    })
    .join("");

  const px = x(peakIdx);
  const py = y(peakValue);
  const rx = x(recIdx);
  const ry = y(points[recIdx].value);
  const recLabelY = fmt(ry + label * 1.55);
  const unitY = fmt(recLabelY + label * 1.05);

  return `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
<rect class="band" x="${x(bandStart)}" y="${top}" width="${fmt(x(bandEnd) - x(bandStart))}" height="${fmt(bottom - top)}"/>
<path class="area" d="${area}"/>
<line class="baseline" x1="${left}" y1="${bottom}" x2="${right}" y2="${bottom}" stroke-width="2"/>
${ticks}
<line class="rec-rule" x1="${rx}" y1="${ry}" x2="${rx}" y2="${bottom}" stroke-width="2"/>
<path class="curve" d="${line}" stroke-width="${stroke}"/>
<circle class="peak-dot" cx="${px}" cy="${py}" r="${dot}" stroke-width="3"/>
<circle class="rec-dot" cx="${rx}" cy="${ry}" r="${dot}" stroke-width="3"/>
<text class="mark-label peak-label" x="${px}" y="${fmt(py - label * 0.7)}" font-size="${label}" text-anchor="middle">peak ${peakValue}</text>
<text class="mark-label rec-label" x="${fmt(rx - label * 0.5)}" y="${recLabelY}" font-size="${label}" text-anchor="end">recommended ${points[recIdx].value}</text>
<text class="unit-label" x="${fmt(rx - label * 0.5)}" y="${unitY}" font-size="${fmt(label * 0.8)}" text-anchor="end">gCO₂/kWh</text>
</svg>`;
}

async function launch() {
  try {
    return await chromium.launch({ channel: "chrome" });
  } catch (channelError) {
    const path = process.env.TIDEGAP_CHROME_PATH;
    if (path) return chromium.launch({ executablePath: path });
    throw new Error(
      "render-images: cannot launch Google Chrome (channel \"chrome\"). Install Google Chrome, " +
        "or set TIDEGAP_CHROME_PATH to a Chrome/Chromium binary " +
        "(for example after `npx playwright-core install chromium`).\n" +
        channelError.message,
    );
  }
}

// One SVG alone on a bare page, drawn at width x height.
async function renderSvg(browser, source, { width, height, transparent = false }) {
  const svg = readFileSync(join(ROOT, source), "utf8").replace(
    /^<svg ([^>]*?)width="[\d.]+" height="[\d.]+"/,
    `<svg $1width="${width}" height="${height}"`,
  );
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
  await page.setContent(
    `<!doctype html><html><head><style>html,body{margin:0;background:transparent}svg{display:block}</style></head><body>${svg}</body></html>`,
    { waitUntil: "load" },
  );
  const png = await page.screenshot({ type: "png", omitBackground: transparent });
  await page.close();
  return png;
}

// PNG-in-ICO: 6-byte header, one 16-byte directory entry per image, then the PNGs.
function packIco(pngs) {
  const header = Buffer.alloc(6 + 16 * pngs.length);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(pngs.length, 4);
  let offset = header.length;
  pngs.forEach(({ size, png }, i) => {
    const at = 6 + 16 * i;
    header.writeUInt8(size >= 256 ? 0 : size, at);
    header.writeUInt8(size >= 256 ? 0 : size, at + 1);
    header.writeUInt16LE(1, at + 4); // colour planes
    header.writeUInt16LE(32, at + 6); // bits per pixel
    header.writeUInt32LE(png.length, at + 8);
    header.writeUInt32LE(offset, at + 12);
    offset += png.length;
  });
  return Buffer.concat([header, ...pngs.map(({ png }) => png)]);
}

async function renderCard(browser, data, css, logo, path, spec) {
  const template = readFileSync(join(ROOT, TEMPLATES_DIR, spec.template), "utf8");
  const html = template
    .replace("{{css}}", css)
    .replace("{{logo}}", logo)
    .replace("{{chart}}", buildChart(data, CHARTS[path]))
    .replace("{{caption}}", CAPTION);
  const page = await browser.newPage({
    viewport: { width: spec.width, height: spec.height },
    deviceScaleFactor: 1,
  });
  await page.setContent(html, { waitUntil: "load" });
  await page.evaluate(() => document.fonts.ready);
  const png = await page.screenshot({ type: "png", omitBackground: false });
  await page.close();
  return png;
}

async function main() {
  const data = loadForecast();
  const css = readFileSync(join(ROOT, TEMPLATES_DIR, "base.css"), "utf8");
  const require = createRequire(import.meta.url);
  const playwrightCore = require("playwright-core/package.json").version;

  const logo = readFileSync(join(ROOT, CARD_LOGO), "utf8");

  const browser = await launch();
  const outputs = {};
  try {
    for (const [path, spec] of Object.entries(OUTPUTS)) {
      if (spec.kind === "ico") {
        const pngs = [];
        for (const size of spec.sizes) {
          pngs.push({ size, png: await renderSvg(browser, spec.source, { width: size, height: size }) });
        }
        const ico = packIco(pngs);
        writeFileSync(join(ROOT, path), ico);
        outputs[path] = { sizes: spec.sizes, bytes: ico.length, sha256: sha256(ico) };
        console.log(`${path}  ${spec.sizes.join(",")}  ${ico.length} bytes`);
        continue;
      }

      const { width, height } = expectedSize(spec);
      const png =
        spec.kind === "card"
          ? await renderCard(browser, data, css, logo, path, spec)
          : await renderSvg(browser, spec.source, { width, height, transparent: spec.transparent });
      const size = pngSize(png);
      if (size?.width !== width || size?.height !== height) {
        throw new Error(`render-images: ${path} rendered at ${size?.width}x${size?.height}`);
      }
      writeFileSync(join(ROOT, path), png);
      outputs[path] = { width, height, bytes: png.length, sha256: sha256(png) };
      console.log(`${path}  ${width}x${height}  ${png.length} bytes`);
    }

    const lock = {
      inputsSha256: inputsSha256(),
      renderer: { playwrightCore, chrome: browser.version(), platform: process.platform },
      outputs,
      brand: brandRecord(),
    };
    writeFileSync(join(ROOT, LOCK_PATH), `${JSON.stringify(lock, null, 2)}\n`);
    console.log(`${LOCK_PATH}  written`);
  } finally {
    await browser.close();
  }
}

await main();
