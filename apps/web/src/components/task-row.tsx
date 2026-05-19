import type { TaskRecord, TaskStatus } from "@/lib/types";

const STATUS_STYLE: Record<TaskStatus, string> = {
  queued: "bg-fg-dim/15 text-fg-muted ring-fg-dim/30",
  scheduled: "bg-accent/15 text-accent ring-accent/30",
  running: "bg-warn/15 text-warn ring-warn/40",
  completed: "bg-band-very-clean/15 text-band-very-clean ring-band-very-clean/30",
  failed: "bg-danger/15 text-danger ring-danger/40",
};

function formatRelative(iso: string | undefined): string {
  if (!iso) return "—";
  const t = new Date(iso).getTime();
  const diffMin = Math.round((t - Date.now()) / 60_000);
  if (Math.abs(diffMin) < 1) return "now";
  if (diffMin > 0) {
    if (diffMin < 60) return `in ${diffMin}m`;
    return `in ${Math.round(diffMin / 60)}h`;
  }
  const ago = -diffMin;
  if (ago < 60) return `${ago}m ago`;
  return `${Math.round(ago / 60)}h ago`;
}

export function TaskRow({ task }: { task: TaskRecord }) {
  return (
    <div className="grid grid-cols-12 items-center gap-3 border-b border-rule px-4 py-3 text-sm last:border-b-0 hover:bg-bg-elev/60">
      <div className="col-span-3 min-w-0">
        <p className="truncate font-mono text-xs text-fg-muted">{task.taskId}</p>
        <p className="text-fg">{task.region}</p>
      </div>

      <div className="col-span-2">
        <span
          className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-mono text-[10px] uppercase tracking-wide ring-1 ${
            STATUS_STYLE[task.status]
          }`}
        >
          <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-current" />
          {task.status}
        </span>
      </div>

      <div className="col-span-2 font-mono text-xs text-fg-muted">
        <span className="block text-fg-dim">enqueued</span>
        {formatRelative(task.enqueuedAt)}
      </div>

      <div className="col-span-2 font-mono text-xs text-fg-muted">
        <span className="block text-fg-dim">
          {task.status === "completed" || task.status === "failed"
            ? "finished"
            : "scheduled"}
        </span>
        {formatRelative(task.completedAt ?? task.scheduledFor)}
      </div>

      <div className="col-span-3 font-mono text-xs">
        {task.receipt ? (
          <div className="text-band-very-clean">
            <span className="block text-fg-dim">
              {task.receipt.model ?? "—"} · {task.receipt.provider ?? "—"}
            </span>
            {task.receipt.estimatedCarbonGCo2.toFixed(1)} gCO2e{" "}
            <span className="text-fg-muted">
              · {Math.round((task.receipt.durationMs ?? 0) / 100) / 10}s
            </span>
          </div>
        ) : task.error ? (
          <p className="truncate text-danger" title={task.error}>
            {task.error}
          </p>
        ) : task.carbonBudgetG !== undefined ? (
          <p className="text-fg-muted">
            <span className="block text-fg-dim">budget</span>
            ≤ {task.carbonBudgetG.toFixed(1)} g
          </p>
        ) : (
          <p className="text-fg-dim">—</p>
        )}
      </div>
    </div>
  );
}
