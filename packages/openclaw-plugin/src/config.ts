/**
 * The plugin's ONLY configuration surface.
 *
 * ── Why this file exists ────────────────────────────────────────────────────
 * The published `@vitalini/ebb` bundle must contain **zero** environment-variable
 * reads. ClawHub's ClawScan flags `suspicious.env_credential_access` on any
 * ambient-environment read inside a bundle that also makes network calls — even
 * a non-secret numeric threshold — so "read it narrowly, by name" is not enough;
 * the reads have to be gone entirely.
 *
 * They are. Everything the plugin used to take from the environment now arrives
 * as OpenClaw plugin config: the object declared by `openclaw.plugin.json`'s
 * `configSchema`, stored at `plugins.entries.ebb.config` in the gateway config,
 * and handed to every tool as the second argument of `execute(params, config,
 * context)`. `@ebb-ai/core` is likewise environment-pure, so nothing downstream
 * reaches for the environment either.
 *
 * ── Migrating from the old environment variables ────────────────────────────
 * Each field below names the variable it replaces. OpenClaw resolves the
 * `${ENV_VAR}` / `$ENV_VAR` SecretRef shorthand on the credential fields (they
 * are declared in the manifest's `configContracts.secretInputs.paths`), so a
 * user who already exports the old variables can keep doing exactly that:
 *
 *   "plugins": { "entries": { "ebb": { "config": {
 *       "anthropicApiKey": "${ANTHROPIC_API_KEY}",
 *       "eiaApiKey":       "${EBB_EIA_API_KEY}"
 *   } } } }
 *
 * The gateway reads the environment; the plugin never does.
 *
 * Environment variables still configure the `ebb` CLI and the `@ebb-ai/mcp`
 * server — those are separate hosts with their own entry points, and their
 * behaviour is unchanged.
 */

import { Type } from "typebox";

import type { CarbonBudgetEnv, GridFeedCredentials } from "@ebb-ai/core";

/** The plugin id — also the key under `plugins.entries` in the gateway config. */
export const PLUGIN_ID = "ebb";

/**
 * Everything the plugin can be configured with. Mirrors the `configSchema`
 * below one-for-one (and therefore `openclaw.plugin.json`).
 */
export type PluginConfig = {
  /** Override the SQLite queue path. Was: none (always ~/.ebb-ai/queue.db). */
  dbPath?: string;
  /** Default grid region. Was: `EBB_DEFAULT_REGION` on the CLI/MCP hosts. */
  defaultRegion?: string;

  // ── Grid-feed credentials ────────────────────────────────────────────────
  /** Was `EBB_ELECTRICITY_MAPS_API_KEY`. */
  electricityMapsApiKey?: string;
  /** Was `EBB_EIA_API_KEY`. */
  eiaApiKey?: string;
  /** Was `EBB_ENTSOE_SECURITY_TOKEN`. */
  entsoeSecurityToken?: string;
  /** Was `WATTTIME_USERNAME`. */
  wattTimeUsername?: string;
  /** Was `WATTTIME_PASSWORD`. */
  wattTimePassword?: string;

  // ── Provider credentials ─────────────────────────────────────────────────
  /** Was `ANTHROPIC_API_KEY`. */
  anthropicApiKey?: string;
  /** Was `OPENAI_API_KEY`. */
  openaiApiKey?: string;
  /** Was `GEMINI_API_KEY`. */
  geminiApiKey?: string;
  /** Was `GOOGLE_API_KEY` (fallback for `geminiApiKey`). */
  googleApiKey?: string;
  /** Was `OLLAMA_HOST`. */
  ollamaHost?: string;
  /** Was `OLLAMA_MODELS` (comma-separated model allow-list). */
  ollamaModels?: string;

  // ── Aggregate carbon budget ──────────────────────────────────────────────
  /** Was `EBB_CARBON_BUDGET_G`. */
  carbonBudgetG?: number;
  /** Was `EBB_CARBON_BUDGET_WINDOW`. */
  carbonBudgetWindow?: "daily" | "weekly" | "monthly";

  // ── Delivery + lifecycle ─────────────────────────────────────────────────
  /** Was `EBB_DELIVERY_FILE`. */
  deliveryStorePath?: string;
  /** Was `EBB_DISABLE_STARTUP_DISPATCH=1`. */
  disableStartupDispatch?: boolean;
};

/**
 * The TypeBox schema handed to `defineToolPlugin`. `openclaw plugins build`
 * exports this to the JSON Schema in `openclaw.plugin.json`, so the two are
 * kept in lockstep by construction — edit here, not there.
 *
 * Every credential description names the environment variable it replaces so
 * the migration is discoverable straight from the gateway UI.
 */
export const pluginConfigSchema = Type.Object(
  {
    dbPath: Type.Optional(
      Type.String({
        description:
          "Override the SQLite queue path. Defaults to ~/.ebb-ai/queue.db (shared with the @ebb-ai/mcp server and @ebb-ai/cli).",
      }),
    ),
    defaultRegion: Type.Optional(
      Type.String({
        description:
          "Default electricity-grid region when a tool call omits one. Examples: GB, US-CAL-CISO, US-TEX-ERCO, US-NE-ISNE, US-MIDA-PJM, FR, DE. When unset, ebb-ai guesses from the host machine's timezone (London→GB, Paris→FR, Berlin→DE, US Pacific→US-CAL-CISO, US Eastern→US-MIDA-PJM) and otherwise falls back to GB. Set this explicitly for precise control. (Replaces the EBB_DEFAULT_REGION environment variable, which still configures the ebb CLI and @ebb-ai/mcp server.)",
      }),
    ),

    electricityMapsApiKey: Type.Optional(
      Type.String({
        description:
          "Electricity Maps free-tier API key, used for every grid zone without a more specific feed. Replaces the EBB_ELECTRICITY_MAPS_API_KEY environment variable — the plugin reads no environment variables. Accepts the ${EBB_ELECTRICITY_MAPS_API_KEY} secret shorthand. Unset ⇒ those zones fall back to synthetic (mock) grid data.",
      }),
    ),
    eiaApiKey: Type.Optional(
      Type.String({
        description:
          "US EIA v2 Open Data API key, used for the major US ISO/RTO zones. Replaces the EBB_EIA_API_KEY environment variable. Accepts the ${EBB_EIA_API_KEY} secret shorthand. Unset ⇒ US zones fall back to synthetic (mock) grid data.",
      }),
    ),
    entsoeSecurityToken: Type.Optional(
      Type.String({
        description:
          "ENTSO-E Transparency Platform security token, used for the EU bidding zones (FR, DE, ES, IT, NL). Replaces the EBB_ENTSOE_SECURITY_TOKEN environment variable. Accepts the ${EBB_ENTSOE_SECURITY_TOKEN} secret shorthand. Unset ⇒ EU zones fall back to synthetic (mock) grid data.",
      }),
    ),
    wattTimeUsername: Type.Optional(
      Type.String({
        description:
          "WattTime account username. With wattTimePassword, enables WattTime marginal (MOER) forecasts for the US ISO/RTO zones, taking precedence over the EIA feed. Replaces the WATTTIME_USERNAME environment variable. Accepts the ${WATTTIME_USERNAME} secret shorthand.",
      }),
    ),
    wattTimePassword: Type.Optional(
      Type.String({
        description:
          "WattTime account password. Required together with wattTimeUsername. Replaces the WATTTIME_PASSWORD environment variable. Accepts the ${WATTTIME_PASSWORD} secret shorthand.",
      }),
    ),

    anthropicApiKey: Type.Optional(
      Type.String({
        description:
          "Anthropic API key for dispatching scheduled tasks directly. Replaces the ANTHROPIC_API_KEY environment variable. Accepts the ${ANTHROPIC_API_KEY} secret shorthand. Usually unnecessary: when a tool call has captured the OpenClaw runtime LLM bridge, tasks dispatch through the gateway's own model with no key at all.",
      }),
    ),
    openaiApiKey: Type.Optional(
      Type.String({
        description:
          "OpenAI API key for dispatching scheduled tasks directly. Replaces the OPENAI_API_KEY environment variable. Accepts the ${OPENAI_API_KEY} secret shorthand. Usually unnecessary — see anthropicApiKey.",
      }),
    ),
    geminiApiKey: Type.Optional(
      Type.String({
        description:
          "Google Gemini API key. Gemini is not a gateway-bridge provider, so this (or googleApiKey) is the only way to dispatch gemini-* tasks. Replaces the GEMINI_API_KEY environment variable. Accepts the ${GEMINI_API_KEY} secret shorthand.",
      }),
    ),
    googleApiKey: Type.Optional(
      Type.String({
        description:
          "Fallback Google API key, used for Gemini when geminiApiKey is unset. Replaces the GOOGLE_API_KEY environment variable. Accepts the ${GOOGLE_API_KEY} secret shorthand.",
      }),
    ),
    ollamaHost: Type.Optional(
      Type.String({
        description:
          "Base URL of a local Ollama server, e.g. http://localhost:11434. Setting it is the explicit opt-in that registers the (keyless) Ollama adapter. Replaces the OLLAMA_HOST environment variable.",
      }),
    ),
    ollamaModels: Type.Optional(
      Type.String({
        description:
          "Comma-separated Ollama model ids (e.g. \"llama3.1,mistral\") that should infer to the ollama provider when a task names them without an explicit provider. Replaces the OLLAMA_MODELS environment variable.",
      }),
    ),

    carbonBudgetG: Type.Optional(
      Type.Number({
        description:
          "Aggregate carbon budget in grams CO2e. Crossing it fires a one-shot alert through the configured delivery channel. Replaces the EBB_CARBON_BUDGET_G environment variable. Takes precedence over the same key in the ~/.ebb-ai/config file, which is still read.",
        exclusiveMinimum: 0,
      }),
    ),
    carbonBudgetWindow: Type.Optional(
      Type.Union(
        [Type.Literal("daily"), Type.Literal("weekly"), Type.Literal("monthly")],
        {
          description:
            "Rolling window the carbon budget is scoped to. Defaults to daily. Replaces the EBB_CARBON_BUDGET_WINDOW environment variable.",
        },
      ),
    ),

    deliveryStorePath: Type.Optional(
      Type.String({
        description:
          "Override the SQLite file holding per-task delivery preferences and outcomes. Defaults to ~/.ebb-ai/delivery.db. Replaces the EBB_DELIVERY_FILE environment variable.",
      }),
    ),
    disableStartupDispatch: Type.Optional(
      Type.Boolean({
        description:
          "Disable the background dispatch loop that drains due tasks every 60s. Replaces EBB_DISABLE_STARTUP_DISPATCH=1. Only for embedding contexts that drive dispatch by hand — with this on, scheduled tasks never run until a tool call triggers them.",
      }),
    ),
  },
  { additionalProperties: false },
);

/**
 * Merge a lower-priority config (e.g. the block read out of the captured
 * gateway config) with a higher-priority one (the `config` argument OpenClaw
 * hands to `execute`). Keys explicitly set to `undefined` never win.
 */
export function mergeConfig(
  base: PluginConfig | undefined,
  override: PluginConfig | undefined,
): PluginConfig {
  const out: Record<string, unknown> = { ...(base ?? {}) };
  for (const [k, v] of Object.entries(override ?? {})) {
    if (v !== undefined) out[k] = v;
  }
  return out as PluginConfig;
}

/**
 * Dig this plugin's own settings out of a captured OpenClaw gateway config
 * (`api.config`), which nests them at `plugins.entries.ebb.config`.
 *
 * `defineToolPlugin` exposes no init/activate hook, so at gateway boot the
 * plugin has no config at all — the background dispatcher and the startup
 * bootstrap run before any `execute(params, config, …)` call. The first tool
 * call captures `api.config`; from then on this recovers the same settings for
 * those config-less code paths. Returns `undefined` when nothing is captured
 * yet or the shape does not match, so callers can fall back cleanly.
 */
export function pluginConfigFromGatewayConfig(
  captured: unknown,
): PluginConfig | undefined {
  if (!captured || typeof captured !== "object") return undefined;
  const plugins = (captured as { plugins?: unknown }).plugins;
  if (!plugins || typeof plugins !== "object") return undefined;
  const entries = (plugins as { entries?: unknown }).entries;
  if (!entries || typeof entries !== "object") return undefined;
  const entry = (entries as Record<string, unknown>)[PLUGIN_ID];
  if (!entry || typeof entry !== "object") return undefined;
  const config = (entry as { config?: unknown }).config;
  if (!config || typeof config !== "object" || Array.isArray(config)) {
    return undefined;
  }
  return config as PluginConfig;
}

/** Grid-feed credentials for `@ebb-ai/core`'s `buildDefaultGridFeed`. */
export function gridCredentials(config: PluginConfig): GridFeedCredentials {
  return {
    electricityMapsApiKey: trimmed(config.electricityMapsApiKey),
    eiaApiKey: trimmed(config.eiaApiKey),
    entsoeSecurityToken: trimmed(config.entsoeSecurityToken),
    wattTimeUsername: trimmed(config.wattTimeUsername),
    wattTimePassword: trimmed(config.wattTimePassword),
  };
}

/**
 * Carbon-budget overrides for `@ebb-ai/core`'s `loadCarbonBudgetConfig`, whose
 * option shape is still keyed by the historical variable NAMES (the CLI and
 * MCP server pass the real environment values there). Passing `{}` — the
 * "nothing configured" case — leaves `~/.ebb-ai/config` in sole charge, which
 * is exactly the old behaviour with no variables exported.
 */
export function carbonBudgetOverrides(config: PluginConfig): CarbonBudgetEnv {
  const out: CarbonBudgetEnv = {};
  if (typeof config.carbonBudgetG === "number" && Number.isFinite(config.carbonBudgetG)) {
    out.EBB_CARBON_BUDGET_G = String(config.carbonBudgetG);
  }
  if (config.carbonBudgetWindow) {
    out.EBB_CARBON_BUDGET_WINDOW = config.carbonBudgetWindow;
  }
  return out;
}

function trimmed(v: string | undefined): string | undefined {
  const s = v?.trim();
  return s ? s : undefined;
}
