# Install Tidegap

> **What this is.** Plain-text install instructions for the
> open-source Tidegap MCP server (Apache-2.0). Safe to read end to end
> before running anything.
>
> - Project: <https://github.com/tidegap/tidegap>
> - Site: <https://www.tidegap.com>
> - License: Apache-2.0

Tidegap is a Model Context Protocol (MCP) server. It defers
non-urgent AI tasks to the cleanest hour of the electricity grid
inside a deadline. It does **not** require an account, never sends
data to Tidegap's authors, and stores everything in a local SQLite
file at `~/.tidegap/queue.db`.

---

## What the install does

It registers a new MCP server with your agent host so that the
agent gains ten new tools (`schedule_task`, `recommend_window`,
`get_grid_forecast`, `check_queue_status`, `cancel_task`,
`cancel_all`, `update_deadline`, `expedite_task`, `retry_task`,
`reply_task`).

The MCP server binary is `@tidegap/mcp`, run via `npx`. No global
install, no system changes outside the agent host's own config
file.

---

## Pick the install path for the host you're in

### Claude Code

```text
/plugin marketplace add tidegap/tidegap
/plugin install tidegap
```

Restart the session. Eight `/tidegap:*` slash commands and the MCP
server are wired automatically.

### OpenClaw

```text
openclaw plugins install clawhub:@vitalini/tidegap
```

The plugin self-registers on startup; no config edit needed.

### Claude Desktop · Cursor · Windsurf · Continue · Cline · Zed · Goose · or any other MCP host

Add this entry to the host's MCP config file. Only the file path
differs per host:

```json
{
  "mcpServers": {
    "tidegap": {
      "command": "npx",
      "args": ["-y", "@tidegap/mcp"]
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
/tidegap:defer "summarize today's commits" --by tomorrow 6pm
```

(or call `schedule_task` directly) and the task lands at the
cleanest grid hour inside the deadline.

Full docs and tool reference: <https://www.tidegap.com/docs>
