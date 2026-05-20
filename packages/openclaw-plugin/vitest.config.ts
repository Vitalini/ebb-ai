import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// The OpenClaw plugin SDK is provided by the runtime, not installed as a
// dependency. Alias the SDK import to a local stub so the plugin entry can be
// loaded and its tools exercised under vitest.
export default defineConfig({
  test: {
    alias: {
      "openclaw/plugin-sdk/tool-plugin": fileURLToPath(
        new URL("./test/stub-tool-plugin.ts", import.meta.url),
      ),
    },
  },
});
