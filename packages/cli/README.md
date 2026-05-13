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
# follow the printed launchctl load command
```

## Status

v0.4. macOS fully wired. Linux + Windows currently emit `TODO: planned for v0.5`
notes; the code path runs cleanly but does not register cron jobs.
