/**
 * @ebb-ai/core — carbon-aware scheduling for agentic AI workflows.
 *
 * Public surface:
 *
 *   import { defer, Scheduler } from "@ebb-ai/core";
 *
 * v0.1 scope:
 *   - defer(task, opts) — queue a task; resolve with its result when ebb-ai
 *     selects an execution window inside the deadline.
 *   - Scheduler — the in-process orchestrator (queue + grid feed + dispatcher).
 *
 * Out of scope for v0.1 (tracked in PLAN.md):
 *   - Cross-provider routing
 *   - Anthropic/OpenAI Batch API integration
 *   - SQLite-backed durable queue (currently in-memory)
 *   - Carbon-receipt persistence
 */

export { defer, pickBestWindow, Scheduler } from "./scheduler.js";
export { mockGridFeed, electricityMapsFeed } from "./grid.js";
export type {
  DeferOptions,
  GridForecast,
  GridForecastEntry,
  CarbonReceipt,
  TaskRecord,
  TaskStatus,
} from "./types.js";
