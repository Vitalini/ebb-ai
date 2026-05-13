import Link from "next/link";
import { ForecastChart } from "@/components/forecast-chart";
import { CarbonBandBadge } from "@/components/carbon-band";
import { fetchElectricityMaps, mockGridForecast } from "@/lib/grid";
import { REGION_BY_ZONE, REGIONS, findRegion } from "@/lib/regions";
import type { GridForecast, GridForecastEntry } from "@/lib/types";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const DEFAULT_REGION = "US-CAL-CISO";

async function loadForecast(zone: string, hours = 72): Promise<GridForecast> {
  const apiKey = process.env.EBB_ELECTRICITY_MAPS_API_KEY;
  if (apiKey) {
    try {
      return await fetchElectricityMaps(zone, hours, apiKey);
    } catch {
      // fall through
    }
  }
  return mockGridForecast(zone, hours);
}

export default async function ForecastPage({
  searchParams,
}: {
  searchParams: Promise<{ region?: string }>;
}) {
  const params = await searchParams;
  const requested = params.region ?? DEFAULT_REGION;
  const region = findRegion(requested) ?? REGION_BY_ZONE[DEFAULT_REGION]!;
  const forecast = await loadForecast(region.zone, 72);

  const cleanest = [...forecast.entries]
    .map((e, i) => ({ e, i }))
    .sort((a, b) => a.e.carbonIntensityGCo2PerKwh - b.e.carbonIntensityGCo2PerKwh)
    .slice(0, 5);

  const dirtiest = [...forecast.entries]
    .map((e, i) => ({ e, i }))
    .sort((a, b) => b.e.carbonIntensityGCo2PerKwh - a.e.carbonIntensityGCo2PerKwh)
    .slice(0, 5);

  const bestIdx = cleanest[0]?.i;

  const min = forecast.entries.reduce(
    (acc, e) => Math.min(acc, e.carbonIntensityGCo2PerKwh),
    Infinity,
  );
  const max = forecast.entries.reduce(
    (acc, e) => Math.max(acc, e.carbonIntensityGCo2PerKwh),
    -Infinity,
  );
  const avg =
    forecast.entries.reduce(
      (acc, e) => acc + e.carbonIntensityGCo2PerKwh,
      0,
    ) / Math.max(1, forecast.entries.length);
  const swing = ((max - min) / Math.max(1, avg)) * 100;

  return (
    <div className="space-y-10">
      <header className="space-y-3">
        <p className="font-mono text-xs uppercase tracking-wider text-accent">
          72-hour forecast
        </p>
        <h1 className="text-3xl font-bold tracking-tight text-fg sm:text-4xl">
          {region.longName}
        </h1>
        <p className="text-sm text-fg-muted">
          {region.provider} · zone <span className="font-mono">{region.zone}</span> ·{" "}
          source <span className="font-mono">{forecast.source}</span> · generated{" "}
          <span className="font-mono">
            {new Date(forecast.generatedAt).toLocaleString(undefined, {
              hour: "2-digit",
              minute: "2-digit",
              timeZoneName: "short",
            })}
          </span>
        </p>
      </header>

      <RegionPicker active={region.zone} />

      <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="min" value={Math.round(min).toString()} unit="g/kWh" tone="good" />
        <Stat label="avg" value={Math.round(avg).toString()} unit="g/kWh" />
        <Stat label="max" value={Math.round(max).toString()} unit="g/kWh" tone="bad" />
        <Stat
          label="diurnal swing"
          value={`${Math.round(swing)}%`}
          unit="of avg"
        />
      </section>

      <section className="rounded-xl border border-rule bg-bg-elev p-5">
        <div className="mb-2 flex items-baseline justify-between">
          <h2 className="text-base font-semibold text-fg">
            Carbon intensity over the next 72 hours
          </h2>
          <p className="text-xs text-fg-muted">
            dashed lines = band thresholds · vertical = cleanest hour
          </p>
        </div>
        <ForecastChart entries={forecast.entries} highlightHour={bestIdx} />
      </section>

      <section className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <HourTable
          title="Cleanest hours"
          rows={cleanest.map(({ e, i }) => ({ entry: e, offsetH: i }))}
          tone="good"
        />
        <HourTable
          title="Dirtiest hours"
          rows={dirtiest.map(({ e, i }) => ({ entry: e, offsetH: i }))}
          tone="bad"
        />
      </section>

      <section className="flex items-center justify-between rounded-xl border border-rule bg-bg-elev p-5">
        <div>
          <h2 className="text-sm font-semibold text-fg">Plan a workload here</h2>
          <p className="mt-1 text-xs text-fg-muted">
            Set a deadline and an optional carbon budget; ebb-ai will pick the
            cheapest+cleanest hour and hand you a CLI command.
          </p>
        </div>
        <Link
          href={`/plan?region=${encodeURIComponent(region.zone)}`}
          className="rounded-md border border-accent/50 bg-accent/10 px-4 py-2 font-mono text-xs text-accent hover:bg-accent/15"
        >
          open planner →
        </Link>
      </section>
    </div>
  );
}

function Stat({
  label,
  value,
  unit,
  tone,
}: {
  label: string;
  value: string;
  unit: string;
  tone?: "good" | "bad";
}) {
  const toneClass =
    tone === "good"
      ? "text-band-very-clean"
      : tone === "bad"
        ? "text-band-very-dirty"
        : "text-fg";
  return (
    <div className="rounded-xl border border-rule bg-bg-elev p-4">
      <p className="font-mono text-[10px] uppercase tracking-wider text-fg-dim">
        {label}
      </p>
      <p className={`mt-1 font-mono text-2xl font-semibold ${toneClass}`}>
        {value}
      </p>
      <p className="font-mono text-[11px] text-fg-muted">{unit}</p>
    </div>
  );
}

function HourTable({
  title,
  rows,
  tone,
}: {
  title: string;
  rows: Array<{ entry: GridForecastEntry; offsetH: number }>;
  tone: "good" | "bad";
}) {
  return (
    <div className="rounded-xl border border-rule bg-bg-elev">
      <h3
        className={`border-b border-rule px-5 py-3 text-sm font-semibold ${
          tone === "good" ? "text-band-very-clean" : "text-band-very-dirty"
        }`}
      >
        {title}
      </h3>
      <ul className="divide-y divide-rule">
        {rows.map(({ entry, offsetH }) => (
          <li
            key={entry.datetime}
            className="flex items-center justify-between px-5 py-2.5 text-sm"
          >
            <div>
              <p className="font-mono text-xs text-fg">
                {new Date(entry.datetime).toLocaleString(undefined, {
                  weekday: "short",
                  hour: "2-digit",
                  minute: "2-digit",
                  timeZoneName: "short",
                })}
              </p>
              <p className="text-[11px] text-fg-dim">+{offsetH}h from now</p>
            </div>
            <div className="flex items-center gap-3">
              <span className="font-mono text-sm text-fg">
                {entry.carbonIntensityGCo2PerKwh}
                <span className="ml-1 text-[11px] text-fg-muted">g/kWh</span>
              </span>
              <CarbonBandBadge band={entry.band} size="sm" />
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function RegionPicker({ active }: { active: string }) {
  return (
    <nav className="flex flex-wrap gap-2 border-b border-rule pb-4">
      {REGIONS.map((r) => {
        const isActive = r.zone === active;
        return (
          <Link
            key={r.zone}
            href={`/forecast?region=${encodeURIComponent(r.zone)}`}
            className={`rounded-md border px-3 py-1.5 font-mono text-xs transition-colors ${
              isActive
                ? "border-accent/60 bg-accent/10 text-accent"
                : "border-rule bg-bg-elev text-fg-muted hover:border-rule-hi hover:text-fg"
            }`}
          >
            {r.zone}
          </Link>
        );
      })}
    </nav>
  );
}
