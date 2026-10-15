---
title: Repo and site images are rendered from real run data, drift-checked by hash, and the brand is "Ebb AI" in prose only
date: 2026-10-15
category: tooling-decisions
module: scripts/render-images.mjs, scripts/check-images.mjs, assets/templates
problem_type: tooling_decision
component: tooling
severity: medium
applies_when:
  - "Changing a template, the render script or the example forecast that feeds the README hero, social preview or Open Graph card"
  - "Adding a number or label to an image, or renaming the product in copy"
  - "Tempted to make CI re-render the PNGs and diff them"
root_cause: missing_tooling
resolution_type: tooling_addition
tags: [images, playwright, drift-check, claims, brand, og-image]
---

# Repo and site images are rendered from real run data, drift-checked by hash, and the brand is "Ebb AI" in prose only

## Context

PR #46 added three PNGs (social preview, README hero, OG card). All show one real GB forecast: `docs/examples/2026-09-30-GB-tick/forecast.json`. Every number on them must match `docs/claims.md` row 31. A hand-made image would drift from the data and from the claims.

## Guidance

**Render.** `pnpm gen:images` runs `scripts/render-images.mjs`. It uses `playwright-core` (exact pin 1.63.0) with the installed Chrome (`channel: "chrome"`, fallback `EBB_CHROME_PATH`). Templates live in `assets/templates/`. They use system font stacks and no network. Two renders on one machine give identical bytes.

**Labels come from data.** The chart is computed from the forecast. Before rendering, the script asserts peak 183 (2026-10-01 17:00Z), recommended 88 (2026-10-02 09:00Z), and that the recommended hour is inside the clean band (the `select-window.ts` rule). Mark labels take their numbers from the asserted values, not from template text. A failed assertion aborts the render, so an image cannot disagree with `docs/claims.md`. Adding a label means adding an assertion and a claims entry.

**Drift check hashes; it does not re-render.** `pnpm gen:images:check` (Node built-ins only) compares `assets/images.lock.json` to: the sha256 of the inputs, the sha256 and IHDR size of each PNG, and the 1 MB limit on the social preview. It runs in `pnpm preflight` and the CI `data-ssot` job.

Why not re-render in CI: pixels depend on the OS font rasteriser and the Chrome build. A CI render would differ from the maintainer's machine and fail for no real reason. The cost: a change in how Chrome draws the same input goes unnoticed. The script header states this.

**Hash exactly the files the renderer reads.** Use the explicit list (`base.css`, the three templates, the render script, the data file). The first version hashed the whole templates directory. A Finder `.DS_Store` or editor swap file then broke the hash, and a re-render recorded the junk, which failed CI. Also compare `realpathSync` values in the entry-point guard; a symlinked invocation otherwise exits 0 without checking anything.

**Brand rule.** "Ebb AI" is the display name in prose: README H1 and first sentence, package README headings, site title and metadata, JSON-LD names, nav wordmark, about page. `ebb-ai` stays in identifiers: package names, commands, URLs, paths, `docs/claims.md`. Do not run a global replace. Replace only prose, and check that URLs and code spans stayed intact.

**New OG URL.** The card is `/og-image.png`, not the old `/og.png`. A new URL forces X, Slack and LinkedIn to refetch their cached card. The old file was deleted.

## When to Apply

- After any edit to a template, `render-images.mjs` or the forecast data: run `pnpm gen:images`, commit the PNGs and the lock together.
- When the check fails on inputs but you changed nothing: look for stray files, not for a render bug.
- Upload the social preview to GitHub by hand; no API sets it.

## Related

- docs/solutions/best-practices/claims-audit-method.md
- docs/solutions/tooling-decisions/version-lockstep-check.md
