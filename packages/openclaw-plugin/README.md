# @vitalini/ebb

OpenClaw plugin that exposes ebb-ai as native OpenClaw tools.
Published on ClawHub as `@vitalini/ebb`; its runtime id in the gateway
is `ebb`.

When a user says "do this later", "by tomorrow", "tonight", "overnight",
"by EOD", "remind me to", or any other deferral phrase, this plugin's
`ebb_schedule_task` tool gets invoked automatically — the LLM dispatch
is routed to the cleanest electricity-grid hour inside the deadline,
40-70 % lower carbon vs running immediately.

## Tools registered

| Tool                       | Purpose                                                         |
|----------------------------|-----------------------------------------------------------------|
| `ebb_schedule_task`        | Queue a task at the cleanest hour. The deferral trigger.        |
| `ebb_recommend_window`     | Preview the cleanest hour without queueing. Read-only.          |
| `ebb_check_queue_status`   | List all tasks / detail one (with carbon receipt). Read-only.   |
| `ebb_cancel_task`          | Cancel a queued task. Idempotent.                                |

## Install

```bash
openclaw plugins install clawhub:@vitalini/ebb
```

Restart the OpenClaw gateway. To update later:
`openclaw plugins update @vitalini/ebb`.

## Configuration

Optional config schema:

```json
{
  "dbPath": "/home/you/.ebb-ai/queue.db",
  "defaultRegion": "GB"
}
```

`dbPath` defaults to `~/.ebb-ai/queue.db` — the same path used by
`@ebb-ai/mcp` (MCP server) and `@ebb-ai/cli` (CLI). All three share
one ledger, so deferring a task in OpenClaw and listing it from
`ebb stats` Just Works.

`defaultRegion` defaults to `GB` — always-live data via UK National
Grid ESO, no API key required. Set to `US-CAL-CISO`, `FR`, etc. for
other regions (may need `EBB_*_API_KEY` env vars for live data; falls
back to a deterministic mock otherwise).

## When does the plugin auto-invoke?

The `ebb_schedule_task` tool description tells the LLM to invoke when
the user's phrasing signals deferral:

- "do this later" / "by tomorrow" / "tonight" / "overnight"
- "by EOD" / "this week" / "next week"
- "when you have a moment" / "remind me to"
- "queue this up" / "schedule this"
- "no rush" / "not urgent"

For interactive tasks ("summarize this", "what does X do", "write a
function") the plugin stays out of the way.

## License

Apache-2.0 © Vitalii Borovyk · https://github.com/Vitalini/ebb-ai
