import { RegionCard } from "@/components/region-card";
import { fetchGridForecast } from "@/lib/grid";
import { REGIONS } from "@/lib/regions";
import type { GridForecast } from "@/lib/types";

// Don't pre-render at build time: we want the displayed intensities to be
// fresh on each request. (In production this still benefits from edge caching
// in /api/grid/[region]; the home page itself is rendered per request.)
export const dynamic = "force-dynamic";
export const revalidate = 0;

async function loadForecast(zone: string): Promise<GridForecast | null> {
  try {
    return await fetchGridForecast(zone, 24);
  } catch {
    return null;
  }
}

export default async function HomePage() {
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
      <Hero live={live} total={total} cleanCount={cleanCount} />

      <section>
        <SectionHeader
          eyebrow="live map"
          title="Grid intensity where AI compute runs"
          subtitle="Seven regions hosting the major LLM providers' inference workloads. Click any card for the 72-hour forecast and a cost-and-carbon best-window finder."
        />
        <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {forecasts.map(({ region, forecast }) => (
            <RegionCard key={region.zone} region={region} forecast={forecast} />
          ))}
        </div>
      </section>

      <Methodology />
    </div>
  );
}

function Hero({
  live,
  total,
  cleanCount,
}: {
  live: number;
  total: number;
  cleanCount: number;
}) {
  return (
    <section className="space-y-6">
      <div className="inline-flex items-center gap-2 rounded-md border border-accent/40 bg-accent/5 px-3 py-1 font-mono text-xs uppercase tracking-wider text-accent">
        <span aria-hidden="true" className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent" />
        v0.7.1 · operator preview
      </div>
      <h1 className="max-w-3xl text-4xl font-extrabold leading-[1.05] tracking-tight text-fg sm:text-5xl">
        Cheaper inference, smoother grid.
      </h1>
      <p className="max-w-2xl text-base text-fg-muted">
        US data-center electricity demand is projected to hit 6.7–12% of
        national grid load by 2028. ebb-ai schedules non-urgent LLM workloads
        into cheap, off-peak windows — ~50% cost reduction via Batch APIs,
        smoother data-center load curves, auditable carbon receipts. Live
        grid data for the seven regions where the major LLM providers run.
      </p>
      <dl className="grid max-w-2xl grid-cols-3 gap-4 pt-2 sm:gap-8">
        <Kpi label="regions tracked" value={total.toString()} />
        <Kpi
          label="feeds live"
          value={live > 0 ? `${live} / ${total}` : "mock"}
          hint={
            live === 0
              ? "GB is always live via UK National Grid ESO; add EIA / ENTSO-E keys for the rest"
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

function SectionHeader({
  eyebrow,
  title,
  subtitle,
}: {
  eyebrow: string;
  title: string;
  subtitle?: string;
}) {
  return (
    <header className="space-y-2">
      <p className="font-mono text-[11px] uppercase tracking-wider text-accent">
        {eyebrow}
      </p>
      <h2 className="text-xl font-semibold tracking-tight text-fg sm:text-2xl">
        {title}
      </h2>
      {subtitle ? (
        <p className="max-w-2xl text-sm text-fg-muted">{subtitle}</p>
      ) : null}
    </header>
  );
}

function Methodology() {
  return (
    <section className="rounded-xl border border-rule bg-bg-elev p-6">
      <SectionHeader
        eyebrow="how it works"
        title="Methodology and source data"
      />
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
