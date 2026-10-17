/**
 * Claude Code provider adapter.
 *
 * Runs the local `claude` CLI headless (`claude -p`) under the user's Claude
 * Code subscription login, so a task needs no API key. It lives in the CLI
 * host, not in `@tidegap/core`: core stays free of process spawning (see
 * `notify.ts`), and `tidegap tick` is the only host that runs it.
 *
 * Isolation: the prompt goes on stdin (never argv), the built-in tools are
 * cut to a read-only set (`--tools` and `--allowedTools` name the same
 * allowlisted tools, default WebSearch and WebFetch; `--permission-mode
 * dontAsk` denies the rest), the user's CLAUDE.md, skills, plugins, hooks and
 * MCP servers are off (`--safe-mode`, `--strict-mcp-config`), and the run
 * happens in a fresh temp directory that is removed afterwards. The child
 * leads its own process group, so the timeout stops anything it started.
 *
 * Batch: UNSUPPORTED. There is no batch path, so `dispatchBatch` is omitted
 * and the scheduler keeps these tasks on the sync path. `maxTokens` and
 * `temperature` are ignored: the CLI has no flags for them.
 *
 * Failures throw a plain `Error` (no `status` / `code`), so the scheduler
 * fails the task once and never retries: Claude Code retries API errors
 * itself, and a subscription usage limit lasts hours.
 */

import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  claudeCodeToolsError,
  DEFAULT_CLAUDE_CODE_TOOLS,
  ProviderRefusalError,
  type DispatchOptions,
  type DispatchResult,
  type ProviderAdapter,
} from "@tidegap/core";

export interface ClaudeCodeAdapterOptions {
  /** Absolute path of the `claude` binary. Unset means not ready. */
  binaryPath?: string;
  /** Environment for the child process. Unset inherits this process's. */
  env?: Record<string, string | undefined>;
  /** `--max-budget-usd` cap (Claude Code's list-price estimate). Default 1. */
  maxBudgetUsd?: number;
  /** Run timeout. Default 10 minutes. */
  timeoutMs?: number;
  /** Parent of the per-run scratch directory. Default: the OS temp dir. */
  scratchRoot?: string;
  /** Tools for a task that names none (`[]` = none). Default: WebSearch, WebFetch. */
  defaultTools?: readonly string[];
}

/** Default `--max-budget-usd` cap. */
export const DEFAULT_MAX_BUDGET_USD = 1;
/** Claude Code's stdin cap. */
const MAX_STDIN_BYTES = 10 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;
const KILL_GRACE_MS = 5_000;
const STDERR_TAIL = 500;
/** stderr kept in memory while the child runs; only the tail is reported. */
const STDERR_KEEP = 64 * 1024;
const INSTALL_HINT = "install Claude Code or set TIDEGAP_CLAUDE_BIN";
const LOGIN_HINT = "run `claude` once as this user and complete /login";

/** Model ids and aliases Claude Code accepts for `--model`. */
const PASS_THROUGH_MODEL = /^(claude-[a-z0-9.-]+|opus|sonnet|haiku|fable|opusplan)(\[1m\])?$/i;

/** The fields of `claude -p --output-format json` this adapter reads. */
interface ClaudeResult {
  is_error?: boolean;
  subtype?: string;
  result?: string | null;
  stop_reason?: string | null;
  terminal_reason?: string;
  api_error_status?: number | null;
  usage?: {
    input_tokens?: number;
    cache_creation_input_tokens?: number;
    output_tokens?: number;
  };
  modelUsage?: Record<string, { outputTokens?: number }>;
}

interface RunOutcome {
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

/** Prior turns as a labeled transcript before the prompt: `claude -p` takes one user turn. */
function stdinText(prompt: string, options: DispatchOptions): string {
  const prior = options.messages ?? [];
  if (prior.length === 0) return prompt;
  const turns = prior.map((m) => `[${m.role}]\n${m.content}`).join("\n\n");
  return `Earlier turns of this conversation, oldest first:\n\n${turns}\n\nCurrent message:\n\n${prompt}`;
}

/** The model Claude Code reports: the `modelUsage` entry with the most output tokens. */
function reportedModel(parsed: ClaudeResult, requested: string): string {
  let best: string | undefined;
  let bestOut = -1;
  for (const [id, u] of Object.entries(parsed.modelUsage ?? {})) {
    const out = u?.outputTokens ?? 0;
    if (out > bestOut) {
      best = id;
      bestOut = out;
    }
  }
  if (best) return best;
  return requested && requested !== "default" ? requested : "claude-code";
}

function failureMessage(parsed: ClaudeResult): string {
  const text =
    parsed.result ||
    [parsed.subtype, parsed.terminal_reason].filter(Boolean).join(", ") ||
    "unknown error";
  if (/not logged in|\/login/i.test(text)) return `claude-code: ${text}; ${LOGIN_HINT}`;
  const status = parsed.api_error_status ? ` (API status ${parsed.api_error_status})` : "";
  return `claude-code: ${text}${status}`;
}

export class ClaudeCodeAdapter implements ProviderAdapter {
  readonly provider = "claude-code";
  private readonly binaryPath: string | undefined;
  private readonly env: Record<string, string | undefined> | undefined;
  private readonly maxBudgetUsd: number;
  private readonly timeoutMs: number;
  private readonly scratchRoot: string;
  private readonly defaultTools: readonly string[];

  constructor(opts: ClaudeCodeAdapterOptions = {}) {
    this.binaryPath = opts.binaryPath;
    this.env = opts.env;
    this.maxBudgetUsd = opts.maxBudgetUsd ?? DEFAULT_MAX_BUDGET_USD;
    this.timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.scratchRoot = opts.scratchRoot ?? tmpdir();
    this.defaultTools = opts.defaultTools ?? DEFAULT_CLAUDE_CODE_TOOLS;
  }

  get ready(): boolean {
    return this.binaryPath !== undefined;
  }

  async dispatch(
    model: string,
    prompt: string,
    options: DispatchOptions = {},
  ): Promise<DispatchResult> {
    const binary = this.binaryPath;
    if (!binary) throw new Error(`claude-code: no claude binary found; ${INSTALL_HINT}`);
    // Checked again here, not only at enqueue: a hand-edited ledger row
    // must never hand `claude` a tool that runs commands or writes files.
    // Validated before the copy: a string or other non-array must be refused
    // as is, not spread into characters first.
    const requested: unknown = options.tools ?? this.defaultTools;
    const toolsError = claudeCodeToolsError(requested);
    if (toolsError) throw new Error(`claude-code: ${toolsError}`);
    const tools = [...(requested as readonly string[])];
    const toolList = tools.join(",");
    const input = stdinText(prompt, options);
    if (Buffer.byteLength(input) > MAX_STDIN_BYTES) {
      throw new Error("claude-code: prompt is larger than Claude Code's 10 MB stdin limit");
    }

    const dir = await mkdtemp(join(this.scratchRoot, "tidegap-claude-"));
    try {
      const args = [
        "-p",
        "--output-format", "json",
        // `--tools` limits the built-in set; `--allowedTools` pre-approves
        // the same names so dontAsk runs them. "" means no tools.
        "--tools", toolList,
        ...(tools.length > 0 ? ["--allowedTools", toolList] : []),
        "--permission-mode", "dontAsk",
        "--max-budget-usd", String(this.maxBudgetUsd),
        "--safe-mode",
        "--strict-mcp-config",
        "--no-session-persistence",
      ];
      if (PASS_THROUGH_MODEL.test(model)) args.push("--model", model);
      if (options.system) {
        const file = join(dir, "system-prompt.txt");
        await writeFile(file, options.system, "utf8");
        args.push("--system-prompt-file", file);
      }
      const run = await this.run(binary, args, dir, input);
      return { ...this.toResult(run, model), tools };
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }

  private run(binary: string, args: string[], cwd: string, input: string): Promise<RunOutcome> {
    return new Promise((resolve, reject) => {
      const child = spawn(binary, args, {
        cwd,
        ...(this.env ? { env: this.env } : {}),
        stdio: ["pipe", "pipe", "pipe"],
        // Own process group: the timeout signals the group, not just `claude`.
        detached: true,
      });
      const killGroup = (signal: NodeJS.Signals) => {
        try {
          if (child.pid !== undefined) process.kill(-child.pid, signal);
        } catch {
          child.kill(signal);
        }
      };
      let stdout = "";
      let stderr = "";
      let timedOut = false;
      let killTimer: NodeJS.Timeout | undefined;
      const timer = setTimeout(() => {
        timedOut = true;
        killGroup("SIGTERM");
        killTimer = setTimeout(() => killGroup("SIGKILL"), KILL_GRACE_MS);
      }, this.timeoutMs);
      const stop = () => {
        clearTimeout(timer);
        if (killTimer) clearTimeout(killTimer);
      };
      child.stdout.setEncoding("utf8").on("data", (d: string) => (stdout += d));
      child.stderr.setEncoding("utf8").on("data", (d: string) => {
        stderr = (stderr + d).slice(-STDERR_KEEP);
      });
      child.on("error", (err: NodeJS.ErrnoException) => {
        stop();
        reject(new Error(`claude-code: cannot run ${binary} (${err.code ?? err.message}); ${INSTALL_HINT}`));
      });
      child.on("close", (code) => {
        stop();
        resolve({ code, stdout, stderr, timedOut });
      });
      // A binary that exits before reading stdin closes the pipe (EPIPE);
      // the exit status reports what went wrong.
      child.stdin.on("error", () => {});
      child.stdin.end(input);
    });
  }

  private toResult(run: RunOutcome, requested: string): DispatchResult {
    if (run.timedOut) {
      throw new Error(`claude-code: timed out after ${this.timeoutMs / 1000}s`);
    }
    let parsed: ClaudeResult | undefined;
    try {
      const value: unknown = JSON.parse(run.stdout);
      if (value && typeof value === "object" && !Array.isArray(value)) parsed = value as ClaudeResult;
    } catch {
      // handled below
    }
    if (!parsed) {
      const tail = run.stderr.trim().slice(-STDERR_TAIL);
      throw new Error(
        `claude-code: exit ${run.code ?? "unknown"} without a JSON result` + (tail ? `: ${tail}` : ""),
      );
    }
    if (parsed.is_error === true || parsed.subtype?.startsWith("error")) {
      throw new Error(failureMessage(parsed));
    }
    const model = reportedModel(parsed, requested);
    if (parsed.stop_reason === "refusal") {
      throw new ProviderRefusalError(this.provider, model, null);
    }
    const u = parsed.usage ?? {};
    const inputTokens =
      u.input_tokens !== undefined || u.cache_creation_input_tokens !== undefined
        ? (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0)
        : undefined;
    const outputTokens = u.output_tokens;
    return {
      text: parsed.result ?? "",
      usage: {
        inputTokens,
        outputTokens,
        totalTokens:
          inputTokens !== undefined && outputTokens !== undefined
            ? inputTokens + outputTokens
            : undefined,
      },
      model,
      provider: this.provider,
      raw: parsed,
      ...(parsed.stop_reason ? { stopReason: parsed.stop_reason } : {}),
    };
  }

  // No dispatchBatch / retrieveBatch: Claude Code has no batch path.
}
