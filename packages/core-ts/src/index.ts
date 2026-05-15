/**
 * @ebb-ai/core — carbon-aware scheduling for agentic AI workflows.
 *
 * Public surface (v0.2):
 *
 *   import { defer, Scheduler } from "@ebb-ai/core";
 *   import { AnthropicAdapter, OpenAIAdapter } from "@ebb-ai/core/providers";
 *   import { TaskStore } from "@ebb-ai/core/storage";
 *
 * v0.2 additions over v0.1:
 *   - Anthropic + OpenAI provider adapters with sync + Batch API paths.
 *   - SQLite-backed durable queue (opt-in via `new Scheduler({ dbPath })`).
 *   - Carbon-receipt audit trail survives process restart.
 *
 * Out of scope for v0.2 (tracked in ROADMAP.md):
 *   - Cross-provider routing.
 *   - WattTime marginal-emissions feed.
 *   - Gemini / local-Ollama adapters.
 */

export {
  CarbonBudgetExceededError,
  defer,
  InvalidDeadlineError,
  pickBestWindow,
  Scheduler,
} from "./scheduler.js";
export type { SchedulerOptions } from "./scheduler.js";
export { recommendWindow } from "./recommend.js";
export {
  mockGridFeed,
  electricityMapsFeed,
  ukCarbonIntensityFeed,
  eiaFeed,
  entsoeFeed,
  multiSourceGridFeed,
  buildDefaultGridFeed,
} from "./grid.js";
export type {
  DeferOptions,
  GridForecast,
  GridForecastEntry,
  CarbonReceipt,
  ProviderCallSpec,
  RecommendAlternative,
  RecommendOptions,
  RecommendResult,
  TaskRecord,
  TaskStatus,
  TickResult,
  TickResultEntry,
} from "./types.js";
export {
  AnthropicAdapter,
  OpenAIAdapter,
} from "./providers/index.js";
export type {
  BatchHandle,
  DispatchOptions,
  DispatchResult,
  ProviderAdapter,
} from "./providers/index.js";
export { TaskStore } from "./storage/sqlite.js";
export type { TaskStoreOptions } from "./storage/sqlite.js";
