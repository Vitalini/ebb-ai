/**
 * Visitor-region detection from Vercel's edge geo headers.
 *
 * Vercel adds `x-vercel-ip-country` / `x-vercel-ip-country-region` to
 * every request — free, no permission prompt, country / US-state
 * granularity. We map that to the nearest grid zone ebb-ai covers. No
 * match (or local dev with no header) → GB, the keyless always-live
 * default, flagged `fallback` so the UI can phrase it honestly.
 */

import { findRegion, REGION_BY_ZONE, type Region } from "./regions";

export type VisitorRegion = {
  region: Region;
  /** "geo" — matched the visitor's country/state; "fallback" — no match. */
  source: "geo" | "fallback";
  /** Raw ISO country code, when Vercel provided one. */
  country?: string;
};

/** US state / subdivision code → nearest covered grid zone. */
const US_STATE_ZONE: Record<string, string> = {
  // CAISO (West / desert)
  CA: "US-CAL-CISO", NV: "US-CAL-CISO", AZ: "US-CAL-CISO", UT: "US-CAL-CISO", HI: "US-CAL-CISO",
  // BPAT (Pacific Northwest)
  OR: "US-NW-BPAT", WA: "US-NW-BPAT", ID: "US-NW-BPAT", MT: "US-NW-BPAT", WY: "US-NW-BPAT",
  // ERCOT
  TX: "US-TEX-ERCO",
  // ISO New England
  ME: "US-NE-ISNE", NH: "US-NE-ISNE", VT: "US-NE-ISNE", MA: "US-NE-ISNE",
  RI: "US-NE-ISNE", CT: "US-NE-ISNE",
  // NYISO
  NY: "US-NY-NYIS",
  // MISO (Midwest)
  IL: "US-MIDW-MISO", IN: "US-MIDW-MISO", IA: "US-MIDW-MISO", MN: "US-MIDW-MISO",
  MO: "US-MIDW-MISO", WI: "US-MIDW-MISO", MI: "US-MIDW-MISO", AR: "US-MIDW-MISO",
  MS: "US-MIDW-MISO", LA: "US-MIDW-MISO", ND: "US-MIDW-MISO", SD: "US-MIDW-MISO",
  KY: "US-MIDW-MISO",
  // FPL / Southeast
  FL: "US-FLA-FPL", GA: "US-FLA-FPL", SC: "US-FLA-FPL", AL: "US-FLA-FPL",
  NC: "US-FLA-FPL", TN: "US-FLA-FPL",
  // every other US state falls through to PJM (the largest US-East grid)
};

/** Non-US country → nearest covered grid zone. */
const COUNTRY_ZONE: Record<string, string> = {
  // British Isles
  GB: "GB", IE: "IE",
  // France
  FR: "FR", MC: "FR",
  // Italy
  IT: "IT-NO", SM: "IT-NO", VA: "IT-NO", MT: "IT-NO",
  // Germany & Alpine
  DE: "DE", AT: "AT", CH: "AT", LI: "AT",
  // Low Countries
  NL: "NL", BE: "BE", LU: "BE",
  // Iberia
  ES: "ES", PT: "ES", AD: "ES",
  // Central & Eastern Europe → Poland
  PL: "PL", CZ: "PL", SK: "PL", HU: "PL", SI: "PL", HR: "PL", RO: "PL",
  BG: "PL", RS: "PL", LT: "PL", LV: "PL", EE: "PL", UA: "PL", GR: "PL",
  // Nordics (own zones now)
  SE: "SE-SE3", NO: "NO-NO1", DK: "DK-DK1", FI: "FI", IS: "SE-SE3",
  // East Asia
  JP: "JP-TK", TW: "JP-TK", KR: "KR",
  // South Asia → India (Mumbai)
  IN: "IN-WE", BD: "IN-WE", PK: "IN-WE", LK: "IN-WE", NP: "IN-WE",
  // South-East Asia & Greater China → Singapore
  SG: "SG", MY: "SG", ID: "SG", TH: "SG", VN: "SG", PH: "SG", HK: "SG",
  CN: "SG", MO: "SG", BN: "SG", KH: "SG", LA: "SG", MM: "SG",
  // Oceania
  AU: "AU-NSW", NZ: "NZ", FJ: "NZ", PG: "AU-NSW",
  // North America (non-US)
  CA: "CA-ON", MX: "US-TEX-ERCO",
  // Sub-Saharan Africa → South Africa
  ZA: "ZA", NA: "ZA", BW: "ZA", ZW: "ZA", MZ: "ZA", SZ: "ZA", LS: "ZA",
  // Middle East & North Africa → UAE
  AE: "AE", SA: "AE", QA: "AE", KW: "AE", OM: "AE", BH: "AE",
  IL: "AE", JO: "AE", LB: "AE", EG: "AE", TR: "AE",
};

function pick(zone: string): Region {
  return findRegion(zone) ?? REGION_BY_ZONE.GB!;
}

/** Resolve the visitor's nearest covered grid region from request headers. */
export function resolveVisitorRegion(headers: Headers): VisitorRegion {
  const country = headers.get("x-vercel-ip-country")?.toUpperCase() || undefined;
  const state =
    (headers.get("x-vercel-ip-country-region") || "")
      .split("-")
      .pop()
      ?.toUpperCase() || "";

  if (country === "US") {
    return {
      region: pick(US_STATE_ZONE[state] ?? "US-MIDA-PJM"),
      source: "geo",
      country,
    };
  }
  if (country && COUNTRY_ZONE[country]) {
    return { region: pick(COUNTRY_ZONE[country]), source: "geo", country };
  }
  return { region: pick("GB"), source: "fallback", country };
}
