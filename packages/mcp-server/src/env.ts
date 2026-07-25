/**
 * The `@ebb-ai/mcp` server's environment boundary.
 *
 * `@ebb-ai/core` is an environment-pure library: it reads no environment
 * variables and takes every credential as an explicit argument. The MCP server
 * is a HOST, so reading the environment is its job — and this module is the
 * single place it happens. Every variable is read BY NAME into a closed shape;
 * the whole process environment object is never bound to a local or handed to
 * core.
 *
 * Behaviour is unchanged from before core became environment-pure: the same
 * variables, the same precedence (GEMINI_API_KEY before GOOGLE_API_KEY).
 *
 * See also: `packages/cli/src/env.ts` (the CLI's copy of this boundary) and
 * `packages/openclaw-plugin` — which has NO environment boundary at all,
 * taking everything from OpenClaw plugin config so its published bundle
 * contains zero environment reads.
 */

import type { CarbonBudgetEnv, GridFeedCredentials } from "@ebb-ai/core";

/** Provider credentials the MCP server forwards to `@ebb-ai/core`'s adapters. */
export interface ProviderCredentials {
  /** `ANTHROPIC_API_KEY` */
  anthropicApiKey?: string;
  /** `OPENAI_API_KEY` */
  openaiApiKey?: string;
  /** `GEMINI_API_KEY`, else `GOOGLE_API_KEY` */
  geminiApiKey?: string;
  /** `OLLAMA_HOST` (opt-in: unset means "do not register the Ollama adapter") */
  ollamaHost?: string;
}

export interface EnvCredentials extends ProviderCredentials {
  /** Grid-feed credentials for `buildDefaultGridFeed`. */
  grid: GridFeedCredentials;
  /** Aggregate carbon-budget overrides for `loadCarbonBudgetConfig`. */
  carbonBudget: CarbonBudgetEnv;
}

/** Trim and collapse an empty string to `undefined`. */
function val(raw: string | undefined): string | undefined {
  const v = raw?.trim();
  return v ? v : undefined;
}

/**
 * Snapshot every environment variable the MCP server recognizes, by name.
 * Call this at an entry point and pass the result down — never re-read the
 * environment deeper in the call tree.
 */
export function readEnvCredentials(): EnvCredentials {
  return {
    anthropicApiKey: val(process.env.ANTHROPIC_API_KEY),
    openaiApiKey: val(process.env.OPENAI_API_KEY),
    geminiApiKey: val(process.env.GEMINI_API_KEY) ?? val(process.env.GOOGLE_API_KEY),
    ollamaHost: val(process.env.OLLAMA_HOST),
    grid: {
      electricityMapsApiKey: val(process.env.EBB_ELECTRICITY_MAPS_API_KEY),
      eiaApiKey: val(process.env.EBB_EIA_API_KEY),
      entsoeSecurityToken: val(process.env.EBB_ENTSOE_SECURITY_TOKEN),
      wattTimeUsername: val(process.env.WATTTIME_USERNAME),
      wattTimePassword: val(process.env.WATTTIME_PASSWORD),
    },
    carbonBudget: {
      EBB_CARBON_BUDGET_G: process.env.EBB_CARBON_BUDGET_G,
      EBB_CARBON_BUDGET_WINDOW: process.env.EBB_CARBON_BUDGET_WINDOW,
    },
  };
}
