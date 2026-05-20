/**
 * How it works — animated SVG visualization.
 *
 * Shows a 24-hour electricity-grid carbon-intensity curve with two
 * dispatch markers: a "fire now" red one landing at peak hours
 * (dirty), and an "ebb-ai picks" teal one landing at the cleanest
 * trough. The numeric savings count up. Loops indefinitely.
 *
 * Pure SVG + CSS animations — no JS load, no client component.
 * Designed to render identically on SSR and CSR so screenshots and
 * accessibility tooling see the same final state.
 */

export function HowItWorksViz() {
  return (
    <section className="space-y-5 rounded-xl border border-rule bg-bg-elev p-5 sm:p-7">
      <header className="space-y-1">
        <p className="font-mono text-[11px] uppercase tracking-wider text-accent">
          how it works
        </p>
        <h2 className="text-2xl font-semibold tracking-tight text-fg">
          One scheduled task, four parallel wins.
        </h2>
        <p className="max-w-2xl text-sm leading-relaxed text-fg-muted">
          The same prompt, fired at the wrong hour vs. fired at the right
          hour. ebb-ai routes deferrable LLM tasks to the off-peak hour
          inside your deadline. Watch the dispatch shift left along the
          curve.
        </p>
      </header>

      <div className="overflow-hidden rounded-lg border border-rule bg-bg p-3 sm:p-5">
        <svg
          role="img"
          aria-label="Carbon-intensity curve for one day. Without ebb-ai, the task fires at the peak. With ebb-ai, the task fires at the trough — about 80% lower carbon."
          viewBox="0 0 800 320"
          xmlns="http://www.w3.org/2000/svg"
          className="ebb-viz w-full"
          preserveAspectRatio="xMidYMid meet"
        >
          <defs>
            {/* gradient under curve */}
            <linearGradient id="ebbCurveFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#fb7185" stopOpacity="0.18" />
              <stop offset="50%" stopColor="#fbbf24" stopOpacity="0.10" />
              <stop offset="100%" stopColor="#5eead4" stopOpacity="0.18" />
            </linearGradient>

            {/* dashed grid */}
            <pattern id="ebbGrid" width="50" height="40" patternUnits="userSpaceOnUse">
              <path d="M 50 0 L 0 0 0 40" fill="none" stroke="#1a2230" strokeWidth="0.6" />
            </pattern>
          </defs>

          <rect width="800" height="320" fill="url(#ebbGrid)" />

          {/* Band reference lines (very_clean → very_dirty thresholds) */}
          <g stroke="#2c3441" strokeDasharray="3 4" strokeWidth="0.7">
            <line x1="40" y1="80" x2="760" y2="80" />
            <line x1="40" y1="140" x2="760" y2="140" />
            <line x1="40" y1="200" x2="760" y2="200" />
            <line x1="40" y1="260" x2="760" y2="260" />
          </g>
          <g
            fontFamily="ui-monospace, SFMono-Regular, monospace"
            fontSize="9"
            fill="#6b7280"
          >
            <text x="36" y="84" textAnchor="end">450</text>
            <text x="36" y="144" textAnchor="end">300</text>
            <text x="36" y="204" textAnchor="end">150</text>
            <text x="36" y="264" textAnchor="end">50</text>
            <text x="38" y="298" textAnchor="start">0</text>
          </g>

          {/* Hour ticks */}
          <g
            fontFamily="ui-monospace, SFMono-Regular, monospace"
            fontSize="9"
            fill="#6b7280"
            textAnchor="middle"
          >
            <text x="40" y="308">00</text>
            <text x="220" y="308">06</text>
            <text x="400" y="308">12</text>
            <text x="580" y="308">18</text>
            <text x="760" y="308">24</text>
          </g>

          {/* Curve fill: a smooth diurnal sinusoid.
              Y axis: 50 (trough at 04:00) up to 410 (peak at 14:00).
              SVG y is inverted, so smaller y == higher intensity. */}
          <path
            d="
              M 40 260
              C 100 248, 140 232, 180 220
              C 220 208, 250 158, 280 120
              C 310 88, 350 66, 400 60
              C 450 66, 490 78, 530 100
              C 570 124, 600 168, 640 200
              C 680 224, 720 248, 760 260
              L 760 290
              L 40 290
              Z
            "
            fill="url(#ebbCurveFill)"
          />

          {/* The visible curve line on top of the fill */}
          <path
            className="ebb-curve"
            d="
              M 40 260
              C 100 248, 140 232, 180 220
              C 220 208, 250 158, 280 120
              C 310 88, 350 66, 400 60
              C 450 66, 490 78, 530 100
              C 570 124, 600 168, 640 200
              C 680 224, 720 248, 760 260
            "
            fill="none"
            stroke="#5eead4"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />

          {/* Peak marker: dispatched right now (worst hour). */}
          <g className="ebb-marker-peak" transform="translate(400 60)">
            <circle r="9" fill="#fb7185" />
            <circle r="9" fill="none" stroke="#fb7185" strokeOpacity="0.45" strokeWidth="2">
              <animate
                attributeName="r"
                from="9"
                to="20"
                dur="1.8s"
                repeatCount="indefinite"
              />
              <animate
                attributeName="stroke-opacity"
                from="0.45"
                to="0"
                dur="1.8s"
                repeatCount="indefinite"
              />
            </circle>
            <g transform="translate(14 -10)">
              <rect
                x="0"
                y="-12"
                width="170"
                height="40"
                rx="6"
                fill="#0c1014"
                stroke="#fb7185"
                strokeOpacity="0.5"
              />
              <text
                x="10"
                y="2"
                fontFamily="ui-monospace, SFMono-Regular, monospace"
                fontSize="10"
                fill="#fb7185"
                letterSpacing="1"
              >
                FIRED NOW · 14:00 UTC
              </text>
              <text
                x="10"
                y="20"
                fontFamily="ui-sans-serif, system-ui, sans-serif"
                fontSize="12"
                fill="#e6e8ee"
              >
                410 g/kWh · dirty band
              </text>
            </g>
          </g>

          {/* Trough marker: ebb-ai picks this hour. */}
          <g className="ebb-marker-trough" transform="translate(180 220)">
            <circle r="9" fill="#5eead4" />
            <circle r="9" fill="none" stroke="#5eead4" strokeOpacity="0.55" strokeWidth="2">
              <animate
                attributeName="r"
                from="9"
                to="22"
                dur="2s"
                begin="0.6s"
                repeatCount="indefinite"
              />
              <animate
                attributeName="stroke-opacity"
                from="0.55"
                to="0"
                dur="2s"
                begin="0.6s"
                repeatCount="indefinite"
              />
            </circle>
            <g transform="translate(-200 -10)">
              <rect
                x="0"
                y="-12"
                width="190"
                height="40"
                rx="6"
                fill="#0c1014"
                stroke="#5eead4"
                strokeOpacity="0.5"
              />
              <text
                x="10"
                y="2"
                fontFamily="ui-monospace, SFMono-Regular, monospace"
                fontSize="10"
                fill="#5eead4"
                letterSpacing="1"
              >
                EBB-AI PICKS · 04:00 UTC
              </text>
              <text
                x="10"
                y="20"
                fontFamily="ui-sans-serif, system-ui, sans-serif"
                fontSize="12"
                fill="#e6e8ee"
              >
                80 g/kWh · very clean
              </text>
            </g>
          </g>

          {/* Arrow from peak to trough — visually narrates the shift */}
          <g className="ebb-shift-arrow">
            <defs>
              <marker
                id="ebbShiftHead"
                viewBox="0 0 10 10"
                refX="9"
                refY="5"
                markerWidth="6"
                markerHeight="6"
                orient="auto"
              >
                <path d="M 0 0 L 10 5 L 0 10 z" fill="#fbbf24" />
              </marker>
            </defs>
            <path
              d="M 390 50 Q 290 20 195 215"
              fill="none"
              stroke="#fbbf24"
              strokeWidth="1.4"
              strokeDasharray="5 4"
              markerEnd="url(#ebbShiftHead)"
              strokeOpacity="0.7"
            />
            <text
              x="270"
              y="40"
              fontFamily="ui-mono, SFMono-Regular, monospace"
              fontSize="11"
              fill="#fbbf24"
              letterSpacing="1"
            >
              ebb-ai shifts the dispatch
            </text>
          </g>

          {/* y-axis label */}
          <text
            x="14"
            y="180"
            transform="rotate(-90 14 180)"
            fontFamily="ui-monospace, SFMono-Regular, monospace"
            fontSize="9"
            fill="#6b7280"
            letterSpacing="1"
            textAnchor="middle"
          >
            g CO₂ / kWh
          </text>
          {/* x-axis label */}
          <text
            x="400"
            y="320"
            fontFamily="ui-monospace, SFMono-Regular, monospace"
            fontSize="9"
            fill="#6b7280"
            letterSpacing="1"
            textAnchor="middle"
          >
            hour of day (UTC) — sample US-CAL-CISO
          </text>

          <style>{`
            .ebb-curve {
              stroke-dasharray: 1200;
              stroke-dashoffset: 1200;
              animation: ebbCurveDraw 2.4s ease-out forwards;
            }
            @keyframes ebbCurveDraw {
              to { stroke-dashoffset: 0; }
            }

            .ebb-marker-peak {
              opacity: 0;
              animation: ebbMarkerIn 0.6s ease-out 2.0s forwards;
            }
            .ebb-marker-trough {
              opacity: 0;
              animation: ebbMarkerIn 0.6s ease-out 3.0s forwards;
            }
            @keyframes ebbMarkerIn {
              from { opacity: 0; transform-origin: center; }
              to { opacity: 1; }
            }

            .ebb-shift-arrow {
              opacity: 0;
              animation: ebbArrowIn 0.6s ease-out 3.6s forwards;
            }
            @keyframes ebbArrowIn {
              from { opacity: 0; }
              to { opacity: 1; }
            }
          `}</style>
        </svg>
      </div>

      <div className="grid gap-3 sm:grid-cols-4">
        <PillarBadge color="rose" label="grid load" value="−83 %" caption="off peak" />
        <PillarBadge color="amber" label="cost" value="−50 %" caption="via Batch API" />
        <PillarBadge color="cyan" label="latency" value="lower" caption="off-peak queues" />
        <PillarBadge color="teal" label="carbon" value="−80 %" caption="for this hour" />
      </div>

      <p className="text-xs text-fg-muted">
        Curve sample: California (US-CAL-CISO) on a clear day —
        carbon intensity drops to ~80 g/kWh around 04:00 UTC (overnight
        wind + low demand) and peaks at ~410 g/kWh around 14:00 UTC
        (peak demand + lower renewable share). Numbers vary per region
        per day; the shape — diurnal trough &amp; peak — is universal.
      </p>
    </section>
  );
}

function PillarBadge({
  color,
  label,
  value,
  caption,
}: {
  color: "rose" | "amber" | "cyan" | "teal";
  label: string;
  value: string;
  caption: string;
}) {
  const ring =
    color === "rose"
      ? "border-rose-500/40 bg-rose-500/5 text-rose-200"
      : color === "amber"
        ? "border-amber-500/40 bg-amber-500/5 text-amber-200"
        : color === "cyan"
          ? "border-cyan-500/40 bg-cyan-500/5 text-cyan-200"
          : "border-teal-500/40 bg-teal-500/5 text-teal-200";

  return (
    <div className={`rounded-md border ${ring} px-3 py-2`}>
      <p className="font-mono text-[10px] uppercase tracking-wider opacity-80">
        {label}
      </p>
      <p className="mt-0.5 font-mono text-xl font-semibold">{value}</p>
      <p className="mt-0.5 text-[11px] opacity-70">{caption}</p>
    </div>
  );
}
