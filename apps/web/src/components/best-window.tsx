"use client";

import { useEffect, useState } from "react";
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
  // Mounted gate for locale/timezone-dependent text. The server (UTC on
  // Vercel) and the visitor's browser disagree on both locale and TZ, so
  // rendering `toLocaleString` output during SSR caused hydration text
  // mismatches (React #418). Until mounted we render a deterministic UTC
  // fallback that the server and the client's first render produce
  // identically; the effect then swaps in the visitor's local rendering.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

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
  const tz = mounted
    ? (when.toLocaleString(undefined, { timeZoneName: "short" }).split(" ").pop() ?? "")
    : "UTC";
  const localTime = mounted
    ? when.toLocaleString(undefined, {
        weekday: "short",
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
    : formatUtcFallback(when);
  const deadlineStr = mounted
    ? deadline.toLocaleString(undefined, {
        weekday: "short",
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
    : formatUtcFallback(deadline);

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

/**
 * Deterministic UTC rendering ("2026-07-10 05:00") used during SSR and
 * the first client render, before the visitor's locale/timezone can be
 * applied. Derived from toISOString() so it never depends on the
 * runtime's ICU data, locale, or TZ database.
 */
function formatUtcFallback(d: Date): string {
  return d.toISOString().slice(0, 16).replace("T", " ");
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
  const slashCommand = `/ebb-ai:defer "<your task>" --by ${deadlineIso} --region ${region}${
    carbonBudgetG !== null ? ` --budget ${carbonBudgetG.toFixed(1)}` : ""
  }`;

  const mcpArgs = [
    `    "prompt": "<your task>",`,
    `    "deadline": "${deadlineIso}",`,
    `    "region": "${region}"${carbonBudgetG !== null ? "," : ""}`,
    carbonBudgetG !== null
      ? `    "carbon_budget_g": ${carbonBudgetG.toFixed(1)}`
      : "",
  ]
    .filter(Boolean)
    .join("\n");
  const mcpCall = `{\n  "tool": "schedule_task",\n  "args": {\n${mcpArgs}\n  }\n}`;

  return (
    <div className="rounded-xl border border-rule bg-bg-elev p-5">
      <h4 className="text-sm font-semibold text-fg">
        Defer it from your agent
      </h4>
      <p className="mt-1 text-xs text-fg-muted">
        In Claude Code (with the ebb-ai plugin installed), paste the slash
        command. Any other MCP host can call the{" "}
        <code className="rounded bg-bg px-1 font-mono">schedule_task</code>{" "}
        tool with the same arguments.
      </p>

      <CopyBlock label="claude code" text={slashCommand} />
      <CopyBlock label="mcp tool call (any host)" text={mcpCall} />
    </div>
  );
}

function CopyBlock({ label, text }: { label: string; text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="mt-4">
      <div className="flex items-center justify-between gap-3">
        <p className="font-mono text-[10px] uppercase tracking-wider text-fg-dim">
          {label}
        </p>
        <button
          type="button"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(text);
              setCopied(true);
              setTimeout(() => setCopied(false), 1800);
            } catch {
              /* clipboard unavailable; silent */
            }
          }}
          className="shrink-0 rounded-md border border-rule px-3 py-1 font-mono text-xs text-accent hover:bg-bg-alt"
        >
          {copied ? "copied" : "copy"}
        </button>
      </div>
      <pre className="mt-2 overflow-x-auto rounded-md bg-bg p-4 font-mono text-xs leading-relaxed text-fg">
        <code>{text}</code>
      </pre>
    </div>
  );
}
