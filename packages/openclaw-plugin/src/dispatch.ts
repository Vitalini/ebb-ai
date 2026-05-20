/**
 * In-process dispatcher adapters for the OpenClaw plugin.
 *
 * Provider-call tasks only *execute* when `Scheduler.tick` runs, and tick
 * needs an adapter per provider. Adapters come from two sources, in
 * priority order:
 *
 *  1. The OpenClaw runtime bridge — `api.runtime.llm.complete`, captured
 *     from a tool-call context. It runs the prompt through the gateway's
 *     own configured model + credentials, so NO separate API key is
 *     needed. This is the preferred path inside an OpenClaw gateway.
 *  2. Direct HTTP adapters built from `ANTHROPIC_API_KEY` / `OPENAI_API_KEY`.
 *     A fallback for environments where the runtime bridge is unavailable
 *     (e.g. the standalone CLI, or a gateway that denies plugin LLM use).
 *
 * A task whose provider has no adapter is failed by `Scheduler.tick` with
 * a clear error instead of being left stuck in `scheduled`.
 */

import type { DispatchOptions, DispatchResult, ProviderAdapter } from "@ebb-ai/core";

/**
 * The dispatcher only runs prompts synchronously, so an adapter needs
 * just `dispatch` — not the Batch-API `dispatchBatch`. Omitting it keeps
 * `Scheduler.tick` on the synchronous path.
 */
export type DispatchAdapter = Pick<ProviderAdapter, "provider" | "ready" | "dispatch">;

export type DispatchAdapters = {
  anthropic?: DispatchAdapter;
  openai?: DispatchAdapter;
};

/** How scheduled tasks will be executed in the current environment. */
export type DispatchCapability = "openclaw-runtime" | "api-key" | "unconfigured";

// ── OpenClaw runtime LLM bridge ─────────────────────────────────────────────
// Structural shape of OpenClaw's `api.runtime.llm.complete`. The real SDK
// types are injected by the gateway at load time, not available at build
// time, so we describe just the slice we use.
type BridgeLlmComplete = (params: {
  messages: Array<{ role: "system" | "user" | "assistant"; content: string }>;
  model?: string;
  maxTokens?: number;
  temperature?: number;
  systemPrompt?: string;
  purpose?: string;
}) => Promise<{
  text: string;
  provider?: string;
  model?: string;
  usage?: { inputTokens?: number; outputTokens?: number; totalTokens?: number };
}>;

let bridgeComplete: BridgeLlmComplete | undefined;

/**
 * Capture the OpenClaw runtime's LLM-complete caller from a tool-call
 * context (`context.api.runtime.llm.complete`). Idempotent and fully
 * defensive — does nothing if that surface is absent.
 */
export function captureOpenClawRuntime(context: unknown): void {
  if (bridgeComplete) return;
  const llm = (
    context as
      | { api?: { runtime?: { llm?: { complete?: unknown } } } }
      | undefined
  )?.api?.runtime?.llm;
  if (llm && typeof llm.complete === "function") {
    bridgeComplete = (llm.complete as BridgeLlmComplete).bind(llm);
  }
}

/** Test seam: inject or clear the runtime bridge directly. */
export function setLlmBridgeForTest(fn: BridgeLlmComplete | undefined): void {
  bridgeComplete = fn;
}

/** True once the OpenClaw runtime LLM bridge has been captured. */
export function hasRuntimeBridge(): boolean {
  return bridgeComplete !== undefined;
}

/** Adapter that routes a provider_call through OpenClaw's own model runtime. */
function bridgeAdapter(provider: "anthropic" | "openai"): DispatchAdapter {
  return {
    provider,
    ready: true,
    async dispatch(
      model: string,
      prompt: string,
      options?: DispatchOptions,
    ): Promise<DispatchResult> {
      if (!bridgeComplete) {
        throw new Error("ebb-ai: the OpenClaw runtime LLM bridge is not available");
      }
      const result = await bridgeComplete({
        messages: [{ role: "user", content: prompt }],
        model: `${provider}/${model}`,
        ...(options?.maxTokens !== undefined ? { maxTokens: options.maxTokens } : {}),
        ...(options?.temperature !== undefined
          ? { temperature: options.temperature }
          : {}),
        ...(options?.system ? { systemPrompt: options.system } : {}),
        purpose: "ebb-ai deferred task dispatch",
      });
      return {
        text: result.text,
        model: result.model ?? model,
        provider: result.provider ?? provider,
        usage: {
          inputTokens: result.usage?.inputTokens,
          outputTokens: result.usage?.outputTokens,
          totalTokens: result.usage?.totalTokens,
        },
        raw: result,
      };
    },
  };
}

// ── Direct HTTP adapters (fallback) ─────────────────────────────────────────

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
 * Build the dispatch adapters for the current environment. Prefers the
 * OpenClaw runtime bridge (no API key needed); otherwise builds direct
 * HTTP adapters from whatever provider keys are set.
 */
export function buildAdapters(
  env: Record<string, string | undefined> = process.env,
): DispatchAdapters {
  if (bridgeComplete) {
    // The bridge routes through the gateway's own model — register it for
    // both providers so tick finds an adapter whatever the task asked for.
    return { anthropic: bridgeAdapter("anthropic"), openai: bridgeAdapter("openai") };
  }
  const adapters: DispatchAdapters = {};
  const anthropicKey = env.ANTHROPIC_API_KEY?.trim();
  if (anthropicKey) adapters.anthropic = anthropicAdapter(anthropicKey);
  const openaiKey = env.OPENAI_API_KEY?.trim();
  if (openaiKey) adapters.openai = openaiAdapter(openaiKey);
  return adapters;
}

/** Summarise how scheduled tasks will be dispatched right now. */
export function dispatchCapability(
  env: Record<string, string | undefined> = process.env,
): DispatchCapability {
  if (bridgeComplete) return "openclaw-runtime";
  if (env.ANTHROPIC_API_KEY?.trim() || env.OPENAI_API_KEY?.trim()) return "api-key";
  return "unconfigured";
}
