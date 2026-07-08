import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// The OpenClaw plugin SDK is provided by the runtime, not installed as a
// dependency. Alias the SDK import to a local stub so the plugin entry can be
// loaded and its tools exercised under vitest.
export default defineConfig({
  test: {
    // The module-load startup dispatcher opens the DEFAULT ~/.ebb-ai/queue.db.
    // Disable it for the suite so tests stay hermetic on temp DBs; the startup
    // test re-enables it explicitly via bootstrapDispatcherOnStartup().
    env: {
      EBB_DISABLE_STARTUP_DISPATCH: "1",
    },
    alias: {
      "openclaw/plugin-sdk/tool-plugin": fileURLToPath(
        new URL("./test/stub-tool-plugin.ts", import.meta.url),
      ),
    },
  },
});
