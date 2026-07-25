/**
 * `ebb tick` — drain due provider-call tasks.
 *
 * One-shot by default; `--daemon` loops on the supplied interval until
 * SIGINT. Reads API keys from the environment and constructs the
 * matching adapters lazily. If neither key is set we still exit 0 with
 * a warning — useful for "this cron only kicks in once a key is added".
 */

import {
  AnthropicAdapter,
  GeminiAdapter,
  loadCarbonBudgetConfig,
  OllamaAdapter,
  OpenAIAdapter,
  resolveRegion,
  Scheduler,
  TaskStore,
  type CarbonAlert,
  type TickAdapters,
} from "@ebb-ai/core";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { readEnvCredentials, type ProviderCredentials } from "../env.js";
import { loadEnvFileIntoProcess } from "./env-file.js";

export interface TickCommandOptions {
  db?: string;
  daemon?: boolean;
  once?: boolean;
  interval?: number;
  region?: string;
  /** Override the secrets file path (tests). Defaults to ~/.config/ebb/env. */
  envFile?: string;
  /** Override the carbon-budget config path (tests). Defaults to ~/.ebb-ai/config. */
  budgetConfig?: string;
}

export interface TickRunResult {
  exitCode: number;
  message: string;
}

/**
 * Default queue path. Matches the MCP server's persistence default
 * (`~/.ebb-ai/queue.db`, established in v0.7.1) so `ebb tick`,
 * `ebb queue list`, `ebb receipts list`, and `ebb stats` all read
 * the same SQLite ledger the MCP server writes to. Prior versions
 * defaulted to `~/.ebb/queue.sqlite`, which silently diverged from
 * the MCP server's actual path — fixed in v0.8.x.
 *
 * If the legacy `~/.ebb/queue.sqlite` exists and the new path
 * doesn't, the legacy path is returned so users who pre-date v0.7.1
 * keep seeing their historical data. Once they begin writing to
 * the new path (via the MCP server), pass `--db` explicitly to
 * read the old one.
 */
export function defaultDbPath(): string {
  const newPath = join(homedir(), ".ebb-ai", "queue.db");
  const legacyPath = join(homedir(), ".ebb", "queue.sqlite");
  if (!existsSync(newPath) && existsSync(legacyPath)) return legacyPath;
  return newPath;
}

/**
 * Build the tick adapters from host-supplied credentials.
 *
 * `@ebb-ai/core` no longer reads the environment, so the CLI (the host)
 * reads it once via `readEnvCredentials()` and injects the values here. The
 * registration rules are unchanged: an adapter appears exactly when its
 * credential is present, Gemini prefers GEMINI_API_KEY over GOOGLE_API_KEY,
 * and Ollama is an explicit OLLAMA_HOST opt-in.
 */
export function buildAdapters(
  creds: ProviderCredentials = readEnvCredentials(),
): TickAdapters {
  const out: TickAdapters = {};
  if (creds.anthropicApiKey) {
    out.anthropic = new AnthropicAdapter({ apiKey: creds.anthropicApiKey });
  }
  if (creds.openaiApiKey) {
    out.openai = new OpenAIAdapter({ apiKey: creds.openaiApiKey });
  }
  // Gemini reads GEMINI_API_KEY, falling back to GOOGLE_API_KEY (resolved in
  // readEnvCredentials, so `geminiApiKey` here is already the winner).
  if (creds.geminiApiKey) {
    out.gemini = new GeminiAdapter({ apiKey: creds.geminiApiKey });
  }
  // Ollama is local + keyless: register it only when OLLAMA_HOST is set
  // (explicit opt-in). The adapter defaults to http://localhost:11434.
  if (creds.ollamaHost) {
    out.ollama = new OllamaAdapter({ host: creds.ollamaHost });
  }
  return out;
}

/**
 * Provider key expected in the env for a given provider name. Ollama has no
 * key (it is local + keyless), so it is intentionally absent — a pending
 * Ollama task is never reported as "missing a key".
 */
const PROVIDER_KEY: Record<string, string> = {
  anthropic: "ANTHROPIC_API_KEY",
  openai: "OPENAI_API_KEY",
  gemini: "GEMINI_API_KEY",
};

/**
 * Inspect the ledger for pending provider-call tasks whose provider key
 * is missing from the environment. Returns the distinct missing keys.
 * Best-effort — never throws (a broken/absent DB just yields []).
 */
export function missingProviderKeysForPending(dbPath: string): string[] {
  const missing = new Set<string>();
  let store: TaskStore | undefined;
  try {
    store = new TaskStore({ dbPath });
    const pending = [
      ...store.list({ status: "queued" }),
      ...store.list({ status: "scheduled" }),
      ...store.list({ status: "submitted" }),
    ];
    for (const rec of pending) {
      if (!rec.bodyJson) continue;
      let provider: string | undefined;
      try {
        provider = (JSON.parse(rec.bodyJson) as { provider?: string })
          .provider;
      } catch {
        continue;
      }
      const key = provider ? PROVIDER_KEY[provider] : undefined;
      if (key && !process.env[key]) missing.add(key);
    }
  } catch {
    // absent / unreadable DB — nothing to warn about.
  } finally {
    store?.close();
  }
  return [...missing];
}

export async function runTickOnce(
  opts: TickCommandOptions = {},
): Promise<TickRunResult> {
  // Load the standardized secrets file into the environment for any key
  // not already set — covers launchd (bare env), systemd, and manual
  // cron uniformly. Explicit env always wins.
  loadEnvFileIntoProcess(opts.envFile);

  // The CLI is the HOST: it reads its environment here, once (after the
  // secrets file has been folded in), and injects the values into the
  // environment-pure core library.
  const env = readEnvCredentials();
  const dbPath = opts.db ?? defaultDbPath();
  const adapters = buildAdapters(env);
  if (Object.keys(adapters).length === 0) {
    // Loud warning when pending provider tasks exist but no adapter is
    // configured (no ANTHROPIC_API_KEY / OPENAI_API_KEY / GEMINI_API_KEY /
    // OLLAMA_HOST).
    const missing = missingProviderKeysForPending(dbPath);
    const detail =
      missing.length > 0
        ? `; pending tasks need ${missing.join(" / ")} — set them in ~/.config/ebb/env`
        : "";
    return {
      exitCode: 0,
      message:
        `tick: no adapters configured (set ANTHROPIC_API_KEY / OPENAI_API_KEY / GEMINI_API_KEY, or OLLAMA_HOST for local); nothing to dispatch${detail}`,
    };
  }
  // Even with some keys present, warn about pending tasks needing a key
  // we do not have (e.g. OpenAI tasks queued but only ANTHROPIC set).
  const missingForPending = missingProviderKeysForPending(dbPath);
  // Aggregate carbon-budget alerts (ROADMAP item 4): read the local budget
  // config (env wins over ~/.ebb-ai/config) and log any crossing prominently.
  // Core no longer reads the environment, so the two EBB_CARBON_BUDGET_*
  // variables are read here and passed in — same precedence as before.
  const carbonBudget = loadCarbonBudgetConfig({
    path: opts.budgetConfig,
    env: env.carbonBudget,
  });
  const firedAlerts: CarbonAlert[] = [];
  const scheduler = new Scheduler({
    dbPath,
    defaultRegion: resolveRegion(undefined, opts.region).region,
    ...(carbonBudget
      ? {
          carbonBudget,
          onCarbonAlert: (a: CarbonAlert) => {
            firedAlerts.push(a);
          },
        }
      : {}),
  });
  try {
    const result = await scheduler.tick(adapters);
    let msg = `tick: ${result.inspected} inspected, ${result.dispatched} dispatched, ${result.failed} failed`;
    for (const a of firedAlerts) {
      msg +=
        `\n!! CARBON BUDGET ALERT: ${a.windowKind} carbon budget crossed — ` +
        `${a.actualG} gCO2e used this window vs ${a.thresholdG} g threshold ` +
        `(crossed by task ${a.taskIdThatCrossed}). ` +
        `Window started ${a.windowStart}.`;
    }
    if (missingForPending.length > 0) {
      msg +=
        `\n!! WARNING: pending tasks need ${missingForPending.join(" / ")} ` +
        `but that key is not set — those tasks cannot dispatch. ` +
        `Add it to ~/.config/ebb/env.`;
    }
    return { exitCode: result.failed > 0 ? 1 : 0, message: msg };
  } finally {
    scheduler.shutdown();
  }
}

export async function runTick(opts: TickCommandOptions = {}): Promise<number> {
  if (opts.daemon) {
    const interval = Math.max(1, opts.interval ?? 60);
    // eslint-disable-next-line no-console
    console.log(`[ebb] tick daemon: every ${interval}s, db=${opts.db ?? defaultDbPath()}`);
    let stopped = false;
    const onSignal = () => {
      stopped = true;
    };
    process.on("SIGINT", onSignal);
    process.on("SIGTERM", onSignal);
    while (!stopped) {
      const result = await runTickOnce(opts);
      // eslint-disable-next-line no-console
      console.log(result.message);
      await new Promise((r) => setTimeout(r, interval * 1000));
    }
    return 0;
  }
  const result = await runTickOnce(opts);
  // eslint-disable-next-line no-console
  console.log(result.message);
  return result.exitCode;
}
