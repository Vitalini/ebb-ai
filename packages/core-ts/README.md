# @ebb-ai/core

Carbon-aware scheduling for agentic AI workflows — the core TypeScript library.

`@ebb-ai/core` lets your code wait for cleaner grid-energy windows before
dispatching deferrable LLM calls. It ships:

- `defer(fn, { deadline, region, carbonBudgetG })` — wrap any async task.
- `Scheduler` — opt-in SQLite-backed durable queue (`new Scheduler({ dbPath })`).
- Provider adapters for Anthropic + OpenAI, with sync and Batch API paths.
- Grid carbon-intensity feeds:
  - `mockGridFeed()` — deterministic synthetic curve.
  - `electricityMapsFeed(apiKey)` — Electricity Maps free-tier API.
  - `ukCarbonIntensityFeed()` — UK National Grid ESO (free, no key, GB only).
  - `multiSourceGridFeed({ feeds, fallback })` — per-zone routing.
- `recommendWindow({ region, deadline })` — planning-only API; returns the
  cleanest window without queueing.

## Install

```bash
npm install @ebb-ai/core
# optional adapters; install only what you use
npm install @anthropic-ai/sdk openai
```

## Quick start

```ts
import { defer } from "@ebb-ai/core";

const summary = await defer(
  async () => callAnthropic("Summarize today's CHANGELOG"),
  { deadline: "2026-05-15T09:00:00Z", region: "US-CAL-CISO" },
);
```

## Documentation

Full docs, MCP server, dashboard, and architecture in the
[monorepo README](https://github.com/Vitalini/ebb-ai).

## License

Apache-2.0.
