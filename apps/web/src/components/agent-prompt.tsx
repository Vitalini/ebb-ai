"use client";

import { useEffect, useRef, useState } from "react";

const PROMPT = `Please install Tidegap — open-source carbon-aware MCP scheduler, Apache-2.0.

Instructions: https://www.tidegap.com/install.md

Read that file, then run the install path for whichever host
you're in and confirm it worked.`;

type CopyState = "idle" | "copied" | "failed";

const COPIED_RESET_MS = 1500;

function useCopyPrompt() {
  const [state, setState] = useState<CopyState>("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => () => clearTimeout(timer.current), []);

  async function copy() {
    clearTimeout(timer.current);
    setState("idle");
    try {
      await navigator.clipboard.writeText(PROMPT);
      setState("copied");
      timer.current = setTimeout(() => setState("idle"), COPIED_RESET_MS);
    } catch {
      setState("failed");
    }
  }

  return { state, copy };
}

export function CopyPromptButton() {
  const { state, copy } = useCopyPrompt();

  return (
    <div className="flex flex-col items-center gap-3">
      <button
        type="button"
        onClick={copy}
        className="rounded-lg border border-accent/60 bg-accent/15 px-6 py-3.5 font-mono text-sm font-semibold text-accent transition-colors hover:bg-accent/25 sm:px-8 sm:py-4 sm:text-base"
      >
        Copy the prompt for your agent
      </button>
      <p role="status" className="min-h-5 text-sm text-fg-muted">
        {state === "copied" && "Copied. Paste it into your agent."}
        {state === "failed" && (
          <>
            Copy blocked. The prompt is in the{" "}
            <a href="#install" className="text-accent hover:underline">
              install section
            </a>{" "}
            below.
          </>
        )}
      </p>
    </div>
  );
}

export function AgentPrompt() {
  const { state, copy } = useCopyPrompt();

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
          {state === "copied" ? "copied ✓" : "copy"}
        </button>
      </div>
      <pre className="overflow-x-auto p-3 font-mono text-[12px] leading-relaxed text-fg whitespace-pre-wrap">
        <code>{PROMPT}</code>
      </pre>
    </div>
  );
}
