/**
 * Regression tests for the store/in-memory identity bug.
 *
 * schedule_task / check_queue_status read the durable SQLite store, but
 * cancel/update used to look at an in-memory Map only — so after the
 * enqueuing process exited (an OpenClaw gateway restart) a task was
 * visible by id yet "not found" on cancel. A fresh Scheduler instance
 * pointed at the same DB must resolve persisted tasks through the store.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { mockGridFeed, Scheduler, TaskStore } from "../src/index.js";
import type { ProviderAdapter } from "../src/index.js";

function stubAdapter(provider: "anthropic" | "openai"): ProviderAdapter {
  return {
    provider,
    ready: true,
    async dispatch(model: string, prompt: string) {
      return { text: `stub-reply:${prompt}`, model, provider, raw: {} };
    },
    async dispatchBatch() {
      throw new Error("stub: batch not supported");
    },
  };
}

const future = () => new Date(Date.now() + 6 * 60 * 60 * 1000);

describe("cross-process task identity (store-backed scheduler)", () => {
  let tmp: string;
  let dbPath: string;

  beforeAll(() => {
    tmp = mkdtempSync(join(tmpdir(), "ebb-xproc-"));
    dbPath = join(tmp, "queue.db");
  });
  afterAll(() => rmSync(tmp, { recursive: true, force: true }));

  it("a second scheduler instance can cancel a task it never enqueued", async () => {
    const producer = new Scheduler({ dbPath, feed: mockGridFeed() });
    const rec = await producer.enqueueProviderCall(
      {
        type: "provider_call",
        provider: "anthropic",
        model: "claude-sonnet-4-6",
        prompt: "summarise the day",
      },
      { deadline: future(), region: "GB" },
    );
    expect(rec.status).toBe("scheduled");

    // A fresh instance == a gateway restart: empty in-memory map, same DB.
    const consumer = new Scheduler({ dbPath, feed: mockGridFeed() });
    const cancelled = consumer.cancelTask(rec.taskId);
    expect(cancelled.status).toBe("cancelled");

    // The cancellation is durable.
    const store = new TaskStore({ dbPath });
    expect(store.get(rec.taskId)?.status).toBe("cancelled");
    store.close();
  });

  it("cancelTask is idempotent and still throws for a genuinely unknown id", async () => {
    const producer = new Scheduler({ dbPath, feed: mockGridFeed() });
    const rec = await producer.enqueueProviderCall(
      { type: "provider_call", provider: "anthropic", model: "m", prompt: "y" },
      { deadline: future(), region: "GB" },
    );

    const consumer = new Scheduler({ dbPath, feed: mockGridFeed() });
    expect(consumer.cancelTask(rec.taskId).status).toBe("cancelled");
    // Second cancel on a terminal task — returns existing status, no throw.
    expect(consumer.cancelTask(rec.taskId).status).toBe("cancelled");
    // A truly unknown id is the only case that throws.
    expect(() => consumer.cancelTask("t-does-not-exist")).toThrow(/not found/);
  });

  it("updateDeadline works against a persisted task from a fresh instance", async () => {
    const producer = new Scheduler({ dbPath, feed: mockGridFeed() });
    const rec = await producer.enqueueProviderCall(
      { type: "provider_call", provider: "anthropic", model: "m", prompt: "z" },
      { deadline: future(), region: "GB" },
    );

    const consumer = new Scheduler({ dbPath, feed: mockGridFeed() });
    const updated = await consumer.updateDeadline(
      rec.taskId,
      new Date(Date.now() + 12 * 60 * 60 * 1000),
    );
    expect(["queued", "scheduled"]).toContain(updated.status);
  });

  it("a fresh scheduler dispatches an overdue persisted scheduled task", async () => {
    const store = new TaskStore({ dbPath });
    const producer = new Scheduler({ store, feed: mockGridFeed() });
    const rec = await producer.enqueueProviderCall(
      { type: "provider_call", provider: "anthropic", model: "m", prompt: "run me" },
      { deadline: future(), region: "GB" },
    );

    // Force the chosen window into the past — the task is now overdue.
    const persisted = store.get(rec.taskId);
    if (!persisted) throw new Error("task not persisted");
    persisted.status = "scheduled";
    persisted.scheduledFor = new Date(Date.now() - 60_000).toISOString();
    store.upsert(persisted);

    // A fresh scheduler (restart) must pick the overdue task up via tick.
    const consumer = new Scheduler({ store, feed: mockGridFeed() });
    const result = await consumer.tick({ anthropic: stubAdapter("anthropic") });
    expect(result.dispatched).toBe(1);
    expect(store.get(rec.taskId)?.status).toBe("completed");
    store.close();
  });
});
