# ebb-ai v0.7.1 release notes

![ebb-ai v0.7.1 — Persistent queue. Full CRUD.](./images/hero.png)

**Date:** 2026-05-14
**Tag:** [`v0.7.1`](https://github.com/Vitalini/ebb-ai/releases/tag/v0.7.1)
**Affected packages:** `@ebb-ai/mcp@0.7.1` (others unchanged at 0.7.0)
**Affected plugin:** `ebb-ai@0.7.1` (Claude Code marketplace)

## TL;DR

v0.7.1 fixes two UX bugs reported within hours of the v0.7.0 plugin
ship:

1. **The queue is no longer in-memory by default** — tasks queued via
   `/ebb-ai:defer` now persist to `~/.ebb-ai/queue.db` and survive
   Claude Code restarts.
2. **Full CRUD via slash commands** — the v0.7.0 plugin only exposed
   `defer / check / grid`; the MCP server already had eight tools, but
   the rest required asking Claude verbally to call the right MCP
   tool. v0.7.1 adds five more slash commands and one new bulk tool.

No `@ebb-ai/core` or `@ebb-ai/cli` changes — only `@ebb-ai/mcp` got a
patch bump.

---

## What's new

### 1. Persistent queue by default

The MCP server opens a SQLite-backed `TaskStore` at
`~/.ebb-ai/queue.db` on first call.

- Tasks queued in one Claude Code session are visible in another, and
  in Claude Desktop / Cursor / Cline / Zed / OpenClaw.
- `schedule_task` now defaults to `dispatch=true` — the request body
  is a real `provider_call` spec that `ebb tick` can dispatch, rather
  than an in-memory closure that dies with the process.
- Override the location with `EBB_DB_PATH=/path/to/queue.db` in your
  plugin's `.mcp.json` env block.
- Opt out entirely with `EBB_DB_PATH=:memory:` (better-sqlite3
  treats `:memory:` as an ephemeral database — useful for tests).

#### Sharp edge

The MCP server **queues** tasks; it does not run a clock. Actual
dispatch at the chosen window requires the **`ebb tick` daemon**.
v0.7.1 does not auto-install it (modifying launchd / systemd at
plugin-install time felt too aggressive for a v0.x patch). Install
manually:

```bash
npm install -g @ebb-ai/cli
ebb install      # registers launchd (macOS) / systemd (Linux) cron-tick
```

Without the daemon, tasks pile up in `~/.ebb-ai/queue.db` waiting for
someone to call `ebb tick --once`. The `/ebb-ai:defer` response now
includes a one-paragraph reminder of this.

### 2. Full CRUD slash commands

Eight commands total in the plugin now:

```
/ebb-ai:defer       queue a deferrable LLM task
/ebb-ai:plan        preview the chosen window without committing
/ebb-ai:check       list / detail of queued tasks
/ebb-ai:cancel      drop a task; --all for bulk
/ebb-ai:expedite    run a task now, bypass the carbon window
/ebb-ai:reschedule  change the deadline, re-score
/ebb-ai:retry       re-dispatch a failed task
/ebb-ai:grid        look at the grid, no task involved
```

`/ebb-ai:defer` got two new flags:

- `--output <abs-path>` — write `{ taskId, result, receipt }` as JSON
  to that path when the task completes. Pair with `tail -f`,
  `fswatch`, or `entr` to get a desktop-grade "task done" surface.
- `--provider <anthropic|openai>` — pick provider explicitly. Default
  remains `anthropic`.

### 3. New MCP tool: `cancel_all`

Bulk-cancel every queued/scheduled task at once. Optional `status`
filter (`queued` or `scheduled`). Running/completed/failed/cancelled
tasks are left alone.

```
/ebb-ai:cancel --all
```

### 4. Updated skill

`carbon-aware-coding` now teaches Claude the full eight-command
surface, mentions the SQLite path, and explicitly coaches the
"daemon not installed → tasks won't dispatch" diagnostic so it can
help users debug.

---

## Compatibility

- v0.7.0 plugin installs are forward-compatible — the marketplace
  publishes 0.7.1 automatically; users just need to restart Claude
  Code (or run `/reload-plugins`).
- `npx -y @ebb-ai/mcp` resolves to the latest `0.7.1` on next invoke
  — no manual reinstall needed.
- Tasks queued under v0.7.0 (in-memory closure mode) are lost on
  upgrade (they were already lost on every restart). Anything queued
  via `dispatch=true` in v0.7.0 will be readable from
  `~/.ebb-ai/queue.db` if the user set `EBB_DB_PATH` manually.

---

## Upgrade

```bash
# In any Claude Code session
/reload-plugins
```

Or restart `claude`. The marketplace pulls the new `marketplace.json`
on every reload; the MCP `npx -y @ebb-ai/mcp` resolves to the latest
version on each spawn. No manual `claude plugin update` needed.

---

## Credits

Persistence-by-default and the full CRUD command set were both flagged
within minutes of the v0.7.0 launch when the maintainer test-drove
the install path on a fresh machine. Faster feedback loop than the
average open-source project gets in a week; this release would have
taken three days otherwise.
