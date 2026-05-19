import Link from "next/link";
import { CarbonBandBadge } from "./carbon-band";
import { Sparkline } from "./forecast-chart";
import type { GridForecast } from "@/lib/types";
import type { Region } from "@/lib/regions";

function sourceLabel(source: GridForecast["source"] | undefined): string {
  switch (source) {
    case "electricityMaps":
      return "live · electricity maps";
    case "ukCarbonIntensity":
      return "live · uk grid";
    case "eia":
      return "live · us eia";
    case "entsoe":
      return "live · entso-e";
    case "wattTime":
      return "live · watttime";
    case "mock":
    default:
      return "mock feed";
  }
}

interface RegionCardProps {
  region: Region;
  forecast: GridForecast | null;
}

export function RegionCard({ region, forecast }: RegionCardProps) {
  const current = forecast?.entries[0];
  const error = !forecast;

  return (
    <Link
      href={`/forecast?region=${encodeURIComponent(region.zone)}`}
      className="group relative flex flex-col gap-4 rounded-xl border border-rule bg-bg-elev p-5 transition-all hover:-translate-y-0.5 hover:border-rule-hi hover:bg-bg-alt"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-mono text-xs text-fg-dim">{region.zone}</p>
          <h3 className="mt-0.5 text-base font-semibold tracking-tight text-fg">
            {region.name}
          </h3>
          <p className="mt-1 text-xs text-fg-muted">{region.provider}</p>
        </div>
        {current ? <CarbonBandBadge band={current.band} /> : null}
      </div>

      <div className="flex items-baseline justify-between gap-2">
        {current ? (
          <>
            <p className="font-mono text-3xl font-semibold tracking-tight text-fg">
              {current.carbonIntensityGCo2PerKwh}
              <span className="ml-1 text-xs font-normal text-fg-muted">g/kWh</span>
            </p>
            <p className="text-xs text-fg-muted">
              {sourceLabel(forecast?.source)}
            </p>
          </>
        ) : (
          <p className="text-sm text-danger">forecast unavailable</p>
        )}
      </div>

      {forecast && !error ? <Sparkline entries={forecast.entries} /> : null}

      <div className="flex items-center justify-between pt-1 text-xs text-fg-dim">
        <span>next 24 h</span>
        <span className="opacity-0 transition-opacity group-hover:opacity-100">
          open forecast <span aria-hidden="true">→</span>
        </span>
      </div>
    </Link>
  );
}
