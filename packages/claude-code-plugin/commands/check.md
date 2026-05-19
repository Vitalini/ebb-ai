---
description: Check status of deferred ebb-ai tasks
---

Check the status of one or all ebb-ai deferred tasks.

## Arguments

`$ARGUMENTS`

- If `$ARGUMENTS` looks like a single task id (alphanumeric, dash, underscore
  only), check that one specific task.
- If `$ARGUMENTS` is empty, list every pending and recently-completed task.
- If `$ARGUMENTS` is `--all` or `all`, also include completed tasks older than
  the default cutoff.

## What to do

1. Call the `ebb-ai` MCP server's **`check_queue_status`** tool with:
   - `task_id` — the parsed id, omit for the list view.
2. Render the result as a compact table — never raw JSON. For each task:
   - `id` (last 8 chars suffice)
   - `status` — `queued`, `scheduled`, `running`, `completed`, `failed`,
     `cancelled`
   - `scheduled_for` — relative time ("in 2h", "yesterday 14:30")
   - `region`
   - For `completed` tasks: append the **carbon receipt**:
     - `estimated_carbon_g` (what the scheduler projected)
     - `actual_carbon_g` (what was billed against the actual grid intensity
       at dispatch time, if present)
     - `delta` — `+X%` or `-X%` actual vs estimated
   - For `failed`: short error reason.
3. If exactly one task is requested and it has a `result` field (the LLM
   response), include the result verbatim under the table.
4. End with a short hint line:
   - If anything is `queued` or `scheduled`: "Next dispatch tick: ~5 min."
   - If everything is `completed`: nothing.

## Examples

```
/ebb-ai:check
/ebb-ai:check abc123de
/ebb-ai:check --all
```
