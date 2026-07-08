---
description: Check status of deferred ebb-ai tasks
---

Check the status of one or all ebb-ai deferred tasks.

## Arguments

`$ARGUMENTS`

- If `$ARGUMENTS` looks like a single task id (alphanumeric, dash, underscore
  only), check that one specific task.
- If `$ARGUMENTS` is empty, list every known task — the summary always
  includes queued, scheduled, running, completed, failed and cancelled
  tasks (there is no age cutoff), including tasks persisted by previous
  sessions.
- `--all` / `all` is accepted for compatibility and behaves the same as an
  empty argument.

## What to do

1. Call the `ebb-ai` MCP server's **`check_queue_status`** tool with:
   - `task_id` — the parsed id, omit for the list view.
2. Render the result as a compact table — never raw JSON. For each task:
   - `id` (last 8 chars suffice)
   - `status` — `queued`, `scheduled`, `running`, `completed`, `failed`,
     `cancelled`
   - `scheduled_for` — relative time ("in 2h", "yesterday 14:30")
   - `region`
   - For `completed` tasks: append the **carbon receipt** (fields as they
     appear in the response, when present):
     - `estimated_carbon_g` (what the scheduler projected)
     - `actual_carbon_g` (what was billed against the actual grid intensity
       at dispatch time, if present)
     - `delta_pct` — `+X%` or `-X%` actual vs estimated
     - `grid_source` — which feed produced the intensity. If it is `mock`
       the response says so explicitly ("SYNTHETIC (mock) grid data") —
       repeat that caveat instead of presenting the grams as measured.
     - `energy_source` — confidence tier of the per-model energy
       coefficients (`measured` / `estimated` / `fallback`)
   - For `failed`: short error reason.
3. If exactly one task is requested and the response carries a `Result:`
   block (the LLM response), include it verbatim under the table.
4. End with a short hint line:
   - If anything is `queued` or `scheduled`: "Next dispatch tick: ~5 min
     (if the `ebb tick` daemon is installed — otherwise run
     `ebb tick --once`)."
   - If everything is `completed`: nothing.

## Examples

```
/ebb-ai:check
/ebb-ai:check abc123de
/ebb-ai:check --all
```
