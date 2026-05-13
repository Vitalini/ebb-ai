import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runTickOnce } from "../src/commands/tick.js";

describe("ebb tick", () => {
  const saved = { a: process.env.ANTHROPIC_API_KEY, o: process.env.OPENAI_API_KEY };

  beforeEach(() => {
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.OPENAI_API_KEY;
  });

  afterEach(() => {
    if (saved.a !== undefined) process.env.ANTHROPIC_API_KEY = saved.a;
    else delete process.env.ANTHROPIC_API_KEY;
    if (saved.o !== undefined) process.env.OPENAI_API_KEY = saved.o;
    else delete process.env.OPENAI_API_KEY;
  });

  it("exits 0 with a clear message when no provider keys are set", async () => {
    const r = await runTickOnce({ db: ":memory:" });
    expect(r.exitCode).toBe(0);
    expect(r.message).toMatch(/no provider keys/i);
  });
});
