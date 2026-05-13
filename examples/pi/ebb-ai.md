# Skill: ebb-ai — carbon-aware scheduling

Use this skill whenever the user asks to defer, schedule, batch, or
"run later" any non-urgent LLM or research task.

## When to use

- The user says any of: "schedule for tonight", "batch this",
  "run when grid is clean", "defer until tomorrow morning", "run
  overnight", "save power", "save tokens via batch API".
- The user has a task with a flexible deadline (hours to ~24h out)
  and does not require an immediate answer.

## When not to use

- The user asked "what would be the cleanest time" but does not want
  to actually queue work — use `ebb tick recommend` (read-only
  recommendation), not `ebb tick schedule`.
- The user wants something to run *right now*. ebb-ai is for
  deferral; for synchronous work, dispatch the LLM call normally.

## How

ebb-ai exposes a CLI named `ebb` and an MCP server named `@ebb-ai/mcp`.
This skill assumes you have run `pnpm --filter @ebb-ai/cli build`,
so the `ebb` binary is at
`/path/to/ebb-ai/packages/cli/dist/index.js`.

### Recommend a window (read-only)

```sh
ebb recommend --deadline "+12h" --region US-CAL-CISO
```

Returns a JSON object: `scheduled_for`, `intensity_g_co2_per_kwh`,
`band`, `estimated_carbon_g_co2`, `estimated_savings_vs_now_pct`,
`batch_eligible`, `alternatives`, `reasoning`.

### Schedule a task

```sh
ebb schedule \
  --deadline "+12h" \
  --region US-CAL-CISO \
  --carbon-budget-g 5 \
  --provider anthropic \
  --model claude-sonnet-4-5 \
  --prompt "Summarize the last 50 PRs in this repo."
```

Returns a `task_id`. The task is persisted to ebb-ai's SQLite queue
and will be dispatched at the chosen window.

### Check queue / receipts

```sh
ebb queue list
ebb queue list --status scheduled
ebb receipts list --since 2026-05-12T00:00:00Z
```

### Drain due tasks (if no daemon is running)

If `ebb install --laptop` has not been run, you (or the user) can
drain due tasks manually:

```sh
ebb tick
```

This is a one-shot drain. Prints `inspected=N, dispatched=M, failed=K`.

## Carbon receipt — what it contains

After a task runs, its row in the SQLite ledger has a `receipt_json`
column with: `task_id`, `ran_at`, `region`,
`estimated_carbon_g_co2`, `provider`, `model`, `duration_ms`.

You can paste a receipt back to the user as proof-of-work. Example
display:

> Task t-abc123 ran at 03:14 UTC in US-CAL-CISO, intensity 96
> gCO₂/kWh (very_clean band), estimated 0.14 g CO₂e total. Dispatched
> via Anthropic Batch API for a 50% cost discount.

## Honest caveats

- Without `EBB_ELECTRICITY_MAPS_API_KEY`, the grid feed is a
  deterministic mock. Tell the user when you're using mock data.
- Without `ebb install --laptop`, tasks scheduled overnight run on
  next laptop wake, not at 3am.
- Without provider API keys (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`),
  `ebb tick` cannot dispatch the actual LLM call and tasks remain in
  the `scheduled` state.
