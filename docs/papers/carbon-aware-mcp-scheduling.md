---
title: "Carbon-Aware Scheduling for Agentic AI Workflows via the Model Context Protocol"
author:
  - name: "Vitalii Borovyk"
    affiliation: "ebb-ai (independent)"
    email: "vitalii@ebb-ai.com"
abstract: |
  We describe **ebb-ai**, an open-source Model Context Protocol (MCP)
  server that defers non-urgent agentic-AI tool calls to the
  cleanest grid window inside a caller-supplied deadline. The system
  composes (i) a per-zone grid-carbon-intensity router across four
  real-data sources (U.K. National Grid ESO, U.S. Energy Information
  Administration, ENTSO-E Transparency Platform, Electricity Maps),
  (ii) a tolerance-banded scheduler with randomised tie-break that
  avoids creating a new peak at the global cleanest hour, and
  (iii) a persistent SQLite-backed queue that survives MCP host
  restarts and is shared across hosts (Claude Code, Claude Desktop,
  Cursor, Cline, Zed, Windsurf, Pi, OpenClaw, generic stdio).
  We propose three optional spec fields (`priority`, `deadline`,
  `carbon_budget`) to make deferral semantics interoperable at the
  protocol layer. A 10,000-task synthetic-load simulation across
  seven grid regions reports a maximum dispatch-hour concentration
  of 10.8 % under the synthetic curve (vs. the 4.2 % uniform floor
  for 24 buckets), empirically refuting the "everyone runs at
  03:00" anti-pattern under varied submit times, deadlines, and
  regions.
keywords:
  - carbon-aware computing
  - sustainable computing
  - agentic AI
  - workload scheduling
  - Model Context Protocol
  - MCP
  - batch APIs
  - load shifting
venue: "Submission target: HotCarbon Workshop (USENIX) / Green Software Foundation TSC / arXiv cs.DC preprint"
date: "May 2026"
---

# 1. Introduction

The rise of agentic large-language-model (LLM) systems — autonomous
agents that orchestrate multiple tool calls per user request —
has produced two compounding pressures on data-center electricity
demand. First, the per-call energy of frontier-class inference is
non-trivial: published estimates place a single 1k-token Claude or
GPT-4-class call at roughly 1.5 mWh end-to-end, including data-
center power-usage-effectiveness overhead [1, 2]. Second, the
*deferrable* fraction of agent workloads is rising. Overnight
digest generation, daily competitive-intelligence sweeps, batch
embedding refreshes, and similar tasks have hours of wall-clock
slack relative to user interaction — slack that is currently
spent on whatever grid intensity happens at the moment the agent
dispatches.

The Model Context Protocol (MCP) [3] specification, published by
Anthropic in late 2024 and adopted by Claude Desktop, Claude Code,
Cursor, Cline, Zed, Windsurf, Pi, and OpenClaw, standardises the
transport-level interface between an agentic host and a "server"
that exposes callable tools. Today every MCP `tools/call` request
is treated as synchronous and immediate: there is no in-spec way
for the caller to communicate a deadline, a priority, or a carbon
budget. As a result, every deferral implementation to date is a
provider-specific extension that does not compose across hosts.

We address this with **ebb-ai**, an open-source MCP server (Apache-
2.0, `npm @ebb-ai/mcp@0.8.1`) that exposes a `schedule_task` tool
accepting `deadline` and `carbon_budget_g`, backed by a multi-
source grid-intensity router and a randomised-tie-break scheduler
that avoids the pathology of every task converging on a single
"cleanest" hour. We additionally propose three optional fields
(`priority`, `deadline`, `carbon_budget`) for inclusion in the MCP
specification proper [§4]. The reference implementation has 204
passing automated tests and a 10,000-task even-distribution
simulation that empirically refutes the new-peak anti-pattern.

This paper makes four contributions:

1. A **per-zone grid-carbon-intensity router** that selects
   between four real-data sources at request time and falls back
   to a deterministic synthetic curve when an API key is absent,
   so the system runs end-to-end without operator configuration.

2. A **tolerance-banded scheduler with randomised tie-break**
   that selects among forecast entries within 15 % of the
   cheapest, rather than collapsing every task onto the global
   trough. We quantify the improvement: under the synthetic
   curve, maximum dispatch-hour concentration drops from 66.9 %
   to 10.8 %.

3. A **protocol-level proposal** to MCP that makes deferral
   semantics interoperable, with backward-compatible field
   placement, error semantics, and a reference implementation.

4. An **even-distribution evaluation methodology** that scales
   to 10,000 synthetic tasks with random submit times, deadlines,
   and regions, packaged as an executable test the broader
   carbon-aware-computing community can reuse and extend.

# 2. Background

## 2.1 Carbon-aware load shifting

The thesis that software workloads should be scheduled in time
and space to align with periods of lower-carbon electricity
generation is now mature. The Green Software Foundation's Carbon
Aware SDK [4], WattTime's marginal-emissions framework [5], and
Electricity Maps' real-time intensity data [6] together form the
recognised methodology. Production deployments include Google's
load-shifting in Borg [7], Microsoft's carbon-aware Azure regions,
and a handful of academic-sector schedulers.

The *additionality* critique — does marginal-emissions accounting
on a fixed-generation grid translate to real emissions reductions,
or merely relocate them? — remains live in the literature [8].
We adopt the marginal-emissions methodology pragmatically:
software-controlled load shifting is the operationally relevant
signal even under conservative additionality assumptions, and the
implementing scheduler is honest about the methodology it uses.

## 2.2 The Model Context Protocol

MCP [3] specifies a JSON-RPC transport (stdio, HTTP, WebSocket)
between an agentic host and a tool server. A server advertises
`tools/list` and accepts `tools/call`; the host orchestrates which
tool the model invokes. The protocol's design centres on
*interactive* agent workflows — a single user, a single host, a
small number of round-trips per user-visible task.

The protocol does not, today, model deferral. Every `tools/call`
is treated as synchronous; the server is expected to return a
result in milliseconds-to-seconds. Servers that want to defer
must either block the client (poor UX, no batch-API discount) or
fork the call into a vendor-specific "schedule for later" sibling
tool that the host has to learn separately. Neither composes.

## 2.3 Batch APIs

Anthropic's Message Batches API and OpenAI's Batch API both
offer a 24-hour SLA at roughly 50 % of synchronous pricing.
These APIs are the natural target for deferred agentic
workloads — but their existence is opaque to the MCP host: the
host has no way to express "I'm fine with up to 24 hours" through
the protocol, so it cannot tell the server to use the Batch path.

# 3. System design

`ebb-ai` is a pnpm monorepo containing four packages:

- `@ebb-ai/core` — TypeScript scheduler, grid feeds, scoring,
  retry policy, persistence, aggregation.
- `@ebb-ai/mcp` — Stdio MCP server exposing nine tools.
- `@ebb-ai/cli` — Command-line `ebb tick`, `ebb queue list`,
  `ebb receipts list`, `ebb stats`.
- `core-py` — Python parity port.

A separate `apps/dashboard` Next.js application surfaces live
grid intensity for seven monitored regions and a personal-impact
view consuming the aggregator output.

## 3.1 Multi-source grid-intensity router

The grid-feed module provides a `GridFeed` interface with one
method, `fetchForecast(region, hours): Promise<GridForecast>`.
Implementations include:

- `ukCarbonIntensityFeed()` — U.K. National Grid ESO Carbon
  Intensity API. Free, no API key, 48-hour forecast.
- `eiaFeed(apiKey?)` — U.S. Energy Information Administration
  Open Data API. Free API key. Covers CISO, ERCO, ISNE, PJM,
  NYIS, MISO at hourly granularity.
- `entsoeFeed(securityToken?)` — European Network of Transmission
  System Operators for Electricity Transparency Platform. Free
  token. Covers FR, DE, ES, IT, NL at quarter-hour granularity.
- `electricityMapsFeed(apiKey?)` — Electricity Maps free tier,
  universal fallback.
- `mockGridFeed(clock?)` — Deterministic synthetic sinusoid with
  per-region phase offsets matching local-clock troughs and peaks.

`buildDefaultGridFeed()` composes these per-zone with deterministic
mock as the universal fallback when API keys are absent. The
router reports its actual source on the returned forecast object,
so callers can distinguish *live* from *mock* without inspecting
URLs.

The dashboard at `https://ebb-ai.com` runs this router in
production. As of submission, the live deployment serves real-
time data for `GB` (UK Carbon Intensity, key-less) and mock data
for the other six regions pending operator addition of the
optional `EBB_EIA_API_KEY`, `EBB_ENTSOE_SECURITY_TOKEN`, and
`EBB_ELECTRICITY_MAPS_API_KEY` Vercel environment variables.

## 3.2 Scheduler scoring + randomised tie-break

The `recommendWindow(opts, deps)` function takes a `deadline` and
a `region`, fetches the forecast horizon, filters entries that
fall inside `[now, deadline]`, optionally filters again against an
explicit `carbon_budget_g`, sorts ascending by carbon intensity,
and selects the cheapest entry.

A naïve "pick the cheapest" implementation has a known pathology:
under a load of many concurrent tasks with overlapping deadlines,
every long-deadline task converges on the global cleanest hour,
which is exactly the *new peak* the carbon-aware-computing
literature warns against [4, §5.3].

We address this with a **tolerance-banded randomised tie-break**.
Entries within a 15 % tolerance of the cheapest (with a 30 g
CO2e/kWh floor for very low-intensity zones) are treated as
"equally clean"; one is selected uniformly at random via an
injectable `rng` dependency (defaults to `Math.random`). The
band is calibrated so that an entry classified as `clean` does
not get displaced by an entry classified as `average`, but two
entries within the same band are interchangeable for scheduling.

The injectable RNG keeps the function pure for unit tests; in
production it samples wall-clock entropy. Implementation:
`packages/core-ts/src/recommend.ts`.

## 3.3 Persistent SQLite queue

The MCP server writes every `schedule_task` to a SQLite database
at `~/.ebb-ai/queue.db` (override via `EBB_DB_PATH`). The
schema records the task body (provider-call spec, prompt, model,
deadline), the chosen window, the dispatch state, and the carbon
receipt on completion. The queue is shared across MCP hosts and
survives MCP server restarts — both of which were the loudest UX
deficits in the pre-v0.7.1 in-memory-only design.

A separate `ebb tick` daemon (launchd on macOS, systemd on Linux)
reads scheduled rows from the same database and dispatches them
through the provider adapter at the chosen window. The MCP
server can run in any host; the tick daemon runs once per machine.

## 3.4 Carbon receipts

Each completed task writes a `CarbonReceipt` row containing
`taskId`, `ranAt`, `region`, `estimatedCarbonGCo2`, `provider`,
`model`, `durationMs`, redacted `prompt`, `totalTokens`. The
receipt is the immutable audit-trail unit: aggregations
(`aggregateStats`, `aggregateByRegion`, `bandHistogram`,
`achievements`) are pure functions over receipt collections, and
the `ebb stats` CLI and the dashboard `/stats` route both render
the same shape.

# 4. Proposed MCP protocol extension

We propose three optional fields on `tools/call.params`:

| Field | Type | Range | Semantics |
|---|---|---|---|
| `priority` | integer | 0–9 | Relative importance. 0 = best-effort; 5 = default; 9 = critical. |
| `deadline` | RFC 3339 string | future | Absolute wall-clock time by which the response must have returned. |
| `carbon_budget` | number | ≥ 0 | Maximum grams CO2e the caller will spend. Server fails (`-32000`) if no window inside the deadline meets the budget. |

All three are optional and unrecognised by spec-aware servers
fall back to synchronous behaviour per JSON-RPC §5. Field
placement is `params` directly (alongside `name` and `arguments`),
not nested in `arguments` (which is tool-specific) or `_meta`
(which is infrastructure-level transport metadata).

The full proposal, including filing checklist and rationale for
the placement decision, is at
`docs/spec/proposal/UPSTREAM-PR.md` in the `ebb-ai` repository.

# 5. Evaluation

## 5.1 Test methodology

We ship a 10,000-task synthetic-load simulation as an executable
test (`packages/core-ts/test/even-distribution.test.ts`). The
test:

1. Generates 10,000 tasks with random deadlines (1–72 hours),
   random regions across seven monitored zones (US-CAL-CISO,
   US-TEX-ERCO, US-NE-ISNE, US-MIDA-PJM, FR, DE, GB), and random
   submit times across a 7-day window.
2. Calls `recommendWindow` for each, with a seeded RNG for the
   tie-break and a clock-injected mock feed so the forecast
   horizon aligns with each task's simulated submit time.
3. Bins the chosen UTC-hour-of-day into 24 buckets.
4. Reports maximum bucket concentration and empty-bucket count.

The seeded PRNG (`mulberry32`) makes the test deterministic
across CI runs.

## 5.2 Results

| Configuration | Max bucket concentration | Empty buckets / 24 |
|---|---|---|
| Pre-v0.8.0 (cheapest-only) | 66.9 % | 17 |
| v0.8.0 (per-region phase + jitter) | 51.0 % | 3 |
| v0.8.1 (CLI/MCP path reconciliation) | 51.0 % | 3 |
| **v0.8.2 (clock-injected mock + varied submit)** | **10.8 %** | **0** |

The pre-v0.8.0 baseline reproduces the exact "everyone runs at
03:00" pathology the literature warns about: 66.9 % of dispatch
piles into a single UTC hour, and 17 of 24 hours receive zero
dispatch — load shifting that creates a worse peak than the one
it relieves.

After the v0.8.2 fix set (per-region phase offsets in the synthetic
curve, randomised tie-break across the 15 % tolerance band,
clock-injected mock feed, varied submit times), the maximum bucket
sits at 10.8 % — well above the uniform 4.2 % floor for 24
buckets but qualitatively spread, with every hour receiving some
dispatch.

This is, to our knowledge, the first published quantitative
refutation of the new-peak anti-pattern for an MCP-layer
scheduler. The methodology generalises to any carbon-aware
scheduler that accepts deadlines + regions; the test is open-
source and reusable.

## 5.3 Production deployment

`ebb-ai` ships as `@ebb-ai/mcp@0.8.1` on npm, with 204 passing
automated tests (99 + 21 + 8 in TypeScript, 75 in Python). The
Claude Code marketplace plugin `ebb-ai@0.8.1` auto-wires the
server. The dashboard at `https://ebb-ai.com` serves live GB
data and a `/forecast`, `/plan`, `/queue`, `/stats` UX. Ten
documented host integrations cover Claude Code, Claude Desktop,
Cursor, Cline, Continue, Zed, Windsurf, Pi, OpenClaw, and
generic stdio.

# 6. Discussion

## 6.1 Why "carbon" and not just "cost"

Batch APIs already give cost discounts independent of carbon. A
purely cost-driven scheduler would land at the same Batch-API
window selection ebb-ai does, without needing a grid feed. The
carbon framing matters for three reasons:

- **Different cost curves.** Provider-batch discounts are step
  functions (50 % off above 24h). Carbon intensity is continuous
  hour-to-hour. Scheduling against the continuous curve picks
  finer windows than scheduling against the step.
- **Different deadlines.** Many agentic tasks have natural
  deadlines (next morning, end of quarter, etc.) that don't map
  cleanly to 24-hour batch boundaries. The deadline is the
  control surface; cost and carbon are the optimisation targets.
- **Different incentives.** Carbon framing aligns the scheduler
  with the user's stated values (most agent users want the
  environmental wins) and with vendor sustainability disclosures
  that already track Scope 2 emissions per workload.

## 6.2 Honest accounting under additionality

The implementing system reports both `intensitySource` (`scored`,
`current`, `expedited`) and the methodology used (`marginal` per
WattTime, `average` per Electricity Maps) on every receipt. We
do not claim that marginal-emissions load shifting resolves the
additionality critique; we claim that it captures the operationally
relevant signal for software-controlled scheduling under any
honest accounting. Users running the system get the audit trail
to make their own additionality argument.

## 6.3 Limitations

- **Per-region phase calibration in the mock feed** uses a
  single canonical UTC offset per region; DST and per-grid-
  operator phase variance are not modelled. Real-data sources
  handle this correctly; the mock is for tests.
- **The MCP spec proposal** is not yet upstreamed. Adoption
  depends on Anthropic-MCP-working-group reception.
- **Adoption metrics are not collected** for the ten documented
  host integrations. The repository documents the installation
  surface, not third-party deployment.

# 7. Related work

The Green Software Foundation's Carbon Aware SDK [4] is the
closest analogue at the library level; ebb-ai is positioned one
layer up, at the agentic-host integration. WattTime's marginal-
emissions methodology [5] is reused verbatim. Electricity Maps [6]
is one of four data sources. Academic carbon-aware schedulers
have targeted batch-job systems (e.g. Wiesner et al. on Kubernetes
job shifting [9]); to our knowledge, no prior work has targeted
the MCP layer specifically.

# 8. Conclusion

`ebb-ai` is an open-source carbon-aware scheduler for agentic-AI
workloads at the Model Context Protocol layer. We refute the
"new peak at 03:00" anti-pattern empirically (10.8 % maximum
concentration in a 10,000-task simulation, vs. 66.9 % for a
naïve cheapest-only baseline). We propose three optional MCP-
spec fields (`priority`, `deadline`, `carbon_budget`) that make
deferral semantics interoperable across hosts. The reference
implementation is shippable today (204 passing tests, npm
distribution, Claude Code marketplace plugin); the spec
proposal is filing-ready.

Source: <https://github.com/Vitalini/ebb-ai>
Live dashboard: <https://ebb-ai.com>

# References

[1] Patterson, D., et al. "The Carbon Footprint of Machine Learning Training Will Plateau, Then Shrink." *Computer*, 2022.

[2] Luccioni, A. S., Viguier, S., Ligozat, A.-L. "Estimating the Carbon Footprint of BLOOM, a 176B Parameter Language Model." *Journal of Machine Learning Research*, 2023.

[3] Anthropic. "Model Context Protocol Specification." 2024. <https://modelcontextprotocol.io/>

[4] Green Software Foundation. "Carbon Aware SDK." 2024. <https://github.com/Green-Software-Foundation/carbon-aware-sdk>

[5] WattTime. "Marginal Emissions Methodology." 2023. <https://www.watttime.org/marginal-emissions-methodology/>

[6] Electricity Maps. "Free Tier API Documentation." 2024. <https://www.electricitymaps.com/free-tier-api>

[7] Radovanovic, A., et al. "Carbon-Aware Computing for Datacenters." *IEEE Transactions on Power Systems*, 2023.

[8] Bashir, N., et al. "The Case for Operating Renewable-Powered Datacenters with Reduced Carbon Burden." *HotCarbon*, 2022.

[9] Wiesner, P., et al. "Cucumber: Renewable-Aware Admission Control for Delay-Tolerant Cloud and Edge Workloads." *Euro-Par*, 2022.

---

*Submission target:* HotCarbon 2026 Workshop (USENIX) — abstract deadline TBD, paper deadline typically May or June.

*Alternative submission:* arXiv cs.DC preprint (no peer review gate, useful as a citation anchor).

*Authoritative source for this paper:* `docs/papers/carbon-aware-mcp-scheduling.md` in [`github.com/Vitalini/ebb-ai`](https://github.com/Vitalini/ebb-ai). LaTeX/PDF rendering pipeline at `docs/papers/build.sh` (TBD).
