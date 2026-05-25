import type { Metadata } from "next";
import Link from "next/link";
import { InstallPicker } from "@/components/install-picker";

export const metadata: Metadata = {
  title: "Docs · install, commands, MCP tools",
  description:
    "Install ebb-ai in any MCP host (Claude Code, Cursor, Claude Desktop, Windsurf, Continue, Cline, Zed, Goose, OpenClaw). Full reference for the eight /ebb-ai:* slash commands and nine MCP tools.",
  alternates: { canonical: "https://www.ebb-ai.com/docs" },
};

export default function DocsPage() {
  return (
    <article className="mx-auto max-w-4xl space-y-12 text-fg">
      <header className="space-y-3">
        <p className="font-mono text-[11px] uppercase tracking-wider text-accent">docs</p>
        <h1 className="text-4xl font-extrabold leading-[1.05] tracking-tight sm:text-5xl">
          Everything you need to install + use ebb-ai.
        </h1>
        <p className="max-w-2xl text-base leading-relaxed text-fg-muted">
          Pick your AI host below, copy the command. Then call any of the eight
          slash commands (Claude Code) or nine MCP tools (every other host).
        </p>
      </header>

      <section
        id="install"
        className="rounded-xl border border-accent/30 bg-accent/[0.03] p-5 sm:p-7"
      >
        <header className="space-y-1">
          <p className="font-mono text-[11px] uppercase tracking-wider text-accent">
            install
          </p>
          <h2 className="text-2xl font-semibold tracking-tight">Pick your host</h2>
        </header>
        <div className="mt-5">
          <InstallPicker />
        </div>
      </section>

      <section id="commands" className="space-y-6">
        <header className="space-y-1">
          <p className="font-mono text-[11px] uppercase tracking-wider text-accent">
            commands
          </p>
          <h2 className="text-2xl font-semibold tracking-tight">
            Eight slash commands (Claude Code)
          </h2>
          <p className="text-sm text-fg-muted">
            After installing the Claude Code plugin, these are available as
            <code className="ml-1 rounded bg-bg-elev px-1 font-mono text-xs">/ebb-ai:&lt;cmd&gt;</code>
            in any session. Identical CRUD over the task queue.
          </p>
        </header>

        <div className="grid gap-3 sm:grid-cols-2">
          {COMMANDS.map((c) => (
            <CommandCard key={c.name} cmd={c} />
          ))}
        </div>
      </section>

      <section id="tools" className="space-y-6">
        <header className="space-y-1">
          <p className="font-mono text-[11px] uppercase tracking-wider text-accent">
            mcp tools
          </p>
          <h2 className="text-2xl font-semibold tracking-tight">
            Nine MCP tools (every host)
          </h2>
          <p className="text-sm text-fg-muted">
            The same surface that powers the slash commands. Any MCP host can
            invoke these directly. Parameters are documented in each tool&apos;s
            JSON schema.
          </p>
        </header>

        <ul className="divide-y divide-rule overflow-hidden rounded-md border border-rule bg-bg-card">
          {TOOLS.map((t) => (
            <li key={t.name} className="px-4 py-3">
              <div className="flex flex-col gap-1 sm:flex-row sm:items-baseline sm:justify-between sm:gap-4">
                <code className="font-mono text-sm font-semibold text-fg">
                  {t.name}
                </code>
                <span className="font-mono text-[10px] uppercase tracking-wider text-fg-dim">
                  {t.access}
                </span>
              </div>
              <p className="mt-1 text-sm leading-relaxed text-fg-muted">
                {t.desc}
              </p>
            </li>
          ))}
        </ul>
      </section>

      <section id="paths" className="space-y-4">
        <header className="space-y-1">
          <p className="font-mono text-[11px] uppercase tracking-wider text-accent">
            on-disk
          </p>
          <h2 className="text-2xl font-semibold tracking-tight">Paths</h2>
        </header>
        <div className="grid gap-3 sm:grid-cols-2">
          <PathCard
            path="~/.ebb-ai/queue.db"
            desc="SQLite ledger — queue + carbon receipts. The CLI, MCP server, and dashboard all read this same file. Read-only from your agent; modifiable from the CLI."
          />
          <PathCard
            path="~/.ebb-ai/telemetry.key"
            desc="Local-only 256-bit token + Ed25519 keypair for the (planned) opt-in leaderboard. Never sent. Not generated until you opt in."
          />
        </div>
      </section>

      <section id="env" className="space-y-4">
        <header className="space-y-1">
          <p className="font-mono text-[11px] uppercase tracking-wider text-accent">
            environment
          </p>
          <h2 className="text-2xl font-semibold tracking-tight">Optional API keys</h2>
          <p className="text-sm text-fg-muted">
            ebb-ai works without any keys (GB is always live via UK National
            Grid ESO; everything else falls back to a deterministic mock). Set
            these in your MCP host&apos;s env block to unlock live data for more
            regions.
          </p>
        </header>
        <ul className="divide-y divide-rule overflow-hidden rounded-md border border-rule bg-bg-card text-sm">
          {ENVS.map((e) => (
            <li key={e.name} className="px-4 py-3">
              <code className="font-mono text-sm font-semibold text-fg">
                {e.name}
              </code>
              <p className="mt-1 text-fg-muted">{e.desc}</p>
            </li>
          ))}
        </ul>
      </section>

      <section className="rounded-xl border border-rule bg-bg-elev p-5 sm:p-7">
        <header className="space-y-1">
          <p className="font-mono text-[11px] uppercase tracking-wider text-accent">
            deeper
          </p>
          <h2 className="text-2xl font-semibold tracking-tight">
            Architecture, roadmap, source.
          </h2>
        </header>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <Link
            href="/architecture"
            className="rounded-md border border-rule bg-bg-card p-4 transition-colors hover:border-accent/40 hover:bg-accent/5"
          >
            <p className="font-semibold text-fg">Architecture</p>
            <p className="mt-1 text-sm text-fg-muted">
              System diagram, ingest→dispatch→receipt flow, what&apos;s
              deliberately not in v0.10.
            </p>
          </Link>
          <a
            href="https://github.com/Vitalini/ebb-ai"
            target="_blank"
            rel="noreferrer"
            className="rounded-md border border-rule bg-bg-card p-4 transition-colors hover:border-accent/40 hover:bg-accent/5"
          >
            <p className="font-semibold text-fg">GitHub →</p>
            <p className="mt-1 text-sm text-fg-muted">
              Source, issues, CHANGELOG, every CLI / MCP / core package.
              Apache-2.0.
            </p>
          </a>
        </div>
      </section>
    </article>
  );
}

type Cmd = {
  name: string;
  args: string;
  desc: string;
};

const COMMANDS: Cmd[] = [
  {
    name: "/ebb-ai:defer",
    args: "<prompt> [--by <when>] [--region <zone>] [--budget <g>]",
    desc: "Queue a task to run at the cleanest grid hour inside the deadline. Returns task_id + scheduled UTC time + region.",
  },
  {
    name: "/ebb-ai:plan",
    args: "<deadline> [--region <zone>] [--budget <g>]",
    desc: "Preview what window the scheduler would pick — without queueing. Returns chosen hour, savings vs now, top-3 alternatives.",
  },
  {
    name: "/ebb-ai:check",
    args: "[task_id] [--all]",
    desc: "List all tasks (default) or get full detail + carbon receipt for one task. Read-only.",
  },
  {
    name: "/ebb-ai:cancel",
    args: "<task_id>",
    desc: "Cancel a queued or scheduled task. Idempotent — completed/failed/cancelled tasks return their existing status.",
  },
  {
    name: "/ebb-ai:expedite",
    args: "<task_id>",
    desc: "Dispatch a scheduled task immediately, bypassing the cleanest-window pick. Receipt is tagged intensitySource=expedited.",
  },
  {
    name: "/ebb-ai:reschedule",
    args: "<task_id> <new_deadline>",
    desc: "Re-score a task against a new deadline. Lets you extend (more window for clean hour) or compress (may exceed carbon budget).",
  },
  {
    name: "/ebb-ai:retry",
    args: "<task_id>",
    desc: "Re-dispatch a task currently in failed status. New receipt overwrites the old. No-op for non-failed tasks.",
  },
  {
    name: "/ebb-ai:grid",
    args: "<zone> [--hours N]",
    desc: "Show current carbon intensity + next-24h forecast for a region. Useful for deciding now-vs-wait without queueing.",
  },
];

type Tool = {
  name: string;
  access: "read-only" | "write" | "write (dispatch)";
  desc: string;
};

const TOOLS: Tool[] = [
  {
    name: "get_grid_forecast",
    access: "read-only",
    desc: "Hourly carbon-intensity forecast for a region (gCO2/kWh + band). Backs /ebb-ai:grid.",
  },
  {
    name: "recommend_window",
    access: "read-only",
    desc: "Cleanest in-deadline window + alternatives + savings vs now. Non-committal planning.",
  },
  {
    name: "schedule_task",
    access: "write",
    desc: "Persist a task to the SQLite queue with a deadline. Returns task_id. Backs /ebb-ai:defer.",
  },
  {
    name: "check_queue_status",
    access: "read-only",
    desc: "List all tasks or detail for one (with receipt). Backs /ebb-ai:check.",
  },
  {
    name: "cancel_task",
    access: "write",
    desc: "Set a task's status to cancelled. Idempotent.",
  },
  {
    name: "expedite_task",
    access: "write (dispatch)",
    desc: "Dispatch immediately, bypassing the scheduled window. Requires a provider API key.",
  },
  {
    name: "update_deadline",
    access: "write",
    desc: "Re-score a task against a new deadline. Backs /ebb-ai:reschedule.",
  },
  {
    name: "retry_task",
    access: "write (dispatch)",
    desc: "Re-dispatch a failed task. Requires a provider API key. Backs /ebb-ai:retry.",
  },
  {
    name: "cancel_all",
    access: "write",
    desc: "Cancel every non-terminal task at once. Useful for clearing a corrupted queue.",
  },
];

const ENVS: Array<{ name: string; desc: string }> = [
  {
    name: "EBB_EIA_API_KEY",
    desc: "U.S. Energy Information Administration. Unlocks live data for the six US ISOs (CISO, ERCO, ISNE, MIDA-PJM, NY-NYIS, MIDW-MISO). Free at eia.gov/opendata/register.php.",
  },
  {
    name: "EBB_ENTSOE_SECURITY_TOKEN",
    desc: "ENTSO-E Transparency Platform. Unlocks live data for European zones (FR, DE, ES, IT, NL). Free at transparency.entsoe.eu.",
  },
  {
    name: "EBB_ELECTRICITY_MAPS_API_KEY",
    desc: "Electricity Maps free tier (100 req/day). Universal fallback for any other zone. Free at electricitymaps.com/free-tier-api.",
  },
  {
    name: "ANTHROPIC_API_KEY · OPENAI_API_KEY",
    desc: "Required only if you want ebb-ai to actually dispatch provider calls (vs. just queueing them). Either is enough.",
  },
];

function CommandCard({ cmd }: { cmd: Cmd }) {
  return (
    <div className="rounded-md border border-rule bg-bg-card p-4">
      <code className="block font-mono text-sm font-semibold text-fg">
        {cmd.name}
      </code>
      <code className="mt-1 block font-mono text-[12px] text-fg-muted">
        {cmd.args}
      </code>
      <p className="mt-2 text-sm leading-relaxed text-fg-muted">{cmd.desc}</p>
    </div>
  );
}

function PathCard({ path, desc }: { path: string; desc: string }) {
  return (
    <div className="rounded-md border border-rule bg-bg-card p-4">
      <code className="font-mono text-sm font-semibold text-fg">{path}</code>
      <p className="mt-2 text-sm leading-relaxed text-fg-muted">{desc}</p>
    </div>
  );
}
