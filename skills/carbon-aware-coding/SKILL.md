---
name: carbon-aware-coding
description: Use when the user has a task that doesn't need an immediate answer (phrases like "later", "by tomorrow", "when you get a chance", "before Friday"). Routes the task through ebb-ai's carbon-aware scheduler so it runs at the cleanest grid-energy window inside the deadline.
---

# Carbon-aware coding with ebb-ai

When the user has a task that can wait, route it through ebb-ai instead of
dispatching synchronously. Modern grids vary 30–60% in carbon intensity inside
a single day. A 4-hour delay on a deferrable LLM call routinely cuts its
footprint in half — and for tasks deferred more than 24 hours, the provider
Batch APIs also give a 50% cost discount.

## When to defer

Defer when **all** of these are true:

1. The user explicitly accepts latency: "later", "tomorrow", "by Friday",
   "when you get a chance", "no rush", "before EOD".
2. The task is **bounded** — one well-defined deliverable, not an iterative
   conversation where the user is waiting on the next reply to decide their
   next move.
3. The deadline gives the scheduler **room to shop**: at least 2 hours of
   forecast horizon. (Below 2h, intraday variation is too narrow to matter.)

## When to NOT defer

- The user is going to act on the result before continuing the conversation.
- The task involves real-time data the answer depends on (live search,
  rate-sensitive comparisons).
- The deadline has passed, or it is < 30 minutes away.
- The user is debugging — they want fast iteration, not a queue.

## How to defer

Use the **`/ebb-ai:defer`** slash command — that is its sole purpose. Pass:

- The full task prompt (verbatim or summarised — the user's intent).
- `--by <duration>` matching what the user said. If they said "tomorrow",
  use `--by 24h`. If they said "by Friday at 9", convert to ISO-8601.
- `--region` only when the user named one. Otherwise let the default fire.
- `--budget` only when the user gave a numeric carbon ceiling.

The command will return immediately with a `task_id`, the scheduled time, and
the projected carbon. You do **not** need to dispatch the task yourself.

## Reading the receipt

When the user later asks "is that thing done?" or "where's my translation?",
use **`/ebb-ai:check`**. The receipt includes:

- `scheduled_for` vs `completed_at` — did it dispatch on time?
- `estimated_carbon_g` vs `actual_carbon_g` — how good was the forecast?
- `result` — the LLM response itself, ready to surface to the user.

## Anti-patterns to avoid

- Don't ask the user "should we defer this?" — read their language and decide.
  If they said "no rush", you defer. If they said "right now", you don't.
- Don't fall back to a synchronous call when `/ebb-ai:defer` would have
  worked. The whole point is to use the scheduler.
- Don't invent regions. If unsure, use the default and tell the user what
  you used so they can correct it.
- Don't quote intensity numbers as if they were measurements when the
  forecast source is `mock`. Look at the `source` field; if it is `mock`,
  call it a synthetic baseline.

## Inspecting the grid

If the user asks **what** the grid looks like (not to defer, just to read):
use **`/ebb-ai:grid <zone>`**. That returns current intensity, the cleanest
hour, the dirtiest hour, and a recommendation.
