# Upstream PR — `priority`, `deadline`, and `carbon_budget` request fields

> **Target repository:** [`modelcontextprotocol/specification`](https://github.com/modelcontextprotocol/specification)
> **Pull request type:** spec-edit + schema patch
> **Status:** ready to file. The companion discussion-style **issue** lives at `docs/spec/01-priority-and-deadline-fields.md`. Open that issue first, gauge maintainer reaction, then file this PR on top of the merged-issue thread.
> **Author:** Vitalii Borovyk (`@Vitalini`)

This file is the **paste-ready PR body** plus the precise diff against the spec. Two artefacts:

1. **§ A — PR body markdown** (copy this verbatim into the PR description).
2. **§ B — Schema + spec diff** (use these as the actual code edits in the PR).

---

## § A — Pull-request body (copy-paste)

### Summary

Adds three optional request-level fields — `priority`, `deadline`, and `carbon_budget` — to the Model Context Protocol so that **deferrable** agent workloads can be expressed in-spec rather than via provider-specific extensions. None of the three is required. Existing servers and clients continue to work unchanged.

### Motivation

MCP today treats every tool call as synchronous and immediate. That's the right default for interactive agents, but it does not compose for the growing class of *deferrable* workloads — overnight digests, batch summaries, scheduled research sweeps, anything where the agent has real wall-clock latency tolerance.

When deferral is available (Anthropic Message Batches API, OpenAI Batch API, AWS Bedrock async invoke, vendor-specific cron-style triggers in OpenClaw, etc.), there is no way to communicate "this call may run any time before *t*, and I'd like it cheaper if possible" through a single MCP request. Today the alternatives are:

- **Provider-specific extensions** carried in `arguments` or `_meta`. Doesn't compose across hosts.
- **Out-of-band scheduling layers** that wrap MCP without speaking it. Loses the protocol's interop benefit.

This proposal adds the smallest viable surface to fix that: three optional fields, all already present in working server implementations (`@ebb-ai/mcp`, see § Companion implementation below).

### Specification changes

#### `params.priority` *(optional, integer 0–9)*

Caller's hint at relative importance. `0` = best-effort / lowest cost / latest acceptable dispatch. `9` = critical / dispatch immediately even at full cost. `5` (default if omitted) = normal. Servers MAY honour this. Servers that do not understand the field MUST ignore it.

#### `params.deadline` *(optional, RFC 3339 timestamp)*

The absolute wall-clock time by which the response must have been returned. Servers MAY use this to defer dispatch to a cheaper / cleaner / less-loaded window inside the deadline. Servers that do not understand the field MUST ignore it and dispatch synchronously.

If `deadline` is in the past or fewer than thirty seconds in the future, the server SHOULD treat it as a synchronous request (no deferral budget available) and ignore the field for scheduling purposes.

#### `params.carbon_budget` *(optional, number)*

Maximum acceptable grams of CO2-equivalent emissions the caller is willing to spend on this call. Servers MAY use this as a hard cap when scheduling against carbon-intensity forecasts: if no available dispatch window inside the deadline meets the budget, the server MUST fail the call with a structured error (`code: -32000`, `message: "carbon budget cannot be met inside deadline"`) rather than silently dispatching to a dirtier window.

The grams-of-CO2e methodology is left to the server (e.g., marginal-emissions per WattTime, average-emissions per Electricity Maps). Implementations SHOULD document which methodology they use.

### Field placement

The three fields go in **`params`** alongside `name` and `arguments`, *not* inside `arguments` and *not* inside `_meta`. Rationale:

- They are *transport-level* metadata that any compliant host/server should be able to act on without understanding the tool's domain-specific schema (which is what `arguments` is for).
- `_meta` per JSON-RPC convention is for *infrastructure* metadata not tied to the call semantics (trace IDs, tenant tokens, etc.). Scheduling intent is call semantics — what the caller wants the server to *do*.

### Backward compatibility

100 % backward-compatible:

- All three fields are optional. Existing requests are valid unchanged.
- Servers that don't recognise the fields ignore them per JSON-RPC §5 ("unknown member names SHOULD be ignored"). Existing servers continue to work.
- Clients that don't emit the fields get the existing synchronous behaviour.
- A client that emits `priority` to a server that ignores it gets the existing synchronous behaviour. No error.
- The only observable change is for explicit opt-in: when *both* client and server understand the fields, the request can be deferred.

### Forward compatibility (future spec extensions enabled)

This proposal is the minimum viable surface. Two natural extensions become possible once it lands:

- **`params.scheduled_for` response field.** Server tells the client which window it picked inside the deadline. Not in this PR.
- **`tools/list` schema.** A boolean `defers: true` on a tool advertises that the server respects `deadline` for that specific tool. Useful for clients deciding whether to offer the user a "schedule for later" UI affordance. Not in this PR.

Including these would balloon the PR; both can be added incrementally once the three core fields land.

### Companion implementation

A reference server implementing the proposed fields ships today: [`@ebb-ai/mcp@0.11.0`](https://www.npmjs.com/package/@ebb-ai/mcp) (Apache-2.0). It exposes a `schedule_task` tool that accepts `deadline` and `carbon_budget_g`, backed by a multi-source grid feed (UK Carbon Intensity, EIA, ENTSO-E, Electricity Maps; 31 zones across NA / EU / APAC), per-model energy coefficients (Patterson 2021, Luccioni 2024, HF AI Energy Score), Ed25519-signed receipts (`ebb verify`), and a WAL-enabled persistent SQLite queue (`~/.ebb-ai/queue.db`). Source: <https://github.com/Vitalini/ebb-ai>.

The server has 325 passing automated tests (213 TS + 112 Python), including an even-distribution simulation (10,000 synthetic deferred tasks across the grid regions) that empirically verifies the scheduler does *not* create a new peak at the global cleanest hour — the chosen-hour distribution sits at ~11 % maximum concentration with randomised tie-break + per-region phase, well below the 24-bucket uniform floor of 4.2 %.

The fields proposed here are exactly the fields `@ebb-ai/mcp` already accepts; merging this proposal would make `@ebb-ai/mcp` a conforming implementation of the standard rather than a provider-specific extension.

### Out of scope

- Carbon-accounting methodology. Left to implementing servers.
- Cancellation / status / receipt-retrieval flows for deferred work. These exist in the reference implementation as separate tools (`cancel_task`, `check_queue_status`, `expedite_task`, `update_deadline`, `retry_task`). If maintainers want any of these elevated to spec-level methods, a follow-up PR is appropriate.
- Priority semantics across multiple tenants. Out of scope for this protocol-level change; an implementation concern for hosts that multiplex many clients.

### Testing strategy

The reference implementation's test suite covers all three fields:

- Unit tests for `priority` weight in scheduler scoring (`packages/core-ts/test/scheduler.test.ts`).
- Unit tests for `deadline` filtering and `carbon_budget` hard-cap (`packages/core-ts/test/recommend.test.ts`).
- Protocol-shape contract tests against the MCP TypeScript SDK (`packages/mcp-server/test/server.protocol.test.ts`).
- End-to-end CLI invocation tests (`packages/cli/test/*`).
- Python parity port (`packages/core-py/tests/*`).

If maintainers want a spec-level conformance test added to `modelcontextprotocol/conformance` (or the equivalent), I can contribute one.

### Asks for the maintainers

1. Approval for the field-placement decision (`params` directly, not `arguments` or `_meta`).
2. Approval for naming (`priority`, `deadline`, `carbon_budget` — happy to bikeshed to `scheduling.{priority,deadline,carbonBudget}` if a nested object is preferred).
3. Approval for the carbon-budget error code (`-32000`) or a different code from the user-defined range.

I'm available for review iteration. Reference implementation is shippable today; if this lands, I will update `@ebb-ai/mcp` to consume the new field names from the spec verbatim (rename `carbon_budget_g` → `carbon_budget` per the spec).

---

## § B — Schema + spec diff

> The MCP specification's authoritative TypeScript schema lives at `schema/2025-03-26/schema.ts` (or whatever the current dated directory is at time of filing). Markdown reference at `docs/specification/server/tools.md`. Both need touching.

### B.1 `schema.ts` patch (illustrative)

```typescript
// In CallToolRequestParams, alongside `name` and `arguments`:

export interface CallToolRequestParams {
  /** Name of the tool to invoke. */
  name: string;
  /** Arguments for the tool, conforming to the tool's `inputSchema`. */
  arguments?: { [key: string]: unknown };

  /**
   * Optional. Caller's hint at relative importance, integer 0–9.
   *   0 = best-effort / lowest-cost / latest-acceptable dispatch.
   *   5 = normal (default).
   *   9 = critical / dispatch immediately regardless of cost.
   * Servers MAY honour this. Servers that do not understand the
   * field MUST ignore it.
   */
  priority?: number;

  /**
   * Optional. Absolute wall-clock time by which the response must
   * have been returned, as an RFC 3339 timestamp. Servers MAY use
   * this to defer dispatch to a cheaper / cleaner / less-loaded
   * window inside the deadline. Servers that do not understand the
   * field MUST ignore it and dispatch synchronously.
   *
   * If deadline is in the past or fewer than thirty seconds in the
   * future, the server SHOULD treat it as a synchronous request.
   */
  deadline?: string;

  /**
   * Optional. Maximum acceptable grams of CO2-equivalent emissions
   * the caller is willing to spend on this call. Servers MAY use
   * this as a hard cap when scheduling against carbon-intensity
   * forecasts; if no window inside the deadline meets the budget,
   * the server MUST fail with `code: -32000, message: "carbon
   * budget cannot be met inside deadline"` rather than dispatching
   * to a dirtier window. Methodology (marginal vs. average
   * emissions) is implementation-defined and SHOULD be documented.
   */
  carbon_budget?: number;
}
```

### B.2 `docs/specification/server/tools.md` patch (illustrative)

Add a new subsection after the "Calling Tools" section:

```markdown
### Optional scheduling and budget metadata

A client MAY include any of the following optional fields on a
`tools/call` request to communicate scheduling and budget intent to
servers that understand them:

| Field | Type | Range | Default | Semantics |
|---|---|---|---|---|
| `priority` | integer | 0–9 | 5 | Relative importance hint. 0 = best-effort; 9 = critical. |
| `deadline` | string (RFC 3339) | future | (none) | Absolute wall-clock time by which the response must have returned. |
| `carbon_budget` | number | ≥ 0 | (none) | Maximum grams of CO2-equivalent the caller is willing to spend. |

Servers that do not understand these fields MUST ignore them per
JSON-RPC §5. Servers that do understand them MAY use them to defer
dispatch (e.g., through a provider Batch API, a carbon-aware
scheduler, or a multi-tenant priority queue) so long as the
response is returned no later than the deadline.

If a server cannot meet `carbon_budget` inside `deadline`, it MUST
fail the call with `code: -32000, message: "carbon budget cannot
be met inside deadline"` rather than silently dispatching to a
window that exceeds the budget.

A reference implementation honouring all three fields is available
at [`@ebb-ai/mcp`](https://www.npmjs.com/package/@ebb-ai/mcp).
```

### B.3 Changelog entry

Add to the spec changelog file (whatever it is at time of filing):

```markdown
- Added optional `priority`, `deadline`, and `carbon_budget` request
  fields to `tools/call`. Servers MAY use these to defer dispatch
  to a cheaper / cleaner / less-loaded window inside the deadline.
  Backward compatible; servers that don't understand the fields
  ignore them per JSON-RPC §5. (#TBD)
```

---

## § C — Filing checklist

Before opening the PR:

- [ ] Confirm the spec repo's current schema directory (`schema/2025-03-26/` or newer). Update file paths in B.1 / B.2 accordingly.
- [ ] Sign the maintainers' CLA if one is required.
- [ ] Open the discussion-style **issue** first (`docs/spec/01-priority-and-deadline-fields.md`). Wait 1–2 weeks for maintainer signal.
- [ ] If positive: open this PR, link the issue in the PR description.
- [ ] If maintainers prefer nested `scheduling.*` placement, restructure B.1 / B.2 before filing.
- [ ] Subscribe to PR notifications. Be ready for iteration.

When opening:

- [ ] PR title: `Add optional priority / deadline / carbon_budget request fields to tools/call`
- [ ] Branch: `vitalini/scheduling-fields`
- [ ] Labels: `enhancement`, `spec`

After merging:

- [ ] Bump `@ebb-ai/mcp` to consume the new field names verbatim. Rename `carbon_budget_g` → `carbon_budget` per the spec.
- [ ] Publish a new `@ebb-ai/mcp` minor (current: 0.11.0) as a conforming implementation.
- [ ] Update the project's spec-engagement log with the merged PR URL.
