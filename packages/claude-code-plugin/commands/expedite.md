---
description: Dispatch a deferred ebb-ai task immediately, bypassing its scheduled window
---

Run a deferred ebb-ai task right now instead of waiting for the cleanest
grid window the scheduler picked. The resulting receipt is tagged
`intensitySource=expedited` so it's clear the dispatch decision was
caller-overridden rather than scheduler-chosen.

Use this when:
- The user changed their mind and wants the result before the deadline.
- An upstream dependency landed early and downstream work is blocked.
- You're debugging a task and want to see it run end-to-end.

Do **not** use this just because the user is impatient — the whole
point of `/ebb-ai:defer` is to defer. If they want sync calls, they
shouldn't have deferred.

## Arguments

`$ARGUMENTS`

Expected: a single `task_id`. If empty, list candidates first via
`check_queue_status` and ask which to expedite.

## What to do

1. Call the `ebb-ai` MCP server's **`expedite_task`** tool with `task_id`.
2. Report the resulting status and any error.
3. If the response surfaces a `result` field, show the user the actual
   LLM response verbatim.
4. Remind the user that this dispatch bypassed the carbon-aware window —
   the receipt's `intensity_source` will read `expedited`.

If the tool fails with "no provider API key set", tell the user that
expedite requires `ANTHROPIC_API_KEY` (or `OPENAI_API_KEY`) in the MCP
server's env config — and that without a key, the only path is to wait
for the `ebb tick` daemon (if configured) to dispatch normally.

## Examples

```
/ebb-ai:expedite 7f3a2b9e
```
