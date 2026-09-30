/**
 * Cross-language parity for the Anthropic sampling allow-list. The fixture
 * `test/fixtures/sampling-allowlist-vectors.json` is shared with
 * `packages/core-py/tests/test_sampling_parity.py`; if the TS and PY
 * predicates drift, one of the two suites goes red.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { supportsSamplingParams } from "../src/providers/anthropic.js";

const fixture = JSON.parse(
  readFileSync(new URL("./fixtures/sampling-allowlist-vectors.json", import.meta.url), "utf8"),
) as { vectors: Array<{ id: string; sampling: boolean }> };

describe("cross-language sampling allow-list vectors", () => {
  it.each(fixture.vectors)("$id -> $sampling", ({ id, sampling }) => {
    expect(supportsSamplingParams(id)).toBe(sampling);
  });
});
