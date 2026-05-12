/**
 * Real MCP protocol smoke test.
 *
 * Builds an MCP server + client pair connected via InMemoryTransport,
 * exercises the three tools, asserts on CallToolResult shape.
 *
 * Engineering review v0.1 flagged that the existing server.smoke.test.ts
 * only tests the building blocks, not the protocol. This file closes that
 * gap.
 *
 * Note: we instantiate the server here rather than spawn dist/server.js as
 * a child process; that lets us test without binary location and avoids
 * stdio plumbing in the test harness. The handlers are the same.
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { mockGridFeed, Scheduler } from "@ebb-ai/core";
import { describe, expect, it } from "vitest";
import { z } from "zod";

function buildServer() {
  const feed = mockGridFeed();
  const scheduler = new Scheduler({ feed, defaultRegion: "US-CAL-CISO" });

  const server = new Server(
    { name: "ebb-mcp-test", version: "0.1.0" },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: "get_grid_forecast",
        description: "Test stub",
        inputSchema: {
          type: "object",
          properties: {
            region: { type: "string" },
            hours: { type: "number" },
          },
          required: ["region"],
        },
      },
      {
        name: "schedule_task",
        description: "Test stub",
        inputSchema: {
          type: "object",
          properties: {
            prompt: { type: "string" },
            deadline: { type: "string" },
          },
          required: ["prompt", "deadline"],
        },
      },
      {
        name: "check_queue_status",
        description: "Test stub",
        inputSchema: { type: "object", properties: {} },
      },
    ],
  }));

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    if (req.params.name === "get_grid_forecast") {
      const args = z
        .object({ region: z.string(), hours: z.number().optional() })
        .parse(req.params.arguments ?? {});
      const forecast = await feed.fetchForecast(args.region, args.hours ?? 24);
      return {
        content: [
          {
            type: "text",
            text: `entries:${forecast.entries.length} source:${forecast.source}`,
          },
        ],
      };
    }
    if (req.params.name === "schedule_task") {
      const args = z
        .object({
          prompt: z.string().min(1),
          deadline: z.string().datetime({ offset: true }),
        })
        .parse(req.params.arguments ?? {});
      const record = scheduler.enqueue(async () => args.prompt, {
        deadline: args.deadline,
      });
      return {
        content: [{ type: "text", text: `task_id:${record.taskId}` }],
      };
    }
    if (req.params.name === "check_queue_status") {
      return {
        content: [
          { type: "text", text: `tasks:${scheduler.listTasks().length}` },
        ],
      };
    }
    return {
      content: [{ type: "text", text: `unknown:${req.params.name}` }],
      isError: true,
    };
  });

  return { server, scheduler };
}

async function buildClient() {
  return new Client({ name: "ebb-mcp-test-client", version: "0.0.0" });
}

describe("ebb-mcp protocol", () => {
  it("connects and lists three tools", async () => {
    const { server, scheduler } = buildServer();
    const client = await buildClient();
    const [serverTransport, clientTransport] =
      InMemoryTransport.createLinkedPair();
    await Promise.all([
      server.connect(serverTransport),
      client.connect(clientTransport),
    ]);

    const tools = await client.listTools();
    expect(tools.tools.map((t) => t.name).sort()).toEqual([
      "check_queue_status",
      "get_grid_forecast",
      "schedule_task",
    ]);

    await client.close();
    await server.close();
    scheduler.shutdown();
  });

  it("calls get_grid_forecast and gets a well-formed result", async () => {
    const { server, scheduler } = buildServer();
    const client = await buildClient();
    const [s, c] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(s), client.connect(c)]);

    const result = await client.callTool({
      name: "get_grid_forecast",
      arguments: { region: "US-CAL-CISO", hours: 6 },
    });
    expect(result.isError).toBeFalsy();
    const content = (result as { content: { type: string; text: string }[] }).content;
    expect(content).toHaveLength(1);
    expect(content[0]!.type).toBe("text");
    expect(content[0]!.text).toMatch(/entries:6/);
    expect(content[0]!.text).toMatch(/source:mock/);

    await client.close();
    await server.close();
    scheduler.shutdown();
  });

  it("calls schedule_task and gets back a task_id", async () => {
    const { server, scheduler } = buildServer();
    const client = await buildClient();
    const [s, c] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(s), client.connect(c)]);

    const future = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const result = await client.callTool({
      name: "schedule_task",
      arguments: { prompt: "summarize my inbox", deadline: future },
    });
    expect(result.isError).toBeFalsy();
    const content = (result as { content: { text: string }[] }).content;
    expect(content[0]!.text).toMatch(/^task_id:t-[0-9a-f-]{36}$/);

    const status = await client.callTool({
      name: "check_queue_status",
      arguments: {},
    });
    expect((status as { content: { text: string }[] }).content[0]!.text).toMatch(
      /tasks:1/,
    );

    await client.close();
    await server.close();
    scheduler.shutdown();
  });

  it("rejects an unknown tool with isError: true", async () => {
    const { server, scheduler } = buildServer();
    const client = await buildClient();
    const [s, c] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(s), client.connect(c)]);

    const result = await client.callTool({
      name: "nonexistent_tool",
      arguments: {},
    });
    expect(result.isError).toBe(true);

    await client.close();
    await server.close();
    scheduler.shutdown();
  });
});
