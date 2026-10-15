---
title: Growth README and 0.16.1 Release Prep - Plan
type: chore
date: 2026-10-15
artifact_contract: ce-unified-plan/v1
product_contract_source: ce-plan-bootstrap
execution: code
---

# Growth README and 0.16.1 Release Prep - Plan

## Goal Capsule

- **Objective:** A visitor who lands on the GitHub README, the npm pages of `@ebb-ai/cli` and `@ebb-ai/mcp`, the PyPI page of `ebb-ai`, the Claude Code plugin listing or the site hero understands in ten seconds what ebb-ai does, can install it from a published package, and reads no number that `docs/claims.md` does not back with a label.
- **Means:** Eight commits on one branch `chore/growth-readme-0.16.1`, in brief order (KTD1), ending with a release-prep commit for 0.16.1 that publishes nothing (KTD8).
- **Authority:** Vitalii's brief for this PR, then this plan, then `docs/claims.md` (allowed claims and labels), then the session scratchpad inputs `growth-readme.md`, `growth-drafts.md`, `parity-diagnosis.md`. Where the drafts and `docs/claims.md` disagree, `docs/claims.md` wins. Where this plan and the repo disagree, stop and report.
- **Stop conditions:** a copy change would need a number with no row in `docs/claims.md`; the parity fixture shows TS and Python pick different entries for the same input (that is a real bug, out of scope: stop and report); `pnpm test` or `pytest` fails the same way twice; any step would publish to npm, PyPI, ClawHub or the MCP Registry, tag, push to `main`, or merge.
- **Execution profile:** one worktree at `.worktrees/chore-growth-readme-0.16.1`, sequential commits U1-U8. No fan-out: U1 and U8 both touch `README.md` and U8 touches every manifest.
- **Who finishes:** the pipeline stops at an open PR with green gates and one `ce-code-review` pass. Vitalii decides the npm/PyPI/ClawHub publish, the MCP Registry publish, the tag and the merge. A merge to `main` is a Vercel production deploy of `apps/web`.

---

## Product Contract

### Summary

Rewrite the first screen of the README, the npm heads of `@ebb-ai/cli` and `@ebb-ai/mcp`, and the PyPI head of `ebb-ai` so each one says what the tool does and opens with commands that work from a published install. Label the one unlabelled cost claim in the Claude Code plugin surfaces. Add MCP Registry metadata. Add a cross-language test fixture that pins window selection. Drop "faster" from the site hero. Refresh the internal hub-submission log. Prepare 0.16.1 so the new READMEs and `mcpName` reach npm and PyPI on the next publish.

### Problem Frame

The audit in `growth-readme.md` fails six of eight public surfaces on the ten-second test. The README opens with "Workload scheduling for the agentic-AI economy" and has no install line on the first screen. The `@ebb-ai/cli` and `@ebb-ai/mcp` READMEs open with monorepo `pnpm --filter` builds and `node packages/.../dist/...` paths. The PyPI page says "pre-PyPI, install from source" and links to `../core-ts/` and `../../ROADMAP.md`, which 404 on pypi.org (and `ROADMAP.md` does not exist in the repo). `plugin.json`, `marketplace.json` and the plugin `SKILL.md` say "50% cheaper" with no label, which `docs/claims.md` row 4 requires. The site h1 says "faster", which has no row in `docs/claims.md`. The README says "queue viewer" (`README.md:347`) but `/queue` is a static explainer and the real queue view is `ebb queue list`.

`parity-diagnosis.md` shows that TS and Python pick the same hour for the same `rng`, but each call draws its own random number inside the cleanest-tolerance band. Snippets that pass no `rng` therefore show different hours on each run, which looks like a bug. No fixture pins the two languages to one selection today.

### Requirements

**README (U1)**
- R1. The README first screen has: a hero line, one value-proposition paragraph, three labelled bullets, badges, install lines, one TS snippet, one Python snippet, a labelled proof line, and agent-install links (growth-drafts.md section 1a).
- R2. The TS snippet passes `rng: () => 0` and the Python snippet passes `rng=lambda: 0`. One sentence states that without `rng` the pick is random inside the cleanest band of near-equal hours, and that `rng` returning 0 gives the strict minimum. Both snippets use the drafts' 24-hour deadline.
- R3. The README no longer says "queue viewer"; it names `/queue` as an explainer and `ebb queue list` as the way to see the queue.
- R4. The rest of the README body stays, moved below the new head. The status line `> **Status:** v0.16.0 ...` stays in a form `scripts/check-versions.mjs` still matches.

**Package heads (U2)**
- R5. `packages/cli/README.md` and `packages/mcp-server/README.md` open with commands that work from a published install (`npm install -g @ebb-ai/cli`, `npx -y @ebb-ai/mcp`); monorepo build lines move to a "Develop" section at the bottom.
- R6. `packages/core-py/README.md` (the PyPI long description) no longer says "pre-PyPI" or "in-memory at v0.1" and has no relative links.

**Claims (U3, U6, all units)**
- R7. The Claude Code plugin surfaces carry the labelled cost wording: "50% of sync list price, projected" or equivalent per `docs/claims.md` row 4.
- R8. The site hero h1 does not contain "faster".
- R9. No public copy in the diff contains the "40 to 70 %" range in any spelling, or "faster" as a numeric claim.

**Registry, parity, log, release (U4, U5, U7, U8)**
- R10. `packages/mcp-server/package.json` has `"mcpName": "io.github.Vitalini/ebb-ai"` and `packages/mcp-server/server.json` validates against the 2025-12-11 MCP Registry schema. Nothing is published.
- R11. One JSON vector file drives a window-selection test in both the TS and the Python suite with a pinned `rng`. Scheduler behaviour does not change.
- R12. `docs/internal/hub-submission-log.md` records the state found on 2026-10-15.
- R13. Every lockstep manifest, the README status line and a dated `## [0.16.1] — 2026-10-15` CHANGELOG heading say 0.16.1, and `node scripts/check-versions.mjs` passes.

### Scope Boundaries

- GitHub repo description, topics and social preview: Vitalii runs `gh repo edit` and the web upload (growth-drafts.md 1b-1d). Not in this PR. The current GitHub description still carries "40–70 % lower CO2" until he does.
- `packages/core-ts/README.md` head and npm/PyPI `description` fields beyond the ones named in U2: not in the brief. U2 changes the `description` of `cli`, `mcp-server` and `pyproject.toml` only because drafts section 2 pairs them with the README heads (see KTD4).
- "Faster" outside the hero: `apps/web/src/components/how-it-works-viz.tsx:45` ("Faster" card), `apps/web/src/app/about/page.tsx:31,70`, `README.md:33` ("Faster at off-peak") and `README.md:45` ("fastest hour"). They are qualitative with a cited policy link, not numeric claims. Left as is; listed for Vitalii.
- `packages/core-ts/src/tool-surface.ts:277` ("up to 50% cheaper" in a tool description that MCP hosts show) is unlabelled, but it lives under `packages/core-ts/src`, which this PR does not change. Listed for Vitalii as a follow-up.
- Publishing: npm, PyPI, ClawHub, MCP Registry (`mcp-publisher publish`), tags. Not in this PR.
- Show HN, Reddit, newsletters, listing refreshes (drafts sections 4-8): not in this PR.
- Tolerance exposure or any change to `select-window.ts` / `scheduler.py` selection logic: not in this PR.

### Sources

- Session scratchpad `growth-readme.md` (audit), `growth-drafts.md` (paste-ready copy), `parity-diagnosis.md` and `parity/` (frozen GB feed, repro outputs). The brief's labels "A1", "A6", "A7" map to drafts sections 1a, 2 (2a/2b/2c) and 3.
- `docs/claims.md` rows 4, 6, 10, 11, 16, 31 and the "Dropped" section.
- `docs/solutions/tooling-decisions/version-lockstep-check.md`, `docs/solutions/developer-experience/worktree-environment-setup.md`.
- Release-prep precedent: commit `5b195f8` ("chore(release): prepare 0.16.0").

---

## Planning Contract

### Key Technical Decisions

- KTD1. **One commit per brief item, in brief order.** Each commit stands alone for review and for `git revert`. Review fixes fold into the commit they belong to (`docs/solutions/developer-experience/folding-review-fixes-into-commits.md`).
- KTD2. **Snippet output comments carry pinned, labelled values.** With `rng` returning 0 both languages return the strict minimum. The frozen 2026-10-15 GB feed gave `2026-10-16T11:00:00.000Z 66 very_clean` in both languages (`parity-diagnosis.md`, 24h deadline, rng 0). Use that one value in both comments, labelled "(forecast value on 2026-10-15; yours will differ)". Drop the drafts' "11:00 69" / "14:00 91" pair: it shows two unpinned runs as if they were comparable.
- KTD3. **Queue wording.** Replace "best-window planner, queue viewer." at `README.md:347` with "best-window planner, and a queue explainer (`/queue`); see your own queue with `ebb queue list`." The site cannot read the local ledger (`apps/web/src/app/queue/page.tsx` header comment).
- KTD4. **Package `description` fields change with their READMEs.** `packages/cli/package.json`, `packages/mcp-server/package.json` and `packages/core-py/pyproject.toml` `description` take the drafts' one-liners (sections 2a, 2b, 2c). They show on npm/PyPI next to the README and today repeat the abstract wording.
- KTD5. **Plugin cost claim: label, do not drop.** Replace "(50% cheaper)" / "50% cheaper via Anthropic/OpenAI Batch APIs" with "at 50% of sync list price (projected)". This matches `docs/claims.md` row 4 ("labelled ... at first occurrence per file"). `SKILL.md` lines 3 and 12 carry the same unlabelled phrase and are read by the same plugin directory, so they change in the same commit.
- KTD6. **`server.json` lives in `packages/mcp-server/`, carries the current lockstep version, and joins `check-versions.mjs`.** U4 writes `"version": "0.16.0"` in both version fields and adds `server.json` (top-level `version` and `packages[0].version`) to the `found` map in `scripts/check-versions.mjs`, per the learning in `version-lockstep-check.md` ("a new manifest that quotes the version needs to be added"). U8 bumps it with everything else. The registry entry needs 0.16.1 on npm first (0.16.0 has no `mcpName`); that ordering is Vitalii's publish step. `server.json` is not added to the npm `files` list.
- KTD7. **Parity fixture tests `selectWindow` / `select_window` directly, not the feed path.** The selection function is pure, so the vector holds entries, `now`, `deadline`, `rng` value and the expected result. Feed parsing parity is already covered by `grid-feeds-fixtures.test.ts` / `test_grid_feeds_fixtures.py`. File: `packages/core-ts/test/fixtures/select-window-vectors.json`, shape `{ "_comment": ..., "vectors": [...] }` as in `sampling-allowlist-vectors.json`. Python reads it via `Path(__file__).resolve().parents[2] / "core-ts" / "test" / "fixtures" / ...` as `test_sampling_parity.py:18-23` does. No `rng` value of 1.0 or above: Python clamps the index (`scheduler.py` guard), TS does not, and `Math.random` never returns 1.
- KTD8. **Release prep without publish.** Bump the nine files `check-versions.mjs` reads plus `server.json`. Lockfile: workspace packages are linked as `workspace:*`, so `pnpm-lock.yaml` holds no workspace version; the 0.16.0 prep commit `5b195f8` did not touch it. Run `pnpm install --lockfile-only` and commit the lockfile only if it changes. Runtime version readers need no edit: `apps/web/src/lib/version.ts`, `packages/mcp-server/src/server.ts:75` (`SERVER_VERSION`), `packages/cli/src/index.ts:39` and Python `__version__` all read package metadata.
- KTD9. **Hero h1 wording.** Use the h1 from `growth-readme.md` section 7: "Run your agent's non-urgent LLM tasks at the cleanest grid hour." Keep the `text-accent` span on "cleanest grid hour". In the same Hero component, drop the clause "faster during providers&apos; expanded off-peak capacity," from the paragraph at `apps/web/src/app/page.tsx:81-82`, so the hero carries no "faster". Leave the rest of the hero (DOE paragraph, CTA layout) unchanged; the larger hero redesign in section 7 is not in the brief.

### Assumptions

- The brief's "use the deadline the drafts use" means the 24-hour deadline in drafts section 1a (`Date.now() + 24 * 3600 * 1000` / `timedelta(hours=24)`).
- `Vitalini` is the casing `mcp-publisher login github` reports. If it reports another casing, `mcpName` and `server.json` `name` change together before publish (Vitalii's step).
- The hub-log refresh records the facts in `growth-readme.md` section (c) and `growth-drafts.md` sections 6a/6d as of 2026-10-15; no new checks are run in this PR.

### Sequencing

U1 → U2 → U3 → U4 → U5 → U6 → U7 → U8, one commit each. U8 is last because it bumps files U1 and U4 touch.

---

## Implementation Units

### U1. docs(readme): ten-second head

- **Goal:** R1-R4, R9.
- **Files:** `README.md`.
- **Approach:**
  - Replace `README.md:1-17` (title, italic block, eight badges) with the drafts section 1a block. Keep the H1 as `# ebb-ai` and put the hero line as a bold line under it, or use the drafts' `# ebb-ai — run non-urgent ...` H1; either keeps anchors ASCII-safe.
  - Snippets: TS `await recommendWindow({ region: "GB", deadline }, { feed: ukCarbonIntensityFeed(), rng: () => 0 })`; Python `recommend_window(region="GB", deadline=deadline, feed=uk_carbon_intensity_feed(), rng=lambda: 0)`. Output comments per KTD2. Add the sentence from R2 directly under the snippets.
  - Install block per drafts 1a (Python line `pip install "ebb-ai[anthropic,openai,signing]"`; the `signing` extra exists in `packages/core-py/pyproject.toml`).
  - Proof line and "In an agent" line verbatim from drafts 1a (labels: forecast/projected, this run only, 158 measured).
  - Below the new head, in order: "Why defer non-urgent AI work?" (current lines 19-46), the GB transcript and table (current lines 48-87), the status block (current lines 96-133), then the remaining badges (tests 1,115, MCP 9 tools, hosts 13, website). Then the rest of the file unchanged except the fixes below.
  - Body fixes: `README.md:273` "exposes three tools" → "exposes nine tools" and list or link the nine (names in `packages/core-ts/src/tool-surface.ts`, `toolsForHost("mcp")`; claims row 16); `README.md:323` `pip install -e "packages/core-py[anthropic,openai]"` → `pip install "ebb-ai[anthropic,openai,signing]"` with the `-e` form kept under "Install (development)"; `README.md:347` per KTD3.
  - Do not touch the `> **Status:** v0.16.0` line text in this commit (U8 bumps it).
- **Test scenarios:** none (docs). Verification below.
- **Verification:** `node scripts/check-versions.mjs` passes (status line still matched). `grep -nE '40 ?(–|-|—| to ) ?70' README.md` empty. `grep -n 'queue viewer\|three tools' README.md` empty. Run both snippets once against the workspace build (TS: ESM file importing from `packages/core-ts/dist/index.js`; Python: worktree venv) with network; note the output in the PR body, not in the README.

### U2. docs: npm and PyPI package heads

- **Goal:** R5, R6, R9.
- **Files:** `packages/cli/README.md`, `packages/cli/package.json` (`description`), `packages/mcp-server/README.md`, `packages/mcp-server/package.json` (`description`), `packages/core-py/README.md`, `packages/core-py/pyproject.toml` (`description`).
- **Approach:**
  - `packages/cli/README.md`: replace lines 1-14 (title, intro, "Install" with `pnpm --filter` at lines 11-12) with drafts 2a. Quickstart `node packages/cli/dist/index.js install --laptop` (line 30) → `ebb install --laptop`. Move the `pnpm --filter` lines to a "Develop" section at the bottom. Absolute GitHub URLs for every link. Subcommands verified against `ebb --help`: `tick`, `install`, `queue`, `receipts`, `stats`, `verify`, `register-wake`.
  - `packages/mcp-server/README.md`: replace lines 1-20 with drafts 2b. Host configs at lines 31-33, 54-55, 69-70 (`"command": "node"`, `/ABSOLUTE/PATH/TO/.../dist/server.js`) → `"command": "npx", "args": ["-y", "@ebb-ai/mcp"]`. "Tools exposed" table (lines 76-82) lists 3 tools → list the 9 MCP tools. Remove the stale "v0.1 limitations" section (lines 109-117: in-memory queue, no LLM call) and the `../../ROADMAP.md` link (line 119; file does not exist). Rename "Install (development, monorepo)" to "Develop" and move it to the bottom.
  - `packages/core-py/README.md`: replace lines 1-21 (title, port note with `../core-ts/` and `../../ROADMAP.md`, "Status: v0.2 · 2026-05 · pre-PyPI") with drafts 2c. Python snippet adds `rng=lambda: 0` and the same random-band sentence as U1 for consistency. "Install" section lines 65-75: the PyPI line first, "from source" second. Replace remaining relative links at lines 396 (`ROADMAP.md`, drop) and 402 (`../../LICENSE` → `https://github.com/Vitalini/ebb-ai/blob/main/LICENSE`).
  - `description` values per KTD4, verbatim from drafts 2a/2b/2c.
- **Test scenarios:** none (docs and metadata).
- **Verification:** `grep -n 'pre-PyPI\|in-memory at v0.1\|\.\./' packages/core-py/README.md packages/mcp-server/README.md packages/cli/README.md` empty. `grep -n 'pnpm --filter\|node packages/' packages/cli/README.md packages/mcp-server/README.md` hits only inside "Develop". In the worktree venv, `cd packages/core-py && .venv/bin/pip install -e '.[dev]'` succeeds (pyproject still parses). `pnpm --filter @ebb-ai/cli --filter @ebb-ai/mcp build` succeeds.

### U3. fix(plugin): label the cost claim

- **Goal:** R7.
- **Files:** `packages/claude-code-plugin/.claude-plugin/plugin.json` (line 3, `description`), `.claude-plugin/marketplace.json` (line 12, `plugins[ebb-ai].description`), `packages/claude-code-plugin/skills/ebb-ai/SKILL.md` (frontmatter `description` line 3, body line 12).
- **Approach:** per KTD5. `plugin.json`: "50% cheaper via Anthropic/OpenAI Batch APIs" → "Anthropic/OpenAI Batch APIs at 50% of sync list price (projected)". `marketplace.json`: "routes through Anthropic/OpenAI Batch APIs (50% cheaper)" → "routes through Anthropic/OpenAI Batch APIs (50% of sync list price, projected)". `SKILL.md`: same "(50% of sync list price, projected)" at both places. Keep every other word, keep JSON valid. `packages/openclaw-plugin` has no "cheaper" (verified by grep); no change there.
- **Test scenarios:** none (copy). If `packages/claude-code-plugin` tests snapshot the description, update the snapshot in this commit.
- **Verification:** `git grep -n -i '50% cheaper' -- .claude-plugin packages/claude-code-plugin packages/openclaw-plugin` empty. `node -e 'JSON.parse(require("fs").readFileSync(".claude-plugin/marketplace.json"));JSON.parse(require("fs").readFileSync("packages/claude-code-plugin/.claude-plugin/plugin.json"))'` succeeds. `claude plugin validate ./packages/claude-code-plugin` passes if the CLI is available. `node scripts/check-versions.mjs` passes.

### U4. feat(mcp): registry metadata

- **Goal:** R10.
- **Files:** `packages/mcp-server/package.json` (add `"mcpName": "io.github.Vitalini/ebb-ai"` after `description`), `packages/mcp-server/server.json` (new), `scripts/check-versions.mjs` (two entries).
- **Approach:** `server.json` verbatim from drafts section 3, with both `version` fields set to `0.16.0` (KTD6). Env var list verified against `process.env.*` reads in `packages/mcp-server/src`: all nine listed names exist. In `check-versions.mjs` add `"packages/mcp-server/server.json"` (top-level `version`) and `"packages/mcp-server/server.json (packages[0])"` (`packages[0].version`) to `found`. Do not run `mcp-publisher`.
- **Test scenarios:** `check-versions.mjs` reports the new file count (12 files) at 0.16.0; temporarily editing `server.json` version makes it exit 1 naming the file (check locally, do not commit the edit).
- **Verification:** `node scripts/check-versions.mjs` passes. `server.json` `description` is at most 100 characters (`node -e` length check). If network is available, validate `server.json` against `https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json` with a one-off `npx ajv-cli` run (not committed); if it rejects `repository.subfolder` or `title`, drop that field.

### U5. test: shared select-window parity fixture

- **Goal:** R11.
- **Files:** `packages/core-ts/test/fixtures/select-window-vectors.json` (new), `packages/core-ts/test/select-window.test.ts` (new `describe` block), `packages/core-py/tests/test_select_window.py` (new parametrized test).
- **Approach:** per KTD7. Each vector: `id`, `now`, `deadline`, `rng` (number in [0, 1)), `entries` (`datetime`, `intensity`, `band`), `expected` (`chosen_datetime`, `chosen_intensity`, `band_size`, `tolerance`) or `expected: null`. TS maps `intensity` → `carbonIntensityGCo2PerKwh`, Python → `carbon_intensity_g_co2_per_kwh`; both call the pure selection function with `now` and `rng` injected. Compare `tolerance` with a float tolerance (`toBeCloseTo` / `pytest.approx`). Build the GB case from `parity/page1.json` + `page2.json` hourly values for 2026-10-15T16:10Z (24h deadline) so the vector matches the diagnosis table; inline the parsed entries in the JSON, do not reference the scratchpad.
- **Test scenarios:**
  - GB 24h, rng 0 → 2026-10-16T11:00Z, 66, band size 5 (strict minimum).
  - GB 24h, rng 0.5 → 13:00Z, 69; rng 0.999 → 14:00Z, 88 (last band entry).
  - Floor dominates: cheapest 66 → tolerance 30 (not 9.9).
  - Fraction dominates: cheapest 400 → tolerance 60; an entry at 460 is in the band, 461 is out.
  - Equal intensities in input order → the stable sort picks by input order for a given rng (pins sort stability in both languages).
  - Single-entry band → strict minimum regardless of rng.
  - Current-hour inclusion: an entry at `now − 59 min` is usable, `now − 61 min` is not.
  - No entry inside the deadline → `null` / `None`.
- **Verification:** `pnpm --filter @ebb-ai/core test -- select-window` green; `cd packages/core-py && .venv/bin/pytest -q tests/test_select_window.py` green; `git diff --stat` shows no change under `packages/core-ts/src` or `packages/core-py/src`. If a vector passes in one language and fails in the other, stop (Goal Capsule stop condition).

### U6. fix(web): hero without "faster"

- **Goal:** R8.
- **Files:** `apps/web/src/app/page.tsx` (Hero component, h1 at line 75, paragraph at lines 81-82).
- **Approach:** per KTD9.
- **Test scenarios:** none; no web unit tests exist.
- **Verification:** `grep -n -i 'faster' apps/web/src/app/page.tsx` empty. `pnpm --filter @ebb-ai/web typecheck` and `pnpm --filter @ebb-ai/web lint` pass (root `pnpm typecheck` covers `packages/*` only, not `apps/web`).

### U7. docs(internal): hub submission log

- **Goal:** R12.
- **Files:** `docs/internal/hub-submission-log.md`.
- **Approach:** the log rule is "don't remove rows; update status". Update status cells and add dated rows:
  - punkpeye/awesome-mcp-servers #6348 → "closed, not merged, 2026-07-24 — bot closed for inactivity after nudges asking for a Glama badge and score".
  - New row 2026-10-09: awesome-mcp-servers PR #16076, OPEN, labels `valid-name`, `has-emoji`, `has-glama`; Glama badge in the entry.
  - Green-Software-Foundation/awesome-green-software #215 → "MERGED 2026-08-04 (to `dev`); maintainers rewrote the entry before it reached `main`; live entry has no percentage".
  - ComposioHQ/awesome-claude-skills #877 → "OPEN, no comments as of 2026-10-15".
  - mcp.so → "LIVE but stale: shows v0.7, 'seven grid regions', 'No tools detected' (checked 2026-10-15)".
  - glama.ai → "listed; score badge 'rated A' (claimed, 9 tools)".
- **Test scenarios:** none.
- **Verification:** table rows render (pipe count per row unchanged); no row removed (`git diff` shows only modified or added rows).

### U8. chore(release): prepare 0.16.1

- **Goal:** R13.
- **Files:** `packages/core-ts/package.json`, `packages/cli/package.json`, `packages/mcp-server/package.json`, `packages/mcp-server/server.json` (both fields), `packages/openclaw-plugin/package.json`, `packages/openclaw-plugin/openclaw.plugin.json` (line 179), `packages/claude-code-plugin/.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json`, `packages/core-py/pyproject.toml`, `README.md` (status line, `v0.16.1 (this release) · 2026-10-15`), `CHANGELOG.md`, `pnpm-lock.yaml` only if `pnpm install --lockfile-only` changes it (KTD8).
- **Approach:** CHANGELOG: insert `## [0.16.1] — 2026-10-15` under `## [Unreleased]` with sections: Docs (U1, U2, U7 is internal and is not listed), Fixed (U3 label, U6 hero), Added (U4 `mcpName` + `server.json`, U5 parity fixture under "Tests" or "Added"). Update the link refs at the file end: `[Unreleased]: .../compare/v0.16.1...HEAD` and add `[0.16.1]: .../compare/v0.16.0...v0.16.1`. No tag, no publish.
- **Test scenarios:** none beyond the gates.
- **Verification:** `node scripts/check-versions.mjs` prints `check-versions: 0.16.1 everywhere (12 files)`. `git grep -n '0\.16\.0' -- ':!CHANGELOG.md' ':!docs'` empty. Full gate below.

---

## Verification Contract

Worktree setup, once, before any gate (`docs/solutions/developer-experience/worktree-environment-setup.md`):

```bash
git worktree add .worktrees/chore-growth-readme-0.16.1 -b chore/growth-readme-0.16.1 main
cd .worktrees/chore-growth-readme-0.16.1
pnpm install --frozen-lockfile
pnpm build                      # before typecheck/test: dist/ is gitignored
cd packages/core-py && python3.11 -m venv .venv && .venv/bin/pip install -e '.[dev]' && cd ../..
```

Never symlink the main checkout's `.venv` (false green).

| Gate | Command | Runs after |
|---|---|---|
| Version lockstep | `node scripts/check-versions.mjs` | every commit |
| TS build | `pnpm build` | U2, U4, U5, U8 |
| TS typecheck | `pnpm typecheck` | U4, U5, U8 |
| TS tests | `pnpm test` (U5: `pnpm --filter @ebb-ai/core test` first) | U5, U8 |
| Python tests | `cd packages/core-py && .venv/bin/pytest -q` | U5, U8 |
| Python lint | `cd packages/core-py && .venv/bin/ruff check .` | U5, U8 |
| Web | `pnpm --filter @ebb-ai/web typecheck && pnpm --filter @ebb-ai/web lint` | U6, U8 |
| Generated data | `pnpm gen:data:check` | U8 |
| Claims sweep | command below, output empty | U8 |

Claims sweep:

```bash
git grep -n -iE '40 ?(–|-|—| to ) ?70|queue viewer|pre-PyPI' -- README.md packages apps .claude-plugin
git grep -n -i '50% cheaper' -- .claude-plugin packages/claude-code-plugin packages/openclaw-plugin
```

Both outputs empty. "50% cheaper" stays in labelled or out-of-scope places and is not swept repo-wide: `README.md:30` (labelled), `apps/web/src/app/page.tsx:87` (label footnote), `packages/core-ts/src/providers/base.ts:12` (code comment), `packages/core-ts/src/tool-surface.ts:277` and its snapshot (see Scope Boundaries).

`pnpm preflight` runs most of the above in one command and is the final check at U8. Read a failing log with `grep -nE "✘|Error|expected|FAILED" <log> | head -40`; one re-run, then report.

---

## Definition of Done

- Eight commits on `chore/growth-readme-0.16.1` with the messages from the brief, in order U1-U8.
- Every gate in the Verification Contract passes at U8 head.
- No file under `packages/core-ts/src` or `packages/core-py/src` changed.
- No publish, tag, push to `main` or merge happened. The PR body lists Vitalii's steps: npm and PyPI publish of 0.16.1 from the reviewed PR head before merge (`version-lockstep-check.md`), ClawHub publish, `mcp-publisher login github && mcp-publisher publish` after npm 0.16.1 is live, `gh repo edit` description and topics, social preview upload.
- No abandoned-attempt code or scratch files in the diff.
- One `ce-code-review` pass on the final PR; findings fixed and folded into their commits.
