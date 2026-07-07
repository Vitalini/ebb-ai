import { describe, expect, it } from "vitest";
import { AnthropicAdapter, OpenAIAdapter } from "../src/index.js";

describe("AnthropicAdapter", () => {
  it("reports not-ready when no key and no client", () => {
    const a = new AnthropicAdapter({ apiKey: undefined });
    delete process.env.ANTHROPIC_API_KEY;
    expect(new AnthropicAdapter().ready).toBe(false);
  });

  it("dispatches via an injected client and shapes the result", async () => {
    let captured: unknown;
    const fakeClient = {
      messages: {
        create: async (req: unknown) => {
          captured = req;
          return {
            content: [
              { type: "text", text: "hello" },
              { type: "text", text: " world" },
            ],
            usage: { input_tokens: 7, output_tokens: 3 },
            model: "claude-sonnet-4-5",
          };
        },
        batches: {
          create: async () => ({ id: "batch_x" }),
        },
      },
    };
    const adapter = new AnthropicAdapter({ apiKey: "test", client: fakeClient });
    const r = await adapter.dispatch("claude-sonnet-4-5", "say hi", {
      maxTokens: 100,
      system: "be brief",
    });
    expect(r.text).toBe("hello world");
    expect(r.usage?.totalTokens).toBe(10);
    expect(r.provider).toBe("anthropic");
    expect((captured as { system: string }).system).toBe("be brief");
  });

  it("submits a batch and returns the handle", async () => {
    const adapter = new AnthropicAdapter({
      apiKey: "test",
      client: {
        messages: {
          create: async () => ({}),
          batches: {
            create: async (req: unknown) => {
              expect(
                (req as { requests: unknown[] }).requests.length,
              ).toBe(3);
              return { id: "msgbatch_01" };
            },
          },
        },
      },
    });
    const handle = await adapter.dispatchBatch(
      "claude-sonnet-4-5",
      ["a", "b", "c"],
    );
    expect(handle.batchId).toBe("msgbatch_01");
    expect(handle.size).toBe(3);
    expect(handle.provider).toBe("anthropic");
  });

  it("rejects empty batch", async () => {
    const adapter = new AnthropicAdapter({ apiKey: "test", client: {} });
    await expect(adapter.dispatchBatch("claude-sonnet-4-5", [])).rejects.toThrow(
      /at least one entry/i,
    );
  });
});

describe("OpenAIAdapter", () => {
  it("dispatches via an injected client and shapes the result", async () => {
    const fakeClient = {
      chat: {
        completions: {
          create: async (req: unknown) => {
            expect(
              ((req as { messages: { role: string }[] }).messages[0]?.role),
            ).toBe("system");
            return {
              choices: [{ message: { content: "answer" } }],
              usage: { prompt_tokens: 5, completion_tokens: 2, total_tokens: 7 },
              model: "gpt-4.1-mini",
            };
          },
        },
      },
      files: { create: async () => ({ id: "f" }) },
      batches: { create: async () => ({ id: "b" }) },
    };
    const adapter = new OpenAIAdapter({ apiKey: "test", client: fakeClient });
    const r = await adapter.dispatch("gpt-4.1-mini", "hi", { system: "be brief" });
    expect(r.text).toBe("answer");
    expect(r.usage?.totalTokens).toBe(7);
    expect(r.provider).toBe("openai");
  });

  it("sends max_completion_tokens and omits temperature for o-series models", async () => {
    let captured: Record<string, unknown> | undefined;
    const adapter = new OpenAIAdapter({
      apiKey: "test",
      client: {
        chat: {
          completions: {
            create: async (req: unknown) => {
              captured = req as Record<string, unknown>;
              return { choices: [{ message: { content: "x" } }] };
            },
          },
        },
        files: { create: async () => ({ id: "f" }) },
        batches: { create: async () => ({ id: "b" }) },
      },
    });
    await adapter.dispatch("o3-mini", "hi", { maxTokens: 100, temperature: 0.5 });
    expect(captured?.max_completion_tokens).toBe(100);
    expect("max_tokens" in captured!).toBe(false);
    // o-series rejects temperature entirely — the key must not be sent.
    expect("temperature" in captured!).toBe(false);
  });

  it("sends max_completion_tokens but keeps temperature for gpt-5-family models", async () => {
    let captured: Record<string, unknown> | undefined;
    const adapter = new OpenAIAdapter({
      apiKey: "test",
      client: {
        chat: {
          completions: {
            create: async (req: unknown) => {
              captured = req as Record<string, unknown>;
              return { choices: [{ message: { content: "x" } }] };
            },
          },
        },
        files: { create: async () => ({ id: "f" }) },
        batches: { create: async () => ({ id: "b" }) },
      },
    });
    await adapter.dispatch("gpt-5-mini", "hi", { maxTokens: 64, temperature: 0.7 });
    expect(captured?.max_completion_tokens).toBe(64);
    expect("max_tokens" in captured!).toBe(false);
    expect(captured?.temperature).toBe(0.7);
  });

  it("keeps classic max_tokens + temperature for other models", async () => {
    let captured: Record<string, unknown> | undefined;
    const adapter = new OpenAIAdapter({
      apiKey: "test",
      client: {
        chat: {
          completions: {
            create: async (req: unknown) => {
              captured = req as Record<string, unknown>;
              return { choices: [{ message: { content: "x" } }] };
            },
          },
        },
        files: { create: async () => ({ id: "f" }) },
        batches: { create: async () => ({ id: "b" }) },
      },
    });
    await adapter.dispatch("gpt-4o", "hi", { maxTokens: 128, temperature: 0.2 });
    expect(captured?.max_tokens).toBe(128);
    expect("max_completion_tokens" in captured!).toBe(false);
    expect(captured?.temperature).toBe(0.2);
  });

  it("applies the same o-series parameter mapping to batch JSONL bodies", async () => {
    let jsonl: string | undefined;
    const adapter = new OpenAIAdapter({
      apiKey: "test",
      client: {
        chat: { completions: { create: async () => ({}) } },
        files: {
          create: async (req: { file: Blob }) => {
            jsonl = await req.file.text();
            return { id: "file_1" };
          },
        },
        batches: { create: async () => ({ id: "batch_1" }) },
      },
    });
    await adapter.dispatchBatch("o1", ["p"], { maxTokens: 32, temperature: 0.9 });
    const body = JSON.parse(jsonl!.split("\n")[0]!).body as Record<string, unknown>;
    expect(body.max_completion_tokens).toBe(32);
    expect("max_tokens" in body).toBe(false);
    expect("temperature" in body).toBe(false);
  });

  it("uploads a JSONL file, then submits a batch", async () => {
    let uploadedPurpose: string | undefined;
    const adapter = new OpenAIAdapter({
      apiKey: "test",
      client: {
        chat: { completions: { create: async () => ({}) } },
        files: {
          create: async (req: { purpose: string }) => {
            uploadedPurpose = req.purpose;
            return { id: "file_123" };
          },
        },
        batches: {
          create: async (req: { input_file_id: string; completion_window: string }) => {
            expect(req.input_file_id).toBe("file_123");
            expect(req.completion_window).toBe("24h");
            return { id: "batch_abc" };
          },
        },
      },
    });
    const handle = await adapter.dispatchBatch("gpt-4.1-mini", [
      "prompt-1",
      "prompt-2",
    ]);
    expect(uploadedPurpose).toBe("batch");
    expect(handle.batchId).toBe("batch_abc");
    expect(handle.size).toBe(2);
  });
});
