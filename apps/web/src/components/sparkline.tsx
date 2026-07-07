import { useId } from "react";
import type { GridForecastEntry } from "@/lib/types";

/**
 * Sparkline for the RegionCard — no axes, no tooltip, just a 24-hour
 * intensity shape.
 *
 * Deliberately a plain server-rendered <svg> (normalized polyline +
 * gradient area) rather than a recharts <AreaChart>: /map renders 31 of
 * these static shapes, and pulling recharts+d3 into that bundle for
 * axis-less decoration cost ~100KB of client JS. The interactive
 * ForecastChart on /forecast and /plan keeps recharts.
 */
export function Sparkline({ entries }: { entries: GridForecastEntry[] }) {
  const gradientId = useId();
  const values = entries
    .slice(0, 24)
    .map((e) => e.carbonIntensityGCo2PerKwh)
    .filter((v) => Number.isFinite(v));

  if (values.length < 2) {
    return <div className="h-12 w-full" aria-hidden="true" />;
  }

  const WIDTH = 100;
  const HEIGHT = 48;
  const PAD = 2; // matches the old chart's top/bottom margin
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;

  const points = values.map((v, i) => {
    const x = (i / (values.length - 1)) * WIDTH;
    const y = PAD + (1 - (v - min) / span) * (HEIGHT - PAD * 2);
    return `${x.toFixed(2)},${y.toFixed(2)}`;
  });
  const line = points.join(" ");
  const area = `${line} ${WIDTH},${HEIGHT} 0,${HEIGHT}`;

  return (
    <svg
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      preserveAspectRatio="none"
      className="h-12 w-full"
      role="img"
      aria-label="24-hour carbon-intensity trend"
    >
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--color-accent)" stopOpacity={0.45} />
          <stop offset="100%" stopColor="var(--color-accent)" stopOpacity={0} />
        </linearGradient>
      </defs>
      <polygon points={area} fill={`url(#${gradientId})`} stroke="none" />
      <polyline
        points={line}
        fill="none"
        stroke="var(--color-accent)"
        strokeWidth={1.5}
        strokeLinejoin="round"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}
