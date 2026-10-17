/**
 * Vitest setup: point the home directory at a fresh temp dir, so no test
 * reads or creates the developer's real ~/.tidegap or ~/.config/tidegap.
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const home = mkdtempSync(join(tmpdir(), "tidegap-test-home-"));
process.env.HOME = home;
process.env.USERPROFILE = home;
