# Article notes: ebb-ai for InfoQ

Working notes for "Carbon-aware scheduling for AI workloads: what we learned
building ebb-ai." Facts only, no marketing language. Every statement cites a
commit hash, a `CHANGELOG.md` version heading, a file path, a `docs/claims.md`
row, or the `docs/examples/2026-09-30-GB-tick/` run. Adoption numbers carry
the date they were fetched. Anything not answerable from the sources listed
below is written as "unknown" and repeated in "Needs Vitalii."

## Origin story (5 bullets)

- The project starts as a single initial commit, "ebb-ai v0.1 — carbon-aware
  scheduling for agentic AI": an MCP server that defers non-urgent LLM tool
  calls to the cleanest electricity-grid window inside a caller-supplied
  deadline `[a2746d8, 2026-05-12]`.
- Before any public release, the same day, the project runs its own
  engineering review and fixes everything the review marked critical or
  important: "v0.1 fixes from engineering review (all 5 critical, 7
  important)" `[41b8dfd, 2026-05-12]`. The review itself records the
  starting state — a working `defer()` API and a spec-correct MCP server,
  but a headline feature (carbon budget) that was "captured but never
  enforced" `[docs/archive/engineering-review-v0.1.md]`.
- The first npm publish follows two days later, at v0.6.0, alongside the
  first Claude Code plugin `[1cc6484, 2026-05-14]`.
- A "fresh-eyes audit" dated 2026-07-07 finds that the project's own
  headline claim — "50% cheaper via Batch APIs" — was dead code: the
  dispatch gate compared `scheduledFor` to `now`, a condition unsatisfiable
  from any public call path. The fix ships as v0.12.0, "Trust repairs"
  `[CHANGELOG.md 0.12.0 — 2026-07-08; 461d2e5 (the Batch routing fix),
  941bda7 (the v0.12.0 release)]`.
- The most recent activity on the project (this branch) is a version-drift
  and claims cleanup done ahead of external press: npm had not published
  past 0.13.0 (2026-07-16) while the repository and site had moved on to
  claiming v0.15.1 `[CHANGELOG.md 0.13.0 — 2026-07-16; 5b195f8,
  2026-09-30]`.

## The three hardest technical decisions

### 1. Ed25519-signed receipts, replacing unsigned ones

**What shipped:** every dispatched task's `CarbonReceipt` is signed with a
per-installation Ed25519 keypair generated lazily on first use, with no
opt-in flow, so every receipt is signable by default
`[packages/core-ts/src/sign.ts; CHANGELOG.md 0.11.0 — 2026-05-30; f10f4f7;
5e1807a]`. The stated purpose is offline, asynchronous verification of two
properties — cryptographic origin and field-level tamper-evidence — without
the verifier trusting the vendor: "Direct B2B ESG export path now possible —
receipts are auditable artefacts, not just claims" `[CHANGELOG.md 0.11.0]`.
The private key never leaves the machine: "The keys are NEVER sent anywhere
by ebb-ai itself" `[packages/core-ts/src/sign.ts]`.

**Alternative rejected:** unsigned receipts, which is what every release
through v0.10 shipped, and which the code still falls back to today. A
receipt with no signature verifies as `legacy-unsigned` rather than being
rejected `[CHANGELOG.md 0.11.0]`, and the Python port keeps signing as an
optional extra (`pip install "ebb-ai[signing]"`): "Without the extra,
receipts go out unsigned and the scheduler degrades silently (v0.10 shape)"
`[CHANGELOG.md 0.11.0]`. The cost of signing by default was cross-language
correctness: a first cut bound dialect-specific field names (snake_case in
Python, camelCase in TypeScript), which made cross-port verification
"mathematically impossible" until v0.12.0 fixed the canonical form
`[CHANGELOG.md 0.12.0 — 2026-07-08]`.

### 2. A cited per-model energy coefficient table with a flat-constant fallback, replacing one flat constant for every model

**What shipped:** v0.10.0 replaces a single flat placeholder,
`ENERGY_KWH_PER_TASK = 0.0015`, used for every model since v0.1, with a
per-model Wh/token coefficient table cited to three public sources
(Patterson et al. 2021; Luccioni, Jernite, Strubell 2024; the Hugging Face
AI Energy Score) `[CHANGELOG.md 0.10.0 — 2026-05-24; 4144964]`. v0.13.0
extends this with model-id normalization and a "family fallback": an
unrecognized-but-parseable model id (e.g. a new dated snapshot) resolves to
its family's coefficients instead of the flat constant, and every receipt
records which tier produced its number via `energyResolution`
(`exact | normalized | family-fallback | default`)
`[CHANGELOG.md 0.13.0 — 2026-07-16; f64a01f; aa3dbc9]`.

**Alternative rejected:** the flat per-task constant that preceded it,
`LEGACY_KWH_PER_TASK = 0.0015`, kept in the code today only as the
backwards-compatible fallback for callers with no model information
`[packages/core-ts/src/energy.ts]`. A second alternative — live, per-call
energy measurement for closed models — was not pursued and is disclosed as
a limitation rather than solved: for the Anthropic/OpenAI/Google model
families, "the per-token coefficients are **estimated** — inferred from
public parameter-count disclosures... and scaled along the Luccioni curve.
They may be off by ±50%" `[packages/core-ts/src/energy.ts]`.

### 3. Refusing an aggregate on `/stats`, instead of building the opt-in leaderboard already designed for it

**What shipped:** `/stats` renders no cross-user aggregate. Its own header
comment states why, and the page repeats the reasoning in a visible section,
"Why not show aggregate numbers here?": "Every public dashboard that
summarizes user impact has to either (a) phone home with telemetry — which
we explicitly decided against through v0.10 — or (b) fabricate aggregate
numbers that look real but aren't. Both are bad. Local-first is honest."
`[apps/web/src/app/stats/page.tsx:153-168]`. Every task's data stays in a
local SQLite ledger at `~/.ebb-ai/queue.db`
`[packages/core-ts/src/storage/sqlite.ts]`.

**Alternative rejected:** an opt-in, signed, anonymized leaderboard,
already designed in full — transport shape, a separate telemetry keypair,
a per-user rank endpoint, and a Sybil-mitigation analysis the design doc
itself calls "not perfect" — but never built: "design doc + reference
implementation sketch," gated on "real adoption + privacy review"
`[docs/spec/proposal/v09-leaderboard.md]`. This InfoQ prep produced a
revised proposal for the same ask (aggregate counts, not a per-user rank)
that is also explicitly not built: "Status: proposal only. Nothing in this
document is built." `[docs/impact-proposal.md]`.

## What we measured, and what we could not

**Measured** (a run, a test, or direct code inspection, all re-verified
2026-09-30 — see `docs/claims.md` for the full table and commands):

- One real scheduling run on live grid data: region GB, live UK National
  Grid ESO Carbon Intensity feed (keyless), 158 gCO2/kWh at dispatch,
  recorded in the signed receipt `[docs/examples/2026-09-30-GB-tick/;
  docs/claims.md #31]`.
- 31 grid regions, 5 real-data grid feeds, a 72-hour forecast horizon, 9 MCP
  tools, 8 slash commands, 13 supported hosts — each backed by a count in
  code, not prose `[docs/claims.md #6, #10, #11, #16, #17, #18]`.
- 1,115 tests passing (650 TypeScript across 4 packages + 465 Python),
  rerun via `pnpm preflight` on 2026-09-30 `[docs/claims.md #13]`.

**Could not measure** (simulated, projected, or dropped for lack of a
source — see `docs/claims.md` for the full audit):

- The same GB run's forecast: peak 183 gCO2/kWh vs. the recommended
  window at 88 gCO2/kWh — about 52% lower for this one run, not a general
  figure. Projected: both are forecast values `[docs/claims.md #31]`.
- A 10,000-synthetic-task even-distribution simulation across 7 monitored
  grid zones, rerun 2026-09-30: 10.6% max-bucket dispatch concentration
  against a 20% test assertion ceiling. Simulated, not a live measurement
  `[docs/claims.md #9; packages/core-ts/test/even-distribution.test.ts]`.
- The lower-carbon percentage range the copy used to quote: unsourced, no
  test, run or external source produces it; dropped from copy entirely
  `[docs/claims.md #1]`.
- "−80% vs dispatching at peak": unsourced, dropped from copy entirely
  `[docs/claims.md #2]`.
- "50% cheaper via Batch APIs": projected — a vendor-published list price,
  not a value computed in this repo `[docs/claims.md #4]`.
- "−84% grid-load shift": simulated, derived from the even-distribution
  paper result, not a live measurement `[docs/claims.md #5;
  docs/papers/carbon-aware-mcp-scheduling.md]`.
- Aggregate "gCO2 avoided" across users: cannot be computed today at any
  granularity. No field in the receipt schema records a counterfactual;
  computing "avoided" needs a new persisted value (the grid intensity a
  run-now dispatch would have used) that does not exist yet
  `[docs/impact-proposal.md §5, "How gCO2 avoided would be estimated"]`.
- Adoption — users, installs, real-world carbon impact: unknown; see
  "Needs Vitalii."

## What did not work (adoption)

- Every planned public-launch channel is still unexecuted. The launch
  sequence lists Show HN, a LinkedIn post, r/MachineLearning, r/sustainability
  and a dev.to article as "not started" or "Hold," each conditioned on a
  milestone (a real metric, the v0.9 leaderboard, the first directory
  inclusion) that the log gives no later evidence of being reached
  `[docs/internal/marketing-channels.md]`.
- The submission-tracking log has no entries after 2026-05-19, one week
  into the project, despite the repository's git history continuing through
  2026-09-29 — 4+ months of further releases were not logged as submitted
  anywhere `[docs/internal/hub-submission-log.md; git log shows commits
  through c48a7d0, 2026-09-29]`.
- Three awesome-list PRs were opened the same week (punkpeye/awesome-mcp-servers
  #6348, Green-Software-Foundation/awesome-green-software #215,
  ComposioHQ/awesome-claude-skills #877); the log's last recorded status for
  each is "OPEN" / "awaiting review" — it contains no later entry recording
  a merge `[docs/internal/hub-submission-log.md]`.
- Publishing the OpenClaw plugin took three attempts: `@vitalini/ebb-ai`
  and `@vitalini/ebb-ai-mcp` were both published and then withdrawn
  (wrong runtime id, then a rejected slug) before `@vitalini/ebb` stuck
  `[docs/internal/hub-submission-log.md; 9860387, c52ce50, b8b64ee]`.
- Live adoption numbers, fetched 2026-09-30:
  - npm, last 30 days: `@ebb-ai/core` 69 downloads, `@ebb-ai/cli` 77
    downloads, `@ebb-ai/mcp` 78 downloads (window 2026-08-30 to
    2026-09-28). Fetched 2026-09-30 with
    `curl -s https://api.npmjs.org/downloads/point/last-month/@ebb-ai/<core|cli|mcp>`;
    refetched the same day with the same result.
  - PyPI `ebb-ai`, last month: 62 downloads (4 in the last week, 0 the day
    of the fetch). Fetched 2026-09-30 with
    `curl -s https://pypistats.org/api/packages/ebb-ai/recent`; a same-day
    refetch was rate-limited (HTTP 429), so this number is from the first
    fetch only.
  - GitHub: 1 star, 0 forks, 0 open issues, repository created
    2026-05-12. Fetched 2026-09-30 with
    `gh api repos/Vitalini/ebb-ai --jq '{stargazers_count,forks_count,open_issues_count,created_at}'`;
    refetched the same day with the same result.

## What we would do differently

- The project's own headline cost claim was unreachable dead code for
  roughly two months before a dedicated audit caught it — not the initial
  same-day v0.1 review, and not the test suite. The fix notes the gate
  "was unsatisfiable from every public path" `[CHANGELOG.md 0.12.0 —
  2026-07-08]`. An external-review pass earlier, or a test asserting the
  Batch path is actually reachable in production call sequences, would
  have caught this sooner than an audit four releases later.
- A privacy claim shipped in v0.15.1's own documentation was wrong: it
  said `chat` delivery "stays inside OpenClaw," which is false on a
  Telegram-backed gateway, since `chat` and `telegram` delivery share the
  same Telegram Bot-API path. This was caught by ClawHub's external review
  (`E1`), not before publishing `[CHANGELOG.md 0.16.0 — 2026-09-30,
  "Fixed"; 9be8496]`.
- The version string that this article prep exists to fix — README and the
  site quoting v0.15.1 while npm had shipped no further than 0.13.0 — was
  hand-typed in three separate places with nothing checking agreement
  until this pass added a drift check. Generating it from one source from
  the first release, instead of the sixteenth, would have prevented four
  releases' worth of silent drift `[CHANGELOG.md 0.13.0 — 2026-07-16;
  5b195f8]`.
- Distribution tracking stopped the same week it started: every entry in
  the submission log is dated 2026-05-19, and no later release added a
  new row, even though releases kept shipping for four more months
  `[docs/internal/hub-submission-log.md]`. Treating the log as part of
  each release's checklist, rather than a one-time launch artifact, would
  have kept it a source of truth instead of a snapshot.

## Needs Vitalii

- Whether the three awesome-list PRs (#6348, #215, #877) were ever merged,
  and the outcome of the glama.ai and Bing Webmaster submissions —
  `docs/internal/hub-submission-log.md` was not updated after 2026-05-19.
- Any GitHub traffic/referrer data (Insights → Traffic), since the GitHub
  API does not expose it and it is not recorded anywhere in this repo.
- User count, install count, or any real-world carbon-avoided total — no
  telemetry exists by design (`apps/web/src/app/stats/page.tsx:153-168`),
  so this number does not exist anywhere to report.
- Why the submission log and marketing-channel plan were not revisited
  after the first week, despite four more months of shipped releases —
  not stated in any source in this repo.
- Whether the k-anonymity threshold proposed for a future aggregate
  (`docs/impact-proposal.md`, "a starting point such as K=20") should be
  set to something specific before that proposal is built.
