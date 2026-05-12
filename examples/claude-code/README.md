# ebb-ai for Claude Code

Drop-in MCP integration that lets Claude Code defer expensive coding
tasks to the cleanest grid window — long codebase analyses, large
refactors, batch test generation, anything where the latency from now
to "answer me at breakfast" is irrelevant.

## Install

1. Build the server (from the repo root):

   ```bash
   pnpm install
   pnpm build
   ```

2. Register the server with Claude Code's CLI:

   ```bash
   claude mcp add ebb-ai -- node /ABSOLUTE/PATH/TO/ebb-ai/packages/mcp-server/dist/server.js
   ```

   To pass environment variables (Electricity Maps API key, default
   region):

   ```bash
   claude mcp add ebb-ai \
     -e EBB_ELECTRICITY_MAPS_API_KEY=YOUR_KEY \
     -e EBB_DEFAULT_REGION=US-CAL-CISO \
     -- node /ABSOLUTE/PATH/TO/ebb-ai/packages/mcp-server/dist/server.js
   ```

   `claude mcp add` writes the entry into `~/.claude.json`'s
   `mcpServers` map. See `mcp.json` in this folder for the resulting
   shape if you prefer to edit by hand.

3. Verify in a Claude Code session:

   ```
   /mcp
   ```

   You should see `ebb-ai` listed. Then:

   ```
   Use ebb-ai to tell me the cleanest hour in the next 12 hours for US-CAL-CISO.
   ```

   Claude Code should call `get_grid_forecast(region="US-CAL-CISO", hours=12)`
   and report the lowest band.

## Sample `~/.claude.json` snippet

For reference, the result of `claude mcp add` looks like this in your
`~/.claude.json`:

```json
{
  "mcpServers": {
    "ebb-ai": {
      "command": "node",
      "args": [
        "/ABSOLUTE/PATH/TO/ebb-ai/packages/mcp-server/dist/server.js"
      ],
      "env": {
        "EBB_DEFAULT_REGION": "US-CAL-CISO"
      }
    }
  }
}
```

You can edit this file directly if you prefer.

## Suggested slash command

Save this as `~/.claude/commands/defer.md` for a one-stroke way to
defer your current task:

```markdown
---
description: Defer this task to the cleanest grid window before the supplied deadline.
arg: deadline (ISO-8601 timestamp)
---

Call `mcp__ebb-ai__schedule_task` with the current conversation's last
non-trivial instruction as the `prompt`, the user-supplied `$ARGS` as
the `deadline` (validate it is ISO-8601 and in the future), and
`US-CAL-CISO` as the default region unless the user specified
otherwise. Then briefly confirm the queued slot to the user.
```

Now `/defer 2026-05-13T08:00:00-04:00` schedules the current task and
goes back to work on something else.

## Suggested permissions

If you frequently use ebb-ai, allow its read-only tools without
prompts. Add to `~/.claude/settings.json`:

```json
{
  "permissions": {
    "allow": [
      "mcp__ebb-ai__get_grid_forecast",
      "mcp__ebb-ai__check_queue_status"
    ],
    "ask": [
      "mcp__ebb-ai__schedule_task"
    ]
  }
}
```

`schedule_task` requires a confirmation; the other two are read-only.

## Use cases

| Task | Defer because |
|---|---|
| "Run a full codebase audit and produce a report" | Long-running, no immediate consumer. |
| "Generate 50 unit tests for `src/api/*.ts`" | Embarrassingly parallel, deadline at next work session. |
| "Summarize every issue closed this month" | Batch, low urgency. |
| "Re-run agentic refactor with thinking budget 32k" | High token cost, off-peak grid + Batch API saves materially. |

## What it does NOT do (v0.1)

- Does not yet auto-invoke the Anthropic / OpenAI Batch APIs. Schedules
  the dispatch *time*, but Claude Code still calls the model itself at
  that time. Direct Batch routing lands in v0.2.
- Does not yet persist across Claude Code restarts. Pending task IDs
  are lost on restart of the MCP server child process.
- Receipts in v0.1 measure scheduling overhead, not the real LLM
  execution — that lands with the Batch API adapters in v0.2.

All three are tracked in `../../PLAN.md`.
