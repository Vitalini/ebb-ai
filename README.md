# ebb-ai

**Carbon-aware scheduling for agentic AI workflows.**

`ebb-ai` defers non-urgent AI agent tasks to execution windows that are
simultaneously cleaner on the electricity grid, cheaper at the LLM
provider, and friendlier to your hardware budget. The same agent code
that would have run a synchronous LLM call now calls `ebb-ai`, which
figures out the right time, the right provider, and the right route —
and writes a per-task carbon receipt you can audit.

> Status: early development · v0.1 · 2026-05 · local-only, no
> public release yet.

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
- **Latency.** Off-peak execution is faster end-to-end. Providers
  throttle and queue at peak.

`ebb-ai` fixes all three for any task that is not "answer me right now."

---

## Components

| Package | Purpose |
|---|---|
| `@ebb-ai/core` | TypeScript core library. `defer(task, opts)` API. |
| `@ebb-ai/mcp` | Model Context Protocol server. Drop-in for Claude Desktop, OpenClaw, Cursor, Claude Code. |
| `ebb-ai` (PyPI) | Python port of the core library. |
| `apps/dashboard` | (planned) Public live map of AI compute carbon intensity. |
| `docs/spec` | (planned) Upstream MCP spec proposals for `priority`, `deadline`, `carbon_budget`. |

---

## Quick start

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
    region: "us-east",
  },
);
```

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
