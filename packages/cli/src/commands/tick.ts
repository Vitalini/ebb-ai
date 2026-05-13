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
  OpenAIAdapter,
  Scheduler,
  type ProviderAdapter,
} from "@ebb-ai/core";
import { homedir } from "node:os";
import { join } from "node:path";

export interface TickCommandOptions {
  db?: string;
  daemon?: boolean;
  once?: boolean;
  interval?: number;
  region?: string;
}

export interface TickRunResult {
  exitCode: number;
  message: string;
}

export function defaultDbPath(): string {
  return join(homedir(), ".ebb", "queue.sqlite");
}

function buildAdapters(): {
  anthropic?: ProviderAdapter;
  openai?: ProviderAdapter;
} {
  const out: { anthropic?: ProviderAdapter; openai?: ProviderAdapter } = {};
  if (process.env.ANTHROPIC_API_KEY) {
    out.anthropic = new AnthropicAdapter();
  }
  if (process.env.OPENAI_API_KEY) {
    out.openai = new OpenAIAdapter();
  }
  return out;
}

export async function runTickOnce(
  opts: TickCommandOptions = {},
): Promise<TickRunResult> {
  const adapters = buildAdapters();
  if (!adapters.anthropic && !adapters.openai) {
    return {
      exitCode: 0,
      message:
        "tick: no provider keys (ANTHROPIC_API_KEY / OPENAI_API_KEY); nothing to dispatch",
    };
  }
  const dbPath = opts.db ?? defaultDbPath();
  const scheduler = new Scheduler({ dbPath, defaultRegion: opts.region });
  try {
    const result = await scheduler.tick(adapters);
    const msg = `tick: ${result.inspected} inspected, ${result.dispatched} dispatched, ${result.failed} failed`;
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
