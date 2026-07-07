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
  DispatchOptions,
  DispatchResult,
  ProviderAdapter,
} from "./base.js";

export interface AnthropicAdapterOptions {
  /** API key. Defaults to process.env.ANTHROPIC_API_KEY. */
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
    };
  };
}

export class AnthropicAdapter implements ProviderAdapter {
  readonly provider = "anthropic";
  private readonly apiKey: string | undefined;
  private client: AnthropicMessagesClient | undefined;

  constructor(opts: AnthropicAdapterOptions = {}) {
    this.apiKey = opts.apiKey ?? process.env.ANTHROPIC_API_KEY;
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
