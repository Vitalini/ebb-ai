# Install ebb-ai

> **What this is.** Plain-text install instructions for the
> open-source ebb-ai MCP server (Apache-2.0). Safe to read end to end
> before running anything.
>
> - Project: <https://github.com/Vitalini/ebb-ai>
> - Site: <https://www.ebb-ai.com>
> - License: Apache-2.0

ebb-ai is a Model Context Protocol (MCP) server. It defers
non-urgent AI tasks to the cleanest hour of the electricity grid
inside a deadline. It does **not** require an account, never sends
data to ebb-ai's authors, and stores everything in a local SQLite
file at `~/.ebb-ai/queue.db`.

---

## What the install does

It registers a new MCP server with your agent host so that the
agent gains nine new tools (`schedule_task`, `recommend_window`,
`get_grid_forecast`, `check_queue_status`, `cancel_task`,
`cancel_all`, `update_deadline`, `expedite_task`, `retry_task`).

The MCP server binary is `@ebb-ai/mcp`, run via `npx`. No global
install, no system changes outside the agent host's own config
file.

---

## Pick the install path for the host you're in

### Claude Code

```text
/plugin marketplace add Vitalini/ebb-ai
/plugin install ebb-ai
```

Restart the session. Eight `/ebb-ai:*` slash commands and the MCP
server are wired automatically.

### OpenClaw

```text
openclaw plugins install clawhub:@vitalini/ebb
```

The plugin self-registers on startup; no config edit needed.

### Claude Desktop · Cursor · Windsurf · Continue · Cline · Zed · Goose · or any other MCP host

Add this entry to the host's MCP config file. Only the file path
differs per host:

```json
{
  "mcpServers": {
    "ebb-ai": {
      "command": "npx",
      "args": ["-y", "@ebb-ai/mcp"]
    }
  }
}
```

Common config file paths:

| Host           | Config path                                                                |
| -------------- | -------------------------------------------------------------------------- |
| Claude Desktop | `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS)  |
|                | `%APPDATA%\Claude\claude_desktop_config.json` (Windows)                    |
| Cursor         | `~/.cursor/mcp.json`                                                       |
| Windsurf       | `~/.codeium/windsurf/mcp_config.json`                                      |
| Continue       | `~/.continue/config.json` (under `experimental.mcp.servers`)               |
| Cline          | VS Code → command palette → "Cline: Open MCP Settings"                     |
| Zed            | `~/.config/zed/settings.json` (under `context_servers`)                    |
| Goose          | `~/.config/goose/profiles.yaml` (under `extensions`)                       |

Restart the host after editing the config file.

---

## Confirm the install worked

Once the host has restarted, ask the agent to call `schedule_task`
with `dry_run: true`. A successful dry-run returns a chosen window
and an estimated carbon figure, without persisting anything.

```json
{
  "tool": "schedule_task",
  "args": {
    "prompt": "ping",
    "deadline": "<24h from now in ISO-8601>",
    "dry_run": true
  }
}
```

If the agent sees the response, the install is done.

---

## Then what

The agent can now run:

```text
/ebb-ai:defer "summarize today's commits" --by tomorrow 6pm
```

(or call `schedule_task` directly) and the task lands at the
cleanest grid hour inside the deadline.

Full docs and tool reference: <https://www.ebb-ai.com/docs>
