import { describe, expect, it } from "vitest";
import type { TaskRecord } from "@ebb-ai/core";
import { renderQueue } from "../src/commands/queue.js";

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
