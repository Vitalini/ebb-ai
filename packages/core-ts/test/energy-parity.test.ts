/**
 * Cross-language model-energy resolution parity (audit §1.8).
 *
 * The fixture `test/fixtures/model-energy-vectors.json` is the single
 * source of truth for how tricky model ids resolve — dated suffixes,
 * provider prefixes, word-order variants, family fallbacks, and fully
 * unknown ids. It is consumed byte-for-byte by BOTH this suite and
 * `packages/core-py/tests/test_energy_parity.py`; if the TS and PY
 * normalization / family-fallback logic drift, one of the two suites
 * goes red.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { resolveModelEnergy } from "../src/energy.js";

interface Vector {
  id: string;
  whPerInputToken: number;
  whPerOutputToken: number;
  source: "measured" | "estimated" | "fallback";
  resolution: "exact" | "normalized" | "family-fallback" | "default";
}

const fixture = JSON.parse(
  readFileSync(
    new URL("./fixtures/model-energy-vectors.json", import.meta.url),
    "utf8",
  ),
) as { vectors: Vector[] };

describe("cross-language model-energy vectors", () => {
  it("covers all four resolution tiers", () => {
    const tiers = new Set(fixture.vectors.map((v) => v.resolution));
    expect(tiers).toEqual(
      new Set(["exact", "normalized", "family-fallback", "default"]),
    );
  });

  for (const v of fixture.vectors) {
    it(`resolves ${JSON.stringify(v.id)} → ${v.resolution} / ${v.source}`, () => {
      const { coeffs, tier } = resolveModelEnergy(v.id);
      expect(tier).toBe(v.resolution);
      expect(coeffs.source).toBe(v.source);
      expect(coeffs.whPerInputToken).toBeCloseTo(v.whPerInputToken, 9);
      expect(coeffs.whPerOutputToken).toBeCloseTo(v.whPerOutputToken, 9);
    });
  }
});
