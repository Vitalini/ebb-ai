/**
 * Vitest setup — suppress the module-load startup dispatcher.
 *
 * Importing the plugin entry kicks `bootstrapDispatcherOnStartup()`, whose
 * deferred callback would open the DEFAULT `~/.tidegap/queue.db`. The suite must
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

// No test may post a real desktop notification: the `os` delivery mode spawns
// through this stub unless a test installs its own spawner.
import { EventEmitter } from "node:events";
import { __setDefaultSpawnForTest } from "../src/delivery.js";

__setDefaultSpawnForTest((() => {
  const child = new EventEmitter();
  queueMicrotask(() => child.emit("close", 0));
  return child;
}) as never);
