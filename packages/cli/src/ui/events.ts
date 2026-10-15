/**
 * Change feed for `ebb ui` (KTD10). Polls `PRAGMA data_version`, which moves
 * when another connection commits (the tick, the MCP server). On a move it
 * re-lists the ledger and reports the ids whose status, read marker or
 * scheduled time changed. The server's own writes do not move
 * `data_version`, so the server calls `emit` itself after a mark-read.
 */

import type { TaskStore } from "@ebb-ai/core";

export type TaskChangeListener = (ids: string[]) => void;

export class TaskEvents {
  private readonly listeners = new Set<TaskChangeListener>();
  private fingerprints: Map<string, string>;
  private version: number;
  private timer: NodeJS.Timeout | undefined;

  constructor(
    private readonly store: TaskStore,
    private readonly intervalMs = 2_000,
  ) {
    this.version = store.dataVersion();
    this.fingerprints = this.snapshot();
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => this.poll(), this.intervalMs);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    this.listeners.clear();
  }

  subscribe(fn: TaskChangeListener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** Push a change the poller cannot see (the server's own write). */
  emit(ids: string[]): void {
    this.fingerprints = this.snapshot();
    for (const fn of this.listeners) fn(ids);
  }

  /** One poll step; public so tests need not wait on the timer. */
  poll(): void {
    let v: number;
    try {
      v = this.store.dataVersion();
    } catch {
      return;
    }
    if (v === this.version) return;
    this.version = v;
    const next = this.snapshot();
    const changed: string[] = [];
    for (const [id, fp] of next) if (this.fingerprints.get(id) !== fp) changed.push(id);
    for (const id of this.fingerprints.keys()) if (!next.has(id)) changed.push(id);
    this.fingerprints = next;
    if (changed.length > 0) for (const fn of this.listeners) fn(changed);
  }

  private snapshot(): Map<string, string> {
    const out = new Map<string, string>();
    for (const r of this.store.list()) {
      out.set(r.taskId, `${r.status}|${r.readAt ?? ""}|${r.scheduledFor ?? ""}|${r.deadline ?? ""}`);
    }
    return out;
  }
}
