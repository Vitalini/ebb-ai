---
title: Brand assets are generated from a raster reference, committed, and drift-checked by re-running the generator
date: 2026-10-16
category: tooling-decisions
module: scripts/build-brand.mjs, scripts/render-images.mjs, scripts/check-images.mjs, assets/brand
problem_type: tooling_decision
component: tooling
severity: medium
applies_when:
  - "Changing the logo geometry, palette or wordmark, or re-deriving vector brand files from a raster"
  - "Adding a generated output (SVG, snippet, PNG, ICO) that is committed to the repo"
  - "Changing the site header logo or the Open Graph image"
  - "Tempted to make a drift check hash only the generator inputs"
root_cause: missing_tooling
resolution_type: tooling_addition
tags: [brand, logo, svg, opentype, favicon, drift-check, og-image]
---

# Brand assets are generated from a raster reference, committed, and drift-checked by re-running the generator

## Context

PR #56 put the Tidegap logo everywhere. The only source was a 1254x1254 raster picked by Vitalii. A raster cannot serve a 16 px favicon or a 1600 px banner, so the PR rebuilt it as vector. The plan is `docs/plans/2026-10-16-1256-feat-brand-logo-plan.md`. It extends the image pipeline in `docs/solutions/tooling-decisions/rendered-repo-images-and-brand-name.md`.

## Guidance

**Measure the reference; do not assume.** The brief said round caps, a sine wave and approximate colours. All three were wrong.
- The reference ends are flat cuts on the midline, the same line where the teal starts. The generator clips the ink path at the midline.
- A sine fit was rejected. The reference slopes are steeper (about 56 degrees at the midline against 52), and the crests are flatter. The wave is a crest arc, a straight tangent segment and a trough arc.
- Colours come from the mode of each region of the reference: navy `#0C1017`, off-white `#FAFAFA`, teal `#5FC6C4`. The two halves of the reference gave `#61C8C7` and `#5CC2C2`; the constant sits between them.
- Constants (`STROKE_HEAVY`, slope, tracking) are tuned against a compare sheet: reference and render at one scale, a 50 % overlay, and the favicon at 16 and 32 px. The sheet is a scratch script and is not committed.

**Two stroke weights.** Lockups use the reference ratio (stroke/period about 0.078). The mark and icon use `STROKE_HEAVY` (about 0.18), because the thin wave disappears at 16 px.

**Text becomes paths at build time.** `opentype.js` (pinned exactly, `1.3.4`) reads the vendored `assets/brand/fonts/Poppins-Medium.ttf` (OFL, with `OFL.txt` beside it). The script lays out glyphs one by one: advance width, kern pair, and a tracking constant. It does not depend on `getPath` layout options. No brand SVG contains `<text>` or a font reference, so no output depends on an installed font. Do not swap the font silently if a letterform differs from the reference; that is a stop condition.

**The generator's outputs are committed, and the check re-runs the generator.** `pnpm gen:brand:check` runs `scripts/build-brand.mjs` and then `git diff --exit-code` over every output. It runs in `pnpm preflight` and on the CI node 22 leg only. The `data-ssot` job runs without `pnpm install`, so it cannot run `opentype.js`.
- The review found a P2: a render-only run recorded brand hashes from the files already in the tree. Stale outputs then passed `gen:images:check`, because the lock hashed the stale files themselves. Hashing inputs and outputs does not prove the outputs come from the inputs.
- Fix: `scripts/render-images.mjs` runs the generator first, then renders and writes the lock. `pnpm gen:images` does the same through its script order.
- The proof that the check works: change `STROKE_HEAVY`, and `gen:brand:check` exits 1.

**`favicon.ico` needs no library.** An ICO can hold PNG entries. `render-images.mjs` renders 16, 32 and 48 px PNGs from `tidegap-icon.svg` and packs them with Node built-ins: a 6-byte header, one 16-byte directory entry per image, then the PNG bytes. `check-images.mjs` reads the directory and fails if the entry sizes are not 16, 32, 48, or if the file is a plain PNG.

**Cache-bust the OG image by URL.** The metadata uses `/og-image.png?v=logo` while the file path stays. X, Slack and LinkedIn key their card cache on the image URL, so links already shared keep the old text-wordmark card until the URL changes. Change the `v` value on the next logo change.

**Header on a 375 px screen.** The logo in `apps/web/src/components/nav.tsx` is `h-[18px]` below `sm` and `h-[22px]` from `sm`, inside a `shrink-0` link, next to the nav links. Check the header at 375 and 1280 px after any logo or link change. The mark and wordmark together are wider than the old "~" tile, and the row must not scroll sideways.

## When to Apply

- After any edit to `build-brand.mjs`, the font, or a palette constant: run `pnpm gen:brand && pnpm gen:images`, commit all outputs and the lock together.
- A CI failure in `gen:brand:check` means a committed output differs from a fresh generation. Regenerate; do not edit outputs by hand.
- Known gaps from the review, not fixed: no `node --test` file covers the tamper cases of `check-images.mjs`, and no test checks that the `server.json` icon URLs map to files in `apps/web/public`.

## Related

- docs/solutions/tooling-decisions/rendered-repo-images-and-brand-name.md (hash-only check for pixels; this doc covers the generated vector layer)
- docs/solutions/tooling-decisions/version-lockstep-check.md
