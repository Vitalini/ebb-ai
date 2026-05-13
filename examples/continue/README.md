# ebb-ai in Continue

[Continue](https://continue.dev) ships native MCP support since v1.0.
Continue's MCP integration lives in the YAML config and works in both
VS Code and JetBrains IDEs.

## 1. Build the MCP server

```bash
cd /path/to/ebb-ai
pnpm install
pnpm --filter @ebb-ai/mcp build
```

## 2. Register the server in Continue

Edit `~/.continue/config.yaml` (Continue creates this on first launch):

```yaml
mcpServers:
  - name: ebb-ai
    command: node
    args:
      - /absolute/path/to/ebb-ai/packages/mcp-server/dist/server.js
    env:
      EBB_ELECTRICITY_MAPS_API_KEY: optional
```

If `config.yaml` doesn't exist yet, copy [`config.example.yaml`](./config.example.yaml)
into `~/.continue/config.yaml`.

Reload Continue (`Continue: Reload Configuration` from the command
palette). The four ebb-ai tools appear in the model's available tool
list whenever you're in agent mode.

## 3. Use it

In a Continue chat (agent mode):

> Generate a 5,000-token research report on serverless cold-start
> patterns. Schedule it for the cleanest carbon window inside the
> next 12 hours.

Continue will call `recommend_window` then `schedule_task`, returning
the planned start time and task id.

## Notes

- Continue runs as part of your IDE process. The MCP server's lifetime
  is tied to that. v0.4's always-on `ebb tick` CLI + launchd plist
  closes the "laptop sleeps overnight" gap.
- Continue supports per-workspace config too — drop a `.continue/`
  folder at your repo root with a `config.yaml` to scope ebb-ai to a
  single project.

See also: [examples/cline](../cline/) ·
[examples/cursor](../cursor/) ·
[examples/zed](../zed/).
