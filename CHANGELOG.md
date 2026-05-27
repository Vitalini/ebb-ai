# Changelog

All notable changes to ebb-ai will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added — v0.11.0 "Auditable receipts" (Ed25519 + WAL)

- **Ed25519-signed carbon receipts.** Every dispatched task ships a
  cryptographic signature so any consumer can verify, offline and
  asynchronously, that (1) the receipt was produced by an ebb-ai
  installation holding the matching private key, and (2) none of the
  receipt's fields have been tampered with since signing. Direct B2B
  ESG export path now possible — receipts are auditable artefacts,
  not just claims.
- **`packages/core-ts/src/sign.ts`** (new) — Node-native (uses stdlib
  `crypto`, no deps). Public API: `loadOrCreateSigningKey`,
  `signReceipt`, `verifyReceipt`, `canonicalize`, plus
  `defaultSigningKeyPath`. Keys live at `~/.ebb-ai/signing.key` (private,
  0600) + `signing.key.pub` (public, 0644); generated lazily on first
  dispatch with no opt-in friction.
- **`CarbonReceipt`** extended with `signature` (base64 Ed25519 sig),
  `signerPublicKey` (base64 raw 32-byte key, embedded for offline
  verify), and `signedAt` (ISO timestamp for replay defence). Pre-v0.11
  receipts (no signature) verify as `legacy-unsigned`.
- **`SchedulerOptions.signing`** — pass `false` to disable signing,
  or `{ keyPath: "..." }` to override the key location (mostly for tests).
  Default: enabled.
- **`ebb verify [task-id]`** CLI command — verifies a receipt from the
  ledger by id or from a JSON file via `--file`. Exit codes: 0=valid,
  1=tampered, 2=legacy-unsigned, 3=key-mismatch, 4=not-found. Supports
  `--trusted-public-key` for key pinning and `--json` for structured
  output. 7 dedicated CLI tests cover every outcome.
- **Python mirror** `packages/core-py/src/ebb_ai/sign.py` — same API
  surface (snake_case), opt-in via `pip install "ebb-ai[signing]"`
  (pulls in `cryptography>=42`). Without the extra, receipts go out
  unsigned and the scheduler degrades silently (v0.10 shape). 15 tests
  guarded by `is_signing_available()`.
- **WAL multi-writer SQLite.** `TaskStore` now flips
  `journal_mode = WAL` + `synchronous = NORMAL` on first connect for
  disk-backed stores. Lifts the single-writer-per-DB-file
  pessimism — the `ebb tick` daemon and an interactive `ebb-mcp` server
  can hold separate handles over `~/.ebb-ai/queue.db` without
  `SQLITE_BUSY`. Mirrored in the Python `aiosqlite` store. In-memory
  stores (`:memory:`) intentionally skip.
- **`pnpm preflight`** root script — wraps `pnpm typecheck` +
  `pnpm test` + `pnpm lint:py` (ruff + pytest in core-py). Documented
  in CONTRIBUTING. Prevents the v0.10.0 main-branch CI red repeat
  (Python ruff `RUF022` was the missed step).

### Changed — version bumps (lockstep)

- `@ebb-ai/core` 0.10.0 → 0.11.0
- `@ebb-ai/cli` 0.10.0 → 0.11.0 (`ebb verify` added)
- `@ebb-ai/mcp` 0.10.0 → 0.11.0 (SERVER_VERSION synced)
- Claude Code plugin manifest + marketplace 0.10.0 → 0.11.0
- `ebb_ai` PyPI 0.10.0 → 0.11.0 (`[signing]` extras added)
- OpenClaw plugin (`@vitalini/ebb`) unchanged at 0.1.13 — separate
  semver track per ClawHub convention.

### Tests

- TypeScript: 17 new sign tests + 2 new WAL storage tests + 7 new CLI
  verify tests. Total monorepo: 187 → 213 TS tests.
- Python: 15 new sign tests guarded by extras availability. Total:
  97 → 112.

### Added — `@ebb-ai/core` 0.10.0 + `ebb_ai` 0.10.0 (per-model energy)

- **`packages/core-ts/src/energy.ts`** and Python mirror
  **`packages/core-py/src/ebb_ai/energy.py`** — new module replacing
  the v0.1–v0.9 placeholder `ENERGY_KWH_PER_TASK = 0.0015` with a
  cited per-model Wh/token lookup table.
- **Public API.** `estimateEnergyKwh({ model, inputTokens, outputTokens, pue })`,
  `gramsForIntensity(g, opts)`, `lookupModelEnergy(model)`,
  `normalizeModelName(name)` plus `MODEL_ENERGY_COEFFICIENTS`,
  `DEFAULT_PUE = 1.15`, `LEGACY_KWH_PER_TASK = 0.0015`, and
  `ENERGY_SOURCES` (citation metadata). Python mirror uses snake_case.
- **Coefficient table.** 37 entries spanning Anthropic Claude
  (opus/sonnet/haiku, 3.x and 4.x), OpenAI (gpt-4, gpt-4o,
  gpt-4o-mini, gpt-3.5-turbo, o1/o1-mini, o3/o3-mini), Google
  Gemini (1.5 pro/flash, 2.0 pro/flash), and open-weight Llama /
  Mistral / Mixtral families. Each entry carries a `source`
  confidence tier: `measured` (HF AI Energy Score / Luccioni 2024
  benchmarks), `estimated` (inferred from public parameter-count
  disclosures + Luccioni scaling), `fallback` (the legacy flat).
- **Wiring.** `recommend.ts` and `scheduler.ts` now thread the
  model identifier through every `intensityToGrams` call site that
  has one in scope:
  - `recommendWindow(opts)` uses `opts.model` for budget filtering
    + estimated grams + alternatives.
  - `scheduler.previewProviderCall(spec)` uses `spec.model`.
  - `scheduler.scheduleProviderCall(record)` parses `spec.model`
    out of `record.bodyJson` for both budget filtering and the
    `record.estimatedCarbonGCo2` projection.
  - `scheduler.dispatchProviderCall(record)` re-estimates with the
    real `usage.inputTokens` / `usage.outputTokens` the provider
    reports for the receipt's `actualCarbonGCo2` field, turning the
    receipt from "typical task at this model" into "this specific
    call at this model".
- **Backwards compatibility.** `estimateEnergyKwh()` with no args
  returns the legacy `0.0015` bit-exactly; unknown model names with
  no token counts also map to the same legacy value. Closure-based
  `Scheduler.defer` (no model in scope) continues to use the legacy
  estimate. All 134 existing TypeScript tests + 75 existing Python
  tests pass without modification.
- **Tests.** `packages/core-ts/test/energy.test.ts` adds 22 new
  cases (normalization, lookup, backwards-compat, per-model math,
  PUE override, linearity, table sanity, citations). Python mirror
  in `packages/core-py/tests/test_energy.py` adds 22 more.
- **Sources.** Patterson et al. 2021 ("Carbon Emissions and Large
  Neural Network Training", arXiv:2104.10350), Luccioni, Jernite,
  Strubell 2024 ("Power Hungry Processing", FAccT 2024,
  arXiv:2311.16863), Hugging Face AI Energy Score (2024–).
- **README touchup.** `packages/core-py/README.md` carbon-receipt
  section no longer references the v0.2 `ENERGY_KWH_PER_TASK = 0.0015`
  placeholder.

### Changed — version bumps (lockstep)

- `@ebb-ai/core` 0.9.0 → 0.10.0
- `@ebb-ai/cli` 0.9.0 → 0.10.0 (CLI_VERSION constant also fixed —
  was lagging at 0.8.3 since v0.8.3 publish)
- `@ebb-ai/mcp` 0.9.0 → 0.10.0 (SERVER_VERSION constant synced)
- Claude Code plugin manifest + marketplace 0.8.2 → 0.10.0
- `ebb_ai` PyPI — first publish at 0.6.0, then jumped to 0.10.0 to
  align with the TS lockstep. Skipping 0.7-0.9 on PyPI is intentional:
  the project versions across languages now share a single semver
  track. Both 0.6.0 and 0.10.0 remain installable from PyPI; latest
  resolves to 0.10.0.
- OpenClaw plugin (`@vitalini/ebb`) unchanged at 0.1.13 — separate
  semver track per ClawHub convention.

### Changed — site (no version bump yet)

- **`/stats` and `/queue` rewritten as honest docs** — both used to
  show synthetic aggregates behind a "DEMO MODE" banner. Now they're
  explainer pages: where your data lives (`~/.ebb-ai/queue.db`),
  how to read it from the CLI (`ebb stats`, `ebb queue list`),
  what the schema looks like, why no public aggregate numbers
  (local-first by design; v0.9 opt-in leaderboard design at
  `docs/spec/proposal/v09-leaderboard.md`).
- **Home redesign.** Hero with one-line "Defer AI work to the
  cleanest hour of the grid", a 30-second install dropdown across
  13 hosts (MCP universal, Claude Code, Claude Desktop, Cursor,
  Windsurf, Continue, Cline, Zed, Goose, OpenClaw, mcphost-cli,
  Python lib, Node lib), 4 navigation tiles (Map / Plan / Stats /
  Docs), and a 5-metric KPI strip.
- **Real `/docs` route** (was a static catalog of GitHub MD links).
  Now: install picker, all 8 `/ebb-ai:*` slash commands, all 9 MCP
  tools, env vars, on-disk paths, architecture/repo links.
- **`/map` route added** — the previous home content (7 region cards
  + methodology) moved here so the home is a launcher, not a data
  dashboard.
- **`/about` page** added — long-form why-this-exists, how-it-works,
  who-it's-for.
- **`/roadmap` removed** — public site no longer publishes the
  roadmap; planning is local in `development/ROADMAP.md`.

### Removed — repo layout

- **`apps/site/` deleted** — dead static landing page from before
  `apps/web/` (Next.js dashboard) existed. Nothing referenced it.
- **`apps/dashboard/` renamed to `apps/web/`** — the app is no
  longer a "dashboard" surface; it's a launcher + docs site.
- **`apps/web/public/docs.html`** — orphan after the `/docs` →
  Next.js-route migration; the architecture.html nav now points at
  `/docs` instead of `/docs.html`.
- **`apps/web/src/app/api/queue/route.ts`** + **`task-row.tsx`**
  component — both supported the synthetic `/queue` snapshot that
  no longer exists.
- **`PLUGIN.md`** at repo root — absorbed into
  `packages/claude-code-plugin/README.md` (where the plugin lives now).
- **`REVIEW-engineering.md`** at repo root — moved to
  `docs/archive/engineering-review-v0.1.md`.
- **`ROADMAP.md`** at repo root — gitignored (lives under
  `development/` for local planning, not published).

### Added — discoverability

- **`/llms.txt`** at site root — AI-crawler-friendly summary
  (project description, install commands, MCP tools, when-to-recommend).
- **`robots.txt`** explicitly allows GPTBot, ChatGPT-User,
  OAI-SearchBot, ClaudeBot, Claude-Web, PerplexityBot, Google-Extended,
  Applebot-Extended, CCBot, Bytespider, Amazonbot, etc.
- **JSON-LD `SoftwareApplication` + `WebSite` schema** in `layout.tsx`.
- **Trigger-language** added to plugin.json + marketplace.json +
  defer.md + `schedule_task` MCP tool description + the Claude Code
  skill — agents now auto-invoke `/ebb-ai:defer` whenever the user
  phrases a request with "do this later" / "by tomorrow" /
  "overnight" / "by EOD" / "sometime this week" / "remind me to" /
  "queue this up" / "no rush" etc.

### Added — packages

- **`packages/openclaw-plugin`** (`@vitalini/ebb-ai@0.1.0` on
  ClawHub) — native OpenClaw plugin with 4 tools (schedule_task,
  recommend_window, check_queue_status, cancel_task). Shares
  `~/.ebb-ai/queue.db` with the MCP server and CLI.
- **`packages/claude-code-plugin`** — relocated from the repo root
  for monorepo symmetry. The marketplace listing at
  `.claude-plugin/marketplace.json` now points there via `source:
  "./packages/claude-code-plugin/"`.

## [0.8.3] — 2026-05-17

**Theme:** "CLI version-string fix."

### Fixed

- **`@ebb-ai/cli` — `ebb --version` was returning the hardcoded
  string `0.4.0` instead of the actual package version** (the
  string had been left in `src/index.ts` since the v0.4 surface
  and never re-synced to `package.json`). Same bug pattern as
  the v0.7.1 MCP server `serverInfo` issue fixed in v0.8.1.
  The CLI now reads from a single `CLI_VERSION` constant kept in
  sync with `package.json`. Discovered by the v0.8.2 post-release
  global test pass.

### npm

- `@ebb-ai/cli` 0.8.2 → 0.8.3
- `@ebb-ai/mcp`, `@ebb-ai/core` unchanged at 0.8.2.

## [0.8.2] — 2026-05-17

**Theme:** "Polish + roadmap drafts." Closes every loose end the
post-v0.8.1 global test pass surfaced; lands the v0.8.2
simulation-tightening; ships the dashboard `/stats` route; and
adds three roadmap-ready drafts (upstream MCP spec PR, arXiv
preprint, v0.9 leaderboard design) that move the project off the
"nothing-shipped-upstream-yet" baseline.

### Added — dashboard

- **`/stats` route** (`apps/dashboard/src/app/stats/page.tsx`).
  Personal-impact view consuming the same aggregator shape as
  `ebb stats` CLI. Demo data with a prominent "demo mode" banner
  and a pointer to the CLI for real local numbers.
- **`/architecture`, `/docs`, `/roadmap` static pages**, served
  via Next.js rewrites from `apps/dashboard/public/`. Closes the
  404 the global test pass found on `www.ebb-ai.com`.

### Added — operator docs

- **`docs/VERCEL-DEPLOY.md`** — Step-by-step guide to add
  `EBB_EIA_API_KEY`, `EBB_ENTSOE_SECURITY_TOKEN`, and
  `EBB_ELECTRICITY_MAPS_API_KEY` to the Vercel project so the
  live site shows real data for six currently-mock regions.
- **`apps/dashboard/.env.example`** — Mirror of the env-vars
  the local development setup expects.

### Added — drafts (not shipping code; positioning the project)

- **`docs/spec/proposal/UPSTREAM-PR.md`** — Paste-ready GitHub PR
  body + schema/spec diff for the upstream
  `modelcontextprotocol/specification` repository, proposing
  optional `priority`, `deadline`, `carbon_budget` fields on
  `tools/call`. Includes filing checklist and follow-up plan.
- **`docs/papers/carbon-aware-mcp-scheduling.md`** — 4-section
  technical paper for HotCarbon Workshop (USENIX) submission or
  arXiv cs.DC preprint. Covers system design, evaluation
  methodology, the v0.8.2 simulation results, and the spec
  proposal. ~5 pages rendered.
- **`docs/spec/proposal/v09-leaderboard.md`** — v0.9 leaderboard
  architecture: opt-in telemetry endpoint, Ed25519-signed events,
  privacy model, anti-abuse, reference implementation sketch.
  Implementation gated on a privacy-policy
  review and a 30-day beta.

### Changed — scheduler / mock feed

- **`mockGridFeed(clock?)`** now accepts an injected clock so
  simulations that sweep many synthetic submit times produce
  aligned forecasts. Without the parameter, behaviour is
  unchanged (wall-clock now).
- **Even-distribution simulation tightened.** With clock-injected
  mock + varied submit times + the existing v0.8.0 jitter, the
  test now demonstrates a 10.8 % max-bucket concentration (vs.
  the 66.9 % pre-v0.8.0 pathology and 51.0 % at v0.8.1). The
  threshold is ratcheted to 20 %; an empty-bucket assertion
  catches partial-spread regressions.

### Changed — UX

- **`/queue` page** demo-mode banner is now a prominent
  amber-bordered aside (was a small grey footnote). Updated
  `/api/queue` response body to include a `note` field with
  CLI guidance for getting real data.
- **Dashboard banner** v0.7.1 → v0.8.0 (later 0.8.2 from this
  release).

### Fixed — already in v0.8.1, re-shipped here for the plugin

- (no new fixes; this release is polish + plugin re-sync)

### Plugin

- Plugin manifest bumped 0.8.0 → 0.8.2 to match the released
  package versions.

### npm

- `@ebb-ai/core` 0.8.0 → 0.8.2
- `@ebb-ai/cli` 0.8.1 → 0.8.2
- `@ebb-ai/mcp` 0.8.1 → 0.8.2

### Tests

- Unchanged at 204 (100 + 21 + 8 + 75); the simulation rewrite
  is a same-test rewrite, not an added one.

## [0.8.1] — 2026-05-16

**Theme:** "Three bugs caught by the post-release global test pass."

### Fixed

- **`@ebb-ai/mcp` — `serverInfo` and stderr banner reported the wrong
  version** (`0.7.1` hardcoded, while the package was on 0.8.0). The
  MCP protocol surface now reports the actual server version via a
  `SERVER_VERSION` constant kept in sync with `package.json`.
- **`@ebb-ai/cli` — `defaultDbPath()` pointed to `~/.ebb/queue.sqlite`,
  but the MCP server writes to `~/.ebb-ai/queue.db`** (the v0.7.1+
  persistence default). The two never agreed, so `ebb stats`,
  `ebb queue list`, and `ebb receipts list` silently returned empty
  results even when the user's MCP server had real data. The CLI now
  defaults to the MCP server's path; if the legacy `~/.ebb/queue.sqlite`
  exists and the new path doesn't, the legacy path is returned so
  pre-v0.7.1 users keep seeing their historical data.
- **`@ebb-ai/cli` — `ebb stats` did not create the parent directory
  before opening the SQLite database**, causing a first-time invocation
  before the MCP server had ever written to the ledger to throw
  ENOENT. The CLI now `mkdirSync(..., recursive)` on the parent
  before opening.

### npm

- `@ebb-ai/cli` 0.8.0 → 0.8.1
- `@ebb-ai/mcp` 0.8.0 → 0.8.1
- `@ebb-ai/core` unchanged at 0.8.0.

## [0.8.0] — 2026-05-16

**Theme:** "Personal impact + even distribution." Adds a local-only
aggregator over the persistent SQLite ledger, a new `ebb stats` CLI
command on top of it, an even-distribution simulation that exposes
(and fixes) a scheduler concentration pathology, and the per-zone
grid-feed router default for the MCP server.

### Added

- **`@ebb-ai/core` — local-impact aggregator** (`src/aggregator.ts`).
  Pure functions over `CarbonReceipt` rows: `aggregateStats`,
  `aggregateByRegion`, `bandHistogram`, `achievements` (seven local-
  only badges).
- **`@ebb-ai/cli` — `ebb stats` command** consuming the aggregator.
  Reads `~/.ebb-ai/queue.db` directly, prints a compact human table
  or `--json` for programmatic consumption. No telemetry.
- **`@ebb-ai/core` — `buildDefaultGridFeed()`** helper exported.
  Wraps `multiSourceGridFeed` with per-zone routing: GB →
  `ukCarbonIntensityFeed` (free, key-less, real data); US ISOs →
  `eiaFeed`; EU zones → `entsoeFeed`; universal fallback →
  `electricityMapsFeed`. Each leaf falls back to the deterministic
  mock when its API key is missing. The MCP server now uses this
  helper as its default, so a fresh install yields live grid data
  for GB without configuring any environment variables.
- **`@ebb-ai/core` — even-distribution simulation** at
  `test/even-distribution.test.ts`. Runs 10 000 synthetic tasks
  through `recommendWindow` across seven grid regions with varied
  deadlines (1 h to 72 h) and bins the chosen UTC-hour dispatch
  into a 24-bucket histogram. Asserts no single bucket holds the
  entire load and prints the histogram to the test log for
  inspection.

### Changed — scheduler

- **`recommendWindow` randomized tie-break.** Entries within a 15 %
  tolerance of the cheapest in-deadline window (floor 30 g
  CO2e/kWh) are treated as equally clean; one is selected via the
  injectable `rng` dependency (defaults to `Math.random`). Closes
  the "everyone runs at 03:00 UTC" pathology revealed by the new
  simulation: pre-fix concentration was 66.9 % in a single hour;
  post-fix the chosen-hour distribution spreads across the full
  forecast window.
- **`mockGridFeed` per-region phase offsets.** Each region's
  synthetic curve is now phase-shifted by its canonical UTC offset
  so different regions exhibit different trough hours, more
  faithfully modelling real-grid per-region timing variance.

### Fixed

- `mockGridFeed` no longer produces negative carbon-intensity
  values. Previously, FR's `regionFloor` (60 g/kWh) plus the
  amplitude (220) at trough yielded a -160 g/kWh value; the
  returned curve now clamps at zero.
- `multiSourceGridFeed({ feeds: undefined, fallback })` no longer
  throws. The `feeds` parameter is optional; the router degenerates
  to the fallback feed when omitted.
- Dashboard version banner updated to track the released version.

### npm

- `@ebb-ai/core` 0.7.0 → 0.8.0
- `@ebb-ai/cli` 0.7.0 → 0.8.0
- `@ebb-ai/mcp` 0.7.1 → 0.8.0

### Tests

- Core TypeScript: 100 (aggregator + even-distribution simulation
  added).
- CLI: 21 (`ebb stats` paths covered).
- MCP server: 8 (unchanged).
- Python parity: 75 (unchanged).
- **Total: 204 passing tests** across all packages.

## [0.5.0] — 2026-05-13

**Theme:** "Control and reliability." Answers the four product
questions raised in review: how to make sure the user gives a clear
request, what form the result takes, what to do if the user changes
their mind, and how to mitigate the operational failure modes
(rate-limits, concurrent ticks, secrets in receipts).

### Added — control surface

- **`cancel_task` (MCP) + `Scheduler.cancelTask` (TS) + `Scheduler.cancel_task` (Python).**
  Idempotent cancellation. If the task is queued/scheduled, status
  transitions to `cancelled`. Already-terminal tasks return
  unchanged. Throws only on unknown task id.
- **`expedite_task` (MCP) + `Scheduler.expediteTask` + `Scheduler.expedite_task` (Python).**
  Dispatch a queued provider-call task immediately, bypassing its
  carbon window. Receipt records `intensitySource: "expedited"` to
  preserve the audit trail's honesty.
- **`update_deadline` (MCP) + `Scheduler.updateDeadline` + `Scheduler.update_deadline` (Python).**
  Re-score and reschedule a queued task against a new deadline.
  Throws if the task is already running or in a terminal state.
- **`retry_task` (MCP) + `Scheduler.retryTask` + `Scheduler.retry_task` (Python).**
  Re-dispatch a `failed` task. Receipt overwrites the previous.

### Added — task-clarity layer

- **`schedule_task` `dry_run: true` (MCP) + `Scheduler.previewProviderCall` (TS).**
  Returns the planned dispatch — chosen window, estimated carbon,
  band, batch eligibility — **without** persisting anything. Useful
  for confirmation flows before the agent commits to schedule a
  task.
- **Prompt validation.** `schedule_task` rejects empty / whitespace
  prompts at the boundary instead of dispatching garbage hours later.

### Added — result delivery

- **`output_path` field on `ProviderCallSpec`.** When set, the
  dispatcher writes `{ taskId, result, receipt }` as JSON to that
  path on success. Useful for inbox patterns and file-watchers.
- **`prompt` on `CarbonReceipt`.** The receipt now retains the
  prompt (redacted by default — see below) so the audit ledger is
  complete.
- **`totalTokens` on `CarbonReceipt`.** Total token count reported
  by the provider, when available.

### Added — failure-mode mitigation

- **Retry with exponential backoff.** Provider-adapter dispatches
  retry 3 times at 1 s / 4 s / 16 s on transient errors (429
  rate-limit, 5xx, network errors). Non-retryable errors (4xx
  other than 429) fail fast.
- **Row-level claim in `tick`.** Two concurrent `ebb tick` processes
  pointing at the same SQLite file no longer race-dispatch the same
  task — only the process whose `UPDATE tasks SET status='running'
  WHERE task_id=? AND status='scheduled'` changed exactly one row
  owns the dispatch. Concurrency test verified deterministic at
  10/10 reruns.
- **Receipt redaction.** `redactInReceipt` field on
  `ProviderCallSpec` controls regex redaction of secrets in the
  stored prompt. Omitted = default patterns (API-key shapes,
  bearer tokens). `[]` = no redaction. The dispatched call uses the
  original prompt; only the receipt is redacted.

### Added — Linux daemonization (was templates-only in v0.4)

- **Real systemd `.service` + `.timer` generation** in
  `@ebb-ai/cli` (`platform/linux.ts`). `ebb install --laptop`
  writes `~/.config/systemd/user/ebb-tick.service` and
  `ebb-tick.timer` plus the laptop-wake helper script; emits the
  exact `systemctl --user daemon-reload && systemctl --user enable
  --now ebb-tick.timer` next-step line.
- **`rtcwake` wake-event support** on Linux mirroring the macOS
  `pmset schedule wake` path. `ebb register-wake <task-id>` is
  now cross-platform.

### Added — Python parity

- **`Scheduler.tick(adapters)`** Python — drains due provider-call
  tasks via the matching adapter, identical semantics to TS.
- **`Scheduler.cancel_task / expedite_task / update_deadline / retry_task`** Python.
- **`ProviderCallSpec`, `TickResult`, `TickResultEntry`** dataclasses
  in `ebb_ai.types`.
- **Row-level claim** in the Python `_TaskStore` matches TS.
- **`body_json` column migration** in the Python SQLite store
  matches TS.

### Changed

- `@ebb-ai/core` 0.4.0 → **0.5.0**.
- `@ebb-ai/mcp` 0.4.0 → **0.5.0**.
- `@ebb-ai/cli` 0.4.0 → **0.5.0**.
- `ebb-ai` (Python) 0.3.0 → **0.5.0** (skips 0.4 to align).
- MCP server now exposes **8 tools** (was 4): the four v0.3
  tools plus `cancel_task`, `expedite_task`, `update_deadline`,
  `retry_task`.
- `TaskStatus` union gains `"cancelled"`. `IntensitySource` gains
  `"expedited"`.

### Tests

- TS core: **65 passed** (was 48; +17 for v0.5 — preview,
  redact, output_path, retry/backoff, cancel/expedite/update/retry,
  row-level claim).
- MCP server: **8 passed** (unchanged at the protocol-stub level;
  the new tools' wire shape is covered by the underlying scheduler
  tests).
- `@ebb-ai/cli`: **21 passed** (was 13; +8 for Linux platform).
- Python: **75 passed** (was 56; +19 for v0.5 tick / cancel /
  expedite / update / retry / concurrency).
- **Total across the project: 169 passing.**

### Known limitations (planned for v0.6)

- Single-writer SQLite holds. WAL multi-writer is queued.
- Lenient deadline parser ("tomorrow 8am") not yet shipped; only
  ISO-8601 datetimes with timezone offset are accepted.
- Stuck-running detection is documented but not yet auto-recoverable;
  tasks stuck in `running > 1h` are reported but not auto-failed.
- Webhook delivery (`output: { webhook: "..." }`) deferred — file
  output and pull-by-id remain the v0.5 delivery modes.
- Python `pyebb` CLI deferred — operators use the TS `ebb` CLI.

## [0.4.0] — 2026-05-12

### Added
- **`@ebb-ai/cli`** — new package shipping the `ebb` binary. Five
  subcommands: `tick`, `install`, `queue list`, `receipts list`,
  `register-wake`. Cross-platform shell entrypoint for the v0.4
  always-on story.
- **`ebb tick`** — one-shot or `--daemon` mode. Opens the SQLite
  ledger, finds tasks whose `scheduled_for` has elapsed, dispatches
  via Anthropic/OpenAI adapters, writes the receipt. This closes the
  v0.3 gap where deferred tasks died with the MCP host process.
- **`ebb install --laptop | --server`** — macOS launchd plist
  generator. `--laptop` additionally drops a `laptop-wake.sh` helper
  that registers `pmset schedule wake` events 30s before each
  scheduled task. `--server` skips the wake step.
- **`ebb register-wake <task-id>`** — schedules a macOS wake event
  via `pmset` for a specific task. `--dry-run` prints the exact
  command without running it. Sudoers entry required for non-root
  invocation; the command shape is printed every time so it can be
  pre-authorized.
- **`@ebb-ai/core` v0.4:**
  - New `Scheduler.enqueueProviderCall(spec, opts)` method — persists
    a JSON-serializable provider-call task body. Closures still work
    via `defer()` but are still in-process-only; provider-calls
    survive restart.
  - New `Scheduler.tick(adapters)` method — drains due tasks
    persistently. Returns `{ inspected, dispatched, failed }`.
  - New types `ProviderCallSpec`, `TickResult`, `TickResultEntry`.
  - SQLite schema migration: added `body_json` column via idempotent
    `ALTER TABLE` so v0.3 DB files are picked up without manual
    intervention.
- **Platform abstractions** — `packages/cli/src/platform/macos.ts`
  ships `caffeinateWhilePending`, `pmsetScheduleWake`,
  `pmsetCommand`, `formatPmsetDate`, `launchdPlist`. `linux.ts` and
  `windows.ts` ship template generators (systemd / schtasks) as
  stubs; full Linux + Windows runtimes land in v0.5.
- **Five new example folders** — `examples/cline/`,
  `examples/continue/`, `examples/zed/`, `examples/windsurf/`,
  `examples/pi/`. Each ships a README + the host's native MCP-config
  shape (`mcp_settings.json` / `config.yaml` / native
  `context_servers` block / `mcp_config.json` / AGENTS.md skill
  stanza). Brings supported MCP-host count from 5 → 10.

### Fixed
- TypeScript SQLite store crashed at runtime with
  `ERR_AMBIGUOUS_MODULE_SYNTAX` because the `better-sqlite3` loader
  used CJS-style `require()` inside an ESM emit. Replaced with
  `import { createRequire } from "node:module"; const requireFn =
  createRequire(import.meta.url);`. Vitest tests passed (vite
  polyfills `require`); the production `dist/` binary did not until
  this fix.
- Wrong dashboard pnpm filter in `README.md` and `QUICKSTART.md`:
  `pnpm --filter ebb-dashboard dev` corrected to `pnpm --filter
  @ebb-ai/dashboard dev`.

### Changed
- `@ebb-ai/core` 0.3.0 → **0.4.0**.
- `@ebb-ai/mcp` 0.3.0 → **0.4.0**.
- `@ebb-ai/cli` initial release at **0.4.0**.
- Python `ebb_ai` stays at 0.3.0 in this drop; Python parity for the
  CLI and `tick()` method lands in v0.5 (see roadmap).

### Tests
- TypeScript core: **48 passed** (was 41; +7 for the tick / persisted
  provider-call path).
- MCP server: **8 passed** (unchanged from v0.3).
- CLI: **13 passed** (new package: 8 platform-macos snapshots, 4
  install dry-run / template, 1 tick env handling).
- Python: **56 passed** (unchanged in v0.4 per scope; v0.5 brings
  Python `tick` parity).
- Total across the project: **125 passing**.

### Known limitations (planned for v0.5)
- Linux + Windows install paths only emit a template; no live
  daemonization. Use the printed systemd unit / schtasks command
  as a starting point.
- `pmset schedule wake` requires sudo per call. Users must add a
  sudoers entry for the `ebb` binary or run `ebb register-wake`
  manually.
- Closure-based `defer()` tasks are still in-process only. v0.4
  intentionally only persists `provider_call` task bodies.
- Python port does not yet have a `tick()` method or a `pyebb` CLI.

## [0.3.0] — 2026-05-12

### Added
- **`recommend_window` — planning endpoint.** New MCP tool +
  `recommendWindow()` (TS) / `recommend_window()` (Python) library
  functions. Returns the optimal execution time for a task **without**
  committing to schedule it. Output includes the chosen window's
  intensity, carbon estimate, percent savings vs. running now, batch
  eligibility, three alternative windows, and a one-line
  human-readable reasoning string. Pure read-only — does not touch
  the queue.
- **Cursor example.** `examples/cursor/` with `mcp.json` stanza and
  install README. Cursor ≥ 0.45 speaks MCP natively.
- **Claude Desktop example.** `examples/claude-desktop/` with config
  template and troubleshooting guide.
- **`QUICKSTART.md`** — four steps, five minutes. Linked from README.
- **Copy buttons** on every code block on the marketing site
  (`apps/site/copy-buttons.js`).
- **Launch hero** in `README.md`: a single-glance `recommend_window`
  example showing the canonical JSON output.

### Changed
- `@ebb-ai/core` 0.2.0 → **0.3.0**, `@ebb-ai/mcp` 0.2.0 → **0.3.0**,
  `ebb-ai` (Python) 0.2.0 → **0.3.0**.
- MCP server now exposes **4 tools** (was 3): `get_grid_forecast`,
  `recommend_window`, `schedule_task`, `check_queue_status`.
- Site `architecture.html` system diagram: text overflow fix on
  SCHEDULER CORE and MCP SERVER boxes; updated tool count.
- Site `index.html` "Why it matters" section: corrected Batch API
  framing. **Batch is not faster** — it trades latency (24h SLA) for
  the 50% discount. Carbon and dollars are the primary pitch; latency
  is a third-tier side effect. Same correction applied in `README.md`
  and `packages/core-py/README.md`.
- Inline `<code>` now wraps long file-paths via `word-break:
  break-all` (was overflowing `.int-card` content).

### Tests
- TypeScript core: **41 passed** (was 26; +15 for `recommend`).
- MCP server: **8 passed** (was 6; +2 for `recommend_window` over the
  real MCP protocol).
- Python: **56 passed** (was 41; +15 for `recommend`).
- Total across the project: **105 passing**.

## [0.2.0] — 2026-05-12

### Added
- **Provider adapters.** `AnthropicAdapter` and `OpenAIAdapter` in
  `@ebb-ai/core/providers`. Each adapter exposes `dispatch()` for
  sync calls and `dispatchBatch()` for the vendor Batch API (50%
  discount, 24h SLA). SDKs are peer dependencies and imported lazily,
  so missing-SDK callers still get a clear error rather than a
  module-load crash.
- **SQLite-backed durable queue.** Opt-in via `new Scheduler({ dbPath })`.
  Every state transition writes through to an on-disk audit ledger;
  records survive process restart and can be reloaded with
  `Scheduler.listPersistedTasks()` / `Scheduler.loadPersistedTask()`.
- **Python port.** `packages/core-py/` ships a complete Python 3.11+
  package (`ebb_ai`) with `asyncio` scheduler, `aiosqlite` persistence
  from day one, and `AnthropicAdapter` + `OpenAIAdapter` mirrors. 41/41
  pytest cases passing.
- **Dashboard MVP.** `apps/dashboard/` is a Next.js 15 app router
  application with four pages (Home, Forecast, Plan, Queue), 6 grid
  regions, recharts visualizations, and live `/api/grid/[region]` +
  `/api/queue` endpoints. Mock fallback when no Electricity Maps key
  is set.
- **Site expansion.** `apps/site/` now ships `architecture.html` (SVG
  diagram + 8-step data flow), `roadmap.html` (v0.1 → v1.0 with
  versioned status pills), and `docs.html` (categorized GitHub-linked
  index).
- Real MCP-protocol smoke test using `InMemoryTransport`.
- `CHANGELOG.md`, `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, `CODEOWNERS`.
- `docs/spec/01-priority-and-deadline-fields.md` — draft proposal for
  upstream MCP spec engagement.

### Changed
- `@ebb-ai/core` bumped to **0.2.0**, `@ebb-ai/mcp` bumped to **0.2.0**.
- Public surface expanded with `AnthropicAdapter`, `OpenAIAdapter`,
  `TaskStore`, and the supporting types `BatchHandle`,
  `DispatchOptions`, `DispatchResult`, `ProviderAdapter`,
  `TaskStoreOptions`.

### Known limitations (planned for v0.3)
- Scheduler does not yet auto-route between sync and Batch paths based
  on deadline distance — adapters expose both, but the v0.2 scheduler
  still treats the task body as opaque. Wiring the routing decision
  into the scheduler is the lead v0.3 item.
- WattTime marginal-emissions feed is still pending.
- Multi-writer (multiple schedulers pointed at one DB) requires WAL
  mode; v0.2 SQLite store assumes single writer.

## [0.1.0] — 2026-05-12

### Added
- `@ebb-ai/core` — TypeScript core library: `Scheduler` class,
  `defer()` function, `pickBestWindow` helper.
- `@ebb-ai/mcp` — Model Context Protocol server exposing
  `get_grid_forecast`, `schedule_task`, and `check_queue_status`
  tools over stdio.
- Mock and Electricity Maps grid feeds with automatic fallback when
  no API key is configured.
- Carbon budget enforcement: `carbonBudgetG` in `DeferOptions` is now
  honored; tasks fail with `CarbonBudgetExceededError` when no
  in-deadline window meets the budget.
- ISO-8601 deadline validation: invalid or past deadlines throw
  `InvalidDeadlineError` at the scheduler boundary and the MCP
  request validator.
- Reference integrations for Claude Desktop, Claude Code, OpenClaw,
  and OpenAI Codex CLI in `examples/`.
- Static landing site under `apps/site/` (no JS, no framework).
- 24-week project plan in `ROADMAP.md`.

### Fixed
- (Pre-v0.1.0 engineering review.) Carbon budget was previously
  captured but unenforced; `schedule_task` accepted unparseable and
  past deadlines silently; Electricity Maps fetch had no timeout;
  README and landing page used a non-existent region code
  `"us-east"`; Claude Code install flow documented a config path the
  client does not read. All addressed before v0.1 ship.

### Known limitations (planned for v0.2)
- The MCP server schedules dispatch time but does not invoke the LLM
  itself. The agent calling the tool is expected to execute the
  prompt when the window arrives.
- Queue is in-memory; restarts lose state. SQLite-backed durable
  queue is planned for v0.2.
- No provider adapters yet for Anthropic Message Batches or OpenAI
  Batches APIs. Direct Batch routing lands in v0.2.
- Python port (`ebb-ai` PyPI) is a placeholder. v0.2.

[Unreleased]: https://github.com/Vitalini/ebb-ai/compare/v0.5.0...HEAD
[0.5.0]: https://github.com/Vitalini/ebb-ai/compare/v0.4.0...v0.5.0
[0.4.0]: https://github.com/Vitalini/ebb-ai/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/Vitalini/ebb-ai/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/Vitalini/ebb-ai/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/Vitalini/ebb-ai/releases/tag/v0.1.0
