# MCP Spec Proposal — `priority`, `deadline`, and `carbon_budget` request fields

> **Status:** draft for a GitHub issue on
> `modelcontextprotocol/specification`. The intent is to open the
> discussion as an *issue* first, validate maintainer appetite, and
> only then submit a PR with formal spec edits.
>
> **Author:** Vitalii Borovyk (`@Vitalini`)
> **Date drafted:** 2026-05-12
>
> **Canonical design reference:** the paste-ready PR body plus the
> exact schema/spec diff live in
> [`docs/spec/proposal/UPSTREAM-PR.md`](proposal/UPSTREAM-PR.md).
> That document is canonical for the field design — fields placed
> directly in `params`, the budget field named `carbon_budget`
> (grams CO2e), and `priority` typed as an integer `0–9`. This file
> is the discussion lead-in; where the two ever diverge,
> `UPSTREAM-PR.md` wins.

---

## Title for the GitHub issue

`Proposal: optional priority, deadline, and carbon_budget request fields for deferrable MCP tool calls`

---

## Body (paste into the issue)

### Motivation

Today every MCP tool call is treated as synchronous and "now."
That's the right default for the original use case (interactive
agents). It is not the right default for the growing class of
**deferrable** agent workloads — overnight digests, batch
summaries, scheduled research sweeps, anything where the agent has
real wall-clock latency tolerance.

When deferral is available — and it is, via the Anthropic Message
Batches API, the OpenAI Batches API, Google Gemini Batch, plus
carbon-aware schedulers like `ebb-ai` — there is no protocol-level
way for the *caller* to express the relevant constraints:

- *How soon do I need this?* (priority / deadline)
- *What's my upper bound on the externalities I'll accept for this
  task?* (carbon budget, dollar budget, latency budget)

So clients today either:

1. Always run synchronously (the safe but wasteful default), or
2. Use provider-specific batch APIs by rewriting their call sites
   to a different SDK surface, losing protocol portability, or
3. Wrap MCP in a private "deferral" extension that is not
   interoperable across MCP hosts.

A protocol-level expression of priority / deadline / budget would
unify these paths without breaking the synchronous default.

### Proposal

Add three **optional** fields directly to the MCP `tools/call`
request's `params` object, alongside `name` and `arguments` —
*not* nested inside `arguments` (which is tool-specific) and *not*
inside `_meta` (which is infrastructure-level transport metadata).
Scheduling intent is call semantics: what the caller wants the
server to *do* with the call.

```jsonc
{
  "jsonrpc": "2.0",
  "id": 42,
  "method": "tools/call",
  "params": {
    "name": "summarize_corpus",
    "arguments": { /* tool-specific input */ },
    "priority": 2,                       // integer 0–9; 0 = best-effort, 5 = normal (default), 9 = critical
    "deadline": "2026-05-13T08:00:00-04:00",
    "carbon_budget": 5
  }
}
```

Servers that ignore these fields continue to work — they treat
every call as synchronous and immediate (no deferral budget, the
behaviour you'd get at the top of the priority range). Servers
that support them gain a clean way to:

- Queue, batch, or defer the call.
- Reject the call at the boundary if no satisfiable window exists.
- Return a carbon / cost receipt on the eventual `CallToolResult`.

### Semantics

- **`priority`**: integer `0–9`. `0` = best-effort / lowest-cost /
  latest-acceptable dispatch; `5` = normal (the default if
  omitted); `9` = critical / dispatch immediately regardless of
  cost. Higher is more urgent. Servers MAY honour this; servers
  that do not understand it MUST ignore it.
- **`deadline`**: RFC 3339 timestamp by which the response must be
  available. Servers that cannot guarantee the deadline either
  reject the call at the boundary or return a structured
  `deadline_unmeetable` error in `CallToolResult.isError`.
- **`carbon_budget`**: positive number in grams CO2-equivalent.
  If no dispatch window inside the deadline keeps the call under
  the budget, the server MUST fail the call with a structured error
  (`code: -32000`, `message: "carbon budget cannot be met inside
  deadline"`) rather than silently dispatching to a dirtier window.
  Hosts that do not measure carbon SHOULD ignore the field cleanly.

### Backward compatibility

Adding optional fields is non-breaking. Existing clients that don't
send them are unaffected. Existing servers that don't read them are
unaffected. Hosts that *want* the behavior opt in by reading the
fields and implementing the queueing semantics; nobody else has to
do anything.

### Alternatives considered

1. **Tool-author convention.** Each tool author could define their
   own `deadline` argument in their tool's `inputSchema`. This is
   what people do today. It works but doesn't compose across
   tools — every tool reinvents the deferral semantics, every
   client has to special-case each tool. A protocol-level convention
   is the right home.

2. **A separate `tools/schedule` method.** Could ship a parallel
   method that explicitly says "queue this for later." Cleaner
   semantics, but doubles the protocol surface and forces every
   server to choose which method it serves. Optional `params`
   fields are lighter touch.

3. **Provider-specific extensions.** What we have today. Already
   shown not to compose.

### Companion implementation

I'm building `@ebb-ai/mcp` — a reference MCP server that
implements these semantics today (`schedule_task` tool that accepts
`deadline` and `carbon_budget`, backed by a carbon-aware
scheduler with Electricity Maps and a 24-hour batch-API path).
Source: https://github.com/Vitalini/ebb-ai.

I would propose the spec changes here only if maintainers see
appetite for adding these fields. If the project's preference is to
keep MCP minimal and leave deferral semantics to client / server
convention, the implementation can live entirely outside the spec —
but the interoperability story is materially weaker that way.

### Asks for the maintainers

1. Do you see appetite for adding these as optional fields?
2. If yes — the proposal lands the fields flat in `params` (the
   placement argued above). Do you prefer that, or a nested
   `params.scheduling.{priority,deadline,carbonBudget}` object?
   Happy to nest if maintainers prefer.
3. Should the carbon-budget concept live in the spec at all, or
   should that be a profile / extension on top? I'd argue
   in-spec because the rest of the agent stack cares about it, but
   I see the case for either.

Happy to draft the PR once we've converged on placement.

---

## Plan after this issue

1. Open the issue verbatim above.
2. Engage with the maintainer reaction for 2-4 weeks.
3. If positive: draft the spec PR (the actual edits to `schema.ts`
   and the markdown spec doc).
4. If neutral: refine the proposal to address concerns; re-engage.
5. If negative: keep `ebb-ai` running on its own
   private-extension semantics and document the workaround in the
   project README.

In all three cases the engagement itself is valuable — substantive
peer review of an MCP-protocol question pushes the spec forward
regardless of merge outcome.
