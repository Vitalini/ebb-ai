#!/usr/bin/env node
// @ebb-ai/cli 0.17.1: the `ebb` bin, and the dist/index.js path that 0.17
// daemon units pin (`node .../@ebb-ai/cli/dist/index.js tick --once`).
// Prints one deprecation line, then runs the @tidegap/cli program.
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

process.stderr.write(
  "@ebb-ai/cli is now @tidegap/cli; install @tidegap/cli (this package stops receiving updates). " +
    "Run `npm uninstall -g @ebb-ai/cli && npm install -g @tidegap/cli`.\n",
);

// Point argv[1] at the real entry: @tidegap/cli runs when it is the script,
// and does not print its own `ebb` alias line on top of this one.
const entry = createRequire(import.meta.url).resolve("@tidegap/cli");
process.argv[1] = entry;
await import(pathToFileURL(entry).href);
