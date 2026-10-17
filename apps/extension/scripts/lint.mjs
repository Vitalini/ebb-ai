#!/usr/bin/env node
// Lint the Firefox build with addons-linter (KTD10; `web-ext lint` wraps the
// same linter). Prints one line per error and warning, then the counts.
// Exit 1 on any error. Build first: `node scripts/build.mjs firefox`.

import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import linter from "addons-linter";

const dir = resolve(dirname(fileURLToPath(import.meta.url)), "../dist/firefox");
if (!existsSync(join(dir, "manifest.json"))) {
  console.error(`lint: ${dir} has no manifest.json; run the build first.`);
  process.exit(1);
}

const instance = linter.createInstance({
  config: { _: [dir], logLevel: "fatal", stack: false, pretty: false, warningsAsErrors: false, metadata: false, output: "none", boring: true, selfHosted: false },
  runAsBinary: false,
});
const result = await instance.run();
for (const kind of ["errors", "warnings"]) {
  for (const m of result[kind]) console.log(`${kind.slice(0, -1)}: ${m.code} ${m.file ?? ""} ${m.message}`);
}
const { errors, warnings, notices } = result.summary;
console.log(`addons-linter: ${errors} errors, ${warnings} warnings, ${notices} notices`);
process.exit(errors > 0 ? 1 : 0);
