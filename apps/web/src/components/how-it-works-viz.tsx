/**
 * How it works — animated SVG story.
 *
 * A deferrable task arrives while the power grid is at PEAK (red, dirty,
 * expensive). ebb-ai parks it in the queue. As the grid swings to
 * OFF-PEAK the plant turns green, the wires light up, the task is
 * dispatched, and a result comes back — cheaper, faster, cleaner.
 *
 * Pure SVG + CSS keyframes on one shared 14s loop — no JS, no client
 * component. Honours prefers-reduced-motion with a coherent still frame.
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
          A task lands while the grid is at peak — dirty, strained,
          expensive. ebb-ai holds it in the queue and dispatches it once
          the grid swings off-peak: lower-carbon, cheaper via Batch
          pricing, and through faster off-peak capacity.
        </p>
      </header>

      <div className="overflow-hidden rounded-lg border border-rule bg-bg p-3 sm:p-5">
        <svg
          role="img"
          aria-label="A deferrable task arrives while the electricity grid is at peak load (red). ebb-ai queues it, waits for the grid to go off-peak (green), then dispatches it — cleaner, cheaper and faster."
          viewBox="0 0 800 300"
          xmlns="http://www.w3.org/2000/svg"
          className="ebb-viz w-full"
          preserveAspectRatio="xMidYMid meet"
        >
          <defs>
            <pattern
              id="ebbDots"
              width="22"
              height="22"
              patternUnits="userSpaceOnUse"
            >
              <circle cx="1" cy="1" r="1" fill="#161d28" />
            </pattern>
          </defs>

          <rect width="800" height="300" fill="url(#ebbDots)" />

          {/* ── wires (under everything) ─────────────────────────────── */}
          <line
            className="ebb-wire ebb-wire-a"
            x1="138"
            y1="168"
            x2="332"
            y2="168"
            strokeWidth="3"
            strokeLinecap="round"
          />
          <line
            className="ebb-wire ebb-wire-b"
            x1="528"
            y1="168"
            x2="606"
            y2="168"
            strokeWidth="3"
            strokeLinecap="round"
          />

          {/* signal pulses travelling the wires */}
          <circle className="ebb-pulse ebb-pulse-a" cx="0" cy="168" r="4" />
          <circle className="ebb-pulse ebb-pulse-b" cx="0" cy="168" r="4" />

          {/* ── power plant ──────────────────────────────────────────── */}
          <g>
            <rect
              className="ebb-aura"
              x="44"
              y="104"
              width="118"
              height="116"
              rx="16"
            />
            {/* emission puffs — only while the grid is at peak */}
            <g className="ebb-emissions">
              <circle className="ebb-puff" cx="86" cy="112" r="5" style={{ animationDelay: "0s" }} />
              <circle className="ebb-puff" cx="86" cy="112" r="4" style={{ animationDelay: "0.8s" }} />
              <circle className="ebb-puff" cx="117" cy="112" r="5" style={{ animationDelay: "1.5s" }} />
            </g>
            {/* chimneys */}
            <rect x="80" y="118" width="11" height="30" rx="2" fill="#28323f" />
            <rect x="111" y="118" width="11" height="30" rx="2" fill="#28323f" />
            {/* building */}
            <rect
              x="62"
              y="144"
              width="78"
              height="58"
              rx="5"
              fill="#161d28"
              stroke="#3a4453"
              strokeWidth="1.5"
            />
            {/* a glowing core that cycles red → amber → green */}
            <circle className="ebb-core" cx="101" cy="174" r="13" />
            <text
              x="101"
              y="220"
              textAnchor="middle"
              fontFamily="ui-monospace, SFMono-Regular, monospace"
              fontSize="10"
              fill="#9aa4b2"
              letterSpacing="1"
            >
              power grid
            </text>

            {/* grid-status pill above the plant */}
            <g>
              <rect x="48" y="74" width="106" height="22" rx="6" fill="#0c1014" stroke="#222b38" />
              <text
                className="ebb-status-peak"
                x="101"
                y="89"
                textAnchor="middle"
                fontFamily="ui-monospace, SFMono-Regular, monospace"
                fontSize="10"
                fill="#fb7185"
                letterSpacing="0.5"
              >
                ● PEAK · dirty
              </text>
              <text
                className="ebb-status-clean"
                x="101"
                y="89"
                textAnchor="middle"
                fontFamily="ui-monospace, SFMono-Regular, monospace"
                fontSize="10"
                fill="#34d399"
                letterSpacing="0.5"
              >
                ● OFF-PEAK · clean
              </text>
            </g>
          </g>

          {/* ── queue box ────────────────────────────────────────────── */}
          <g>
            <rect
              x="332"
              y="118"
              width="196"
              height="100"
              rx="10"
              fill="#0e141b"
              stroke="#2c3441"
              strokeWidth="1.5"
            />
            <text
              x="430"
              y="138"
              textAnchor="middle"
              fontFamily="ui-monospace, SFMono-Regular, monospace"
              fontSize="10"
              fill="#7c8696"
              letterSpacing="1"
            >
              ebb-ai queue
            </text>
            {/* parking slot the task waits in */}
            <rect
              x="398"
              y="153"
              width="64"
              height="30"
              rx="6"
              fill="none"
              stroke="#2c3441"
              strokeDasharray="3 3"
            />
          </g>

          {/* ── dispatch node ────────────────────────────────────────── */}
          <g>
            <circle
              className="ebb-fire"
              cx="620"
              cy="168"
              r="9"
              fill="none"
              stroke="#34d399"
              strokeWidth="2"
            />
            <circle cx="620" cy="168" r="9" fill="#0e141b" stroke="#3a4453" strokeWidth="1.5" />
            <circle className="ebb-dispatch-dot" cx="620" cy="168" r="4" />
            <text
              x="620"
              y="196"
              textAnchor="middle"
              fontFamily="ui-monospace, SFMono-Regular, monospace"
              fontSize="9"
              fill="#7c8696"
              letterSpacing="1"
            >
              dispatch
            </text>
          </g>

          {/* ── result ───────────────────────────────────────────────── */}
          <g className="ebb-result">
            <circle r="18" fill="#34d399" fillOpacity="0.14" stroke="#34d399" strokeWidth="2" />
            <path
              d="M -7 0 L -2 6 L 8 -6"
              fill="none"
              stroke="#34d399"
              strokeWidth="3"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <text
              x="0"
              y="40"
              textAnchor="middle"
              fontFamily="ui-monospace, SFMono-Regular, monospace"
              fontSize="10"
              fill="#34d399"
              letterSpacing="1"
            >
              result
            </text>
          </g>

          {/* ── the task card (travels plant → queue → dispatch) ─────── */}
          <g className="ebb-task">
            <rect x="-33" y="-16" width="66" height="32" rx="7" fill="#11161c" className="ebb-task-box" />
            <circle className="ebb-task-dot" cx="-18" cy="0" r="4.5" />
            <text
              x="2"
              y="4"
              textAnchor="middle"
              fontFamily="ui-sans-serif, system-ui, sans-serif"
              fontSize="11"
              fill="#e6e8ee"
            >
              task
            </text>
          </g>

          {/* ── the three wins (appear with the result) ──────────────── */}
          <g className="ebb-wins">
            <text
              x="640"
              y="232"
              textAnchor="middle"
              fontFamily="ui-monospace, SFMono-Regular, monospace"
              fontSize="11"
              fill="#34d399"
              letterSpacing="0.5"
            >
              ✓ cleaner   ✓ cheaper   ✓ faster
            </text>
          </g>

          <style>{`
            .ebb-viz text { dominant-baseline: middle; }

            /* wires — dim by default, green while the grid is off-peak */
            .ebb-wire { stroke: #2c3441; animation: ebbWire 14s infinite; }
            @keyframes ebbWire {
              0%, 44%   { stroke: #2c3441; }
              56%, 86%  { stroke: #34d399; }
              96%, 100% { stroke: #2c3441; }
            }

            /* plant aura + core cycle red → amber → green */
            .ebb-aura {
              fill: #fb7185; opacity: 0.12;
              animation: ebbCycle 14s infinite;
            }
            .ebb-core {
              fill: #fb7185;
              animation: ebbCycle 14s infinite, ebbCorePulse 2.2s ease-in-out infinite;
            }
            @keyframes ebbCycle {
              0%, 20%   { fill: #fb7185; }
              42%       { fill: #fbbf24; }
              58%, 82%  { fill: #34d399; }
              100%      { fill: #fb7185; }
            }
            @keyframes ebbCorePulse {
              0%, 100% { r: 13px; }
              50%      { r: 16px; }
            }

            /* emission puffs — gated to the peak phase */
            .ebb-emissions { animation: ebbEmitGate 14s infinite; }
            @keyframes ebbEmitGate {
              0%, 26%  { opacity: 1; }
              42%, 100%{ opacity: 0; }
            }
            .ebb-puff {
              fill: #fb7185;
              animation: ebbPuff 2.4s ease-out infinite;
            }
            @keyframes ebbPuff {
              0%   { transform: translateY(0) scale(0.5); opacity: 0; }
              25%  { opacity: 0.5; }
              100% { transform: translateY(-30px) scale(1.2); opacity: 0; }
            }

            /* grid-status pill cross-fade */
            .ebb-status-peak  { animation: ebbPeak 14s infinite; }
            .ebb-status-clean { opacity: 0; animation: ebbClean 14s infinite; }
            @keyframes ebbPeak {
              0%, 44%   { opacity: 1; }
              52%, 94%  { opacity: 0; }
              100%      { opacity: 1; }
            }
            @keyframes ebbClean {
              0%, 44%   { opacity: 0; }
              52%, 94%  { opacity: 1; }
              100%      { opacity: 0; }
            }

            /* the task card travels plant → queue → dispatch */
            .ebb-task {
              transform: translate(430px, 168px);
              animation: ebbTask 14s ease-in-out infinite;
            }
            @keyframes ebbTask {
              0%, 3%   { transform: translate(150px,168px) scale(0.5); opacity: 0; }
              8%       { transform: translate(150px,168px) scale(1);   opacity: 1; }
              24%, 58% { transform: translate(430px,168px) scale(1);   opacity: 1; }
              78%      { transform: translate(620px,168px) scale(1);   opacity: 1; }
              84%      { transform: translate(620px,168px) scale(0.4); opacity: 0; }
              100%     { transform: translate(150px,168px) scale(0.5); opacity: 0; }
            }
            /* card accent: amber while waiting, green once running */
            .ebb-task-box {
              stroke: #fbbf24; stroke-width: 1.5;
              animation: ebbTaskTint 14s infinite;
            }
            .ebb-task-dot {
              fill: #fbbf24;
              animation: ebbTaskTint 14s infinite;
            }
            @keyframes ebbTaskTint {
              0%, 52%  { stroke: #fbbf24; fill: #fbbf24; }
              62%,100% { stroke: #34d399; fill: #34d399; }
            }

            /* signal pulses along the wires */
            .ebb-pulse { fill: #34d399; opacity: 0; }
            .ebb-pulse-a { animation: ebbPulseA 14s linear infinite; }
            .ebb-pulse-b { animation: ebbPulseB 14s linear infinite; }
            @keyframes ebbPulseA {
              0%, 6%   { transform: translateX(150px); opacity: 0; }
              9%       { opacity: 1; }
              21%      { transform: translateX(330px); opacity: 1; }
              24%,100% { transform: translateX(330px); opacity: 0; }
            }
            @keyframes ebbPulseB {
              0%, 63%  { transform: translateX(528px); opacity: 0; }
              67%      { opacity: 1; }
              78%      { transform: translateX(606px); opacity: 1; }
              81%,100% { transform: translateX(606px); opacity: 0; }
            }

            /* dispatch node fires when the task arrives */
            .ebb-fire { opacity: 0; animation: ebbFire 14s ease-out infinite; }
            @keyframes ebbFire {
              0%, 79%  { r: 9px;  opacity: 0; }
              82%      { r: 9px;  opacity: 0.8; }
              90%      { r: 34px; opacity: 0; }
              100%     { r: 34px; opacity: 0; }
            }
            .ebb-dispatch-dot {
              fill: #3a4453;
              animation: ebbDispatchDot 14s infinite;
            }
            @keyframes ebbDispatchDot {
              0%, 79%  { fill: #3a4453; }
              82%, 92% { fill: #34d399; }
              100%     { fill: #3a4453; }
            }

            /* result + wins pop in after dispatch */
            .ebb-result {
              opacity: 0;
              transform: translate(676px,168px) scale(0.4);
              animation: ebbResult 14s ease-out infinite;
            }
            @keyframes ebbResult {
              0%, 80%   { opacity: 0; transform: translate(676px,168px) scale(0.4); }
              86%       { opacity: 1; transform: translate(676px,168px) scale(1.15); }
              89%, 95%  { opacity: 1; transform: translate(676px,168px) scale(1); }
              100%      { opacity: 0; transform: translate(676px,168px) scale(0.4); }
            }
            .ebb-wins { opacity: 0; animation: ebbWins 14s ease-out infinite; }
            @keyframes ebbWins {
              0%, 83%  { opacity: 0; }
              90%, 95% { opacity: 1; }
              100%     { opacity: 0; }
            }

            /* a coherent still frame for reduced-motion users */
            @media (prefers-reduced-motion: reduce) {
              .ebb-viz * { animation: none !important; }
              .ebb-task { transform: translate(430px,168px); opacity: 1; }
              .ebb-task-box { stroke: #fbbf24; }
              .ebb-task-dot { fill: #fbbf24; }
              .ebb-aura, .ebb-core { fill: #fbbf24; }
              .ebb-status-peak { opacity: 1; }
              .ebb-status-clean { opacity: 0; }
              .ebb-result, .ebb-wins, .ebb-pulse, .ebb-fire { opacity: 0; }
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
        Illustrative — the loop shows the mechanism, not live data. A
        deferrable task waits in the queue through the dirty, strained
        peak hours and is dispatched at the off-peak trough inside its
        deadline. Carbon, cost and latency all move together because they
        all track grid demand; the exact figures vary per region per day.
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
