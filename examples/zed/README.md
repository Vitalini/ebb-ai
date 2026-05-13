# ebb-ai in Zed

[Zed](https://zed.dev) supports MCP via "context servers" in its
native settings since version 0.160.

## 1. Build the MCP server

```bash
cd /path/to/ebb-ai
pnpm install
pnpm --filter @ebb-ai/mcp build
```

## 2. Register the server in Zed

Open Zed's settings (`Cmd+,` on macOS, `Ctrl+,` on Linux/Windows). The
settings file is `~/.config/zed/settings.json`. Add a `context_servers`
section:

```json
{
  "context_servers": {
    "ebb-ai": {
      "command": {
        "path": "node",
        "args": ["/absolute/path/to/ebb-ai/packages/mcp-server/dist/server.js"]
      },
      "env": {
        "EBB_ELECTRICITY_MAPS_API_KEY": "optional"
      }
    }
  }
}
```

Save. Zed picks up MCP config changes live. Open the Assistant panel —
the four ebb-ai tools should appear in the model's tool list.

## 3. Use it

In the Assistant chat:

> Run the test suite and write a per-file flakiness report. Defer to
> a clean 6-hour window.

Zed's assistant will plan via `recommend_window`, queue via
`schedule_task`, and return the planned ISO timestamp.

## Notes

- Zed's MCP integration is comparatively new (0.160+). If you don't
  see ebb-ai tools, check `~/Library/Logs/Zed/Zed.log` (macOS) for
  spawn errors — most often missing absolute `node` path.
- The Zed integration uses the same MCP server binary as every other
  host; no Zed-specific code in this project.

See also: [examples/cursor](../cursor/) ·
[examples/windsurf](../windsurf/) ·
[examples/continue](../continue/).
