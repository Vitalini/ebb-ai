import type { Metadata } from "next";
import Link from "next/link";
import { InstallPicker } from "@/components/install-picker";

export const metadata: Metadata = {
  title: "Carbon-aware scheduling for AI workflows",
  description:
    "Open-source MCP server that defers non-urgent AI tasks to the cleanest electricity-grid window inside your deadline. One-line install in Claude Code, Cursor, Claude Desktop, and any MCP host.",
  alternates: { canonical: "https://www.ebb-ai.com" },
};

const TILES: Array<{
  href: string;
  emoji: string;
  title: string;
  body: string;
  external?: boolean;
}> = [
  {
    href: "/map",
    emoji: "🌍",
    title: "Live carbon map",
    body: "Seven LLM-provider grid regions, real-time data. Click any region for the 72-hour forecast.",
  },
  {
    href: "/plan",
    emoji: "📅",
    title: "Plan a task",
    body: "Pick a region + deadline. See the cleanest hour and the carbon you'd save vs running now.",
  },
  {
    href: "/stats",
    emoji: "📊",
    title: "My impact",
    body: "Personal carbon-receipt summary from your local ebb-ai queue. CLI-parity in the browser.",
  },
  {
    href: "/docs",
    emoji: "📜",
    title: "Docs & commands",
    body: "All 8 /ebb-ai:* slash commands, 9 MCP tools, install matrix for every host. Architecture deep-dive.",
  },
];

export default function HomePage() {
  return (
    <div className="space-y-14">
      <Hero />
      <InstallBlock />
      <TilesBlock />
      <ValueRow />
    </div>
  );
}

function Hero() {
  return (
    <section className="space-y-5 pt-2">
      <div className="inline-flex items-center gap-2 rounded-md border border-accent/40 bg-accent/5 px-3 py-1 font-mono text-xs uppercase tracking-wider text-accent">
        <span aria-hidden="true" className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent" />
        v0.8.2 · operator preview
      </div>
      <h1 className="max-w-4xl text-4xl font-extrabold leading-[1.05] tracking-tight text-fg sm:text-6xl">
        Defer AI work to the
        <br />
        <span className="text-accent">cleanest hour</span> of the grid.
      </h1>
      <p className="max-w-2xl text-base leading-relaxed text-fg-muted sm:text-lg">
        ebb-ai is an open-source MCP scheduler. Hand it any deferrable LLM
        task with a deadline, and it routes the dispatch to the hour with
        the lowest electricity-grid carbon intensity — typically 40–70 %
        cleaner than running right now. Per-task carbon receipts. Free,
        Apache-2.0.
      </p>
    </section>
  );
}

function InstallBlock() {
  return (
    <section
      id="install"
      className="rounded-xl border border-accent/30 bg-accent/[0.03] p-5 sm:p-7"
    >
      <header className="space-y-1">
        <p className="font-mono text-[11px] uppercase tracking-wider text-accent">
          install — 30 seconds
        </p>
        <h2 className="text-2xl font-semibold tracking-tight text-fg">
          One line. Any host.
        </h2>
        <p className="mt-1 text-sm text-fg-muted">
          Pick your AI host — copy the command. Default is the universal MCP
          install; switch the dropdown for Claude Code, Cursor, Claude Desktop,
          Windsurf, Continue, Cline, Zed, Goose, OpenClaw, or use the library
          directly.
        </p>
      </header>

      <div className="mt-5">
        <InstallPicker />
      </div>

      <p className="mt-5 text-sm text-fg-muted">
        Once installed, your assistant can call{" "}
        <code className="rounded bg-bg-elev px-1 font-mono text-xs">
          /ebb-ai:defer &quot;summarize this&quot; --by tomorrow 6pm
        </code>{" "}
        and the task lands at the cleanest grid hour inside the deadline.{" "}
        <Link href="/docs" className="text-accent hover:underline">
          See all commands →
        </Link>
      </p>
    </section>
  );
}

function TilesBlock() {
  return (
    <section className="space-y-4">
      <header className="space-y-1">
        <p className="font-mono text-[11px] uppercase tracking-wider text-accent">
          dashboard
        </p>
        <h2 className="text-2xl font-semibold tracking-tight text-fg">
          Live data + tools.
        </h2>
      </header>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {TILES.map((t) => (
          <Link
            key={t.href}
            href={t.href}
            className="group rounded-xl border border-rule bg-bg-card p-5 transition-all hover:border-accent/40 hover:bg-accent/5"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-2xl">{t.emoji}</p>
                <h3 className="mt-2 text-lg font-semibold tracking-tight text-fg">
                  {t.title}
                </h3>
                <p className="mt-1 text-sm leading-relaxed text-fg-muted">
                  {t.body}
                </p>
              </div>
              <span
                aria-hidden="true"
                className="mt-1 text-fg-muted transition-transform group-hover:translate-x-1 group-hover:text-accent"
              >
                →
              </span>
            </div>
          </Link>
        ))}
      </div>
    </section>
  );
}

function ValueRow() {
  const items: Array<{ label: string; value: string }> = [
    { label: "regions live", value: "7" },
    { label: "tests passing", value: "204" },
    { label: "MCP tools", value: "9" },
    { label: "languages", value: "TS + Py" },
    { label: "license", value: "Apache-2.0" },
  ];
  return (
    <section className="grid grid-cols-2 gap-3 rounded-xl border border-rule bg-bg-elev px-5 py-5 sm:grid-cols-5">
      {items.map((it) => (
        <div key={it.label} className="text-center sm:text-left">
          <dt className="font-mono text-[10px] uppercase tracking-wider text-fg-dim">
            {it.label}
          </dt>
          <dd className="mt-1 font-mono text-base font-semibold text-fg sm:text-lg">
            {it.value}
          </dd>
        </div>
      ))}
    </section>
  );
}
