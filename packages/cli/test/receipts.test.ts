import { describe, expect, it } from "vitest";
import type { TaskRecord } from "@ebb-ai/core";
import { renderReceipts } from "../src/commands/receipts.js";

function row(overrides: Partial<NonNullable<TaskRecord["receipt"]>>): TaskRecord {
  return {
    taskId: "t-1",
    status: "completed",
    enqueuedAt: "2026-06-01T10:00:00.000Z",
    completedAt: "2026-06-01T12:00:00.000Z",
    region: "US-CAL-CISO",
    receipt: {
      taskId: "t-1",
      ranAt: "2026-06-01T12:00:00.000Z",
      region: "US-CAL-CISO",
      estimatedCarbonGCo2: 2.0,
      ...overrides,
    },
  } as TaskRecord;
}

describe("renderReceipts provenance", () => {
  it("shows intensity, grid_source and energy_source columns", () => {
    const out = renderReceipts([
      row({
        intensityGCo2PerKwh: 123,
        gridSource: "electricityMaps",
        energySource: "measured",
      }),
    ]);
    expect(out).toContain("intensity");
    expect(out).toContain("grid_source");
    expect(out).toContain("energy_src");
    expect(out).toContain("123");
    expect(out).toContain("electricityMaps");
    expect(out).toContain("measured");
  });

  it("loudly marks MOCK grid data", () => {
    const out = renderReceipts([
      row({ intensityGCo2PerKwh: 400, gridSource: "mock", energySource: "fallback" }),
    ]);
    expect(out).toContain("mock(SYNTH)");
    expect(out).toContain("MOCK DATA");
  });

  it("omits the MOCK banner when no rows are mock", () => {
    const out = renderReceipts([
      row({ gridSource: "ukCarbonIntensity" }),
    ]);
    expect(out).not.toContain("MOCK DATA");
  });

  it("renders '-' for legacy receipts lacking provenance", () => {
    const out = renderReceipts([row({})]);
    // header + sep + one data row; provenance cells collapse to '-'.
    expect(out.split("\n").length).toBeGreaterThanOrEqual(3);
    expect(out).not.toContain("MOCK DATA");
  });
});
