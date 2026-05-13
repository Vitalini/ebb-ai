# Quick start

**Four steps. Five minutes. Carbon-aware AI scheduling on your machine.**

---

## Step 1 — Install ebb-ai

```bash
git clone https://github.com/Vitalini/ebb-ai
cd ebb-ai
pnpm install
pnpm build
```

Requirements: **Node 20+**, **pnpm 9+**, **Python 3.11+** if you want
the Python package.

> No npm / PyPI publish yet — install from source for now.

---

## Step 2 — (Optional) Add an Electricity Maps API key

Without a key, ebb-ai uses a deterministic mock grid feed — the whole
stack still works end-to-end. With a key, you get live data.

```bash
export EBB_ELECTRICITY_MAPS_API_KEY="..."   # free tier at electricitymaps.com
```

---

## Step 3 — Wire ebb-ai into your agent

### A. Claude Desktop

Edit `~/Library/Application Support/Claude/claude_desktop_config.json`
(macOS) or `%APPDATA%\Claude\claude_desktop_config.json` (Windows):

```json
{
  "mcpServers": {
    "ebb-ai": {
      "command": "node",
      "args": ["/absolute/path/to/ebb-ai/packages/mcp-server/dist/server.js"],
      "env": {
        "EBB_ELECTRICITY_MAPS_API_KEY": "optional"
      }
    }
  }
}
```

Restart Claude Desktop. The three ebb-ai tools appear in the agent's
tool list.

### B. Claude Code

```bash
claude mcp add ebb-ai node /absolute/path/to/ebb-ai/packages/mcp-server/dist/server.js
```

### C. OpenClaw

```bash
cp -r examples/openclaw-skill ~/.openclaw/skills/ebb-ai
```

Reload OpenClaw. The skill describes when to use ebb-ai; the MCP server
exposes the actual tools.

### D. As a TypeScript library

```typescript
import { defer } from "@ebb-ai/core";

const result = await defer(
  () => anthropic.messages.create({ /* … */ }),
  {
    deadline: "2026-05-13T08:00:00-04:00",
    carbonBudgetG: 5,
    region: "US-CAL-CISO",
  },
);
```

### E. As a Python library

```bash
pip install -e "packages/core-py[anthropic,openai]"
```

```python
import asyncio
from ebb_ai import defer

asyncio.run(defer(
    lambda: do_work(),
    deadline="2026-05-13T08:00:00-04:00",
    carbon_budget_g=5,
    region="US-CAL-CISO",
))
```

---

## Step 4 — Try it

In your agent host:

> Run `analyze the last 30 days of git commits and write a summary report`,
> but defer it to the cleanest carbon window in the next 12 hours.

The agent will:

1. Call `get_grid_forecast("US-CAL-CISO", 12)` — see the next 12 hours.
2. Call `schedule_task(prompt, deadline=now+12h, region="US-CAL-CISO")` —
   queue the task.
3. Get back a `task_id` and the scheduled time.
4. At the chosen window, ebb-ai dispatches and writes a carbon receipt.
5. Agent polls `check_queue_status(task_id)` to retrieve the result and
   receipt.

---

## Step 5 — (optional, macOS) Make tasks survive a closed laptop

Without this step, deferred tasks live only as long as the MCP host
process. Close Claude Desktop, sleep your laptop, and a 3am task runs
when you wake it — not at 3am.

```bash
pnpm --filter @ebb-ai/cli build
node packages/cli/dist/index.js install --laptop
```

This writes:
- `~/Library/LaunchAgents/com.ebb-ai.tick.plist` — runs `ebb tick`
  every 5 minutes.
- `~/.ebb/laptop-wake.sh` — pre-registers `pmset` wake events for
  scheduled tasks. Requires a sudoers entry for `pmset schedule wake`
  if you want it to run unattended.

Then:

```bash
launchctl load ~/Library/LaunchAgents/com.ebb-ai.tick.plist
tail -f ~/.ebb/tick.log    # see the cron in action
```

Server / always-on Linux box variant:

```bash
node packages/cli/dist/index.js install --server
```

Linux + Windows: `install` emits a systemd unit / `schtasks` command
template — copy + adapt. Native daemonization for both lands in v0.5.

---

## What lives where (when something breaks)

| You want | Where to look |
|---|---|
| Live carbon dashboard | `pnpm --filter @ebb-ai/dashboard dev` → http://localhost:3000 |
| Queue ledger | `sqlite3 ~/.ebb/queue.sqlite` (or wherever you point `dbPath`) |
| Carbon receipts | Same SQLite — `SELECT * FROM tasks WHERE status = 'completed';` |
| Force a quick sanity run | `pnpm --filter @ebb-ai/core test` |

---

## Honest caveats

- **Computer must be awake** when the chosen window fires. v0.2 keeps
  timers in-process. If your laptop sleeps at midnight and a task is
  due at 3am, it will run when the laptop wakes (not at 3am). The
  always-on `ebb tick` + macOS pmset wake events are queued for v0.3.
- **`schedule_task` does not call the LLM itself.** It picks the
  window. The agent calling the tool is expected to execute the
  prompt when the window arrives. (The provider adapters in
  `@ebb-ai/core` can do the actual LLM dispatch — see the library
  examples above.)
- **Carbon estimates use a placeholder energy coefficient**
  (0.0015 kWh per task). Per-model coefficients land in v0.3.

---

## Next reads

- [Architecture](./apps/site/architecture.html) — system diagram + data flow
- [Roadmap](./apps/site/roadmap.html) — v0.1 → v1.0
- [PLAN.md](./PLAN.md) — full 24-week execution plan
- [CHANGELOG.md](./CHANGELOG.md) — what shipped in v0.2

Bugs and feature ideas: [Issues](https://github.com/Vitalini/ebb-ai/issues).
