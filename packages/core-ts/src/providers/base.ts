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
 *     50% cheaper, up-to-24h SLA. The scheduler routes deadline > 24h
 *     tasks here automatically (status "submitted"), then polls
 *     retrieveBatch() from tick() until results land (status "completed").
 *
 *   - retrieveBatch(): poll a submitted batch by id; returns status and,
 *     when completed, the parsed per-request results (text + usage).
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
  /** Free-form metadata forwarded to the provider request (e.g. the
   *  Anthropic `metadata` field). Not recorded on the carbon receipt. */
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

/**
 * Result of polling a submitted batch via {@link ProviderAdapter.retrieveBatch}.
 *
 * The scheduler only ever submits single-prompt batches, so `results`
 * carries at most one entry; the scheduler takes `results[0]`.
 */
export interface BatchRetrieveResult {
  /**
   * Batch lifecycle:
   *   - "in_progress": still running; poll again later.
   *   - "completed":   results are available in `results`.
   *   - "failed":      the batch itself errored (not per-request).
   *   - "expired":     the batch exceeded its SLA without completing.
   */
  status: "in_progress" | "completed" | "failed" | "expired";
  /** Per-request results, present when status === "completed". */
  results?: Array<{
    text: string;
    model?: string;
    usage?: {
      inputTokens?: number;
      outputTokens?: number;
      totalTokens?: number;
    };
  }>;
  /** Human-readable error when status is "failed" / "expired". */
  error?: string;
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

  /**
   * Submit a batch of prompts; resolves once the batch is registered.
   *
   * Optional: a provider whose Batch API does not map cleanly onto this
   * submit → poll → results contract (e.g. Gemini, whose Developer-API
   * batch mode is a long-running operation keyed by an operation name and
   * whose Vertex batch path requires GCS/BigQuery I/O), or a local provider
   * with no batch API at all (Ollama), simply omits this method. The
   * scheduler feature-detects `typeof adapter.dispatchBatch === "function"`
   * and keeps batch-incapable adapters on the sync path.
   */
  dispatchBatch?(
    model: string,
    prompts: string[],
    options?: DispatchOptions,
  ): Promise<BatchHandle>;

  /**
   * Poll a submitted batch by id. Returns the batch's current status and,
   * when completed, the parsed per-request results (text + usage). The
   * scheduler calls this from `tick()` on every "submitted" task until it
   * observes a terminal status. Optional so adapters that only submit
   * (or third-party adapters) need not implement it — the scheduler
   * feature-detects `typeof adapter.retrieveBatch === "function"`.
   */
  retrieveBatch?(batchId: string): Promise<BatchRetrieveResult>;
}
