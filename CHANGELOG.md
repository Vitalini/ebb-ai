# Changelog

All notable changes to ebb-ai will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.2.0] — 2026-05-12

### Added
- **Provider adapters.** `AnthropicAdapter` and `OpenAIAdapter` in
  `@ebb-ai/core/providers`. Each adapter exposes `dispatch()` for
  sync calls and `dispatchBatch()` for the vendor Batch API (50%
  discount, 24h SLA). SDKs are peer dependencies and imported lazily,
  so missing-SDK callers still get a clear error rather than a
  module-load crash.
- **SQLite-backed durable queue.** Opt-in via `new Scheduler({ dbPath })`.
  Every state transition writes through to an on-disk audit ledger;
  records survive process restart and can be reloaded with
  `Scheduler.listPersistedTasks()` / `Scheduler.loadPersistedTask()`.
- **Python port.** `packages/core-py/` ships a complete Python 3.11+
  package (`ebb_ai`) with `asyncio` scheduler, `aiosqlite` persistence
  from day one, and `AnthropicAdapter` + `OpenAIAdapter` mirrors. 41/41
  pytest cases passing.
- **Dashboard MVP.** `apps/dashboard/` is a Next.js 15 app router
  application with four pages (Home, Forecast, Plan, Queue), 6 grid
  regions, recharts visualizations, and live `/api/grid/[region]` +
  `/api/queue` endpoints. Mock fallback when no Electricity Maps key
  is set.
- **Site expansion.** `apps/site/` now ships `architecture.html` (SVG
  diagram + 8-step data flow), `roadmap.html` (v0.1 → v1.0 with
  versioned status pills), and `docs.html` (categorized GitHub-linked
  index).
- Real MCP-protocol smoke test using `InMemoryTransport`.
- `CHANGELOG.md`, `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, `CODEOWNERS`.
- `docs/spec/01-priority-and-deadline-fields.md` — draft proposal for
  upstream MCP spec engagement.

### Changed
- `@ebb-ai/core` bumped to **0.2.0**, `@ebb-ai/mcp` bumped to **0.2.0**.
- Public surface expanded with `AnthropicAdapter`, `OpenAIAdapter`,
  `TaskStore`, and the supporting types `BatchHandle`,
  `DispatchOptions`, `DispatchResult`, `ProviderAdapter`,
  `TaskStoreOptions`.

### Known limitations (planned for v0.3)
- Scheduler does not yet auto-route between sync and Batch paths based
  on deadline distance — adapters expose both, but the v0.2 scheduler
  still treats the task body as opaque. Wiring the routing decision
  into the scheduler is the lead v0.3 item.
- WattTime marginal-emissions feed is still pending.
- Multi-writer (multiple schedulers pointed at one DB) requires WAL
  mode; v0.2 SQLite store assumes single writer.

## [0.1.0] — 2026-05-12

### Added
- `@ebb-ai/core` — TypeScript core library: `Scheduler` class,
  `defer()` function, `pickBestWindow` helper.
- `@ebb-ai/mcp` — Model Context Protocol server exposing
  `get_grid_forecast`, `schedule_task`, and `check_queue_status`
  tools over stdio.
- Mock and Electricity Maps grid feeds with automatic fallback when
  no API key is configured.
- Carbon budget enforcement: `carbonBudgetG` in `DeferOptions` is now
  honored; tasks fail with `CarbonBudgetExceededError` when no
  in-deadline window meets the budget.
- ISO-8601 deadline validation: invalid or past deadlines throw
  `InvalidDeadlineError` at the scheduler boundary and the MCP
  request validator.
- Reference integrations for Claude Desktop, Claude Code, OpenClaw,
  and OpenAI Codex CLI in `examples/`.
- Static landing site under `apps/site/` (no JS, no framework).
- 24-week project plan in `PLAN.md`.

### Fixed
- (Pre-v0.1.0 engineering review.) Carbon budget was previously
  captured but unenforced; `schedule_task` accepted unparseable and
  past deadlines silently; Electricity Maps fetch had no timeout;
  README and landing page used a non-existent region code
  `"us-east"`; Claude Code install flow documented a config path the
  client does not read. All addressed before v0.1 ship.

### Known limitations (planned for v0.2)
- The MCP server schedules dispatch time but does not invoke the LLM
  itself. The agent calling the tool is expected to execute the
  prompt when the window arrives.
- Queue is in-memory; restarts lose state. SQLite-backed durable
  queue is planned for v0.2.
- No provider adapters yet for Anthropic Message Batches or OpenAI
  Batches APIs. Direct Batch routing lands in v0.2.
- Python port (`ebb-ai` PyPI) is a placeholder. v0.2.

[Unreleased]: https://github.com/Vitalini/ebb-ai/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/Vitalini/ebb-ai/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/Vitalini/ebb-ai/releases/tag/v0.1.0
