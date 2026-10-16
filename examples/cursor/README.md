# Tidegap in Cursor

[Cursor](https://cursor.com) speaks the Model Context Protocol natively
since v0.45. Wiring Tidegap in is a one-file change.

## 1. Build the MCP server

```bash
cd /path/to/tidegap
pnpm install
pnpm --filter @tidegap/mcp build
```

This produces `packages/mcp-server/dist/server.js`.

## 2. Register the server in Cursor

Edit `~/.cursor/mcp.json` (create it if it doesn't exist):

```json
{
  "mcpServers": {
    "tidegap": {
      "command": "node",
      "args": ["/absolute/path/to/tidegap/packages/mcp-server/dist/server.js"],
      "env": {
        "TIDEGAP_ELECTRICITY_MAPS_API_KEY": "optional — falls back to mock data"
      }
    }
  }
}
```

Restart Cursor. Open the **MCP** panel under Settings → Features →
Model Context Protocol. You should see `tidegap` listed with three tools:

- `get_grid_forecast` — N-hour carbon-intensity forecast for a region.
- `schedule_task` — queue a prompt for the cleanest in-deadline window.
- `check_queue_status` — poll task state and retrieve the carbon receipt.

## 3. Use it from a Cursor chat

Open Composer or Chat and ask:

> Refactor the auth middleware in `src/auth/` — but defer the work to
> the cleanest carbon window inside the next 8 hours.

Cursor will call `schedule_task` with the prompt + an 8-hour deadline,
get back a `task_id`, and surface it to you.

## Notes

- The MCP server is stdio-based — Cursor manages its lifecycle. When
  Cursor quits, the server quits. Long-deferred tasks (overnight) do
  not survive Cursor restart in v0.2. The `tidegap tick` always-on
  daemon planned for v0.3 closes this gap.
- The same `@tidegap/mcp` binary works for Claude Desktop, Claude Code,
  OpenClaw, and OpenAI Codex CLI. The only differences are the
  config-file path and whether your host launches MCP servers from
  TOML or JSON.

See also: [examples/claude-code](../claude-code/) ·
[examples/openclaw-skill](../openclaw-skill/) ·
[examples/codex](../codex/).
