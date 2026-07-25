# Changelog

All notable changes to ebb-ai will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

**Theme:** "No ambient state." The library stops reading the environment;
the hosts inject configuration.

### Changed

- **`@ebb-ai/core` is environment-pure — it reads no environment variables.**
  0.14.1 narrowed the reads to named keys; that was not enough. ClawScan's
  `suspicious.env_credential_access` rule fires on *any* ambient-environment
  read inside a bundle that also makes network calls — the remaining finding
  was `EBB_CARBON_BUDGET_G`, a non-secret numeric threshold. The only way to
  clear it is to have zero such reads in the published bundle, so the reads are
  gone rather than narrowed. Independently it is the right shape: a library
  that reaches into ambient state is untestable and surprising to callers.

  - `grid.ts`: `electricityMapsFeed` / `eiaFeed` / `entsoeFeed` / `wattTimeFeed`
    take their credentials only as arguments. New `GridFeedCredentials` shape;
    `buildDefaultGridFeed(credentials)` threads it to each leaf feed.
    `buildDefaultGridFeed()` with no argument behaves exactly as before with no
    variables exported: free UK feed for GB, deterministic mock elsewhere.
  - `providers/{anthropic,openai,gemini,ollama}.ts`: `apiKey` / `host` come only
    from the constructor. The `GEMINI_API_KEY`-then-`GOOGLE_API_KEY` precedence
    moved to the hosts, unchanged.
  - `budget.ts`: `loadCarbonBudgetConfig` still reads the `~/.ebb-ai/config`
    FILE (filesystem I/O against a path the project owns, not ambient state)
    but takes its overrides solely from `opts.env`.

- **The OpenClaw plugin (`@vitalini/ebb`) reads no environment variables at
  all.** Its bundle now contains **zero** environment accesses. Everything it
  used to take from the environment is an OpenClaw plugin-config field under
  `plugins.entries.ebb.config`, declared in `openclaw.plugin.json`'s
  `configSchema` with a description naming the variable it replaces:
  `electricityMapsApiKey`, `eiaApiKey`, `entsoeSecurityToken`,
  `wattTimeUsername`, `wattTimePassword`, `anthropicApiKey`, `openaiApiKey`,
  `geminiApiKey`, `googleApiKey`, `ollamaHost`, `ollamaModels`,
  `carbonBudgetG`, `carbonBudgetWindow`, `deliveryStorePath`,
  `disableStartupDispatch` (`defaultRegion` and `dbPath` already existed).

  **Migration is lossless.** The nine credential fields are declared in the
  manifest's `configContracts.secretInputs.paths`, which is what makes OpenClaw
  resolve its `"${ENV_VAR}"` / `"$ENV_VAR"` SecretRef shorthand for them and
  write the plaintext back into the config the plugin receives. Users who
  already export `ANTHROPIC_API_KEY` keep exporting it and write
  `"anthropicApiKey": "${ANTHROPIC_API_KEY}"` — the **gateway** performs the
  environment read, never the plugin. `uiHints` marks the same fields sensitive
  so the gateway UI masks them.

- **No user-visible change for the `ebb` CLI or the `@ebb-ai/mcp` server.** They
  are hosts: each reads the same variables it always did, at its own entry
  point, through a small local `readEnvCredentials()` helper
  (`packages/cli/src/env.ts`, `packages/mcp-server/src/env.ts`), and injects
  them into core. The web dashboard does the same for the grid feeds.

- **Python (`core-py`) is deliberately unchanged and stays environment-aware.**
  It is never bundled into a third-party plugin — it is used directly as its own
  host — so its `os.environ` fallbacks remain for ergonomics. The asymmetry is
  documented in `packages/core-py/README.md` and in `core-ts/src/index.ts`.

### Docs

- Every environment-variable table now states that the variables configure the
  **CLI and MCP server** (and the dashboard), and names the **plugin-config
  field** that replaces each one for the OpenClaw plugin: root `README.md`,
  `packages/cli/README.md`, `packages/mcp-server/README.md`,
  `packages/core-py/README.md`, `packages/openclaw-plugin/README.md` (with a
  full migration table), the web docs env table, `apps/web/.env.example`, and
  `apps/web/public/llms.txt`.

## [0.14.1] — 2026-07-25

**Theme:** "Narrow reads." A security-hygiene patch: no feature changes,
no wire changes.

> **Operator note:** the OpenClaw plugin does not auto-update. Run
> `openclaw plugins update @vitalini/ebb` to pull 0.14.1.

### Changed

- **Environment variables are read by name, never by binding all of
  `process.env`.** ClawHub's ClawScan flagged the carbon-budget loader's
  `opts.env ?? process.env` as `suspicious.env_credential_access`
  (Critical) in 0.14.0. The finding was structurally fair even though the
  values involved (a gram threshold and a window name) never leave the
  process: holding the whole environment in a scope that also makes
  network calls is indistinguishable, to a static auditor, from
  credential harvesting. Fixed at the source rather than explained away —
  `core-ts/budget.ts` and its `core-py/budget.py` mirror now read only
  the two `EBB_CARBON_BUDGET_*` keys; the OpenClaw plugin's dispatch
  layer declares a closed `ProviderEnv` shape populated by six named
  reads (replacing five `= process.env` parameter defaults); the startup
  bootstrap reads only `EBB_DISABLE_STARTUP_DISPATCH`. The published
  bundle now contains zero whole-environment captures — every access is a
  literal, individually justifiable variable.

  What this deliberately does *not* change: ebb still reads the provider
  and grid-feed credentials it is given (`ANTHROPIC_API_KEY`,
  `EBB_ELECTRICITY_MAPS_API_KEY`, `WATTTIME_PASSWORD`, …) and sends each
  to the API that issued it. That is the product's function, it is
  documented on every surface, and it is disclosed to the scanner rather
  than disguised.

## [0.14.0] — 2026-07-24

**Theme:** "The router and the fifth feed." Cross-provider LLM routing
with signed routing provenance, the WattTime marginal-emissions feed
(5th real feed) plus Gemini/Ollama adapters and full Python feed parity,
aggregate carbon-budget alerts, OS-notification and PDF delivery modes,
and an enforced nonce-based CSP for ebb-ai.com.

> **Operator note:** the OpenClaw plugin does not auto-update. Run
> `openclaw plugins update @vitalini/ebb` to pull 0.14.0.

### Added

- **PDF delivery format** (`file_format: "pdf"`, OpenClaw plugin, roadmap
  item 8). The `file` delivery mode can now render the existing HTML report
  template to a PDF at the same `file_path` semantics as the other formats,
  via **puppeteer's** headless Chrome. puppeteer is an *optional*,
  lazily-imported dependency — it is neither bundled nor a hard dependency
  (esbuild marks it external, mirroring `better-sqlite3`); the import uses a
  non-literal specifier so neither `tsc` nor esbuild pulls in Chrome. When a
  `pdf` delivery runs on a gateway without puppeteer installed, the delivery
  records a clear, actionable failure (`cd ~/.openclaw/extensions/ebb &&
  npm install puppeteer`, then restart) through the existing outcome
  machinery — it never throws, and the report stays in the queue. Added
  `pdf` to the shared `reportFormats` tool-surface enum; the divergence-
  canary snapshot is updated deliberately.

- **Nonce-based CSP for ebb-ai.com** (roadmap item 9). A Next.js
  middleware issues a fresh per-request nonce and an ENFORCED
  `Content-Security-Policy` — `script-src 'self' 'nonce-…'
  'strict-dynamic'` with **no** `unsafe-inline` for scripts (styles keep
  `unsafe-inline`: Next hydration / recharts / Tailwind inline styles,
  documented). JSON-LD carries the nonce; baseline headers unchanged.
  Cost accepted: six routes flip static→dynamic, upstream feed load
  still capped by the 300 s fetch-layer cache.
- **OS-notification delivery mode** (`deliver: ["os"]`, OpenClaw plugin,
  roadmap item 7). A native desktop notification on the gateway host when
  a deferred task completes. Dependency-free, per-platform spawn: macOS →
  `osascript`, Linux → `notify-send`, Windows → a PowerShell toast. An
  unsupported platform or a missing binary records an honest delivery
  failure through the existing outcome machinery (surfaced via
  `check_queue_status`) — it never throws into the scheduler. The
  notification body carries the task id, a truncated result preview
  (API-key/token-looking strings scrubbed), and a carbon-receipt grams
  one-liner. Added to the shared `deliverModes` tool-surface enum; the
  divergence-canary snapshot is updated deliberately.

- **Carbon-budget alerts** (TS + PY, roadmap item 4). An *aggregate*
  carbon budget over the receipt ledger, distinct from the per-task
  `carbon_budget_g` hard cap: a threshold on actual (falling back to
  estimated) receipt grams across a rolling `daily`/`weekly`/`monthly`
  window. Configured via `~/.ebb-ai/config` (KEY=VALUE, reusing the
  established secrets-file format — `EBB_CARBON_BUDGET_G` +
  `EBB_CARBON_BUDGET_WINDOW`; same-named env vars override). The check
  runs inside `Scheduler.tick` after each receipt write (sync due-sweep
  + batch poll); crossing a threshold emits an alert exactly once per
  (window, threshold), guarded by a persisted `carbon_budget_alerts`
  DB marker (composite PRIMARY KEY → idempotent across restarts, safe
  against a multi-process double-fire). Core exposes an injectable
  `onCarbonAlert` hook (`{windowKind, windowStart, thresholdG, actualG,
  taskIdThatCrossed}`) and `getCarbonBudgetStatus()`. Surfaces: `ebb
  tick` logs the alert prominently; `ebb stats` shows a used/threshold/
  percent budget block; the OpenClaw plugin routes the alert through the
  existing delivery machinery (chat by default); MCP `check_queue_status`
  adds a `carbon_budget` status block. Purely local — no telemetry, no
  network. Receipts/signing untouched (an alert is derived state, never
  a signed artifact).

- **Cross-provider LLM routing** (TS + PY, roadmap item 1). Opt-in and
  honest: `schedule_task` / `recommend_window` gain optional
  `candidates` (`"provider:model"` list — routing activates only with
  ≥2; ebb never invents model equivalences) and `route_weights`
  (default carbon 0.6 / cost 0.3 / latency 0.1). At the already-chosen
  dispatch window each candidate is scored on carbon (SSOT per-model
  energy × window intensity — hosted candidates share the documented
  caller's-grid assumption; Ollama is genuinely local), cost (new SSOT
  `data/prices.json`, dated + vendor-cited list prices; batch discount
  applied when eligible; an unpriced model is rejected loudly, never
  guessed) and a static latency class. The full scored list + weights
  land in a signed `routing` receipt block (cross-language signature
  vector added); dispatch falls back to the next-best candidate when an
  adapter is unavailable (recorded as `routing_fallback`), and a failed
  batch submit falls back to the same candidate's sync path first.
  `recommend_window` and `dry_run` compute a genuine routing PREVIEW at
  the previewed intensity (explicitly disclosed as non-binding) — no
  accepted-but-inert parameters. Deterministic given a seeded rng; MCP
  and OpenClaw render the routing block; CLI intentionally has no
  schedule command, so no flag there.

- **WattTime marginal-emissions feed** (TS + PY, roadmap item 2) — the
  5th real feed. Opt-in via `WATTTIME_USERNAME`/`WATTTIME_PASSWORD`;
  for the 6 covered US ISO zones a real marginal (co2_moer) *forecast*
  takes precedence over EIA hour-of-day persistence; token cached
  in-process with one 401 re-login, all failures fall through the
  existing chain (EIA → mock). lbs/MWh → gCO2/kWh conversion pinned by
  shared TS/PY fixtures. New optional `signalType: "average"|"marginal"`
  on forecasts, recommendations and receipts — reasoning strings and
  receipt renders disclose "MARGINAL-emissions signal" honestly; absent
  field means average, existing feeds unchanged. Zone→WattTime region
  mapping: CAISO_NORTH verified against public docs; the other five
  sub-BA codes are marked unverified in code (a wrong code 404s and
  degrades safely to EIA).

- **Gemini and Ollama provider adapters** (TS + PY, roadmap item 3 —
  prerequisite for cross-provider routing, which is NOT yet built).
  `GeminiAdapter`: Generative Language API `generateContent`, key via
  `GEMINI_API_KEY` (falls back to `GOOGLE_API_KEY`), real
  `usageMetadata` token counts; **sync-only** — Gemini's batch modes
  (GCS-backed Vertex batch / operation-keyed Developer-API batch) do not
  map onto the shared submit→poll batch contract, so batch capability is
  honestly omitted rather than faked. `OllamaAdapter`: local
  `/api/chat` via `OLLAMA_HOST` (default `localhost:11434`), keyless,
  `prompt_eval_count`/`eval_count` tokens, no batch (local). The
  `provider` enum grows to `anthropic|openai|gemini|ollama` everywhere
  (tool-surface → MCP zod + OpenClaw typebox derive automatically;
  additive only); `dispatchBatch` is now optional on the adapter
  interface; MCP/CLI `buildAdapters` and OpenClaw provider inference
  (`gemini-*` prefix; `OLLAMA_MODELS` list) wire the new providers in.
- **Python grid-feed parity** (roadmap item 5). `core-py` gains 1:1
  ports of the UK Carbon Intensity (96h pagination, top-of-hour
  alignment), EIA (phase-correct hour-of-day persistence,
  `kind=persistence`) and ENTSO-E (multi-period XML parser with
  position/consumption handling) feeds plus `build_default_grid_feed`
  with the same env vars and mock fallback chain as TS. Feed fixtures
  are shared with the TS suite — both languages parse identical payloads
  into identical forecasts. No new dependencies (existing httpx).
  With this and the already-shipped `select_window` tie-break, the
  Python core has **full behavioral parity** with TypeScript.

## [0.13.0] — 2026-07-16

**Theme:** "One source of truth." The structural consolidation cycle the
0.12.0 audit resolution honestly deferred (§2.2–§2.4) plus the §1.8
energy-table remainder.

> **Operator note:** the OpenClaw plugin does not auto-update. Run
> `openclaw plugins update @vitalini/ebb` to pull 0.13.0.

### Added

- **Shared tool surface** (`@ebb-ai/core` `tool-surface.ts`, audit §2.2).
  The canonical list of all 10 tool definitions — names, descriptions,
  parameter descriptors, host applicability — now lives in core in a
  schema-library-neutral form; the MCP server renders it into strict zod
  validators (→ JSON Schema) and the OpenClaw plugin renders it into its
  historical looser TypeBox shapes. The four silent divergences the audit
  found (per-host `region` requiredness, MCP-only `recommend_window.model`,
  MCP-only `hours` bounds, drifted description texts) are now explicit
  per-host declarations guarded by a snapshot canary; descriptions
  converged to one canonical text. Wire contracts unchanged on both hosts.
- **SSOT data tables** (audit §2.4). Energy coefficients, synthetic-curve
  region floors/offsets, and band thresholds moved to hand-edited JSON in
  `packages/core-ts/src/data/`; `scripts/gen-data.mjs` generates the TS
  module and the Python `_data.py` (byte-identical numbers), and a new CI
  `data-ssot` job + `pnpm gen:data:check` (also in `preflight`) fail on
  drift. Unifying the curve fixed two latent TS↔PY divergences: Python
  never applied per-region UTC offsets and could go negative below a low
  floor. Last version hardcode (`ebb_ai.__version__`) now reads package
  metadata.
- **Model-id normalization + family fallback** (§1.8 remainder, TS + PY
  parity). `normalizeModelName` now strips path provider prefixes
  (`anthropic/…`), Bedrock `us.anthropic.….:0` forms, and canonicalizes
  Claude word order (`claude-3-5-sonnet` → `claude-sonnet-3-5`). New
  `resolveModelEnergy` returns coefficients plus a provenance tier; an
  unknown-but-recognizable id now uses its family representative's
  coefficients instead of the flat legacy constant. Receipts gain
  **`energyResolution`** (`exact` | `normalized` | `family-fallback` |
  `default`) alongside the existing `energySource` confidence tier;
  surfaced on CLI / MCP / OpenClaw receipt views. Cross-language parity
  locked by a 27-id shared fixture both suites read.

### Changed

- **apps/web consumes `@ebb-ai/core`** (audit §2.3). New browser-safe
  subpath exports `@ebb-ai/core/{grid,energy,types}` (no Node built-ins
  in their import graphs); the web app's ~680 duplicated-and-drifted
  lines of grid/energy/types logic are deleted in favor of a workspace
  dependency. The site thereby converges on core's audit-fixed behavior:
  phase-correct EIA persistence, the 5-zone ENTSO-E parser (ES/IT/NL gain
  real data), UK 96h pagination, per-region-offset mock curve.
  Web-only display metadata (`regions.ts`) and geo logic stay local.

- **Per-region synthetic-curve floors/offsets for all 31 zones.** The
  mock feed's `regionFloors`/`regionUtcOffsets` SSOT grew from 9 zones to
  all 31 (stylized annual-average intensities — NO-NO1 ≈ 30 up to
  IN-WE/ZA ≈ 700), so the /map fallback view no longer renders ~20
  identical default curves.

Tests: 605 → 684+ (413+ TS + 271 PY).

## [0.12.0] — 2026-07-08

**Theme:** "Trust repairs." Implements the 2026-07-07 fresh-eyes audit —
the headline features that were dead code now actually run, and every
number a receipt asserts is now covered by the signature.

> **Operator note:** the OpenClaw plugin does not auto-update. Run
> `openclaw plugins update @vitalini/ebb` to pull 0.12.0.

### Added

- **Real Batch API routing.** The "50% cheaper auto-Batch" headline was
  dead code: the gate compared `scheduledFor` to `now` at dispatch time,
  unsatisfiable from every public path (`tick` only dispatches due tasks;
  expedite/retry force `now`). Batch is now the *deferral* mechanism,
  decided against the persisted deadline. `tick()` gains a **submit
  sweep** (scheduled rows with `preferBatch`, a batch-capable adapter and
  `deadline − now > 24h` are claimed and submitted immediately — the
  provider owns the execution hour inside its 24h SLA) and a **poll
  sweep** (`claimSubmitted` → `retrieveBatch`; completed builds the full
  receipt from real usage tokens with provenance/signing/redaction/output
  file; failed/expired → `failed`, `retryTask` re-dispatches sync and
  clears `batchId`). New adapter surface `retrieveBatch` for Anthropic
  (`messages.batches` results iteration) and OpenAI (output-file JSONL).
  New `submitted` status + `batch_id` column (cross-language schema
  parity); expedite/retry on `submitted` reject clearly; `cancel` warns
  the provider-side batch may still bill. `TickResult` reports
  `batchSubmitted` / `batchPolled`. Tested through public paths only in
  both languages, including two racing ticks completing a submitted row
  exactly once and TS↔PY row handoff. (§0.1)
- **Receipt provenance, covered by the signature.** Receipts now record
  `intensityGCo2PerKwh` + `gridSource` (mock = **synthetic**, disclosed)
  + `energySource` confidence tier. `recommend_window` discloses
  SYNTHETIC grid data in its reasoning; `ebb stats` classifies the stored
  intensity instead of back-deriving it from grams (which skewed
  per-model receipts up to 6.9×). Every provenance field is inside the
  signed payload. (§0.4)

### Changed

- **One cross-language canonical signing form.** The Ed25519 signature
  previously bound dialect-specific key names (snake_case in Python,
  camelCase in TS), making cross-port verification mathematically
  impossible (legacy-unsigned or false "tampered"). Canonical form is now
  the camelCase wire rendering in both languages (algorithmic
  snake→camel, no field list), with RFC 8785 / JCS-style number
  serialization — Python's `es_number()` fuzz-verified byte-identical to
  Node `JSON.stringify` across 9k values. **`signedAt` is now inside the
  signed payload** (it was documented as replay defence while being
  freely forgeable; the replay note now correctly requires ledger-side
  uniqueness). Verify accepts either key rendering and falls back through
  the legacy v0.11 canonical forms, so existing receipts keep verifying
  (the reason notes the legacy form). Key files are written temp+rename,
  making the "atomic" comment true. Shared cross-language test-vector
  fixture (4 vectors incl. a numbers torture case) exercised byte-exact
  by both suites. (§0.3)
- **A paid provider call can never become `failed`.** The `try` is
  narrowed to the billed call only; receipt-side fetch/sign/upsert
  failures are fail-soft (no zombie `running` row, no hung awaiter, no
  crashed tick). (T0/T1)
- **Multi-process correctness pack.** `busy_timeout = 5000`; per-candidate
  claim guard in `tick`; expedite/retry go through `claimScheduled` (no
  double dispatch versus a racing cron); duplicate `taskId` checked
  against the store (an id reuse can no longer silently destroy a signed
  ledger row; Python gains `exists_sync`); cancel-while-running keeps the
  cancelled row (cancel-overwrite guard). (T0/T1)
- **Ledger hardening.** DB `0600` / dir `0700`; `body_json` redacted at
  `completed`/`cancelled` (failed keeps the original for retry);
  vendor-shaped redaction patterns (AKIA / ghp / AIza / xox / JWT)
  replace the prose-mangling generic rule. (T0/T1)
- **Honest grid feeds.** EIA / ENTSO-E persistence tiling is now anchored
  by each observation's own UTC hour-of-day, so publication lag no longer
  phase-rotates the served diurnal curve (a 4h lag previously shifted
  every window hours off the real trough); histories under 24h refuse to
  synthesise instead of tiling a short tail. Forecasts carry
  `kind: forecast | persistence` so downstream surfaces can disclose
  naive forecasts. ENTSO-E parser: consumption `TimeSeries`
  (`outBiddingZone`, pumped storage) excluded from the generation mix,
  `Point` positions honored (A03 gaps leave holes instead of shifting
  later hours), per-`Period` parsing, `Acknowledgement` error documents
  throw to the mock fallback. UK feed pages a second `/fw48h` request for
  72h horizons and aligns buckets to top-of-hour. (§0.4)
- **Current hour is a scheduling candidate.** "Run now" is recommendable,
  and the committing paths honor it. (T0/T1)
- **Planning and committing finally agree.** `recommendWindow`'s
  randomized cleanest-tolerance-band tie-break (built to stop fleet-wide
  collapse onto a single trough hour) existed only on the non-committing
  recommend path; every task actually scheduled via
  `enqueueProviderCall` / `defer` still hit the strict-minimum hour. One
  shared **`selectWindow`** (in-deadline incl. current hour, band
  `max(15%, 30g)`, injectable rng) now drives `recommendWindow` **and**
  all committing scheduler paths in both languages — Python's recommend
  gains the band+rng logic it never had. `pickBestWindow` kept as a
  deprecated strict-min delegate. Even-distribution now verified through
  the committed path: N=400 `enqueueProviderCall`, max-bucket
  concentration **11.0%** (recommend-path 10.6%). `previewProviderCall`
  reports its `cleanBandSize`. (§2.1)
- **CLI daemons that actually dispatch.** `ebb install` resolved the
  daemon binary to a hardcoded `/usr/local/bin/ebb` and relied on
  env-node with launchd's bare PATH — dead on Apple Silicon and nvm.
  Units are now built from `[process.execPath, realpathSync(argv[1]),
  tick …]` with existence checks. Secrets: `~/.config/ebb/env` (0600,
  commented template created at install) is loaded by `tick` at startup
  for any unset keys — one mechanism across launchd / systemd / cron —
  and `tick` warns loudly when pending provider tasks exist without the
  needed key. Laptop wake-chain fixed (register-wake no longer fed the
  table separator; `--db` propagates; `sudo -n` attempt prints the exact
  sudoers one-liner). Dropped the six-versions-stale "planned for v0.5"
  Windows fiction; README rewritten from its frozen v0.4 state (Linux
  systemd is supported). `receipts`/`verify` render provenance
  (intensity, grid source with a MOCK DATA banner, energy tier).
  `engines >= 20`. (§0.6/P16)
- **OpenClaw dispatch from gateway boot + provider inference.** The
  background dispatch loop only started on the first tool call, so after
  a gateway restart persisted tasks missed their clean-grid window until
  a user happened to invoke any ebb tool. The dispatcher now bootstraps
  at module load (guarded, unref'd; the SDK exposes no init hook —
  documented), and `runDispatchTick` skips-not-fails tasks whose provider
  has no adapter yet (keys may be absent at boot), restoring them to
  `scheduled`. `schedule_task` no longer hardcodes `anthropic`: optional
  `provider` param, inference from the model prefix (`gpt-*`/`oN` →
  openai, `claude-*` → anthropic), hard reject on the api-key path when
  the chosen provider has no key. Response parity with the MCP server
  (SYNTHETIC warning + receipt provenance); queue rendering handles
  `submitted` (+ batch id); expedite/retry relay core rejections
  verbatim. `engines >= 22.5` declared (node:sqlite). (§0.7/§1.10)
- **MCP restart visibility, schemas from zod, honest fallback.**
  `check_queue_status` and `cancel_all` now read `listPersistedTasks()` —
  after an MCP-host restart they saw an empty in-memory map while
  `queue.db` held scheduled tasks that `ebb tick` would still dispatch.
  Advertised `inputSchema`s are derived from the zod validators
  (`zod-to-json-schema`): `schedule_task`'s five undiscoverable params
  (`dry_run`, `dispatch`, `provider`, `output_path`, `redact_in_receipt`)
  are advertised again, with a parity test over live `tools/list`. The
  "falling back to in-memory" message now actually falls back instead of
  crashing on a dead DB path. Responses carry the carbon data already on
  the record (estimated carbon, window, grid source, delta, energy tier)
  plus a loud SYNTHETIC warning on mock data — the plugin template
  previously forced the model to fabricate these numbers. `SERVER_VERSION`
  read from `package.json`; `server.ts` exports `createEbbServer(deps)`.
  (§0.10/§1.9/§1.11)
- **Site fixes.** `/plan` resolves the visitor's `datetime-local`
  deadline in the *browser* (hidden UTC ISO field) — previously parsed in
  server TZ (UTC on Vercel), skewing every result by the visitor's
  offset. Copy-paste blocks emit things that exist (`/ebb-ai:defer` +
  `schedule_task` MCP JSON; the advertised `npx @ebb-ai/cli schedule`
  never existed). `/forecast`, `/plan` and the API route use the 5-min
  cached `getGridForecast` (stops burning the Electricity Maps 100 req/day
  quota per view). `/map` sparklines are server-rendered inline SVG —
  recharts stays only on interactive routes (first-load JS 209kB →
  106kB). Ed25519 moved to "shipped" in About; `llms.txt` 7 → 31 regions.
  (§0.9/P18-20)
- **Python parity + PY-specific fixes.** Mirrors the TS correctness pack
  (provenance, paid-call-never-failed, multi-process pack, redaction,
  0600/0700, current-hour candidacy, `deadline` column). PY-specific:
  `TaskCancelledError` replaces the `asyncio.CancelledError` abuse
  (catchable, no TaskGroup unwinding); retry-with-backoff ported (429/5xx/
  pre-connect only); `shutdown()` settles pending `defer()` awaiters with
  `SchedulerShutdownError`; hourly re-entry keeps the committed window on
  transient forecast failures instead of dispatching into a possibly-dirty
  hour; `enqueue` validates the running loop before mutating state;
  `output_path` + `writeOutputFile` ported (TS-enqueued rows now deliver
  files under a Python tick); o-series/gpt-5 `max_completion_tokens`, SDK
  `max_retries=0`. Stale "TS port is still in-memory" fiction removed.

### Changed — version bumps (lockstep)

- `@ebb-ai/core` 0.11.0 → 0.12.0
- `@ebb-ai/cli` 0.11.0 → 0.12.0
- `@ebb-ai/mcp` 0.11.0 → 0.12.0 (`SERVER_VERSION` synced)
- Claude Code plugin manifest + marketplace 0.11.0 → 0.12.0
- `ebb_ai` PyPI 0.11.0 → 0.12.0
- OpenClaw plugin (`@vitalini/ebb`) 0.11.0 → 0.12.0

### Tests

- **605 tests** (368 TS + 237 Python). TS: 251 core + 61 cli + 21 mcp +
  35 openclaw. Up from 333 at v0.11.0.

## [0.11.0] — 2026-05-30

**Theme:** "Auditable receipts." Ed25519 signing + WAL multi-writer SQLite.

### Added

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
- OpenClaw plugin (`@vitalini/ebb`) 0.1.13 → 0.11.0 — joined the
  monorepo lockstep so the queue-sharing surface is single-versioned
  end to end.

### Tests

- TypeScript: 17 new sign tests + 2 new WAL storage tests + 7 new CLI
  verify tests. Total monorepo: 187 → 213 TS tests.
- Python: 15 new sign tests guarded by extras availability. Total:
  97 → 112.

## [0.10.0] — 2026-05-24

**Theme:** "Per-model energy." Replaces the v0.1–v0.9 flat
`0.0015 kWh/task` placeholder with a cited per-model Wh/token table
across 37 LLMs (Patterson 2021, Luccioni 2024, HF AI Energy Score).

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
  semver track at this point (joined lockstep in 0.11.0).

## [0.9.0] — 2026-05-24

**Theme:** "Actual + estimated + delta carbon receipts." OpenClaw
plugin reaches MCP parity (expedite/retry, runtime delivery, region
auto-detect); home-page how-it-works visualizer rebuilt as an
animated task-flow story.

### Added

- **Actual-vs-estimated carbon receipt.** `CarbonReceipt` now
  carries both an `estimatedCarbonGCo2` (projected at schedule
  time) and `actualCarbonGCo2` (re-estimated at dispatch with the
  provider's reported `usage.inputTokens` / `usage.outputTokens`),
  plus a signed `deltaPct` drift. The audit trail is honest about
  what was planned vs. what shipped.
- **OpenClaw plugin parity.** `expedite_task` + `retry_task` added,
  bringing the OpenClaw plugin to full feature parity with the
  TS/Python MCP scheduler.
- **OpenClaw delivery channels.** `set_delivery` now persists a
  per-task delivery target (chat / telegram / webhook / file) to
  the SQLite delivery store and clears the exfiltration flag on
  dispatch.
- **Region auto-detection in OpenClaw plugin.** When the host
  doesn't supply a region, the plugin infers one from the host
  machine's timezone (London→GB, Paris→FR, Berlin→DE, US
  Pacific→US-CAL-CISO, US Eastern→US-MIDA-PJM).

### Fixed

- `recommend_window` no longer claims "cleanest" in its reasoning
  string when it actually picked a band-tied alternative.
- OpenClaw runtime bridge no longer passes a model override —
  scheduled tasks now execute in the user's currently-selected
  OpenClaw model just like an interactive call.
- Scheduler now correctly dispatches tasks whose
  `scheduled_for` already elapsed when the daemon woke up
  (previously these stayed `scheduled` indefinitely).
- `cancel_task` is store-aware: cancelling a persisted task
  updates the SQLite row instead of only the in-memory map.

### Changed — site

- **`HowItWorksViz` rewritten** as an animated task-flow story
  (CSS Motion Path particle streams; dwell on
  receive + execute; breathing loop).
- **Roadmap narrative rewritten** alongside the v0.9.0 bump.

### npm

- `@ebb-ai/core` 0.8.2 → 0.9.0
- `@ebb-ai/cli` 0.8.3 → 0.9.0
- `@ebb-ai/mcp` 0.8.2 → 0.9.0
- OpenClaw plugin shipped intermediate point releases (0.1.2 ...
  0.1.13) tracking the parity work above.
- Claude Code plugin manifest 0.8.2 → 0.9.0.

### Fixed — release tooling

- Use `pnpm publish` instead of `npm publish` so `workspace:*`
  protocol resolutions are rewritten to concrete versions in the
  published tarballs.

## [Inter-release site & infrastructure] — 2026-05-14 → 2026-05-24

**Theme:** Heterogeneous bucket of work that shipped between v0.6 and
v0.9 without its own package bump — discoverability (llms.txt,
SEO/JSON-LD), `apps/dashboard/` → `apps/web/` rename, `/stats` and
`/queue` honesty rewrite, `/map` route, `/about`, the OpenClaw plugin's
initial creation (`@vitalini/ebb-ai@0.1.0` on ClawHub). Tracked here
so the changelog isn't silent about it.

### Changed — site

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

[Unreleased]: https://github.com/Vitalini/ebb-ai/compare/v0.14.1...HEAD
[0.14.1]: https://github.com/Vitalini/ebb-ai/compare/v0.14.0...v0.14.1
[0.14.0]: https://github.com/Vitalini/ebb-ai/compare/v0.13.0...v0.14.0
[0.13.0]: https://github.com/Vitalini/ebb-ai/compare/v0.12.0...v0.13.0
[0.12.0]: https://github.com/Vitalini/ebb-ai/compare/v0.11.0...v0.12.0
[0.11.0]: https://github.com/Vitalini/ebb-ai/compare/v0.10.0...v0.11.0
[0.10.0]: https://github.com/Vitalini/ebb-ai/compare/v0.9.0...v0.10.0
[0.9.0]: https://github.com/Vitalini/ebb-ai/compare/v0.8.3...v0.9.0
[0.8.3]: https://github.com/Vitalini/ebb-ai/compare/v0.8.2...v0.8.3
[0.8.2]: https://github.com/Vitalini/ebb-ai/compare/v0.8.1...v0.8.2
[0.8.1]: https://github.com/Vitalini/ebb-ai/compare/v0.8.0...v0.8.1
[0.8.0]: https://github.com/Vitalini/ebb-ai/compare/v0.7.1...v0.8.0
[0.5.0]: https://github.com/Vitalini/ebb-ai/compare/v0.4.0...v0.5.0
[0.4.0]: https://github.com/Vitalini/ebb-ai/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/Vitalini/ebb-ai/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/Vitalini/ebb-ai/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/Vitalini/ebb-ai/releases/tag/v0.1.0
