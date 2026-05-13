/**
 * Provider adapter interface.
 *
 * Adapters wrap a vendor SDK (Anthropic, OpenAI, etc.) and expose two
 * uniform entry points:
 *
 *   - dispatch(): single synchronous-ish LLM call, returns when complete.
 *     The scheduler waits until the chosen carbon window, then calls this.
 *
 *   - dispatchBatch(): submit N prompts via the vendor's Batch API
 *     (Anthropic Message Batches, OpenAI Batch Files). Returns a handle.
 *     50% cheaper, up-to-24h SLA. ebb-ai picks this path automatically
 *     when the deadline is far enough out.
 *
 * Adapter modules import the vendor SDK lazily so the package can be
 * installed without forcing both SDK dependencies on every consumer.
 */

export interface DispatchOptions {
  /** Sampling temperature; vendor-specific defaults if omitted. */
  temperature?: number;
  /** Max tokens to generate. */
  maxTokens?: number;
  /** Optional system prompt. */
  system?: string;
  /** Free-form metadata passed through to the receipt. */
  metadata?: Record<string, string>;
}

export interface DispatchResult {
  /** The model's text reply, concatenated across content blocks. */
  text: string;
  /** Token usage as reported by the provider. Fields may be missing. */
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
  };
  /** Vendor identifier we used (e.g. "claude-sonnet-4-5", "gpt-4.1-mini"). */
  model: string;
  /** Vendor name: "anthropic" | "openai" | "..." */
  provider: string;
  /** Raw vendor response object. Inspect at your own risk. */
  raw: unknown;
}

export interface BatchHandle {
  /** Vendor batch identifier. Use the vendor SDK to poll for completion. */
  batchId: string;
  /** Vendor name, mirrors DispatchResult.provider. */
  provider: string;
  /** Number of prompts in this batch. */
  size: number;
}

export interface ProviderAdapter {
  /** Vendor name, lowercase, no spaces. */
  readonly provider: string;
  /** True if a usable client could be constructed (API key present etc.). */
  readonly ready: boolean;

  /** Run one prompt; resolve when the model finishes. */
  dispatch(
    model: string,
    prompt: string,
    options?: DispatchOptions,
  ): Promise<DispatchResult>;

  /** Submit a batch of prompts; resolves once the batch is registered. */
  dispatchBatch(
    model: string,
    prompts: string[],
    options?: DispatchOptions,
  ): Promise<BatchHandle>;
}
