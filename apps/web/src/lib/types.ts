/**
 * Grid/forecast types for the dashboard — re-exported from @ebb-ai/core.
 *
 * These used to be a hand-maintained copy of `packages/core-ts/src/types.ts`
 * (v0.2's "zero workspace deps" stance). As of audit §2.3 the dashboard is a
 * real consumer of core: the types now come straight from `@ebb-ai/core/types`
 * (a browser-safe subpath that pulls in no Node-only modules), so they can
 * never drift again.
 *
 * `CarbonBand` is the one local convenience: core inlines the band union on
 * `GridForecastEntry["band"]` rather than exporting a named alias, so we derive
 * the alias here for the components that annotate with it.
 */

export type {
  GridForecast,
  GridForecastEntry,
} from "@ebb-ai/core/types";

import type { GridForecastEntry } from "@ebb-ai/core/types";

/** The five carbon-intensity bands, as classified on each forecast entry. */
export type CarbonBand = GridForecastEntry["band"];
