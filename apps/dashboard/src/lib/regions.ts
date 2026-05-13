/**
 * Curated list of regions the dashboard surfaces.
 *
 * The selection mirrors the regions where major US/EU LLM providers run
 * inference workloads:
 *   - US-CAL-CISO   — California ISO, heart of West-Coast cloud
 *                     (us-west-2 AWS, us-central1 GCP variant)
 *   - US-TEX-ERCO   — ERCOT, growing share of AI training capacity
 *   - US-NE-ISNE    — ISO New England, host to several Azure regions
 *   - US-MIDA-PJM   — PJM (mid-Atlantic / Virginia), the biggest US-East
 *                     data-center cluster, where Anthropic + OpenAI lean
 *   - FR            — France, nuclear-heavy, where Anthropic Europe and
 *                     Mistral run
 *   - DE            — Germany, large data-center hub, dirtier grid
 *
 * The zone codes match Electricity Maps. Updating this list automatically
 * updates the homepage grid.
 */

export interface Region {
  /** Electricity Maps zone code. */
  zone: string;
  /** Short label used in the dashboard cards. */
  name: string;
  /** Longer label used on the forecast page header. */
  longName: string;
  /** Hint about which LLM/cloud workloads typically run here. */
  provider: string;
  /** Approximate UTC offset hours (informational only). */
  utcOffset: number;
}

export const REGIONS: Region[] = [
  {
    zone: "US-CAL-CISO",
    name: "California ISO",
    longName: "California (CAISO)",
    provider: "AWS us-west-2 · GCP us-west1",
    utcOffset: -8,
  },
  {
    zone: "US-TEX-ERCO",
    name: "Texas ERCOT",
    longName: "Texas (ERCOT)",
    provider: "Azure South Central · GCP us-south1",
    utcOffset: -6,
  },
  {
    zone: "US-NE-ISNE",
    name: "New England",
    longName: "New England ISO",
    provider: "Azure East US 2 fringes",
    utcOffset: -5,
  },
  {
    zone: "US-MIDA-PJM",
    name: "PJM Mid-Atlantic",
    longName: "PJM (Mid-Atlantic / Virginia)",
    provider: "AWS us-east-1 · Anthropic primary",
    utcOffset: -5,
  },
  {
    zone: "FR",
    name: "France",
    longName: "France (RTE)",
    provider: "AWS eu-west-3 · OpenAI Europe",
    utcOffset: 1,
  },
  {
    zone: "DE",
    name: "Germany",
    longName: "Germany (50Hertz / TenneT)",
    provider: "AWS eu-central-1 · Azure West Europe",
    utcOffset: 1,
  },
];

export const REGION_BY_ZONE: Record<string, Region> = Object.fromEntries(
  REGIONS.map((r) => [r.zone, r]),
);

export function findRegion(zone: string | undefined | null): Region | undefined {
  if (!zone) return undefined;
  return REGION_BY_ZONE[zone];
}
