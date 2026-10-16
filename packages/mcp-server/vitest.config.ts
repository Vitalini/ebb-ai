import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Every test file runs against a temp home dir, never the real one.
    setupFiles: ["./test/hermetic-home.ts"],
  },
});
