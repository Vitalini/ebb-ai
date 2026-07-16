# @ebb-ai/mcp

Model Context Protocol (MCP) server for **ebb-ai** — exposes carbon-aware
task scheduling as MCP tools that any MCP-compatible agent can call.

## Install (development, monorepo)

```bash
# from the repo root
pnpm install
pnpm --filter @ebb-ai/mcp build
```

## Run

```bash
node packages/mcp-server/dist/server.js
```

The server speaks MCP over stdio. To wire it into an agent client:

### Claude Desktop

Edit `~/Library/Application Support/Claude/claude_desktop_config.json`
on macOS (Linux/Windows have similar paths):

```json
{
  "mcpServers": {
    "ebb-ai": {
      "command": "node",
      "args": [
        "/ABSOLUTE/PATH/TO/ebb-ai/packages/mcp-server/dist/server.js"
      ],
      "env": {
        "EBB_ELECTRICITY_MAPS_API_KEY": "optional - mock data without it",
        "EBB_DEFAULT_REGION": "US-CAL-CISO"
      }
    }
  }
}
```

Restart Claude Desktop after editing.

### Claude Code

Add `ebb-ai` to your `~/.claude/mcp.json` (or workspace `.claude/mcp.json`):

```json
{
  "mcpServers": {
    "ebb-ai": {
      "command": "node",
      "args": ["/ABSOLUTE/PATH/TO/ebb-ai/packages/mcp-server/dist/server.js"]
    }
  }
}
```

### OpenClaw

Add to `~/.openclaw/mcp.json`:

```json
{
  "mcpServers": {
    "ebb-ai": {
      "command": "node",
      "args": ["/ABSOLUTE/PATH/TO/ebb-ai/packages/mcp-server/dist/server.js"]
    }
  }
}
```

## Tools exposed

| Tool | Purpose |
|---|---|
| `get_grid_forecast(region, hours?)` | Hour-by-hour carbon intensity for a region; useful before deciding whether to defer. |
| `schedule_task(prompt, deadline, model?, region?, carbon_budget_g?)` | Queue a task to run in the cleanest window inside the deadline. Returns a task_id. |
| `check_queue_status(task_id?)` | Inspect the queue or one specific task; includes a carbon receipt once the task has completed. |

## Environment variables

| Var | Purpose |
|---|---|
| `EBB_ELECTRICITY_MAPS_API_KEY` | API key from [electricitymaps.com](https://www.electricitymaps.com/free-tier-api). Universal fallback. If unset (and no zone-specific feed is configured), the server falls back to deterministic mock data so you can still run the whole stack locally. |
| `EBB_EIA_API_KEY` | Free [US EIA](https://www.eia.gov/opendata/) key. Enables average-emissions intensity for the US ISO zones (CAISO / ERCOT / ISO-NE / NYISO / PJM / MISO). |
| `EBB_ENTSOE_SECURITY_TOKEN` | Free [ENTSO-E](https://transparency.entsoe.eu/) token. Enables EU zone intensity (FR / DE / ES / IT / NL). |
| `WATTTIME_USERNAME` + `WATTTIME_PASSWORD` | Free [WattTime v3](https://watttime.org/) account. Enables **marginal**-emissions (co2_moer) forecasts for the US ISO zones — takes precedence over EIA where covered, falls through to EIA on any error. The marginal signal is disclosed as `signalType: "marginal"` on forecasts and receipts. |
| `EBB_DEFAULT_REGION` | Electricity Maps zone code, default `US-CAL-CISO`. |
| `ANTHROPIC_API_KEY` | Enables the `anthropic` provider (batch-capable). |
| `OPENAI_API_KEY` | Enables the `openai` provider (batch-capable). |
| `GEMINI_API_KEY` / `GOOGLE_API_KEY` | Enables the `gemini` provider (Generative Language API, sync-only). `GEMINI_API_KEY` is preferred; `GOOGLE_API_KEY` is the fallback. |
| `OLLAMA_HOST` | Enables the local `ollama` provider (sync-only). Default `http://localhost:11434`; keyless — set this var to opt the provider in. |

## v0.1 limitations

- The server schedules dispatch *time*, but does not yet call the
  underlying LLM (the agent is expected to execute the prompt itself once
  the window arrives). Provider adapters and Batch API integration land
  in v0.2.
- Queue is in-memory; restarts lose state. SQLite persistence lands in
  v0.2.
- Single-region grid feed. Multi-region routing lands in v0.3.

See `../../ROADMAP.md` for the full roadmap.
