# ebb-ai (Python)

**Carbon-aware scheduling for agentic AI workflows.**

`ebb-ai` defers non-urgent LLM calls to execution windows that are
simultaneously cleaner on the electricity grid, cheaper at the
provider, and friendlier to your hardware budget. The same agent code
that would have made a synchronous LLM call now hands the work to
`ebb-ai`, which picks the right time and the right route — and writes
a per-task carbon receipt you can audit.

This package is the Python port of [`@ebb-ai/core`](../core-ts/). The
two stay in lock-step on every public name; the only deliberate
asymmetry is that the Python port ships **SQLite-backed durable
persistence** from day one, while the TypeScript port is still
in-memory at v0.1. See [`ROADMAP.md`](../../ROADMAP.md) section 4.1.

> Status: v0.2 · 2026-05 · pre-PyPI, install from source.

---

## Why this exists

Modern AI agents call LLM APIs synchronously by default. Three costs follow:

- **Carbon.** Grid carbon intensity varies 30–60% inside a single day
  across the major US ISOs. Inference at 2 p.m. on a hot day is
  materially dirtier than the same call at 3 a.m.
- **Dollars.** Anthropic and OpenAI both offer batch APIs at a flat
  50% discount for tasks that can wait up to 24 hours. Almost no agent
  code uses them by default because it requires rewriting the call
  site.
- **Latency, honestly.** Off-peak *sync* execution is sometimes
  faster because providers throttle and queue at peak. **Batch API
  is *not* faster** — it trades latency (up to 24h SLA) for the
  50% discount.

`ebb-ai` fixes all three for any task that is not "answer me right now."

---

## Install

```bash
# from source (until the first PyPI release)
pip install -e packages/core-py

# with vendor extras
pip install -e "packages/core-py[anthropic,openai]"

# dev install for contributors
pip install -e "packages/core-py[dev,anthropic,openai]"
```

Python 3.11+. The core library only requires `httpx` and `aiosqlite`;
the Anthropic and OpenAI extras pull in the official vendor SDKs.

---

## Quick start

### 1. The five-line version

```python
import asyncio
from ebb_ai import defer

async def main():
    result = await defer(
        lambda: "do the work here",
        deadline="2026-05-13T08:00:00-04:00",  # "by 8am tomorrow my time"
        carbon_budget_g=5,                      # optional max grams CO2e
        region="US-CAL-CISO",                   # optional grid region
    )
    print(result)

asyncio.run(main())
```

`defer()` returns whatever the callable returns. The task body can be
sync or async; both work.

### 2. Hand-built scheduler with SQLite persistence

For long-running services you want a single, explicitly-constructed
scheduler with a durable queue:

```python
import asyncio
from ebb_ai import Scheduler, DeferOptions

async def main():
    async with Scheduler(db_path="/var/lib/ebb/queue.sqlite") as scheduler:
        await scheduler.defer(
            lambda: do_research_run(),
            DeferOptions(
                deadline="2026-05-13T08:00:00-04:00",
                carbon_budget_g=5,
                region="US-CAL-CISO",
                task_id="user:42:weekly-research",
            ),
        )

asyncio.run(main())
```

If the process restarts, the next `Scheduler(db_path=…)` will see the
completed receipts via `await scheduler.list_persisted_tasks()`.

### 3. Anthropic Batch API

```python
import asyncio
from ebb_ai import Scheduler, DeferOptions
from ebb_ai.providers import AnthropicAdapter

async def main():
    adapter = AnthropicAdapter()  # reads ANTHROPIC_API_KEY

    async def work():
        result = await adapter.dispatch(
            "claude-sonnet-4-5",
            "Summarize today's git commits.",
        )
        return result.text

    async with Scheduler() as scheduler:
        summary = await scheduler.defer(
            work,
            DeferOptions(
                deadline="2026-05-13T08:00:00-04:00",
                region="US-CAL-CISO",
            ),
        )
        print(summary)

asyncio.run(main())
```

For genuinely batched work (50+ prompts at once), use the Batch API
directly:

```python
handle = await adapter.dispatch_batch(
    "claude-sonnet-4-5",
    ["prompt 1", "prompt 2", "prompt 3"],
)
print(handle.batch_id)  # poll via the Anthropic SDK
```

### 4. OpenAI Batch API

```python
import asyncio
from ebb_ai.providers import OpenAIAdapter

async def main():
    adapter = OpenAIAdapter()  # reads OPENAI_API_KEY
    handle = await adapter.dispatch_batch(
        "gpt-4.1-mini",
        ["prompt 1", "prompt 2"],
    )
    print(handle.batch_id)
```

`OpenAIAdapter` builds the required JSONL input file in memory,
uploads it via `files.create(purpose="batch")`, and submits the batch
job — the standard OpenAI batch flow.

---

## API reference

### Top-level exports

| Name | Kind | Description |
|---|---|---|
| `defer(task, *, deadline, carbon_budget_g, region, task_id)` | async function | Defers on the process-wide default scheduler. |
| `Scheduler` | class | Explicit scheduler; supports SQLite persistence. |
| `mock_grid_feed()` | function | Deterministic synthetic feed for dev/tests. |
| `electricity_maps_feed(api_key=None)` | function | Electricity Maps free-tier API client. |
| `pick_best_window(entries, deadline)` | pure function | Picks the lowest-intensity entry inside `[now, deadline]`. |
| `normalize_deadline(d)` | function | Parses + validates a user-supplied deadline. |
| `CarbonBudgetExceededError` | exception | Raised when no candidate window meets the user budget. |
| `InvalidDeadlineError` | exception (`ValueError`) | Raised when the deadline is unparseable or in the past. |
| `TaskRecord`, `CarbonReceipt`, `GridForecast`, `GridForecastEntry`, `DeferOptions` | dataclasses | Public record types. |

### `Scheduler`

```python
Scheduler(*, feed: GridFeed | None = None,
          default_region: str = "US-CAL-CISO",
          db_path: str | None = None)
```

Methods:

- `await scheduler.connect()` — opens the SQLite connection (no-op
  when `db_path` is unset).
- `await scheduler.defer(task, opts)` — deferred await. Returns the
  task's eventual result.
- `scheduler.enqueue(task, opts)` — fire-and-forget. Returns the
  `TaskRecord` immediately with `status="queued"`.
- `scheduler.get_task(task_id)` / `scheduler.list_tasks()` — in-memory
  snapshots.
- `await scheduler.load_persisted_task(task_id)` /
  `await scheduler.list_persisted_tasks()` — reads from SQLite.
- `await scheduler.shutdown()` — cancels in-flight schedule tasks and
  closes the DB. The class also supports `async with`.

### Carbon-receipt schema

Every completed task has a `receipt` field:

```python
@dataclass
class CarbonReceipt:
    task_id: str
    ran_at: str
    region: str
    estimated_carbon_g_co2: float
    provider: str | None = None
    model: str | None = None
    duration_ms: float | None = None
```

The `TaskRecord` also carries `intensity_source`: `"scored"` if the
receipt used the forecast entry the scheduler chose against,
`"current"` if we had to fall back to a freshly-fetched current-hour
intensity at dispatch time.

The receipt's `estimated_carbon_g_co2` is computed via
`estimate_energy_kwh(model=..., input_tokens=..., output_tokens=...)
* grid_intensity_g_co2_per_kwh`. As of v0.6 the energy module ships
per-model Wh/token coefficients from the published research
(Patterson et al. 2021; Luccioni, Jernite, Strubell 2024; Hugging
Face AI Energy Score). When no model is specified the function
returns the pre-v0.6 flat `0.0015` kWh estimate to preserve
backwards compatibility. See `ebb_ai.energy` for the table and
citation metadata.

### Grid feeds

Both feeds implement `GridFeed.fetch_forecast(region, hours)`:

- `mock_grid_feed()` — deterministic intraday sinusoid with regional
  floors. Useful for dev and CI without an API key.
- `electricity_maps_feed(api_key=None)` — hits
  `api.electricitymap.org/v3/carbon-intensity/forecast` with a 5 s
  hard timeout. Falls back to the mock feed (and logs a warning) on
  any failure, mirroring the TypeScript port.

Supported region codes match Electricity Maps' zone codes
(`US-CAL-CISO`, `US-TEX-ERCO`, `US-NE-ISNE`, `US-NY-NYIS`,
`US-MIDA-PJM`, `US-MIDW-MISO`, `FR`, `DE`, `GB`, ...).

### Provider adapters

```python
from ebb_ai.providers import (
    AnthropicAdapter,
    OpenAIAdapter,
    GeminiAdapter,
    OllamaAdapter,
    DispatchOptions,
)
```

Every adapter implements the sync path:

```python
async def dispatch(model: str, prompt: str,
                   options: DispatchOptions | None = None) -> DispatchResult: ...
```

`AnthropicAdapter` and `OpenAIAdapter` are additionally batch-capable
(`dispatch_batch` + `retrieve_batch`, a flat 50% discount, 24h SLA). `GeminiAdapter`
and `OllamaAdapter` are sync-only and inherit the base batch stubs — the
scheduler feature-detects that and keeps their tasks on the sync path:

- **`GeminiAdapter`** — Google's Generative Language API
  (`generativelanguage.googleapis.com`). Reads `GEMINI_API_KEY`, falling back to
  `GOOGLE_API_KEY`. Batch is deliberately unsupported: Gemini's batch modes do
  not map onto the submit → poll → results contract (Vertex batch needs
  GCS/BigQuery; the Developer-API batch is a long-running operation keyed by an
  operation name, not a batch id).
- **`OllamaAdapter`** — a local Ollama server over HTTP (default
  `http://localhost:11434`, override with `OLLAMA_HOST`). Keyless. Uses
  `/api/chat` and reports `prompt_eval_count` / `eval_count` token counts. No
  batch (local inference).

The Anthropic / OpenAI modules import cleanly even when the vendor SDK isn't
installed — construction is what raises a clear error. Gemini and Ollama use
`httpx` directly (already a core dependency), so they need no extra SDK.

---

## Persistence (Python-only in v0.2)

The Python port ships SQLite-backed durability from day one. To enable
it, construct the `Scheduler` with a `db_path`:

```python
async with Scheduler(db_path="/var/lib/ebb/queue.sqlite") as scheduler:
    ...
```

Schema:

```sql
CREATE TABLE tasks (
    task_id           TEXT PRIMARY KEY,
    status            TEXT NOT NULL,
    enqueued_at       TEXT NOT NULL,
    scheduled_for     TEXT,
    completed_at      TEXT,
    region            TEXT NOT NULL,
    carbon_budget_g   REAL,
    result_json       TEXT,
    error             TEXT,
    receipt_json      TEXT,
    intensity_source  TEXT
);
```

Receipts and results are stored as JSON. Non-JSON results (e.g. an
Anthropic `Message` object) are stored as `{"_repr": "<repr>"}` so
audit trails survive odd value types.

Multi-writer support (multiple schedulers pointed at one DB) requires
WAL mode and is on the v0.3 roadmap.

---

## Testing

```bash
cd packages/core-py
python3 -m venv .venv
. .venv/bin/activate
pip install -e ".[dev,anthropic,openai]"
pytest -v
```

The test suite covers:

- Mock grid feed shape and intraday curve.
- `pick_best_window` correctness (empty, past, in-window).
- Scheduler accounting: queued/scheduled/running/completed
  transitions.
- Deadline validation: unparseable strings, past dates,
  `datetime` instances.
- Carbon-budget enforcement (US-MIDW-MISO floor exceeds a 0.1 g cap).
- SQLite round-trips, including reopening the DB after shutdown.
- Provider adapter request shapes and response parsing for both
  Anthropic and OpenAI (mocked SDKs — no live calls).

---

## Roadmap

- **v0.2 (this release)** — scheduler, grid feeds, SQLite persistence,
  Anthropic + OpenAI adapters with Batch API.
- **v0.3** — per-model energy coefficients; WattTime marginal-emissions
  feed; multi-writer DB with WAL mode; richer receipt fields (model,
  provider, token counts) propagated by the scheduler itself.
- **v0.4** — Gemini adapter; local-Ollama route; MCP spec PRs for
  `priority` / `deadline` / `carbon_budget` fields.

See [`ROADMAP.md`](../../ROADMAP.md) for the full 24-week plan.

---

## License

[Apache License 2.0](../../LICENSE) — patent grant included.

---

*Built by [Vitalii Borovyk](https://github.com/Vitalini).*
