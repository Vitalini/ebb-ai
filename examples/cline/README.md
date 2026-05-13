# ebb-ai in Cline

[Cline](https://github.com/cline/cline) is the most popular MCP-capable
VS Code extension (formerly *Claude Dev*). Wiring ebb-ai in is two
files: build, register.

## 1. Build the MCP server

```bash
cd /path/to/ebb-ai
pnpm install
pnpm --filter @ebb-ai/mcp build
```

## 2. Register the server in Cline

Open Cline's settings panel (gear icon in the Cline sidebar) →
**MCP Servers** → **Edit MCP Settings**. The file it opens is roughly:

- **macOS:** `~/Library/Application Support/Code/User/globalStorage/saoudrizwan.claude-dev/settings/cline_mcp_settings.json`
- **Linux:** `~/.config/Code/User/globalStorage/saoudrizwan.claude-dev/settings/cline_mcp_settings.json`
- **Windows:** `%APPDATA%\Code\User\globalStorage\saoudrizwan.claude-dev\settings\cline_mcp_settings.json`

(Exact path drifts with Cline version. Always reach it from the
Settings UI rather than typing the path.)

Merge in:

```json
{
  "mcpServers": {
    "ebb-ai": {
      "command": "node",
      "args": ["/absolute/path/to/ebb-ai/packages/mcp-server/dist/server.js"],
      "env": {
        "EBB_ELECTRICITY_MAPS_API_KEY": "optional — falls back to mock data without one"
      }
    }
  }
}
```

Save the file. Cline reloads MCP servers automatically. The four
ebb-ai tools appear in the **MCP Servers** panel under "Available
Tools": `get_grid_forecast`, `recommend_window`, `schedule_task`,
`check_queue_status`.

## 3. Use it

In a Cline chat:

> Refactor the auth module. Defer the work to a clean grid window in
> the next 8 hours.

Cline picks `recommend_window` to plan, then `schedule_task` to queue.
Returns a `task_id`; poll via `check_queue_status`.

## Notes

- Cline is a VS Code extension, so the MCP server's lifetime is tied
  to VS Code's. Close VS Code → MCP dies → in-flight timers are lost.
  v0.4's `ebb tick` CLI + launchd plist closes that gap.
- Same `ebb-ai/mcp` binary works in Cline, Cursor, Windsurf, Continue,
  Claude Desktop. The only difference is the config-file path.

See also: [examples/cursor](../cursor/) ·
[examples/windsurf](../windsurf/) ·
[examples/continue](../continue/).
