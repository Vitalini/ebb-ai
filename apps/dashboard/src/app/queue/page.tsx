import { TaskRow } from "@/components/task-row";
import { intensityToGrams } from "@/lib/grid";
import type { TaskRecord } from "@/lib/types";

export const dynamic = "force-dynamic";
export const revalidate = 0;

interface QueuePayload {
  tasks: TaskRecord[];
  generatedAt: string;
  stub: boolean;
}

async function loadQueue(): Promise<QueuePayload> {
  // The /api/queue route is on this same Next.js server. We use a relative
  // call via the headers() URL pattern only on the edge; on Node we can call
  // the route handler logic, but to keep one source of truth we use fetch.
  // In dev/production this resolves through Next's internal fetcher.
  const base =
    process.env.NEXT_PUBLIC_BASE_URL ??
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:3000");
  try {
    const res = await fetch(`${base}/api/queue`, { cache: "no-store" });
    if (!res.ok) throw new Error(`queue endpoint ${res.status}`);
    return (await res.json()) as QueuePayload;
  } catch {
    // Hard fallback — shouldn't happen, but a dashboard that goes blank on a
    // backend wobble is worse than one that says "no data".
    return { tasks: [], generatedAt: new Date().toISOString(), stub: true };
  }
}

export default async function QueuePage() {
  const { tasks, generatedAt, stub } = await loadQueue();

  const counts = countByStatus(tasks);
  const totalGrams = tasks
    .filter((t) => t.receipt)
    .reduce((acc, t) => acc + (t.receipt?.estimatedCarbonGCo2 ?? 0), 0);
  const counterfactualGrams = tasks
    .filter((t) => t.receipt)
    .reduce((acc) => acc + intensityToGrams(450), 0); // assume avg grid as counterfactual
  const saved = Math.max(0, counterfactualGrams - totalGrams);
  const savedPct =
    counterfactualGrams > 0 ? Math.round((saved / counterfactualGrams) * 100) : 0;

  return (
    <div className="space-y-10">
      <header className="space-y-3">
        <p className="font-mono text-xs uppercase tracking-wider text-accent">
          scheduler queue
        </p>
        <h1 className="text-3xl font-bold tracking-tight text-fg sm:text-4xl">
          Pending and recent tasks
        </h1>
        <p className="max-w-2xl text-sm text-fg-muted">
          Snapshot of the in-process scheduler. Completed tasks carry a carbon
          receipt — the exact intensity the scheduler scored against when it
          picked the window.
        </p>
        <p className="text-xs text-fg-dim">
          {stub
            ? "stub data — the dashboard does not talk to ebb-mcp yet (v0.3 wires this through the scheduler HTTP API)"
            : "live"}
          {" · "}
          updated{" "}
          {new Date(generatedAt).toLocaleString(undefined, {
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
          })}
        </p>
      </header>

      <section className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        <Stat label="queued" value={counts.queued} />
        <Stat label="scheduled" value={counts.scheduled} tone="accent" />
        <Stat label="running" value={counts.running} tone="warn" />
        <Stat label="completed" value={counts.completed} tone="good" />
        <Stat label="failed" value={counts.failed} tone="bad" />
      </section>

      <section className="rounded-xl border border-rule bg-bg-elev p-5">
        <h2 className="text-sm font-semibold text-fg">
          Cumulative carbon receipts (this snapshot)
        </h2>
        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
          <BigStat
            value={totalGrams.toFixed(1)}
            unit="gCO2e"
            label="dispatched"
          />
          <BigStat
            value={saved.toFixed(1)}
            unit="gCO2e"
            label="saved vs. avg grid"
            tone="good"
          />
          <BigStat
            value={`${savedPct}%`}
            unit=""
            label="reduction"
            tone="good"
          />
        </div>
        <p className="mt-3 text-[11px] text-fg-muted">
          Counterfactual: the same tasks dispatched at 450 g/kWh (US 2024
          fleet-wide average per EIA short-term outlook). Actual savings depend
          on region and deadline.
        </p>
      </section>

      <section>
        <div className="overflow-hidden rounded-xl border border-rule bg-bg-elev">
          <div className="grid grid-cols-12 gap-3 border-b border-rule-hi bg-bg px-4 py-2 font-mono text-[10px] uppercase tracking-wider text-fg-dim">
            <div className="col-span-3">task / region</div>
            <div className="col-span-2">status</div>
            <div className="col-span-2">enqueued</div>
            <div className="col-span-2">scheduled / done</div>
            <div className="col-span-3">receipt</div>
          </div>
          {tasks.length === 0 ? (
            <p className="px-4 py-6 text-sm text-fg-muted">
              No tasks in queue. Try the planner to enqueue one.
            </p>
          ) : (
            tasks.map((t) => <TaskRow key={t.taskId} task={t} />)
          )}
        </div>
      </section>
    </div>
  );
}

function countByStatus(tasks: TaskRecord[]): Record<TaskRecord["status"], number> {
  const out: Record<TaskRecord["status"], number> = {
    queued: 0,
    scheduled: 0,
    running: 0,
    completed: 0,
    failed: 0,
  };
  for (const t of tasks) out[t.status] += 1;
  return out;
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: "good" | "bad" | "warn" | "accent";
}) {
  const toneClass =
    tone === "good"
      ? "text-band-very-clean"
      : tone === "bad"
        ? "text-danger"
        : tone === "warn"
          ? "text-warn"
          : tone === "accent"
            ? "text-accent"
            : "text-fg";
  return (
    <div className="rounded-xl border border-rule bg-bg-elev p-4">
      <p className="font-mono text-[10px] uppercase tracking-wider text-fg-dim">
        {label}
      </p>
      <p className={`mt-1 font-mono text-2xl font-semibold ${toneClass}`}>
        {value}
      </p>
    </div>
  );
}

function BigStat({
  value,
  unit,
  label,
  tone,
}: {
  value: string;
  unit: string;
  label: string;
  tone?: "good";
}) {
  const toneClass = tone === "good" ? "text-band-very-clean" : "text-fg";
  return (
    <div>
      <p className="font-mono text-[10px] uppercase tracking-wider text-fg-dim">
        {label}
      </p>
      <p className={`mt-1 font-mono text-3xl font-semibold ${toneClass}`}>
        {value}
        {unit ? <span className="ml-1 text-base font-normal text-fg-muted">{unit}</span> : null}
      </p>
    </div>
  );
}
