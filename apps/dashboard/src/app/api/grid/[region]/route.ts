/**
 * GET /api/grid/[region]?hours=72
 *
 * Returns a GridForecast for the requested zone via the per-zone router
 * `fetchGridForecast`:
 *   - GB           → UK National Grid ESO Carbon Intensity API (free, no key)
 *   - other zones  → Electricity Maps (when EBB_ELECTRICITY_MAPS_API_KEY is set)
 *   - any failure  → deterministic mock curve
 *
 * Failure modes:
 *   - Bad region → 400
 *   - Upstream feed unreachable → silently fall back to mock, 200 with
 *     `source: "mock"` (logged once to stderr). The dashboard never goes dark.
 *
 * Cache: 5 minutes at the edge (s-maxage). Neither upstream feed promises
 * sub-hour freshness; 5 minutes is a fair compromise between cost and
 * "live" feel.
 */

import { NextResponse } from "next/server";
import { fetchGridForecast } from "@/lib/grid";
import { REGION_BY_ZONE } from "@/lib/regions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEFAULT_HOURS = 72;
const MAX_HOURS = 96;

export async function GET(
  req: Request,
  { params }: { params: Promise<{ region: string }> },
) {
  const { region } = await params;

  if (!region || !REGION_BY_ZONE[region]) {
    return NextResponse.json(
      {
        error: `Unknown region "${region}". Supported regions: ${Object.keys(
          REGION_BY_ZONE,
        ).join(", ")}`,
      },
      { status: 400 },
    );
  }

  const url = new URL(req.url);
  const hoursParam = url.searchParams.get("hours");
  const hours = clampHours(hoursParam);

  const forecast = await fetchGridForecast(region, hours);
  return NextResponse.json(forecast, {
    headers: {
      "cache-control": "public, s-maxage=300, stale-while-revalidate=60",
    },
  });
}

function clampHours(raw: string | null): number {
  if (!raw) return DEFAULT_HOURS;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_HOURS;
  return Math.min(n, MAX_HOURS);
}
