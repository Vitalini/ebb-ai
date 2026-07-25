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

import {
  GeminiAdapter,
  OllamaAdapter,
  type DispatchOptions,
  type DispatchResult,
  type ProviderAdapter,
} from "@ebb-ai/core";

/**
 * The dispatcher only runs prompts synchronously, so an adapter needs
 * just `dispatch` — not the Batch-API `dispatchBatch`. Omitting it keeps
 * `Scheduler.tick` on the synchronous path.
 */
export type DispatchAdapter = Pick<ProviderAdapter, "provider" | "ready" | "dispatch">;

export type DispatchAdapters = {
  anthropic?: DispatchAdapter;
  openai?: DispatchAdapter;
  gemini?: DispatchAdapter;
  ollama?: DispatchAdapter;
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
let capturedOpenClawConfig: unknown;

/**
 * Capture what the plugin needs from a tool-call context: the OpenClaw
 * runtime's LLM-complete caller (`api.runtime.llm.complete`) for dispatch,
 * and the gateway config (`api.config`) for result delivery. Idempotent
 * and fully defensive — does nothing for surfaces that are absent.
 */
export function captureOpenClawRuntime(context: unknown): void {
  const api = (
    context as
      | {
          api?: {
            runtime?: { llm?: { complete?: unknown } };
            config?: unknown;
          };
        }
      | undefined
  )?.api;
  if (!api) return;
  if (!bridgeComplete) {
    const llm = api.runtime?.llm;
    if (llm && typeof llm.complete === "function") {
      bridgeComplete = (llm.complete as BridgeLlmComplete).bind(llm);
    }
  }
  if (capturedOpenClawConfig === undefined && api.config !== undefined) {
    capturedOpenClawConfig = api.config;
  }
}

/** The gateway config captured from a tool-call context (for delivery). */
export function getCapturedOpenClawConfig(): unknown {
  return capturedOpenClawConfig;
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
      // Deliberately DO NOT pass `model`. OpenClaw treats any `model` on a
      // plugin LLM completion as a model-override and rejects it unless the
      // gateway grants the plugin override policy ("Plugin LLM completion
      // cannot override the target model"). A deferred task runs fine on the
      // gateway agent's configured model — the carbon win is in the timing,
      // not the model. The requested model is honoured only on the
      // direct-API-key path (the HTTP adapters below).
      const result = await bridgeComplete({
        messages: [{ role: "user", content: prompt }],
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
 * The complete set of environment variables the dispatch layer consults —
 * the provider credentials it forwards to that provider's own API, plus the
 * Ollama host/model configuration.
 *
 * Declared as a closed shape, and populated by `providerEnv()` with six
 * literal reads, so that nothing here ever holds a reference to the whole
 * `process.env`. Binding the entire environment (the previous
 * `= process.env` defaults) pulled every unrelated secret the host exports
 * into scope alongside code that makes network calls — an auditor cannot
 * tell that apart from credential harvesting, and it was never needed.
 */
export interface ProviderEnv {
  ANTHROPIC_API_KEY?: string;
  OPENAI_API_KEY?: string;
  GEMINI_API_KEY?: string;
  GOOGLE_API_KEY?: string;
  OLLAMA_HOST?: string;
  OLLAMA_MODELS?: string;
}

/** Snapshot exactly the six recognized variables, by name. */
function providerEnv(): ProviderEnv {
  return {
    ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
    GEMINI_API_KEY: process.env.GEMINI_API_KEY,
    GOOGLE_API_KEY: process.env.GOOGLE_API_KEY,
    OLLAMA_HOST: process.env.OLLAMA_HOST,
    OLLAMA_MODELS: process.env.OLLAMA_MODELS,
  };
}

/**
 * Build the dispatch adapters for the current environment. Prefers the
 * OpenClaw runtime bridge (no API key needed); otherwise builds direct
 * HTTP adapters from whatever provider keys are set.
 */
export function buildAdapters(
  env: ProviderEnv = providerEnv(),
): DispatchAdapters {
  const adapters: DispatchAdapters = {};
  if (bridgeComplete) {
    // The bridge routes through the gateway's own model — register it for
    // both hosted providers so tick finds an adapter whatever the task asked
    // for. (Gemini / Ollama are NOT gateway models, so they never ride the
    // bridge; they are added below from their own configuration.)
    adapters.anthropic = bridgeAdapter("anthropic");
    adapters.openai = bridgeAdapter("openai");
  } else {
    const anthropicKey = env.ANTHROPIC_API_KEY?.trim();
    if (anthropicKey) adapters.anthropic = anthropicAdapter(anthropicKey);
    const openaiKey = env.OPENAI_API_KEY?.trim();
    if (openaiKey) adapters.openai = openaiAdapter(openaiKey);
  }
  // Gemini and Ollama are distinct providers the gateway bridge cannot
  // represent, so build direct adapters whenever they are configured —
  // regardless of the bridge. Gemini reads GEMINI_API_KEY (else GOOGLE_API_KEY);
  // Ollama is local + keyless, gated on an explicit OLLAMA_HOST opt-in.
  const geminiKey = env.GEMINI_API_KEY?.trim() || env.GOOGLE_API_KEY?.trim();
  if (geminiKey) adapters.gemini = new GeminiAdapter({ apiKey: geminiKey });
  const ollamaHost = env.OLLAMA_HOST?.trim();
  if (ollamaHost) adapters.ollama = new OllamaAdapter({ host: ollamaHost });
  return adapters;
}

/** Summarise how scheduled tasks will be dispatched right now. */
export function dispatchCapability(
  env: ProviderEnv = providerEnv(),
): DispatchCapability {
  if (bridgeComplete) return "openclaw-runtime";
  if (
    env.ANTHROPIC_API_KEY?.trim() ||
    env.OPENAI_API_KEY?.trim() ||
    env.GEMINI_API_KEY?.trim() ||
    env.GOOGLE_API_KEY?.trim() ||
    env.OLLAMA_HOST?.trim()
  ) {
    return "api-key";
  }
  return "unconfigured";
}

export type Provider = "anthropic" | "openai" | "gemini" | "ollama";

/**
 * Parse the configured Ollama model allow-list from `OLLAMA_MODELS`
 * (comma-separated model ids). A model in this list infers to the `ollama`
 * provider. Empty / unset → no models map to Ollama by inference (an explicit
 * `provider: "ollama"` still works).
 */
function ollamaModelSet(
  env: ProviderEnv = providerEnv(),
): ReadonlySet<string> {
  return new Set(
    (env.OLLAMA_MODELS ?? "")
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter((s) => s.length > 0),
  );
}

/**
 * Infer the provider from a model identifier:
 *   - `gpt-*` / `o<digit>*` (o1, o3-mini, …) → openai
 *   - `gemini-*` → gemini
 *   - a model listed in `OLLAMA_MODELS` → ollama
 *   - `claude-*` → anthropic
 * Anything unrecognised defaults to `anthropic` (the historical default and
 * the safest fallback for a gateway that has an Anthropic key). Case- and
 * whitespace-insensitive. An explicit `provider` param always wins over this.
 */
export function inferProvider(
  model: string | undefined,
  env: ProviderEnv = providerEnv(),
): Provider {
  const m = (model ?? "").trim().toLowerCase();
  if (m.startsWith("gpt-") || m.startsWith("gpt") || /^o\d/.test(m)) return "openai";
  if (m.startsWith("gemini")) return "gemini";
  if (m.length > 0 && ollamaModelSet(env).has(m)) return "ollama";
  if (m.startsWith("claude")) return "anthropic";
  return "anthropic";
}

/**
 * Which providers can actually be dispatched in the current environment.
 * With the runtime bridge captured, both hosted providers are dispatchable
 * (the bridge routes through the gateway's own model). Gemini / Ollama are
 * dispatchable whenever their own configuration is present, bridge or not.
 */
export function availableProviders(
  env: ProviderEnv = providerEnv(),
): Set<Provider> {
  const set = new Set<Provider>();
  if (bridgeComplete) {
    set.add("anthropic");
    set.add("openai");
  } else {
    if (env.ANTHROPIC_API_KEY?.trim()) set.add("anthropic");
    if (env.OPENAI_API_KEY?.trim()) set.add("openai");
  }
  if (env.GEMINI_API_KEY?.trim() || env.GOOGLE_API_KEY?.trim()) set.add("gemini");
  if (env.OLLAMA_HOST?.trim()) set.add("ollama");
  return set;
}
