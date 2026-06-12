"use client";

import { useState } from "react";

const PROMPT = `Please install ebb-ai — open-source carbon-aware MCP scheduler, Apache-2.0.

Instructions: https://www.ebb-ai.com/install.md

Read that file, then run the install path for whichever host
you're in and confirm it worked.`;

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
