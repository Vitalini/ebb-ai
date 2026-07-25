/**
 * Vitest setup — suppress the module-load startup dispatcher.
 *
 * Importing the plugin entry kicks `bootstrapDispatcherOnStartup()`, whose
 * deferred callback would open the DEFAULT `~/.ebb-ai/queue.db`. The suite must
 * stay hermetic on temp DBs, so we opt out here.
 *
 * This used to be `EBB_DISABLE_STARTUP_DISPATCH=1` in `vitest.config.ts`. The
 * plugin bundle now reads ZERO environment variables (ClawScan flags any
 * ambient-environment read in a bundle that also makes network calls), so the
 * opt-out is a function call instead: `suppressStartupDispatch()` for
 * embedders/tests, and the `disableStartupDispatch` plugin-config field inside
 * a gateway. Setup files run before each test file's own imports, and the
 * bootstrap's queue-open is deferred 1s, so the flag is always set in time.
 */

import { suppressStartupDispatch } from "../src/index.js";

suppressStartupDispatch();
