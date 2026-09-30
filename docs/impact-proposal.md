# Proposal: opt-in anonymized impact aggregate on `/stats`

**Status: proposal only. Nothing in this document is built.** It compares
three designs for showing an aggregate across users on `/stats`
(`apps/web/src/app/stats/page.tsx`) — runs scheduled, estimated gCO2
avoided, regions — and recommends one. No code changes accompany it.

## 1. What `/stats` does today, and why

`/stats` currently renders no aggregate of any kind. Its own header
comment states the reason directly:

> "No synthetic data. The site doesn't have access to your local SQLite
> ledger (`~/.ebb-ai/queue.db`); this page explains where your numbers
> live, how to read them, and what the schema looks like."
> — `apps/web/src/app/stats/page.tsx:1-11`

The page has a section titled "Why not show aggregate numbers here?"
(`apps/web/src/app/stats/page.tsx:152-176`) that gives the same reasoning
this proposal has to answer to:

> "Every public dashboard that summarizes user impact has to either (a)
> phone home with telemetry — which we explicitly decided against
> through v0.10 — or (b) fabricate aggregate numbers that look real but
> aren't. Both are bad. Local-first is honest."

That section already links a prior design for exactly this feature:
`docs/spec/proposal/v09-leaderboard.md` ("v0.9 — Global Counter &
Opt-in Leaderboard"), status "design doc + reference implementation
sketch," gated on "real adoption + privacy review," never built. This
proposal treats that document as the starting point, keeps what it got
right, and revises the parts that do not hold up (Section 4).

The page's own `<meta>` description currently reads: "No telemetry, no
cloud copy — your numbers are yours" (`apps/web/src/app/stats/page.tsx:21`).
Any design below that ships changes this sentence from true to false the
moment it is opt-in-enabled by even one user; Section 6 treats updating
every place this claim appears as part of "done," not an afterthought.

## 2. What data exists today to build from

**Local ledger.** Every dispatched task writes one row to a SQLite
`tasks` table at `~/.ebb-ai/queue.db` (schema in
`packages/core-ts/src/storage/sqlite.ts:58-76`): `task_id`, `status`,
`enqueued_at`, `scheduled_for`, `completed_at`, `region`,
`carbon_budget_g`, `result_json`, `error`, `receipt_json`,
`intensity_source`, `body_json`, `estimated_carbon_g`, `deadline`,
`batch_id`, `routing_decision`. This never leaves the machine today —
nothing in `packages/core-ts/src`, `packages/cli/src`, or the MCP server
makes an outbound network call with ledger contents.

**Receipt fields.** The `CarbonReceipt` type
(`packages/core-ts/src/types.ts:105-192`) carries, among others:
`taskId`, `ranAt`, `region`, `estimatedCarbonGCo2`, `actualCarbonGCo2`,
`deltaPct`, `provider`, `model`, `intensityGCo2PerKwh`, `gridSource`
("mock" flags a synthetic-fallback receipt), `signalType` ("marginal" vs
average grid signal), `energySource` (`measured` / `estimated` /
`fallback`), `energyResolution` (`exact` / `normalized` /
`family-fallback` / `default`), and the signature fields below. There is
**no field for "carbon avoided."** The closest existing concept,
`estimatedSavingsVsNowPct`, is computed only inside `recommendWindow`'s
preview response (`packages/core-ts/src/recommend.ts:194-197`,
`computeSavingsPct` at `recommend.ts:340-348`) and is never persisted to
the ledger or the receipt. Section 5 treats this as an open gap, not
something this proposal can paper over.

**Signing.** Every receipt is Ed25519-signed by default
(`packages/core-ts/src/sign.ts`). Keys live at `~/.ebb-ai/signing.key`
(0600) and `~/.ebb-ai/signing.key.pub` (0644), generated lazily on first
use (`sign.ts:92-94`, `loadOrCreateSigningKey` at `sign.ts:118-152`).
`signerPublicKey` is bundled on every signed receipt so a verifier needs
no out-of-band key distribution (`types.ts:172-178`). The module's own
header comment is explicit about the trust boundary this proposal must
not cross: **"The keys are NEVER sent anywhere by ebb-ai itself."**
(`sign.ts:28`). No field anywhere in `packages/core-ts/src` identifies a
physical machine (no MAC address, no hardware id, no install id); the
closest thing to a stable identifier is the signing keypair itself,
which is local-only by the design quoted above.

**Region granularity.** Regions are Electricity-Maps-style zone codes,
not countries: `packages/core-ts/src/data/regions.json` lists 31 codes
today, e.g. `US-CAL-CISO`, `US-TEX-ERCO`, `US-FLA-FPL`, `GB`, `FR`,
`DE`, `AU-NSW`, `NZ`. Several are sub-national (four separate US zones,
two Nordic zones), so a zone can have a small population of opted-in
users even if the product has many users overall.

**Uncertainty already on the books.** `packages/core-ts/src/energy.ts`'s
header states the per-model coefficients for closed models (Claude,
GPT, Gemini families) are "estimated... They may be off by ±50%"
(`energy.ts:29-31`), and that grid-to-chip energy uses a flat
`DEFAULT_PUE = 1.15` industry-average assumption (`energy.ts:34-37`),
not a per-datacenter measurement. `gridSource: "mock"` on a receipt
means the number came from the deterministic synthetic curve, not a
live grid feed (`types.ts:135-139`). None of this is aggregated or
surfaced today; any aggregate built from receipts inherits all three
uncertainty sources.

**Config precedent.** The one existing opt-in-style local setting
(carbon budget alerts) is resolved by
`packages/core-ts/src/budget.ts:275-297`: a `KEY=VALUE` file at
`~/.ebb-ai/config` (path from `carbonBudgetConfigPath`,
`budget.ts:79-81`), with host-supplied environment overrides taking
precedence (`EBB_CARBON_BUDGET_G`, `EBB_CARBON_BUDGET_WINDOW`) — the
CLI/MCP/OpenClaw hosts read the ambient environment and pass it in;
`packages/core-ts` itself never reads `process.env` (`budget.ts:236-241`,
matching the `[0.15.0]` "No ambient state" theme, `CHANGELOG.md` → `[0.15.0]` "Theme" line, currently line 143).
This is the pattern Section 6 reuses for the opt-in flag.

## 3. Three designs

| | A. No aggregate (status quo) | B. Opt-in signed event stream | C. Opt-in periodic bucketed upload |
|---|---|---|---|
| What leaves the machine | Nothing | One signed event per completed task, opted in | One signed row per (region, month) bucket, opted in |
| Per-event timestamp precision | n/a | Hour-truncated (per `docs/spec/proposal/v09-leaderboard.md:96-97`) | None — month-level only |
| Re-identification risk | None | Per-event timing + region can correlate with other public activity of the same user | Low — no event-level timing signal, only a monthly total per region |
| Trust required of the backend | None | Not to build a persistent per-key profile from repeated events | Not to build a per-key profile from repeated monthly batches (fewer points, same risk in kind) |
| Abuse / inflation risk | None | High without mitigation: any user can opt in from N machines; v09's own analysis (`v09-leaderboard.md:123-145`) calls this "not perfect," proposes a per-key rate limit and signature requirement only | Same Sybil ceiling as B, but batching removes the fine-grained abuse surface (can no longer spam per-event; can still submit N inflated monthly batches) |
| A user can misreport their own data | n/a | Yes — the user's own key signs whatever their local ledger says; signing proves origin, not honesty | Same limitation |
| Cost to run | $0 | A hosted endpoint + datastore + daily rollup job + abuse monitoring (per `v09-leaderboard.md`'s architecture, `v09-leaderboard.md:30-54`) — ongoing hosting and operational cost | Same components, lower write volume (monthly vs per-task), same ongoing cost category |
| Answers the brief's three numbers (runs scheduled, gCO2 avoided, regions) | No | Yes | Yes |

Design B is essentially `docs/spec/proposal/v09-leaderboard.md` as
drafted. Design C is this proposal's revision of it for the specific
ask in hand (an aggregate, not a leaderboard).

## 4. Recommendation: Design C, with changes from the v09 draft

Recommend the opt-in periodic bucketed upload (C), not the per-task
event stream (B), for two reasons grounded in what v09 itself already
flagged as unresolved:

1. **Drop the per-user rank/leaderboard entirely.** The brief asks for
   three aggregate numbers (runs scheduled, gCO2 avoided, regions), not
   a per-user rank. `v09-leaderboard.md`'s `GET /api/rank/:userHash`
   endpoint (`v09-leaderboard.md:189`) is exactly the kind of
   "comparative motivation" feature its own doc admits is a
   gamification feature, not a reporting one (`v09-leaderboard.md:18-24`).
   A public per-user rank is also a standing re-identification vector:
   it makes `signerPublicKey` (or any stand-in) valuable to track over
   time, which the event-stream design (B) makes cheap and the batched
   design (C) makes harder by construction (monthly granularity gives
   an observer far fewer points to correlate).

2. **Don't reuse the receipt-signing key for telemetry.** `sign.ts:28`
   states as a design guarantee that the signing keypair is never sent
   anywhere. v09 already reached the same conclusion independently — it
   proposes a **separate** keypair at `~/.ebb-ai/telemetry.key`
   (`v09-leaderboard.md:103-115`), rotatable without touching receipt
   integrity. This proposal keeps that separation; an opt-in aggregate
   must not fold the telemetry identity and the receipt-integrity
   identity into the same key, or revoking telemetry consent
   (Section 6, "right to be forgotten") becomes indistinguishable from
   breaking local receipt verification.

Everything else below assumes Design C.

## 5. Design detail

### Opt-in mechanism

Follow the exact precedent in Section 2 ("Config precedent"): a new
`KEY=VALUE` entry in the existing `~/.ebb-ai/config` file (same file
`carbonBudgetConfigPath()` already reads,
`packages/core-ts/src/budget.ts:79-81`), e.g. `EBB_IMPACT_AGGREGATE_OPT_IN=1`,
with the same precedence rule: a host-supplied environment override
(`EBB_IMPACT_AGGREGATE_OPT_IN`) wins over the file, and `packages/core-ts`
itself stays environment-pure — the CLI, MCP server, and OpenClaw plugin
each read their own ambient environment/config and pass the value in, the
same way `readEnvCredentials()` does today for the carbon budget
(`packages/cli/src/env.ts:52-67`). Default: off. No existing surface
opts a user in implicitly; this must stay explicit per-installation.

### Transport and retention

One signed row per (region, calendar month), submitted once the month
closes (or on a manual `ebb stats --submit-aggregate`-style command; the
exact trigger is an implementation decision, not fixed here). Payload
per row, following `v09-leaderboard.md:75-87`'s shape but without
per-event timestamps or a rank-bearing identifier:

```
{
  v: 1,
  telemetryKey: "<base64 public key, separate from signerPublicKey>",
  region: "<zone code from regions.json>",
  month: "2026-09",
  taskCount: <int>,
  totalEstimatedCarbonGCo2: <float>,
  sig: "ed25519:..."
}
```

Retention: the raw per-installation rows should be deleted once folded
into a monthly rollup (the same "60-day raw event, indefinite rollup"
split v09 proposed, `v09-leaderboard.md:158,183`, shortened here to
"raw row deleted once rolled up" since there is no per-event value left
to keep once the month is aggregated).

### k-anonymity / minimum-count threshold

No number is displayed on `/stats` until a (region, month) bucket has
contributions from at least **K distinct telemetry keys** (a
starting point such as K=20 is plausible but is not derived from
anything in this repo — there is no existing precedent for a specific
threshold here; this is listed under Needs Vitalii). A bucket below K
is folded into a coarser existing grouping rather than hidden silently:
this repo already buckets regions by continent in its own copy ("NA/EU/APAC",
`README.md` Status block and "Pages:" list, currently lines 102 and 345), so a small zone's contribution can roll up into its
continent bucket instead of disappearing.

### How gCO2 avoided would be estimated, and its uncertainty

No receipt field stores "avoided" carbon today (Section 2). Computing
it requires a **new** persisted counterfactual — e.g. the grid intensity
a run-now dispatch would have used, captured at schedule time next to
the existing `estimatedCarbonGCo2` — so that avoided = counterfactual
grams − actual/estimated grams, per task, summed per bucket. That field
does not exist; adding it is out of scope for this proposal (proposal
only) but is a prerequisite Section 7 calls out explicitly. Absent that
field, an approximate post-hoc estimate (re-deriving what "now" would
have cost from the region's historical intensity at the task's
`ranAt` hour) is possible but noisier and is not what this proposal
recommends building first.

Whichever method is used, the resulting number inherits three
independent, already-disclosed uncertainty tiers and must not be shown
as one unqualified figure:

- `gridSource: "mock"` receipts (synthetic-fallback intensity,
  `types.ts:135-139`) should either be excluded from the aggregate or
  shown in a separately labeled bucket.
- `energySource`/`energyResolution` (`types.ts:148-164`) mark whether
  the per-model energy coefficient was measured, estimated (±50% for
  closed models per `energy.ts:29-31`), or a flat fallback. An aggregate
  spanning receipts of mixed tiers should disclose the mix, not silently
  average confidence away.
- The flat `DEFAULT_PUE = 1.15` (`energy.ts:34-37`) is an
  industry-average assumption applied uniformly, not a per-datacenter
  measurement; the aggregate inherits this assumption for every
  contributing receipt.

### Region granularity

Report at the zone-code granularity already used across the product
(`regions.json`'s 31 codes) only once a bucket clears the K threshold;
below threshold, roll up to the continent grouping the marketing copy
already uses (Section "k-anonymity" above). No new geographic precision
is introduced beyond what `regions.json` already carries — no city, no
IP-derived geolocation (explicitly ruled out in `v09-leaderboard.md:92-93`
and carried forward here).

### Abuse and fingerprinting risks

- **Sybil / inflation.** Unresolved in principle, same as v09
  (`v09-leaderboard.md:123-133`): a per-key rate limit and a signature
  requirement raise the cost of spamming but do not eliminate it. A
  displayed number is a lower-confidence "self-reported, rate-limited"
  figure, not an audited one, and should be labeled as such wherever it
  appears.
- **Timing/correlation fingerprinting.** Design C removes per-task
  timestamps from the wire entirely (month-level only), closing the
  specific correlation channel v09's hour-truncation (`v09-leaderboard.md:96-97`)
  only partially closed.
- **Small-zone deanonymization.** A region with very few opted-in users
  can make "N tasks this month" attributable to one person even without
  a name attached. The K threshold plus continent rollup (above) is the
  mitigation; it is not perfect at the boundary (a zone that just
  clears K is still a small group).
- **Key-domain conflation.** Covered in Section 4: never reuse
  `signerPublicKey` (receipt-integrity key) as the telemetry identity.
- **Self-reported honesty.** A user's own local key signs whatever
  their own ledger says (Section 3 table). Signing proves the report
  came from that installation; it does not prove the installation
  didn't edit its own `queue.db` first. `SECURITY.md:51-60` already
  treats the local ledger as intentionally world-readable and locally
  trusted — that same local-trust boundary is why this limitation
  cannot be fully closed without server-side re-derivation from raw
  grid data, which would require exactly the per-task region+timestamp
  precision Design C avoids for privacy reasons. This is a real
  tradeoff, not a solved one.

### What changes on `/stats`, and what stays refused

Changes: `/stats` gains one new section showing, once opted-in data
clears the K threshold, a global rollup (task count, estimated gCO2
avoided, date range) and a per-region breakdown at the granularity
Section 5 describes. The existing "Why not show aggregate numbers here?"
copy (`apps/web/src/app/stats/page.tsx:152-176`) and the page's `<meta>`
description (`apps/web/src/app/stats/page.tsx:21`) are rewritten to
describe the opt-in mechanism honestly instead of stating flatly that no
telemetry exists.

Stays refused, unconditionally:

- Any per-user rank, percentile, or leaderboard (v09's
  `GET /api/rank/:userHash`, dropped — Section 4).
- Any individual task-level data surfaced publicly.
- Any bucket below the K threshold, shown as a number (it rolls up
  instead, per Section 5).
- Reading a user's local `~/.ebb-ai/queue.db` from the site directly —
  the site still has no access to it; only the user's own opted-in,
  already-aggregated upload reaches the backend.

## 6. Constraint this proposal must respect

The CHANGELOG's `[0.16.0]` section documents a case where a stated
privacy claim ("chat delivery stays inside OpenClaw") was found
inaccurate once checked against the actual transport code
(`CHANGELOG.md` → `[0.16.0]` → Fixed, "Corrected an inaccurate privacy
claim", currently line 55) — the fix corrected the claim rather than the
behavior. `[0.15.1]`'s theme, "Clean supply chain, loud privacy
boundary" (`CHANGELOG.md` → `[0.15.1]` "Theme" line, currently line 99), and its delivery-privacy fix
(`CHANGELOG.md` → `[0.15.1]` → Changed, "The delivery privacy boundary is
now stated where it is acted on", currently line 128) establish the operative norm this repo already
follows: any surface that sends data off the user's machine states that
plainly, at the point the decision is made, naming the exact transport.
Any aggregate built from this proposal is the **first** outbound network
call `packages/core-ts`/`packages/cli`/`apps/web` have ever made with
ledger-derived data (Section 2). It must be disclosed with the same
bluntness the delivery-boundary fix used — not softened, not folded into
existing "local-first" copy without a rewrite (Section 5, "What changes
on `/stats`").

## 7. Needs Vitalii

- Exact k-anonymity threshold K. This proposal names a plausible
  starting point (20) but it is not derived from anything in this repo
  and needs a product/legal call.
- Whether to reuse `v09-leaderboard.md`'s Vercel KV + edge function
  architecture as-is (Section 5's transport sketch assumes it) or design
  a different backend; either way, an owner for the ongoing hosting and
  abuse-monitoring cost (Section 3) needs to be named.
- Whether a new persisted "counterfactual intensity" receipt field
  (Section 5, "gCO2 avoided") ships before or alongside this, or whether
  a rougher post-hoc estimate is acceptable for a first version.
- Whether the CLI, MCP server, and OpenClaw plugin must all gate the
  same opt-in flag identically, or whether per-host opt-in is
  acceptable (a user opted in via the CLI but not the MCP server, for
  example).
- A "right to be forgotten" endpoint (v09 sketched one,
  `v09-leaderboard.md:117-121`) — is it required before launch, and who
  owns the legal review v09's own filing checklist left unchecked
  (`v09-leaderboard.md:348-351`)?
- Current number of installs/users, expected opt-in rate, and expected
  abuse volume: unknown. There is no existing telemetry to estimate
  from (Section 2), so any capacity or rate-limit planning is a guess
  until real data exists.
- Whether a public privacy-policy page exists or is planned; none was
  found in this repo (`SECURITY.md` covers vulnerability disclosure, not
  data handling).
