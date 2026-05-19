# Quick start

**One command. Thirty seconds. Carbon-aware AI scheduling in any MCP host.**

---

## Step 1 — Install in your AI host

### Claude Code (one line)

```
/plugin marketplace add Vitalini/ebb-ai
/plugin install ebb-ai
```

Auto-wires the MCP server and adds eight `/ebb-ai:*` slash commands.

### Cursor · Claude Desktop · any other MCP host

Add the MCP server to your host's config:

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

Locations:
- **Claude Desktop:** `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) · `%APPDATA%\Claude\claude_desktop_config.json` (Windows)
- **Cursor:** `~/.cursor/mcp.json` or Settings → MCP
- **Cline / Windsurf / Zed / Continue / Goose / OpenClaw:** see the host-specific snippets at <https://www.ebb-ai.com/#install>

### Python library (no MCP)

```bash
pip install ebb-ai
```

Use the `ebb_ai.Scheduler` API directly.

### TypeScript / Node library (no MCP)

```bash
pnpm add @ebb-ai/core
```

Import `createScheduler`, `recommendWindow`, `TaskStore` from `@ebb-ai/core`.

---

## Step 2 — Try it

In any chat session with the host you installed it in, type a request
with deferral phrasing:

```
defer "summarize my GitHub notifications" by tomorrow 6pm
```

The agent picks up the trigger automatically and queues the task at
the cleanest electricity-grid hour inside the deadline. You get a
`task_id` immediately; the actual LLM call fires later.

Equivalent explicit form:

```
/ebb-ai:defer "summarize my GitHub notifications" --by tomorrow 6pm
```

---

## Step 3 — Run the tick daemon (for actual dispatch)

The MCP server **queues** tasks but doesn't run a clock. To actually
dispatch at the chosen window, install the CLI's tick daemon once:

```bash
npm install -g @ebb-ai/cli
ebb install      # registers launchd (macOS) or systemd (Linux) cron
ebb status       # confirm the tick is wired
```

Without the daemon, tasks sit queued; you can dispatch manually with
`ebb tick --once`.

---

## Step 4 — (Optional) live grid data for more regions

GB is always live via UK National Grid ESO with no API key. To unlock
live data for the US and EU regions, set any of:

```bash
export EBB_EIA_API_KEY="..."              # US ISOs (free at eia.gov)
export EBB_ENTSOE_SECURITY_TOKEN="..."    # Europe (free at transparency.entsoe.eu)
export EBB_ELECTRICITY_MAPS_API_KEY="..." # universal fallback (free at electricitymaps.com)
```

Without any of these, ebb-ai uses a deterministic mock curve so the
stack still works end-to-end (useful for demos and CI).

---

## Where to go next

- **Live carbon map + planner:** <https://www.ebb-ai.com/>
- **Full docs (all 8 commands + 9 MCP tools + install matrix):** <https://www.ebb-ai.com/docs>
- **Why it exists:** <https://www.ebb-ai.com/about>
- **Architecture:** <https://www.ebb-ai.com/architecture>
- **Source / issues / CHANGELOG:** <https://github.com/Vitalini/ebb-ai>

---

## Developer setup (only if hacking on ebb-ai itself)

```bash
git clone https://github.com/Vitalini/ebb-ai
cd ebb-ai
pnpm install
pnpm -r build       # build every package in the workspace
pnpm -r test        # 204 tests across TS + Python
```

Requirements: **Node 20+**, **pnpm 9+**, **Python 3.11+** for the
Python port.

Then:

```bash
pnpm --filter @ebb-ai/web dev   # local dashboard at :3000
```

See `apps/web/README.md` for dashboard-specific details.
