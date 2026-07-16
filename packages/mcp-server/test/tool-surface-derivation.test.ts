/**
 * Audit §2.2 — the MCP server's registered tool list is DERIVED from the
 * shared canonical surface in @ebb-ai/core, not hand-authored alongside it.
 *
 * This pins the derivation so the MCP registration can never drift from the
 * single source of truth: names, per-tool parameter sets, requiredness and
 * descriptions must all match `@ebb-ai/core`'s tool-surface for the "mcp"
 * host.
 */

import { describe, expect, it } from "vitest";
import {
  paramOptionalForHost,
  paramsForHost,
  toolsForHost,
} from "@ebb-ai/core";
import { buildToolList, TOOL_DEFINITIONS } from "../src/server.js";

describe("MCP tool list is derived from the shared surface (§2.2)", () => {
  it("advertises exactly the shared surface's mcp tools, in order", () => {
    expect(TOOL_DEFINITIONS.map((d) => d.name)).toEqual(
      toolsForHost("mcp").map((d) => d.name),
    );
  });

  it("every advertised tool matches its shared descriptor (name/desc/params/required)", () => {
    const advertised = buildToolList();
    for (const def of toolsForHost("mcp")) {
      const tool = advertised.find((t) => t.name === def.name);
      expect(tool, `tool ${def.name} missing from the advertised list`).toBeTruthy();

      // description comes verbatim from the shared surface.
      expect(tool!.description).toBe(def.description);

      // properties are exactly the shared params for the mcp host.
      const props = Object.keys(
        (tool!.inputSchema as { properties?: Record<string, unknown> }).properties ?? {},
      ).sort();
      const expectedProps = paramsForHost(def, "mcp").map((p) => p.name).sort();
      expect(props, `properties drift on ${def.name}`).toEqual(expectedProps);

      // required is exactly the non-optional shared params for the mcp host.
      const required = (
        (tool!.inputSchema as { required?: string[] }).required ?? []
      ).sort();
      const expectedRequired = paramsForHost(def, "mcp")
        .filter((p) => !paramOptionalForHost(p, "mcp"))
        .map((p) => p.name)
        .sort();
      expect(required, `required drift on ${def.name}`).toEqual(expectedRequired);
    }
  });
});
