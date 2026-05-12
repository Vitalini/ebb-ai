# Engineering Review — by Senior Staff Engineer (OSS background)

## Executive verdict

`ebb-ai` v0.1 is a tasteful, deliberately scoped first cut: a clean
monorepo, a working `defer()` API, an MCP server that speaks the
protocol correctly (I verified end-to-end with raw JSON-RPC on stdio
against `@modelcontextprotocol/sdk@1.29.0`), passing tests, green
typecheck, and honest documentation about what does and does not exist
in v0.1. For "drafted yesterday, packaged today, asking 'should I
publish?'", this is well above the median I see on a Monday.

That said, there are several concrete correctness, documentation, and
adoption-readiness defects that an early adopter will hit in the first
five minutes — most prominently a *carbon budget that is captured but
never enforced* (which is the project's headline feature), a *Claude
Code config path that doesn't exist*, *code samples in the public
README that use region strings the grid feed doesn't recognize*, and
*a fetch with no timeout that can wedge the scheduler*. None are
catastrophic, but four or five of them together undermine the
"opinionated, honest engineering" frame the project needs to win.

Ship after must-fix.

## Strengths

- **Tasteful scope and honest deferrals.** Every README, the MCP
  server README, the Claude Code example, the SKILL.md, and PLAN.md
  all explicitly call out what's *not* in v0.1 (Batch API dispatch,
  SQLite persistence, cross-provider routing, Python port). That kind
  of honesty is the difference between an OSS project that gets
  trusted and one that gets quietly closed-tabbed.
- **The MCP server actually works.** I sent `initialize` →
  `notifications/initialized` → `tools/list` → `tools/call
  get_grid_forecast` over stdio and got correct, well-formed
  responses. Three tools registered, JSON Schema for inputs is right,
  response is `{content: [{type: "text", text: ...}], isError?}` which
  matches the MCP `CallToolResult` shape.
- **The `pickBestWindow` algorithm is correct.** Filters by `[now,
  deadline]`, picks the minimum-intensity entry, returns `undefined`
  when nothing fits. Test covers both cases.
- **Mock feed is well-designed for development.** The cosine curve
  with regional floors gives a recognizable intraday shape; the API
  key fallback path is deliberate and well-commented; tests cover the
  shape (`max - min > 50`) without being brittle.
- **`pnpm install && pnpm typecheck && pnpm build && pnpm test` is
  clean.** No warnings, 11/11 tests pass, sub-second runtime. CI
  matrix on Node 20 and 22 is right.
- **`strict + noUncheckedIndexedAccess + noImplicitOverride` is on**
  in `tsconfig.base.json`. That's the right baseline for a public
  library.
- **Apache-2.0 (with the patent grant) is the right license** for a
  project that plans to push MCP spec PRs. Called out in PLAN.md.
- **Landing site is restrained and on-brand.** Single page, no JS, no
  framework, deployable to anything. The hero copy ("One MCP call.
  Three honest tools. Auditable carbon receipts.") is good.
- **Naming is consistent across surfaces.** `@ebb-ai/core`,
  `@ebb-ai/mcp`, `ebb-mcp` CLI, `ebb-ai` repo, `EBB_*` env vars.

## Critical issues (must-fix before any public release)

### 1. `carbonBudgetG` is captured but never enforced — the headline feature is a no-op
- **File:** `packages/core-ts/src/scheduler.ts:92`,
  `packages/core-ts/src/scheduler.ts:219-236` (`pickBestWindow`),
  `packages/mcp-server/src/server.ts:196`
- **Severity:** Critical
- **Issue:** `DeferOptions.carbonBudgetG` and the MCP
  `carbon_budget_g` argument are stored on the `TaskRecord` and echoed
  in `formatTask`, but `pickBestWindow` never inspects them, and
  `dispatch` never refuses a window whose `intensityG *
  ENERGY_KWH_PER_TASK` would exceed the budget. A user can ask for "max
  5 g" and ebb-ai will happily run them at a 700 gCO2/kWh window. The
  project's pitch is auditable carbon budgets; v0.1 silently breaks
  that contract.
- **Fix:** Either (a) implement the budget check — in
  `pickBestWindow`, drop entries whose estimated grams exceed
  `carbonBudgetG`, and if zero usable windows remain, fail the task with
  a typed `CarbonBudgetExceededError` rather than dispatching to "any"
  window; or (b) explicitly mark the field as v0.2 in types, docs, MCP
  tool description, and SKILL.md — and remove it from `DeferOptions` for
  v0.1 to avoid landing a known-broken contract in the type signature.
  Option (a) is roughly 20 lines of code and the right call.

### 2. `schedule_task` accepts unparseable and past deadlines silently
- **File:** `packages/mcp-server/src/server.ts:51-55`,
  `packages/core-ts/src/scheduler.ts:213-217`
- **Severity:** Critical
- **Issue:** I sent `deadline: "not-a-date"` and `deadline:
  "2020-01-01T00:00:00Z"`; both returned `Task queued. status:
  queued`. `normalizeDeadline` does `new Date(d)` and never checks
  `isNaN(date.getTime())`. `pickBestWindow` then filters by `t <=
  deadline.getTime()` — `NaN` comparisons are always false, so no
  entry is "usable" and the scheduler dispatches immediately at
  whatever the current grid intensity is (defeating the whole point).
- **Fix:** Validate deadline at MCP boundary with
  `z.string().datetime()` (zod has it built-in) and reject past
  deadlines with a clear error. Same check in
  `Scheduler.enqueue` for direct-API callers.

### 3. Claude Code example points at a config path that does not exist
- **File:** `examples/claude-code/README.md:17-37`,
  `examples/claude-code/mcp.json`, `README.md:58`
- **Severity:** Critical (adoption blocker)
- **Issue:** The doc says "Add `ebb-ai` to your `~/.claude/mcp.json`
  (or workspace `.claude/mcp.json`)". Claude Code does not read
  `~/.claude/mcp.json`. MCP servers are added via the `claude mcp add`
  CLI or by editing the `mcpServers` key in `~/.claude.json`
  (singular, no subdir). Step 3 mentions `/restart` which also is not
  a Claude Code command. Every first-time installer following this
  doc will hit "tools not listed".
- **Fix:** Replace with the correct flow:
  ```
  claude mcp add ebb-ai -- node /ABS/PATH/.../server.js
  ```
  (or, if file-based, edit `~/.claude.json`). Update the surrounding
  prose, the `examples/claude-code/mcp.json` sample (move it into the
  right shape and put it under the right key), and the README "Quick
  start" cross-reference. Recommend testing the flow end-to-end on a
  fresh machine before shipping.

### 4. Electricity Maps fetch has no timeout — a hang will wedge the scheduler
- **File:** `packages/core-ts/src/grid.ts:113`
- **Severity:** Critical (reliability)
- **Issue:** `await fetch(url, { headers: { "auth-token": key } })`
  with no `signal`. If Electricity Maps' edge is degraded, this hangs
  forever; the scheduler's `schedule()` call blocks; every subsequent
  `defer()` for that scheduler stalls inside `void this.schedule()`
  (the call is `void`, so the task is "queued" but no `setTimeout` is
  ever set; the resolver promise never resolves).
- **Fix:** `fetch(url, { headers: {...}, signal:
  AbortSignal.timeout(5000) })`. Catch the timeout in the existing
  `try/catch` (which already falls back to mock — good shape). Same
  treatment for `estimateIntensity` (which silently re-fetches a fresh
  24h forecast every dispatch, see issue #9 below).

### 5. `region: "us-east"` in public README and landing-page code samples is not a real Electricity Maps zone
- **File:** `README.md:95`, `apps/site/index.html:42`,
  `packages/core-py/README.md` (planned)
- **Severity:** Critical (documentation correctness)
- **Issue:** Electricity Maps zones are codes like `US-CAL-CISO`,
  `US-TEX-ERCO`, `US-NE-ISNE`. The hero code samples in both the
  README and the landing page say `region: "us-east"`. If a user
  copy-pastes that, the mock feed silently falls back to a generic
  floor of 380, and the real Electricity Maps API will return 404 or
  empty. The discrepancy with the MCP server's own tool description
  (which correctly says `'US-CAL-CISO', 'US-TEX-ERCO', 'FR', 'DE'`) is
  embarrassing.
- **Fix:** Replace `"us-east"` with `"US-CAL-CISO"` everywhere in
  user-facing samples. Add a one-line note linking to the Electricity
  Maps zone list. Consider supporting an aliased shorthand
  (`"us-east"` → `"US-MIDA-PJM"`) but only if it ships with the alias
  table documented.

## Important issues (should-fix this sprint)

### 6. Caller-supplied `taskId` can collide with auto-generated ones; no collision check
- **File:** `packages/core-ts/src/scheduler.ts:54-84`
- **Severity:** Important
- **Issue:** A caller can pass `taskId: "t-3"`, then later
  auto-generation hits the same id, then `this.tasks.set(taskId, ...)`
  silently overwrites the existing record; the old resolver promise
  hangs forever, the old timer is leaked (still in
  `pendingTimers`). Also no validation that `taskId` is non-empty.
- **Fix:** Throw on collision; require a minimum length / charset
  restriction; do not initialize `nextSerial` from a fixed integer if
  you accept caller ids (or namespace them, e.g. `user:foo` vs
  `auto:t-1`).

### 7. Scheduler forecast horizon hard-capped at 24 h, but `schedule_task` deadline can be days out
- **File:** `packages/core-ts/src/scheduler.ts:121-128`
- **Severity:** Important
- **Issue:** Deadline 48 h out → `horizonH` clamped to 24 →
  `pickBestWindow` only sees entries inside the first 24 h. The
  *cleaner* window 30 h from now is never considered. The MCP tool's
  own `hours` schema allows 72. The hard cap predates the rest of the
  surface and is now a bug.
- **Fix:** Compute horizon as `min(72, ceil((deadline - now)/hour))`
  and document the 72-hour ceiling. Adjust mock feed to support it
  (already does — loop bound is `i < hours`). Add a test.

### 8. `setTimeout` ms overflow for long-horizon deadlines
- **File:** `packages/core-ts/src/scheduler.ts:138-142`
- **Severity:** Important (correctness ahead of v0.2)
- **Issue:** Node's `setTimeout` overflows the signed-32-bit ms range
  (~24.85 days). If a candidate window is 25+ days out, Node fires the
  callback immediately. Today this is unreachable because horizon is
  capped at 24 h, but lifting that cap (issue #7) or letting users
  pass arbitrary deadlines through the lib makes it reachable.
- **Fix:** If `wait > 2^31 - 1`, chain multiple timeouts. Or document
  a max horizon and reject larger deadlines.

### 9. `estimateIntensity` re-fetches a fresh 24 h forecast on every dispatch
- **File:** `packages/core-ts/src/scheduler.ts:179-192`
- **Severity:** Important (perf + cost)
- **Issue:** Two API calls per task (one for scheduling, one for the
  receipt), with no cache. With 100 deferred tasks/day and a free-tier
  rate-limited API this will hit limits and slow dispatch. Worse, the
  receipt's "intensity at dispatch time" should be the forecast value
  that was used during scoring, not a freshly fetched one (they will
  often disagree; what's the audit trail?).
- **Fix:** Cache the forecast in the `TaskRecord` (you already write
  it transiently in `schedule`), and read from the cached entry in
  `dispatch`. Bonus: more honest receipts.

### 10. Stable `nextSerial` is process-local — task IDs collide across restarts and across multiple `Scheduler` instances
- **File:** `packages/core-ts/src/scheduler.ts:55,84`
- **Severity:** Important
- **Issue:** `t-1, t-2, t-3...` from any new Scheduler. The MCP server
  has one Scheduler per process, so a restart re-issues `t-1` and the
  old `task_id` returned to the agent now refers to a different task
  (or nothing). PLAN says SQLite persistence lands in v0.2 — that's
  the right fix — but in the meantime, use an opaque id
  (`crypto.randomUUID()` or `nanoid`) so old IDs don't get aliased.
- **Fix:** Switch to `crypto.randomUUID()`.

### 11. `bin` declared but built file has no executable bit
- **File:** `packages/mcp-server/package.json:9-11`,
  `packages/mcp-server/dist/server.js`
- **Severity:** Important (publish-blocker)
- **Issue:** `"bin": {"ebb-mcp": "./dist/server.js"}` will be respected
  by `npm install -g`, but the file in `dist/` has mode `0644`. After
  `npm publish`, `npx ebb-mcp` will fail with `permission denied` on
  many setups. (npm itself often fixes this on install — but not
  always; certainly local `pnpm dlx` invocations against the dist will
  fail.)
- **Fix:** Add a build post-step: `"build": "tsc -p tsconfig.json &&
  chmod +x dist/server.js"`. Or use a tiny `prepack` script.

### 12. `package.json` `exports` field has `types` after `import`
- **File:** `packages/core-ts/package.json:10-15`
- **Severity:** Important (TypeScript consumer breakage)
- **Issue:** Node's conditional exports are resolved in declaration
  order. `types` MUST come before `import`/`require` or some
  TypeScript versions resolve to the `.js` file and lose type info.
- **Fix:**
  ```json
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    }
  }
  ```

### 13. Mock feed uses host-local hours but emits UTC ISO timestamps
- **File:** `packages/core-ts/src/grid.ts:31-51` (`date.getHours()`),
  `packages/core-ts/src/grid.ts:64` (`t.toISOString()`),
  `packages/mcp-server/src/server.ts:262` (`e.datetime.slice(11, 16)`)
- **Severity:** Important (correctness on non-UTC hosts)
- **Issue:** `getHours()` returns local-time hour, so the synthesized
  carbon curve peaks at host-local 17:00. The emitted `datetime` is
  UTC ISO, and the MCP `formatForecast` slices `HH:MM` out of the UTC
  string. On a host in UTC-5, the user sees "cleanest hour 08:00"
  (UTC) which the synth model intended as 03:00 local. Confusing on
  any host outside UTC; especially confusing in tests on CI.
- **Fix:** Pick one. Either use `date.getUTCHours()` in the synth and
  document "UTC throughout", or convert to local-time display in
  `formatForecast`.

### 14. `privacy` option is in the public type but is dead code
- **File:** `packages/core-ts/src/types.ts:19-20`
- **Severity:** Important
- **Issue:** The "region-locking for privacy (us-only / eu-only)"
  field is exported in `DeferOptions` and documented as part of the
  public API in PLAN.md, but nothing reads it. Either it does
  something or it doesn't; shipping a public field that silently
  ignores its input is exactly the kind of thing OSS reviewers cite as
  "broken contracts" in v0.1.
- **Fix:** Remove from `DeferOptions` for v0.1; re-add when the
  feature actually exists. Mention as "planned" in PLAN.md only.

### 15. `zod` is a runtime dep of `@ebb-ai/core` but unused
- **File:** `packages/core-ts/package.json:24`,
  `packages/core-ts/src/*.ts`
- **Severity:** Important (cosmetic but visible)
- **Issue:** Dead dependency increases install size and surface area.
- **Fix:** Remove from `packages/core-ts/package.json`. (It is
  correctly listed as a dep in `mcp-server`, where it's actually
  used.)

### 16. `pnpm lint` is a dead script
- **File:** `package.json:24`
- **Severity:** Important
- **Issue:** Root script runs `pnpm -r ... lint` but no package
  defines `lint`, no ESLint config exists, no ESLint is installed.
  Two `// eslint-disable-next-line no-console` comments in the source
  are decorative. A contributor running the documented `pnpm lint`
  gets `None of the selected packages has a "lint" script`.
- **Fix:** Either add a minimal `eslint` + `@typescript-eslint`
  config and one rule (e.g. `no-console: warn`) per package, or
  remove the dead `lint` script and the disable comments. The first is
  the right answer for an OSS project that wants contributors.

### 17. `@modelcontextprotocol/sdk` pinned at `^1.0.4`, resolves to 1.29.0
- **File:** `packages/mcp-server/package.json:23`
- **Severity:** Important
- **Issue:** Caret range across a major-zero-ish span; 29 minor
  versions of drift. Spec versions have moved (the SDK is now defaulting
  to `2025-11-25`); old clients (e.g. tools pinned to `2024-11-05`) may
  still work because the SDK negotiates, but you have no guarantee. For
  a v0.1 release where the MCP integration *is* the product, pin tighter.
- **Fix:** `"@modelcontextprotocol/sdk": "1.29.0"` or `~1.29.0`. Bump
  deliberately.

## Nice-to-have

- **Empty directories committed.** `apps/dashboard/`, `docs/spec/`,
  `examples/openclaw-demo/` are empty. Either populate with a stub
  README and a placeholder `.gitkeep`, or delete until they exist.
  PLAN says these land in v0.2/v0.3 — link there from the README's
  "Documentation" section rather than linking at `./docs/` which
  presently is two empty subdirs.
- **`README.md` "Components" table lists `ebb-ai (PyPI)` without
  `(planned)`** — but `apps/dashboard` and `docs/spec` are marked
  planned. Make it consistent: mark Python as planned too. The Python
  package's own README does the right thing.
- **No CHANGELOG.** A pre-1.0 OSS lib without a CHANGELOG signals
  "may rewrite at any time". Add `CHANGELOG.md` with v0.1 entry; use
  Keep a Changelog format.
- **No CODE_OF_CONDUCT or CONTRIBUTING.** For a project that intends
  to attract external contributors and stake an MCP-spec position,
  these are 30-minute additions that smooth onboarding.
- **No CODEOWNERS.** Add yourself as `* @Vitalini`. Trivial; makes
  PR reviews route automatically.
- **CI cache for `pnpm store`.** `actions/setup-node@v4` with
  `cache: "pnpm"` is fine, but you can additionally cache
  `~/.local/share/pnpm/store` for faster CI on PRs with no lockfile
  change.
- **README "Roadmap" anchor.** PLAN.md is long; surface a 5-line
  "What v0.1 actually does today" / "What v0.2 adds" callout in
  README so a drive-by reader gets the picture without opening PLAN.
- **`apps/site` has no link to itself.** No published URL anywhere
  (and PLAN says local-only). Once GH Pages is up, link from
  README's first paragraph.
- **CI doesn't test on macOS.** For a tool advertising Claude
  Desktop and OpenClaw (both heavily macOS), a single
  `runs-on: macos-latest` matrix entry would catch real install-flow
  bugs (and the path-separator-in-shell-script kind).
- **No `engines` enforcement.** `engines.node >= 20.0.0` is declared
  but pnpm doesn't enforce engines by default. Add
  `engine-strict=true` to `.npmrc` if you want it to bite.

## Test gaps

Tests are *meaningful, not just structural* — the 9 core-ts tests
actually exercise `pickBestWindow` correctness and the e2e dispatch
path. But several risk-weighted tests are missing:

1. **Past-deadline behavior.** Right now we dispatch immediately
   when no usable window exists. Test that this is observed *and*
   that the carbon receipt reflects the immediate-dispatch fact (not
   a forecast value).
2. **Carbon-budget enforcement.** Once #1 in Critical is fixed, add
   a test that asserts the budget is honored — a queued task whose
   only-available windows exceed the budget should fail with a typed
   error.
3. **Invalid-input rejection.** Specifically `deadline:
   "not-a-date"`, `deadline: "2020-01-01"` (past), `deadline: ""`
   should all return a structured error from the MCP tool. Today
   they silently queue.
4. **Region not in `regionFloor`.** Mock feed accepts arbitrary
   strings and silently returns the 380 floor. Either accept this
   and assert it, or reject and assert the rejection.
5. **`taskId` collision.** Caller-supplied id reused by
   auto-generation, or by a second `enqueue`. Today it silently
   overwrites.
6. **`electricityMapsFeed` fallback paths.** API key missing,
   HTTP 401, HTTP 500, empty `forecast` array, malformed JSON, fetch
   timeout. The `try/catch` is the right shape but is presently
   untested.
7. **Real MCP-protocol smoke test in CI.** The current
   `server.smoke.test.ts` only imports `@ebb-ai/core` and
   instantiates `Scheduler` — it does not test the server. Spawn
   `dist/server.js` in a child process, send `initialize` →
   `tools/list` → `tools/call get_grid_forecast`, assert on
   well-formed `CallToolResult` (this is exactly what I did manually
   to validate this review; it should be in CI). The TS-SDK ships
   an `InMemoryTransport` you can use without spawning a child.
8. **Receipt structure.** No test pins the receipt schema — when
   the Python port lands you'll want the same shape, and a snapshot
   test (or a Zod schema validated against produced receipts) makes
   that easier.
9. **`Scheduler.shutdown()` actually clears outstanding promises.**
   Currently `shutdown()` clears timers but leaves resolvers (and
   bodies) in their maps, and tasks in "scheduled" state. Test it,
   then decide if that's the intended semantics (probably no — pending
   deferred promises should reject with a `SchedulerStopped` error).

## Documentation issues

- **README `region: "us-east"` is not a valid region** (see Critical
  #5). Same problem in `apps/site/index.html`. Same potential problem
  in `packages/core-py/README.md` which proactively documents an API
  that doesn't exist yet.
- **`examples/claude-code/README.md` documents a config path
  (`~/.claude/mcp.json`) that Claude Code does not read** (see
  Critical #3). `/restart` is also not a Claude Code command. Test
  the install flow end-to-end on a fresh machine; rewrite to use
  `claude mcp add ebb-ai -- node /abs/path/dist/server.js` (this is
  the supported install path).
- **`packages/mcp-server/README.md` Claude Desktop path is right**
  on macOS but isn't given for Windows/Linux. ("Linux/Windows have
  similar paths") is hand-wavy. Either give all three or link to the
  Anthropic docs page that lists them.
- **`SKILL.md` Pattern A** describes a polling workflow that requires
  "the agent or a watcher process polls `check_queue_status(task_id)`
  periodically". OpenClaw skill consumers won't have such a watcher;
  the practical UX is "skill returns task_id, user re-asks the agent
  later". Make that explicit.
- **SKILL.md Pattern C** ("audit recent activity → sum
  estimated_carbon_g") only works after a task completes, but in v0.1
  the MCP server never executes the underlying LLM call, so
  `estimated_carbon_g` is the energy of *nothing* (a synthetic
  closure that returns `{prompt, model, dispatched: true}`). The
  receipt is a placeholder. Call this out: "v0.1 receipts measure the
  scheduling overhead, not the real LLM execution; real
  carbon-accounting lands in v0.2 alongside the Batch API adapters".
  Right now, advertising "auditable carbon receipts" overstates v0.1.
- **PLAN.md says `core-py/` ships in week 2 month 2** (v0.2). Root
  README lists it in the Components table without a "(planned)" tag.
  Reconcile.
- **README "Quick start"** prefaces the MCP install with "from this
  repo, after the install step below" — but the install step ("Install
  (development)") is *below* the Quick start. Re-order or
  cross-reference explicitly.
- **`apps/site/README.md` doesn't say where the deployed site
  lives.** Either deploy it (GH Pages is one click for a static
  HTML+CSS), link to the URL from the root README, or mark `apps/site`
  as "not yet deployed" — currently neither the root README nor the
  PLAN tells a reader where to see the site without cloning.

## MCP-protocol correctness

I tested this directly. Spun up `node packages/mcp-server/dist/server.js`,
sent JSON-RPC over stdio:

1. `initialize` with `protocolVersion: "2024-11-05"`, server
   responds with `{protocolVersion: "2024-11-05", capabilities:
   {tools: {}}, serverInfo: {name: "ebb-mcp", version: "0.1.0"}}`.
   Correct.
2. `notifications/initialized` — no response expected, none received.
   Correct.
3. `tools/list` — returns three tools with non-empty descriptions
   and well-formed `inputSchema` objects. Each `inputSchema` is a
   JSON Schema with `type: "object"`, `properties`, and an explicit
   `required` array. Correct.
4. `tools/call get_grid_forecast` with `{region: "US-CAL-CISO",
   hours: 6}` — returns `{content: [{type: "text", text: "Region:
   US-CAL-CISO\nSource: mock\n..."}]}`. Correct shape per
   `CallToolResult`.
5. Error path: unknown tool name returns `{content: [...], isError:
   true}`. Correct.

What's right:
- Three tools, all with description, name, inputSchema.
- `CallToolResult` shape matches the spec.
- `isError: true` set on validation failures and unknown tools.
- stderr logging via `console.error` (so it doesn't pollute the
  stdio protocol stream).
- Capabilities declared as `{tools: {}}`.

What I'd flag:
- **No `listChanged` capability on tools.** v0.1's tools are static,
  so `{tools: {}}` (no `listChanged: true`) is correct. Fine.
- **No `resources` or `prompts` capabilities** — also fine for v0.1.
- **No `tools/call` arg-validation telemetry beyond the catch-all
  `try/catch`.** When zod parsing fails, the agent gets `Error:
  <zod summary>`. The summary is long and not formatted for an LLM.
  Consider returning a structured `{content: [{type: "text", text:
  "Invalid arguments for schedule_task: deadline must be an ISO-8601
  timestamp. You passed: 'not-a-date'."}]}` so the agent can
  self-correct.
- **The `bin` entry on `mcp-server`** declares `ebb-mcp` as a CLI but
  the dist file is not chmod +x (see Important #11).
- **MCP SDK version pin** is `^1.0.4` resolving to 1.29.0. Pin
  tighter (see Important #17).
- **No client-side `mcp.json` snippet in `examples/codex` was tested
  against Codex CLI** because I don't have it installed; trust but
  verify before shipping.

Overall: yes, the server speaks MCP correctly for v0.1 scope. Drop-in
into Claude Desktop will work today; Claude Code requires the
config-path fix in Critical #3.

## Adoption readiness

If I were an early adopter cloning this Monday morning, here's the
order I'd hit walls:

1. **`pnpm install && pnpm build && pnpm test` — works.** Great
   first impression.
2. **README Quick start says "from this repo, after the install step
   below"** — minor stumble.
3. **I copy the Claude Code config from `examples/claude-code/`** —
   wall. Path doesn't exist; tools don't appear. Confusion.
4. **I fall back to Claude Desktop** — works (the config path there
   is correct), tools list, `get_grid_forecast` returns a formatted
   table. Good moment.
5. **I try `schedule_task(prompt: "summarize x", deadline:
   "tomorrow")`** — silently queues with a NaN-deadline; status
   "queued" forever; I never see a receipt. I check
   `check_queue_status`, see "queued: 1", give up.
6. **I read the README sample** — `region: "us-east"`. I pass that.
   Server returns mock data (because EM doesn't know "us-east"); I
   don't notice because mock returns *something* that looks
   plausible. Trust corrodes.

The cumulative impression is "promising, but rough". The single
biggest investment-per-payoff is fixing #2, #3, and #5 in Critical.
After those three, the adoption story is materially better.

Other adoption ergonomics:
- **No published npm package yet.** The README's `pnpm install`
  works from clone, but a `pnpm dlx @ebb-ai/mcp` or `npx -y ebb-mcp`
  story is what gets you Hacker News–level adoption. Block on
  publishing only after #1-5 are fixed.
- **No 60-second demo gif.** The PLAN mentions a 2-minute demo
  video to record privately and publish at v0.1 — do it before HN.
  An animated terminal cast (`asciinema`) of "ask Claude Desktop to
  defer, see forecast, see receipt" goes a long way.
- **README has no badges.** Just CI badge + npm version badge + node
  version is enough — they're the visible-trust signals OSS readers
  scan for before reading prose.
- **No "Why not just X?" section.** Adopters will think of carbon-aware
  SDK, batch APIs, and crontab. PLAN's section 9 (Risk Register R3)
  already articulates the answer; lift two sentences into README.

## Verdict

SHIP AFTER MUST-FIX.

Fix the five Critical items (carbon-budget enforcement or removal,
deadline validation, Claude Code config path, fetch timeout, README
region strings), backfill the missing protocol-smoke test in CI, and
this is genuinely a credible v0.1 worth posting publicly. Without
those fixes, the first 20 readers will form the wrong impression of
the project's quality before they get to the parts that are actually
good.
