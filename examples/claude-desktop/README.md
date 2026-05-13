# ebb-ai in Claude Desktop

Two file edits. Five minutes.

## 1. Build the MCP server

```bash
cd /path/to/ebb-ai
pnpm install
pnpm --filter @ebb-ai/mcp build
```

## 2. Register the server

Edit your Claude Desktop config:

- **macOS:** `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Linux:** `~/.config/Claude/claude_desktop_config.json`
- **Windows:** `%APPDATA%\Claude\claude_desktop_config.json`

Merge this stanza in (create the file if it doesn't exist):

```json
{
  "mcpServers": {
    "ebb-ai": {
      "command": "node",
      "args": ["/absolute/path/to/ebb-ai/packages/mcp-server/dist/server.js"],
      "env": {
        "EBB_ELECTRICITY_MAPS_API_KEY": "optional"
      }
    }
  }
}
```

Quit and relaunch Claude Desktop. The three ebb-ai tools appear in
the agent's tool list (look at the 🔌 icon in the conversation
window).

## 3. Use it

Just ask the assistant:

> Schedule a 30-day market-research summary task — pick whatever clean
> grid window inside the next 12 hours that fits a 5g CO₂ budget.

The assistant will call `schedule_task` with `deadline=now+12h`,
`carbon_budget_g=5`, get back a task id, and at the chosen window
ebb-ai dispatches and writes a carbon receipt.

Poll status anytime with: *"check ebb-ai queue status for task XYZ"*.

## Troubleshooting

- **Tools don't appear:** check `~/Library/Logs/Claude/mcp.log` (macOS)
  for boot errors. Most common cause: `command` is `npx` instead of
  `node`, or path to `server.js` is wrong.
- **`spawn ENOENT` errors:** Claude Desktop launches MCP servers in a
  minimal `PATH`. Always use absolute paths to `node` and the bundle.
- **Mock data only:** set `EBB_ELECTRICITY_MAPS_API_KEY` in the `env`
  block above. The free tier at electricitymaps.com is plenty.

See also: [examples/claude-code](../claude-code/) ·
[examples/cursor](../cursor/) ·
[examples/openclaw-skill](../openclaw-skill/).
