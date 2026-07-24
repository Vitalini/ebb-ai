# @vitalini/ebb

OpenClaw plugin that exposes ebb-ai as native OpenClaw tools.
Published on ClawHub as `@vitalini/ebb`; its runtime id in the gateway
is `ebb`.

When a user says "do this later", "by tomorrow", "tonight", "overnight",
"by EOD", "remind me to", or any other deferral phrase, this plugin's
`schedule_task` tool gets invoked automatically — the LLM dispatch is
routed to the cleanest electricity-grid hour inside the deadline,
40-70 % lower carbon vs running immediately.

## Tools registered

Tool names match the `@ebb-ai/mcp` MCP-server surface (no `ebb_` prefix).

| Tool                  | Purpose                                                       |
|-----------------------|---------------------------------------------------------------|
| `schedule_task`       | Queue a task at the cleanest hour. The deferral trigger.      |
| `recommend_window`    | Preview the cleanest hour without queueing. Read-only.        |
| `check_queue_status`  | List all tasks / detail one (with carbon receipt). Read-only. |
| `cancel_task`         | Cancel a queued task. Idempotent.                             |
| `get_grid_forecast`   | Hourly grid carbon-intensity forecast. Read-only.             |
| `update_deadline`     | Move a queued/scheduled task's deadline.                      |
| `cancel_all`          | Cancel every queued/scheduled task at once.                   |
| `set_delivery`        | Choose how a task's result is delivered when it completes.    |
| `expedite_task`       | Dispatch a queued/scheduled task now, skipping the window.    |
| `retry_task`          | Re-dispatch a failed task.                                    |

## Result delivery

When a deferred task completes, its result is delivered through the
mode(s) chosen per task — `chat` (the active OpenClaw chat), `telegram`,
`webhook` (POST to any URL), `file` (a report in md/html/txt/json/pdf),
`queue` (no push), or `os` (a native desktop notification on the gateway
host). The result is always kept in the queue too. Call `set_delivery`
right after `schedule_task`, once you've asked the user how they want the
result. Default: `chat`.

The `os` mode is dependency-free — it spawns the platform's built-in
notifier (`osascript` on macOS, `notify-send` on Linux, a PowerShell toast
on Windows). Unsupported platform or a missing binary records an honest
delivery failure (visible via `check_queue_status`) rather than throwing.

The `pdf` file format renders the same HTML report through **puppeteer's**
headless Chrome. puppeteer is an *optional* dependency — it is not bundled
and not required to install the plugin. Add it only if you want PDF output,
where the gateway loaded the plugin, then restart the gateway:

```bash
cd ~/.openclaw/extensions/ebb && npm install puppeteer
```

If puppeteer is absent when a `pdf` delivery runs, the delivery records a
clear, actionable failure (surfaced via `check_queue_status`) with these
exact install steps, and the report is still kept in the queue.

## Install

**Requires Node 22.5 or newer** — the SQLite queue uses Node's built-in
`node:sqlite` with no fallback, so the OpenClaw gateway must run on Node
≥ 22.5 (declared in `engines`).

```bash
openclaw plugins install clawhub:@vitalini/ebb
```

Restart the OpenClaw gateway. To update later:
`openclaw plugins update @vitalini/ebb`.

## Verify the install (smoke test)

After installing and restarting the gateway:

1. **Inspect** — all ten tools should be listed:

   ```bash
   openclaw plugins inspect ebb --runtime --json
   ```

   The `tools` array contains `schedule_task`, `recommend_window`,
   `check_queue_status`, `cancel_task`, `get_grid_forecast`,
   `update_deadline`, `cancel_all`, `set_delivery`, `expedite_task`,
   `retry_task`. (`Shape: non-capability` in the plain
   `inspect` output is the normal label OpenClaw gives tool plugins — it
   is not an error.)

2. **Validate** the installed package:

   ```bash
   openclaw plugins validate --root ~/.openclaw/extensions/ebb --entry ./dist/index.js
   ```

3. **Exercise the tools** in any OpenClaw session:
   - "preview the cleanest window for a task due tomorrow 6pm in GB"
     → `recommend_window`
   - "do this overnight: summarise today's commits" → `schedule_task`
   - "what's in my ebb queue?" → `check_queue_status`

The queue is a SQLite ledger opened through Node's built-in `node:sqlite`
(Node ≥ 22.5) — there is no native module to compile, so a fresh install
needs no extra build step.

### Building from source

```bash
pnpm --filter @vitalini/ebb build          # bundle to dist/index.js
openclaw plugins build    --root packages/openclaw-plugin --entry ./dist/index.js
openclaw plugins validate --root packages/openclaw-plugin --entry ./dist/index.js
pnpm --filter @vitalini/ebb test           # run the plugin test suite
```

Pack and install the tarball directly (no ClawHub round-trip):

```bash
cd packages/openclaw-plugin && npm pack
openclaw plugins install ./vitalini-ebb-<version>.tgz
```

## Configuration

Optional config schema:

```json
{
  "dbPath": "/home/you/.ebb-ai/queue.db",
  "defaultRegion": "GB"
}
```

`dbPath` defaults to `~/.ebb-ai/queue.db` — the same path used by
`@ebb-ai/mcp` (MCP server) and `@ebb-ai/cli` (CLI). All three share
one ledger, so deferring a task in OpenClaw and listing it from
`ebb stats` Just Works.

`defaultRegion` — the grid region used when a tool call doesn't name
one. **Leave it unset and ebb-ai auto-detects the region from the host
machine's timezone:** `Europe/London`→`GB`,
`America/Los_Angeles`→`US-CAL-CISO`, `America/New_York`→`US-MIDA-PJM`,
`Europe/Paris`→`FR`, `Europe/Berlin`→`DE`. Timezones it can't map fall
back to `GB` (always-live data via UK National Grid ESO, no API key).
Set `defaultRegion` explicitly for any other region (`US-TEX-ERCO`,
`US-NE-ISNE`, …). Each tool call may also pass its own `region`, which
overrides everything; `schedule_task` reports a `region_source`
(`request` / `config` / `timezone` / `default`) so you can see which
rule applied. Non-GB regions may need `EBB_*_API_KEY` env vars for live
data, otherwise a deterministic mock is used.

## When does the plugin auto-invoke?

The `schedule_task` tool description tells the LLM to invoke when
the user's phrasing signals deferral:

- "do this later" / "by tomorrow" / "tonight" / "overnight"
- "by EOD" / "this week" / "next week"
- "when you have a moment" / "remind me to"
- "queue this up" / "schedule this"
- "no rush" / "not urgent"

For interactive tasks ("summarize this", "what does X do", "write a
function") the plugin stays out of the way.

## License

Apache-2.0 © Vitalii Borovyk · https://github.com/Vitalini/ebb-ai
