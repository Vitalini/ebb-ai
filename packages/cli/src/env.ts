/**
 * The `tidegap` CLI's environment boundary.
 *
 * `@tidegap/core` is an environment-pure library: it reads no environment
 * variables and takes every credential as an explicit argument. The CLI is a
 * HOST, so reading the environment is its job — and this module is the single
 * place it happens. Every variable is read BY NAME into a closed shape; the
 * whole `process` environment object is never bound to a local or handed to
 * core.
 *
 * Behaviour is unchanged from before core became environment-pure: the same
 * variables, the same precedence (GEMINI_API_KEY before GOOGLE_API_KEY).
 *
 * Since 0.18 the Tidegap variables are named `TIDEGAP_*`. Each 0.17 `EBB_*`
 * twin is still read when the `TIDEGAP_*` one is unset, and the process
 * prints one deprecation line to stderr naming the variables it fell back on.
 * The fallback is removed in 0.19.
 *
 * See also: `packages/mcp-server/src/env.ts` (the MCP server's copy of this
 * boundary) and `packages/openclaw-plugin` — which has NO environment
 * boundary at all, taking everything from OpenClaw plugin config so its
 * published bundle contains zero environment reads.
 */

import type { CarbonBudgetEnv, GridFeedCredentials } from "@tidegap/core";

/** Provider credentials the CLI forwards to `@tidegap/core`'s adapters. */
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
  /** `TIDEGAP_BINARY`: launcher override for `tidegap install`. */
  binary?: string;
  /** `TIDEGAP_NO_NOTIFY=1` (or true/yes/on): `tidegap tick` posts no OS notification. */
  noNotify: boolean;
  /** `TIDEGAP_DEFAULT_MODEL`: Anthropic model for tasks queued without one (`tidegap ui` quick add). */
  defaultModel?: string;
}

/** Trim and collapse an empty string to `undefined`. */
function val(raw: string | undefined): string | undefined {
  const v = raw?.trim();
  return v ? v : undefined;
}

/** Receives the one deprecation line about `EBB_*` fallbacks. */
export type DeprecationWriter = (line: string) => void;

let fallbackReported = false;

/** Default writer: stderr, once per process. */
const writeOnce: DeprecationWriter = (line) => {
  if (fallbackReported) return;
  fallbackReported = true;
  process.stderr.write(`${line}\n`);
};

/**
 * Collects the 0.17 names a read fell back on. `pick(current, legacy, name)`
 * returns the `TIDEGAP_<name>` value, else the `EBB_<name>` value (recording
 * `EBB_<name>`), else `undefined`.
 */
class Fallbacks {
  readonly used: string[] = [];
  pick(current: string | undefined, legacy: string | undefined, name: string): string | undefined {
    if (current !== undefined && current.trim() !== "") return current;
    if (legacy !== undefined && legacy.trim() !== "") {
      this.used.push(`EBB_${name}`);
      return legacy;
    }
    return current;
  }
  report(write: DeprecationWriter): void {
    if (this.used.length === 0) return;
    const renamed = this.used.map((n) => `${n} -> TIDEGAP_${n.slice(4)}`).join(", ");
    write(`tidegap: rename ${renamed}; the EBB_* names stop working in 0.19.`);
  }
}

/**
 * Snapshot every environment variable the CLI recognizes, by name.
 * Call this at an entry point and pass the result down — never re-read the
 * environment deeper in the call tree. A fallback to an `EBB_*` name goes to
 * `write` (default: one stderr line per process).
 */
export function readEnvCredentials(write: DeprecationWriter = writeOnce): EnvCredentials {
  const f = new Fallbacks();
  const out: EnvCredentials = {
    anthropicApiKey: val(process.env.ANTHROPIC_API_KEY),
    openaiApiKey: val(process.env.OPENAI_API_KEY),
    geminiApiKey: val(process.env.GEMINI_API_KEY) ?? val(process.env.GOOGLE_API_KEY),
    ollamaHost: val(process.env.OLLAMA_HOST),
    grid: {
      electricityMapsApiKey: val(
        f.pick(process.env.TIDEGAP_ELECTRICITY_MAPS_API_KEY, process.env.EBB_ELECTRICITY_MAPS_API_KEY, "ELECTRICITY_MAPS_API_KEY"),
      ),
      eiaApiKey: val(f.pick(process.env.TIDEGAP_EIA_API_KEY, process.env.EBB_EIA_API_KEY, "EIA_API_KEY")),
      entsoeSecurityToken: val(
        f.pick(process.env.TIDEGAP_ENTSOE_SECURITY_TOKEN, process.env.EBB_ENTSOE_SECURITY_TOKEN, "ENTSOE_SECURITY_TOKEN"),
      ),
      wattTimeUsername: val(process.env.WATTTIME_USERNAME),
      wattTimePassword: val(process.env.WATTTIME_PASSWORD),
    },
    carbonBudget: {
      TIDEGAP_CARBON_BUDGET_G: f.pick(process.env.TIDEGAP_CARBON_BUDGET_G, process.env.EBB_CARBON_BUDGET_G, "CARBON_BUDGET_G"),
      TIDEGAP_CARBON_BUDGET_WINDOW: f.pick(
        process.env.TIDEGAP_CARBON_BUDGET_WINDOW,
        process.env.EBB_CARBON_BUDGET_WINDOW,
        "CARBON_BUDGET_WINDOW",
      ),
    },
    binary: val(f.pick(process.env.TIDEGAP_BINARY, process.env.EBB_BINARY, "BINARY")),
    noNotify: /^(1|true|yes|on)$/i.test(
      val(f.pick(process.env.TIDEGAP_NO_NOTIFY, process.env.EBB_NO_NOTIFY, "NO_NOTIFY")) ?? "",
    ),
    defaultModel: val(f.pick(process.env.TIDEGAP_DEFAULT_MODEL, process.env.EBB_DEFAULT_MODEL, "DEFAULT_MODEL")),
  };
  f.report(write);
  return out;
}
