# ebb-ai

**Carbon-aware scheduling for agentic AI workflows.**
*An MCP server that defers non-urgent AI tasks to the cleanest grid
window inside your deadline. Per-task carbon receipts, Anthropic +
OpenAI Batch API support, SQLite-backed durable queue.*

[![License: Apache-2.0](https://img.shields.io/badge/license-Apache--2.0-5eead4)](./LICENSE)
[![v0.5.0](https://img.shields.io/badge/release-v0.5.0-fbbf24)](https://github.com/Vitalini/ebb-ai/releases/tag/v0.5.0)
[![Tests](https://img.shields.io/badge/tests-169%20passing-22c55e)](#tests)
[![MCP tools](https://img.shields.io/badge/MCP-8%20tools-5eead4)](https://modelcontextprotocol.io)
[![Hosts](https://img.shields.io/badge/MCP%20hosts-10-5eead4)](./QUICKSTART.md)

`ebb-ai` defers non-urgent AI agent tasks to execution windows that are
simultaneously cleaner on the electricity grid and cheaper at the LLM
provider. The same agent code that would have run a synchronous LLM
call now calls `ebb-ai`, which picks the right time and the right route
— and writes a per-task carbon receipt you can audit.

```typescript
import { recommendWindow } from "@ebb-ai/core";

const plan = await recommendWindow({
  deadline: "2026-05-14T08:00:00-04:00",
  region: "US-CAL-CISO",
});

// {
//   scheduledFor:                "2026-05-14T05:00:00.000Z",
//   intensityGCo2PerKwh:         60,
//   band:                        "very_clean",
//   estimatedCarbonGCo2:         0.1,
//   estimatedSavingsVsNowPct:    73,
//   batchEligible:               true,
//   reasoning:
//     "cleanest in-deadline window is 05:00 UTC (very clean mix); " +
//     "~73% cleaner than dispatching now; Batch API saves an " +
//     "additional 50% on cost (24h SLA)"
// }
```

Same call surfaces as an **MCP tool** to any compatible agent host
(Claude Desktop, Claude Code, Cursor, Cline, Continue, Zed,
Windsurf, OpenClaw, OpenAI Codex CLI, Pi). The agent asks
`recommend_window`, sees the plan, then commits via `schedule_task`
— or doesn't.

> **Status:** v0.5 · 2026-05-13 · Anthropic + OpenAI Batch adapters,
> durable SQLite queue, Python port at parity, live dashboard,
> `recommend_window` planning endpoint, always-on `ebb tick` CLI
> with macOS launchd + Linux systemd + pmset/rtcwake wake events,
> full control surface (`cancel_task` / `expedite_task` /
> `update_deadline` / `retry_task`), receipt redaction, file output,
> retry-with-backoff. **169 tests passing across 4 packages and
> 2 languages.**
> See [QUICKSTART.md](./QUICKSTART.md).

### Live demo

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2FVitalini%2Febb-ai&root-directory=apps%2Fdashboard&project-name=ebb-ai-dashboard&repository-name=ebb-ai-dashboard)

Or visit the maintainer-hosted dashboard at
**[ebb-ai.vercel.app](https://ebb-ai.vercel.app)** (or
[ebb-ai.com](https://ebb-ai.com) once DNS propagates) to see live
carbon-intensity forecasts across CAISO, ERCOT, ISO-NE, PJM, France,
and Germany — and to try the carbon-window planner without
installing anything.

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

- [`ROADMAP.md`](./ROADMAP.md) — 24-week execution plan, architecture,
  roadmap, success metrics.
- [`docs/`](./docs/) — design docs, MCP spec proposals (forthcoming).
- [`examples/`](./examples/) — OpenClaw demo skill, Claude Code config.

---

## License

[Apache License 2.0](./LICENSE) — patent grant included.

---

## Contributing

This project is in active early development. Issues and PRs welcome;
see the `ROADMAP.md` roadmap for current scope. Major new features should
be discussed in an issue first to avoid duplicate effort.

---

*Built by [Vitalii Borovyk](https://github.com/Vitalini).*
