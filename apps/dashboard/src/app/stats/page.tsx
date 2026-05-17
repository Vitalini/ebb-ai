/**
 * /stats — personal-impact dashboard surface (preview).
 *
 * Mirrors the data shape that `ebb stats` (the @ebb-ai/cli command added
 * in v0.8.0) renders against the local SQLite ledger. This page serves a
 * deterministic synthetic snapshot so visitors can see the UI shape;
 * a scheduler HTTP control plane (planned for v0.9) will wire this
 * surface to a real per-user queue.
 *
 * The page is a static demo today. The number-formatting and the
 * achievements palette match `packages/core-ts/src/aggregator.ts` so
 * the two stay visually consistent.
 */

import Link from "next/link";

export const dynamic = "force-dynamic";

interface DemoStats {
  taskCount: number;
  totalEstimatedCarbonGCo2: number;
  scoredHits: number;
  currentDispatches: number;
  expeditedDispatches: number;
  firstRanAt: string;
  lastRanAt: string;
}

interface DemoRegion {
  region: string;
  taskCount: number;
  totalEstimatedCarbonGCo2: number;
  avgEstimatedCarbonGCo2: number;
}

interface DemoBand {
  veryClean: number;
  clean: number;
  average: number;
  dirty: number;
  veryDirty: number;
}

interface DemoBadge {
  id: string;
  label: string;
  description: string;
  unlocked: boolean;
}

function seeded(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function generateDemo(): {
  stats: DemoStats;
  regions: DemoRegion[];
  bands: DemoBand;
  badges: DemoBadge[];
} {
  // Stable per-hour so the screenshot is reproducible within a session
  // but the page visibly evolves through the day.
  const slot = Math.floor(Date.now() / (60 * 60 * 1000));
  const rng = seeded(slot);

  const regions = [
    "US-CAL-CISO",
    "US-TEX-ERCO",
    "GB",
    "FR",
    "DE",
    "US-MIDA-PJM",
  ];

  const regionRows: DemoRegion[] = regions
    .map((r) => {
      const taskCount = 8 + Math.floor(rng() * 40);
      const avg = 0.12 + rng() * 0.4;
      const total = Math.round(taskCount * avg * 100) / 100;
      return {
        region: r,
        taskCount,
        totalEstimatedCarbonGCo2: total,
        avgEstimatedCarbonGCo2: Math.round((total / taskCount) * 100) / 100,
      };
    })
    .sort((a, b) => b.taskCount - a.taskCount);

  const totalTaskCount = regionRows.reduce((s, r) => s + r.taskCount, 0);
  const totalCarbon = regionRows.reduce(
    (s, r) => s + r.totalEstimatedCarbonGCo2,
    0,
  );
  const scored = Math.round(totalTaskCount * (0.78 + rng() * 0.1));
  const current = Math.round(totalTaskCount * (0.12 + rng() * 0.06));
  const expedited = Math.max(0, totalTaskCount - scored - current);

  const stats: DemoStats = {
    taskCount: totalTaskCount,
    totalEstimatedCarbonGCo2: Math.round(totalCarbon * 100) / 100,
    scoredHits: scored,
    currentDispatches: current,
    expeditedDispatches: expedited,
    firstRanAt: new Date(Date.now() - 18 * 24 * 60 * 60 * 1000).toISOString(),
    lastRanAt: new Date(Date.now() - 30 * 60 * 1000).toISOString(),
  };

  const bands: DemoBand = {
    veryClean: Math.round(totalTaskCount * 0.32),
    clean: Math.round(totalTaskCount * 0.41),
    average: Math.round(totalTaskCount * 0.18),
    dirty: Math.round(totalTaskCount * 0.07),
    veryDirty: Math.round(totalTaskCount * 0.02),
  };

  const badges: DemoBadge[] = [
    { id: "first-deferral",     label: "🌱  First Deferral", description: "Queue your first ebb-ai task.",                       unlocked: stats.taskCount >= 1 },
    { id: "ten-deferrals",      label: "⚡  Ten Up",         description: "Ship 10 deferred tasks.",                              unlocked: stats.taskCount >= 10 },
    { id: "hundred-deferrals",  label: "🔋  Centurion",      description: "Ship 100 deferred tasks.",                             unlocked: stats.taskCount >= 100 },
    { id: "thousand-deferrals", label: "🌍  Long Run",       description: "Ship 1 000 deferred tasks.",                           unlocked: stats.taskCount >= 1_000 },
    { id: "multi-region",       label: "🗺️  World Tour",     description: "Dispatch across three or more grid regions.",          unlocked: regionRows.length >= 3 },
    { id: "scored-streak",      label: "🎯  Sniper",         description: "Honour the scored window for 90%+ of completed tasks.", unlocked: stats.taskCount >= 10 && stats.scoredHits / stats.taskCount >= 0.9 },
    { id: "endurance",          label: "📅  Endurance",      description: "Active across 7+ calendar days.",                       unlocked: true },
  ];

  return { stats, regions: regionRows, bands, badges };
}

export default function StatsPage() {
  const { stats, regions, bands, badges } = generateDemo();

  const totalBands =
    bands.veryClean + bands.clean + bands.average + bands.dirty + bands.veryDirty;
  const bandRows: Array<{ key: keyof DemoBand; label: string; count: number; pct: number }> = [
    { key: "veryClean", label: "very clean", count: bands.veryClean,  pct: Math.round((bands.veryClean / totalBands) * 100) },
    { key: "clean",     label: "clean",      count: bands.clean,      pct: Math.round((bands.clean / totalBands) * 100) },
    { key: "average",   label: "average",    count: bands.average,    pct: Math.round((bands.average / totalBands) * 100) },
    { key: "dirty",     label: "dirty",      count: bands.dirty,      pct: Math.round((bands.dirty / totalBands) * 100) },
    { key: "veryDirty", label: "very dirty", count: bands.veryDirty,  pct: Math.round((bands.veryDirty / totalBands) * 100) },
  ];

  return (
    <div className="space-y-10">
      <header className="space-y-3">
        <p className="font-mono text-xs uppercase tracking-wider text-accent">
          personal impact
        </p>
        <h1 className="text-3xl font-bold tracking-tight text-fg sm:text-4xl">
          Your ebb-ai stats
        </h1>
        <p className="max-w-2xl text-sm text-fg-muted">
          Local-only aggregation across your queue ledger. The numbers
          below show: how many deferred tasks you have shipped, how often
          the scheduler hit the cleanest window, the per-region split,
          the grid-band histogram of where your dispatches landed, and
          which achievement badges you have unlocked.
        </p>
      </header>

      <aside className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-4 text-sm text-fg-muted">
        <p className="mb-1 font-mono text-xs uppercase tracking-wider text-amber-500">
          demo mode — preview
        </p>
        <p>
          This page is a deterministic synthetic snapshot. For your real
          local numbers, install the CLI and run <code className="font-mono text-fg">npx -y @ebb-ai/cli@latest stats</code>{" "}
          against your local <code className="font-mono text-fg">~/.ebb-ai/queue.db</code>.
          A scheduler HTTP control plane is on the v0.9 roadmap to
          surface your real data here through the dashboard.
        </p>
      </aside>

      {/* Cumulative stats */}
      <section className="rounded-xl border border-rule bg-bg-elev p-5">
        <h2 className="text-sm font-semibold text-fg">Cumulative impact</h2>
        <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-5">
          <BigStat value={stats.taskCount.toLocaleString()}                     unit=""        label="tasks dispatched" />
          <BigStat value={stats.totalEstimatedCarbonGCo2.toFixed(1)}             unit="gCO2e"   label="CO₂ accounted" />
          <BigStat value={stats.scoredHits.toString()}                           unit=""        label="cleanest-window hits" tone="good" />
          <BigStat value={stats.currentDispatches.toString()}                    unit=""        label="run-now" />
          <BigStat value={stats.expeditedDispatches.toString()}                  unit=""        label="expedited (skipped window)" tone="warn" />
        </div>
        <p className="mt-4 text-xs text-fg-dim">
          First task {new Date(stats.firstRanAt).toLocaleDateString()} ·
          most recent {new Date(stats.lastRanAt).toLocaleString(undefined, { hour: "2-digit", minute: "2-digit" })} ·
          {" "}
          {stats.taskCount > 0
            ? `${Math.round((stats.scoredHits / stats.taskCount) * 100)}% scored-hit rate`
            : "no tasks yet"}
        </p>
      </section>

      {/* Per-region */}
      <section>
        <h2 className="mb-4 text-sm font-semibold text-fg">By region</h2>
        <div className="overflow-hidden rounded-xl border border-rule bg-bg-elev">
          <table className="w-full text-sm">
            <thead className="bg-bg-elev-2 text-fg-dim">
              <tr>
                <th className="px-4 py-2 text-left font-mono text-xs uppercase tracking-wider">region</th>
                <th className="px-4 py-2 text-right font-mono text-xs uppercase tracking-wider">tasks</th>
                <th className="px-4 py-2 text-right font-mono text-xs uppercase tracking-wider">total gCO2e</th>
                <th className="px-4 py-2 text-right font-mono text-xs uppercase tracking-wider">avg per task</th>
              </tr>
            </thead>
            <tbody>
              {regions.map((r) => (
                <tr key={r.region} className="border-t border-rule">
                  <td className="px-4 py-2 font-mono text-fg">{r.region}</td>
                  <td className="px-4 py-2 text-right font-mono text-fg">{r.taskCount}</td>
                  <td className="px-4 py-2 text-right font-mono text-fg">{r.totalEstimatedCarbonGCo2.toFixed(2)}</td>
                  <td className="px-4 py-2 text-right font-mono text-fg-muted">{r.avgEstimatedCarbonGCo2.toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Band histogram */}
      <section>
        <h2 className="mb-4 text-sm font-semibold text-fg">Dispatch grid-band distribution</h2>
        <div className="rounded-xl border border-rule bg-bg-elev p-5">
          <div className="space-y-3">
            {bandRows.map((b) => (
              <div key={b.key} className="grid grid-cols-[minmax(0,100px)_1fr_minmax(0,80px)] items-center gap-3">
                <div className="text-xs font-mono text-fg-muted">{b.label}</div>
                <div className="relative h-6 overflow-hidden rounded bg-bg-elev-2">
                  <div
                    className={`absolute inset-y-0 left-0 ${
                      b.key === "veryClean" ? "bg-emerald-500/60" :
                      b.key === "clean" ? "bg-accent/70" :
                      b.key === "average" ? "bg-amber-500/60" :
                      b.key === "dirty" ? "bg-orange-500/60" : "bg-red-500/60"
                    }`}
                    style={{ width: `${b.pct}%` }}
                  />
                </div>
                <div className="text-right text-xs font-mono text-fg-muted">{b.count} · {b.pct}%</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Achievements */}
      <section>
        <h2 className="mb-4 text-sm font-semibold text-fg">
          Achievements <span className="text-fg-dim">({badges.filter((b) => b.unlocked).length} / {badges.length} unlocked)</span>
        </h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {badges.map((b) => (
            <div
              key={b.id}
              className={`rounded-lg border p-4 ${
                b.unlocked
                  ? "border-accent/40 bg-accent/5"
                  : "border-rule bg-bg-elev opacity-50"
              }`}
            >
              <div className="text-base font-semibold text-fg">{b.label}</div>
              <p className="mt-1 text-xs text-fg-muted">{b.description}</p>
              <p className="mt-2 font-mono text-[10px] uppercase tracking-wider">
                {b.unlocked ? <span className="text-accent">unlocked</span> : <span className="text-fg-dim">locked</span>}
              </p>
            </div>
          ))}
        </div>
      </section>

      <footer className="rounded-xl border border-rule bg-bg-elev p-5 text-sm text-fg-muted">
        <p className="mb-2 font-mono text-xs uppercase tracking-wider text-accent">
          getting real numbers
        </p>
        <p>
          <code className="font-mono text-fg">npx -y @ebb-ai/cli@latest stats</code>{" "}
          reads <code className="font-mono text-fg">~/.ebb-ai/queue.db</code> and prints exactly the same shape locally. The CLI ships with
          {" "}<code className="font-mono text-fg">@ebb-ai/cli@0.8.1</code>.
        </p>
        <p className="mt-2">
          See <Link href="/architecture" className="underline">architecture</Link>,
          {" "}<Link href="/docs" className="underline">docs</Link>, or the{" "}
          <a href="https://github.com/Vitalini/ebb-ai" className="underline" target="_blank" rel="noreferrer">repository</a>{" "}
          for the full surface.
        </p>
      </footer>
    </div>
  );
}

function BigStat({ value, unit, label, tone }: { value: string; unit: string; label: string; tone?: "good" | "warn" | "bad" }) {
  const toneClass =
    tone === "good" ? "text-emerald-400" :
    tone === "warn" ? "text-amber-400" :
    tone === "bad" ? "text-red-400" :
    "text-fg";
  return (
    <div>
      <div className={`text-2xl font-bold ${toneClass}`}>
        {value}
        {unit ? <span className="ml-1 text-sm font-normal text-fg-dim">{unit}</span> : null}
      </div>
      <div className="mt-1 text-xs font-mono uppercase tracking-wider text-fg-dim">
        {label}
      </div>
    </div>
  );
}
