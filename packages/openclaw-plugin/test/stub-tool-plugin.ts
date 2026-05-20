/**
 * Test stub for `openclaw/plugin-sdk/tool-plugin`.
 *
 * The real SDK is injected by the OpenClaw runtime and is not installed as a
 * dependency, so the production import is `@ts-expect-error`'d. This stub
 * mirrors `defineToolPlugin` closely enough to load the plugin entry and
 * exercise its tools in isolation. `vitest.config.ts` aliases the SDK import
 * specifier to this file.
 */

export type StubToolDefinition = {
  name: string;
  label?: string;
  description: string;
  parameters: unknown;
  optional?: boolean;
  execute: (params: unknown, config: unknown, context?: unknown) => unknown;
};

export type StubResolvedTool = {
  name: string;
  label: string;
  description: string;
  parameters: unknown;
  optional: boolean;
  execute: (params: unknown, config: unknown, context?: unknown) => unknown;
};

export type StubToolPluginDefinition = {
  id: string;
  name: string;
  description: string;
  configSchema?: unknown;
  tools: (
    tool: (def: StubToolDefinition) => StubResolvedTool,
  ) => readonly StubResolvedTool[];
};

export type StubToolPlugin = {
  id: string;
  name: string;
  description: string;
  configSchema?: unknown;
  tools: StubResolvedTool[];
};

export function defineToolPlugin(def: StubToolPluginDefinition): StubToolPlugin {
  const tools: StubResolvedTool[] = [];
  const factory = (toolDef: StubToolDefinition): StubResolvedTool => {
    const resolved: StubResolvedTool = {
      name: toolDef.name,
      label: toolDef.label ?? toolDef.name,
      description: toolDef.description,
      parameters: toolDef.parameters,
      optional: toolDef.optional === true,
      execute: toolDef.execute,
    };
    tools.push(resolved);
    return resolved;
  };
  def.tools(factory);
  return {
    id: def.id,
    name: def.name,
    description: def.description,
    configSchema: def.configSchema,
    tools,
  };
}
