/**
 * Grid-region resolution shared by every ebb-ai integration — the CLI,
 * the MCP server and the OpenClaw plugin.
 *
 * When no region is given explicitly, ebb-ai guesses one from the host
 * machine's IANA timezone, so a user gets carbon data for their own grid
 * instead of a hard-coded default. An explicit region (a tool argument or
 * a configured default) always takes precedence.
 */

/** Fallback when nothing else resolves — GB has key-less live data. */
export const FALLBACK_REGION = "GB";

/**
 * Best-effort IANA-timezone → grid-region map. Only timezones whose
 * dominant grid is unambiguous are listed; anything else resolves to
 * FALLBACK_REGION. Users in other regions set the region explicitly.
 */
export const TIMEZONE_REGION: Readonly<Record<string, string>> = {
  "Europe/London": "GB",
  "Europe/Paris": "FR",
  "Europe/Berlin": "DE",
  "Europe/Busingen": "DE",
  "America/Los_Angeles": "US-CAL-CISO",
  "America/New_York": "US-MIDA-PJM",
  "America/Detroit": "US-MIDA-PJM",
};

/** How a resolved region was chosen. */
export type RegionSource = "request" | "config" | "timezone" | "default";

export type RegionResolution = {
  region: string;
  source: RegionSource;
};

/** Map an IANA timezone to a supported grid region, or undefined. */
export function regionForTimezone(timeZone: string): string | undefined {
  return TIMEZONE_REGION[timeZone];
}

/** Guess the grid region from the host machine's IANA timezone. */
export function detectRegionFromTimezone(): string | undefined {
  try {
    return regionForTimezone(Intl.DateTimeFormat().resolvedOptions().timeZone);
  } catch {
    return undefined;
  }
}

/**
 * Resolve a grid region. Precedence:
 *   1. an explicit request region (a tool argument / CLI flag),
 *   2. a configured default (plugin config / EBB_DEFAULT_REGION),
 *   3. a guess from the host machine's timezone,
 *   4. FALLBACK_REGION.
 */
export function resolveRegion(
  requested?: string,
  configuredDefault?: string,
): RegionResolution {
  if (requested) return { region: requested, source: "request" };
  if (configuredDefault) {
    return { region: configuredDefault, source: "config" };
  }
  const detected = detectRegionFromTimezone();
  if (detected) return { region: detected, source: "timezone" };
  return { region: FALLBACK_REGION, source: "default" };
}
