---
name: ebb-ai
description: Carbon-aware scheduling of AI tasks. Use this skill when the user asks to defer, schedule, or queue an AI task ("run this overnight", "do it when the grid is clean", "wait until off-peak"). Also use when the user explicitly asks about grid carbon intensity, AI energy cost, or wants a CO₂ receipt for a task they're about to run. Triggers on "defer", "schedule", "overnight", "off-peak", "carbon", "energy", "grid", "emissions", "CO2", "когда дешевле", "ночью", "сетка", "выбросы".
---

# ebb-ai — Carbon-aware scheduling

This skill connects OpenClaw to a local `@ebb-ai/mcp` server that
schedules AI tasks to run during the cleanest available electricity-grid
window inside a user-supplied deadline.

## When to invoke

Use this skill when the user wants to:

1. **Defer a non-urgent AI task** to run later for environmental or
   cost reasons. Examples:
   - "Summarize these 50 articles by tomorrow morning, run it overnight."
   - "Don't do it now — wait for when the grid is clean."
   - "Schedule the GitHub digest for 3 AM."
2. **Inspect grid carbon intensity** before deciding whether to run a
   task. Examples:
   - "Is now a good time to run an expensive batch?"
   - "When will the California grid be cleanest in the next 12 hours?"
3. **Audit the carbon cost** of recent agent activity. Examples:
   - "How much CO₂ did my agents use today?"
   - "Show me the carbon receipt for that last summary."

Do **not** invoke this skill for:

- Tasks the user wants done immediately.
- Tasks where the user has no preference about timing.
- General climate / energy questions unrelated to AI compute.

## Prerequisites

The `@ebb-ai/mcp` server must be registered as an MCP server in
OpenClaw. See `scripts/install.sh` for a one-shot installer that does
this. Manual install:

1. Build the server:
   ```bash
   cd /path/to/ebb-ai && pnpm install && pnpm build
   ```
2. Add to `~/.openclaw/mcp.json`:
   ```json
   {
     "mcpServers": {
       "ebb-ai": {
         "command": "node",
         "args": ["/abs/path/to/ebb-ai/packages/mcp-server/dist/server.js"],
         "env": {
           "EBB_ELECTRICITY_MAPS_API_KEY": "optional",
           "EBB_DEFAULT_REGION": "US-CAL-CISO"
         }
       }
     }
   }
   ```
3. Restart OpenClaw.

## Tools available

Once the MCP server is connected, three tools become callable:

### `get_grid_forecast(region, hours?)`

Returns hourly carbon intensity for the next 1-72 hours. Use this to
answer "when is the cleanest window?" questions.

Region codes follow the Electricity Maps convention. Common ones:

- `US-CAL-CISO` — California (CAISO)
- `US-TEX-ERCO` — Texas (ERCOT)
- `US-NE-ISNE` — New England
- `US-NY-NYIS` — New York
- `US-MIDA-PJM` — Mid-Atlantic (PJM)
- `US-MIDW-MISO` — Midwest (MISO)
- `FR`, `DE`, `GB`, `ES` — selected European countries

If the user doesn't specify a region, ask once. Default fallback is the
server-configured default (typically `US-CAL-CISO` in our environment,
or whatever `EBB_DEFAULT_REGION` is set to).

### `schedule_task(prompt, deadline, model?, region?, carbon_budget_g?)`

Queues a task to be dispatched in the cleanest grid window inside the
deadline. Returns a `task_id` you should keep so you can check status
later.

Always pass a real ISO-8601 `deadline`. If the user says "tomorrow
morning", convert to a concrete timestamp in their local timezone
before calling.

### `check_queue_status(task_id?)`

With no arguments — full queue summary. With a `task_id` — single-task
detail including the carbon receipt (once the task has completed).

## Workflow patterns

### Pattern A: defer + execute when notified

For tasks where the agent itself will do the actual prompt execution:

1. Call `schedule_task(prompt=..., deadline=...)` → get `task_id`.
2. Tell the user when the chosen window is (`scheduled_for`).
3. The agent or a watcher process polls `check_queue_status(task_id)`
   periodically. When `status === "scheduled"` flips to a past
   `scheduled_for`, the window is open — execute the prompt with the
   user's preferred model.

### Pattern B: check grid before acting

When the user asks "is now a good time?":

1. Call `get_grid_forecast(region)`.
2. Inspect the next 12 entries.
3. If the current hour is `clean` or `very_clean`, tell the user to go
   ahead. Otherwise, propose deferring with `schedule_task`.

### Pattern C: audit recent activity

When the user asks "how dirty has my AI been today?":

1. Call `check_queue_status()` for the queue summary.
2. For each completed task, the receipt has
   `estimated_carbon_g`. Sum them. Report the total plus the average.

## Limitations (v0.1)

- The server schedules dispatch *time*, but does not currently call the
  LLM itself. The agent is expected to execute the prompt at the chosen
  window (see Pattern A).
- In-memory queue — restarts of OpenClaw's MCP child process lose
  state. Persistent SQLite-backed queue lands in v0.2.
- Single-provider (Anthropic via standard API). Cross-provider routing
  is a v0.3 feature.

## Example interaction

> **User:** Summarize these three GitHub issues for me, but wait
> until off-peak — I don't need it until breakfast.
>
> **Agent (with this skill):**
> 1. Calls `get_grid_forecast(region="US-CAL-CISO", hours=12)`.
> 2. Sees that 03:00 is the cleanest hour (`120 gCO2/kWh`, band
>    `clean`).
> 3. Calls `schedule_task(prompt="Summarize these three GitHub
>    issues: …", deadline="2026-05-13T08:00:00-04:00")`.
> 4. Replies to the user: "Queued. Will run around 03:00 tonight; you'll
>    have the summary in your inbox by 06:00 at the latest."
