# @ebb-ai/mcp (renamed)

This package is now **[`@tidegap/mcp`](https://www.npmjs.com/package/@tidegap/mcp)**.

Ebb AI was renamed to Tidegap in 0.18.0. `npx -y @ebb-ai/mcp` still works: version 0.17.1 prints one deprecation line to stderr and starts the `@tidegap/mcp` server. It receives no further updates.

Update your MCP host config:

```json
{
  "mcpServers": {
    "tidegap": { "command": "npx", "args": ["-y", "@tidegap/mcp"] }
  }
}
```

The host config key changes from `ebb-ai` to `tidegap`, so tool names change from `mcp__ebb-ai__*` to `mcp__tidegap__*`. Rename `EBB_*` environment variables to `TIDEGAP_*` before 0.19. What else changes: <https://github.com/tidegap/tidegap#renamed-from-ebb-ai>.
