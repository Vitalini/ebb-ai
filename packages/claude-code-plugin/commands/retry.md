---
description: Re-dispatch a failed ebb-ai task
---

Re-dispatch a deferred ebb-ai task that previously failed. Only valid
when the task's current status is `failed`. A new receipt overwrites
the old.

Common failure causes worth checking before retry:
- Provider returned a transient error (529 overloaded, 5xx) — retry
  almost certainly works.
- `CarbonBudgetExceededError` — the budget couldn't be met in the
  remaining window. Retry alone won't help; you need
  `/ebb-ai:reschedule <id> --by <new>` to extend the deadline first.
- Auth error (401 / 403) — provider key is wrong or expired. Fix the
  key, then retry.

## Arguments

`$ARGUMENTS`

Expected: a single `task_id`. If empty, list failed tasks via
`check_queue_status` filtering to `status=failed`, then ask which to
retry.

## What to do

1. Call the `ebb-ai` MCP server's **`retry_task`** tool with `task_id`.
2. Show the resulting status. If status is again `failed`, surface the
   error string verbatim and propose a likely cause from the list above.

## Examples

```
/ebb-ai:retry 7f3a2b9e
```
