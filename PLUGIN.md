# ebb-ai · Claude Code plugin

`ebb-ai` ships a Claude Code plugin that wires the ebb-ai MCP server and three
slash commands into your CLI in one step.

## Install

```bash
# 1. Add the marketplace (this repo)
claude plugin marketplace add Vitalini/ebb-ai

# 2. Install the plugin
claude plugin install ebb-ai
```

That's it. Restart `claude` and the plugin is live:

- `/ebb-ai:defer "<task>" --by 24h` — schedule a deferrable LLM task for the
  cleanest grid-energy window inside the deadline.
- `/ebb-ai:check [<task_id>]` — check status of one task or list all pending.
- `/ebb-ai:grid [<zone>]` — current and 24-hour carbon intensity for a region.

Plus a skill, `carbon-aware-coding`, which teaches Claude when to reach for
`/ebb-ai:defer` automatically — for example when you say *"do this later"* or
*"by tomorrow"*.

The plugin auto-configures the `ebb-ai` MCP server via `npx -y @ebb-ai/mcp`
on first invocation, so no separate `claude mcp add` step is needed.

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
