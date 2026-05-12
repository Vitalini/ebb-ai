# ebb-ai for OpenAI Codex CLI

OpenAI Codex CLI supports MCP servers via its `mcp_servers` configuration.
Wiring `ebb-ai` in lets Codex defer long-running coding tasks to clean
grid windows the same way Claude Code does.

## Install

Build the server (from repo root):

```bash
pnpm install
pnpm build
```

Add an entry to `~/.codex/config.toml`:

```toml
[mcp_servers.ebb-ai]
command = "node"
args = ["/ABSOLUTE/PATH/TO/ebb-ai/packages/mcp-server/dist/server.js"]

[mcp_servers.ebb-ai.env]
EBB_ELECTRICITY_MAPS_API_KEY = ""
EBB_DEFAULT_REGION = "US-CAL-CISO"
```

Restart Codex.

## Verify

In a Codex session:

```
list tools that come from ebb-ai
```

You should see three: `get_grid_forecast`, `schedule_task`,
`check_queue_status`.

## Use cases

Same as Claude Code — long-running audits, batched test generation,
agentic refactors. Codex's `--background` flag pairs particularly well
with `schedule_task`: kick off the deferred work, close the session,
let the scheduler do its job.

## Limitations

This is a v0.1 integration. Same caveats apply as in the Claude Code
example — see `../claude-code/README.md`.
