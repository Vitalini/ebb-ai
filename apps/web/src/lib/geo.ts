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

/** US state / subdivision code → nearest ISO ebb-ai covers. */
const US_STATE_ZONE: Record<string, string> = {
  CA: "US-CAL-CISO", NV: "US-CAL-CISO", OR: "US-CAL-CISO", WA: "US-CAL-CISO",
  AZ: "US-CAL-CISO", ID: "US-CAL-CISO", UT: "US-CAL-CISO", HI: "US-CAL-CISO",
  TX: "US-TEX-ERCO",
  ME: "US-NE-ISNE", NH: "US-NE-ISNE", VT: "US-NE-ISNE", MA: "US-NE-ISNE",
  RI: "US-NE-ISNE", CT: "US-NE-ISNE",
  // every other US state falls through to PJM (the largest US-East grid)
};

/** Non-US country → nearest covered grid zone. */
const COUNTRY_ZONE: Record<string, string> = {
  // British Isles
  GB: "GB", IE: "IE",
  // France · Italy (no IT zone yet → nearest is FR)
  FR: "FR", MC: "FR", IT: "FR",
  // Germany & Alpine
  DE: "DE", AT: "AT", CH: "AT", LI: "AT",
  // Low Countries
  NL: "NL", BE: "BE", LU: "BE",
  // Iberia
  ES: "ES", PT: "ES", AD: "ES",
  // Central & Eastern Europe → Poland
  PL: "PL", CZ: "PL", SK: "PL", HU: "PL", SI: "PL", HR: "PL", RO: "PL",
  BG: "PL", RS: "PL", LT: "PL", LV: "PL", EE: "PL", UA: "PL", GR: "PL",
  // Nordics → Netherlands (nearest North-Sea grid we cover)
  SE: "NL", NO: "NL", DK: "NL", FI: "NL", IS: "NL",
  // East Asia
  JP: "JP-TK", TW: "JP-TK", KR: "KR",
  // South & South-East Asia → Singapore
  SG: "SG", MY: "SG", ID: "SG", TH: "SG", VN: "SG", PH: "SG", HK: "SG",
  IN: "SG", BD: "SG", PK: "SG", CN: "SG",
  // Oceania
  AU: "AU-NSW", NZ: "AU-NSW",
  // North America (non-US)
  CA: "CA-ON", MX: "US-TEX-ERCO",
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
