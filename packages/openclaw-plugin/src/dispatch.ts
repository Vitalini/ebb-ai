/**
 * In-process dispatcher for the OpenClaw plugin.
 *
 * Provider-call tasks are only *executed* when something calls
 * `Scheduler.tick(adapters)`. The CLI does that via `ebb tick` on a
 * cron; inside the long-lived OpenClaw gateway the plugin runs its own
 * background loop instead (see index.ts `ensureDispatcher`).
 *
 * These adapters call the provider HTTP APIs directly with `fetch` — no
 * vendor SDK — so the bundled plugin stays small and needs nothing
 * installed. An adapter only exists when its API key is present in the
 * environment; a task whose provider has no adapter is failed by
 * `Scheduler.tick` with a clear error rather than left stuck.
 */

import type { DispatchOptions, DispatchResult, ProviderAdapter } from "@ebb-ai/core";

/**
 * The dispatcher only ever runs prompts synchronously, so an adapter
 * needs just `dispatch` — not the Batch-API `dispatchBatch`. Omitting
 * `dispatchBatch` keeps `Scheduler.tick` on the synchronous path.
 */
export type DispatchAdapter = Pick<ProviderAdapter, "provider" | "ready" | "dispatch">;

export type DispatchAdapters = {
  anthropic?: DispatchAdapter;
  openai?: DispatchAdapter;
};

async function readError(res: Response): Promise<string> {
  try {
    return (await res.text()).slice(0, 300);
  } catch {
    return "(no response body)";
  }
}

/** Anthropic Messages API adapter — https://api.anthropic.com/v1/messages */
function anthropicAdapter(apiKey: string): DispatchAdapter {
  return {
    provider: "anthropic",
    ready: true,
    async dispatch(
      model: string,
      prompt: string,
      options?: DispatchOptions,
    ): Promise<DispatchResult> {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model,
          // Anthropic requires max_tokens; default generously.
          max_tokens: options?.maxTokens ?? 4096,
          ...(options?.temperature !== undefined
            ? { temperature: options.temperature }
            : {}),
          ...(options?.system ? { system: options.system } : {}),
          messages: [{ role: "user", content: prompt }],
        }),
      });
      if (!res.ok) {
        throw new Error(`anthropic API ${res.status}: ${await readError(res)}`);
      }
      const data = (await res.json()) as {
        content?: Array<{ type: string; text?: string }>;
        usage?: { input_tokens?: number; output_tokens?: number };
        model?: string;
      };
      const text = (data.content ?? [])
        .filter((b) => b.type === "text" && typeof b.text === "string")
        .map((b) => b.text as string)
        .join("");
      const inputTokens = data.usage?.input_tokens;
      const outputTokens = data.usage?.output_tokens;
      return {
        text,
        model: data.model ?? model,
        provider: "anthropic",
        usage: {
          inputTokens,
          outputTokens,
          totalTokens:
            inputTokens !== undefined && outputTokens !== undefined
              ? inputTokens + outputTokens
              : undefined,
        },
        raw: data,
      };
    },
  };
}

/** OpenAI Chat Completions adapter — https://api.openai.com/v1/chat/completions */
function openaiAdapter(apiKey: string): DispatchAdapter {
  return {
    provider: "openai",
    ready: true,
    async dispatch(
      model: string,
      prompt: string,
      options?: DispatchOptions,
    ): Promise<DispatchResult> {
      const res = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          authorization: `Bearer ${apiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model,
          messages: [
            ...(options?.system
              ? [{ role: "system", content: options.system }]
              : []),
            { role: "user", content: prompt },
          ],
          ...(options?.temperature !== undefined
            ? { temperature: options.temperature }
            : {}),
          ...(options?.maxTokens !== undefined
            ? { max_tokens: options.maxTokens }
            : {}),
        }),
      });
      if (!res.ok) {
        throw new Error(`openai API ${res.status}: ${await readError(res)}`);
      }
      const data = (await res.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
        usage?: {
          prompt_tokens?: number;
          completion_tokens?: number;
          total_tokens?: number;
        };
        model?: string;
      };
      return {
        text: data.choices?.[0]?.message?.content ?? "",
        model: data.model ?? model,
        provider: "openai",
        usage: {
          inputTokens: data.usage?.prompt_tokens,
          outputTokens: data.usage?.completion_tokens,
          totalTokens: data.usage?.total_tokens,
        },
        raw: data,
      };
    },
  };
}

/**
 * Build the provider adapters available in the current environment.
 * Only providers whose API key is set get an adapter.
 */
export function buildAdapters(
  env: Record<string, string | undefined> = process.env,
): DispatchAdapters {
  const adapters: DispatchAdapters = {};
  const anthropicKey = env.ANTHROPIC_API_KEY?.trim();
  if (anthropicKey) adapters.anthropic = anthropicAdapter(anthropicKey);
  const openaiKey = env.OPENAI_API_KEY?.trim();
  if (openaiKey) adapters.openai = openaiAdapter(openaiKey);
  return adapters;
}
