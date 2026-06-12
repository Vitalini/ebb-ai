"use client";

import { useState } from "react";

const PROMPT = `Install ebb-ai (carbon-aware MCP scheduler) into the host you're running in.

1. Detect the host: Claude Code, Cursor, Claude Desktop, Windsurf,
   Continue, Cline, Zed, Goose, or OpenClaw.

2. Install:
   - Claude Code: /plugin marketplace add Vitalini/ebb-ai
                  /plugin install ebb-ai
   - OpenClaw:    openclaw plugin add @vitalini/ebb
   - Any other MCP host: add this server to the host's MCP config
       command: npx
       args:    ["-y", "@ebb-ai/mcp"]
     (Claude Desktop, Cursor, Windsurf, Continue, Cline, Zed, Goose
     all use the same {command, args} shape — only the config file
     path differs. See https://www.ebb-ai.com/docs for the exact
     path for each host.)

3. Restart the host session so the new MCP server is picked up.

4. Confirm by calling the schedule_task tool with a dry_run:
     { "prompt": "ping",
       "deadline_iso": "<24h from now in ISO-8601>",
       "dry_run": true }
   Expected: a chosen window + estimated carbon, no persistent task.

5. Tell me when done — print only the host you detected and whether
   step 4 returned a valid window. No other output.

Reference: https://www.ebb-ai.com/docs | License: Apache-2.0`;

export function AgentPrompt() {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(PROMPT);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard blocked — fall back to manual select
    }
  }

  return (
    <div className="relative rounded-md border border-rule bg-bg overflow-hidden">
      <div className="flex items-center justify-between border-b border-rule bg-bg-elev px-3 py-1.5">
        <span className="font-mono text-[10px] uppercase tracking-wider text-fg-dim">
          agent prompt
        </span>
        <button
          type="button"
          onClick={copy}
          className="rounded px-2 py-0.5 font-mono text-[11px] text-fg-muted transition-colors hover:bg-bg-card hover:text-accent"
        >
          {copied ? "copied ✓" : "copy"}
        </button>
      </div>
      <pre className="overflow-x-auto p-3 font-mono text-[12px] leading-relaxed text-fg whitespace-pre-wrap">
        <code>{PROMPT}</code>
      </pre>
    </div>
  );
}
