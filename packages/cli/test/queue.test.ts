import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { TaskStore } from "@ebb-ai/core";
import type { TaskRecord } from "@ebb-ai/core";
import {
  renderQueue,
  runQueueList,
  runQueueShow,
  runQueueUnread,
} from "../src/commands/queue.js";

function rec(status: string): TaskRecord {
  return {
    taskId: `t-${status}`,
    status: status as TaskRecord["status"],
    enqueuedAt: "2026-06-01T10:00:00.000Z",
    region: "US-CAL-CISO",
  } as TaskRecord;
}

describe("renderQueue status pass-through", () => {
  it("renders the new 'submitted' status without crashing", () => {
    const out = renderQueue([rec("submitted")]);
    expect(out).toContain("submitted");
  });

  it("renders an unknown/future status gracefully", () => {
    // A concurrent agent may introduce statuses this CLI doesn't know.
    const out = renderQueue([rec("some-future-status")]);
    expect(out).toContain("some-future-statu"); // truncated to column width
  });
});

describe("queue list / show / unread (task visibility)", () => {
  let dir: string;
  let db: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "ebb-cli-queue-"));
    db = join(dir, "queue.db");
    const store = new TaskStore({ dbPath: db });
    store.upsert({
      taskId: "t-quota",
      status: "scheduled",
      enqueuedAt: "2026-10-15T10:00:00.000Z",
      scheduledFor: "2026-10-18T03:00:00.000Z",
      deadline: "2026-10-19T08:00:00.000Z",
      region: "DE",
      title: "Weekly digest",
      deadlineKind: "quota_reset",
      quotaProvider: "claude",
      bodyJson: JSON.stringify({ type: "provider_call", provider: "anthropic", model: "m", prompt: "digest" }),
    });
    store.upsert({
      taskId: "t-done",
      status: "completed",
      enqueuedAt: "2026-10-15T11:00:00.000Z",
      completedAt: "2026-10-15T12:00:00.000Z",
      deadline: "2026-10-16T00:00:00.000Z",
      region: "DE",
      title: "Summarize \u001b[31mreport",
      originHost: "mcp",
      originCwd: "/work",
      bodyJson: JSON.stringify({
        type: "provider_call",
        provider: "anthropic",
        model: "m",
        prompt: "Summarize the report\nin bullets",
        messages: [{ role: "user", content: "earlier question" }, { role: "assistant", content: "earlier answer" }],
      }),
      result: { text: "three bullets\u001b]0;pwned\u0007", raw: { vendor: "payload-xyz" } },
      receipt: {
        taskId: "t-done",
        ranAt: "2026-10-15T12:00:00.000Z",
        region: "DE",
        estimatedCarbonGCo2: 0.42,
      },
    });
    store.setMeta("last_tick_at", "2026-10-15T12:05:00.000Z");
    store.close();
  });

  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  const readAt = (id: string) => {
    const store = new TaskStore({ dbPath: db });
    try {
      return store.get(id)?.readAt;
    } finally {
      store.close();
    }
  };

  it("lists title, deadline and kind cells, and the last tick", async () => {
    const { rendered } = await runQueueList({ db });
    expect(rendered).toMatch(/t-quota .*Weekly digest .*2026-10-19T08:00:00.000Z .*quota:claude/);
    expect(rendered).toMatch(/t-done .*abs /);
    expect(rendered).toContain("last tick: 2026-10-15T12:05:00.000Z");
    expect(rendered).not.toContain("\u001b");
  });

  it("--kind quota_reset and --unread filter", async () => {
    expect((await runQueueList({ db, kind: "quota_reset" })).rows.map((r) => r.taskId)).toEqual([
      "t-quota",
    ]);
    expect((await runQueueList({ db, unread: true })).rows.map((r) => r.taskId)).toEqual([
      "t-done",
    ]);
    await expect(runQueueList({ db, kind: "weekly" })).rejects.toThrow(/unknown kind/);
  });

  it("show prints title, prompt, history, result and receipt, hides the raw payload, and marks read", async () => {
    const { rendered } = await runQueueShow("t-done", { db, config: join(dir, "none") });
    expect(rendered).toMatch(/^title: Summarize \[31mreport$/m);
    expect(rendered).toMatch(/^origin: mcp \(\/work\)$/m);
    expect(rendered).toContain("Prompt:\nSummarize the report\nin bullets");
    expect(rendered).toContain("History:\n[user] earlier question\n[assistant] earlier answer");
    expect(rendered).toContain("Result:\nthree bullets]0;pwned");
    expect(rendered).toContain("estimated_carbon_g: 0.42");
    expect(rendered).not.toContain("payload-xyz");
    expect(rendered).not.toMatch(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/);
    expect(readAt("t-done")).toBeDefined();
  });

  it("show --raw includes the raw payload; --no-mark-read leaves read_at null", async () => {
    const { rendered } = await runQueueShow("t-done", { db, raw: true, markRead: false });
    expect(rendered).toContain("payload-xyz");
    expect(readAt("t-done")).toBeUndefined();
  });

  it("show labels a quota deadline and does not mark an unfinished task read", async () => {
    const config = join(dir, "config");
    writeFileSync(config, "EBB_QUOTA_RESET_CLAUDE=mon 10:00 UTC\nEBB_QUOTA_MARGIN_H_CLAUDE=2\n");
    const { rendered } = await runQueueShow("t-quota", { db, config });
    expect(rendered).toContain(
      "deadline: 2026-10-19T08:00:00.000Z (quota reset (claude), reset_at 2026-10-19T10:00:00.000Z, margin_h 2)",
    );
    expect(readAt("t-quota")).toBeUndefined();
  });

  it("show --json carries the history", async () => {
    const { rendered } = await runQueueShow("t-done", { db, json: true, markRead: false });
    const parsed = JSON.parse(rendered) as { history: unknown[]; result: Record<string, unknown> };
    expect(parsed.history).toHaveLength(4);
    expect(parsed.result).not.toHaveProperty("raw");
  });

  it("show on an unknown id throws", async () => {
    await expect(runQueueShow("missing-id", { db })).rejects.toThrow(/no task/);
  });

  it("unread reverses a mark-read", async () => {
    await runQueueShow("t-done", { db });
    expect(readAt("t-done")).toBeDefined();
    expect(await runQueueUnread("t-done", { db })).toContain("marked unread");
    expect(readAt("t-done")).toBeUndefined();
    await expect(runQueueUnread("missing-id", { db })).rejects.toThrow(/no task/);
  });
});

describe("ebb queue list --hook (Claude Code SessionStart)", () => {
  let dir: string;
  let db: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "ebb-hook-"));
    db = join(dir, "queue.db");
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  function seedDone(n: number): void {
    const store = new TaskStore({ dbPath: db });
    for (let i = 0; i < n; i++) {
      store.upsert({
        taskId: `done-${i}`,
        status: "completed",
        enqueuedAt: "2026-06-01T10:00:00.000Z",
        completedAt: `2026-06-01T11:0${i}:00.000Z`,
        region: "FR",
        title: `title\u001b[2J ${i}`,
      });
    }
    store.close();
  }

  it("names the unread count and drops it after a mark read (AE1)", async () => {
    seedDone(2);
    expect((await runQueueList({ db, unread: true, hook: true })).rendered).toBe(
      "2 unread ebb tasks, run `ebb ui` to read them.",
    );
    const store = new TaskStore({ dbPath: db });
    store.markRead("done-0");
    store.close();
    expect((await runQueueList({ db, unread: true, hook: true })).rendered).toBe(
      "1 unread ebb task, run `ebb ui` to read them.",
    );
  });

  it("prints nothing when nothing is unread", async () => {
    seedDone(0);
    expect((await runQueueList({ db, hook: true })).rendered).toBe("");
  });

  it("prints nothing for a missing ledger and does not create one", async () => {
    const missing = join(dir, "nope", "queue.db");
    expect((await runQueueList({ db: missing, hook: true })).rendered).toBe("");
    expect(existsSync(missing)).toBe(false);
  });

  describe("hooks.json command", () => {
    const hooksFile = join(__dirname, "..", "..", "claude-code-plugin", "hooks", "hooks.json");
    const command = (
      JSON.parse(readFileSync(hooksFile, "utf8")) as {
        hooks: { SessionStart: Array<{ hooks: Array<{ type: string; command: string }> }> };
      }
    ).hooks.SessionStart[0]!.hooks[0]!;

    function runHook(stub: string | null): { status: number | null; stdout: string } {
      const bin = join(dir, "bin");
      mkdirSync(bin, { recursive: true });
      if (stub !== null) {
        writeFileSync(join(bin, "ebb"), `#!/bin/sh\n${stub}\n`);
        chmodSync(join(bin, "ebb"), 0o755);
      }
      const r = spawnSync("/bin/sh", ["-c", command.command], {
        env: { PATH: `${bin}:/usr/bin:/bin` },
        encoding: "utf8",
      });
      return { status: r.status, stdout: r.stdout };
    }

    it("is a command hook", () => {
      expect(command.type).toBe("command");
    });

    it("stays silent with exit 0 when ebb is not installed", () => {
      expect(runHook(null)).toEqual({ status: 0, stdout: "" });
    });

    it("stays silent with exit 0 when an older ebb rejects --hook", () => {
      expect(runHook(`echo "error: unknown option '--hook'" >&2; exit 1`)).toEqual({ status: 0, stdout: "" });
    });

    it("passes the CLI line through", () => {
      expect(runHook(`echo "2 unread ebb tasks, run \\\`ebb ui\\\` to read them."`).stdout).toBe(
        "2 unread ebb tasks, run `ebb ui` to read them.\n",
      );
    });
  });
});
