/**
 * Guards in the SSOT data generator (scripts/gen-data-validate.mjs): an
 * unknown lifecycle status and a price row on a retired model both throw.
 */
import { describe, expect, it } from "vitest";
// @ts-expect-error — plain .mjs script without type declarations
import { validateTables } from "../../../scripts/gen-data-validate.mjs";

const coeff = { whPerInputToken: 0.001, whPerOutputToken: 0.003, source: "test" };
const price = { inUsdPerMtok: 1, outUsdPerMtok: 5, asOf: "2026-09-01", source: "test" };

describe("gen-data validateTables", () => {
  it("accepts valid tables", () => {
    expect(() =>
      validateTables({
        energy: { coefficients: { live: coeff, old: { ...coeff, status: "retired" } }, families: [] },
        prices: { prices: { live: price } },
      }),
    ).not.toThrow();
  });

  it("throws on an unknown status", () => {
    expect(() =>
      validateTables({
        energy: { coefficients: { m: { ...coeff, status: "retird" } }, families: [] },
        prices: { prices: {} },
      }),
    ).toThrow(/unknown status "retird"/);
  });

  it("throws on a price row for a retired model", () => {
    expect(() =>
      validateTables({
        energy: { coefficients: { m: { ...coeff, status: "retired" } }, families: [] },
        prices: { prices: { m: price } },
      }),
    ).toThrow(/belongs to a retired model/);
  });
});
