"use client";

import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { GridForecastEntry } from "@/lib/types";

interface Datum {
  /** Hours since the forecast start. */
  hour: number;
  /** ISO time, for tooltip formatting. */
  iso: string;
  /** g CO2e / kWh. */
  intensity: number;
}

function toData(entries: GridForecastEntry[]): Datum[] {
  return entries.map((e, i) => ({
    hour: i,
    iso: e.datetime,
    intensity: e.carbonIntensityGCo2PerKwh,
  }));
}

function formatHourTick(value: number): string {
  if (value === 0) return "now";
  if (value % 6 === 0) return `+${value}h`;
  return "";
}

function tooltipFormatter(value: number | string): [string, string] {
  return [`${Math.round(Number(value))} g/kWh`, "carbon intensity"];
}

function labelFormatter(_: number | string, payload: Array<{ payload?: Datum }>): string {
  const p = payload?.[0]?.payload;
  if (!p) return "";
  const d = new Date(p.iso);
  return d.toLocaleString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZoneName: "short",
  });
}

/**
 * Full forecast chart with band threshold reference lines.
 *
 * The static per-region sparkline lives in `./sparkline.tsx` as a
 * server-rendered <svg> so /map doesn't pull recharts into its bundle.
 */
export function ForecastChart({
  entries,
  highlightHour,
}: {
  entries: GridForecastEntry[];
  /** Optional hour offset to draw a vertical marker on (e.g. best window). */
  highlightHour?: number;
}) {
  const data = toData(entries);
  return (
    <div className="h-[420px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 16, right: 24, left: 16, bottom: 8 }}>
          <CartesianGrid stroke="var(--color-rule)" strokeDasharray="2 4" />
          <XAxis
            dataKey="hour"
            tickFormatter={formatHourTick}
            interval={0}
            stroke="var(--color-fg-dim)"
            tickLine={false}
            axisLine={{ stroke: "var(--color-rule)" }}
          />
          <YAxis
            stroke="var(--color-fg-dim)"
            tickLine={false}
            axisLine={{ stroke: "var(--color-rule)" }}
            label={{
              value: "g CO2e / kWh",
              angle: -90,
              position: "insideLeft",
              fill: "var(--color-fg-muted)",
              fontSize: 11,
              dy: 40,
            }}
            domain={[0, "auto"]}
          />
          <Tooltip
            // recharts types here are loose; we render plain strings.
            formatter={tooltipFormatter as unknown as never}
            labelFormatter={labelFormatter as unknown as never}
            cursor={{ stroke: "var(--color-accent-dim)", strokeWidth: 1, strokeDasharray: "2 4" }}
          />
          <ReferenceLine
            y={100}
            stroke="var(--color-band-very-clean)"
            strokeDasharray="2 6"
            label={{
              value: "very clean",
              fill: "var(--color-band-very-clean)",
              fontSize: 10,
              position: "insideTopRight",
            }}
          />
          <ReferenceLine
            y={250}
            stroke="var(--color-band-clean)"
            strokeDasharray="2 6"
            label={{
              value: "clean",
              fill: "var(--color-band-clean)",
              fontSize: 10,
              position: "insideTopRight",
            }}
          />
          <ReferenceLine
            y={450}
            stroke="var(--color-band-average)"
            strokeDasharray="2 6"
            label={{
              value: "avg",
              fill: "var(--color-band-average)",
              fontSize: 10,
              position: "insideTopRight",
            }}
          />
          <ReferenceLine
            y={700}
            stroke="var(--color-band-dirty)"
            strokeDasharray="2 6"
            label={{
              value: "dirty",
              fill: "var(--color-band-dirty)",
              fontSize: 10,
              position: "insideTopRight",
            }}
          />
          {highlightHour !== undefined && (
            <ReferenceLine
              x={highlightHour}
              stroke="var(--color-accent)"
              strokeWidth={2}
              label={{
                value: "best",
                fill: "var(--color-accent)",
                fontSize: 11,
                position: "top",
              }}
            />
          )}
          <Line
            type="monotone"
            dataKey="intensity"
            stroke="var(--color-accent)"
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 4, fill: "var(--color-accent)" }}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
