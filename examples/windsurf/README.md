# ebb-ai in Windsurf

[Windsurf](https://codeium.com/windsurf) by Codeium supports MCP from
Cascade since the v0.62 wave.

## 1. Build the MCP server

```bash
cd /path/to/ebb-ai
pnpm install
pnpm --filter @ebb-ai/mcp build
```

## 2. Register the server in Windsurf

Open Windsurf settings → **Cascade** → **MCP Servers** → **Manage**.
Click *Add Server* and either paste the JSON below or edit the file
directly:

- **macOS:** `~/.codeium/windsurf/mcp_config.json`
- **Linux:** `~/.codeium/windsurf/mcp_config.json`
- **Windows:** `%USERPROFILE%\.codeium\windsurf\mcp_config.json`

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

Hit the refresh icon next to *MCP Servers* in Cascade. The four
ebb-ai tools appear under *Available Tools*.

## 3. Use it

In Cascade:

> Add JSDoc to every exported function in `src/lib/`. Defer it to the
> cleanest carbon window inside the next 4 hours.

Cascade will call `recommend_window` first, then `schedule_task`, and
return the planned ISO timestamp + task id.

## Notes

- Windsurf 2026 wave reorganized MCP config a few times. If the file
  path above is stale, open Settings → Cascade → "Open MCP Config" and
  let Windsurf show you the live path.
- Same MCP server binary as every other host. No Windsurf-specific
  code on the ebb-ai side.

See also: [examples/cursor](../cursor/) ·
[examples/cline](../cline/) ·
[examples/continue](../continue/).
