import type { Metadata } from "next";
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

      <section id="energy" className="space-y-6">
        <header className="space-y-1">
          <p className="font-mono text-[11px] uppercase tracking-wider text-accent">
            energy estimation
          </p>
          <h2 className="text-2xl font-semibold tracking-tight">
            Per-model Wh/token coefficients (v0.10+)
          </h2>
          <p className="text-sm text-fg-muted">
            Carbon receipts are computed from real per-model energy data —
            not a flat placeholder. Sources: Patterson et al. 2021
            (arXiv:2104.10350), Luccioni, Jernite, Strubell 2024
            &ldquo;Power Hungry Processing&rdquo; (FAccT 2024, arXiv:2311.16863),
            and the Hugging Face AI Energy Score.
          </p>
        </header>

        <div className="overflow-x-auto rounded-md border border-rule bg-bg-card">
          <table className="min-w-full text-sm">
            <thead className="bg-bg-elev text-left font-mono text-[11px] uppercase tracking-wider text-fg-dim">
              <tr>
                <th className="px-4 py-2 font-normal">Model class</th>
                <th className="px-4 py-2 font-normal">Wh/input&nbsp;tok</th>
                <th className="px-4 py-2 font-normal">Wh/output&nbsp;tok</th>
                <th className="px-4 py-2 font-normal">Typical&nbsp;call*</th>
                <th className="px-4 py-2 font-normal">Source</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-rule font-mono text-xs text-fg-muted">
              <tr>
                <td className="px-4 py-2 text-fg">claude-opus-4 · gpt-4-turbo · o1 · gemini-1.5-pro</td>
                <td className="px-4 py-2">0.003</td>
                <td className="px-4 py-2">0.015</td>
                <td className="px-4 py-2">~10.4 Wh</td>
                <td className="px-4 py-2">estimated</td>
              </tr>
              <tr>
                <td className="px-4 py-2 text-fg">claude-sonnet-4 · llama-3.1-70b</td>
                <td className="px-4 py-2">0.001</td>
                <td className="px-4 py-2">0.005</td>
                <td className="px-4 py-2">~3.5 Wh</td>
                <td className="px-4 py-2">estimated / measured</td>
              </tr>
              <tr>
                <td className="px-4 py-2 text-fg">claude-haiku · gpt-4o-mini · gemini-flash · o1-mini</td>
                <td className="px-4 py-2">0.0003 – 0.0006</td>
                <td className="px-4 py-2">0.0015 – 0.003</td>
                <td className="px-4 py-2">~1.0 – 2.1 Wh</td>
                <td className="px-4 py-2">estimated</td>
              </tr>
              <tr>
                <td className="px-4 py-2 text-fg">llama-3.1-8b · mistral-7b</td>
                <td className="px-4 py-2">0.0002</td>
                <td className="px-4 py-2">0.001</td>
                <td className="px-4 py-2">~0.7 Wh</td>
                <td className="px-4 py-2">measured</td>
              </tr>
              <tr>
                <td className="px-4 py-2 text-fg">llama-3.1-405b · gpt-4</td>
                <td className="px-4 py-2">0.005</td>
                <td className="px-4 py-2">0.025</td>
                <td className="px-4 py-2">~17 Wh</td>
                <td className="px-4 py-2">measured / estimated</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p className="text-xs text-fg-dim">
          * Typical = 500 input + 500 output tokens × <code>DEFAULT_PUE = 1.15</code>.
          Closed-model coefficients are inferred from public parameter-count
          disclosures and the Luccioni scaling curve; may be off by ±50%.
          Each entry in <code>MODEL_ENERGY_COEFFICIENTS</code> carries a
          <code>source</code> field of <code>&quot;measured&quot;</code>,{" "}
          <code>&quot;estimated&quot;</code>, or <code>&quot;fallback&quot;</code> so
          dashboards can render confidence alongside numbers.
        </p>

        <div className="rounded-md border border-rule bg-bg-card p-4 font-mono text-xs leading-relaxed text-fg-muted">
          <p className="mb-2 text-fg">Public API (<code>@ebb-ai/core</code> 0.10+, <code>ebb_ai</code> 0.6+)</p>
          <pre className="overflow-x-auto whitespace-pre text-fg">
{`import {
  estimateEnergyKwh,
  gramsForIntensity,
  lookupModelEnergy,
  MODEL_ENERGY_COEFFICIENTS,
  ENERGY_SOURCES,
  DEFAULT_PUE,
  LEGACY_KWH_PER_TASK,
} from "@ebb-ai/core";

estimateEnergyKwh({
  model: "claude-sonnet-4",
  inputTokens: 1000,
  outputTokens: 2000,
});
// => 0.01265 kWh (1.0 in + 10.0 out Wh chip × 1.15 PUE)

gramsForIntensity(400, { model: "claude-haiku-4-5" });
// => 0.41 g CO2e (haiku at 400 g/kWh grid)

estimateEnergyKwh();
// => 0.0015 kWh (v0.1-v0.9 flat fallback, bit-exact)`}
          </pre>
        </div>
      </section>

      <section id="receipts" className="space-y-6">
        <header className="space-y-1">
          <p className="font-mono text-[11px] uppercase tracking-wider text-accent">
            verifiable receipts
          </p>
          <h2 className="text-2xl font-semibold tracking-tight">
            Ed25519-signed carbon receipts (v0.11+)
          </h2>
          <p className="text-sm text-fg-muted">
            Every dispatched task ships a cryptographic signature so
            any consumer can verify, offline and asynchronously, that
            (1) the receipt was produced by an ebb-ai installation
            holding the matching private key, and (2) none of the
            receipt&apos;s fields have been tampered with since signing.
            Direct path to B2B ESG export — receipts are auditable
            artefacts, not just claims.
          </p>
        </header>

        <div className="space-y-3">
          <p className="text-sm text-fg-muted">
            Keys live at <code className="rounded bg-bg-elev px-1 font-mono text-xs">~/.ebb-ai/signing.key</code>{" "}
            (private, <code className="font-mono text-xs">0600</code>) and
            {" "}<code className="rounded bg-bg-elev px-1 font-mono text-xs">signing.key.pub</code>{" "}
            (public). Generated lazily on first dispatch — no opt-in
            friction. They never leave the machine; verification
            consumers bundle the receipt&apos;s{" "}
            <code className="rounded bg-bg-elev px-1 font-mono text-xs">signerPublicKey</code>{" "}
            with the receipt itself, so downstream pipelines can pin
            the key on first sight.
          </p>
        </div>

        <div className="rounded-md border border-rule bg-bg-card p-4 font-mono text-xs leading-relaxed text-fg-muted">
          <p className="mb-2 text-fg">CLI</p>
          <pre className="overflow-x-auto whitespace-pre text-fg">
{`# Verify the receipt for a completed task in the local ledger
$ ebb verify 1c5b...e0

✓ VALID

task_id           1c5b...e0
region            US-CAL-CISO
ran_at            2026-06-01T13:00:00.000Z
actual_g_co2      2.4
estimated_g_co2   2.6
delta_pct         -7.7
model             claude-sonnet-4-5
provider          anthropic

signer_public_key OnTm5l9VbQHFv9wD...
signed_at         2026-06-01T13:00:00.184Z

Ed25519 signature verified against canonical payload (412 bytes)

# Verify a receipt JSON file (e.g. as shipped to outputPath)
$ ebb verify --file ./out/task-1c5b.json --json
{ "outcome": "valid", "signerPublicKey": "OnTm5l9VbQHFv9wD...", ... }

# Pin the expected signer for B2B/ESG pipelines
$ ebb verify --file ./inbox/receipt.json --trusted-public-key OnTm5l9V...
# exit 0 on match; exit 3 on key-mismatch`}
          </pre>
        </div>

        <div className="rounded-md border border-rule bg-bg-card p-4 font-mono text-xs leading-relaxed text-fg-muted">
          <p className="mb-2 text-fg">Library (TypeScript)</p>
          <pre className="overflow-x-auto whitespace-pre text-fg">
{`import {
  signReceipt,
  verifyReceipt,
  loadOrCreateSigningKey,
} from "@ebb-ai/core";

const keyPair = loadOrCreateSigningKey();
const signed = signReceipt(receipt, keyPair);

const result = verifyReceipt(signed);
// { outcome: "valid" | "tampered" | "legacy-unsigned" | "key-mismatch", ... }`}
          </pre>
        </div>

        <div className="rounded-md border border-rule bg-bg-card p-4 font-mono text-xs leading-relaxed text-fg-muted">
          <p className="mb-2 text-fg">Library (Python — opt-in)</p>
          <pre className="overflow-x-auto whitespace-pre text-fg">
{`# pip install "ebb-ai[signing]"   (pulls in the cryptography library)

from ebb_ai import (
    sign_receipt, verify_receipt,
    load_or_create_signing_key, is_signing_available,
)

key_pair = load_or_create_signing_key()
signed = sign_receipt(receipt_dict, key_pair)
result = verify_receipt(signed)
# VerifyResult(outcome='valid', signer_public_key=..., reason=...)`}
          </pre>
        </div>

        <p className="text-xs text-fg-dim">
          Verifier outcomes: <code>valid</code>, <code>tampered</code>{" "}
          (signed but no longer matches), <code>legacy-unsigned</code>{" "}
          (pre-v0.11 receipt — accept-or-reject is the consumer&apos;s
          policy), <code>key-mismatch</code> (signed by someone other
          than the trusted public key). CLI exit codes mirror these:
          0 / 1 / 2 / 3.
        </p>
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
            path="~/.ebb-ai/signing.key"
            desc="Per-installation Ed25519 private key (0600, with `signing.key.pub` alongside). Lazily generated on first dispatch; signs every carbon receipt so consumers can verify offline via `ebb verify`. Local-only — ebb-ai never sends it anywhere. v0.11+."
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
          <a
            href="https://github.com/Vitalini/ebb-ai#architecture"
            className="rounded-md border border-rule bg-bg-card p-4 transition-colors hover:border-accent/40 hover:bg-accent/5"
          >
            <p className="font-semibold text-fg">Architecture</p>
            <p className="mt-1 text-sm text-fg-muted">
              System diagram, ingest→dispatch→receipt flow, and what&apos;s
              deliberately out of scope.
            </p>
          </a>
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
    desc: "Required only if you want ebb-ai to actually dispatch provider calls (vs. just queueing them). Either is enough. anthropic and openai can auto-route through a 50%-cheaper Batch API when the deadline allows.",
  },
  {
    name: "GEMINI_API_KEY · GOOGLE_API_KEY",
    desc: "Dispatch through Google Gemini (generativelanguage.googleapis.com). GEMINI_API_KEY is preferred; GOOGLE_API_KEY is the fallback. Sync-only (no Batch API).",
  },
  {
    name: "OLLAMA_HOST · OLLAMA_MODELS",
    desc: "Dispatch through a local Ollama server (default http://localhost:11434). Keyless — setting OLLAMA_HOST opts the ollama provider in. OLLAMA_MODELS (comma-separated) lets schedule_task infer the ollama provider from a bare model name. Sync-only.",
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
