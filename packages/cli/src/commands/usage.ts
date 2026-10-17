/**
 * `tidegap usage [--json]`: Claude subscription limits (5-hour, weekly,
 * per-model) with their resets. `tidegap usage hook [-- <command>...]`: the
 * Claude Code statusLine command that records them (D1). Always exits 0 for
 * a read: an unavailable state is reported, not an error.
 */

import { stripControlChars } from "@tidegap/core";

import { readUsageEnv } from "../env.js";
import {
  buildUsageDocument,
  clockLabel,
  readHostLimits,
  resolveUsageSettings,
  runStatuslineHook,
  windowLabel,
  type HostLimitsOptions,
  type LimitWindow,
} from "../usage/index.js";

export interface UsageCommandOptions extends HostLimitsOptions {
  json?: boolean;
}

function ago(s: number | undefined): string {
  if (s === undefined) return "";
  if (s < 90) return `${s} s ago`;
  if (s < 5400) return `${Math.round(s / 60)} min ago`;
  return `${Math.round(s / 3600)} h ago`;
}

export async function runUsage(opts: UsageCommandOptions = {}): Promise<string> {
  const { json, ...read } = opts;
  const now = read.now ?? new Date();
  const state = await readHostLimits({ env: readUsageEnv(), ...read, now });
  const doc = buildUsageDocument(state, now);
  if (json) return JSON.stringify(doc, null, 2);

  if (state.status === "disabled") return "Claude limits: off (TIDEGAP_USAGE=off)";
  const lines: string[] = [];
  if (state.status === "unavailable") {
    lines.push(`Claude limits: unavailable: ${state.error?.message ?? "no data"}`);
    return lines.join("\n");
  }
  const asOf = state.fetched_at ? `${clockLabel(new Date(state.fetched_at), now)}, ${ago(state.age_s)}` : "";
  lines.push(`Claude limits (source: ${state.source}, as of ${asOf})`);
  if (state.error) lines.push(`last good value; ${state.error.message}`);
  const rows: Array<[string, LimitWindow]> = [];
  if (state.five_hour) rows.push(["five_hour", state.five_hour]);
  if (state.seven_day) rows.push(["seven_day", state.seven_day]);
  for (const s of state.scoped) rows.push([s.model, s]);
  lines.push(`${"window".padEnd(10)}${"used".padEnd(7)}resets`);
  for (const [name, w] of rows) {
    const passed = Date.parse(w.resets_at) <= now.getTime();
    const resets = passed ? "reset since seen" : clockLabel(new Date(w.resets_at), now);
    lines.push(`${stripControlChars(windowLabel(name)).padEnd(10)}${`${Math.round(w.pct)}%`.padEnd(7)}${resets}`);
  }
  if (doc.target_reset) {
    const t = doc.target_reset;
    lines.push(
      `after limit reset: ${clockLabel(new Date(t.at), now)} (${windowLabel(t.window)} window${t.exhausted ? ", exhausted" : ""})`,
    );
  }
  return lines.join("\n");
}

async function readStdin(): Promise<string> {
  if (process.stdin.isTTY) return "";
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

/** `tidegap usage hook [-- <command> [args...]]`. Resolves to the exit code. */
export async function runUsageHook(wrapped: string[]): Promise<number> {
  const stdin = await readStdin();
  return runStatuslineHook(stdin, wrapped, { settings: resolveUsageSettings(readUsageEnv()) });
}
