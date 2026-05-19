import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "About",
  description:
    "ebb-ai is an open-source carbon-aware scheduler for agentic AI workflows. It defers non-urgent LLM calls to the cleanest electricity-grid window inside your deadline, with per-task carbon receipts and full audit log.",
  alternates: { canonical: "https://www.ebb-ai.com/about" },
  openGraph: {
    title: "About ebb-ai",
    description:
      "Why a carbon-aware scheduler for LLM workflows exists, who it's for, and how it actually moves the needle.",
    url: "https://www.ebb-ai.com/about",
    type: "article",
  },
};

export default function AboutPage() {
  return (
    <article className="mx-auto max-w-3xl space-y-10 text-fg">
      <header className="space-y-4">
        <p className="font-mono text-xs uppercase tracking-wider text-accent">about</p>
        <h1 className="text-4xl font-extrabold leading-[1.05] tracking-tight sm:text-5xl">
          A scheduler for AI that picks the cleanest hour.
        </h1>
        <p className="text-lg leading-relaxed text-fg-muted">
          ebb-ai is an open-source carbon-aware scheduler for agentic AI workflows.
          Give it a deadline and any LLM task that doesn&apos;t need to run
          <em> right now</em>, and it will defer the dispatch to the hour with the
          lowest grid carbon-intensity inside your window — typically saving 40-70 %
          of the per-task CO<sub>2</sub>e versus dispatching immediately.
        </p>
      </header>

      <section className="space-y-3">
        <h2 className="text-2xl font-bold tracking-tight">Why this exists</h2>
        <p className="leading-relaxed text-fg-muted">
          The electricity grid is not a constant. Carbon-intensity in any given
          region swings 5-10× across a single day as solar / wind / hydro come on
          and off line. A prompt dispatched at noon in California can be six times
          dirtier than the same prompt dispatched at 4 AM. For instant chat the
          tradeoff isn&apos;t available — the user is waiting. But a huge fraction
          of agent work is genuinely deferrable: nightly summaries, evaluator
          sweeps, batch enrichment, long-horizon research. Today nothing automates
          the deferral. ebb-ai does.
        </p>
        <p className="leading-relaxed text-fg-muted">
          A second motivation is honest accounting. Most &quot;green AI&quot;
          dashboards show monthly aggregates with assumed grid mixes. ebb-ai
          writes a per-task carbon receipt against the actual grid intensity at
          the moment of dispatch — auditable, region-aware, and reproducible from
          the persistent SQLite ledger.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-2xl font-bold tracking-tight">How it works</h2>
        <ol className="ml-5 list-decimal space-y-2 leading-relaxed text-fg-muted">
          <li>
            Your agent (Claude Code, Claude Desktop, Cursor, OpenAI o1 / Codex,
            any MCP host) calls one of ebb-ai&apos;s nine MCP tools — for example,{" "}
            <code className="rounded bg-bg-elev px-1 font-mono text-sm">schedule_task</code>{" "}
            with a prompt, region, and deadline.
          </li>
          <li>
            ebb-ai fetches the live carbon-intensity forecast for that region from
            the appropriate source — UK National Grid ESO, U.S. EIA, ENTSO-E for
            Europe, or Electricity Maps as fallback.
          </li>
          <li>
            It scores every hour inside the deadline and picks the cleanest one
            (with a 15 % tolerance band + jitter so the global fleet doesn&apos;t
            converge on a single hour).
          </li>
          <li>
            The task is persisted to a local SQLite queue. When the chosen hour
            arrives, the <code className="rounded bg-bg-elev px-1 font-mono text-sm">ebb tick</code>{" "}
            daemon dispatches via the provider&apos;s Batch API (50 % discount on
            the bill, same answer) when the deadline allows.
          </li>
          <li>
            A carbon receipt is written: timestamp, region, exact intensity used
            for scoring, tokens in/out, dollar cost vs peak. Inspectable via{" "}
            <code className="rounded bg-bg-elev px-1 font-mono text-sm">ebb stats</code>{" "}
            on the CLI or the <Link href="/stats" className="text-accent hover:underline">/stats</Link>{" "}
            dashboard view.
          </li>
        </ol>
      </section>

      <section className="space-y-3">
        <h2 className="text-2xl font-bold tracking-tight">Who it&apos;s for</h2>
        <ul className="ml-5 list-disc space-y-2 leading-relaxed text-fg-muted">
          <li>
            <strong className="text-fg">Builders running deferrable AI</strong> —
            anyone whose agent has &quot;by tomorrow&quot;-class workloads (nightly
            digest jobs, batch evaluations, research sweeps, multi-step report
            generation).
          </li>
          <li>
            <strong className="text-fg">Engineering teams with carbon
            commitments</strong> — companies with internal CO<sub>2</sub>e
            budgets or external ESG reporting that need defensible per-job
            numbers rather than spreadsheet estimates.
          </li>
          <li>
            <strong className="text-fg">Researchers</strong> — the deterministic
            mock grid feed makes simulations reproducible; the persistent SQLite
            ledger makes longitudinal study cheap.
          </li>
          <li>
            <strong className="text-fg">MCP host implementers</strong> — ebb-ai
            is a reference implementation of carbon-aware extensions to the
            Model Context Protocol; the{" "}
            <a
              href="https://github.com/Vitalini/ebb-ai/blob/main/docs/spec/proposal/UPSTREAM-PR.md"
              target="_blank"
              rel="noreferrer"
              className="text-accent hover:underline"
            >
              upstream PR draft
            </a>{" "}
            spells out the schema shape.
          </li>
        </ul>
      </section>

      <section className="space-y-3">
        <h2 className="text-2xl font-bold tracking-tight">What you can do right now</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <Link
            href="/"
            className="rounded-md border border-rule bg-bg-card p-4 transition-colors hover:border-accent/40 hover:bg-accent/5"
          >
            <p className="font-mono text-xs uppercase tracking-wider text-accent">
              live data
            </p>
            <p className="mt-1 font-semibold text-fg">Carbon-intensity map</p>
            <p className="mt-1 text-sm text-fg-muted">
              Real numbers for 7 grid regions, updated every few minutes.
            </p>
          </Link>
          <Link
            href="/plan"
            className="rounded-md border border-rule bg-bg-card p-4 transition-colors hover:border-accent/40 hover:bg-accent/5"
          >
            <p className="font-mono text-xs uppercase tracking-wider text-accent">
              try it without code
            </p>
            <p className="mt-1 font-semibold text-fg">Best-window finder</p>
            <p className="mt-1 text-sm text-fg-muted">
              Pick a region + deadline; see the optimal dispatch hour and the
              CO<sub>2</sub>e savings vs dispatching now.
            </p>
          </Link>
          <a
            href="https://github.com/Vitalini/ebb-ai#install"
            target="_blank"
            rel="noreferrer"
            className="rounded-md border border-rule bg-bg-card p-4 transition-colors hover:border-accent/40 hover:bg-accent/5"
          >
            <p className="font-mono text-xs uppercase tracking-wider text-accent">
              install
            </p>
            <p className="mt-1 font-semibold text-fg">Claude Code plugin</p>
            <p className="mt-1 text-sm text-fg-muted">
              Eight <code className="font-mono">/ebb-ai:*</code> slash commands.
              One-line install in any MCP host.
            </p>
          </a>
          <a
            href="https://github.com/Vitalini/ebb-ai"
            target="_blank"
            rel="noreferrer"
            className="rounded-md border border-rule bg-bg-card p-4 transition-colors hover:border-accent/40 hover:bg-accent/5"
          >
            <p className="font-mono text-xs uppercase tracking-wider text-accent">
              source
            </p>
            <p className="mt-1 font-semibold text-fg">GitHub repository</p>
            <p className="mt-1 text-sm text-fg-muted">
              Apache-2.0. TypeScript + Python ports. 204 tests. PRs welcome.
            </p>
          </a>
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-2xl font-bold tracking-tight">Status</h2>
        <p className="leading-relaxed text-fg-muted">
          v0.8.2 (operator preview). The scheduler is production-grade — the
          even-distribution simulation routes 10 000 synthetic tasks across seven
          regions with under 11 % max-bucket concentration, the SQLite ledger
          survives process restart, and per-region routing is auto-wired. The
          public surface is still pre-1.0: API shapes can change in minor
          versions. Deferred for v0.9: upstream MCP spec PR, opt-in aggregate
          leaderboard, WattTime marginal-emissions feed, cross-provider
          routing. v1.0 will freeze the API surface.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-2xl font-bold tracking-tight">Maintainer</h2>
        <p className="leading-relaxed text-fg-muted">
          Built by{" "}
          <a
            href="https://github.com/Vitalini"
            target="_blank"
            rel="noreferrer"
            className="text-accent hover:underline"
          >
            Vitalii Borovyk
          </a>{" "}
          (independent, open-source). Issues, PRs, and feature requests:{" "}
          <a
            href="https://github.com/Vitalini/ebb-ai/issues"
            target="_blank"
            rel="noreferrer"
            className="text-accent hover:underline"
          >
            github.com/Vitalini/ebb-ai/issues
          </a>
          .
        </p>
      </section>
    </article>
  );
}
