/**
 * Vitest setup: point the home directory at a fresh temp dir, so no test
 * reads, creates or migrates the developer's real ~/.tidegap or ~/.ebb-ai
 * (`resolveTidegapHome` moves a 0.17 ~/.ebb-ai on first use).
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const home = mkdtempSync(join(tmpdir(), "tidegap-test-home-"));
process.env.HOME = home;
process.env.USERPROFILE = home;
