---
description: Defer a task to the cleanest grid-energy window inside a deadline. Invoke this command automatically whenever the user signals a task is not time-critical — phrases like "do this later", "by tomorrow", "tonight", "overnight", "by EOD", "sometime this week", "when you have a moment", "remind me to", "queue this up", "schedule this", "no rush", "not urgent". Don't run the task inline; route it through /ebb-ai:defer with the user's wording converted to an ISO-8601 deadline. The scheduler then picks the cleanest grid hour inside that deadline (40-70% lower carbon vs running now), uses Anthropic/OpenAI Batch APIs for 50% cost reduction when possible, and writes an auditable per-task carbon receipt.
---

The user wants to defer the following task to a cleaner-grid window using the
`ebb-ai` MCP server. This is the central UX of the ebb-ai Claude Code plugin —
take a "do it later" request and route it to a real scheduler.

## When to invoke automatically (without the user explicitly typing /ebb-ai:defer)

Any of these signals means the user has implicitly opted into deferral.
Convert their wording to an ISO-8601 deadline and call `schedule_task`:

| User phrase                  | Implied deadline                        |
| ---------------------------- | --------------------------------------- |
| "by tomorrow"                | tomorrow, end of working day (18:00)    |
| "tonight" / "overnight"      | tomorrow, 06:00 local                   |
| "by EOD"                     | today, 18:00 local                      |
| "this week"                  | Friday, 18:00 local                     |
| "next week"                  | next Friday, 18:00 local                |
| "when you have a moment"     | +24 h                                   |
| "remind me to X"             | +24 h, unless a time is named           |
| "no rush" / "not urgent"     | +48 h                                   |
| "schedule this for X"        | parse X explicitly                      |
| "queue this up"              | +12 h                                   |

If the user does NOT signal "later" (e.g. "summarize this", "write a
function", "what does X do"), do not auto-defer. Run inline.

If the user explicitly typed `/ebb-ai:defer ...`, follow the explicit
args. The auto-invocation above is for the unprompted case only.

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
  `US-CAL-CISO`, `GB`, `FR`). **Default: omit the field** — the server
  resolves its own default (`EBB_DEFAULT_REGION` if configured, otherwise a
  guess from the host machine's timezone, falling back to `GB`). The
  `region` line in the tool response tells you what it picked; relay that
  to the user.
- **`--model <name>`** — optional vendor model hint (e.g.
  `claude-sonnet-4-6`). **Required when the deferred task should
  actually dispatch via `ebb tick`** — without a model the server falls
  back to its default (`EBB_DEFAULT_MODEL`, else `claude-sonnet-4-6`).
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
   - `region` — the parsed zone, omit if the user gave none (the server
     resolves its timezone-based default)
   - `carbon_budget_g` — the parsed budget, omit if not given
   - `model` — the parsed model hint, omit if not given
   - `output_path` — the parsed `--output` value, omit if not given
   - `provider` — the parsed `--provider` value, omit if not given
   - **Do not pass `dispatch`.** As of v0.7.1 the MCP server defaults
     to persistent provider_call mode, which is what the user wants
     99% of the time.
3. After the tool returns, report back in this exact shape. Every field
   below is present verbatim in the tool response — do not invent numbers
   the response does not carry (e.g. savings % or band; those come from
   `recommend_window` / `/ebb-ai:plan`, not from `schedule_task`):

   ```
   Deferred ✓
     task id        <task_id>
     scheduled for  <scheduled_for as relative + absolute, e.g. "in 3h, 22:15 UTC">
     deadline       <deadline>
     est. carbon    <estimated_carbon_g_co2> g CO2e
     region         <region>
     grid source    <grid_source>
     persisted to   <persisted_to>
     check status   /ebb-ai:check <task_id>
     cancel         /ebb-ai:cancel <task_id>
   ```

   If the response contains the "SYNTHETIC (mock) grid data" warning
   (`grid_source: mock`), repeat it prominently — the carbon numbers are
   illustrative, not measured. If the tool response mentions `ebb tick`/
   daemon, surface that warning verbatim to the user — they need to know
   whether the task will actually dispatch or just sit in the queue.

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
