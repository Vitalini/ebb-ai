/**
 * Task visibility (v0.17) through the REAL MCP handlers: titles, origin,
 * quota_reset deadlines, mark-read on single-task status, last_tick_at.
 */

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import {
  loadQuotaResetConfig,
  mockGridFeed,
  resolveQuotaDeadline,
  TaskStore,
} from "@ebb-ai/core";
import { afterEach, describe, expect, it } from "vitest";
import { createEbbServer } from "../src/server.js";

type TextResult = { content: Array<{ type: string; text: string }>; isError?: boolean };

const cleanups: Array<() => void> = [];
afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()!();
});

function tmp(): { dbPath: string; configPath: string } {
  const dir = mkdtempSync(join(tmpdir(), "ebb-mcp-visibility-"));
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
  return { dbPath: join(dir, "queue.db"), configPath: join(dir, "config") };
}

async function connect(dbPath: string, quotaConfigPath: string) {
  const built = createEbbServer({ feed: mockGridFeed(), dbPath, quotaConfigPath });
  const client = new Client({ name: "visibility-test", version: "0.0.0" });
  const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([built.server.connect(serverTransport), client.connect(clientTransport)]);
  cleanups.push(() => {
    try {
      built.scheduler.shutdown();
    } catch {
      /* already closed */
    }
  });
  const call = async (name: string, args: Record<string, unknown>) =>
    (await client.callTool({ name, arguments: args })) as TextResult;
  return { ...built, client, call };
}

const text = (r: TextResult) => r.content.map((c) => c.text).join("\n");
const inSixHours = () => new Date(Date.now() + 6 * 3_600_000).toISOString();

describe("schedule_task with deadline_kind quota_reset", () => {
  it("resolves the deadline from the one configured label and stores kind, label, title, origin", async () => {
    const { dbPath, configPath } = tmp();
    writeFileSync(configPath, "EBB_QUOTA_RESET_CLAUDE=mon 10:00 UTC\nEBB_QUOTA_MARGIN_H_CLAUDE=3\n");
    const { call } = await connect(dbPath, configPath);
    const expected = resolveQuotaDeadline(
      loadQuotaResetConfig({ path: configPath }).claude!,
      new Date(),
    ).deadline.toISOString();
    const result = await call("schedule_task", {
      prompt: "Weekly digest\nof everything",
      deadline_kind: "quota_reset",
      region: "US-CAL-CISO",
    });
    expect(result.isError).toBeFalsy();
    expect(text(result)).toMatch(/deadline_kind: quota reset \(claude\), reset_at .*, margin_h 3/);
    const store = new TaskStore({ dbPath });
    const [row] = store.list();
    expect(row!.deadline).toBe(expected);
    expect(row!.deadlineKind).toBe("quota_reset");
    expect(row!.quotaProvider).toBe("claude");
    expect(row!.title).toBe("Weekly digest");
    expect(row!.originHost).toBe("mcp");
    store.close();
  });

  it("with two labels and no quota_provider returns an error naming both and persists nothing", async () => {
    const { dbPath, configPath } = tmp();
    writeFileSync(
      configPath,
      "EBB_QUOTA_RESET_CLAUDE=mon 10:00 UTC\nEBB_QUOTA_RESET_CODEX=fri 09:00 UTC\n",
    );
    const { call } = await connect(dbPath, configPath);
    const result = await call("schedule_task", { prompt: "p", deadline_kind: "quota_reset" });
    expect(result.isError).toBe(true);
    expect(text(result)).toMatch(/claude, codex/);
    const store = new TaskStore({ dbPath });
    expect(store.list()).toHaveLength(0);
    store.close();
  });

  it("without deadline and without quota_reset fails", async () => {
    const { dbPath, configPath } = tmp();
    const { call } = await connect(dbPath, configPath);
    const result = await call("schedule_task", { prompt: "p" });
    expect(result.isError).toBe(true);
    expect(text(result)).toMatch(/deadline is required/);
  });

  it("update_deadline turns a quota_reset task into an absolute one", async () => {
    const { dbPath, configPath } = tmp();
    writeFileSync(configPath, "EBB_QUOTA_RESET_CLAUDE=mon 10:00 UTC\n");
    const { call } = await connect(dbPath, configPath);
    await call("schedule_task", { prompt: "p", deadline_kind: "quota_reset" });
    const store = new TaskStore({ dbPath });
    const taskId = store.list()[0]!.taskId;
    const result = await call("update_deadline", { task_id: taskId, deadline: inSixHours() });
    expect(result.isError).toBeFalsy();
    expect(store.get(taskId)!.deadlineKind).toBe("absolute");
    expect(store.get(taskId)!.quotaProvider).toBeUndefined();
    store.close();
  });
});

describe("check_queue_status and read state", () => {
  function seedCompleted(dbPath: string): void {
    const store = new TaskStore({ dbPath });
    store.upsert({
      taskId: "done-1",
      status: "completed",
      enqueuedAt: "2026-10-10T00:00:00.000Z",
      completedAt: "2026-10-10T01:00:00.000Z",
      region: "DE",
      title: "Summarize the report",
      originHost: "mcp",
      originCwd: "/work/project",
      bodyJson: JSON.stringify({
        type: "provider_call",
        provider: "anthropic",
        model: "claude-sonnet-4-5",
        prompt: "Summarize the report\nin three bullets",
      }),
      result: { text: "three bullets" },
    });
    store.setMeta("last_tick_at", "2026-10-10T01:00:00.000Z");
    store.close();
  }

  it("single-task mode prints title, origin and prompt, and marks the task read", async () => {
    const { dbPath, configPath } = tmp();
    seedCompleted(dbPath);
    const { call } = await connect(dbPath, configPath);
    const store = new TaskStore({ dbPath });

    const list = await call("check_queue_status", {});
    expect(text(list)).toMatch(/last_tick_at: 2026-10-10T01:00:00.000Z/);
    expect(text(list)).toMatch(/done-1 .*\| Summarize the report/);
    expect(store.get("done-1")!.readAt).toBeUndefined();

    const one = text(await call("check_queue_status", { task_id: "done-1" }));
    expect(one).toMatch(/^title: Summarize the report$/m);
    expect(one).toMatch(/^origin: mcp \(\/work\/project\)$/m);
    expect(one).toMatch(/^deadline_kind: absolute$/m);
    expect(one).toMatch(/^prompt: Summarize the report\nin three bullets$/m);
    expect(one).toMatch(/^read_at: /m);
    expect(store.get("done-1")!.readAt).toBeDefined();
    store.close();
  });

  it("marks read a task this session scheduled and another process completed", async () => {
    const { dbPath, configPath } = tmp();
    const { call } = await connect(dbPath, configPath);
    const scheduled = text(
      await call("schedule_task", {
        prompt: "Nightly digest",
        deadline: inSixHours(),
        region: "US-CAL-CISO",
      }),
    );
    const taskId = /task_id: (\S+)/.exec(scheduled)![1]!;
    // `ebb tick` finishes the row in its own process; this server still
    // holds the scheduled record in memory.
    const other = new TaskStore({ dbPath });
    const row = other.get(taskId)!;
    other.upsert({
      ...row,
      status: "completed",
      completedAt: new Date().toISOString(),
      result: { text: "done" },
    });

    const one = text(await call("check_queue_status", { task_id: taskId }));
    expect(one).toMatch(/^status: completed$/m);
    expect(one).toMatch(/^read_at: /m);
    expect(other.get(taskId)!.readAt).toBeDefined();
    other.close();
  });
});
