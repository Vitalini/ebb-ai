---
description: Defer a task to the cleanest grid-energy window inside a deadline
---

The user wants to defer the following task to a cleaner-grid window using the
`ebb-ai` MCP server. This is the central UX of the ebb-ai Claude Code plugin —
take a "do it later" request and route it to a real scheduler.

## Arguments

`$ARGUMENTS`

Parse `$ARGUMENTS` into:

- **Prompt** — everything before the first `--` flag, or the whole argument
  string if no flags are present. Required. If empty, ask the user what task
  they want to defer.
- **`--by <duration>`** — deadline. Accepts `2h`, `30m`, `24h`, `3d`, or an
  ISO-8601 timestamp. **Default: 24h from now.** Must resolve to the future.
- **`--budget <grams>`** — optional hard cap on grams CO2-equivalent. If the
  scheduler can't find a window that meets it, the task fails fast with a
  `CarbonBudgetExceededError`.
- **`--region <zone>`** — optional Electricity Maps zone code (e.g.
  `US-CAL-CISO`, `GB`, `FR`). **Default: `US-CAL-CISO`** (heuristic — most
  AWS/GCP US workloads run there). Tell the user the default if you guessed.
- **`--model <name>`** — optional vendor model hint (e.g.
  `claude-sonnet-4-6`). **Required when the deferred task should
  actually dispatch via `ebb tick`** — without a model the dispatcher
  falls back to `claude-sonnet-4-6`.
- **`--output <abs-path>`** — optional absolute file path. When the
  task completes, ebb-ai writes `{ taskId, result, receipt }` as JSON
  to this path. Useful if the user wants the result to land in an
  inbox folder (so `tail -f` or a file-watcher surfaces it) rather
  than polling `/ebb-ai:check` by hand. Recommend
  `~/.ebb-ai/inbox/<task_id>.json` when the user is unsure where to
  put it.
- **`--provider <anthropic|openai>`** — optional. Default `anthropic`.

## What to do

1. Convert `--by` to an absolute ISO-8601 deadline (`now + duration` if a
   duration, otherwise the parsed timestamp). Validate it is in the future.
2. Call the `ebb-ai` MCP server's **`schedule_task`** tool with:
   - `prompt` — the parsed user prompt
   - `deadline` — the ISO-8601 deadline you computed
   - `region` — the parsed or default zone
   - `carbon_budget_g` — the parsed budget, omit if not given
   - `model` — the parsed model hint, omit if not given
   - `output_path` — the parsed `--output` value, omit if not given
   - `provider` — the parsed `--provider` value, omit if not given
   - **Do not pass `dispatch`.** As of v0.7.1 the MCP server defaults
     to persistent provider_call mode, which is what the user wants
     99% of the time.
3. After the tool returns, report back in this exact shape:

   ```
   Deferred ✓
     task id        <task_id>
     scheduled for  <scheduled_for as relative + absolute, e.g. "in 3h, 22:15 UTC">
     est. carbon    <estimated_carbon_g> g CO2e
     savings        <estimated_savings_vs_now_pct>% cleaner than running now
     band           <band>
     batch          <yes/no>  ← only if model was provided
     persisted to   <path-from-tool-response>
     check status   /ebb-ai:check <task_id>
     cancel         /ebb-ai:cancel <task_id>
   ```

   If the tool response mentions `ebb tick`/daemon, surface that warning
   verbatim to the user — they need to know whether the task will
   actually dispatch or just sit in the queue.

4. If `schedule_task` raises `CarbonBudgetExceededError`, do NOT silently fall
   back. Tell the user the budget could not be met, show the cheapest feasible
   window inside the deadline, and ask if they want to relax `--budget` or
   extend `--by`.

5. Do **not** dispatch the task synchronously. The whole point of `/ebb-ai:defer`
   is to hand off to the ebb-ai scheduler. If the user wanted a sync call, they
   would have just made one.

## Examples

```
/ebb-ai:defer summarize today's GitHub notifications --by 4h
/ebb-ai:defer translate the README to Russian --by 24h --budget 0.5 --region GB
/ebb-ai:defer regenerate the test fixtures --by 2026-05-15T08:00:00Z --model claude-haiku-4-5
/ebb-ai:defer overnight log triage --by 8h --region US-MIDA-PJM --output ~/.ebb-ai/inbox/log-triage.json
```

## Related commands

- `/ebb-ai:check [<task_id>]` — list / get status of deferred tasks
- `/ebb-ai:plan <task> --by <when>` — preview window without committing
- `/ebb-ai:cancel <task_id>` — drop a queued/scheduled task
- `/ebb-ai:expedite <task_id>` — run now, bypass the carbon window
- `/ebb-ai:reschedule <task_id> --by <new>` — change the deadline
- `/ebb-ai:retry <task_id>` — re-dispatch a failed task
- `/ebb-ai:grid <zone>` — look at the grid, no task involved
