/**
 * OpenAI provider adapter.
 *
 * Wraps the `openai` SDK. Lazy import (like the Anthropic adapter).
 *
 * Endpoints used:
 *   - responses.create / chat.completions.create — sync dispatch
 *   - files.create({ purpose: "batch" }) + batches.create — Batch API
 *     (50% off, 24h SLA). OpenAI's batch input is a JSONL file uploaded
 *     to /v1/files, then referenced by id from POST /v1/batches.
 */

import type {
  BatchHandle,
  DispatchOptions,
  DispatchResult,
  ProviderAdapter,
} from "./base.js";

export interface OpenAIAdapterOptions {
  apiKey?: string;
  client?: unknown;
}

interface OpenAIClient {
  chat: {
    completions: {
      create(req: unknown): Promise<unknown>;
    };
  };
  files: {
    create(req: unknown): Promise<unknown>;
  };
  batches: {
    create(req: unknown): Promise<unknown>;
  };
}

export class OpenAIAdapter implements ProviderAdapter {
  readonly provider = "openai";
  private readonly apiKey: string | undefined;
  private client: OpenAIClient | undefined;

  constructor(opts: OpenAIAdapterOptions = {}) {
    this.apiKey = opts.apiKey ?? process.env.OPENAI_API_KEY;
    if (opts.client) {
      this.client = opts.client as OpenAIClient;
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
    const messages = options.system
      ? [
          { role: "system", content: options.system },
          { role: "user", content: prompt },
        ]
      : [{ role: "user", content: prompt }];
    const res = (await client.chat.completions.create({
      model,
      messages,
      temperature: options.temperature,
      max_tokens: options.maxTokens,
    })) as {
      choices?: Array<{ message?: { content?: string } }>;
      usage?: {
        prompt_tokens?: number;
        completion_tokens?: number;
        total_tokens?: number;
      };
      model?: string;
    };
    const text = res.choices?.[0]?.message?.content ?? "";
    return {
      text,
      usage: {
        inputTokens: res.usage?.prompt_tokens,
        outputTokens: res.usage?.completion_tokens,
        totalTokens: res.usage?.total_tokens,
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
    const jsonl = prompts
      .map((prompt, i) => {
        const messages = options.system
          ? [
              { role: "system", content: options.system },
              { role: "user", content: prompt },
            ]
          : [{ role: "user", content: prompt }];
        const body = {
          custom_id: `ebb-${i}`,
          method: "POST",
          url: "/v1/chat/completions",
          body: {
            model,
            messages,
            temperature: options.temperature,
            max_tokens: options.maxTokens,
          },
        };
        return JSON.stringify(body);
      })
      .join("\n");
    const buffer = new TextEncoder().encode(jsonl);
    const file = (await client.files.create({
      file: new Blob([buffer], { type: "application/jsonl" }),
      purpose: "batch",
    })) as { id?: string };
    if (!file.id) {
      throw new Error("OpenAI Files API returned no file id");
    }
    const batch = (await client.batches.create({
      input_file_id: file.id,
      endpoint: "/v1/chat/completions",
      completion_window: "24h",
    })) as { id?: string };
    if (!batch.id) {
      throw new Error("OpenAI Batch API returned no batch id");
    }
    return { batchId: batch.id, provider: this.provider, size: prompts.length };
  }

  private async getClient(): Promise<OpenAIClient> {
    if (this.client) return this.client;
    if (!this.apiKey) {
      throw new Error(
        "OpenAIAdapter: no API key. Set OPENAI_API_KEY or pass { apiKey } to the constructor.",
      );
    }
    let OpenAI: new (opts: { apiKey: string }) => OpenAIClient;
    try {
      const mod = (await import("openai")) as
        | { default: typeof OpenAI }
        | { OpenAI: typeof OpenAI };
      OpenAI =
        "default" in mod ? mod.default : (mod as { OpenAI: typeof OpenAI }).OpenAI;
    } catch (err) {
      throw new Error(
        "OpenAIAdapter: `openai` SDK is not installed. Run `pnpm add openai`.",
      );
    }
    this.client = new OpenAI({ apiKey: this.apiKey });
    return this.client;
  }
}
