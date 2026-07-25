/**
 * The OpenClaw plugin takes ALL configuration from OpenClaw plugin config and
 * reads ZERO environment variables.
 *
 * Motivation: ClawHub's ClawScan raises `suspicious.env_credential_access`
 * (severity: critical) on any ambient-environment read inside a bundle that
 * also makes network calls — even a non-secret numeric threshold. So the reads
 * had to go entirely, not merely be narrowed.
 *
 * These tests pin down the replacement contract:
 *   - no source file under src/ reads the ambient environment;
 *   - the built bundle contains zero such reads (the ClawScan acceptance test);
 *   - adapters, the grid feed and the carbon budget are all derived from
 *     `PluginConfig`;
 *   - this plugin's block is recoverable from the captured gateway config, for
 *     the code paths (startup bootstrap, background sweep) that get no
 *     `execute(params, config, …)` argument;
 *   - the manifest's declared config surface matches the TypeBox schema.
 *
 * Environment variables still configure the `ebb` CLI and the `@ebb-ai/mcp`
 * server — separate hosts, unchanged behaviour.
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  carbonBudgetOverrides,
  gridCredentials,
  mergeConfig,
  pluginConfigFromGatewayConfig,
  pluginConfigSchema,
  PLUGIN_ID,
} from "../src/config.js";
import { availableProviders, buildAdapters, setLlmBridgeForTest } from "../src/dispatch.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const PKG = join(HERE, "..");
const SRC = join(PKG, "src");

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (full.endsWith(".ts")) out.push(full);
  }
  return out;
}

// Built by concatenation so this file does not match the pattern it searches.
const ENV_READ = "process" + "." + "env";

describe("ebb OpenClaw plugin — zero environment reads", () => {
  it("no source file reads the ambient environment", () => {
    const offenders = walk(SRC).filter((f) =>
      readFileSync(f, "utf8").includes(ENV_READ),
    );
    expect(offenders).toEqual([]);
  });

  it("the built bundle contains zero environment reads (ClawScan acceptance test)", () => {
    const bundle = join(PKG, "dist", "index.js");
    if (!existsSync(bundle)) {
      // `pnpm test` does not build. Skip rather than fail on a clean checkout;
      // CI runs `pnpm build` before `pnpm test`, and the src scan above covers
      // the same ground on every run.
      return;
    }
    const text = readFileSync(bundle, "utf8");
    const count = text.split(ENV_READ).length - 1;
    expect(count).toBe(0);
  });
});

describe("ebb OpenClaw plugin — configuration comes from PluginConfig", () => {
  const savedEnv = new Map<string, string | undefined>();
  const LEAKY = [
    "ANTHROPIC_API_KEY",
    "OPENAI_API_KEY",
    "GEMINI_API_KEY",
    "GOOGLE_API_KEY",
    "OLLAMA_HOST",
    "OLLAMA_MODELS",
    "EBB_ELECTRICITY_MAPS_API_KEY",
    "EBB_EIA_API_KEY",
    "EBB_ENTSOE_SECURITY_TOKEN",
    "WATTTIME_USERNAME",
    "WATTTIME_PASSWORD",
  ];

  beforeEach(() => {
    setLlmBridgeForTest(undefined);
    for (const key of LEAKY) {
      savedEnv.set(key, process.env[key]);
      process.env[key] = `leaked-${key}`;
    }
  });

  afterEach(() => {
    for (const [key, value] of savedEnv) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    savedEnv.clear();
  });

  it("buildAdapters ignores the environment entirely", () => {
    // Every provider variable is exported above; with an empty PluginConfig
    // there must still be no adapter.
    expect(buildAdapters({})).toEqual({});
    expect([...availableProviders({})]).toEqual([]);
  });

  it("buildAdapters uses the plugin-config credential verbatim", () => {
    const adapters = buildAdapters({
      anthropicApiKey: "cfg-anthropic",
      openaiApiKey: "cfg-openai",
      geminiApiKey: "cfg-gemini",
      ollamaHost: "http://ollama.test:11434",
    });
    expect(Object.keys(adapters).sort()).toEqual([
      "anthropic",
      "gemini",
      "ollama",
      "openai",
    ]);
    const ollama = adapters.ollama as unknown as { host: string };
    expect(ollama.host).toBe("http://ollama.test:11434");
  });

  it("gridCredentials maps plugin config onto core's credential shape", () => {
    expect(
      gridCredentials({
        electricityMapsApiKey: "em",
        eiaApiKey: " eia ",
        entsoeSecurityToken: "entsoe",
        wattTimeUsername: "wt-user",
        wattTimePassword: "wt-pass",
      }),
    ).toEqual({
      electricityMapsApiKey: "em",
      eiaApiKey: "eia", // trimmed
      entsoeSecurityToken: "entsoe",
      wattTimeUsername: "wt-user",
      wattTimePassword: "wt-pass",
    });
    // Nothing configured ⇒ nothing injected, despite the exported variables.
    expect(gridCredentials({})).toEqual({
      electricityMapsApiKey: undefined,
      eiaApiKey: undefined,
      entsoeSecurityToken: undefined,
      wattTimeUsername: undefined,
      wattTimePassword: undefined,
    });
  });

  it("carbonBudgetOverrides maps the threshold + window onto core's option shape", () => {
    expect(carbonBudgetOverrides({})).toEqual({});
    expect(carbonBudgetOverrides({ carbonBudgetG: 500 })).toEqual({
      EBB_CARBON_BUDGET_G: "500",
    });
    expect(
      carbonBudgetOverrides({ carbonBudgetG: 500, carbonBudgetWindow: "weekly" }),
    ).toEqual({
      EBB_CARBON_BUDGET_G: "500",
      EBB_CARBON_BUDGET_WINDOW: "weekly",
    });
    // A non-finite threshold is dropped rather than passed through as "NaN".
    expect(carbonBudgetOverrides({ carbonBudgetG: Number.NaN })).toEqual({});
  });
});

describe("ebb OpenClaw plugin — config recovered from the gateway config", () => {
  it("reads plugins.entries.ebb.config out of a captured gateway config", () => {
    const gateway = {
      channels: { telegram: {} },
      plugins: {
        entries: {
          other: { config: { nope: true } },
          [PLUGIN_ID]: { enabled: true, config: { anthropicApiKey: "from-gateway" } },
        },
      },
    };
    expect(pluginConfigFromGatewayConfig(gateway)).toEqual({
      anthropicApiKey: "from-gateway",
    });
  });

  it("returns undefined for anything that is not a gateway config", () => {
    for (const bad of [undefined, null, 42, "x", {}, { plugins: {} }, { plugins: { entries: {} } }]) {
      expect(pluginConfigFromGatewayConfig(bad)).toBeUndefined();
    }
    // An entry with no `config` block (the common case) is also undefined.
    expect(
      pluginConfigFromGatewayConfig({ plugins: { entries: { [PLUGIN_ID]: { enabled: true } } } }),
    ).toBeUndefined();
  });

  it("an explicit tool-call config wins over the gateway block", () => {
    const merged = mergeConfig(
      { dbPath: "/from/gateway.db", anthropicApiKey: "gateway-key" },
      { dbPath: "/from/toolcall.db", openaiApiKey: undefined },
    );
    expect(merged.dbPath).toBe("/from/toolcall.db");
    // Keys absent (or explicitly undefined) in the override never clobber.
    expect(merged.anthropicApiKey).toBe("gateway-key");
    expect(merged.openaiApiKey).toBeUndefined();
  });
});

describe("ebb OpenClaw plugin — manifest matches the code's config schema", () => {
  const manifest = JSON.parse(
    readFileSync(join(PKG, "openclaw.plugin.json"), "utf8"),
  ) as {
    configSchema: { properties: Record<string, { description?: string }> };
    uiHints?: Record<string, { sensitive?: boolean }>;
    configContracts?: { secretInputs?: { paths?: { path: string }[] } };
  };
  const schema = pluginConfigSchema as unknown as {
    properties: Record<string, unknown>;
  };

  it("declares exactly the fields the TypeBox schema declares", () => {
    expect(Object.keys(manifest.configSchema.properties).sort()).toEqual(
      Object.keys(schema.properties).sort(),
    );
  });

  it("every field that replaces an environment variable names it in its description", () => {
    // The migration must be discoverable straight from the gateway UI.
    const replacements: Record<string, string> = {
      defaultRegion: "EBB_DEFAULT_REGION",
      electricityMapsApiKey: "EBB_ELECTRICITY_MAPS_API_KEY",
      eiaApiKey: "EBB_EIA_API_KEY",
      entsoeSecurityToken: "EBB_ENTSOE_SECURITY_TOKEN",
      wattTimeUsername: "WATTTIME_USERNAME",
      wattTimePassword: "WATTTIME_PASSWORD",
      anthropicApiKey: "ANTHROPIC_API_KEY",
      openaiApiKey: "OPENAI_API_KEY",
      geminiApiKey: "GEMINI_API_KEY",
      googleApiKey: "GOOGLE_API_KEY",
      ollamaHost: "OLLAMA_HOST",
      ollamaModels: "OLLAMA_MODELS",
      carbonBudgetG: "EBB_CARBON_BUDGET_G",
      carbonBudgetWindow: "EBB_CARBON_BUDGET_WINDOW",
      deliveryStorePath: "EBB_DELIVERY_FILE",
      disableStartupDispatch: "EBB_DISABLE_STARTUP_DISPATCH",
    };
    for (const [field, envVar] of Object.entries(replacements)) {
      const description = manifest.configSchema.properties[field]?.description ?? "";
      expect(description, `${field} must name ${envVar}`).toContain(envVar);
    }
  });

  it("marks every credential field sensitive and declares it as a SecretRef input", () => {
    // `uiHints.sensitive` masks the value in the gateway UI; the
    // `configContracts.secretInputs` declaration is what makes OpenClaw resolve
    // a "${ENV_VAR}" shorthand into the plaintext this plugin then receives —
    // the gateway does the environment read, never this bundle.
    const credentials = [
      "electricityMapsApiKey",
      "eiaApiKey",
      "entsoeSecurityToken",
      "wattTimeUsername",
      "wattTimePassword",
      "anthropicApiKey",
      "openaiApiKey",
      "geminiApiKey",
      "googleApiKey",
    ];
    const secretPaths = (manifest.configContracts?.secretInputs?.paths ?? []).map(
      (p) => p.path,
    );
    for (const field of credentials) {
      expect(manifest.uiHints?.[field]?.sensitive, `${field} uiHint`).toBe(true);
      expect(secretPaths, `${field} secretInput`).toContain(field);
    }
  });
});
