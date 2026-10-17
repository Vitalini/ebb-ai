---
title: Homepage First Screen - Plan
type: feat
date: 2026-10-17
artifact_contract: ce-unified-plan/v1
product_contract_source: ce-plan-bootstrap
execution: code
---

# Homepage First Screen - Plan

## Goal Capsule

- **Objective:** A visitor who opens www.tidegap.com sees one thing on the first screen: the tagline and one centred button that copies the install prompt for their agent. Everything that explains Tidegap is one scroll below, and the other install paths still work.
- **Means:** Split the current hero into a centred first-screen section and a "what it is" section below it, and add a button-only variant of the existing agent-prompt component (KTD1, KTD2).
- **Authority:** Vitalii's backlog item (quoted in Problem Frame), then this plan, then the current `apps/web` code. Naming follows the 2026-10-16 rebrand: new copy says "Tidegap", never "Ebb" or "Ebb AI". Where the plan and the repo disagree, stop and report.
- **Stop conditions:** the first screen cannot hold the tagline and the button above the fold at 390×844 without cutting the tagline; `pnpm --filter @tidegap/web build` fails the same way twice; any step would merge, push to `main`, publish or cut a release.
- **Execution profile:** one worktree `.worktrees/feat/homepage-first-screen` on branch `feat/homepage-first-screen`, U1 then U2, no fan-out (U2 imports what U1 exports). Git commands use `git -c core.editor=true -c sequence.editor=true`.
- **Who finishes:** the pipeline stops at an open PR with green gates, the browser QA report and one `ce-code-review` pass. Vitalii merges. A merge to `main` is a Vercel production deploy of www.tidegap.com.

---

## Product Contract

### Summary

Rebuild the top of `apps/web/src/app/page.tsx` as a full-viewport, centred first screen: the current tagline as the H1, one "Copy the prompt for your agent" button, one helper line, and one small link down to the other install paths. Move the description paragraph, the claims note, the authorship line, the version badge and the live grid banner below the first screen. Keep the full install block (visible prompt plus host picker) below, with its `#install` anchor, and leave a marked slot after it for a later "Apps and extensions" section.

### Problem Frame

Vitalii's backlog item, verbatim: "Homepage cleanup: first screen = one centred 'copy the prompt for your agent' action + tagline; everything else below; keep other install paths, default to the simple one." His note from 2026-10-16 calls the current homepage cluttered ("наляписто").

Today the first screen at 1440×900 holds a version badge, the H1, a long paragraph with DOE and Batch-API figures, two footnote lines, the live grid banner and the top of the install block. The install prompt itself sits inside the install card with a small "copy" text button, below the fold on a phone. A new visitor has to read before they can act.

The next PRs add a browser extension (Chrome, Edge, Firefox) and a Mac app. Those need a place on the homepage that does not compete with the first screen.

### Requirements

**First screen**

- R1. The first screen shows only: the tagline as the page H1, one primary button labelled "Copy the prompt for your agent", one helper line, and one text link to the other install paths. The site header (nav) stays as it is.
- R2. The tagline stays the current H1 text: "Run your agent's non-urgent LLM tasks at the cleanest grid hour." with "cleanest grid hour" in the accent colour.
- R3. The first screen is centred horizontally and vertically, and fills the viewport below the nav, so no content from the sections below shows above the fold at 1440×900 or 390×844.
- R4. The button copies exactly the existing agent prompt (the `PROMPT` constant in `apps/web/src/components/agent-prompt.tsx`, text in KTD1). After a successful copy a confirmation shows next to the button for about 1.5 s, and the confirmation is announced to screen readers.
- R5. When the clipboard write fails, the button area says that the copy was blocked and points to the install section below, where the prompt text is visible and selectable.
- R6. The helper line names where to paste the prompt, for example: "Paste it into Claude Code, Cursor, Claude Desktop or any MCP host. Your agent reads tidegap.com/install.md and installs Tidegap."
- R7. The text link reads "Other ways to install" and jumps to `#install`; the install section heading is not hidden under the sticky nav after the jump.

**Below the first screen**

- R8. In this order below the first screen: the "what it is" section (version badge, the current description paragraph, the claims note, the authorship line), the live grid banner, the install section, the "Apps and extensions" slot, the how-it-works animation, the dashboard tiles, the value row.
- R9. The install section keeps `id="install"`, the visible agent prompt as the first and default path, and the host picker below it with "MCP server (generic)" still preselected. `QUICKSTART.md` links to `https://www.tidegap.com/#install`.
- R10. The claims note ("50% cheaper: projected ... See docs/claims.md") stays directly under the paragraph that makes the 50 % and lower-carbon claims.
- R11. The "Apps and extensions" slot renders nothing in this PR. It is a marked place in the page source for the browser-extension and Mac-app PRs. No link, card or "coming soon" text for an app or extension that does not exist yet.

**Copy and naming**

- R12. All new copy says "Tidegap". No "Ebb" or "Ebb AI" in new or changed strings.

### Scope Boundaries

- Not changing `/docs`, `/about` or any other page. `/docs` keeps its own `#install` section and picker.
- Not changing page metadata, Open Graph images, the nav or the footer.
- Not adding a light theme. The site is dark-only: `apps/web/src/app/globals.css` defines one palette under `@theme` and has no `prefers-color-scheme` rule.
- Not renaming the internal `ebb-*` CSS class names in `apps/web/src/components/how-it-works-viz.tsx`; they are not visible copy.
- Considered and not built: a test harness for `apps/web`. The app has no test runner today, the change is layout plus one clipboard call, and the browser QA script covers it. Evidence that would change this: a second interactive component on the homepage with logic beyond a clipboard write.
- Considered and not built: a "copy blocked" state on the install card's small copy button. Its prompt text is already visible next to it, so a failed copy leaves the user a manual path. Evidence that would change this: the card hides the prompt text.
- Considered and not built: a `document.execCommand("copy")` fallback. The site is HTTPS-only, where the async clipboard API is available. R5 already makes a failure visible and gives a manual path.

### Deferred to Follow-Up Work

- "Apps and extensions" section content: the browser-extension PR and the Mac-app PR fill the slot from R11.
- `apps/web/public/architecture.html` links to `./index.html#install`, which does not resolve to the homepage. Pre-existing; fix it in a separate change.

---

## Planning Contract

### Key Technical Decisions

- KTD1. **Reuse the existing prompt, one source.** The button copies the `PROMPT` constant that `AgentPrompt` already shows, so the first screen and the install section can never drift. The text is:

  ```text
  Please install Tidegap — open-source carbon-aware MCP scheduler, Apache-2.0.

  Instructions: https://www.tidegap.com/install.md

  Read that file, then run the install path for whichever host
  you're in and confirm it worked.
  ```

  The prompt text does not change in this PR.
- KTD2. **A second export in `agent-prompt.tsx`, not a new file.** Add a `CopyPromptButton` client component next to `AgentPrompt`, and move the copy logic (copied and failed states, the 1.5 s reset) into one shared hook in the same file. `AgentPrompt` keeps its current look and behaviour. A new file would split one prompt across two modules for no gain.
- KTD3. **First screen sized with `svh`, not `vh`.** The section uses a minimum height of the small viewport height minus the nav height and the `main` top padding, so mobile browser bars do not push the button below the fold. The exact offset is set at implementation by measuring the rendered nav (about 61 px on mobile, 65 px from `sm`; the nav links, not the logo, set the height) and `main`'s `py-10`.
- KTD4. **`scroll-mt` on `#install`.** The nav is `sticky top-0`, so the install section gets a scroll margin about equal to the nav height. That makes R7's jump land on the heading.
- KTD5. **The apps slot is a JSX comment, not an empty component.** A named comment between the install section and `HowItWorksViz` marks the place. An empty component or hidden section would ship dead markup and tempt a "coming soon" card that R11 forbids.

### Assumptions

- The Vercel preview of the PR is publicly reachable. If it asks for a Vercel login, the QA agent reports that and stops.
- "Default to the simple one" means the agent prompt is the default install path, on the first screen and first inside the install section. The picker's own default ("MCP server (generic)") is unchanged.

---

## Implementation Units

### U1. Copy-prompt button

- **Goal:** A button-only way to copy the agent prompt, with visible success and failure states.
- **Requirements:** R4, R5, R12; KTD1, KTD2.
- **Dependencies:** none.
- **Files:** `apps/web/src/components/agent-prompt.tsx`.
- **Approach:**
  1. Extract the clipboard logic from `AgentPrompt` into a hook in the same file that returns the state (idle, copied, failed) and a copy function. The copied state resets after about 1.5 s.
  2. Export `CopyPromptButton`: a large accent button whose label is always "Copy the prompt for your agent" (R1).
  3. Under the button, one always-mounted status line with `role="status"` and a reserved height, so the centred block does not move. On success it reads "Copied. Paste it into your agent." and clears after about 1.5 s. On failure it reads "Copy blocked. The prompt is in the install section below." with "install section" linking to `#install`; it clears on the next click.
  4. `AgentPrompt` uses the same hook and looks and behaves as today ("copied ✓" on success, nothing on failure, since its prompt text is already visible).
- **Patterns to follow:** the accent styles of the "Region forecast" link in `apps/web/src/components/grid-greeting.tsx` (border-accent, bg-accent tint, font-mono), scaled up for a primary action. The global `:focus-visible` ring in `apps/web/src/app/globals.css` covers keyboard focus.
- **Test scenarios:** `apps/web` has no test runner (see Scope Boundaries). These scenarios are checked in the browser by the QA script.
  - Click the button with clipboard permission granted: the clipboard holds exactly the KTD1 text, and the status line shows the copied text and clears after about 1.5 s.
  - Press Tab to the button and press Enter: same result as a click, and the focus ring is visible.
  - Clipboard write rejected: the failed line appears, and its link scrolls to `#install`.
  - The install-section "copy" button still copies the same text.
- **Verification:** lint, typecheck and build pass. Both components copy the same string.

### U2. Homepage restructure

- **Goal:** The centred first screen, with every other homepage section below it in the R8 order.
- **Requirements:** R1, R2, R3, R6, R7, R8, R9, R10, R11, R12; KTD3, KTD4, KTD5.
- **Dependencies:** U1.
- **Files:** `apps/web/src/app/page.tsx`, `CHANGELOG.md`.
- **Approach:**
  1. Replace `Hero` with a first-screen section: H1 tagline (R2), `CopyPromptButton`, helper line (R6), and the "Other ways to install" link to `#install` (R7). Centre it with flex, size it per KTD3. The H1 may grow one size step on wide screens.
  2. Add a "what it is" section with `id="what"` directly after the first screen. It holds the version badge, the description paragraph, the claims note right after it (R10) and the authorship line, all moved unchanged from `Hero`.
  3. Order the rest per R8: `GridGreeting` (inside its `Suspense`), `InstallBlock`, the apps-slot comment (KTD5), `HowItWorksViz`, `TilesBlock`, `ValueRow`.
  4. On `InstallBlock`, keep `id="install"`, add the scroll margin (KTD4), keep `AgentPrompt` first and `InstallPicker` second (R9). Its copy stays as it is.
  5. Add a CHANGELOG `[Unreleased]` → `### Changed` entry: the homepage first screen is the tagline and one copy-the-prompt button; the rest moved below.
- **Patterns to follow:** existing section shells and eyebrow labels in `apps/web/src/app/page.tsx` (`font-mono text-[11px] uppercase tracking-wider text-accent`), CHANGELOG bold-lead-sentence entries.
- **Test scenarios:** checked in the browser by the QA script (no test runner in `apps/web`).
  - At 1440×900 and 390×844, the H1 and the button are fully inside the viewport, and the top of `#what` is at or below the viewport bottom.
  - Click "Other ways to install": the install heading is visible below the nav, not under it.
  - Scroll down: the sections appear in the R8 order, with the claims note under the description paragraph.
  - The host picker opens with "MCP server (generic)" selected.
  - Visible homepage text contains no "Ebb".
- **Verification:** lint, typecheck and build pass. The QA script passes on the Vercel preview.

---

## Verification Contract

Run from the worktree root. `apps/web` depends on `@tidegap/core` through `workspace:*`, and `dist/` is gitignored, so core must be built once first (`docs/solutions/developer-experience/worktree-environment-setup.md`). `apps/web` has no test suite and is not in `ci.yml`, so these commands are the gate.

| Step | Command | Pass |
|---|---|---|
| Install | `pnpm install --frozen-lockfile` | exit 0 |
| Build core | `pnpm --filter @tidegap/core build` | exit 0 |
| Lint | `pnpm --filter @tidegap/web lint` | exit 0, no new warnings in `page.tsx` or `agent-prompt.tsx` |
| Typecheck | `pnpm --filter @tidegap/web typecheck` | exit 0 |
| Build | `pnpm --filter @tidegap/web build` | exit 0 |
| Naming | `git diff origin/main -- apps/web CHANGELOG.md \| grep -in '^+.*ebb'` | no output |

The repo-wide `pnpm test` covers `packages/*` only, which this PR does not touch. It does not need to run.

### QA Script (browser agent, Vercel preview)

The preview URL is in the Vercel bot comment or the Vercel check on the PR. Use one tab; close it at the end. Save screenshots to the session scratchpad. The site is dark-only (see Scope Boundaries), so there is no light-mode pass; every screenshot must show readable button text on the dark background.

1. Open the preview URL at **1440×900**. Expect: nav, the H1 "Run your agent's non-urgent LLM tasks at the cleanest grid hour." centred, the "Copy the prompt for your agent" button centred under it, the helper line, the "Other ways to install" link. Nothing else in the viewport. Screenshot.
2. Evaluate `document.querySelector('#what').getBoundingClientRect().top >= window.innerHeight - 1` and that the button's `getBoundingClientRect().bottom <= window.innerHeight`. Expect both true.
3. Grant `clipboard-read` and `clipboard-write` for the preview origin, click the button, read `navigator.clipboard.readText()`. Expect the exact KTD1 text. The status line under the button shows "Copied. Paste it into your agent." and clears within about 2 s. The button label does not change.
4. Reload. Run `navigator.clipboard.writeText = () => Promise.reject(new Error("blocked"))` in the page, then click the button. Expect "Copy blocked. The prompt is in the install section below." Click its "install section" link. Expect the install heading visible below the nav. Reload to restore the clipboard.
5. Back at the top, click "Other ways to install". Expect the install section heading visible below the sticky nav, the visible prompt card first, the host picker below with "MCP server (generic)" selected. Click the install card's "copy" button and read the clipboard. Expect the exact KTD1 text. Screenshot.
6. Scroll from the top to the footer. Expect the R8 order: the "what it is" block (version badge, paragraph, claims note right under it, authorship line), the grid banner, install, how-it-works animation, dashboard tiles, value row. No "Apps and extensions" heading, card or link.
7. Search the page text for "Ebb" (case-insensitive). Expect no match.
8. Repeat steps 1, 2, 3 and 5 at **390×844**. Expect the H1 wraps but stays whole, the button and helper line fit above the fold, no horizontal scroll (`document.documentElement.scrollWidth <= 390`). Screenshot.
9. Open `/#install` directly. Expect the page to land on the install section.
10. Check the browser console on `/`. Expect no errors (CSP violations included).

Report: pass or fail per step, the screenshot paths, and for a fail the first wrong value.

---

## Definition of Done

- U1 and U2 are in one PR from `feat/homepage-first-screen`, with no change outside `apps/web/src/components/agent-prompt.tsx`, `apps/web/src/app/page.tsx`, `CHANGELOG.md` and this plan.
- Every Verification Contract command passes.
- The QA script passes on the Vercel preview at both viewports.
- No dead code from abandoned layout attempts is left in the diff.
- One `ce-code-review` pass is done, and its blockers are fixed. Nobody merges except Vitalii.
