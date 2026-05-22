/**
 * GridGreeting — a personalized banner on the home page.
 *
 * Reads the visitor's nearest grid region from Vercel geo headers, fetches
 * that region's live carbon forecast, and shows where their grid stands
 * right now + when the cleanest window is. A real number is only shown
 * when the feed is genuinely live (`source !== "mock"`) — never synthetic.
 */

import Link from "next/link";
import { headers } from "next/headers";
import { ArrowRight, MapPin } from "lucide-react";

import { fetchGridForecast } from "@/lib/grid";
import { resolveVisitorRegion } from "@/lib/geo";
import type { CarbonBand } from "@/lib/types";

const BAND: Record<CarbonBand, { label: string; dot: string; chip: string }> = {
  very_clean: { label: "very clean", dot: "bg-emerald-400", chip: "border-emerald-400/30 bg-emerald-400/[0.07] text-emerald-200" },
  clean: { label: "clean", dot: "bg-emerald-400", chip: "border-emerald-400/30 bg-emerald-400/[0.07] text-emerald-200" },
  average: { label: "average", dot: "bg-amber-400", chip: "border-amber-400/30 bg-amber-400/[0.07] text-amber-200" },
  dirty: { label: "dirty", dot: "bg-rose-400", chip: "border-rose-400/30 bg-rose-400/[0.07] text-rose-200" },
  very_dirty: { label: "very dirty", dot: "bg-rose-400", chip: "border-rose-400/30 bg-rose-400/[0.07] text-rose-200" },
};

export function GridGreetingSkeleton() {
  return (
    <div className="h-[104px] animate-pulse rounded-xl border border-rule bg-bg-elev sm:h-[78px]" />
  );
}

export async function GridGreeting() {
  const { region, source } = resolveVisitorRegion(await headers());
  const forecast = await fetchGridForecast(region.zone, 24).catch(() => null);
  const live =
    forecast && forecast.source !== "mock" && forecast.entries.length > 0
      ? forecast
      : null;

  const now = live?.entries[0];
  const cleanest = live
    ? live.entries.reduce((a, b) =>
        b.carbonIntensityGCo2PerKwh < a.carbonIntensityGCo2PerKwh ? b : a,
      )
    : undefined;
  const hoursOut = cleanest
    ? Math.max(
        0,
        Math.round(
          (new Date(cleanest.datetime).getTime() - Date.now()) / 3_600_000,
        ),
      )
    : 0;
  const savings =
    now && cleanest && now.carbonIntensityGCo2PerKwh > 0
      ? Math.max(
          0,
          Math.round(
            (1 - cleanest.carbonIntensityGCo2PerKwh / now.carbonIntensityGCo2PerKwh) *
              100,
          ),
        )
      : 0;

  return (
    <section className="overflow-hidden rounded-xl border border-rule bg-bg-elev">
      <div className="flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
        <div className="flex items-start gap-3">
          <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-accent/30 bg-accent/5 text-accent">
            <MapPin className="h-4 w-4" aria-hidden="true" />
          </span>
          <div>
            <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-fg-dim">
              {source === "geo" ? "Your nearest grid" : "Nearest grid we cover"}
            </p>
            <p className="text-base font-semibold text-fg">{region.name}</p>
            <p className="text-[11px] leading-snug text-fg-muted">
              {source === "fallback"
                ? "Your local grid isn’t tracked yet — showing Great Britain, the keyless always-live reference."
                : region.provider}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 sm:justify-end">
          {now ? (
            <>
              <span
                className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 font-mono text-xs ${BAND[now.band].chip}`}
              >
                <span className={`h-1.5 w-1.5 rounded-full ${BAND[now.band].dot}`} />
                {Math.round(now.carbonIntensityGCo2PerKwh)} gCO₂/kWh ·{" "}
                {BAND[now.band].label}
              </span>
              <span className="text-xs text-fg-muted">
                {hoursOut <= 0
                  ? "a clean window is open right now"
                  : `cleanest window ~${hoursOut}h out${
                      savings > 0 ? ` · ${savings}% lower` : ""
                    }`}
              </span>
            </>
          ) : (
            <span className="text-xs text-fg-muted">
              live forecast on the region page
            </span>
          )}
          <Link
            href={`/forecast?region=${encodeURIComponent(region.zone)}`}
            className="inline-flex items-center gap-1 rounded-md border border-accent/40 bg-accent/10 px-3 py-1.5 font-mono text-xs text-accent transition-colors hover:bg-accent/15"
          >
            Region forecast
            <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
          </Link>
        </div>
      </div>
    </section>
  );
}
