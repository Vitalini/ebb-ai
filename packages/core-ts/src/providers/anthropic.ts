/**
 * Anthropic provider adapter.
 *
 * Wraps @anthropic-ai/sdk. The SDK is a peer dependency — this module
 * imports it lazily so missing-SDK callers still get a clear error
 * instead of a module-load crash.
 *
 * Endpoints used:
 *   - messages.create — sync dispatch
 *   - messages.batches.create — Batch API (50% off, 24h SLA)
 */

import type {
  BatchHandle,
  BatchRetrieveResult,
  DispatchOptions,
  DispatchResult,
  ProviderAdapter,
} from "./base.js";

export interface AnthropicAdapterOptions {
  /**
   * API key. Supplied by the host — this library never reads the environment.
   * The `ebb` CLI and `@ebb-ai/mcp` server read `ANTHROPIC_API_KEY` and pass
   * it here; the OpenClaw plugin passes `anthropicApiKey` from plugin config.
   * Without a key (and without `client`), `ready` is false.
   */
  apiKey?: string;
  /**
   * Inject an already-constructed SDK client. Useful for tests and for
   * callers that want to reuse a single client across the process.
   */
  client?: unknown;
}

interface AnthropicMessagesClient {
  messages: {
    create(req: unknown): Promise<unknown>;
    batches: {
      create(req: unknown): Promise<unknown>;
      retrieve(batchId: string): Promise<unknown>;
      results(batchId: string): Promise<AsyncIterable<unknown>>;
    };
  };
}

export class AnthropicAdapter implements ProviderAdapter {
  readonly provider = "anthropic";
  private readonly apiKey: string | undefined;
  private client: AnthropicMessagesClient | undefined;

  constructor(opts: AnthropicAdapterOptions = {}) {
    this.apiKey = opts.apiKey;
    if (opts.client) {
      this.client = opts.client as AnthropicMessagesClient;
    }
  }

  get ready(): boolean {
    return Boolean(this.client) || Boolean(this.apiKey);
  }

  async dispatch(
    model: string,
    prompt: string,
    options: DispatchOptions = {},
  ): Promise<DispatchResult> {
    const client = await this.getClient();
    const res = (await client.messages.create({
      model,
      max_tokens: options.maxTokens ?? 1024,
      temperature: options.temperature,
      system: options.system,
      messages: [{ role: "user", content: prompt }],
      metadata: options.metadata ? { user_id: undefined, ...options.metadata } : undefined,
    })) as {
      content?: Array<{ type: string; text?: string }>;
      usage?: { input_tokens?: number; output_tokens?: number };
      model?: string;
    };
    const text = (res.content ?? [])
      .filter((b) => b.type === "text" && typeof b.text === "string")
      .map((b) => b.text as string)
      .join("");
    return {
      text,
      usage: {
        inputTokens: res.usage?.input_tokens,
        outputTokens: res.usage?.output_tokens,
        totalTokens:
          res.usage?.input_tokens !== undefined && res.usage?.output_tokens !== undefined
            ? res.usage.input_tokens + res.usage.output_tokens
            : undefined,
      },
      model: res.model ?? model,
      provider: this.provider,
      raw: res,
    };
  }

  async dispatchBatch(
    model: string,
    prompts: string[],
    options: DispatchOptions = {},
  ): Promise<BatchHandle> {
    if (prompts.length === 0) {
      throw new Error("dispatchBatch: prompts must contain at least one entry");
    }
    const client = await this.getClient();
    const requests = prompts.map((prompt, i) => ({
      custom_id: `ebb-${i}`,
      params: {
        model,
        max_tokens: options.maxTokens ?? 1024,
        temperature: options.temperature,
        system: options.system,
        messages: [{ role: "user", content: prompt }],
      },
    }));
    const res = (await client.messages.batches.create({ requests })) as {
      id?: string;
    };
    if (!res.id) {
      throw new Error("Anthropic Batch API returned no batch id");
    }
    return { batchId: res.id, provider: this.provider, size: prompts.length };
  }

  /**
   * Poll a Message Batch. Maps Anthropic's
   * `processing_status` ("in_progress" | "canceling" | "ended") plus the
   * per-request `request_counts` onto the uniform BatchRetrieveResult.
   * Once the batch has ended we stream `messages.batches.results`, which
   * yields one entry per request with a `result` union (succeeded /
   * errored / expired / canceled).
   */
  async retrieveBatch(batchId: string): Promise<BatchRetrieveResult> {
    const client = await this.getClient();
    const batch = (await client.messages.batches.retrieve(batchId)) as {
      processing_status?: string;
    };
    if (batch.processing_status !== "ended") {
      // "in_progress" and "canceling" are both still-running from our POV.
      return { status: "in_progress" };
    }
    const results: NonNullable<BatchRetrieveResult["results"]> = [];
    let sawExpired = false;
    let sawError = false;
    let firstError: string | undefined;
    const iterable = await client.messages.batches.results(batchId);
    for await (const entry of iterable) {
      const e = entry as {
        result?: {
          type?: string;
          message?: {
            content?: Array<{ type: string; text?: string }>;
            usage?: { input_tokens?: number; output_tokens?: number };
            model?: string;
          };
          error?: { message?: string; type?: string };
        };
      };
      const type = e.result?.type;
      if (type === "succeeded") {
        const message = e.result?.message;
        const text = (message?.content ?? [])
          .filter((b) => b.type === "text" && typeof b.text === "string")
          .map((b) => b.text as string)
          .join("");
        const inputTokens = message?.usage?.input_tokens;
        const outputTokens = message?.usage?.output_tokens;
        results.push({
          text,
          model: message?.model,
          usage: {
            inputTokens,
            outputTokens,
            totalTokens:
              inputTokens !== undefined && outputTokens !== undefined
                ? inputTokens + outputTokens
                : undefined,
          },
        });
      } else if (type === "expired") {
        sawExpired = true;
      } else {
        sawError = true;
        firstError ??=
          e.result?.error?.message ?? `batch request result type: ${type}`;
      }
    }
    if (results.length > 0) {
      return { status: "completed", results };
    }
    if (sawExpired) {
      return { status: "expired", error: "Anthropic batch request expired" };
    }
    if (sawError) {
      return { status: "failed", error: firstError ?? "Anthropic batch request failed" };
    }
    // Ended with no parseable results — treat as failed rather than hang.
    return { status: "failed", error: "Anthropic batch ended with no results" };
  }

  private async getClient(): Promise<AnthropicMessagesClient> {
    if (this.client) return this.client;
    if (!this.apiKey) {
      throw new Error(
        "AnthropicAdapter: no API key. Set ANTHROPIC_API_KEY or pass { apiKey } to the constructor.",
      );
    }
    let Anthropic: new (opts: {
      apiKey: string;
      maxRetries?: number;
    }) => AnthropicMessagesClient;
    try {
      const mod = (await import("@anthropic-ai/sdk")) as
        | { default: typeof Anthropic }
        | { Anthropic: typeof Anthropic };
      Anthropic =
        "default" in mod
          ? mod.default
          : (mod as { Anthropic: typeof Anthropic }).Anthropic;
    } catch (err) {
      throw new Error(
        "AnthropicAdapter: @anthropic-ai/sdk is not installed. Run `pnpm add @anthropic-ai/sdk`.",
      );
    }
    // maxRetries: 0 — ebb-ai's scheduler owns the retry policy
    // (retryWithBackoff); letting the SDK retry too multiplies attempts
    // and can double-bill ambiguous network errors.
    this.client = new Anthropic({ apiKey: this.apiKey, maxRetries: 0 });
    return this.client;
  }
}
