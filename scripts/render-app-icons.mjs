#!/usr/bin/env node
// Render the native client icons from the brand SVGs (native clients KTD13).
// The PNGs are committed; CI does not render them. Run again after a brand
// change (scripts/build-brand.mjs).
//
//   apps/extension/icons/icon-{16,32,48,128}.png         toolbar and store icons
//   apps/macos/Tidegap/Assets.xcassets/AppIcon.appiconset/     10 macOS sizes, 16-1024
//   apps/macos/Tidegap/Assets.xcassets/MenuBarIcon.imageset/   18 pt template, @1x and @2x
//
// Inputs: assets/brand/tidegap-icon.svg (dark tile) and assets/brand/tidegap-mark.svg
// (the wave; drawn black on transparent for the menu bar template image).
//
// Renderer: playwright-core driving the installed Google Chrome
// (`channel: "chrome"`), or the browser at TIDEGAP_CHROME_PATH, the same as
// scripts/render-images.mjs. These outputs are not in assets/images.lock.json.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const ICON_SVG = join(ROOT, "assets/brand/tidegap-icon.svg");
const MARK_SVG = join(ROOT, "assets/brand/tidegap-mark.svg");
const EXT_DIR = join(ROOT, "apps/extension/icons");
const ASSETS = join(ROOT, "apps/macos/Tidegap/Assets.xcassets");
const APPICON_DIR = join(ASSETS, "AppIcon.appiconset");
const MENUBAR_DIR = join(ASSETS, "MenuBarIcon.imageset");

const EXTENSION_SIZES = [16, 32, 48, 128];
// macOS App Icon slots: point size x scale.
const MAC_SLOTS = [16, 32, 128, 256, 512].flatMap((pt) => [
  { pt, scale: 1, px: pt, file: `icon_${pt}x${pt}.png` },
  { pt, scale: 2, px: pt * 2, file: `icon_${pt}x${pt}@2x.png` },
]);
const MENUBAR_PT = 18;

const svgUri = (svg) => `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;

/** The dark tile with rounded corners (the extension icons). */
function extensionHtml(px) {
  const r = Math.round(px * 0.18);
  return `<img src="${svgUri(readFileSync(ICON_SVG, "utf8"))}" width="${px}" height="${px}"
    style="display:block;border-radius:${r}px">`;
}

/**
 * macOS icon: the tile inset on a transparent canvas (824/1024) with the
 * Big Sur corner radius, so it sits with other Dock icons.
 */
function macHtml(px) {
  const tile = Math.round((px * 824) / 1024);
  const inset = Math.round((px - tile) / 2);
  const r = Math.round((tile * 185) / 824);
  return `<img src="${svgUri(readFileSync(ICON_SVG, "utf8"))}" width="${tile}" height="${tile}"
    style="display:block;margin:${inset}px;border-radius:${r}px">`;
}

/** Menu bar template: the wave in black on transparent; macOS tints it. */
function menubarHtml(px) {
  const mark = readFileSync(MARK_SVG, "utf8")
    .replace(/<style>[\s\S]*?<\/style>/, "")
    .replace(/stroke="#[0-9A-Fa-f]{6}"/g, 'stroke="#000000"')
    // Crop the empty band above and below the wave so it reads at 18 pt.
    .replace(/viewBox="0 0 64 64"/, 'viewBox="2 2 60 60"');
  return `<img src="${svgUri(mark)}" width="${px}" height="${px}" style="display:block">`;
}

async function launch() {
  try {
    return await chromium.launch({ channel: "chrome" });
  } catch (err) {
    const path = process.env.TIDEGAP_CHROME_PATH;
    if (path) return chromium.launch({ executablePath: path });
    throw new Error(
      "render-app-icons: Google Chrome not found; install it " +
        "or set TIDEGAP_CHROME_PATH to a Chrome/Chromium binary " +
        `(${err instanceof Error ? err.message.split("\n")[0] : err})`,
    );
  }
}

async function render(browser, html, px, out) {
  const page = await browser.newPage({ viewport: { width: px, height: px }, deviceScaleFactor: 1 });
  try {
    await page.setContent(
      `<!doctype html><html><head><style>html,body{margin:0;padding:0;background:transparent}</style></head><body>${html}</body></html>`,
    );
    await page.waitForFunction(() => [...document.images].every((i) => i.complete && i.naturalWidth > 0));
    const png = await page.screenshot({ type: "png", omitBackground: true, clip: { x: 0, y: 0, width: px, height: px } });
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, png);
    console.log(`${out.slice(ROOT.length + 1)}  ${px}x${px}`);
  } finally {
    await page.close();
  }
}

const json = (value) => `${JSON.stringify(value, null, 2)}\n`;
const INFO = { author: "xcode", version: 1 };

const browser = await launch();
try {
  for (const px of EXTENSION_SIZES) await render(browser, extensionHtml(px), px, join(EXT_DIR, `icon-${px}.png`));
  for (const s of MAC_SLOTS) await render(browser, macHtml(s.px), s.px, join(APPICON_DIR, s.file));
  for (const scale of [1, 2]) {
    const px = MENUBAR_PT * scale;
    await render(browser, menubarHtml(px), px, join(MENUBAR_DIR, `menubar${scale === 2 ? "@2x" : ""}.png`));
  }
} finally {
  await browser.close();
}

writeFileSync(
  join(APPICON_DIR, "Contents.json"),
  json({
    images: MAC_SLOTS.map((s) => ({ filename: s.file, idiom: "mac", scale: `${s.scale}x`, size: `${s.pt}x${s.pt}` })),
    info: INFO,
  }),
);
writeFileSync(
  join(MENUBAR_DIR, "Contents.json"),
  json({
    images: [
      { filename: "menubar.png", idiom: "universal", scale: "1x" },
      { filename: "menubar@2x.png", idiom: "universal", scale: "2x" },
      { idiom: "universal", scale: "3x" },
    ],
    info: INFO,
    properties: { "template-rendering-intent": "template" },
  }),
);
