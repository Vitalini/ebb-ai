/**
 * `ebb stats` — local-only personal-impact aggregator.
 *
 * Reads the SQLite ledger at ~/.ebb-ai/queue.db (or --db) and renders the
 * cumulative carbon stats + per-region breakdown + achievement-badge list.
 * No telemetry, no network, no third-party reporting — everything stays
 * on the user's machine. The dashboard `/stats` route reads the same
 * shape over the (planned v0.9) scheduler HTTP API.
 *
 * v0.8 surface: read-only. Future versions may add `--since` window
 * filters and `--per-day` time-bucket histograms.
 */

import {
  TaskStore,
  aggregateStats,
  aggregateByRegion,
  bandHistogram,
  achievements,
  type CarbonStats,
  type RegionStats,
  type BandHistogram,
  type Achievement,
} from "@ebb-ai/core";
import { defaultDbPath } from "./tick.js";

export interface StatsCommandOptions {
  db?: string;
  json?: boolean;
}

export interface StatsResult {
  rendered: string;
  stats: CarbonStats;
  perRegion: RegionStats[];
  bands: BandHistogram;
  badges: Achievement[];
}

function fmtNumber(n: number): string {
  if (n === 0) return "0";
  if (Math.abs(n) < 1) return n.toFixed(3);
  if (Math.abs(n) < 10) return n.toFixed(2);
  if (Math.abs(n) < 100) return n.toFixed(1);
  return Math.round(n).toLocaleString("en-US");
}

function fmtPercent(num: number, den: number): string {
  if (den === 0) return "—";
  return `${Math.round((num / den) * 100)}%`;
}

function relativeTime(iso: string | null): string {
  if (!iso) return "—";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return iso;
  const days = Math.max(1, Math.round((Date.now() - then) / (24 * 60 * 60 * 1000)));
  return `${iso.slice(0, 10)} (${days}d ago)`;
}

export function renderStats(r: StatsResult): string {
  const { stats, perRegion, bands, badges } = r;
  const lines: string[] = [];
  lines.push("ebb-ai · personal impact");
  lines.push("=".repeat(48));
  lines.push("");
  lines.push(`Tasks dispatched          ${fmtNumber(stats.taskCount)}`);
  lines.push(`Estimated CO2e accounted  ${fmtNumber(stats.totalEstimatedCarbonGCo2)} g`);
  lines.push(`Cleanest-window hits      ${stats.scoredHits} (${fmtPercent(stats.scoredHits, stats.taskCount)})`);
  lines.push(`Run-now dispatches        ${stats.currentDispatches}`);
  lines.push(`Expedited (skip window)   ${stats.expeditedDispatches}`);
  lines.push(`First task                ${relativeTime(stats.firstRanAt)}`);
  lines.push(`Most recent               ${relativeTime(stats.lastRanAt)}`);
  lines.push("");

  if (perRegion.length > 0) {
    lines.push("by region");
    lines.push("-".repeat(48));
    for (const r of perRegion.slice(0, 20)) {
      const tail = `${String(r.taskCount).padStart(5)}  ${fmtNumber(r.totalEstimatedCarbonGCo2).padStart(8)} g  (${fmtNumber(r.avgEstimatedCarbonGCo2)}/task)`;
      lines.push(`  ${r.region.padEnd(20)}${tail}`);
    }
    lines.push("");
  }

  const totalBands =
    bands.veryClean + bands.clean + bands.average + bands.dirty + bands.veryDirty;
  if (totalBands > 0) {
    lines.push("dispatch grid-band distribution");
    lines.push("-".repeat(48));
    for (const [k, v] of Object.entries(bands)) {
      const pct = fmtPercent(v as number, totalBands).padStart(4);
      const bar = "#".repeat(Math.round(((v as number) / totalBands) * 32));
      lines.push(`  ${k.padEnd(12)} ${String(v).padStart(5)}  ${pct}  ${bar}`);
    }
    lines.push("");
  }

  const unlocked = badges.filter((b) => b.unlocked);
  const locked = badges.filter((b) => !b.unlocked);
  lines.push(`achievements  (${unlocked.length}/${badges.length} unlocked)`);
  lines.push("-".repeat(48));
  for (const b of badges) {
    const mark = b.unlocked ? "✓" : "·";
    lines.push(`  ${mark} ${b.label.padEnd(22)} ${b.description}`);
  }
  lines.push("");

  if (stats.taskCount === 0) {
    lines.push(
      "Queue is empty. Run `/ebb-ai:defer …` from a Claude Code session,",
    );
    lines.push("or `npx -y @ebb-ai/mcp` from your MCP host, to start.");
  }

  return lines.join("\n");
}

export async function runStats(opts: StatsCommandOptions = {}): Promise<StatsResult> {
  const dbPath = opts.db ?? defaultDbPath();
  const store = new TaskStore({ dbPath });
  try {
    const completed = store.list({ status: "completed" });
    const stats = aggregateStats(completed);
    const perRegion = aggregateByRegion(completed);
    const bands = bandHistogram(completed);
    const badges = achievements(stats, perRegion);
    const result: StatsResult = { rendered: "", stats, perRegion, bands, badges };
    result.rendered = renderStats(result);
    if (opts.json) {
      result.rendered = JSON.stringify(
        { stats, perRegion, bands, badges },
        null,
        2,
      );
    }
    return result;
  } finally {
    store.close();
  }
}
