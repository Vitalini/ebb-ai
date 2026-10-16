#!/usr/bin/env node
// @ebb-ai/mcp 0.17.1: `npx -y @ebb-ai/mcp` keeps working. The deprecation
// line goes to stderr only; stdout is the MCP protocol channel.
process.stderr.write(
  "@ebb-ai/mcp is now @tidegap/mcp; install @tidegap/mcp (this package stops receiving updates). " +
    'In your MCP host config use "tidegap": { "command": "npx", "args": ["-y", "@tidegap/mcp"] }.\n',
);

const { main } = await import("@tidegap/mcp");
main().catch((err) => {
  process.stderr.write(`[tidegap-mcp] fatal: ${err instanceof Error ? err.stack ?? err.message : String(err)}\n`);
  process.exit(1);
});
