---
title: Repo and Site Images, and 0.17.0 Release Prep - Plan
type: feat
date: 2026-10-15
artifact_contract: ce-unified-plan/v1
product_contract_source: ce-plan-bootstrap
execution: code
---

# Repo and Site Images, and 0.17.0 Release Prep - Plan

## Goal Capsule

- **Objective:** A visitor who sees an ebb-ai link on GitHub, in Slack, on X or on the site gets one picture that says what ebb-ai does: one real GB forecast curve, the clean window and the recommended hour, with a label on every number. The images replace the stale site card (`apps/web/public/og.png` still says "v0.5", "169 tests", "8 MCP tools") and the default GitHub card.
- **Means:** One branch `feat/repo-images-0.17.0`, five commits in brief order (KTD1). A render script turns HTML templates and `docs/examples/2026-09-30-GB-tick/forecast.json` into three PNGs on the maintainer's Mac. A dependency-free check guards drift in CI. The last commit prepares 0.17.0 and publishes nothing.
- **Authority:** Vitalii's brief for this PR, then this plan, then `docs/claims.md`, then the scratchpad inputs `growth-drafts.md` section 1d (social preview spec) and the benchmark README `zhuravel/magnum`. Where the drafts and `docs/claims.md` disagree, `docs/claims.md` wins. Where this plan and the repo disagree, stop and report.
- **Stop conditions:** an image would carry a number with no row in `docs/claims.md`; the rendered PNG of `social-preview.png` is over 1 MB; any step would publish to npm, PyPI, ClawHub or the MCP Registry, tag, push to `main` or merge; a gate fails the same way twice.
- **Execution profile:** one worktree at `.worktrees/feat-repo-images-0.17.0`, sequential commits U1-U5. No fan-out: U2 and U5 both touch `README.md`; U5 touches every manifest.
- **Who finishes:** the pipeline stops at an open PR with green gates and one `ce-code-review` pass. Vitalii does the GitHub social-preview upload, the publish, the tag and the merge. A merge to `main` is a Vercel production deploy of `apps/web`.

---

## Product Contract

### Summary

Add a render script and three generated PNGs (GitHub social preview, README hero, site Open Graph card), wire the hero into the README and the card into the site metadata, record the manual social-preview upload step, and prepare release 0.17.0 from the current Unreleased entries plus the images.

### Problem Frame

The README has no image at the top; the benchmark README (`zhuravel/magnum`) opens with a centred image, then the H1, then one bold tagline and a few badges. The GitHub repo shows the default social card. The site Open Graph card `apps/web/public/og.png` dates from v0.5: it shows "169 tests passing", "8 MCP tools", "10 host integrations" and the old tagline. These numbers are stale (claims rows 13, 16, 18 say 1,115 tests, 9 tools, 13 hosts), so every link preview today shows numbers that `docs/claims.md` does not back. No image generator is available, so images must come from code in the repo and be re-renderable.

The Unreleased section of `CHANGELOG.md` holds the task-visibility work (`ebb ui`, notifications, SessionStart hook, `quota_reset`) that merged in PRs #44 and #45; 0.17.0 ships it.

### Requirements

**Render script (U1)**
- R1. `node scripts/render-images.mjs` writes `assets/social-preview.png` (1280×640), `assets/readme-hero.png` (1600×500) and `apps/web/public/og-image.png` (1200×630) from templates in `assets/templates/` and the data in `docs/examples/2026-09-30-GB-tick/forecast.json`. Two runs on the same machine give byte-identical PNGs.
- R2. Each image: dark background, the "ebb-ai" wordmark, one carbon-intensity curve from the GB run with the cleanest band highlighted, a "peak 183" mark (2026-10-01 17:00 UTC) and a "recommended 88" mark (2026-10-02 09:00 UTC), and the caption "GB, 2026-09-30 · forecast (projected) · one run". The social preview and the Open Graph card also carry the tagline and `npx -y @ebb-ai/mcp`. No external images, no network fetch at render time, no "%" figure.
- R3. `pnpm gen:images:check` fails when a template, the render script or the forecast data changed without a re-render, when a PNG has the wrong dimensions, or when a committed PNG differs from the one recorded at render time. It runs without Playwright and without network, in `pnpm preflight` and in CI.
- R4. Every number on an image has a row in `docs/claims.md`, and that row lists the image files under "Where it appears".

**README (U2)**
- R5. The README opens with the hero image above `# ebb-ai`, centred, with alt text; the existing text below it is unchanged.

**Site (U3)**
- R6. Every page of www.ebb-ai.com advertises `https://www.ebb-ai.com/og-image.png` as `og:image` and `twitter:image`, with `twitter:card = summary_large_image`. The stale `og.png` is gone.

**Social preview step (U4)**
- R7. `docs/internal/hub-submission-log.md` records that `assets/social-preview.png` must be uploaded in GitHub Settings > General > Social preview (web UI only), with the date.

**Release (U5)**
- R8. Every lockstep manifest, the README status line and a dated `## [0.17.0] — 2026-10-15` CHANGELOG heading say 0.17.0; `node scripts/check-versions.mjs` prints `0.17.0 everywhere (12 files)`. The CHANGELOG keeps the "reinstall the global CLI" upgrade note.

### Scope Boundaries

- The GitHub social-preview upload itself: web UI only, Vitalii's step.
- GitHub description and topics (`gh repo edit`): not in this PR.
- Package READMEs on npm/PyPI: no image. The root `README.md` is not in any npm `files` list (`packages/{core-ts,cli,mcp-server}/package.json` publish their own `README.md`), so the hero shows on GitHub only (KTD6).
- Site hero component, favicon (`apps/web/src/app/icon.svg`), `manifest.ts`: unchanged.
- Rendering in CI: CI checks; it does not render (KTD4).
- Publishing (npm, PyPI, ClawHub, MCP Registry), tags, merge.

### Sources

- Scratchpad `growth-drafts.md` section 1d "Social preview spec (1280×640 PNG, under 1 MB)".
- Benchmark README `https://github.com/zhuravel/magnum` (read via `gh api`): centred `<img>` above a centred H1, then one bold tagline, then badges.
- `docs/examples/2026-09-30-GB-tick/` (`forecast.json`, `output.txt`, `README.md`).
- `docs/claims.md` row 31 (183, 88 and their labels).
- `apps/web/src/app/globals.css` (site colour tokens and font stacks), `apps/web/src/app/layout.tsx` (metadata), `apps/web/src/app/about/page.tsx` (page-level `openGraph`).
- `scripts/check-versions.mjs`, `docs/solutions/tooling-decisions/version-lockstep-check.md`, `docs/solutions/developer-experience/worktree-environment-setup.md`, `docs/solutions/developer-experience/folding-review-fixes-into-commits.md`.
- Release-prep precedent: the 0.16.1 prep commit on `main` and plan `docs/plans/2026-10-15-1436-chore-growth-readme-0161-plan.md` (U8).

---

## Planning Contract

### Repo facts verified for this plan (2026-10-15, `main` @ 2561e2f)

| Brief claim / question | Repo fact |
|---|---|
| Playwright already a devDependency? | **No.** No `package.json` in the repo names `playwright`, `playwright-core` or `@playwright/test`; `node_modules/.pnpm` has none. A global Python Playwright 1.58.0 exists at `/opt/homebrew/bin/playwright` (not importable from Node). Google Chrome is installed in `/Applications`. |
| `assets/` exists? | **No.** U1 creates `assets/` and `assets/templates/`. |
| Where metadata lives | `apps/web/src/app/layout.tsx` root `metadata`: `metadataBase: new URL("https://www.ebb-ai.com")`, `openGraph.images` and `twitter.images` **already set** to `/og.png`, and `twitter.card` is **already** `summary_large_image`. |
| Existing og image | `apps/web/public/og.png`, 1200×630, last touched in commit `5e9f837`; content is stale (v0.5, 169 tests, 8 MCP tools, 10 hosts). Only other reference: a comment in `apps/web/src/proxy.ts:85`. |
| Page-level overrides | Only `apps/web/src/app/about/page.tsx` sets `openGraph` (no `images`). Next.js replaces the whole `openGraph` object per segment, so `/about` advertises no image today. No page sets `twitter`. |
| Fonts | The site uses system stacks only (`--font-sans: ui-sans-serif, system-ui, -apple-system, …`; `--font-mono: ui-monospace, "SF Mono", Menlo, …`); no `next/font`, no bundled font files. |
| Site colours | `--color-bg #07090c`, `--color-bg-elev #0d1218`, `--color-fg #e6e8ee`, `--color-fg-muted #8a93a6`, `--color-rule #1f2632`, `--color-accent #5eead4`, `--color-band-very-clean #34d399`, `--color-band-average #fbbf24`. |
| GB data | `forecast.json` has **51 hourly entries**, 2026-09-30T21:00Z to 2026-10-02T23:00Z (50 h), not 72. Max 183 at 2026-10-01T17:00Z; min 64 at 2026-10-02T12:00Z; 88 at 2026-10-02T09:00Z. `output.txt` line 16: `recommendWindow` chose `2026-10-02T09:00:00.000Z`, 88, deadline 2026-10-03T21:03Z. |
| Cleanest band | `packages/core-ts/src/select-window.ts`: tolerance `max(cheapest × 0.15, 30)`; with min 64 → 30 → band ≤ 94 → 2026-10-02T09:00Z to 16:00Z (8 entries, all `very_clean`). |
| Claims | Row 31 backs 183 and 88 ("forecast (projected), one GB run, 2026-09-30"). It lists README, `apps/web/src/app/docs/page.tsx` and the example README under "Where it appears". |
| Version files | `scripts/check-versions.mjs` checks 11 entries in 10 files plus the source `packages/core-ts/package.json`, and prints "(12 files)". All are at 0.16.1. |
| CHANGELOG | `## [Unreleased]` has Added (task titles/read state, `quota_reset`, `ebb queue show`, `queue unread`, `queue list` columns, `last_tick_at`, `ebb ui`, desktop notifications, SessionStart hook), Changed, and "Upgrade note" (reinstall `@ebb-ai/cli`). Link refs at lines 1570-1571. |
| CI | `.github/workflows/ci.yml` job `data-ssot` runs Node 22 without `pnpm install`; it is the place for a dependency-free check. |

### Key Technical Decisions

- KTD1. **One commit per brief item, in brief order.** Review fixes fold into the commit they belong to (`docs/solutions/developer-experience/folding-review-fixes-into-commits.md`).
- KTD2. **Renderer: `playwright-core` as a root devDependency, driving the installed Google Chrome.** Nothing usable is installed in the repo, and the global Playwright is the Python package. `playwright-core` has no install script and downloads no browser. The script launches `chromium.launch({ channel: "chrome" })`; if that fails it uses the path in `EBB_CHROME_PATH`, and the error message names both options plus `npx playwright-core install chromium`. Pin an exact version that is at least 14 days old at implementation time (1.58.2 or newer). `pnpm-lock.yaml` changes in U1. `deviceScaleFactor: 1`, viewport equal to the target size, `page.setContent` (no file URL, no server), screenshot with `omitBackground: false`.
- KTD3. **Fonts: the site's system stacks, no fetch.** The templates use the same `--font-sans` / `--font-mono` stacks as `globals.css`, so the images match the site. On the maintainer's Mac they resolve to SF Pro / SF Mono. No Google font: a fetch at render time is not deterministic and the CSP-free render does not need it. Consequence: a render on Linux looks different; this is why CI does not render (KTD4).
- KTD4. **Drift check = input hash + output hash + dimensions, not a re-render.** Pixel output depends on the OS font rasteriser and the Chrome build, so a re-render-and-diff check would fail across machines. The render script writes `assets/images.lock.json`: `{ inputsSha256, renderer: { playwrightCore, chrome, platform }, outputs: { "<path>": { width, height, bytes, sha256 } } }`. `inputsSha256` hashes, in sorted order, every file in `assets/templates/`, `scripts/render-images.mjs` and `docs/examples/2026-09-30-GB-tick/forecast.json`. `scripts/check-images.mjs` (Node built-ins only) recomputes `inputsSha256`, reads width and height from each PNG's IHDR chunk, recomputes each PNG's sha256, checks `social-preview.png` < 1 MB, and exits 1 naming each mismatch with the fix ("run `pnpm gen:images`"). This catches a template edit without a re-render and a hand-edited PNG. It does not catch a change in how Chrome draws the same input; that is accepted and stated in the script header. Because any edit to the render script changes `inputsSha256`, review fixes to the script need a re-render; the GitHub upload (U4) is needed only when the `social-preview.png` sha256 in the lock file changes.
- KTD5. **The chart is computed from the data, not drawn by hand.** The script reads `forecast.json`, builds one SVG `path` (straight segments, no smoothing that would invent values), and fills a shared `{{chart}}` slot in each template. It derives the peak (max entry) and the band (entries within `max(min × 0.15, 30)` of min, the rule in `select-window.ts`, re-implemented inline with a comment; the script does not import `@ebb-ai/core` so it needs no build). The recommended hour is a constant `2026-10-02T09:00:00.000Z` with a comment pointing to `output.txt` line 16, because the pick inside the band is random. The script asserts peak = 183 at 2026-10-01T17:00Z, recommended entry = 88, and recommended inside the band; a failed assertion stops the render. X axis: the 51 entries edge to edge, three ticks: the start label "30 Sep 21:00" and the two UTC midnights inside the data, "1 Oct" and "2 Oct". Y axis: no grid, no tick labels; the two marks carry the only numbers.
- KTD6. **README hero: relative path, GitHub only.** `<p align="center"><img src="assets/readme-hero.png" alt="…" width="800"></p>` above `# ebb-ai`, as in the benchmark. The root README is not published to npm (each package has its own `README.md` in `files`), so no raw.githubusercontent URL is needed. The H1, the bold tagline and everything below stay byte-identical. The hero image carries the wordmark, the curve, the marks and the caption, but not the tagline, because the bold tagline sits directly under it as text (avoid saying the same line twice).
- KTD7. **Tagline text = the README's bold line.** The brief says "Run LLM tasks at the cleanest grid hour"; the README line 3 and `growth-drafts.md` 1d say "Run non-urgent LLM tasks at the cleanest grid hour before your deadline." The images use the README line, so the card a visitor sees and the page it opens say the same thing (consistency rule). "non-urgent" also keeps the image from implying every task should wait.
- KTD8. **No task marker that implies a dispatch at 88.** The brief asks for a task marker. `docs/claims.md` row 31 and the example README state the task ran at once at 158 (measured), not at 88. The image therefore marks the recommended hour as "recommended 88" with a dot and a short vertical rule, and shows no "task ran here" label and no 158. The highlighted band carries no number.
- KTD9. **Colours from the site tokens.** Background `#0d1218` (`--color-bg-elev`, dark navy-grey) with a 1 px `#1f2632` rule around the hero; curve `#5eead4`; band fill `#34d399` at about 15 % opacity; peak mark `#fbbf24`; recommended mark `#34d399`; text `#e6e8ee` / `#8a93a6`. The hero is a full-bleed dark rectangle with rounded corners baked in (corner pixels in a mid-grey that reads on both GitHub themes; or square corners if the rounded edge shows a halo on white, decided by looking at both themes once).
- KTD10. **Site: rename to `og-image.png`, delete `og.png`.** A new URL makes X, Slack and LinkedIn fetch the new card instead of serving the cached v0.5 one. `metadataBase` already makes `/og-image.png` absolute (`https://www.ebb-ai.com/og-image.png`), so the value stays a root-relative path. `twitter.card` is already `summary_large_image` and stays. `/about` gets `images` in its own `openGraph` (Next.js does not deep-merge `openGraph`). Update the `og.png` example in the `proxy.ts:85` comment.
- KTD11. **Social-preview record in the hub log.** `docs/internal/hub-submission-log.md` already tracks GitHub surfaces (row "GitHub topics"). Add one row there, not in the README: the README dev section is for contributors, and this step is maintainer-only.
- KTD12. **Release prep without publish.** Same file set as 0.16.1: the 10 files `check-versions.mjs` compares (README and CHANGELOG included) plus its source `packages/core-ts/package.json`: 11 distinct files. The script prints "(12 files)" because it checks `packages/mcp-server/server.json` twice (top-level `version` and `packages[0].version`). Workspace packages use `workspace:*`, so the lockfile carries no workspace version; run `pnpm install --lockfile-only` and commit `pnpm-lock.yaml` only if it changes. Runtime version readers (`apps/web/src/lib/version.ts`, `packages/mcp-server/src/server.ts` `SERVER_VERSION`, `packages/cli/src/index.ts`, Python `__version__`) read package metadata and need no edit. 0.17.0 is a minor bump: `ebb ui`, notifications, the hook and `quota_reset` are new features.

### Assumptions

- Rendering happens on Vitalii's Mac (Chrome installed). A contributor without Chrome sets `EBB_CHROME_PATH` or installs Playwright's Chromium; their render produces different PNG bytes, and the lock file then records their renderer.
- The "72 h" in the brief and the drafts refers to the request horizon. The UK feed returned 50 h of data; the image says nothing about the horizon length, so no "72 h" text appears on it.
- `growth-readme.md` has no section on the magnum benchmark (grep for "magnum", "zhuravel", "hero image" finds nothing). The layout comes from the benchmark README itself, read via `gh api repos/zhuravel/magnum/readme`.
- The README status line keeps the 0.16.1 pattern: `> **Status:** v0.17.0 (this release) · 2026-10-15 · published on npm and PyPI`, written before the publish, as the 0.16.1 prep did.

### Sequencing

U1 → U2 → U3 → U4 → U5, one commit each. U2 and U3 need the PNGs from U1. U5 is last because it bumps files U2 touches and lists U1-U3 in the CHANGELOG.

---

## Implementation Units

### U1. feat(images): render script

- **Goal:** R1-R4.
- **Files:**
  - `scripts/render-images.mjs` (new): reads data, builds the chart SVG, fills templates, renders, writes PNGs and the lock file.
  - `scripts/check-images.mjs` (new): dependency-free check (KTD4).
  - `assets/templates/base.css` (new): tokens, fonts, shared chart styles.
  - `assets/templates/social-preview.html`, `assets/templates/readme-hero.html`, `assets/templates/og-image.html` (new): one layout per size with `{{chart}}` and a `{{css}}` slot (inlined by the script; `setContent` cannot resolve relative links).
  - `assets/social-preview.png`, `assets/readme-hero.png`, `apps/web/public/og-image.png`, `assets/images.lock.json` (new, generated).
  - `package.json`: devDependency `playwright-core` (exact pin, KTD2); scripts `"gen:images": "node scripts/render-images.mjs"`, `"gen:images:check": "node scripts/check-images.mjs"`; append `&& pnpm gen:images:check` at the end of `preflight`, after `pnpm lint:py`.
  - `pnpm-lock.yaml` (the new devDependency).
  - `.github/workflows/ci.yml`: one step in job `data-ssot` after the tables check: `node scripts/check-images.mjs`.
  - `docs/claims.md`: row 31 "Where it appears" gains `assets/social-preview.png; assets/readme-hero.png; apps/web/public/og-image.png`.
- **Approach:**
  - Layouts (directional): social 1280×640 and og 1200×630 share one structure with a 64 px safe margin (drafts 1d): left half wordmark (~72 px, sans, weight 800), tagline (~40 px, max 3 lines, KTD7), mono line `npx -y @ebb-ai/mcp`; right half the chart, caption under it (~18 px, muted). Hero 1600×500: wordmark at left (~88 px), chart across the remaining width, caption under the chart.
  - Chart: `viewBox` sized per template; polyline from the 51 points; band as a filled rect spanning 09:00-16:00 Oct 2 behind the curve; peak dot plus label "peak 183"; recommended dot plus thin vertical rule plus label "recommended 88"; x labels per KTD5; unit "gCO2/kWh" once, directly after the "recommended 88" label. The "peak 183" label sits above its dot and the "recommended 88" label below its dot, each clear of the curve and the band.
  - Legibility: the hero shows at 800 px (half size), so in the hero the mark labels and the caption are at least 28 px (14 px displayed). In the social and Open Graph cards the mark labels are at least 24 px and the caption at least 20 px.
  - Determinism: fixed viewport, `deviceScaleFactor: 1`, no animation, no date-now, wait for `document.fonts.ready` before the screenshot, PNG written via `page.screenshot({ type: "png" })`. Render twice in the verification and compare sha256.
  - The script prints one line per output: path, size, bytes.
- **Test scenarios:** (manual, script-level; no unit test framework is used for `scripts/`, matching `check-versions.mjs` and `gen-data.mjs`)
  - Run `pnpm gen:images` twice: identical `assets/images.lock.json` and PNG sha256.
  - `pnpm gen:images:check` passes on a clean tree.
  - Edit one character in `assets/templates/base.css` without re-rendering: check exits 1 and names the inputs hash.
  - Replace `assets/readme-hero.png` with a copy of another PNG: check exits 1 naming the file (sha256 and dimensions).
  - Change `forecast.json` entry 2026-10-01T17:00Z to 184 in a scratch copy: render stops on the peak assertion. Do not commit.
  - Run `check-images.mjs` with Node 22 and no `node_modules`: passes (CI `data-ssot` has no install).
- **Verification:** `file assets/*.png apps/web/public/og-image.png` shows 1280×640, 1600×500, 1200×630; `social-preview.png` < 1 MB; look at each PNG once (Read tool or Preview) on a dark and a white background, the hero at 800 px wide and the cards at about 600 px wide, and confirm every label is readable and no label overlaps the curve, the band or another label; every number visible on an image is 183 or 88 (plus dates and the `npx` line); `node scripts/check-versions.mjs` still passes.

### U2. docs(readme): hero image

- **Goal:** R5.
- **Files:** `README.md` (lines before line 1 only).
- **Approach:** per KTD6. Insert before `# ebb-ai`:
  `<p align="center"><img src="assets/readme-hero.png" alt="ebb-ai: GB grid carbon-intensity forecast from 2026-09-30, peak 183 and recommended hour 88 gCO2/kWh (forecast, projected, one run)" width="800"></p>` and one blank line. The alt text repeats only labelled row-31 numbers. No other line changes.
- **Test scenarios:** none (docs).
- **Verification:** `git diff --stat README.md` shows only added lines at the top; `node scripts/check-versions.mjs` passes; the PR preview on GitHub shows the image in dark and light themes (check once after push).

### U3. feat(web): og-image metadata

- **Goal:** R6.
- **Files:** `apps/web/src/app/layout.tsx` (`openGraph.images[0].url`, `alt`; `twitter.images`), `apps/web/src/app/about/page.tsx` (`openGraph.images`), `apps/web/public/og.png` (delete), `apps/web/src/proxy.ts` (comment at line 85 only).
- **Approach:** per KTD10. `openGraph.images: [{ url: "/og-image.png", width: 1200, height: 630, alt: "<tagline from KTD7>" }]`; `twitter.images: ["/og-image.png"]`; `twitter.card` unchanged (already `summary_large_image`). In `about/page.tsx` add the same `images` entry. Leave the other `openGraph` / `twitter` text fields as they are (out of scope; they carry no unlabelled number except the twitter description's "1,115 tests, 9 MCP tools", which have claims rows 13 and 16).
- **Test scenarios:**
  - `next build` succeeds and does not warn about `metadataBase`.
  - Served `/` and `/about` HTML contain `<meta property="og:image" content="https://www.ebb-ai.com/og-image.png"` and `<meta name="twitter:image" content="https://www.ebb-ai.com/og-image.png"`, and `twitter:card` = `summary_large_image`.
  - `GET /og-image.png` returns 200 `image/png`; `GET /og.png` returns 404.
- **Verification:** `pnpm --filter @ebb-ai/web typecheck && pnpm --filter @ebb-ai/web lint && pnpm --filter @ebb-ai/web build`; then `pnpm --filter @ebb-ai/web start -p 3417` in the background and `curl -s localhost:3417/ | grep -o '<meta[^>]*\(og\|twitter\):[^>]*>'` (same for `/about`), `curl -sI localhost:3417/og-image.png`, `curl -sI localhost:3417/og.png`; stop the server. `git grep -n 'og\.png' -- apps/web` empty. Pages render dynamically (`headers()` in the layout), so check served HTML, not `.next` files.

### U4. docs: social preview instructions

- **Goal:** R7.
- **Files:** `docs/internal/hub-submission-log.md` (table "MCP / Claude / OpenClaw directories", next to the "GitHub topics" row).
- **Approach:** per KTD11. One row: `| 2026-10-15 | GitHub social preview | Upload assets/social-preview.png (1280×640) in Settings > General > Social preview (web UI only; no API) | https://github.com/Vitalini/ebb-ai/settings | not done; Vitalii's step | Re-upload only when the assets/social-preview.png sha256 in assets/images.lock.json changes |`. The log rule is "don't remove rows; update status".
- **Test scenarios:** none.
- **Verification:** the row has the same pipe count as its neighbours; `git diff` shows one added line.

### U5. chore(release): prepare 0.17.0

- **Goal:** R8.
- **Files:** `packages/core-ts/package.json`, `packages/cli/package.json`, `packages/mcp-server/package.json`, `packages/mcp-server/server.json` (top-level `version` and `packages[0].version`), `packages/openclaw-plugin/package.json`, `packages/openclaw-plugin/openclaw.plugin.json`, `packages/claude-code-plugin/.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json` (`plugins[ebb-ai].version`), `packages/core-py/pyproject.toml`, `README.md` (status line: `v0.17.0 (this release) · 2026-10-15`), `CHANGELOG.md`; `pnpm-lock.yaml` only if `pnpm install --lockfile-only` changes it (KTD12).
- **Approach:**
  - CHANGELOG: rename `## [Unreleased]` content into `## [0.17.0] — 2026-10-15` and leave an empty `## [Unreleased]` above it. Keep the Added, Changed and "Upgrade note" subsections as they are (the "reinstall it (`npm install -g @ebb-ai/cli`)" note stays verbatim). Add under Added: "**Repo and site images.** `pnpm gen:images` renders the GitHub social preview, the README hero and the site Open Graph card from one real GB forecast (`docs/examples/2026-09-30-GB-tick/`); `pnpm gen:images:check` guards drift in `pnpm preflight` and CI." Add under Changed: "The site's Open Graph and Twitter card is `/og-image.png`; the stale v0.5 `og.png` is removed, and `/about` now carries the card too."
  - Link refs at the file end: `[Unreleased]: https://github.com/Vitalini/ebb-ai/compare/v0.17.0...HEAD` and a new `[0.17.0]: https://github.com/Vitalini/ebb-ai/compare/v0.16.1...v0.17.0` above `[0.16.1]`.
  - Version-only edits elsewhere; no tag, no publish.
- **Test scenarios:** none beyond the gates.
- **Verification:** `node scripts/check-versions.mjs` prints `check-versions: 0.17.0 everywhere (12 files)`. `git grep -n '0\.16\.1' -- ':!CHANGELOG.md' ':!docs'` is empty. `grep -n 'reinstall it' CHANGELOG.md` hits inside the 0.17.0 section. `pnpm gen:images:check` still passes (the version is not on any image, so no re-render). Full gate below.

---

## Verification Contract

Worktree setup, once (`docs/solutions/developer-experience/worktree-environment-setup.md`):

```bash
git worktree add .worktrees/feat-repo-images-0.17.0 -b feat/repo-images-0.17.0 main
cd .worktrees/feat-repo-images-0.17.0
pnpm install --frozen-lockfile        # before U1 adds playwright-core; then pnpm install
pnpm build                            # dist/ is gitignored; typecheck/test need it
cd packages/core-py && python3.11 -m venv .venv && .venv/bin/pip install -e '.[dev]' && cd ../..
```

Never symlink the main checkout's `.venv` (false green).

| Gate | Command | Runs after |
|---|---|---|
| Version lockstep | `pnpm check:versions` | every commit |
| Images drift | `pnpm gen:images:check` | U1, U5 |
| Generated data | `pnpm gen:data:check` | U1, U5 |
| TS build, typecheck, tests | `pnpm build && pnpm typecheck && pnpm test` | U1 (lockfile change), U5 |
| Python | `pnpm lint:py` (ruff + pytest) | U5 |
| Web | `pnpm --filter @ebb-ai/web typecheck && pnpm --filter @ebb-ai/web lint && pnpm --filter @ebb-ai/web build` | U3, U5 |
| Web served metadata | `curl` checks in U3 | U3 |
| Claims | every number on the three PNGs is in row 31; row 31 lists the three files | U1 |

`pnpm preflight` (which now ends with `gen:images:check`) is the final check at U5, followed by the web gate. Read a failing log with `grep -nE "✘|Error|expected|FAILED" <log> | head -40`; one re-run, then report.

---

## Definition of Done

- Five commits on `feat/repo-images-0.17.0` with the brief's messages, in order U1-U5.
- Every gate in the Verification Contract passes at U5 head; CI job `data-ssot` runs the images check.
- Three PNGs at the stated sizes, `social-preview.png` under 1 MB, `assets/images.lock.json` matching them.
- No file under `packages/*/src` changed.
- No publish, tag, push to `main` or merge. The PR body lists Vitalii's steps: upload `assets/social-preview.png` in GitHub settings; publish 0.17.0 (npm, PyPI, ClawHub, MCP Registry) from the reviewed head; tag; merge (Vercel production deploy); after the deploy, re-scrape the card in the X and LinkedIn validators if old previews persist.
- One `ce-code-review` pass on the PR; findings fixed and folded into their commits.
