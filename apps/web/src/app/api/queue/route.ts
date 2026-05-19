/**
 * GET /api/queue
 *
 * Returns a stub queue snapshot. In v0.2 the dashboard does not talk to
 * `@ebb-ai/mcp` yet — there is no shared transport (the MCP server is
 * stdio-only and per-client). v0.3 will introduce an HTTP control plane
 * exposed by the scheduler; until then, this endpoint serves a realistic
 * but synthetic snapshot, generated deterministically per UTC day so
 * screenshots stay reproducible.
 *
 * Wiring plan (v0.3, see ROADMAP.md §4.4):
 *   - `@ebb-ai/scheduler` will run as a long-lived process and expose
 *     `GET /tasks` returning `TaskRecord[]`.
 *   - This route will proxy that endpoint, with auth.
 */

import { NextResponse } from "next/server";
import type { TaskRecord } from "@/lib/types";
import { classifyBand, intensityToGrams } from "@/lib/grid";
import { REGIONS } from "@/lib/regions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STATUSES: TaskRecord["status"][] = [
  "queued",
  "scheduled",
  "scheduled",
  "running",
  "completed",
  "completed",
  "completed",
  "failed",
];

const PROVIDERS = ["anthropic", "openai", "google", "ollama-local"];
const MODELS = [
  "claude-sonnet-4-5",
  "claude-opus-4-1",
  "gpt-4o",
  "gpt-4o-mini",
  "gemini-2.0-pro",
  "llama-3.1-70b",
];

export async function GET() {
  const tasks = generateStubQueue();
  return NextResponse.json(
    {
      tasks,
      generatedAt: new Date().toISOString(),
      stub: true,
      note: "demo data — the dashboard does not yet talk to ebb-mcp. " +
            "For real per-user queue data, run `ebb stats` or `ebb queue list` " +
            "from the @ebb-ai/cli package against ~/.ebb-ai/queue.db. A scheduler " +
            "HTTP control plane is planned for v0.9.",
    },
    {
      headers: {
        "cache-control": "public, s-maxage=60, stale-while-revalidate=60",
      },
    },
  );
}

/**
 * Deterministic per-minute RNG so screenshots are stable within a session
 * but the queue still visibly evolves over a workday.
 */
function rand(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

function generateStubQueue(): TaskRecord[] {
  const now = new Date();
  // Bucket per 5-minute slot so the queue updates visibly.
  const slot = Math.floor(now.getTime() / (5 * 60 * 1000));
  const rng = rand(slot);
  const count = 12 + Math.floor(rng() * 6);

  const tasks: TaskRecord[] = [];
  for (let i = 0; i < count; i++) {
    const status =
      STATUSES[Math.floor(rng() * STATUSES.length)] ?? "queued";
    const region = REGIONS[Math.floor(rng() * REGIONS.length)]?.zone ?? "US-CAL-CISO";
    const provider = PROVIDERS[Math.floor(rng() * PROVIDERS.length)] ?? "anthropic";
    const model = MODELS[Math.floor(rng() * MODELS.length)] ?? "claude-sonnet-4-5";

    const enqueuedOffsetMin = Math.floor(rng() * 90);
    const enqueuedAt = new Date(now.getTime() - enqueuedOffsetMin * 60_000);

    const scheduledOffsetMin = Math.floor(rng() * 24 * 60);
    const scheduledFor = new Date(now.getTime() + scheduledOffsetMin * 60_000);
    const completedAt =
      status === "completed" || status === "failed"
        ? new Date(now.getTime() - Math.floor(rng() * 30) * 60_000)
        : undefined;

    const taskId = `t-${slot.toString(36)}-${i.toString().padStart(2, "0")}`;
    const carbonBudgetG = rng() > 0.4 ? Math.round((0.3 + rng() * 1.7) * 10) / 10 : undefined;

    // Cleaner intensities for "completed" tasks to reflect that the
    // scheduler intentionally picks low-carbon hours.
    let intensity: number;
    if (status === "completed") {
      intensity = 60 + Math.floor(rng() * 180);
    } else {
      intensity = 80 + Math.floor(rng() * 480);
    }

    const record: TaskRecord = {
      taskId,
      status,
      region,
      enqueuedAt: enqueuedAt.toISOString(),
    };

    if (carbonBudgetG !== undefined) record.carbonBudgetG = carbonBudgetG;

    if (status === "scheduled" || status === "running") {
      record.scheduledFor = scheduledFor.toISOString();
    }
    if (completedAt) record.completedAt = completedAt.toISOString();

    if (status === "completed") {
      record.receipt = {
        taskId,
        ranAt: (completedAt ?? now).toISOString(),
        region,
        estimatedCarbonGCo2: intensityToGrams(intensity),
        provider,
        model,
        durationMs: 600 + Math.floor(rng() * 4200),
      };
      record.intensitySource = rng() > 0.3 ? "scored" : "current";
    }
    if (status === "failed") {
      record.error =
        rng() > 0.5
          ? "CarbonBudgetExceededError: cheapest reachable window costs 1.4 gCO2e > budget 1.0"
          : "Provider returned 529 overloaded";
    }

    // Mark the band on completed tasks (informational; not part of TaskRecord).
    // We leave the type narrow and just emit the canonical fields.
    classifyBand(intensity); // touch to make tree-shake happy
    tasks.push(record);
  }
  // Sort: running first, then scheduled by time, then queued, then completed/failed.
  const rank: Record<TaskRecord["status"], number> = {
    running: 0,
    scheduled: 1,
    queued: 2,
    completed: 3,
    failed: 4,
  };
  tasks.sort((a, b) => {
    const ra = rank[a.status];
    const rb = rank[b.status];
    if (ra !== rb) return ra - rb;
    return (a.scheduledFor ?? a.enqueuedAt).localeCompare(
      b.scheduledFor ?? b.enqueuedAt,
    );
  });
  return tasks;
}
