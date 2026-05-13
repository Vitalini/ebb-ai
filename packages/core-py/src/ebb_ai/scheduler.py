"""Scheduler — the in-process orchestrator for ebb-ai.

Responsibilities
----------------
- Hold a queue of deferrable tasks (in-memory + optional SQLite).
- Score candidate execution windows for each task using a grid feed.
- Sleep until the chosen window, then dispatch the task.
- Record a carbon receipt on the resulting :class:`TaskRecord`.

This module ports the design from
``packages/core-ts/src/scheduler.ts`` to ``asyncio``, with one
deliberate asymmetry: the Python port adds optional SQLite persistence
from day one (the TS port is still in-memory). See :class:`Scheduler`'s
``db_path`` parameter.

The scheduler runs cooperatively: each scheduled task is an
``asyncio.Task`` that sleeps until its window. There is no separate
"tick" loop — the scheduling decision is made once at enqueue time and
re-evaluated only if the wait time exceeds an internal safety cap.
"""

from __future__ import annotations

import asyncio
import logging
import uuid
from collections.abc import Awaitable, Callable
from datetime import UTC, datetime, timedelta
from typing import Any, Final, Generic, TypeVar

import aiosqlite

from .errors import CarbonBudgetExceededError, InvalidDeadlineError
from .grid import GridFeed, mock_grid_feed
from .types import (
    CarbonReceipt,
    DeferOptions,
    GridForecast,
    GridForecastEntry,
    TaskRecord,
)

_log = logging.getLogger(__name__)

T = TypeVar("T")

#: Default region used when DeferOptions does not name one.
DEFAULT_REGION: Final[str] = "US-CAL-CISO"

#: Hard ceiling on forecast horizon, in hours. Matches the TS port.
MAX_HORIZON_HOURS: Final[int] = 72

#: Energy used per moderate LLM call (kWh). Placeholder; v0.3 will
#: learn per-model coefficients from published research (Patterson et
#: al. 2021, Luccioni et al. 2023).
ENERGY_KWH_PER_TASK: Final[float] = 0.0015

#: Safety cap for a single ``asyncio.sleep`` call, in seconds.
#: ``asyncio.sleep`` on CPython accepts very large floats, but if the
#: event loop is restarted (or the process suspends) we want to
#: re-evaluate the forecast rather than sleep forever. 1 hour is a
#: reasonable upper bound for a single nap.
_SLEEP_CHUNK_S: Final[float] = 3600.0

#: How much clock skew we tolerate on a deadline before treating it as
#: in the past. Matches the TS port's 5-second tolerance.
_DEADLINE_SKEW_S: Final[float] = 5.0


DeferrableTask = Callable[[], Awaitable[T] | T]
"""Function the user hands to :func:`defer`."""


# --------------------------------------------------------------------------- #
# Helpers


def _intensity_to_grams(g_co2_per_kwh: float) -> float:
    """Convert grid intensity (gCO2/kWh) into grams CO2 for one task."""
    return ENERGY_KWH_PER_TASK * g_co2_per_kwh


def _now_utc() -> datetime:
    """Wall clock in UTC. Exposed for monkey-patching in tests."""
    return datetime.now(UTC)


def _iso_utc(dt: datetime) -> str:
    """Render a datetime as a TS-compatible ISO-8601 string in UTC.

    Matches ``Date.prototype.toISOString``: millisecond precision,
    trailing ``Z``.
    """
    aware = dt.astimezone(UTC) if dt.tzinfo else dt.replace(tzinfo=UTC)
    ms = aware.microsecond // 1000
    return aware.strftime("%Y-%m-%dT%H:%M:%S") + f".{ms:03d}Z"


def _parse_iso(s: str) -> datetime | None:
    """Parse an ISO-8601 string; return ``None`` if unparseable.

    Accepts the JS-style trailing ``Z`` (which ``datetime.fromisoformat``
    only learned in 3.11) and naive strings (interpreted as UTC).
    """
    try:
        if s.endswith("Z"):
            s = s[:-1] + "+00:00"
        dt = datetime.fromisoformat(s)
    except (ValueError, TypeError):
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=UTC)
    return dt


def normalize_deadline(d: str | datetime | None) -> datetime:
    """Validate and normalize a user-supplied deadline.

    Raises
    ------
    InvalidDeadlineError
        If ``d`` cannot be parsed or is already in the past.
    """
    if d is None:
        return _now_utc() + timedelta(hours=24)
    if isinstance(d, datetime):
        parsed = d if d.tzinfo else d.replace(tzinfo=UTC)
    elif isinstance(d, str):
        maybe = _parse_iso(d)
        if maybe is None:
            raise InvalidDeadlineError(d)
        parsed = maybe
    else:
        raise InvalidDeadlineError(d)
    if parsed < _now_utc() - timedelta(seconds=_DEADLINE_SKEW_S):
        raise InvalidDeadlineError(d)
    return parsed


def pick_best_window(
    entries: list[GridForecastEntry],
    deadline: datetime,
) -> GridForecastEntry | None:
    """Pick the lowest-intensity entry inside ``[now, deadline]``.

    Returns ``None`` if no entry fits the window. Pure function — no
    side effects, no I/O — so it's safe to call directly from tests.
    """
    now = _now_utc()
    usable: list[GridForecastEntry] = []
    for e in entries:
        t = _parse_iso(e.datetime)
        if t is None:
            continue
        if now <= t <= deadline:
            usable.append(e)
    if not usable:
        return None
    best = usable[0]
    for e in usable:
        if e.carbon_intensity_g_co2_per_kwh < best.carbon_intensity_g_co2_per_kwh:
            best = e
    return best


# --------------------------------------------------------------------------- #
# Persistence


_SCHEMA = """
CREATE TABLE IF NOT EXISTS tasks (
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
CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
CREATE INDEX IF NOT EXISTS idx_tasks_enqueued_at ON tasks(enqueued_at);
"""


class _TaskStore:
    """Optional SQLite-backed durable queue.

    Stores task lifecycle and carbon receipts. The Python port ships
    this from day one as an asymmetry with the TS port (which is still
    in-memory at v0.1). See ``PLAN.md`` section 4.1.

    Concurrency: writes are serialized through an :class:`asyncio.Lock`
    so a single connection is enough; multiple schedulers pointed at
    the same DB file would need WAL mode (left for v0.3).
    """

    def __init__(self, db_path: str) -> None:
        self._db_path = db_path
        self._conn: aiosqlite.Connection | None = None
        self._lock = asyncio.Lock()

    async def connect(self) -> None:
        if self._conn is not None:
            return
        conn = await aiosqlite.connect(self._db_path)
        await conn.executescript(_SCHEMA)
        await conn.commit()
        self._conn = conn

    async def close(self) -> None:
        if self._conn is not None:
            await self._conn.close()
            self._conn = None

    def _require(self) -> aiosqlite.Connection:
        if self._conn is None:
            raise RuntimeError("TaskStore is not connected; call connect() first")
        return self._conn

    async def upsert(self, record: TaskRecord) -> None:
        import json

        conn = self._require()
        async with self._lock:
            await conn.execute(
                """
                INSERT INTO tasks (
                    task_id, status, enqueued_at, scheduled_for, completed_at,
                    region, carbon_budget_g, result_json, error, receipt_json,
                    intensity_source
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(task_id) DO UPDATE SET
                    status           = excluded.status,
                    scheduled_for    = excluded.scheduled_for,
                    completed_at     = excluded.completed_at,
                    region           = excluded.region,
                    carbon_budget_g  = excluded.carbon_budget_g,
                    result_json      = excluded.result_json,
                    error            = excluded.error,
                    receipt_json     = excluded.receipt_json,
                    intensity_source = excluded.intensity_source
                """,
                (
                    record.task_id,
                    record.status,
                    record.enqueued_at,
                    record.scheduled_for,
                    record.completed_at,
                    record.region,
                    record.carbon_budget_g,
                    _json_dump_safe(record.result),
                    record.error,
                    json.dumps(record.receipt.to_dict()) if record.receipt else None,
                    record.intensity_source,
                ),
            )
            await conn.commit()

    async def load(self, task_id: str) -> TaskRecord | None:
        import json

        conn = self._require()
        async with conn.execute(
            "SELECT * FROM tasks WHERE task_id = ?", (task_id,)
        ) as cur:
            cur.row_factory = aiosqlite.Row  # type: ignore[assignment]
            row = await cur.fetchone()
        if row is None:
            return None
        receipt_json = row["receipt_json"]
        receipt = None
        if receipt_json:
            data = json.loads(receipt_json)
            receipt = CarbonReceipt(
                task_id=data["task_id"],
                ran_at=data["ran_at"],
                region=data["region"],
                estimated_carbon_g_co2=data["estimated_carbon_g_co2"],
                provider=data.get("provider"),
                model=data.get("model"),
                duration_ms=data.get("duration_ms"),
            )
        result = json.loads(row["result_json"]) if row["result_json"] else None
        return TaskRecord(
            task_id=row["task_id"],
            status=row["status"],
            enqueued_at=row["enqueued_at"],
            region=row["region"],
            scheduled_for=row["scheduled_for"],
            completed_at=row["completed_at"],
            carbon_budget_g=row["carbon_budget_g"],
            result=result,
            error=row["error"],
            receipt=receipt,
            intensity_source=row["intensity_source"],
        )

    async def list_all(self) -> list[TaskRecord]:
        conn = self._require()
        records: list[TaskRecord] = []
        async with conn.execute("SELECT task_id FROM tasks ORDER BY enqueued_at ASC") as cur:
            rows = await cur.fetchall()
        for row in rows:
            r = await self.load(row[0])
            if r is not None:
                records.append(r)
        return records


def _json_dump_safe(value: Any) -> str | None:
    """Serialize a value to JSON, falling back to ``repr`` for un-JSON-able
    objects (e.g., model responses with non-serializable fields).
    """
    import json

    if value is None:
        return None
    try:
        return json.dumps(value)
    except (TypeError, ValueError):
        return json.dumps({"_repr": repr(value)})


# --------------------------------------------------------------------------- #
# Scheduler


class _Resolver(Generic[T]):
    """Holds an awaitable Future + the resolve/reject hooks for a task."""

    __slots__ = ("future",)

    def __init__(self, loop: asyncio.AbstractEventLoop) -> None:
        self.future: asyncio.Future[T] = loop.create_future()

    def resolve(self, value: T) -> None:
        if not self.future.done():
            self.future.set_result(value)

    def reject(self, err: BaseException) -> None:
        if not self.future.done():
            self.future.set_exception(err)


class Scheduler:
    """The in-process orchestrator.

    Parameters
    ----------
    feed:
        Grid feed. Defaults to :func:`mock_grid_feed`.
    default_region:
        Region used when :class:`DeferOptions` does not name one.
        Defaults to ``"US-CAL-CISO"``.
    db_path:
        Optional path to a SQLite database for durable task records.
        If omitted, tasks live only in process memory. Call
        :meth:`connect` once before any :meth:`defer` / :meth:`enqueue`
        when ``db_path`` is set.

    Notes
    -----
    Each enqueued task spawns one ``asyncio.Task`` that owns its sleep
    window. There is no central tick loop. :meth:`shutdown` cancels all
    in-flight schedule tasks.
    """

    def __init__(
        self,
        *,
        feed: GridFeed | None = None,
        default_region: str = DEFAULT_REGION,
        db_path: str | None = None,
    ) -> None:
        self._feed: GridFeed = feed if feed is not None else mock_grid_feed()
        self._default_region = default_region
        self._tasks: dict[str, TaskRecord] = {}
        self._bodies: dict[str, DeferrableTask[Any]] = {}
        self._resolvers: dict[str, _Resolver[Any]] = {}
        self._schedules: dict[str, asyncio.Task[None]] = {}
        self._background: set[asyncio.Task[Any]] = set()
        self._store: _TaskStore | None = _TaskStore(db_path) if db_path else None
        self._connected = False

    # ----- lifecycle --------------------------------------------------- #

    async def connect(self) -> None:
        """Open the SQLite connection if ``db_path`` was supplied.

        Safe to call multiple times. No-op when ``db_path`` is unset.
        """
        if self._store is not None and not self._connected:
            await self._store.connect()
            self._connected = True

    async def __aenter__(self) -> Scheduler:
        await self.connect()
        return self

    async def __aexit__(self, *_exc: object) -> None:
        await self.shutdown()

    async def shutdown(self) -> None:
        """Cancel all in-flight schedule tasks and close the DB.

        Idempotent.
        """
        pending = list(self._schedules.values())
        for t in pending:
            t.cancel()
        for t in pending:
            try:  # noqa: SIM105
                await t
            except (asyncio.CancelledError, Exception):
                pass
        self._schedules.clear()
        # Drain any in-flight DB writes before closing the connection;
        # otherwise a queued upsert can fire against a closed conn.
        for bg in list(self._background):
            try:  # noqa: SIM105
                await bg
            except (asyncio.CancelledError, Exception):
                pass
        self._background.clear()
        if self._store is not None and self._connected:
            await self._store.close()
            self._connected = False

    # ----- public API -------------------------------------------------- #

    async def defer(
        self,
        task: DeferrableTask[T],
        opts: DeferOptions | None = None,
    ) -> T:
        """Defer a task; wait for its eventual result.

        Returns the value the task body returns (or raises whatever it
        raised). Internally calls :meth:`enqueue` and then awaits the
        resolver future.
        """
        record = self.enqueue(task, opts)
        resolver = self._resolvers[record.task_id]
        return await resolver.future

    def enqueue(
        self,
        task: DeferrableTask[T],
        opts: DeferOptions | None = None,
    ) -> TaskRecord:
        """Enqueue a task without awaiting it.

        Returns the :class:`TaskRecord` immediately with ``status =
        "queued"``. Useful for fire-and-forget workflows or when an
        external system (e.g. an MCP client) wants to poll status.
        """
        opts = opts or DeferOptions()
        deadline = normalize_deadline(opts.deadline)

        if opts.task_id is not None:
            if not isinstance(opts.task_id, str) or len(opts.task_id) == 0:
                raise ValueError("Invalid task_id: must be a non-empty string")
            if opts.task_id in self._tasks:
                raise ValueError(f"Task id {opts.task_id!r} is already in the queue")
        task_id = opts.task_id if opts.task_id is not None else f"t-{uuid.uuid4()}"
        region = opts.region if opts.region is not None else self._default_region

        record = TaskRecord(
            task_id=task_id,
            status="queued",
            enqueued_at=_iso_utc(_now_utc()),
            region=region,
            carbon_budget_g=opts.carbon_budget_g,
        )
        self._tasks[task_id] = record
        self._bodies[task_id] = task

        loop = asyncio.get_running_loop()
        self._resolvers[task_id] = _Resolver(loop)

        # Persist queued state up front so an external observer (or a
        # crash-recovery sweep) can see the task immediately. We retain
        # a strong reference to the background upsert task so it isn't
        # garbage-collected before completion.
        if self._store is not None and self._connected:
            upsert_task = asyncio.create_task(self._store.upsert(record))
            self._background.add(upsert_task)
            upsert_task.add_done_callback(self._background.discard)

        # Schedule on the event loop. Captures `deadline` so reschedules
        # honor it.
        self._schedules[task_id] = loop.create_task(
            self._schedule(task_id, deadline),
            name=f"ebb-ai:schedule:{task_id}",
        )
        return record

    def get_task(self, task_id: str) -> TaskRecord | None:
        """Snapshot the current state of one task (in-memory only)."""
        return self._tasks.get(task_id)

    def list_tasks(self) -> list[TaskRecord]:
        """Snapshot the queue (immutable copy of the in-memory map)."""
        return list(self._tasks.values())

    async def list_persisted_tasks(self) -> list[TaskRecord]:
        """Snapshot all tasks from SQLite, including completed/historical.

        Returns an empty list when ``db_path`` is unset or not yet
        connected.
        """
        if self._store is None or not self._connected:
            return []
        return await self._store.list_all()

    async def load_persisted_task(self, task_id: str) -> TaskRecord | None:
        """Look up one task in SQLite. Falls back to in-memory map."""
        if self._store is not None and self._connected:
            persisted = await self._store.load(task_id)
            if persisted is not None:
                return persisted
        return self._tasks.get(task_id)

    # ----- scheduling internals --------------------------------------- #

    async def _schedule(self, task_id: str, deadline: datetime) -> None:
        """Pick a window, sleep until it, then dispatch.

        Re-entrant: if ``asyncio.sleep`` is capped at ``_SLEEP_CHUNK_S``
        the method re-schedules itself, which lets long deadlines
        survive forecast updates and clock drift.
        """
        record = self._tasks.get(task_id)
        if record is None:
            return
        try:
            now = _now_utc()
            horizon_h = max(
                1,
                min(
                    MAX_HORIZON_HOURS,
                    int(((deadline - now).total_seconds() + 3599) // 3600),
                ),
            )
            forecast = await self._feed.fetch_forecast(record.region, horizon_h)
        except asyncio.CancelledError:
            raise
        except Exception as err:
            _log.warning("[ebb-ai/scheduler] forecast fetch failed: %s", err)
            await self._dispatch(task_id, _now_utc(), None)
            return

        budget_g = record.carbon_budget_g
        if budget_g is not None:
            survivors = [
                e
                for e in forecast.entries
                if _intensity_to_grams(e.carbon_intensity_g_co2_per_kwh) <= budget_g
            ]
        else:
            survivors = list(forecast.entries)

        candidate = pick_best_window(survivors, deadline)
        if candidate is None:
            if budget_g is not None and forecast.entries:
                cheapest = min(
                    forecast.entries,
                    key=lambda e: e.carbon_intensity_g_co2_per_kwh,
                )
                cheapest_g = _intensity_to_grams(cheapest.carbon_intensity_g_co2_per_kwh)
                if cheapest_g > budget_g:
                    await self._fail(
                        task_id, CarbonBudgetExceededError(cheapest_g, budget_g)
                    )
                    return
            # No usable window inside the deadline — dispatch immediately
            # rather than miss the deadline.
            await self._dispatch(task_id, _now_utc(), None)
            return

        record.status = "scheduled"
        record.scheduled_for = candidate.datetime
        if self._store is not None and self._connected:
            await self._store.upsert(record)

        target = _parse_iso(candidate.datetime)
        if target is None:
            await self._dispatch(task_id, _now_utc(), None)
            return

        wait_s = max(0.0, (target - _now_utc()).total_seconds())
        # Cap sleep so we re-evaluate on long horizons (clock drift,
        # forecast staleness). Re-entry handled below.
        if wait_s > _SLEEP_CHUNK_S:
            try:
                await asyncio.sleep(_SLEEP_CHUNK_S)
            except asyncio.CancelledError:
                raise
            await self._schedule(task_id, deadline)
            return

        try:
            await asyncio.sleep(wait_s)
        except asyncio.CancelledError:
            raise
        await self._dispatch(task_id, target, candidate)

    async def _fail(self, task_id: str, err: Exception) -> None:
        record = self._tasks.get(task_id)
        if record is None:
            return
        record.status = "failed"
        record.completed_at = _iso_utc(_now_utc())
        record.error = str(err)
        if self._store is not None and self._connected:
            await self._store.upsert(record)
        resolver = self._resolvers.pop(task_id, None)
        if resolver is not None:
            resolver.reject(err)
        self._bodies.pop(task_id, None)

    async def _dispatch(
        self,
        task_id: str,
        ran_at: datetime,
        forecast_entry: GridForecastEntry | None,
    ) -> None:
        record = self._tasks.get(task_id)
        body = self._bodies.get(task_id)
        if record is None or body is None:
            return
        record.status = "running"
        if self._store is not None and self._connected:
            await self._store.upsert(record)

        start = _now_utc()
        try:
            outcome = body()
            if asyncio.iscoroutine(outcome) or isinstance(outcome, Awaitable):
                result = await outcome
            else:
                result = outcome
            duration_ms = (_now_utc() - start).total_seconds() * 1000.0
        except asyncio.CancelledError:
            raise
        except Exception as err:
            record.status = "failed"
            record.completed_at = _iso_utc(_now_utc())
            record.error = str(err)
            if self._store is not None and self._connected:
                await self._store.upsert(record)
            resolver = self._resolvers.pop(task_id, None)
            if resolver is not None:
                resolver.reject(err)
            self._bodies.pop(task_id, None)
            return

        if forecast_entry is not None:
            intensity_g = forecast_entry.carbon_intensity_g_co2_per_kwh
            source: str = "scored"
        else:
            intensity_g = await self._fetch_current_intensity(record.region, ran_at)
            source = "current"

        receipt = CarbonReceipt(
            task_id=task_id,
            ran_at=_iso_utc(ran_at),
            region=record.region,
            estimated_carbon_g_co2=round(_intensity_to_grams(intensity_g) * 10) / 10,
            duration_ms=duration_ms,
        )
        record.status = "completed"
        record.completed_at = _iso_utc(_now_utc())
        record.result = result
        record.receipt = receipt
        record.intensity_source = source  # type: ignore[assignment]
        if self._store is not None and self._connected:
            await self._store.upsert(record)

        resolver = self._resolvers.pop(task_id, None)
        if resolver is not None:
            resolver.resolve(result)
        self._bodies.pop(task_id, None)

    async def _fetch_current_intensity(self, region: str, at: datetime) -> float:
        """Look up the forecast bucket closest to ``at`` (fallback path)."""
        forecast: GridForecast = await self._feed.fetch_forecast(region, 24)
        target = at.timestamp()
        best: GridForecastEntry | None = None
        best_delta = float("inf")
        for entry in forecast.entries:
            t = _parse_iso(entry.datetime)
            if t is None:
                continue
            d = abs(t.timestamp() - target)
            if d < best_delta:
                best = entry
                best_delta = d
        return best.carbon_intensity_g_co2_per_kwh if best is not None else 400.0


# --------------------------------------------------------------------------- #
# Module-level convenience


_default: Scheduler | None = None


def _get_default() -> Scheduler:
    global _default
    if _default is None:
        _default = Scheduler()
    return _default


async def defer(
    task: DeferrableTask[T],
    *,
    deadline: str | datetime | None = None,
    carbon_budget_g: float | None = None,
    region: str | None = None,
    task_id: str | None = None,
) -> T:
    """Defer a task on the process-wide default scheduler.

    This mirrors the top-level ``defer`` export of the TS package. Most
    users want this; advanced users construct their own
    :class:`Scheduler` (e.g. with a custom feed or a SQLite path).

    Example
    -------
    >>> from ebb_ai import defer
    >>> async def main():
    ...     return await defer(
    ...         lambda: 42,
    ...         deadline="2099-01-01T00:00:00Z",
    ...         carbon_budget_g=5,
    ...         region="US-CAL-CISO",
    ...     )
    """
    opts = DeferOptions(
        deadline=deadline.isoformat() if isinstance(deadline, datetime) else deadline,
        carbon_budget_g=carbon_budget_g,
        region=region,
        task_id=task_id,
    )
    # Override deadline normalization to accept datetime instances at this
    # layer too — the dataclass holds the raw user value as a string for
    # serialization, but we pass the parsed object through opts.deadline
    # via normalize_deadline when enqueue() runs.
    if isinstance(deadline, datetime):
        opts.deadline = deadline.isoformat()
    return await _get_default().defer(task, opts)


__all__ = [
    "DEFAULT_REGION",
    "ENERGY_KWH_PER_TASK",
    "MAX_HORIZON_HOURS",
    "DeferrableTask",
    "Scheduler",
    "defer",
    "normalize_deadline",
    "pick_best_window",
]
