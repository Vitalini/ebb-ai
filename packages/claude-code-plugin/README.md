# @ebb-ai/claude-code-plugin

Claude Code plugin for ebb-ai — auto-defers "do it later" tasks to the
cleanest electricity-grid hour inside a deadline.

This package is **not** published to npm. It's the plugin tree that
Claude Code's marketplace clones into `~/.claude/plugins/marketplaces/`.

## Files

- `.claude-plugin/plugin.json` — plugin manifest (name, description,
  version, auto-invocation trigger language).
- `.mcp.json` — MCP server wiring. Auto-wires `@ebb-ai/mcp` so the
  scheduler tools (`schedule_task`, `recommend_window`, etc.) are
  available to the agent.
- `commands/*.md` — eight `/ebb-ai:*` slash commands
  (defer, plan, check, cancel, expedite, reschedule, retry, grid).
- `skills/ebb-ai/SKILL.md` — Claude Code Skill that tells the agent
  *when* to auto-invoke `/ebb-ai:defer` based on user phrasing.

## Install (end-user)

```bash
/plugin marketplace add Vitalini/ebb-ai
/plugin install ebb-ai
```

The marketplace listing at `.claude-plugin/marketplace.json` (repo
root) points to this folder via `source: "./packages/claude-code-plugin/"`.

## Related packages

- `@ebb-ai/core` — scheduling logic, grid feeds, SQLite ledger.
- `@ebb-ai/mcp` — MCP server (used by this plugin and by any other
  MCP host).
- `@ebb-ai/cli` — `ebb stats`, `ebb tick`, `ebb install`.
- `@ebb-ai/openclaw-plugin` — same surface, native OpenClaw tools
  (for users on OpenClaw instead of Claude Code).
