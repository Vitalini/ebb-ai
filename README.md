# ebb-ai

**Carbon-aware scheduling for agentic AI workflows.**
*An MCP server that defers non-urgent AI tasks to the cleanest grid
window inside your deadline. Per-task carbon receipts, Anthropic +
OpenAI Batch API support, SQLite-backed durable queue.*

[![License: Apache-2.0](https://img.shields.io/badge/license-Apache--2.0-5eead4)](./LICENSE)
[![v0.4.0](https://img.shields.io/badge/release-v0.4.0-fbbf24)](https://github.com/Vitalini/ebb-ai/releases/tag/v0.4.0)
[![Tests](https://img.shields.io/badge/tests-125%20passing-22c55e)](#tests)
[![MCP](https://img.shields.io/badge/MCP-10%20hosts-5eead4)](https://modelcontextprotocol.io)

`ebb-ai` defers non-urgent AI agent tasks to execution windows that are
simultaneously cleaner on the electricity grid and cheaper at the LLM
provider. The same agent code that would have run a synchronous LLM
call now calls `ebb-ai`, which picks the right time and the right route
— and writes a per-task carbon receipt you can audit.

```text
$ ebb-mcp tool call recommend_window \
    '{"deadline":"+12h","region":"US-CAL-CISO"}'
{
  "scheduled_for": "2026-05-13T07:00:00Z",
  "intensity_g_co2_per_kwh": 96,
  "band": "very_clean",
  "estimated_carbon_g_co2": 0.14,
  "estimated_savings_vs_now_pct": 67,
  "batch_eligible": false,
  "reasoning": "cleanest in-deadline window is 07:00 UTC; ~67% cleaner than dispatching now"
}
```

> **Status:** v0.4 · 2026-05-12 · Anthropic + OpenAI Batch adapters,
> durable SQLite queue, Python port, live dashboard, `recommend_window`
> planning endpoint, always-on `ebb tick` CLI with macOS launchd +
> pmset wake. **125 tests passing**.
> See [QUICKSTART.md](./QUICKSTART.md) for the 5-step install.

---

## Why

Modern AI agents call LLM APIs synchronously by default. Three costs
follow:

- **Carbon.** Grid carbon intensity varies 30 to 60 percent inside a
  single day across the major US ISOs. Inference at 2 p.m. on a hot
  day is materially dirtier than the same call at 3 a.m.
- **Dollars.** Anthropic and OpenAI both offer batch APIs at a flat 50
  percent discount for tasks that can wait up to 24 hours. Almost no
  agent code uses them by default, because it requires rewriting the
  call site.
- **Latency, honestly.** Off-peak *sync* execution is sometimes
  faster because providers throttle and queue at peak. **Batch API
  is *not* faster** — it trades latency (up to 24h SLA) for the
  50% discount. We pitch carbon + cost first; latency is a third-tier
  side effect.

`ebb-ai` fixes all three for any task that is not "answer me right now."

---

## Components

| Package | Purpose |
|---|---|
| `@ebb-ai/core` | TypeScript core library (v0.2). `defer()` API, `AnthropicAdapter`, `OpenAIAdapter`, opt-in SQLite-backed durable queue. |
| `@ebb-ai/mcp` | Model Context Protocol server (v0.2). Drop-in for Claude Desktop, Claude Code, OpenClaw, Cursor. |
| `ebb-ai` (Python) | Python 3.11+ port. `asyncio` scheduler, `aiosqlite` persistence, Anthropic + OpenAI adapters. |
| `apps/dashboard` | Next.js 15 dashboard. Live carbon-intensity map, 72-hour forecast, planner, queue viewer. |
| `apps/site` | Static landing site: hero, components, integrations, install paths, architecture, roadmap, docs. |
| `docs/spec` | Upstream MCP spec proposal for `priority`, `deadline`, `carbon_budget` fields. |

---

## Quick start

**See [QUICKSTART.md](./QUICKSTART.md) — four steps, five minutes.**

### As an MCP server (recommended path)

```bash
# from this repo, after the install step below
pnpm --filter @ebb-ai/mcp build
node packages/mcp-server/dist/server.js
```

Then add to Claude Desktop's MCP config
(`~/Library/Application Support/Claude/claude_desktop_config.json` on
macOS):

```json
{
  "mcpServers": {
    "ebb-ai": {
      "command": "node",
      "args": ["/absolute/path/to/ebb-ai/packages/mcp-server/dist/server.js"],
      "env": {
        "EBB_ELECTRICITY_MAPS_API_KEY": "optional; falls back to mock data without it"
      }
    }
  }
}
```

The MCP server exposes three tools to the agent:

- `get_grid_forecast(region, hours?)` — returns the next N hours of
  carbon intensity for a grid region (e.g. `US-CAL-CISO`).
- `schedule_task(prompt, deadline, model?, carbon_budget_g?)` — queues a
  task for execution at the cleanest window inside the deadline.
- `check_queue_status(task_id?)` — lists pending tasks and any
  completed receipts.

### As a library

```typescript
import { defer } from "@ebb-ai/core";

const result = await defer(
  () => anthropic.messages.create({ /* … */ }),
  {
    deadline: "2026-05-13T08:00:00-04:00",
    carbonBudgetG: 5,
    region: "US-CAL-CISO",
  },
);
```

### With a provider adapter and the Batch API (v0.2)

```typescript
import { Scheduler, AnthropicAdapter } from "@ebb-ai/core";

const scheduler = new Scheduler({ dbPath: "/var/lib/ebb/queue.sqlite" });
const adapter = new AnthropicAdapter();

await scheduler.defer(
  () => adapter.dispatch("claude-sonnet-4-5", "Summarize today's git commits."),
  { deadline: "2026-05-13T08:00:00-04:00", region: "US-CAL-CISO" },
);

// or — submit 100 prompts via Anthropic Message Batches for a 50% discount:
const handle = await adapter.dispatchBatch("claude-sonnet-4-5", prompts);
console.log(handle.batchId);
```

The SQLite-backed queue is opt-in via `dbPath`; without it the
scheduler runs in-memory as in v0.1. The Anthropic and OpenAI SDKs are
peer dependencies — install them only if you use the corresponding
adapter.

### Python

```bash
pip install -e "packages/core-py[anthropic,openai]"
```

```python
import asyncio
from ebb_ai import defer

asyncio.run(defer(
    lambda: do_work(),
    deadline="2026-05-13T08:00:00-04:00",
    carbon_budget_g=5,
    region="US-CAL-CISO",
))
```

### Dashboard

```bash
pnpm --filter @ebb-ai/dashboard dev
# → http://localhost:3000
```

Pages: live carbon-intensity map (6 regions), 72-hour forecast charts,
best-window planner, queue viewer.

---

## Install (development)

```bash
# from the repo root
pnpm install        # installs all workspace packages
pnpm build          # builds @ebb-ai/core and @ebb-ai/mcp
pnpm test           # runs vitest across packages
```

Requirements: Node 20+, pnpm 9+. Python 3.11+ if working on the Python
package.

---

## Documentation

- [`PLAN.md`](./PLAN.md) — 24-week execution plan, architecture,
  roadmap, success metrics.
- [`docs/`](./docs/) — design docs, MCP spec proposals (forthcoming).
- [`examples/`](./examples/) — OpenClaw demo skill, Claude Code config.

---

## License

[Apache License 2.0](./LICENSE) — patent grant included.

---

## Contributing

This project is in active early development. Issues and PRs welcome;
see the `PLAN.md` roadmap for current scope. Major new features should
be discussed in an issue first to avoid duplicate effort.

---

*Built by [Vitalii Borovyk](https://github.com/Vitalini).*
