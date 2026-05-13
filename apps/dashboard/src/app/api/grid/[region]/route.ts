/**
 * GET /api/grid/[region]?hours=72
 *
 * Returns a GridForecast for the requested zone, sourced from Electricity
 * Maps if `EBB_ELECTRICITY_MAPS_API_KEY` is set, otherwise from the local
 * deterministic mock.
 *
 * Failure modes:
 *   - Bad region → 400
 *   - Electricity Maps unreachable or auth fails → silently fall back to
 *     the mock (logged once to stderr), 200 with `source: "mock"`. This
 *     mirrors the core-ts behavior so the dashboard never goes dark.
 *
 * Cache: 5 minutes at the edge (s-maxage). The free-tier Electricity Maps
 * API does not promise sub-hour freshness; 5 minutes is a fair compromise
 * between cost and "live" feel.
 */

import { NextResponse } from "next/server";
import { fetchElectricityMaps, mockGridForecast } from "@/lib/grid";
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

  const apiKey = process.env.EBB_ELECTRICITY_MAPS_API_KEY;
  if (apiKey) {
    try {
      const forecast = await fetchElectricityMaps(region, hours, apiKey);
      return NextResponse.json(forecast, {
        headers: {
          "cache-control": "public, s-maxage=300, stale-while-revalidate=60",
        },
      });
    } catch (err) {
      console.warn(
        `[ebb-ai/api/grid] electricity-maps fetch failed (${(err as Error).message}); using mock`,
      );
    }
  }

  const forecast = mockGridForecast(region, hours);
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
