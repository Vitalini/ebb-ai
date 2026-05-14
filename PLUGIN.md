# ebb-ai · Claude Code plugin

A one-command install that turns any Claude Code session into a cost-aware,
grid-aware AI workload scheduler. Defer non-urgent LLM tasks (overnight
summaries, batch analyses, scheduled compliance scans) to cheap off-peak
windows — ~50% cost savings via Batch APIs, smoother data-center load, and
an auditable carbon receipt for every dispatch.

`ebb-ai` ships a Claude Code plugin that wires the ebb-ai MCP server and three
slash commands into your CLI in one step.

## Install

```bash
# 1. Add the marketplace (this repo)
claude plugin marketplace add Vitalini/ebb-ai

# 2. Install the plugin
claude plugin install ebb-ai
```

That's it. Restart `claude` and the plugin is live. Full command surface:

| Command | Purpose |
|---|---|
| `/ebb-ai:defer <task> --by <when>` | Queue a deferrable LLM task |
| `/ebb-ai:plan <task> --by <when>` | Preview the chosen window, no commit |
| `/ebb-ai:check [<id>\|--all]` | List or detail of queued tasks |
| `/ebb-ai:cancel <id> \| --all` | Remove a task (or all queued/scheduled) |
| `/ebb-ai:expedite <id>` | Run now, bypass the carbon window |
| `/ebb-ai:reschedule <id> --by <new>` | Change the deadline, re-score |
| `/ebb-ai:retry <id>` | Re-dispatch a failed task |
| `/ebb-ai:grid <zone>` | Just look at the grid, no task involved |

Plus a skill, `carbon-aware-coding`, which teaches Claude when to reach for
`/ebb-ai:defer` automatically — for example when you say *"do this later"* or
*"by tomorrow"*.

The plugin auto-configures the `ebb-ai` MCP server via `npx -y @ebb-ai/mcp`
on first invocation, so no separate `claude mcp add` step is needed.

### Persistence (new in v0.7.1)

Tasks queued via `/ebb-ai:defer` are persisted to `~/.ebb-ai/queue.db`
(SQLite) by default. The queue survives Claude Code restarts, is
shared across MCP hosts (Claude Code, Claude Desktop, Cursor), and
can be inspected from the CLI:

```bash
npx @ebb-ai/cli list
```

To override the path: set `EBB_DB_PATH=/some/where/queue.db` in the
plugin's `.mcp.json` env block (or your shell). Use
`EBB_DB_PATH=:memory:` to opt out of persistence (mainly useful for
tests).

### Actually dispatching tasks

The MCP server **queues** tasks but does not run a clock. Actual
dispatch at the chosen window requires the **`ebb tick` daemon**:

```bash
npm install -g @ebb-ai/cli
ebb install      # registers launchd (macOS) / systemd (Linux) cron-tick
ebb status       # confirm the tick is wired
```

Until the daemon is installed, tasks sit queued and you can dispatch
them manually with `ebb tick --once`. This is a known v0.7.1 sharp
edge — the plugin install path doesn't auto-install the daemon yet
(adds reasonably-scary system-level state). v0.8 will offer an
interactive opt-in.

### Result delivery

Three options to get the result back after a task completes:

1. **Poll** — `/ebb-ai:check <task_id>` returns the LLM response under
   `result` once the receipt is written.
2. **File output** — pass `--output <abs-path>` at defer time. The
   dispatcher writes `{ taskId, result, receipt }` as JSON to that
   path on completion. Pair with `tail -f` or a file-watcher to get
   a desktop-grade "task done" surface.
3. **CLI inbox** — point `--output` at `~/.ebb-ai/inbox/<id>.json`;
   a tiny `fswatch` / `entr` loop can pick it up and forward to
   Telegram, email, macOS notifications — your choice.

## Example

```
> /ebb-ai:defer "Summarize today's GitHub notifications" --by 4h --region US-CAL-CISO
Deferred ✓
  task id        7f3a2b9e
  scheduled for  in 3h, 22:15 UTC
  est. carbon    0.34 g CO2e
  savings        38% cleaner than running now
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
actual     0.31 g CO2e   (-9%)
result     <the summary>
```

## What ships in the plugin

```
ebb-ai/
├── .claude-plugin/
│   └── plugin.json
├── .mcp.json
├── commands/
│   ├── defer.md
│   ├── check.md
│   └── grid.md
└── skills/
    └── carbon-aware-coding/
        └── SKILL.md
```

The `.mcp.json` declares an `ebb-ai` MCP server that runs `npx -y @ebb-ai/mcp`.
That npm package is the same `@ebb-ai/mcp` you would otherwise install
yourself — the plugin just makes the wiring one command instead of three.

## Without the plugin

If you do not want the slash commands and just want the MCP server itself, you
can still install it directly:

```bash
claude mcp add ebb-ai npx -- -y @ebb-ai/mcp
```

You will get the three MCP tools (`get_grid_forecast`, `schedule_task`,
`check_queue_status`) but not the slash-command shortcuts or the
`carbon-aware-coding` skill.

## License

Apache-2.0. See [`LICENSE`](./LICENSE).
