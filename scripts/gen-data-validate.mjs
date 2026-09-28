/**
 * Validation for the SSOT data tables read by `gen-data.mjs`. Pure: takes
 * the parsed JSON, returns nothing, throws on the first invalid row. Split
 * out so tests can import it without running the generator.
 */
const STATUSES = new Set(["retired", "deprecated"]);

/**
 * @param {{ energy: { coefficients: Record<string, { status?: string }>, families: Array<{ id: string, representative: string }> }, prices: { prices: Record<string, unknown> } }} tables
 */
export function validateTables({ energy, prices }) {
  const coeffIds = new Set(Object.keys(energy.coefficients));
  for (const fam of energy.families) {
    if (!coeffIds.has(fam.representative)) {
      throw new Error(
        `family "${fam.id}" points at representative "${fam.representative}" which is not a coefficient key`,
      );
    }
  }
  // A lifecycle flag is optional; when present it must be a known value so a
  // typo cannot silently mark a live model as retired (or vice versa).
  for (const [id, c] of Object.entries(energy.coefficients)) {
    if (c.status !== undefined && !STATUSES.has(c.status)) {
      throw new Error(`coefficient "${id}" has unknown status "${c.status}" (expected retired | deprecated)`);
    }
  }
  // Routing scores carbon and cost off ONE model-id space. Every priced model
  // must have an energy coefficient so a routable candidate can be scored on
  // both dimensions; a price for an id the energy table never heard of is a
  // silent typo waiting to mis-score. (The reverse is fine: an energy-only id
  // simply isn't routable.)
  for (const id of Object.keys(prices.prices)) {
    if (!coeffIds.has(id)) {
      throw new Error(
        `price entry "${id}" has no matching energy coefficient key — routing scores carbon+cost off one id space`,
      );
    }
    // A retired model cannot be called, so a price for it is not a routing
    // input: retired rows keep their energy coefficient (old receipts still
    // resolve) but must not be priced.
    if (energy.coefficients[id].status === "retired") {
      throw new Error(`price entry "${id}" belongs to a retired model — remove the price row`);
    }
  }
}
