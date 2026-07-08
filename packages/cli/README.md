# @ebb-ai/cli

The `ebb` binary — cron-tick drain, launchd install, and sleep-prevention
for the [ebb-ai](https://github.com/Vitalini/ebb-ai) carbon-aware scheduler.

## Install

From the repo root:

```bash
pnpm --filter @ebb-ai/core build
pnpm --filter @ebb-ai/cli build
```

## Commands

```text
ebb tick           — drain due tasks via provider adapters
ebb install        — wire up launchd (macOS) or print systemd / schtasks templates
ebb queue list     — print queued / scheduled / running / completed tasks
ebb receipts list  — print carbon receipts for completed tasks
ebb register-wake  — schedule a macOS wake event 30s before a task
```

Run `ebb <command> --help` for flags.

## Quickstart — keep tasks alive across laptop sleep

```bash
node packages/cli/dist/index.js install --laptop
# follow the printed launchctl load / systemctl commands
```

`ebb install` resolves the daemon's invocation at install time to the exact
node interpreter plus the real `ebb` entry (`[process.execPath,
realpath(argv[1])]`), so the launchd job / systemd unit does not depend on a
bare `PATH` or a `#!/usr/bin/env node` shebang. Set `EBB_BINARY` to override
with a single wrapper executable.

## Secrets

Provider (and grid-feed) API keys live in `~/.config/ebb/env` — `KEY=VALUE`
lines, created `0600` with a commented template on first `ebb install`. Both
`ebb tick` (loads it at startup) and the systemd unit (`EnvironmentFile=`)
read it, so launchd, systemd, and manual cron all pick up keys the same way:

```
ANTHROPIC_API_KEY=sk-...
OPENAI_API_KEY=sk-...
```

`ebb tick` prints a loud warning when pending tasks need a provider key that
is not set.

## Platform support

| Platform | Daemon install | Wake-from-sleep |
| --- | --- | --- |
| macOS | launchd plist (`ebb install`) | `pmset schedule wake` via `ebb register-wake` / the `--laptop` helper |
| Linux | systemd user `.service` + `.timer` (`ebb install`) | `rtcwake` via `ebb register-wake` / the `--laptop` helper |
| Windows | not auto-installed — `ebb install` prints a ready-to-paste `schtasks` command; run `ebb tick` under Task Scheduler or nssm yourself | not supported (use Task Scheduler's "wake the computer" option) |

Wake events (`pmset` / `rtcwake`) need root. When not running as root,
`ebb register-wake` prints the exact `sudoers` line to pre-authorize the
command without a password prompt.
