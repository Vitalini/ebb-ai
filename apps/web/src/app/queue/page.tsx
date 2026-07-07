/**
 * /queue — scheduler-queue explainer.
 *
 * The site is read-only and doesn't have access to your local
 * SQLite ledger. This page explains the queue lifecycle, the status
 * vocabulary, and how to inspect it from the CLI. No synthetic
 * counters, no fake task list.
 */

import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Scheduler queue",
  description:
    "How ebb-ai's task queue works — six statuses, one SQLite file, inspectable from the CLI. No telemetry; your queue is your queue.",
  alternates: { canonical: "https://www.ebb-ai.com/queue" },
};

const STATUSES: Array<{ name: string; description: string }> = [
  {
    name: "queued",
    description:
      "Just created; the scheduler hasn't picked a window yet (rare race window — usually fills within 1s).",
  },
  {
    name: "scheduled",
    description:
      "Window picked. Will dispatch at the chosen UTC hour inside the deadline. Sits here until the tick daemon fires.",
  },
  {
    name: "running",
    description:
      "The provider call is in-flight. For Batch-API tasks this can be hours; for sync tasks it's seconds.",
  },
  {
    name: "completed",
    description:
      "Provider returned. A carbon receipt is written: actual intensity, tokens in/out, dispatched_at timestamp.",
  },
  {
    name: "failed",
    description:
      "Provider returned an error. The reason is persisted; the /ebb-ai:retry slash command (or the retry_task MCP tool) re-dispatches.",
  },
  {
    name: "cancelled",
    description:
      "Manually cancelled. Idempotent — already-completed tasks return their existing status if you cancel them.",
  },
];

export default function QueuePage() {
  return (
    <article className="mx-auto max-w-3xl space-y-12 text-fg">
      <header className="space-y-3">
        <p className="font-mono text-xs uppercase tracking-wider text-accent">
          scheduler queue
        </p>
        <h1 className="text-4xl font-extrabold leading-[1.05] tracking-tight sm:text-5xl">
          One SQLite file. Inspectable from anywhere.
        </h1>
        <p className="max-w-2xl text-base leading-relaxed text-fg-muted">
          Every task — pending, scheduled, completed, failed,
          cancelled — lives in{" "}
          <code className="rounded bg-bg-elev px-1 font-mono text-sm">~/.ebb-ai/queue.db</code>
          . The Claude Code plugin, the OpenClaw plugin, the MCP
          server, and the CLI all read and write this same file.
          Inspect it however you like.
        </p>
      </header>

      <section className="space-y-3">
        <h2 className="text-2xl font-bold tracking-tight">Status vocabulary</h2>
        <ul className="space-y-2 leading-relaxed text-fg-muted">
          {STATUSES.map((s) => (
            <li key={s.name}>
              <code className="rounded bg-bg-elev px-1.5 py-0.5 font-mono text-sm font-semibold text-fg">
                {s.name}
              </code>
              <span className="ml-2">— {s.description}</span>
            </li>
          ))}
        </ul>
      </section>

      <section className="space-y-3">
        <h2 className="text-2xl font-bold tracking-tight">Inspect from the CLI</h2>
        <CodeBlock>
{`# All tasks (any status)
ebb queue list

# Filter by status
ebb queue list --status scheduled
ebb queue list --status failed

# Receipts only (completed tasks)
ebb receipts list
ebb receipts list --since 2026-05-01

# Verify a receipt's Ed25519 signature
ebb verify <task_id>`}
        </CodeBlock>
      </section>

      <section className="space-y-3">
        <h2 className="text-2xl font-bold tracking-tight">From the agent (any MCP host)</h2>
        <p className="leading-relaxed text-fg-muted">
          The same queue is reachable through the MCP{" "}
          <code className="rounded bg-bg-elev px-1 font-mono text-sm">check_queue_status</code>{" "}
          tool. Your agent can answer {`"what's queued?"`} or{" "}
          {`"did that task run?"`} inline:
        </p>
        <CodeBlock>
{`> /ebb-ai:check
Total tasks: 3
  scheduled: 1 · completed: 2

> /ebb-ai:check 7f3a2b9e
status     completed
region     US-CAL-CISO
scheduled  22:15 UTC (4h ago)
completed  22:15:08 UTC
estimated  0.34 g CO2e
actual     0.31 g CO2e   (-9 %)
result     <the LLM response>`}
        </CodeBlock>
      </section>

      <section className="space-y-3">
        <h2 className="text-2xl font-bold tracking-tight">
          Why not show a live queue here?
        </h2>
        <p className="leading-relaxed text-fg-muted">
          The site is read-only and doesn&apos;t have a back-channel to
          your machine. Surfacing a {`"live"`} queue on a public
          dashboard means
          either centralizing the queue server-side (privacy-bad) or
          fabricating a demo (honesty-bad). A later release will add an{" "}
          <em>opt-in</em> HTTP control plane the dashboard can talk to;
          until then the queue is local-first by design.
        </p>
      </section>

      <footer className="rounded-xl border border-rule bg-bg-elev p-5 text-sm text-fg-muted">
        <p className="mb-2 font-mono text-xs uppercase tracking-wider text-accent">
          related
        </p>
        <ul className="space-y-1">
          <li>
            <Link href="/stats" className="text-accent hover:underline">
              /stats
            </Link>{" "}
            — personal carbon-impact summary (same ledger).
          </li>
          <li>
            <Link href="/docs#commands" className="text-accent hover:underline">
              /docs · slash commands
            </Link>{" "}
            — the eight{" "}
            <code className="rounded bg-bg-elev px-1 font-mono text-xs">
              /ebb-ai:*
            </code>{" "}
            commands.
          </li>
          <li>
            <Link href="/docs#tools" className="text-accent hover:underline">
              /docs · MCP tools
            </Link>{" "}
            — nine MCP tools (every host).
          </li>
        </ul>
      </footer>
    </article>
  );
}

function CodeBlock({ children }: { children: string }) {
  return (
    <pre className="overflow-x-auto rounded-md border border-rule bg-bg-elev p-4 font-mono text-[13px] leading-relaxed text-fg">
      <code>{children}</code>
    </pre>
  );
}
