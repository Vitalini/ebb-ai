/**
 * Cross-provider routing (ROADMAP item 1) — unit + integration tests.
 *
 * The scoring-vector cases are loaded from the SHARED fixture
 * `test/fixtures/routing-scoring-vectors.json`, which the Python suite
 * (`tests/test_routing.py`) reads byte-for-byte too — a drift in either
 * port's scoring math / price table / energy coefficients reddens both.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { mockGridFeed, Scheduler } from "../src/index.js";
import type { ProviderAdapter } from "../src/providers/base.js";
import {
  DEFAULT_ROUTE_WEIGHTS,
  InvalidCandidateError,
  InvalidRouteWeightsError,
  MissingPriceError,
  normalizeRouteWeights,
  parseCandidate,
  parseCandidates,
  scoreCandidates,
} from "../src/routing.js";
import { verifyReceipt } from "../src/sign.js";

interface VectorCase {
  name: string;
  candidates: string[];
  intensityGCo2PerKwh: number;
  routeWeights?: { carbon: number; cost: number; latency: number };
  batchEligible: boolean;
  expectedWeights: { carbon: number; cost: number; latency: number };
  expectedChosen: string;
  expectedConsidered: Array<Record<string, unknown>>;
  expectedReasoning: string;
}

const vectors = JSON.parse(
  readFileSync(
    new URL("./fixtures/routing-scoring-vectors.json", import.meta.url),
    "utf8",
  ),
) as { cases: VectorCase[] };

describe("routing — shared scoring vectors", () => {
  for (const c of vectors.cases) {
    it(`${c.name}: reproduces the pinned scored list + pick`, () => {
      const decision = scoreCandidates({
        candidates: parseCandidates(c.candidates),
        intensityGCo2PerKwh: c.intensityGCo2PerKwh,
        weights: c.routeWeights,
        batchEligible: c.batchEligible,
        rng: () => 0,
      });
      expect(decision.weights).toEqual(c.expectedWeights);
      expect(decision.chosen).toBe(c.expectedChosen);
      expect(decision.considered).toEqual(c.expectedConsidered);
      expect(decision.reasoning).toBe(c.expectedReasoning);
    });
  }
});

describe("routing — parse candidates", () => {
  it("parses provider:model", () => {
    expect(parseCandidate("anthropic:claude-opus-4")).toEqual({
      provider: "anthropic",
      model: "claude-opus-4",
    });
  });
  it("rejects an unknown provider", () => {
    expect(() => parseCandidate("acme:foo")).toThrow(InvalidCandidateError);
  });
  it("rejects a malformed spec", () => {
    expect(() => parseCandidate("no-colon")).toThrow(InvalidCandidateError);
    expect(() => parseCandidate(":model")).toThrow(InvalidCandidateError);
    expect(() => parseCandidate("anthropic:")).toThrow(InvalidCandidateError);
  });
});

describe("routing — weight normalization", () => {
  it("defaults when absent", () => {
    expect(normalizeRouteWeights()).toEqual(DEFAULT_ROUTE_WEIGHTS);
  });
  it("normalizes to sum 1", () => {
    expect(normalizeRouteWeights({ carbon: 2, cost: 1, latency: 1 })).toEqual({
      carbon: 0.5,
      cost: 0.25,
      latency: 0.25,
    });
  });
  it("treats a missing key as 0", () => {
    expect(normalizeRouteWeights({ carbon: 1 })).toEqual({
      carbon: 1,
      cost: 0,
      latency: 0,
    });
  });
  it("rejects a negative weight", () => {
    expect(() => normalizeRouteWeights({ carbon: -1, cost: 1, latency: 0 })).toThrow(
      InvalidRouteWeightsError,
    );
  });
  it("rejects an all-zero vector", () => {
    expect(() => normalizeRouteWeights({ carbon: 0, cost: 0, latency: 0 })).toThrow(
      InvalidRouteWeightsError,
    );
  });
});

describe("routing — loud reject on a missing price", () => {
  it("throws MissingPriceError listing every missing candidate id", () => {
    let err: unknown;
    try {
      scoreCandidates({
        candidates: parseCandidates([
          "anthropic:claude-opus-4",
          "openai:not-a-real-model",
          "gemini:also-not-real",
        ]),
        intensityGCo2PerKwh: 400,
      });
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(MissingPriceError);
    const missing = (err as MissingPriceError).missing;
    expect(missing).toContain("openai:not-a-real-model");
    expect(missing).toContain("gemini:also-not-real");
    expect(missing).not.toContain("anthropic:claude-opus-4");
  });
});

describe("routing — deterministic seeded tie-break", () => {
  // Two hosted models with identical price and (cost-only weights) identical
  // scores → the tie is broken by the injected rng, reproducibly.
  const tied = parseCandidates(["gemini:gemini-1-5-pro", "gemini:gemini-2-0-pro"]);
  const opts = {
    candidates: tied,
    intensityGCo2PerKwh: 400,
    weights: { carbon: 0, cost: 1, latency: 0 },
  };
  it("rng→first picks candidate[0]; rng→last picks candidate[1]", () => {
    const a = scoreCandidates({ ...opts, rng: () => 0 });
    const b = scoreCandidates({ ...opts, rng: () => 0.999 });
    // Both scores are equal (0), so the pick is entirely rng-determined.
    expect(a.considered.every((c) => c.score === a.considered[0]!.score)).toBe(true);
    expect(a.chosen).toBe("gemini:gemini-1-5-pro");
    expect(b.chosen).toBe("gemini:gemini-2-0-pro");
  });
});

describe("routing — batch discount lowers cost", () => {
  it("halves the priced cost when batch-eligible + batch-capable", () => {
    const specs = parseCandidates(["anthropic:claude-sonnet-4"]);
    const sync = scoreCandidates({
      candidates: specs,
      intensityGCo2PerKwh: 300,
      batchEligible: false,
    });
    const batch = scoreCandidates({
      candidates: specs,
      intensityGCo2PerKwh: 300,
      batchEligible: true,
    });
    expect(batch.considered[0]!.estCostUsd).toBeCloseTo(
      sync.considered[0]!.estCostUsd / 2,
      9,
    );
    // A single candidate keeps the batch latency tier (1) vs sync (0.5).
    expect(sync.considered[0]!.latencyClass).toBe(0.5);
    expect(batch.considered[0]!.latencyClass).toBe(1);
  });
});

// ── Integration through the real Scheduler ──────────────────────────────────

interface RecordingAdapter extends ProviderAdapter {
  dispatchCalls: Array<{ model: string; prompt: string }>;
}

function makeSyncAdapter(
  provider: "anthropic" | "openai" | "gemini" | "ollama",
  ready = true,
): RecordingAdapter {
  const calls: Array<{ model: string; prompt: string }> = [];
  return {
    provider,
    ready,
    dispatchCalls: calls,
    async dispatch(model, prompt) {
      calls.push({ model, prompt });
      return {
        text: `sync:${prompt}`,
        model,
        provider,
        raw: null,
        usage: { inputTokens: 4, outputTokens: 2, totalTokens: 6 },
      };
    },
  };
}

function makeFailingBatchAdapter(
  provider: "anthropic" | "openai",
): RecordingAdapter & { dispatchBatchCalls: number } {
  const base = makeSyncAdapter(provider) as RecordingAdapter & {
    dispatchBatchCalls: number;
    dispatchBatch: ProviderAdapter["dispatchBatch"];
    retrieveBatch: ProviderAdapter["retrieveBatch"];
  };
  base.dispatchBatchCalls = 0;
  base.dispatchBatch = async () => {
    base.dispatchBatchCalls += 1;
    throw new Error("simulated batch submit failure");
  };
  base.retrieveBatch = async () => ({ status: "completed", results: [] });
  return base;
}

function deadline(hours: number): Date {
  return new Date(Date.now() + hours * 60 * 60 * 1000);
}

describe("routing — Scheduler integration", () => {
  it("records a signed routing block on the receipt that verifies", async () => {
    const s = new Scheduler({ feed: mockGridFeed() });
    const rec = await s.enqueueProviderCall(
      {
        type: "provider_call",
        provider: "anthropic",
        model: "claude-opus-4",
        prompt: "hello",
        candidates: ["anthropic:claude-opus-4", "ollama:llama-3-1-8b"],
        routeWeights: { carbon: 1, cost: 0, latency: 0 },
      },
      { deadline: deadline(3), region: "US-CAL-CISO", taskId: "rt-1" },
    );
    const scheduled = s.getTask(rec.taskId);
    expect(scheduled?.routingDecision).toBeDefined();
    expect(scheduled?.routingDecision?.considered).toHaveLength(2);
    // Force the window to now and dispatch.
    if (scheduled) scheduled.scheduledFor = new Date(Date.now() - 1000).toISOString();
    await s.tick({ anthropic: makeSyncAdapter("anthropic"), ollama: makeSyncAdapter("ollama") });
    const done = s.getTask(rec.taskId);
    expect(done?.status).toBe("completed");
    const routing = done?.receipt?.routing;
    expect(routing).toBeDefined();
    expect(routing?.considered).toHaveLength(2);
    expect(["anthropic:claude-opus-4", "ollama:llama-3-1-8b"]).toContain(routing?.chosen);
    // The signed receipt attests the routing block.
    expect(verifyReceipt(done!.receipt as unknown as Record<string, unknown>).outcome).toBe("valid");
    s.shutdown();
  });

  it("falls back to the next-best candidate when the chosen adapter is unavailable", async () => {
    const s = new Scheduler({ feed: mockGridFeed() });
    // carbon=1 makes gemini (lower energy) win, but no gemini adapter is
    // supplied → dispatch falls back to the ready anthropic adapter.
    const rec = await s.enqueueProviderCall(
      {
        type: "provider_call",
        provider: "gemini",
        model: "gemini-2-0-flash",
        prompt: "hi",
        candidates: ["anthropic:claude-opus-4", "gemini:gemini-2-0-flash"],
        routeWeights: { carbon: 1, cost: 0, latency: 0 },
      },
      { deadline: deadline(3), region: "US-CAL-CISO", taskId: "rt-fallback" },
    );
    const scheduled = s.getTask(rec.taskId);
    expect(scheduled?.routingDecision?.chosen).toBe("gemini:gemini-2-0-flash");
    if (scheduled) scheduled.scheduledFor = new Date(Date.now() - 1000).toISOString();
    const anthropic = makeSyncAdapter("anthropic");
    await s.tick({ anthropic }); // gemini adapter absent
    const done = s.getTask(rec.taskId);
    expect(done?.status).toBe("completed");
    expect(anthropic.dispatchCalls).toHaveLength(1);
    expect(done?.receipt?.routing?.fallbackFrom).toBe("gemini:gemini-2-0-flash");
    expect(done?.receipt?.routing?.chosen).toBe("anthropic:claude-opus-4");
    expect(done?.receipt?.provider).toBe("anthropic");
    s.shutdown();
  });

  it("fails honestly when no candidate has a ready adapter", async () => {
    const s = new Scheduler({ feed: mockGridFeed() });
    const rec = await s.enqueueProviderCall(
      {
        type: "provider_call",
        provider: "anthropic",
        model: "claude-opus-4",
        prompt: "hi",
        candidates: ["anthropic:claude-opus-4", "gemini:gemini-2-0-flash"],
      },
      { deadline: deadline(3), region: "US-CAL-CISO", taskId: "rt-none" },
    );
    const scheduled = s.getTask(rec.taskId);
    if (scheduled) scheduled.scheduledFor = new Date(Date.now() - 1000).toISOString();
    // Only an ollama adapter (not among the candidates) is configured.
    await s.tick({ ollama: makeSyncAdapter("ollama") });
    const done = s.getTask(rec.taskId);
    expect(done?.status).toBe("failed");
    expect(done?.error).toContain("no configured/ready adapter for any routing candidate");
    s.shutdown();
  });

  it("batch submit failure falls back to the routed candidate's own sync path", async () => {
    const s = new Scheduler({ feed: mockGridFeed() });
    // cost=1 + batch-eligible → openai (cheaper batch) wins; its batch submit
    // throws, so dispatch falls back to openai's OWN sync path.
    const rec = await s.enqueueProviderCall(
      {
        type: "provider_call",
        provider: "openai",
        model: "gpt-4o",
        prompt: "batch-me",
        candidates: ["anthropic:claude-sonnet-4", "openai:gpt-4o"],
        routeWeights: { carbon: 0, cost: 1, latency: 0 },
      },
      { deadline: deadline(60), region: "US-CAL-CISO", taskId: "rt-batchfail" },
    );
    expect(s.getTask(rec.taskId)?.routingDecision?.chosen).toBe("openai:gpt-4o");
    const openai = makeFailingBatchAdapter("openai");
    const anthropic = makeFailingBatchAdapter("anthropic");
    const result = await s.tick({ openai, anthropic });
    expect(openai.dispatchBatchCalls).toBe(1); // batch was attempted
    expect(openai.dispatchCalls).toHaveLength(1); // then sync fell back
    const done = s.getTask(rec.taskId);
    expect(done?.status).toBe("completed");
    expect(done?.batchId).toBeUndefined(); // receipt records the actual (sync) path
    expect(done?.receipt?.routing?.chosen).toBe("openai:gpt-4o");
    expect(result.dispatched).toBeGreaterThanOrEqual(1);
    s.shutdown();
  });
});
