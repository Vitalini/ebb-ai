import { BestWindowResult } from "@/components/best-window";
import { ForecastChart } from "@/components/forecast-chart";
import {
  fetchGridForecast,
  intensityToGrams,
  pickBestWindow,
} from "@/lib/grid";
import { REGIONS, findRegion } from "@/lib/regions";
import type { GridForecast } from "@/lib/types";

export const dynamic = "force-dynamic";

interface PlanQuery {
  region?: string;
  deadline?: string;
  budget?: string;
}

const DEFAULT_REGION = "US-CAL-CISO";
const DEFAULT_HORIZON_HOURS = 24;

async function loadForecast(zone: string, hours: number): Promise<GridForecast> {
  return fetchGridForecast(zone, hours);
}

export default async function PlanPage({
  searchParams,
}: {
  searchParams: Promise<PlanQuery>;
}) {
  const params = await searchParams;
  const region =
    findRegion(params.region) ?? findRegion(DEFAULT_REGION) ?? REGIONS[0]!;

  const submitted = params.deadline !== undefined;

  const deadline = parseDeadline(params.deadline);
  const carbonBudgetG = parseBudget(params.budget);

  let bestSection: React.ReactNode = null;
  let chartSection: React.ReactNode = null;

  if (submitted && deadline) {
    const hoursAhead = Math.max(
      1,
      Math.ceil((deadline.getTime() - Date.now()) / (60 * 60 * 1000)) + 1,
    );
    const horizon = Math.min(Math.max(hoursAhead, DEFAULT_HORIZON_HOURS), 96);
    const forecast = await loadForecast(region.zone, horizon);

    const baseBest = pickBestWindow(forecast, deadline);
    let chosen: ReturnType<typeof pickBestWindow> | null = baseBest ?? null;
    let cheapestUnreachable: number | null = null;

    if (baseBest && carbonBudgetG !== null) {
      if (baseBest.projectedGramsCo2 > carbonBudgetG) {
        cheapestUnreachable = baseBest.projectedGramsCo2;
        chosen = null;
      }
    }

    bestSection = (
      <BestWindowResult
        region={region}
        deadline={deadline}
        carbonBudgetG={carbonBudgetG}
        best={chosen ?? null}
        cheapestUnreachable={cheapestUnreachable}
      />
    );

    chartSection = (
      <section className="rounded-xl border border-rule bg-bg-elev p-5">
        <div className="mb-2 flex items-baseline justify-between">
          <h2 className="text-sm font-semibold text-fg">
            Forecast over your deadline window
          </h2>
          <p className="text-xs text-fg-muted">
            {forecast.entries.length} h of data · {forecast.source} feed
          </p>
        </div>
        <ForecastChart
          entries={forecast.entries}
          highlightHour={chosen?.hourOffset}
        />
      </section>
    );
  }

  // Default deadline value for the form input — 12 hours from now, rounded to the hour.
  const defaultDeadline = new Date(Date.now() + 12 * 60 * 60 * 1000);
  defaultDeadline.setMinutes(0, 0, 0);
  const defaultDeadlineInput = toDatetimeLocal(defaultDeadline);

  return (
    <div className="space-y-10">
      <header className="space-y-3">
        <p className="font-mono text-xs uppercase tracking-wider text-accent">
          best-window finder
        </p>
        <h1 className="text-3xl font-bold tracking-tight text-fg sm:text-4xl">
          Plan a deferrable LLM workload
        </h1>
        <p className="max-w-2xl text-sm text-fg-muted">
          Pick a region, a deadline, and (optionally) a carbon budget. ebb-ai
          will choose the cleanest hour that still meets your deadline and
          show you the projected carbon cost.
        </p>
      </header>

      <form
        method="get"
        className="grid grid-cols-1 gap-4 rounded-xl border border-rule bg-bg-elev p-5 sm:grid-cols-3"
      >
        <Field label="Region">
          <select
            name="region"
            defaultValue={region.zone}
            className="w-full rounded-md border border-rule bg-bg px-3 py-2 font-mono text-sm text-fg focus:border-accent"
          >
            {REGIONS.map((r) => (
              <option key={r.zone} value={r.zone}>
                {r.zone} — {r.name}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Deadline">
          <input
            type="datetime-local"
            name="deadline"
            required
            defaultValue={params.deadline ?? defaultDeadlineInput}
            className="w-full rounded-md border border-rule bg-bg px-3 py-2 font-mono text-sm text-fg focus:border-accent"
          />
        </Field>

        <Field
          label="Carbon budget"
          hint="grams CO2e per task — optional"
        >
          <input
            type="number"
            name="budget"
            min={0}
            step={0.1}
            defaultValue={params.budget ?? ""}
            placeholder="e.g. 0.5"
            className="w-full rounded-md border border-rule bg-bg px-3 py-2 font-mono text-sm text-fg focus:border-accent"
          />
        </Field>

        <div className="sm:col-span-3 flex items-center justify-between">
          <p className="text-xs text-fg-muted">
            Energy assumption: {intensityToGrams(1000).toFixed(2)} gCO2e per task per 1000 g/kWh
            grid intensity (1.5 mWh × PUE 1.5).
          </p>
          <button
            type="submit"
            className="rounded-md bg-accent px-4 py-2 font-mono text-sm font-semibold text-bg hover:bg-accent-dim"
          >
            find best window
          </button>
        </div>
      </form>

      {submitted && !deadline ? (
        <div className="rounded-xl border border-danger/40 bg-danger/5 p-5 text-sm text-danger">
          The deadline you supplied is invalid or in the past. Pick a time
          inside the next 96 hours.
        </div>
      ) : null}

      {bestSection}
      {chartSection}
    </div>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block space-y-1.5">
      <span className="font-mono text-[11px] uppercase tracking-wider text-fg-dim">
        {label}
      </span>
      {children}
      {hint ? <span className="block text-[11px] text-fg-muted">{hint}</span> : null}
    </label>
  );
}

function parseDeadline(raw: string | undefined): Date | null {
  if (!raw) return null;
  // datetime-local inputs supply `YYYY-MM-DDTHH:MM` (no timezone) — treat as local.
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return null;
  if (d.getTime() < Date.now() - 60_000) return null;
  // Cap at 96 hours into the future to match the forecast horizon.
  const max = Date.now() + 96 * 60 * 60 * 1000;
  if (d.getTime() > max) return null;
  return d;
}

function parseBudget(raw: string | undefined): number | null {
  if (raw === undefined || raw === "") return null;
  const n = Number.parseFloat(raw);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}

function toDatetimeLocal(d: Date): string {
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
