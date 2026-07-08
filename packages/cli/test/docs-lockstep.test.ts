/**
 * Docs ↔ CLI lockstep.
 *
 * Follow-up from the site wave (audit §0.9: "the site documented a CLI that
 * didn't exist"). Every `ebb <subcommand>` invocation shown on the marketing
 * site must resolve to a real command registered in the CLI, so the site can
 * never again document a phantom command.
 *
 * Strategy: extract every `ebb <subcommand>` from the documented surfaces
 * (queue/stats pages + install.md) via a simple regex over the raw file
 * contents (read-only; the CLI package never edits apps/web), then assert
 * each first token after `ebb` is a top-level command on `buildProgram()`.
 *
 * Robustness: `ebb-ai` (the product/package name), slash commands
 * (`/ebb-ai:*`), and any non-command word are skipped — only real
 * `ebb <word>` shell invocations are checked.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";

import { buildProgram } from "../src/index.js";

const HERE = dirname(fileURLToPath(import.meta.url));
// packages/cli/test → repo root is three levels up.
const REPO_ROOT = join(HERE, "..", "..", "..");

const DOC_FILES = [
  join(REPO_ROOT, "apps", "web", "src", "app", "queue", "page.tsx"),
  join(REPO_ROOT, "apps", "web", "src", "app", "stats", "page.tsx"),
  join(REPO_ROOT, "apps", "web", "public", "install.md"),
];

/**
 * Match `ebb <subcommand>` invocations. The negative-lookahead-free form:
 *   - `\bebb` — the binary name at a word boundary
 *   - `[ \t]+` — at least one space/tab (so `ebb-ai` cannot match: the char
 *     after `ebb` there is `-`, not whitespace)
 *   - `([a-z][a-z-]*)` — capture the subcommand (lowercase word, may hyphenate,
 *     e.g. `register-wake`)
 */
const EBB_INVOCATION = /\bebb[ \t]+([a-z][a-z-]*)/g;

function documentedSubcommands(): Map<string, string[]> {
  // subcommand → list of doc files that mention it (for a helpful message).
  const found = new Map<string, string[]>();
  for (const file of DOC_FILES) {
    const text = readFileSync(file, "utf8");
    for (const m of text.matchAll(EBB_INVOCATION)) {
      const sub = m[1]!;
      const list = found.get(sub) ?? [];
      if (!list.includes(file)) list.push(file);
      found.set(sub, list);
    }
  }
  return found;
}

describe("docs ↔ CLI lockstep (§0.9 follow-up)", () => {
  const registered = new Set(buildProgram().commands.map((c) => c.name()));

  it("finds at least one documented `ebb <subcommand>` (regex sanity)", () => {
    // Guards against the extraction silently breaking (e.g. a code-block
    // format change) and vacuously passing the lockstep assertion below.
    expect(documentedSubcommands().size).toBeGreaterThan(0);
  });

  it("every documented `ebb <subcommand>` is a registered CLI command", () => {
    const docs = documentedSubcommands();
    const phantom: string[] = [];
    for (const [sub, files] of docs) {
      if (!registered.has(sub)) {
        phantom.push(
          `  "ebb ${sub}" (documented in ${files
            .map((f) => f.replace(REPO_ROOT + "/", ""))
            .join(", ")})`,
        );
      }
    }
    expect(
      phantom,
      phantom.length > 0
        ? `Documented CLI subcommand(s) not registered in packages/cli/src/index.ts:\n${phantom.join(
            "\n",
          )}\nRegistered: ${[...registered].join(", ")}`
        : undefined,
    ).toEqual([]);
  });

  it("does not treat `ebb-ai` as a subcommand", () => {
    // `ebb-ai` appears in prose/package refs across the docs; the regex must
    // not mistake it for `ebb ai`.
    expect([...documentedSubcommands().keys()]).not.toContain("ai");
  });
});
