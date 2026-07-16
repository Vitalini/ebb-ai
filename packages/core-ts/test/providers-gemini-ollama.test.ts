import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GeminiAdapter, OllamaAdapter } from "../src/index.js";

/** A fetch stub that records the last request and returns a canned response. */
function fetchStub(
  response: { ok?: boolean; status?: number; json?: unknown; text?: string },
  onCall?: (url: string, init: { body: string; headers: Record<string, string> }) => void,
) {
  return async (
    url: string,
    init: { method: string; headers: Record<string, string>; body: string },
  ) => {
    onCall?.(url, init);
    return {
      ok: response.ok ?? true,
      status: response.status ?? 200,
      json: async () => response.json ?? {},
      text: async () => response.text ?? "",
    };
  };
}

describe("GeminiAdapter", () => {
  const saved = { g: process.env.GEMINI_API_KEY, gg: process.env.GOOGLE_API_KEY };
  beforeEach(() => {
    delete process.env.GEMINI_API_KEY;
    delete process.env.GOOGLE_API_KEY;
  });
  afterEach(() => {
    if (saved.g !== undefined) process.env.GEMINI_API_KEY = saved.g;
    else delete process.env.GEMINI_API_KEY;
    if (saved.gg !== undefined) process.env.GOOGLE_API_KEY = saved.gg;
    else delete process.env.GOOGLE_API_KEY;
  });

  it("is not ready without a key and ready with one", () => {
    expect(new GeminiAdapter().ready).toBe(false);
    expect(new GeminiAdapter({ apiKey: "k" }).ready).toBe(true);
  });

  it("reads GEMINI_API_KEY, then falls back to GOOGLE_API_KEY", () => {
    process.env.GOOGLE_API_KEY = "goog";
    expect(new GeminiAdapter().ready).toBe(true);
    process.env.GEMINI_API_KEY = "gem";
    expect(new GeminiAdapter().ready).toBe(true);
  });

  it("has no batch surface (sync-only adapter)", () => {
    const a = new GeminiAdapter({ apiKey: "k" });
    expect(
      (a as unknown as { dispatchBatch?: unknown }).dispatchBatch,
    ).toBeUndefined();
    expect(
      (a as unknown as { retrieveBatch?: unknown }).retrieveBatch,
    ).toBeUndefined();
  });

  it("dispatches generateContent and shapes text + usage from usageMetadata", async () => {
    let capturedUrl = "";
    let capturedHeaders: Record<string, string> = {};
    let capturedBody: unknown;
    const adapter = new GeminiAdapter({
      apiKey: "secret-key",
      fetchImpl: fetchStub(
        {
          json: {
            candidates: [
              { content: { parts: [{ text: "hello " }, { text: "world" }] } },
            ],
            usageMetadata: {
              promptTokenCount: 12,
              candidatesTokenCount: 5,
              totalTokenCount: 17,
            },
            modelVersion: "gemini-2.0-flash-001",
          },
        },
        (url, init) => {
          capturedUrl = url;
          capturedHeaders = init.headers;
          capturedBody = JSON.parse(init.body);
        },
      ),
    });
    const r = await adapter.dispatch("gemini-2.0-flash", "hi", {
      maxTokens: 128,
      temperature: 0.4,
      system: "be brief",
    });
    expect(r.text).toBe("hello world");
    expect(r.provider).toBe("gemini");
    expect(r.model).toBe("gemini-2.0-flash-001");
    expect(r.usage?.inputTokens).toBe(12);
    expect(r.usage?.outputTokens).toBe(5);
    expect(r.usage?.totalTokens).toBe(17);
    // URL targets generateContent for the requested model; key rides a header.
    expect(capturedUrl).toContain("/models/gemini-2.0-flash:generateContent");
    expect(capturedHeaders["x-goog-api-key"]).toBe("secret-key");
    const body = capturedBody as {
      systemInstruction?: { parts: { text: string }[] };
      generationConfig?: { maxOutputTokens?: number; temperature?: number };
    };
    expect(body.systemInstruction?.parts[0]?.text).toBe("be brief");
    expect(body.generationConfig?.maxOutputTokens).toBe(128);
    expect(body.generationConfig?.temperature).toBe(0.4);
  });

  it("throws a clear error when no key is set (missing-key path)", async () => {
    const adapter = new GeminiAdapter({ fetchImpl: fetchStub({}) });
    await expect(adapter.dispatch("gemini-2.0-flash", "hi")).rejects.toThrow(
      /no API key.*GEMINI_API_KEY.*GOOGLE_API_KEY/i,
    );
  });

  it("surfaces a non-2xx API error", async () => {
    const adapter = new GeminiAdapter({
      apiKey: "k",
      fetchImpl: fetchStub({ ok: false, status: 429, text: "rate limited" }),
    });
    await expect(adapter.dispatch("gemini-2.0-flash", "hi")).rejects.toThrow(
      /Gemini API 429: rate limited/,
    );
  });
});

describe("OllamaAdapter", () => {
  const saved = { h: process.env.OLLAMA_HOST };
  beforeEach(() => {
    delete process.env.OLLAMA_HOST;
  });
  afterEach(() => {
    if (saved.h !== undefined) process.env.OLLAMA_HOST = saved.h;
    else delete process.env.OLLAMA_HOST;
  });

  it("is always ready (local, keyless)", () => {
    expect(new OllamaAdapter().ready).toBe(true);
  });

  it("has no batch surface (sync-only adapter)", () => {
    const a = new OllamaAdapter();
    expect(
      (a as unknown as { dispatchBatch?: unknown }).dispatchBatch,
    ).toBeUndefined();
  });

  it("defaults to localhost and prefixes a bare host with http://", async () => {
    let url = "";
    const a = new OllamaAdapter({
      host: "myhost:11434",
      fetchImpl: fetchStub({ json: { message: { content: "x" } } }, (u) => {
        url = u;
      }),
    });
    await a.dispatch("llama3.1", "hi");
    expect(url).toBe("http://myhost:11434/api/chat");
  });

  it("dispatches /api/chat and shapes text + prompt_eval_count / eval_count", async () => {
    let capturedBody: unknown;
    const adapter = new OllamaAdapter({
      host: "http://localhost:11434",
      fetchImpl: fetchStub(
        {
          json: {
            message: { content: "local answer" },
            prompt_eval_count: 9,
            eval_count: 4,
            model: "llama3.1",
          },
        },
        (_u, init) => {
          capturedBody = JSON.parse(init.body);
        },
      ),
    });
    const r = await adapter.dispatch("llama3.1", "hi", {
      temperature: 0.3,
      maxTokens: 64,
      system: "be brief",
    });
    expect(r.text).toBe("local answer");
    expect(r.provider).toBe("ollama");
    expect(r.model).toBe("llama3.1");
    expect(r.usage?.inputTokens).toBe(9);
    expect(r.usage?.outputTokens).toBe(4);
    expect(r.usage?.totalTokens).toBe(13);
    const body = capturedBody as {
      stream: boolean;
      messages: { role: string; content: string }[];
      options?: { temperature?: number; num_predict?: number };
    };
    expect(body.stream).toBe(false);
    expect(body.messages[0]?.role).toBe("system");
    expect(body.options?.temperature).toBe(0.3);
    expect(body.options?.num_predict).toBe(64);
  });

  it("wraps a connection-refused into an actionable error (connection-refused path)", async () => {
    const adapter = new OllamaAdapter({
      host: "http://localhost:11434",
      fetchImpl: async () => {
        throw new Error("fetch failed: ECONNREFUSED 127.0.0.1:11434");
      },
    });
    await expect(adapter.dispatch("llama3.1", "hi")).rejects.toThrow(
      /could not reach Ollama at http:\/\/localhost:11434.*ECONNREFUSED/i,
    );
  });
});
