import type { Metadata } from "next";
import { RegionCard } from "@/components/region-card";
import { fetchGridForecast } from "@/lib/grid";
import { REGIONS } from "@/lib/regions";
import type { GridForecast } from "@/lib/types";

export const metadata: Metadata = {
  title: "Live carbon map",
  description:
    "Real-time carbon-intensity map of the electricity grids that power major LLM-provider regions. Click any region for the 72-hour forecast and best-window finder.",
  alternates: { canonical: "https://www.ebb-ai.com/map" },
};

export const dynamic = "force-dynamic";
export const revalidate = 0;

async function loadForecast(zone: string): Promise<GridForecast | null> {
  try {
    return await fetchGridForecast(zone, 24);
  } catch {
    return null;
  }
}

export default async function MapPage() {
  const forecasts = await Promise.all(
    REGIONS.map(async (r) => ({
      region: r,
      forecast: await loadForecast(r.zone),
    })),
  );

  const live = forecasts.filter(
    (f) =>
      f.forecast?.source === "electricityMaps" ||
      f.forecast?.source === "ukCarbonIntensity" ||
      f.forecast?.source === "eia" ||
      f.forecast?.source === "entsoe",
  ).length;
  const total = forecasts.length;
  const cleanCount = forecasts.filter(
    (f) =>
      f.forecast?.entries[0] &&
      (f.forecast.entries[0].band === "clean" ||
        f.forecast.entries[0].band === "very_clean"),
  ).length;

  return (
    <div className="space-y-12">
      <section className="space-y-4">
        <p className="font-mono text-xs uppercase tracking-wider text-accent">live map</p>
        <h1 className="max-w-3xl text-3xl font-extrabold leading-[1.1] tracking-tight text-fg sm:text-4xl">
          Grid carbon-intensity where AI compute runs.
        </h1>
        <p className="max-w-2xl text-base text-fg-muted">
          Grid regions across North America, Europe and Asia-Pacific that
          host the major LLM providers&apos; inference workloads. Click any
          card for the 72-hour forecast and a cost-and-carbon best-window
          finder.
        </p>
        <dl className="grid max-w-xl grid-cols-3 gap-4 pt-2 sm:gap-8">
          <Kpi label="regions tracked" value={total.toString()} />
          <Kpi
            label="feeds live"
            value={live > 0 ? `${live} / ${total}` : "mock"}
            hint={
              live === 0
                ? "GB is always live; add EIA / ENTSO-E keys for the rest"
                : undefined
            }
          />
          <Kpi
            label="clean right now"
            value={cleanCount.toString()}
            hint="bands clean or very_clean"
          />
        </dl>
      </section>

      <section>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {forecasts.map(({ region, forecast }) => (
            <RegionCard key={region.zone} region={region} forecast={forecast} />
          ))}
        </div>
      </section>

      <Methodology />
    </div>
  );
}

function Kpi({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div>
      <dt className="font-mono text-[10px] uppercase tracking-wider text-fg-dim">
        {label}
      </dt>
      <dd className="mt-1 font-mono text-2xl font-semibold text-fg">{value}</dd>
      {hint ? <p className="mt-0.5 text-[11px] text-fg-muted">{hint}</p> : null}
    </div>
  );
}

function Methodology() {
  return (
    <section className="rounded-xl border border-rule bg-bg-elev p-6">
      <header className="space-y-2">
        <p className="font-mono text-[11px] uppercase tracking-wider text-accent">
          how it works
        </p>
        <h2 className="text-xl font-semibold tracking-tight text-fg sm:text-2xl">
          Methodology and source data
        </h2>
      </header>
      <div className="mt-5 grid grid-cols-1 gap-5 text-sm text-fg-muted sm:grid-cols-3">
        <div>
          <h3 className="font-mono text-xs uppercase tracking-wider text-accent">
            grid feeds
          </h3>
          <p className="mt-1">
            Multi-source, free-public-data first:{" "}
            <a
              href="https://carbonintensity.org.uk/"
              className="text-fg hover:text-accent"
              target="_blank"
              rel="noreferrer"
            >
              UK National Grid ESO
            </a>{" "}
            (GB),{" "}
            <a
              href="https://www.eia.gov/opendata/"
              className="text-fg hover:text-accent"
              target="_blank"
              rel="noreferrer"
            >
              US EIA
            </a>{" "}
            (US ISOs),{" "}
            <a
              href="https://transparency.entsoe.eu/"
              className="text-fg hover:text-accent"
              target="_blank"
              rel="noreferrer"
            >
              ENTSO-E Transparency Platform
            </a>{" "}
            (EU). Electricity Maps as universal fallback when a key is
            set; deterministic mock otherwise.
          </p>
        </div>
        <div>
          <h3 className="font-mono text-xs uppercase tracking-wider text-accent">
            scoring
          </h3>
          <p className="mt-1">
            Each candidate hour is scored on grams CO2e per LLM call assuming{" "}
            <span className="font-mono text-fg">0.0015 kWh</span> end-to-end
            energy (data-center + PUE 1.5). The cleanest hour inside the
            user-supplied deadline wins.
          </p>
        </div>
        <div>
          <h3 className="font-mono text-xs uppercase tracking-wider text-accent">
            fallback
          </h3>
          <p className="mt-1">
            When no API key is configured, the dashboard serves a deterministic
            UTC-aligned synthetic curve so demos and CI runs are reproducible.
            Bands are identical to the production thresholds.
          </p>
        </div>
      </div>
    </section>
  );
}
