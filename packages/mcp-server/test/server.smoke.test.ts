import { describe, expect, it } from "vitest";

/**
 * Smoke test: import the compiled server module to make sure it parses
 * cleanly and registers without throwing. We don't actually run the
 * stdio transport here — that needs an MCP client on the other end.
 *
 * Detailed protocol tests will land in v0.2 once we wire an in-process
 * MCP client for integration testing.
 */
describe("ebb-mcp server smoke", () => {
  it("imports without throwing", async () => {
    // Importing has side effects (it calls main()); the side effects
    // include opening stdio, which we don't want in tests. So we
    // instead import the building blocks and verify wiring would work.
    const core = await import("@ebb-ai/core");
    expect(typeof core.Scheduler).toBe("function");
    expect(typeof core.electricityMapsFeed).toBe("function");
    expect(typeof core.mockGridFeed).toBe("function");
  });

  it("can instantiate a scheduler with a mock feed", async () => {
    const { Scheduler, mockGridFeed } = await import("@ebb-ai/core");
    const s = new Scheduler({ feed: mockGridFeed() });
    const record = s.enqueue(async () => "ok", {
      deadline: new Date(Date.now() + 60 * 60 * 1000),
    });
    expect(record.status).toBe("queued");
    s.shutdown();
  });
});
