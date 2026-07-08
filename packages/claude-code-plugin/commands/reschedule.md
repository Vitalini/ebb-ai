---
description: Move an ebb-ai task's deadline forward or backward
---

Re-score and reschedule a queued or scheduled ebb-ai task against a new
deadline. Useful when:
- The user's plans shifted and the work can wait longer (extend) — gives
  the scheduler more window to find a clean hour.
- The user pulled in the deadline (compress) — the task is re-scored;
  if the new window costs more carbon than the budget, the task may
  end up `failed` with `CarbonBudgetExceededError`.

Throws if the task is already running or terminal, or if the new
deadline is invalid / in the past.

## Arguments

`$ARGUMENTS`

Expected format:

```
<task_id> --by <duration-or-iso8601>
```

- `<task_id>` — required.
- `--by <duration>` — accepts `2h`, `24h`, `3d`, or an ISO-8601 timestamp.

Convert duration to absolute ISO-8601 before calling. Validate future.

## What to do

1. Parse `task_id` and the new deadline.
2. Call the `ebb-ai` MCP server's **`update_deadline`** tool with:
   - `task_id`
   - `deadline` — the resolved ISO-8601 timestamp.
3. Show the new `scheduled_for`, `status`, and `new_deadline` from the
   response — one line each. (The response does not carry a carbon
   estimate; if the user wants the re-scored estimate, follow up with
   `/ebb-ai:check <task_id>`.)

If the response indicates carbon budget can no longer be met under the
new deadline, tell the user, and offer two options:
- Drop the `carbon_budget_g` constraint (requires `/ebb-ai:cancel` then
  fresh `/ebb-ai:defer` without budget).
- Pick a different deadline.

## Examples

```
/ebb-ai:reschedule 7f3a2b9e --by 48h
/ebb-ai:reschedule 7f3a2b9e --by 2026-05-16T09:00:00Z
```
