# @ebb-ai/cli

**The `ebb` command: runs your queued ebb-ai tasks when their cleanest grid hour arrives.**

`ebb` drains the ebb-ai task queue on a timer. A task that your agent deferred runs at the lowest-carbon hour before its deadline, also when no agent session is open.

- `ebb tick` dispatches every task that is due. `ebb install` wires it to launchd on macOS.
- `ebb queue list` and `ebb receipts list` show queued tasks and their carbon receipts.
- `ebb verify <task-id>` checks a receipt's Ed25519 signature offline.

```bash
npm install -g @ebb-ai/cli
```

```bash
ebb install --laptop          # run `ebb tick` on a schedule; register wake events across sleep
ebb queue list                # what is waiting, and for which hour
ebb tick --region GB          # dispatch what is due now
ebb receipts list             # one carbon receipt per completed task
ebb verify <task-id>          # check the receipt signature
```

Proof: one real GB run, 2026-09-30 (`ebb tick` + `ebb verify`). Forecast peak 183 gCO2/kWh vs recommended window 88 gCO2/kWh, about 52 % lower for this run only (forecast, projected). The task had a 5-minute deadline and ran at once; its receipt records 158 gCO2/kWh (measured). Raw output: https://github.com/Vitalini/ebb-ai/tree/main/docs/examples/2026-09-30-GB-tick

## Commands

```text
ebb tick           — drain due tasks via provider adapters; one OS notification per finished task (--no-notify)
ebb install        — wire up launchd (macOS) or print systemd / schtasks templates
ebb queue list     — print tasks (--unread, --kind absolute|quota_reset, --json, --hook)
ebb queue show     — print one task's prompt, result and receipt; marks it read
ebb queue unread   — mark a task unread again
ebb queue cancel   — cancel a pending task (--series ends a repeating series)
ebb queue reschedule — move a task: --by <2h|ISO>, --at <ISO>, or --day <yyyy-mm-dd>
ebb queue run-now  — mark a task due; the next tick runs it
ebb queue reply    — continue a completed task as a new task (--by, default 1h)
ebb receipts list  — print carbon receipts for completed tasks
ebb stats          — local-only personal-impact stats from the queue ledger
ebb verify         — verify the Ed25519 signature on a carbon receipt
ebb register-wake  — schedule a macOS wake event 30s before a task
ebb ui             — local task page: timeline, inbox, task detail, actions (127.0.0.1 only; never dispatches)
```

Run `ebb <command> --help` for flags.

The write commands and `ebb ui` change the ledger only; `ebb tick` (or the
OpenClaw loop) runs the task, and each command prints when the last tick ran.
`--day` and a repeating task's next occurrence can lie beyond the 72-hour
forecast. Such a task waits at a fallback hour (its current time of day, in
the new day) until a tick re-plans it once the forecast covers the day. If no
tick runs in that time, it runs at the fallback hour without a carbon choice.

## Quickstart — keep tasks alive across laptop sleep

```bash
ebb install --laptop
# follow the printed launchctl load / systemctl commands
```

`ebb install` resolves the daemon's invocation at install time to the exact
node interpreter plus the real `ebb` entry (`[process.execPath,
realpath(argv[1])]`), so the launchd job / systemd unit does not depend on a
bare `PATH` or a `#!/usr/bin/env node` shebang. Set `EBB_BINARY` to override
with a single wrapper executable.

## Secrets

> **Scope:** the environment variables below configure **this CLI** (and the
> `@ebb-ai/mcp` server, which reads the same set). The CLI reads them at its own
> entry point and injects them into `@ebb-ai/core`, which is environment-pure.
> The `@vitalini/ebb` **OpenClaw plugin reads no environment variables at all** —
> configure it under `plugins.entries.ebb.config` in your gateway config
> (`anthropicApiKey`, `openaiApiKey`, `geminiApiKey`/`googleApiKey`,
> `ollamaHost`, `ollamaModels`, `eiaApiKey`, `electricityMapsApiKey`,
> `entsoeSecurityToken`, `wattTimeUsername`/`wattTimePassword`, `carbonBudgetG`,
> `carbonBudgetWindow`). OpenClaw resolves the `"${ENV_VAR}"` shorthand in those
> fields, so you can keep exporting the same variables and let the gateway read
> them on the plugin's behalf.

Provider (and grid-feed) API keys live in `~/.config/ebb/env` — `KEY=VALUE`
lines, created `0600` with a commented template on first `ebb install`. Both
`ebb tick` (loads it at startup) and the systemd unit (`EnvironmentFile=`)
read it, so launchd, systemd, and manual cron all pick up keys the same way:

```
ANTHROPIC_API_KEY=sk-...
OPENAI_API_KEY=sk-...
GEMINI_API_KEY=...        # or GOOGLE_API_KEY — Gemini (generativelanguage.googleapis.com)
OLLAMA_HOST=http://localhost:11434   # local Ollama; presence opts the ollama provider in
```

Providers: `anthropic` and `openai` are batch-capable (their tasks can
auto-route through a 50%-cheaper Batch API — projected, provider list
price); `gemini` and `ollama` are
sync-only. Gemini reads `GEMINI_API_KEY`, falling back to `GOOGLE_API_KEY`.
Ollama is local and keyless — set `OLLAMA_HOST` (default `http://localhost:11434`)
to enable it; optionally list local model ids in `OLLAMA_MODELS` (comma-separated)
so `schedule_task` can infer the `ollama` provider from a bare model name.

`ebb tick` prints a loud warning when pending tasks need a provider key that
is not set. (Ollama is keyless, so a pending Ollama task is never flagged.)

## Platform support

| Platform | Daemon install | Wake-from-sleep |
| --- | --- | --- |
| macOS | launchd plist (`ebb install`) | `pmset schedule wake` via `ebb register-wake` / the `--laptop` helper |
| Linux | systemd user `.service` + `.timer` (`ebb install`) | `rtcwake` via `ebb register-wake` / the `--laptop` helper |
| Windows | not auto-installed — `ebb install` prints a ready-to-paste `schtasks` command; run `ebb tick` under Task Scheduler or nssm yourself | not supported (use Task Scheduler's "wake the computer" option) |

Wake events (`pmset` / `rtcwake`) need root. When not running as root,
`ebb register-wake` prints the exact `sudoers` line to pre-authorize the
command without a password prompt.

## Develop

From the root of a clone of https://github.com/Vitalini/ebb-ai:

```bash
pnpm install
pnpm --filter @ebb-ai/core build
pnpm --filter @ebb-ai/cli build
node packages/cli/dist/index.js --help
```
