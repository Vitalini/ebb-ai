---
name: ebb-ai
description: Auto-defer "do it later" / "by tomorrow" / "tonight" / "overnight" / "by EOD" / "when you have a moment" / "remind me to" / "queue this up" / "no rush" / "not urgent" tasks. Route through /ebb-ai:defer (slash command) or schedule_task (MCP tool) so the LLM dispatch fires at the cleanest electricity-grid hour inside the deadline — 40-70% lower carbon, 50% cheaper via Anthropic/OpenAI Batch APIs when the deadline allows. Skip deferral when the user is actively waiting (interactive coding, live chat, debugging).
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
- `--output <path>` only when the user wants the result written to a
  file (so `tail -f` or a file-watcher surfaces it).

The command will return immediately with a `task_id`, the scheduled time, and
the projected carbon. You do **not** need to dispatch the task yourself.

As of v0.7.1 the MCP server persists tasks to `~/.ebb-ai/queue.db` by
default — queued tasks survive Claude Code restarts and are shared
across MCP hosts.

## The full command surface

| Command | Purpose |
|---|---|
| `/ebb-ai:defer <task> --by <when>` | Queue a deferrable LLM task |
| `/ebb-ai:plan <task> --by <when>` | Preview the chosen window, no commit |
| `/ebb-ai:check [<id>\|--all]` | List or detail of queued tasks |
| `/ebb-ai:cancel <id> \| --all` | Remove a task (or all queued/scheduled) |
| `/ebb-ai:expedite <id>` | Run now, bypass the carbon window |
| `/ebb-ai:reschedule <id> --by <new>` | Change the deadline, re-score |
| `/ebb-ai:retry <id>` | Re-dispatch a failed task |
| `/ebb-ai:grid <zone>` | Just look at the grid, no task involved |

For "should I defer this?" or "when would be best?" — use **`/ebb-ai:plan`**,
which returns the same window math without enqueueing. Commit with
`/ebb-ai:defer` only after the plan looks right.

## Reading the receipt

When the user later asks "is that thing done?" or "where's my translation?",
use **`/ebb-ai:check`**. The receipt includes:

- `scheduled_for` vs `completed_at` — did it dispatch on time?
- `estimated_carbon_g` vs `actual_carbon_g` — how good was the forecast?
- `result` — the LLM response itself, ready to surface to the user.

If the user supplied `--output` at defer time, the same JSON also
appears at that path — they can `cat` it or have a file-watcher pick
it up.

## When dispatch isn't happening

Deferred tasks live in `~/.ebb-ai/queue.db` (or the user's
`EBB_DB_PATH`). The MCP server only **queues** — it doesn't run a
clock. Actual dispatch needs the **`ebb tick` daemon**:

```bash
npm install -g @ebb-ai/cli
ebb install      # registers launchd (macOS) / systemd (Linux) cron-tick
```

If the user reports that a task "never ran", first check whether the
daemon is installed (`ebb status`). The most common bug at v0.7.1 is
"plugin installed, daemon not installed — tasks accumulate but never
fire."

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
