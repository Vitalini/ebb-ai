/**
 * Curated list of grid regions the site surfaces — the electricity
 * grids behind the major US / EU / Asia-Pacific cloud + AI-inference
 * regions. Zone codes match the Electricity Maps API. The homepage map,
 * the forecast/plan pickers and visitor geo-detection all derive from
 * this list, so adding a region here lights it up everywhere.
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
    zone: "GB",
    name: "Great Britain",
    longName: "Great Britain (National Grid ESO)",
    provider: "AWS eu-west-2 · Azure UK South",
    utcOffset: 0,
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
  {
    zone: "IE",
    name: "Ireland",
    longName: "Ireland (EirGrid)",
    provider: "AWS eu-west-1 · Azure North Europe",
    utcOffset: 0,
  },
  {
    zone: "NL",
    name: "Netherlands",
    longName: "Netherlands (TenneT NL)",
    provider: "Google europe-west4 · Azure West Europe",
    utcOffset: 1,
  },
  {
    zone: "ES",
    name: "Spain",
    longName: "Spain (Red Eléctrica)",
    provider: "AWS eu-south-2 · GCP europe-southwest1",
    utcOffset: 1,
  },
  {
    zone: "BE",
    name: "Belgium",
    longName: "Belgium (Elia)",
    provider: "Google europe-west1",
    utcOffset: 1,
  },
  {
    zone: "AT",
    name: "Austria",
    longName: "Austria (APG)",
    provider: "Central-EU low-carbon grid",
    utcOffset: 1,
  },
  {
    zone: "PL",
    name: "Poland",
    longName: "Poland (PSE)",
    provider: "Google europe-central2 · Azure Poland Central",
    utcOffset: 1,
  },
  {
    zone: "JP-TK",
    name: "Japan · Tokyo",
    longName: "Japan — Tokyo (TEPCO)",
    provider: "AWS ap-northeast-1 · Azure Japan East",
    utcOffset: 9,
  },
  {
    zone: "KR",
    name: "South Korea",
    longName: "South Korea (KPX)",
    provider: "AWS ap-northeast-2 · Azure Korea Central",
    utcOffset: 9,
  },
  {
    zone: "SG",
    name: "Singapore",
    longName: "Singapore (EMA)",
    provider: "AWS ap-southeast-1 · GCP asia-southeast1",
    utcOffset: 8,
  },
  {
    zone: "AU-NSW",
    name: "Australia · NSW",
    longName: "Australia — New South Wales (AEMO)",
    provider: "AWS ap-southeast-2 · Azure Australia East",
    utcOffset: 10,
  },
  {
    zone: "CA-ON",
    name: "Canada · Ontario",
    longName: "Canada — Ontario (IESO)",
    provider: "Azure Canada Central · GCP nA-northeast2",
    utcOffset: -5,
  },
];

export const REGION_BY_ZONE: Record<string, Region> = Object.fromEntries(
  REGIONS.map((r) => [r.zone, r]),
);

export function findRegion(zone: string | undefined | null): Region | undefined {
  if (!zone) return undefined;
  return REGION_BY_ZONE[zone];
}
