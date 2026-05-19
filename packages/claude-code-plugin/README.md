# Claude Code plugin — ebb-ai

A one-command install that turns any Claude Code session into a
carbon-aware AI scheduler. Defer non-urgent LLM tasks (overnight
summaries, batch analyses, scheduled compliance scans) to cheap
off-peak windows — ~50 % cost savings via Anthropic / OpenAI Batch
APIs, 40-70 % lower carbon vs. running immediately, an auditable
carbon receipt for every dispatch.

This package is **not** published to npm. It's the plugin tree that
Claude Code's marketplace clones into
`~/.claude/plugins/marketplaces/`. The marketplace listing at the repo
root (`.claude-plugin/marketplace.json`) points to this folder via
`"source": "./packages/claude-code-plugin/"`.

## Install

```bash
# 1. Add the marketplace (this repo).
/plugin marketplace add Vitalini/ebb-ai

# 2. Install the plugin.
/plugin install ebb-ai
```

Restart the Claude Code session — the plugin is live.

The plugin auto-wires the `ebb-ai` MCP server via `npx -y @ebb-ai/mcp`
on first invocation, so no separate `claude mcp add` step is needed.

## Slash commands (8)

| Command                              | Purpose                                                |
|--------------------------------------|--------------------------------------------------------|
| `/ebb-ai:defer <task> --by <when>`   | Queue a deferrable LLM task at the cleanest grid hour. |
| `/ebb-ai:plan <task> --by <when>`    | Preview the chosen window without queueing.            |
| `/ebb-ai:check [<id>\|--all]`        | List all tasks or detail one (with carbon receipt).    |
| `/ebb-ai:cancel <id> \| --all`       | Cancel a queued/scheduled task. Idempotent.            |
| `/ebb-ai:expedite <id>`              | Dispatch immediately, bypass the chosen window.        |
| `/ebb-ai:reschedule <id> --by <new>` | Change the deadline and re-score the window.           |
| `/ebb-ai:retry <id>`                 | Re-dispatch a task currently in `failed` status.       |
| `/ebb-ai:grid <zone>`                | Show current intensity + 24-hour forecast, no task.    |

## Auto-invocation skill

The bundled Claude Code skill at `skills/ebb-ai/SKILL.md` tells the
agent **when** to reach for `/ebb-ai:defer` automatically — for
example when the user says any of: "do this later", "by tomorrow",
"tonight", "overnight", "by EOD", "sometime this week", "when you have
a moment", "remind me to", "queue this up", "schedule this", "no
rush", "not urgent". Convert that phrasing to a deadline and route the
task through ebb-ai instead of dispatching synchronously.

## Persistence

Tasks queued via `/ebb-ai:defer` are persisted to `~/.ebb-ai/queue.db`
(SQLite) by default. The queue survives Claude Code restarts and is
shared across MCP hosts (Claude Code, Claude Desktop, Cursor,
OpenClaw, etc.) — defer on one host, check on another.

Inspect from the CLI:

```bash
npx -y @ebb-ai/cli stats
npx -y @ebb-ai/cli queue list
```

Override the path via `EBB_DB_PATH=/some/where/queue.db` in the
plugin's `.mcp.json` env block. Use `EBB_DB_PATH=:memory:` to opt out
of persistence (mainly for tests).

## Actually dispatching tasks

The MCP server **queues** tasks but does not run a clock. Actual
dispatch at the chosen window requires the **`ebb tick` daemon**:

```bash
npm install -g @ebb-ai/cli
ebb install      # registers launchd (macOS) / systemd (Linux) cron-tick
ebb status       # confirm the tick is wired
```

Until the daemon is installed, tasks sit queued and can be dispatched
manually with `ebb tick --once`. The plugin-install path does not
auto-install the daemon (it would create system-level state without
explicit opt-in).

## Result delivery

Three options to get the result back after a task completes:

1. **Poll.** `/ebb-ai:check <task_id>` returns the LLM response under
   `result` once the receipt is written.
2. **File output.** Pass `--output <abs-path>` at defer time. The
   dispatcher writes `{ taskId, result, receipt }` as JSON to that
   path on completion. Pair with `tail -f` or a file-watcher.
3. **CLI inbox.** Point `--output` at `~/.ebb-ai/inbox/<id>.json` and
   wire a tiny `fswatch` / `entr` loop to forward to Telegram, email,
   macOS notifications — your choice.

## Example

```
> /ebb-ai:defer "Summarize today's GitHub notifications" --by 4h --region US-CAL-CISO
Deferred ✓
  task id        7f3a2b9e
  scheduled for  in 3h, 22:15 UTC
  est. carbon    0.34 g CO2e
  savings        38 % cleaner than running now
  band           clean
  check status   /ebb-ai:check 7f3a2b9e
```

Three hours later:

```
> /ebb-ai:check 7f3a2b9e
status     completed
region     US-CAL-CISO
scheduled  22:15 UTC (4h ago)
completed  22:15:08 UTC
estimated  0.34 g CO2e
actual     0.31 g CO2e   (-9 %)
result     <the summary>
```

## Without the plugin

If you only want the MCP server (no slash commands, no skill), wire it
directly into your MCP host. From Claude Code:

```bash
claude mcp add ebb-ai npx -- -y @ebb-ai/mcp
```

You get the nine MCP tools (`schedule_task`, `recommend_window`,
`check_queue_status`, `cancel_task`, `cancel_all`, `update_deadline`,
`expedite_task`, `retry_task`, `get_grid_forecast`) but not the
slash-command shortcuts or the `ebb-ai` auto-invocation skill.

## Files

- `.claude-plugin/plugin.json` — plugin manifest (name, description,
  version, auto-invocation trigger language)
- `.mcp.json` — MCP server wiring (runs `npx -y @ebb-ai/mcp`)
- `commands/*.md` — the eight slash commands
- `skills/ebb-ai/SKILL.md` — when-to-auto-invoke skill

## Related packages

- `@ebb-ai/core` — scheduling logic, grid feeds, SQLite ledger
- `@ebb-ai/mcp` — MCP server (used by this plugin and any other host)
- `@ebb-ai/cli` — `ebb stats`, `ebb tick`, `ebb install`, `ebb queue`
- `@ebb-ai/openclaw-plugin` — same surface, native OpenClaw tools

## License

Apache-2.0. See [`../../LICENSE`](../../LICENSE).
