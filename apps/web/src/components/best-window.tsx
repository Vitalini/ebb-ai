"use client";

import { useState } from "react";
import { CarbonBandBadge } from "./carbon-band";
import type { BestWindow } from "@/lib/grid";
import type { Region } from "@/lib/regions";

interface Props {
  region: Region;
  deadline: Date;
  carbonBudgetG: number | null;
  best: BestWindow | null;
  cheapestUnreachable: number | null;
}

export function BestWindowResult({
  region,
  deadline,
  carbonBudgetG,
  best,
  cheapestUnreachable,
}: Props) {
  if (!best) {
    return (
      <div className="rounded-xl border border-danger/40 bg-danger/5 p-6">
        <h3 className="text-base font-semibold text-danger">
          No window meets the constraints
        </h3>
        <p className="mt-2 text-sm text-fg-muted">
          {carbonBudgetG !== null && cheapestUnreachable !== null ? (
            <>
              The cleanest reachable hour inside your deadline costs{" "}
              <span className="font-mono text-fg">
                {cheapestUnreachable.toFixed(1)} g
              </span>{" "}
              — over your{" "}
              <span className="font-mono text-fg">{carbonBudgetG.toFixed(1)} g</span> budget.
              Consider raising the budget or extending the deadline.
            </>
          ) : (
            <>The deadline you supplied is in the past, or the forecast horizon is empty.</>
          )}
        </p>
      </div>
    );
  }

  const when = new Date(best.entry.datetime);
  const tz = when.toLocaleString(undefined, { timeZoneName: "short" }).split(" ").pop() ?? "";
  const localTime = when.toLocaleString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
  const deadlineStr = deadline.toLocaleString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-accent/30 bg-accent/[0.04] p-6 ring-1 ring-accent/10">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="font-mono text-xs uppercase tracking-wider text-accent">
              recommended window
            </p>
            <h3 className="mt-1 font-mono text-2xl font-semibold tracking-tight text-fg">
              {localTime}{" "}
              <span className="text-base font-normal text-fg-muted">{tz}</span>
            </h3>
            <p className="mt-1 text-sm text-fg-muted">
              {best.hourOffset === 0
                ? "dispatch immediately — current hour is best"
                : `in ${best.hourOffset} h, well inside your deadline (${deadlineStr})`}
            </p>
          </div>
          <CarbonBandBadge band={best.entry.band} />
        </div>

        <dl className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-3">
          <Stat
            label="intensity"
            value={`${best.entry.carbonIntensityGCo2PerKwh}`}
            unit="g/kWh"
          />
          <Stat
            label="projected"
            value={best.projectedGramsCo2.toFixed(1)}
            unit="gCO2e"
          />
          <Stat label="region" value={region.name} unit={region.zone} mono />
        </dl>
      </div>

      <CopyHint
        region={region.zone}
        deadlineIso={deadline.toISOString()}
        carbonBudgetG={carbonBudgetG}
      />
    </div>
  );
}

function Stat({
  label,
  value,
  unit,
  mono,
}: {
  label: string;
  value: string;
  unit: string;
  mono?: boolean;
}) {
  return (
    <div>
      <dt className="font-mono text-[10px] uppercase tracking-wider text-fg-dim">
        {label}
      </dt>
      <dd
        className={`mt-1 text-lg font-semibold text-fg ${mono ? "font-mono" : ""}`}
      >
        {value}
      </dd>
      <p className="font-mono text-[11px] text-fg-muted">{unit}</p>
    </div>
  );
}

function CopyHint({
  region,
  deadlineIso,
  carbonBudgetG,
}: {
  region: string;
  deadlineIso: string;
  carbonBudgetG: number | null;
}) {
  const [copied, setCopied] = useState(false);
  const cli = [
    "npx @ebb-ai/cli schedule \\",
    `  --region ${region} \\`,
    `  --deadline ${deadlineIso}${carbonBudgetG !== null ? " \\" : ""}`,
    carbonBudgetG !== null ? `  --carbon-budget-g ${carbonBudgetG.toFixed(1)}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  return (
    <div className="rounded-xl border border-rule bg-bg-elev p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h4 className="text-sm font-semibold text-fg">Send to ebb-mcp</h4>
          <p className="mt-1 text-xs text-fg-muted">
            Copy this into your terminal where the ebb-ai scheduler is
            installed. A future release will add one-click dispatch from this
            page (HTTP control plane).
          </p>
        </div>
        <button
          type="button"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(cli);
              setCopied(true);
              setTimeout(() => setCopied(false), 1800);
            } catch {
              /* clipboard unavailable; silent */
            }
          }}
          className="shrink-0 rounded-md border border-rule px-3 py-1.5 font-mono text-xs text-accent hover:bg-bg-alt"
        >
          {copied ? "copied" : "copy"}
        </button>
      </div>
      <pre className="mt-3 overflow-x-auto rounded-md bg-bg p-4 font-mono text-xs leading-relaxed text-fg">
        <code>{cli}</code>
      </pre>
    </div>
  );
}
