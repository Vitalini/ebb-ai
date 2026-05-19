---
description: Preview the optimal carbon-aware window for a task — without committing
---

Show the scheduler's recommended execution window for a task without
actually queueing anything. Useful when the user wants to see "when
*would* this run, and how much carbon would it save?" before deciding
whether to commit via `/ebb-ai:defer`.

`recommend_window` is the planning twin of `schedule_task`. Same
math, no side effects.

## Arguments

`$ARGUMENTS`

Expected format:

```
[task description] --by <duration-or-iso> [--region <zone>] [--budget <g>] [--model <name>]
```

- **Task description** — informational only; not used in the math but
  helpful for echoing back the recommendation in human terms.
- **`--by <duration>`** — required. Same parsing rules as
  `/ebb-ai:defer`. Default if missing: 24h.
- **`--region <zone>`** — Electricity Maps zone code. **Required by
  this tool** — `recommend_window` is intentionally explicit. Default:
  `US-CAL-CISO`.
- **`--budget <grams>`** — optional grams CO2-equivalent cap. Windows
  above the budget are dropped before selection.
- **`--model <name>`** — optional; affects only the `reasoning` string
  (whether Batch API would apply).

## What to do

1. Convert `--by` to an absolute ISO-8601 deadline.
2. Call the `ebb-ai` MCP server's **`recommend_window`** tool with:
   - `deadline`
   - `region`
   - `carbon_budget_g` (if given)
   - `model` (if given)
3. Render the JSON response as a readable plan:

   ```
   Plan (not committed)
     scheduled_for   <time, in <Xh>, <band>>
     est. carbon     <g> g CO2e
     savings         <X>% vs running now
     batch eligible  <yes/no>
     reasoning       <one-line>
   
   Top alternatives:
     1. <time>  <g>g  <savings>%
     2. <time>  <g>g  <savings>%
     3. <time>  <g>g  <savings>%
   ```

4. End with a single-line offer:
   "Run `/ebb-ai:defer "<echoed task>" --by <duration> --region <zone>`
   to actually queue this."

5. If `recommend_window` raises `CarbonBudgetExceededError`, tell the
   user the budget can't be met and suggest extending the deadline or
   raising the budget.

## Examples

```
/ebb-ai:plan summarize this week's GitHub notifications --by 12h --region GB
/ebb-ai:plan translate the README --by 24h --budget 0.5 --region FR
```
