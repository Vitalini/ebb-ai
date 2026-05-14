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
      f.forecast?.source === "ukCarbonIntensity",
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
          title="AI-compute carbon intensity, right now"
          subtitle="Six grids where the major LLM providers run inference. Click any region for the 72-hour forecast and a best-window finder."
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
        v0.2 · operator preview
      </div>
      <h1 className="max-w-3xl text-4xl font-extrabold leading-[1.05] tracking-tight text-fg sm:text-5xl">
        Live carbon map for AI compute.
      </h1>
      <p className="max-w-2xl text-base text-fg-muted">
        Carbon intensity of the grids that power the regions where Anthropic,
        OpenAI, and Google run inference. Forecasts up to 72 hours. A
        best-window finder for any deferrable LLM workload — and a window into
        the scheduler&apos;s own queue.
      </p>
      <dl className="grid max-w-2xl grid-cols-3 gap-4 pt-2 sm:gap-8">
        <Kpi label="regions tracked" value={total.toString()} />
        <Kpi
          label="feeds live"
          value={live > 0 ? `${live} / ${total}` : "mock"}
          hint={
            live === 0
              ? "set EBB_ELECTRICITY_MAPS_API_KEY for live data (GB is always live)"
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
            grid feed
          </h3>
          <p className="mt-1">
            GB is powered by the{" "}
            <a
              href="https://carbonintensity.org.uk/"
              className="text-fg hover:text-accent"
              target="_blank"
              rel="noreferrer"
            >
              National Grid ESO Carbon Intensity API
            </a>{" "}
            (free, no key, real 48-hour forecast). Other zones use{" "}
            <a
              href="https://www.electricitymaps.com/"
              className="text-fg hover:text-accent"
              target="_blank"
              rel="noreferrer"
            >
              Electricity Maps
            </a>{" "}
            when a key is configured; otherwise a deterministic mock.
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
