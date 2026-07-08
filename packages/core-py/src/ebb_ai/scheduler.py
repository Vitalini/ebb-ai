"""Scheduler — the in-process orchestrator for ebb-ai.

Responsibilities
----------------
- Hold a queue of deferrable tasks (closure-based :meth:`Scheduler.defer`
  / :meth:`Scheduler.enqueue` and JSON-persistable provider-call tasks).
- Score candidate execution windows for each task using a grid feed.
- Sleep until the chosen window (closure tasks) or mark the window for a
  later :meth:`Scheduler.tick` (provider-call tasks), then dispatch.
- Record a signed carbon receipt on the resulting :class:`TaskRecord`.
- Optionally write every state transition through to a SQLite audit
  ledger (``db_path``), shared safely across processes via WAL plus a
  row-level dispatch claim. Both ports persist to the same schema, so a
  ``queue.db`` written by ``@ebb-ai/core`` is readable here and vice
  versa.

This module ports the design from
``packages/core-ts/src/scheduler.ts`` to ``asyncio``.

The scheduler runs cooperatively: each closure task's schedule is an
``asyncio.Task`` that sleeps until its window. There is no separate
in-process tick loop — the scheduling decision is made at enqueue time
and re-evaluated hourly while the task waits.
"""

from __future__ import annotations

import asyncio
import contextlib
import json
import logging
import math
import os
import re
import socket
import sqlite3
import uuid
from collections.abc import Awaitable, Callable, Sequence
from dataclasses import replace
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import TYPE_CHECKING, Any, Final, Generic, TypeVar

import aiosqlite
import httpx

from .energy import grams_for_intensity, lookup_model_energy
from .errors import (
    CarbonBudgetExceededError,
    InvalidDeadlineError,
    SchedulerShutdownError,
    TaskCancelledError,
)
from .grid import GridFeed, mock_grid_feed
from .sign import SigningKeyPair, load_or_create_signing_key, sign_receipt
from .types import (
    CarbonReceipt,
    DeferOptions,
    GridForecast,
    GridForecastEntry,
    GridSource,
    ProviderCallSpec,
    TaskRecord,
    TickResult,
    TickResultEntry,
)

if TYPE_CHECKING:
    from .providers.base import ProviderAdapter

_log = logging.getLogger(__name__)

T = TypeVar("T")

#: Default region used when DeferOptions does not name one.
DEFAULT_REGION: Final[str] = "US-CAL-CISO"

#: Hard ceiling on forecast horizon, in hours. Matches the TS port.
MAX_HORIZON_HOURS: Final[int] = 72

#: Legacy flat energy estimate per task (kWh). Retained as the
#: backwards-compatible fallback and for API stability (it is exported).
#: Since v0.10 the real per-model coefficients live in
#: :mod:`ebb_ai.energy`; with no model and no token counts the estimator
#: returns exactly this value, so closure-based ``defer`` tasks keep
#: their pre-v0.10 numbers.
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


def _round_half_up(x: float) -> int:
    """Round halves away toward +inf, matching JavaScript ``Math.round``.

    Python's built-in :func:`round` uses banker's rounding (half-to-even),
    which diverges from the TS core's ``Math.round`` at exact ``.5``
    boundaries (e.g. ``round(2.5) == 2`` but ``Math.round(2.5) == 3``).
    Carbon/delta figures on a receipt must be reproducible across the two
    ports, so they round through this instead of the builtin.
    """
    return math.floor(x + 0.5)


def _intensity_to_grams(
    g_co2_per_kwh: float,
    *,
    model: str | None = None,
    input_tokens: int | None = None,
    output_tokens: int | None = None,
) -> float:
    """Grams CO2 for one task at a given grid intensity.

    Delegates to the per-model energy coefficients
    (:func:`ebb_ai.energy.grams_for_intensity`, v0.10). With no model and
    no token counts the estimator falls back to the legacy flat
    0.0015 kWh, so closure-based ``defer`` tasks are unchanged;
    provider-call tasks pass ``model`` (and, at dispatch, the real token
    counts the provider reported) for calibrated per-model math.
    """
    return grams_for_intensity(
        g_co2_per_kwh,
        model=model,
        input_tokens=input_tokens,
        output_tokens=output_tokens,
    )


#: Default prompt-redaction patterns, applied unless a
#: :class:`ProviderCallSpec` passes its own ``redact_in_receipt`` list.
#: Mirrors the TS port's ``DEFAULT_REDACTION_PATTERNS`` exactly:
#: vendor-shaped credential patterns only. A previous generic
#: ``[A-Z]{2,3}_[A-Z0-9]{6,}`` catch-all mangled legitimate prose
#: (DB_PASSWORD, US-MIDA-PJM-style codes, ISO_8601) while missing every
#: real vendor key shape below.
_DEFAULT_REDACTION_PATTERNS: Final[tuple[re.Pattern[str], ...]] = (
    re.compile(r"sk-(?:ant-)?[A-Za-z0-9_\-]{20,}"),  # Anthropic / OpenAI legacy
    re.compile(r"sk-proj-[A-Za-z0-9_\-]{20,}"),  # OpenAI project keys
    re.compile(r"\bBearer\s+[A-Za-z0-9_\-.]{20,}", re.IGNORECASE),  # OAuth bearer
    re.compile(r"\bAKIA[0-9A-Z]{16}\b"),  # AWS access key id
    re.compile(r"\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{36}\b"),  # GitHub tokens
    re.compile(r"\bgithub_pat_[A-Za-z0-9_]{22,}\b"),  # GitHub fine-grained PAT
    re.compile(r"\bAIza[0-9A-Za-z_\-]{35}\b"),  # Google API key
    re.compile(r"\bxox[baprs]-[A-Za-z0-9-]{10,}\b"),  # Slack tokens
    re.compile(
        r"\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}"
    ),  # JWT
)


def _redact_prompt(prompt: str, patterns: list[str] | None) -> str:
    """Redact secrets from a prompt before storing it on a receipt.

    ``patterns is None`` applies the built-in default set; an empty list
    disables redaction; malformed user patterns are skipped. The live
    dispatch always uses the original prompt — only the receipt copy is
    redacted. Mirrors the TS ``redactPrompt``.
    """
    out = prompt
    if patterns is None:
        for pat in _DEFAULT_REDACTION_PATTERNS:
            out = pat.sub("[REDACTED]", out)
    elif patterns:
        for raw in patterns:
            # Skip malformed user-supplied regexes rather than failing.
            with contextlib.suppress(re.error):
                out = re.sub(raw, "[REDACTED]", out)
    return out


def _redact_body_json(body_json: str | None) -> str | None:
    """Redact secrets out of a persisted provider-call body.

    Applied when a task reaches ``completed`` or ``cancelled`` — the live
    dispatch always uses the original body, and only the final ledger
    write is rewritten. Deliberately NOT applied on ``failed``:
    :meth:`Scheduler.retry_task` re-dispatches the persisted body, so a
    failed task must retain the caller's original prompt until it either
    succeeds (redacted then) or is cancelled. Mirrors the TS
    ``redactBodyJson``.
    """
    if not body_json:
        return body_json
    try:
        spec = json.loads(body_json)
    except (TypeError, ValueError):
        # Corrupt body — leave it untouched rather than destroy evidence.
        return body_json
    if not isinstance(spec, dict) or spec.get("type") != "provider_call":
        return body_json
    patterns = spec.get("redact_in_receipt", spec.get("redactInReceipt"))
    if not isinstance(patterns, list):
        patterns = None
    # Rewrite both the snake_case keys this port writes and the camelCase
    # variants a TS-written row carries (shared queue.db deployment).
    for key in ("prompt", "system_prompt", "systemPrompt"):
        value = spec.get(key)
        if isinstance(value, str):
            spec[key] = _redact_prompt(value, patterns)
    return json.dumps(spec)


#: Backoff waits (seconds) between retryable dispatch attempts: 4 attempts
#: total — 1 initial + 3 retries. Module-level so tests can monkeypatch it
#: to near-zero waits.
_RETRY_WAITS_S: tuple[float, ...] = (1.0, 4.0, 16.0)


def _is_retryable(err: BaseException) -> bool:
    """Whether a dispatch error is safe to re-send.

    Retryable: HTTP 429 rate-limits and 5xx (via ``err.status`` /
    ``err.status_code``), plus transport errors raised *before* the
    request could reach the provider (:class:`httpx.ConnectError`,
    :class:`httpx.ConnectTimeout`, :class:`socket.gaierror`). Ambiguous
    mid-flight errors (read timeouts, connection resets) are NOT retried
    — the provider may already have accepted and billed the call. Other
    4xx bubble up immediately.
    """
    status = getattr(err, "status", None)
    if not isinstance(status, int):
        status = getattr(err, "status_code", None)
    if isinstance(status, int):
        if status == 429:
            return True
        return 500 <= status < 600
    # Pre-connect failures only: the request never reached the provider,
    # so re-sending cannot double-bill. httpx.ReadTimeout / ReadError /
    # ConnectionResetError happen mid-flight and are deliberately absent.
    return isinstance(err, (httpx.ConnectError, httpx.ConnectTimeout, socket.gaierror))


async def _retry_with_backoff(
    fn: Callable[[], Awaitable[T]],
    *,
    waits: Sequence[float] | None = None,
) -> T:
    """Retry ``fn`` with exponential backoff. Port of the TS
    ``retryWithBackoff``.

    Up to ``len(waits) + 1`` attempts (default 4: 1 initial + retries at
    1s, 4s, 16s). Only errors :func:`_is_retryable` approves are retried.
    This is the single retry policy for ebb-ai: provider adapters
    construct their SDK clients with ``max_retries=0`` so vendor-side
    retries cannot multiply with this one.
    """
    effective_waits = _RETRY_WAITS_S if waits is None else waits
    last_err: BaseException | None = None
    for attempt in range(len(effective_waits) + 1):
        try:
            return await fn()
        except asyncio.CancelledError:
            raise
        except Exception as err:
            last_err = err
            if not _is_retryable(err) or attempt == len(effective_waits):
                raise
            _log.warning(
                "[ebb-ai/scheduler] dispatch attempt %d failed (%s); retrying in %gs",
                attempt + 1,
                err,
                effective_waits[attempt],
            )
            await asyncio.sleep(effective_waits[attempt])
    raise last_err if last_err is not None else RuntimeError("unreachable")


async def _write_output_file(
    path: str,
    task_id: str,
    result: Any,
    receipt: CarbonReceipt,
) -> None:
    """Write ``{taskId, result, receipt}`` as JSON to the spec's
    ``output_path``. The receipt is emitted with camelCase keys so the
    file is byte-compatible with the TS port's ``writeOutputFile``.
    Failures are logged but never fail the task — the SQLite ledger is
    the source of truth, the file is a convenience.
    """
    try:
        target = Path(path)
        target.parent.mkdir(parents=True, exist_ok=True)
        payload = {
            "taskId": task_id,
            "result": result,
            "receipt": receipt.to_camel_dict(),
        }
        target.write_text(json.dumps(payload, indent=2, default=repr))
    except Exception as err:
        _log.warning(
            "[ebb-ai/scheduler] failed to write output_path=%s: %s; "
            "result is still in the SQLite ledger",
            path,
            err,
        )


def _spec_model_from_body(body_json: str | None) -> str | None:
    """Best-effort parse of ``spec.model`` from a persisted provider-call body.

    Returns ``None`` when the body is absent, corrupt, or carries no
    string model — callers then fall back to the legacy flat energy
    estimate, matching the TS port.
    """
    if not body_json:
        return None
    try:
        parsed = json.loads(body_json)
    except (TypeError, ValueError):
        return None
    if isinstance(parsed, dict):
        model = parsed.get("model")
        if isinstance(model, str) and model:
            return model
    return None


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
    """Pick the lowest-intensity entry inside ``[now - 1h, deadline]``.

    Forecast entries mark the *start* of an hour, so the entry covering
    "now" started up to an hour ago — it is still a valid (dispatch-now)
    candidate. Excluding it made "run right now" unpickable even when
    the current hour is the cleanest inside the deadline (§1.7).

    Returns ``None`` if no entry fits the window. Pure function — no
    side effects, no I/O — so it's safe to call directly from tests.
    """
    now = _now_utc()
    usable: list[GridForecastEntry] = []
    for e in entries:
        t = _parse_iso(e.datetime)
        if t is None:
            continue
        if now - timedelta(hours=1) <= t <= deadline:
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
    intensity_source  TEXT,
    body_json         TEXT,
    estimated_carbon_g REAL,
    deadline          TEXT
);
CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
CREATE INDEX IF NOT EXISTS idx_tasks_enqueued_at ON tasks(enqueued_at);
"""


async def _ensure_body_json_column(conn: aiosqlite.Connection) -> None:
    """Idempotent migration: add ``body_json`` to a pre-v0.5 ``tasks`` table.

    SQLite permits ``ALTER TABLE ... ADD COLUMN`` on a non-empty table
    because the new column is nullable. ``pragma_table_info`` lets us
    skip the ALTER when the column already exists, so this runs cleanly
    on a freshly created v0.5 DB as well.
    """
    async with conn.execute("SELECT name FROM pragma_table_info('tasks')") as cur:
        rows = await cur.fetchall()
    names = {row[0] for row in rows}
    if "body_json" not in names:
        await conn.execute("ALTER TABLE tasks ADD COLUMN body_json TEXT")
        await conn.commit()


async def _ensure_estimated_carbon_column(conn: aiosqlite.Connection) -> None:
    """Idempotent migration: add ``estimated_carbon_g`` (v0.11) to a
    pre-v0.11 ``tasks`` table.

    The column records the schedule-time carbon projection for a
    provider-call task so the later :meth:`Scheduler.tick` dispatcher can
    compute the actual-vs-estimated delta on the receipt. Runs cleanly on
    a freshly created v0.11 DB (the column already exists) and backfills
    older DBs (the new nullable column ALTERs in on a non-empty table).
    """
    async with conn.execute("SELECT name FROM pragma_table_info('tasks')") as cur:
        rows = await cur.fetchall()
    names = {row[0] for row in rows}
    if "estimated_carbon_g" not in names:
        await conn.execute("ALTER TABLE tasks ADD COLUMN estimated_carbon_g REAL")
        await conn.commit()


async def _ensure_deadline_column(conn: aiosqlite.Connection) -> None:
    """Idempotent migration: add ``deadline`` (v0.12) to a pre-v0.12
    ``tasks`` table.

    Records the normalized ISO deadline captured at enqueue so
    dispatch-time decisions (Batch API eligibility) can be made against
    the real deadline instead of the ``scheduled_for`` proxy. The column
    name matches the TS port's SQLite schema exactly — the DB file is
    shared cross-language.
    """
    async with conn.execute("SELECT name FROM pragma_table_info('tasks')") as cur:
        rows = await cur.fetchall()
    names = {row[0] for row in rows}
    if "deadline" not in names:
        try:
            await conn.execute("ALTER TABLE tasks ADD COLUMN deadline TEXT")
        except aiosqlite.OperationalError as err:
            # Another process migrated between our pragma check and the
            # ALTER (check-then-ALTER is TOCTOU-racy on a shared DB). The
            # column exists either way.
            if "duplicate column name" not in str(err).lower():
                raise
        await conn.commit()


class _TaskStore:
    """Optional SQLite-backed durable queue.

    Stores task lifecycle and carbon receipts. Uses the same schema as
    the TS port's ``TaskStore`` (``packages/core-ts/src/storage/
    sqlite.ts``), so both language cores can share one ``queue.db``.

    Concurrency: writes are serialized through an :class:`asyncio.Lock`
    so a single connection is enough; for cross-process concurrency the
    store enables SQLite's WAL journal on first connect (v0.11) so a
    second TaskStore (e.g. ``ebb tick`` daemon + interactive ``ebb-mcp``)
    can hold a separate handle, and sets ``busy_timeout = 5000`` so a
    colliding writer queues for up to 5s instead of throwing
    ``SQLITE_BUSY`` immediately.
    """

    def __init__(self, db_path: str) -> None:
        self._db_path = db_path
        self._conn: aiosqlite.Connection | None = None
        self._lock = asyncio.Lock()

    async def connect(self) -> None:
        if self._conn is not None:
            return
        conn = await aiosqlite.connect(self._db_path)
        # v0.11: WAL on disk-backed stores so cross-process writers
        # don't trip SQLITE_BUSY. The pragma is persistent; running on
        # every open is cheap (~µs) and idempotent. In-memory stores
        # (``:memory:``) intentionally skip — WAL on ephemeral DBs adds
        # no value.
        if self._db_path != ":memory:":
            try:
                await conn.execute("PRAGMA journal_mode = WAL")
                # busy_timeout makes a colliding writer queue for up to
                # 5s instead of raising SQLITE_BUSY immediately —
                # essential when a cron `ebb tick` and an interactive
                # process write the same file. Per-connection, so it is
                # set on every open (v0.12, mirrors the TS store).
                await conn.execute("PRAGMA busy_timeout = 5000")
                await conn.execute("PRAGMA synchronous = NORMAL")
            except Exception:
                # Some FS-level configurations refuse WAL; the store
                # still works, just back to default DELETE journaling.
                pass
        await conn.executescript(_SCHEMA)
        await conn.commit()
        await _ensure_body_json_column(conn)
        await _ensure_estimated_carbon_column(conn)
        await _ensure_deadline_column(conn)
        self._conn = conn
        # The ledger stores prompts (redacted only at terminal
        # transitions) next to a 0600 signing key — keep the DB and its
        # WAL side-files out of reach of other local users. Best-effort:
        # never fail open over a chmod error (exotic FS, Windows).
        if self._db_path != ":memory:":
            parent = os.path.dirname(self._db_path)
            if parent:
                with contextlib.suppress(OSError):
                    os.chmod(parent, 0o700)
            for suffix in ("", "-wal", "-shm"):
                p = self._db_path + suffix
                with contextlib.suppress(OSError):
                    if os.path.exists(p):
                        os.chmod(p, 0o600)

    async def close(self) -> None:
        if self._conn is not None:
            await self._conn.close()
            self._conn = None

    def _require(self) -> aiosqlite.Connection:
        if self._conn is None:
            raise RuntimeError("TaskStore is not connected; call connect() first")
        return self._conn

    async def upsert(self, record: TaskRecord) -> None:
        conn = self._require()
        async with self._lock:
            await conn.execute(
                """
                INSERT INTO tasks (
                    task_id, status, enqueued_at, scheduled_for, completed_at,
                    region, carbon_budget_g, result_json, error, receipt_json,
                    intensity_source, body_json, estimated_carbon_g, deadline
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(task_id) DO UPDATE SET
                    status            = excluded.status,
                    scheduled_for     = excluded.scheduled_for,
                    completed_at      = excluded.completed_at,
                    region            = excluded.region,
                    carbon_budget_g   = excluded.carbon_budget_g,
                    result_json       = excluded.result_json,
                    error             = excluded.error,
                    receipt_json      = excluded.receipt_json,
                    intensity_source  = excluded.intensity_source,
                    body_json         = excluded.body_json,
                    estimated_carbon_g = excluded.estimated_carbon_g,
                    deadline          = excluded.deadline
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
                    record.body_json,
                    record.estimated_carbon_g_co2,
                    record.deadline,
                ),
            )
            await conn.commit()

    async def load(self, task_id: str) -> TaskRecord | None:
        conn = self._require()
        async with conn.execute(
            "SELECT * FROM tasks WHERE task_id = ?", (task_id,)
        ) as cur:
            cur.row_factory = aiosqlite.Row  # type: ignore[assignment]
            row = await cur.fetchone()
        if row is None:
            return None
        return _row_to_record(row)

    async def list_all(self) -> list[TaskRecord]:
        conn = self._require()
        async with conn.execute(
            "SELECT * FROM tasks ORDER BY enqueued_at ASC"
        ) as cur:
            cur.row_factory = aiosqlite.Row  # type: ignore[assignment]
            rows = await cur.fetchall()
        return [_row_to_record(row) for row in rows]

    async def list_by_status(self, status: str) -> list[TaskRecord]:
        """Return all records whose ``status`` matches the argument."""
        conn = self._require()
        async with conn.execute(
            "SELECT * FROM tasks WHERE status = ? ORDER BY enqueued_at ASC", (status,)
        ) as cur:
            cur.row_factory = aiosqlite.Row  # type: ignore[assignment]
            rows = await cur.fetchall()
        return [_row_to_record(row) for row in rows]

    async def claim_scheduled(self, task_id: str) -> bool:
        """Atomically claim a scheduled task for dispatch.

        Returns ``True`` iff this caller is the one that transitioned the
        row from ``scheduled`` to ``running``. Concurrent callers all see
        ``False`` after one wins. This is the concurrency-safe primitive
        backing :meth:`Scheduler.tick`.
        """
        conn = self._require()
        async with self._lock:
            cur = await conn.execute(
                "UPDATE tasks SET status = 'running' "
                "WHERE task_id = ? AND status = 'scheduled'",
                (task_id,),
            )
            rowcount = cur.rowcount
            await cur.close()
            await conn.commit()
        return rowcount == 1

    def exists_sync(self, task_id: str) -> bool:
        """Synchronous existence probe for the duplicate-id guard.

        :meth:`Scheduler.enqueue` is a synchronous API, so it cannot
        ``await`` the aiosqlite connection; a short-lived stdlib
        :mod:`sqlite3` connection answers "does this ledger row exist?"
        with a point read instead. Returns ``False`` for in-memory
        stores (a ``:memory:`` DB is private to its connection — the
        in-memory map already covers same-process id reuse, and there is
        no cross-process ledger to protect). Best-effort: an unreadable
        file also returns ``False`` rather than failing the enqueue.
        """
        if self._conn is None or self._db_path == ":memory:":
            return False
        try:
            with contextlib.closing(
                sqlite3.connect(self._db_path, timeout=5.0)
            ) as conn:
                cur = conn.execute(
                    "SELECT 1 FROM tasks WHERE task_id = ? LIMIT 1", (task_id,)
                )
                return cur.fetchone() is not None
        except sqlite3.Error:
            return False


def _row_to_record(row: Any) -> TaskRecord:
    """Convert a SQLite row into a :class:`TaskRecord`.

    Handles the receipt JSON blob and tolerates ``body_json`` being
    absent on pre-v0.5 DBs (the migration backfills the column but a
    very early row could still be ``NULL``).
    """
    receipt_json = row["receipt_json"]
    receipt = None
    if receipt_json:
        data = json.loads(receipt_json)
        receipt = CarbonReceipt(
            task_id=data["task_id"],
            ran_at=data["ran_at"],
            region=data["region"],
            estimated_carbon_g_co2=data["estimated_carbon_g_co2"],
            actual_carbon_g_co2=data.get("actual_carbon_g_co2"),
            delta_pct=data.get("delta_pct"),
            provider=data.get("provider"),
            model=data.get("model"),
            duration_ms=data.get("duration_ms"),
            prompt=data.get("prompt"),
            total_tokens=data.get("total_tokens"),
            intensity_g_co2_per_kwh=data.get("intensity_g_co2_per_kwh"),
            grid_source=data.get("grid_source"),
            energy_source=data.get("energy_source"),
            signature=data.get("signature"),
            signer_public_key=data.get("signer_public_key"),
            signed_at=data.get("signed_at"),
        )
    result = json.loads(row["result_json"]) if row["result_json"] else None
    # `body_json` is read defensively: SQLite columns added by a pre-v0.5
    # migration default to NULL, and a freshly-written row may not have
    # touched the column either.
    try:
        body_json = row["body_json"]
    except (IndexError, KeyError):
        body_json = None
    # `estimated_carbon_g` is read defensively too — a row written before
    # the v0.11 migration backfilled the column may still be NULL.
    try:
        estimated_carbon_g = row["estimated_carbon_g"]
    except (IndexError, KeyError):
        estimated_carbon_g = None
    # `deadline` (v0.12) is read defensively for the same reason.
    try:
        deadline = row["deadline"]
    except (IndexError, KeyError):
        deadline = None
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
        body_json=body_json,
        estimated_carbon_g_co2=estimated_carbon_g,
        deadline=deadline,
    )


def _json_dump_safe(value: Any) -> str | None:
    """Serialize a value to JSON, falling back to ``repr`` for un-JSON-able
    objects (e.g., model responses with non-serializable fields).
    """
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
    signing:
        Ed25519 receipt-signing config (v0.11). ``None`` (default) signs
        every receipt with ``~/.ebb-ai/signing.key`` (lazily created);
        ``False`` disables signing; a dict may pass ``{"key_path": "..."}``.
        If the ``cryptography`` extra is absent, signing self-disables and
        receipts ship unsigned.

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
        signing: bool | dict[str, Any] | None = None,
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
        # Ed25519 receipt-signing config (v0.11). ``None`` → sign every
        # receipt with the default ``~/.ebb-ai/signing.key`` (lazily
        # created on first dispatch); ``False`` → never sign; a dict may
        # carry ``{"key_path": "..."}``. If the ``cryptography`` extra is
        # absent (or the key can't be loaded), signing self-disables on
        # the first attempt and receipts ship unsigned — the default
        # ``pip install ebb-ai`` path stays v0.10-compatible.
        self._signing_config: bool | dict[str, Any] = (
            False if signing is False else (signing or {})
        )
        self._signing_key: SigningKeyPair | None = None

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
        """Cancel all in-flight schedule tasks, settle pending awaiters,
        and close the DB.

        Every still-unresolved :meth:`defer` awaiter is rejected with
        :class:`SchedulerShutdownError` so ``async with Scheduler(...)``
        can never deadlock a pending ``defer()`` (P11). Idempotent.

        ``asyncio.gather(..., return_exceptions=True)`` absorbs the
        child tasks' own ``CancelledError`` without swallowing a
        cancellation of *this* coroutine — if shutdown itself is
        cancelled, the outer await re-raises as usual.
        """
        pending = list(self._schedules.values())
        for t in pending:
            t.cancel()
        if pending:
            await asyncio.gather(*pending, return_exceptions=True)
        self._schedules.clear()
        # Drain any in-flight DB writes before closing the connection;
        # otherwise a queued upsert can fire against a closed conn.
        background = list(self._background)
        if background:
            await asyncio.gather(*background, return_exceptions=True)
        self._background.clear()
        # Settle every remaining awaiter: a defer() whose schedule task
        # was just cancelled would otherwise wait forever. Bodies are
        # dropped with the resolvers — nothing will dispatch them now.
        for task_id, resolver in list(self._resolvers.items()):
            resolver.reject(SchedulerShutdownError(task_id))
            self._bodies.pop(task_id, None)
        self._resolvers.clear()
        if self._store is not None and self._connected:
            await self._store.close()
            self._connected = False

    # ----- receipt signing (v0.11) ------------------------------------- #

    def _load_signing_key(self) -> SigningKeyPair | None:
        """Lazily load the signing keypair the first time a receipt needs it.

        Returns ``None`` when signing is disabled or a load error (most
        commonly the ``cryptography`` extra being absent) occurs — in
        which case signing is permanently disabled for this scheduler and
        subsequent receipts ship unsigned. Mirrors the TS ``maybeSign``
        lazy-load + fail-open behaviour.
        """
        if self._signing_config is False:
            return None
        if self._signing_key is not None:
            return self._signing_key
        key_path = (
            self._signing_config.get("key_path")
            if isinstance(self._signing_config, dict)
            else None
        )
        try:
            self._signing_key = load_or_create_signing_key(key_path)
            return self._signing_key
        except Exception as err:  # SigningNotInstalled, FS errors, …
            _log.warning(
                "[ebb-ai/scheduler] failed to load signing key, "
                "receipts will go out unsigned: %s",
                err,
            )
            self._signing_config = False
            return None

    def _maybe_sign(self, receipt: CarbonReceipt) -> CarbonReceipt:
        """Return a signed copy of ``receipt`` if signing is enabled.

        The original receipt is not mutated. A signing failure logs and
        returns the receipt unsigned rather than failing the dispatch —
        the SQLite ledger entry is what matters; the signature is an
        add-on.
        """
        key = self._load_signing_key()
        if key is None:
            return receipt
        try:
            signed = sign_receipt(receipt.to_dict(), key)
        except Exception as err:
            _log.warning(
                "[ebb-ai/scheduler] receipt signing failed, shipping unsigned: %s",
                err,
            )
            return receipt
        return replace(
            receipt,
            signature=signed.get("signature"),
            signer_public_key=signed.get("signer_public_key"),
            signed_at=signed.get("signed_at"),
        )

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

        Raises
        ------
        TaskCancelledError
            If the task is cancelled via :meth:`cancel_task` before (or
            while) it runs. A plain :class:`Exception` — deliberately
            not :class:`asyncio.CancelledError`, which would mark the
            *awaiting* task as cancelled and unwind ``TaskGroup``\\ s.
        SchedulerShutdownError
            If :meth:`shutdown` runs before the task dispatched.
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
        # Resolve the event loop BEFORE any state mutation: calling this
        # from a synchronous context must raise cleanly instead of
        # leaving a phantom "queued" record behind (P12).
        try:
            loop = asyncio.get_running_loop()
        except RuntimeError as err:
            raise RuntimeError(
                "Scheduler.enqueue must be called from within a running event loop"
            ) from err
        deadline = normalize_deadline(opts.deadline)

        if opts.task_id is not None:
            if not isinstance(opts.task_id, str) or len(opts.task_id) == 0:
                raise ValueError("Invalid task_id: must be a non-empty string")
            # Check both the in-memory map and the durable store: a fresh
            # process re-using an old id must not silently overwrite a
            # persisted (possibly completed + signed) ledger row.
            if opts.task_id in self._tasks or (
                self._store is not None
                and self._connected
                and self._store.exists_sync(opts.task_id)
            ):
                raise ValueError(f"Task id {opts.task_id!r} is already in the queue")
        task_id = opts.task_id if opts.task_id is not None else f"t-{uuid.uuid4()}"
        region = opts.region if opts.region is not None else self._default_region

        record = TaskRecord(
            task_id=task_id,
            status="queued",
            enqueued_at=_iso_utc(_now_utc()),
            region=region,
            carbon_budget_g=opts.carbon_budget_g,
            deadline=_iso_utc(deadline),
        )
        self._tasks[task_id] = record
        self._bodies[task_id] = task
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
        # honor it. Routed through _schedule_safe so any scheduling
        # failure fails the task (rejecting the defer() awaiter) instead
        # of dying as an unobserved task exception (§1.5).
        self._spawn_schedule(loop, task_id, deadline)
        return record

    def _spawn_schedule(
        self,
        loop: asyncio.AbstractEventLoop,
        task_id: str,
        deadline: datetime,
    ) -> None:
        """Create the schedule task for a closure task and register it in
        ``_schedules`` with a done-callback that prunes the entry once the
        task finishes (P13) — mirroring the ``_background`` pattern.
        """
        sched_task = loop.create_task(
            self._schedule_safe(task_id, deadline),
            name=f"ebb-ai:schedule:{task_id}",
        )
        self._schedules[task_id] = sched_task

        def _prune(t: asyncio.Task[None], task_id: str = task_id) -> None:
            # Only prune our own entry: update_deadline may have replaced
            # it with a fresh schedule task in the meantime.
            if self._schedules.get(task_id) is t:
                del self._schedules[task_id]

        sched_task.add_done_callback(_prune)

    async def _schedule_safe(self, task_id: str, deadline: datetime) -> None:
        """Run :meth:`_schedule`, routing any unexpected failure to
        :meth:`_fail` so a fire-and-forget scheduling coroutine can never
        strand a permanently-"queued" record or leak an unobserved
        exception (§1.5). Cancellation passes through untouched.
        """
        try:
            await self._schedule(task_id, deadline)
        except asyncio.CancelledError:
            raise
        except Exception as err:
            await self._fail(task_id, err)

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

    # ----- v0.5: persistent provider-call tasks ----------------------- #

    async def enqueue_provider_call(
        self,
        spec: ProviderCallSpec,
        opts: DeferOptions | None = None,
    ) -> TaskRecord:
        """Enqueue a persistent provider-call task.

        The spec is JSON-serialized into the SQLite ledger so the task
        survives the enqueuing process exiting — :meth:`tick`, typically
        invoked from a cron, can rehydrate the spec and dispatch it.

        Unlike :meth:`enqueue`, no in-process closure is registered; the
        scheduler does **not** call ``dispatch`` for these tasks at the
        chosen window. They are exclusively driven by :meth:`tick` so
        that any process (this one, or a later cron) can pick them up.

        Returns the :class:`TaskRecord` with ``status == "scheduled"``
        once the carbon window has been picked.
        """
        if spec.type != "provider_call":
            raise ValueError(
                f'enqueue_provider_call: spec.type must be "provider_call", got {spec.type!r}'
            )
        if spec.provider not in ("anthropic", "openai"):
            raise ValueError(
                f"enqueue_provider_call: unsupported provider {spec.provider!r}"
            )
        if not isinstance(spec.model, str) or not spec.model:
            raise ValueError("enqueue_provider_call: spec.model must be a non-empty string")
        if not isinstance(spec.prompt, str) or not spec.prompt:
            raise ValueError("enqueue_provider_call: spec.prompt must be a non-empty string")

        opts = opts or DeferOptions()
        deadline = normalize_deadline(opts.deadline)

        if opts.task_id is not None:
            if not isinstance(opts.task_id, str) or len(opts.task_id) == 0:
                raise ValueError("Invalid task_id: must be a non-empty string")
            # Check both the in-memory map and the durable store: a fresh
            # process re-using an old id must not silently overwrite a
            # persisted (possibly completed + signed) ledger row.
            duplicate = opts.task_id in self._tasks
            if not duplicate and self._store is not None and self._connected:
                duplicate = await self._store.load(opts.task_id) is not None
            if duplicate:
                raise ValueError(f"Task id {opts.task_id!r} is already in the queue")
        task_id = opts.task_id if opts.task_id is not None else f"t-{uuid.uuid4()}"
        region = opts.region if opts.region is not None else self._default_region

        record = TaskRecord(
            task_id=task_id,
            status="queued",
            enqueued_at=_iso_utc(_now_utc()),
            region=region,
            carbon_budget_g=opts.carbon_budget_g,
            body_json=json.dumps(spec.to_dict()),
            deadline=_iso_utc(deadline),
        )
        self._tasks[task_id] = record
        if self._store is not None and self._connected:
            await self._store.upsert(record)

        # Pick a carbon window and update status to "scheduled" but do
        # NOT register an in-process timer: provider-call tasks are
        # driven exclusively by tick().
        try:
            await self._schedule_provider_call(task_id, deadline)
        except asyncio.CancelledError:
            raise
        except Exception as err:
            # A scheduling failure after the queued-row upsert must not
            # strand a permanently-"queued" row in the ledger (§1.5).
            await self._fail(task_id, err)
            raise
        return self._tasks[task_id]

    async def tick(
        self,
        adapters: dict[str, ProviderAdapter | None] | None = None,
    ) -> TickResult:
        """Drain due provider-call tasks against the supplied adapters.

        Examines every task whose status is ``scheduled`` and whose
        ``scheduled_for`` is at or before "now", takes a row-level claim
        on each (so two ``tick`` calls racing on the same DB only
        dispatch the task once), then dispatches via the matching
        provider adapter. Closure-based tasks (:meth:`enqueue` /
        :meth:`defer`) are **not** touched.

        Parameters
        ----------
        adapters:
            Mapping of provider name → :class:`ProviderAdapter` instance
            (or ``None`` to mark the provider unavailable).
        """
        adapters = adapters or {}
        now = _now_utc()

        # Source-of-truth is the in-memory map for this process, plus
        # any persisted scheduled rows we haven't yet hydrated.
        candidates: list[TaskRecord] = []
        seen: set[str] = set()
        for record in self._tasks.values():
            if record.status != "scheduled":
                continue
            if not record.body_json:
                continue
            if not record.scheduled_for:
                continue
            target = _parse_iso(record.scheduled_for)
            if target is None or target > now:
                continue
            candidates.append(record)
            seen.add(record.task_id)
        if self._store is not None and self._connected:
            for record in await self._store.list_by_status("scheduled"):
                if record.task_id in seen:
                    continue
                if not record.body_json:
                    continue
                if not record.scheduled_for:
                    continue
                target = _parse_iso(record.scheduled_for)
                if target is None or target > now:
                    continue
                # Hydrate so subsequent state writes stay consistent.
                self._tasks[record.task_id] = record
                candidates.append(record)

        results: list[TickResultEntry] = []
        dispatched = 0
        failed = 0
        inspected = 0
        for record in candidates:
            # Concurrency-safe row-level claim. Only the caller that
            # flips status from "scheduled" -> "running" proceeds. A
            # locked / throwing row (e.g. SQLITE_BUSY under heavy
            # multi-process contention) is skipped — it stays
            # "scheduled" and a later tick retries. It must never abort
            # the whole tick.
            try:
                won = await self._claim_for_dispatch(record)
            except asyncio.CancelledError:
                raise
            except Exception as err:
                _log.warning(
                    "[ebb-ai/scheduler] tick: could not claim task %s: %s; "
                    "skipping this round",
                    record.task_id,
                    err,
                )
                continue
            if not won:
                continue
            inspected += 1
            entry = await self._dispatch_provider_call(record, adapters)
            results.append(entry)
            if entry.status == "completed":
                dispatched += 1
            else:
                failed += 1
        return TickResult(
            inspected=inspected,
            dispatched=dispatched,
            failed=failed,
            results=results,
        )

    async def cancel_task(self, task_id: str) -> TaskRecord:
        """Cancel a queued or scheduled task. Idempotent.

        If the task is already ``completed`` / ``failed`` / ``cancelled``
        this is a no-op; the current record is returned. Raises
        :class:`KeyError` only if the task id doesn't exist.

        Awaiters of :meth:`defer` are rejected with
        :class:`TaskCancelledError` — a plain :class:`Exception`, never
        :class:`asyncio.CancelledError` (which would bypass ``except
        Exception`` in the caller, mark the *caller's* task as cancelled,
        and unwind ``TaskGroup``\\ s).

        Cancelling a ``running`` task is best-effort: a provider call
        already in flight may still complete on the wire. The dispatcher
        re-checks the status before finalizing, so a cancelled task's
        late result is dropped and never written over the cancelled
        ledger row.
        """
        record = await self._lookup_record(task_id)
        if record is None:
            raise KeyError(f"cancel_task: task {task_id!r} not found")

        # Idempotent on terminal states.
        if record.status in ("completed", "failed", "cancelled"):
            return record

        # Mark cancelled FIRST, so an in-flight dispatch (this process or
        # another via the shared store) sees the cancellation when it
        # re-checks before finalizing, and its late result is dropped
        # instead of overwriting the cancelled ledger row (§1.2).
        record.status = "cancelled"
        record.completed_at = _iso_utc(_now_utc())
        # Terminal transition: redact secrets out of the persisted body so
        # the ledger does not retain raw prompts forever (§0.8).
        record.body_json = _redact_body_json(record.body_json)
        self._tasks[task_id] = record
        if self._store is not None and self._connected:
            await self._store.upsert(record)
        # Reject any pending resolver so awaiters get a clear error.
        # TaskCancelledError is a plain Exception (see errors.py) — never
        # asyncio.CancelledError, which would cancel the *caller*.
        resolver = self._resolvers.pop(task_id, None)
        if resolver is not None:
            resolver.reject(TaskCancelledError(task_id))
        self._bodies.pop(task_id, None)

        # Stop any pending in-process timer (best-effort for a body that
        # is already running — see the dispatcher's cancelled re-check).
        sched_task = self._schedules.pop(task_id, None)
        if sched_task is not None and not sched_task.done():
            sched_task.cancel()
            await asyncio.gather(sched_task, return_exceptions=True)
        return record

    async def expedite_task(
        self,
        task_id: str,
        adapters: dict[str, ProviderAdapter | None] | None = None,
    ) -> TaskRecord:
        """Dispatch a scheduled provider-call task immediately.

        Cancels any in-flight asyncio sleep, atomically claims the row,
        and runs the provider call with the current-hour intensity from
        a fresh forecast. The resulting receipt's ``intensity_source``
        is set to ``"expedited"``.

        Closure-based tasks (those enqueued via :meth:`defer` /
        :meth:`enqueue`) cannot be expedited because they need their
        original in-process closure; expedite is provider-call only.
        """
        adapters = adapters or {}
        record = await self._lookup_record(task_id)
        if record is None:
            raise KeyError(f"expedite_task: task {task_id!r} not found")
        if not record.body_json:
            raise RuntimeError(
                f"expedite_task: task {task_id!r} has no body_json; "
                "expedite is only valid for tasks enqueued via enqueue_provider_call"
            )
        if record.status in ("running", "completed", "failed", "cancelled"):
            raise RuntimeError(
                f"expedite_task: task {task_id!r} is {record.status!r}, "
                "only queued/scheduled tasks can be expedited"
            )

        # Cancel any in-process sleep timer.
        sched_task = self._schedules.pop(task_id, None)
        if sched_task is not None and not sched_task.done():
            sched_task.cancel()
            try:  # noqa: SIM105
                await sched_task
            except (asyncio.CancelledError, Exception):
                pass

        # Force the scheduled_for to "now" so the claim and subsequent
        # tick semantics line up, then atomically claim.
        record.scheduled_for = _iso_utc(_now_utc())
        record.status = "scheduled"
        self._tasks[task_id] = record
        if self._store is not None and self._connected:
            await self._store.upsert(record)
        won = await self._claim_for_dispatch(record)
        if not won:
            # Same row-level claim tick() uses: if a concurrent process
            # (e.g. the cron tick) grabbed the row between our upsert and
            # here, do NOT dispatch a second (double-billed) provider
            # call.
            raise RuntimeError(
                f"task {task_id} was just claimed by another process (racing tick?)"
            )
        await self._dispatch_provider_call(
            record, adapters, intensity_source_override="expedited"
        )
        return self._tasks[task_id]

    async def update_deadline(
        self, task_id: str, new_deadline: str | datetime
    ) -> TaskRecord:
        """Reschedule a queued / scheduled task against a new deadline.

        Raises
        ------
        InvalidDeadlineError
            If ``new_deadline`` cannot be parsed or is in the past.
        KeyError
            If ``task_id`` is unknown.
        RuntimeError
            If the task is ``running`` or already in a terminal state.
        """
        deadline = normalize_deadline(new_deadline)
        record = await self._lookup_record(task_id)
        if record is None:
            raise KeyError(f"update_deadline: task {task_id!r} not found")
        if record.status not in ("queued", "scheduled"):
            raise RuntimeError(
                f"update_deadline: task {task_id!r} is {record.status!r}, "
                "only queued/scheduled tasks can be re-scheduled"
            )

        # Cancel any in-flight in-process timer; we'll re-arm below.
        sched_task = self._schedules.pop(task_id, None)
        if sched_task is not None and not sched_task.done():
            sched_task.cancel()
            try:  # noqa: SIM105
                await sched_task
            except (asyncio.CancelledError, Exception):
                pass

        # Reset to "queued" before re-scoring so a transient
        # observer sees a coherent state transition.
        record.status = "queued"
        record.scheduled_for = None
        record.deadline = _iso_utc(deadline)
        self._tasks[task_id] = record
        if self._store is not None and self._connected:
            await self._store.upsert(record)

        if record.body_json:
            # Provider-call task: re-pick a window but do NOT spin up an
            # in-process timer. Driven by tick().
            await self._schedule_provider_call(task_id, deadline)
        else:
            # Closure task: re-arm the in-process schedule loop.
            self._spawn_schedule(asyncio.get_running_loop(), task_id, deadline)
        return self._tasks[task_id]

    async def retry_task(
        self,
        task_id: str,
        adapters: dict[str, ProviderAdapter | None] | None = None,
    ) -> TaskRecord:
        """Re-dispatch a failed provider-call task via the expedite path.

        Only valid when ``status == "failed"``. The new receipt
        overwrites the old.
        """
        record = await self._lookup_record(task_id)
        if record is None:
            raise KeyError(f"retry_task: task {task_id!r} not found")
        if record.status != "failed":
            raise RuntimeError(
                f"retry_task: task {task_id!r} is {record.status!r}, only failed tasks can be retried"
            )
        if not record.body_json:
            raise RuntimeError(
                f"retry_task: task {task_id!r} has no body_json; "
                "only provider-call tasks can be retried"
            )
        # Clear failure metadata before re-running.
        record.status = "queued"
        record.error = None
        record.completed_at = None
        record.receipt = None
        record.intensity_source = None
        self._tasks[task_id] = record
        if self._store is not None and self._connected:
            await self._store.upsert(record)
        return await self.expedite_task(task_id, adapters)

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
            # V20: distinguish first-schedule from hourly re-entry via the
            # committed window. On re-entry a transient feed failure must
            # NOT abandon the already-chosen clean window and dispatch
            # into an unknown (possibly dirty) hour.
            committed = (
                _parse_iso(record.scheduled_for) if record.scheduled_for else None
            )
            now = _now_utc()
            if committed is not None and committed > now and now <= deadline:
                # Keep the window: nap toward it and re-enter (the next
                # entry retries the fetch; when the window itself
                # arrives, the branch below dispatches).
                wait_s = (committed - now).total_seconds()
                await asyncio.sleep(min(_SLEEP_CHUNK_S, wait_s))
                await self._schedule(task_id, deadline)
                return
            if committed is not None:
                # The committed window has arrived (or the deadline would
                # otherwise be missed) — dispatch now, at the window.
                await self._dispatch(task_id, now, None)
                return
            # First schedule with no committed window — dispatch
            # immediately rather than miss the deadline entirely.
            await self._dispatch(task_id, now, None)
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

        target = _parse_iso(candidate.datetime)
        if target is None:
            await self._dispatch(task_id, _now_utc(), None)
            return
        if target <= _now_utc():
            # The chosen window is the *current* hour (its start is in
            # the past) — dispatch now, keeping the scored entry for the
            # receipt (§1.7).
            await self._dispatch(task_id, _now_utc(), candidate)
            return

        record.status = "scheduled"
        record.scheduled_for = candidate.datetime
        if self._store is not None and self._connected:
            await self._store.upsert(record)

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
        # Never overwrite a terminal state (a completed = billed dispatch,
        # or an explicit cancellation) with "failed".
        if record.status in ("completed", "failed", "cancelled"):
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
        # The try/except is deliberately narrow: it covers ONLY the user's
        # task body. Once the body has succeeded, every piece of
        # bookkeeping below (intensity fetch, receipt build/sign, ledger
        # write) is fail-soft — a successful run must never be re-labelled
        # "failed" by its paperwork (§0.5).
        try:
            outcome = body()
            if asyncio.iscoroutine(outcome) or isinstance(outcome, Awaitable):
                result = await outcome
            else:
                result = outcome
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
        duration_ms = (_now_utc() - start).total_seconds() * 1000.0

        # The task may have been cancelled while the body was running —
        # the resolver was already rejected by cancel_task. Do not
        # overwrite the cancelled ledger row with a completed record +
        # late result (§1.2).
        if record.status == "cancelled":
            _log.warning(
                "[ebb-ai/scheduler] task %s was cancelled while running; "
                "dropping its late result",
                task_id,
            )
            self._bodies.pop(task_id, None)
            self._resolvers.pop(task_id, None)
            return

        # Mirror the TS dispatch: the scored forecast entry is the
        # *estimate*; the intensity observed when the task actually ran is
        # the *actual*. With no scored window (immediate fallback) the two
        # coincide. Closure tasks carry no model/token info, so both sides
        # use the legacy flat energy estimate and the numbers are
        # unchanged from pre-v0.11.
        if forecast_entry is not None:
            estimated_intensity_g: float | None = (
                forecast_entry.carbon_intensity_g_co2_per_kwh
            )
            source: str = "scored"
        else:
            estimated_intensity_g = None
            source = "current"
        actual_intensity_g: float | None = None
        grid_source: GridSource | None = None
        try:
            actual_intensity_g, grid_source = await self._fetch_current_intensity(
                record.region, ran_at
            )
        except asyncio.CancelledError:
            raise
        except Exception as err:
            _log.warning(
                "[ebb-ai/scheduler] intensity fetch for the receipt failed (%s); "
                "receipt falls back to the schedule-time estimate",
                err,
            )
        receipt: CarbonReceipt | None = None
        try:
            intensity_for_actual = (
                actual_intensity_g
                if actual_intensity_g is not None
                else estimated_intensity_g
            )
            actual_carbon = (
                _round_half_up(_intensity_to_grams(intensity_for_actual) * 10) / 10
                if intensity_for_actual is not None
                else 0.0
            )
            estimated_carbon = (
                _round_half_up(_intensity_to_grams(estimated_intensity_g) * 10) / 10
                if estimated_intensity_g is not None
                else actual_carbon
            )
            delta_pct = (
                _round_half_up(
                    ((actual_carbon - estimated_carbon) / estimated_carbon) * 1000
                )
                / 10
                if estimated_carbon > 0
                else 0.0
            )
            receipt = self._maybe_sign(
                CarbonReceipt(
                    task_id=task_id,
                    ran_at=_iso_utc(ran_at),
                    region=record.region,
                    estimated_carbon_g_co2=estimated_carbon,
                    actual_carbon_g_co2=actual_carbon,
                    delta_pct=delta_pct,
                    duration_ms=duration_ms,
                    # Provenance: the raw intensity + which feed produced
                    # it. Left None when the receipt-side fetch failed.
                    # Closure tasks have no model, so the energy
                    # coefficients are the flat legacy fallback tier.
                    intensity_g_co2_per_kwh=actual_intensity_g,
                    grid_source=grid_source,
                    energy_source="fallback",
                )
            )
        except Exception as err:
            _log.warning(
                "[ebb-ai/scheduler] failed to build the carbon receipt for %s: %s; "
                "task stays completed without a receipt",
                task_id,
                err,
            )
        record.status = "completed"
        record.completed_at = _iso_utc(_now_utc())
        record.result = result
        record.receipt = receipt
        record.intensity_source = source  # type: ignore[assignment]
        if self._store is not None and self._connected:
            try:
                await self._store.upsert(record)
            except Exception as err:
                _log.warning(
                    "[ebb-ai/scheduler] failed to persist completed task %s: %s",
                    task_id,
                    err,
                )

        resolver = self._resolvers.pop(task_id, None)
        if resolver is not None:
            resolver.resolve(result)
        self._bodies.pop(task_id, None)

    async def _fetch_current_intensity(
        self, region: str, at: datetime
    ) -> tuple[float, GridSource]:
        """Look up the intensity figure (and its feed provenance) used
        for the actual side of a receipt: re-fetch the forecast and pick
        the entry closest to the moment the task ran.
        """
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
        intensity = best.carbon_intensity_g_co2_per_kwh if best is not None else 400.0
        return intensity, forecast.source

    # ----- v0.5 helpers ------------------------------------------------ #

    async def _lookup_record(self, task_id: str) -> TaskRecord | None:
        """Find a task by id, preferring in-memory state but falling back to SQLite."""
        record = self._tasks.get(task_id)
        if record is not None:
            return record
        if self._store is not None and self._connected:
            persisted = await self._store.load(task_id)
            if persisted is not None:
                self._tasks[task_id] = persisted
            return persisted
        return None

    async def _claim_for_dispatch(self, record: TaskRecord) -> bool:
        """Atomic row-level claim: scheduled → running. Wins exactly once.

        When SQLite-backed, defer to the store's
        :meth:`_TaskStore.claim_scheduled` which uses a single
        ``UPDATE ... WHERE status = 'scheduled'`` and reports its
        ``rowcount``. When in-memory only, falls back to a status check
        guarded by the asyncio cooperative scheduler.
        """
        if self._store is not None and self._connected:
            won = await self._store.claim_scheduled(record.task_id)
            if won:
                record.status = "running"
                self._tasks[record.task_id] = record
            else:
                # Refresh in-memory to whatever the DB now reflects.
                persisted = await self._store.load(record.task_id)
                if persisted is not None:
                    self._tasks[record.task_id] = persisted
            return won
        # In-memory only: cooperative-scheduling check is sufficient.
        current = self._tasks.get(record.task_id)
        if current is None or current.status != "scheduled":
            return False
        current.status = "running"
        self._tasks[record.task_id] = current
        return True

    async def _schedule_provider_call(
        self, task_id: str, deadline: datetime
    ) -> None:
        """Pick a carbon window for a provider-call task.

        Unlike :meth:`_schedule`, does **not** register an in-process
        timer — provider-call tasks are dispatched exclusively by
        :meth:`tick`. We still write ``status = "scheduled"`` +
        ``scheduled_for`` so the ledger reflects the chosen window and
        so a later ``tick`` can compare against ``now``.
        """
        record = self._tasks.get(task_id)
        if record is None:
            return

        # Parse spec.model out of the persisted body so the per-model
        # energy coefficients (v0.10) factor into both the budget filter
        # and the estimated-carbon projection recorded on the task.
        spec_model = _spec_model_from_body(record.body_json)

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
            _log.warning(
                "[ebb-ai/scheduler] forecast fetch failed for %s: %s", task_id, err
            )
            # Schedule for "now" so the next tick picks it up.
            record.status = "scheduled"
            record.scheduled_for = _iso_utc(_now_utc())
            self._tasks[task_id] = record
            if self._store is not None and self._connected:
                await self._store.upsert(record)
            return

        budget_g = record.carbon_budget_g
        if budget_g is not None:
            survivors = [
                e
                for e in forecast.entries
                if _intensity_to_grams(
                    e.carbon_intensity_g_co2_per_kwh, model=spec_model
                )
                <= budget_g
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
                cheapest_g = _intensity_to_grams(
                    cheapest.carbon_intensity_g_co2_per_kwh, model=spec_model
                )
                if cheapest_g > budget_g:
                    await self._fail(task_id, CarbonBudgetExceededError(cheapest_g, budget_g))
                    return
            # No usable window — schedule for "now" so the next tick runs it.
            record.status = "scheduled"
            record.scheduled_for = _iso_utc(_now_utc())
            self._tasks[task_id] = record
            if self._store is not None and self._connected:
                await self._store.upsert(record)
            return

        record.status = "scheduled"
        # A candidate whose hour started in the past is the *current*
        # hour — schedule for "now" so the very next tick dispatches
        # immediately (§1.7).
        candidate_at = _parse_iso(candidate.datetime)
        record.scheduled_for = (
            _iso_utc(_now_utc())
            if candidate_at is not None and candidate_at <= _now_utc()
            else candidate.datetime
        )
        record.estimated_carbon_g_co2 = (
            _round_half_up(
                _intensity_to_grams(
                    candidate.carbon_intensity_g_co2_per_kwh, model=spec_model
                )
                * 10
            )
            / 10
        )
        self._tasks[task_id] = record
        if self._store is not None and self._connected:
            await self._store.upsert(record)

    async def _dispatch_provider_call(
        self,
        record: TaskRecord,
        adapters: dict[str, ProviderAdapter | None],
        *,
        intensity_source_override: str | None = None,
    ) -> TickResultEntry:
        """Run one provider-call task against an adapter.

        Assumes the caller already won the atomic claim (i.e.
        ``record.status == "running"``). Persists the receipt or the
        failure, mutates the in-memory record, and returns a
        :class:`TickResultEntry`.
        """
        task_id = record.task_id
        if record.body_json is None:
            msg = "_dispatch_provider_call: missing body_json"
            await self._fail(task_id, RuntimeError(msg))
            return TickResultEntry(task_id=task_id, status="failed", error=msg)

        try:
            raw = json.loads(record.body_json)
        except (TypeError, ValueError) as err:
            msg = f"tick: corrupt body_json: {err}"
            await self._fail(task_id, RuntimeError(msg))
            return TickResultEntry(task_id=task_id, status="failed", error=msg)

        try:
            spec = ProviderCallSpec.from_dict(raw)
        except ValueError as err:
            msg = f"tick: invalid provider_call spec: {err}"
            await self._fail(task_id, RuntimeError(msg))
            return TickResultEntry(task_id=task_id, status="failed", error=msg)

        if spec.type != "provider_call":
            msg = "tick: body is not a provider_call spec"
            await self._fail(task_id, RuntimeError(msg))
            return TickResultEntry(task_id=task_id, status="failed", error=msg)

        adapter = adapters.get(spec.provider)
        if adapter is None:
            msg = f"tick: no adapter configured for provider {spec.provider!r}"
            await self._fail(task_id, RuntimeError(msg))
            return TickResultEntry(task_id=task_id, status="failed", error=msg)

        start = _now_utc()
        ran_at = start

        # Batch-vs-sync decision. We compare scheduled_for to a
        # 24h-from-now boundary; scheduled_for is the proxy (batch
        # routing proper — status "submitted" + polling against
        # record.deadline — lands in a later version). Expedited tasks
        # (whose scheduled_for is set to "now") therefore never go
        # through the batch endpoint, which is the right call.
        scheduled_for_ts = (
            _parse_iso(record.scheduled_for) if record.scheduled_for else None
        )
        more_than_24h = (
            scheduled_for_ts is not None
            and (scheduled_for_ts - _now_utc()) > timedelta(hours=24)
        )
        use_batch = (
            spec.prefer_batch and more_than_24h and hasattr(adapter, "dispatch_batch")
        )

        # Build adapter DispatchOptions.
        from .providers.base import DispatchOptions  # local import to avoid cycle

        opts = DispatchOptions(
            max_tokens=spec.max_tokens if spec.max_tokens is not None else 1024,
            system=spec.system_prompt,
            extra={"temperature": spec.temperature}
            if spec.temperature is not None
            else {},
        )

        # The try/except is deliberately narrow: it covers ONLY the
        # (billed) provider call. Everything after a successful call —
        # intensity fetch, receipt build/sign, ledger write, output file
        # — is fail-soft: a paid dispatch must NEVER be re-labelled
        # "failed" (a retry would bill the provider a second time), and
        # a post-success exception must never strand a zombie "running"
        # row, hang the defer() awaiter, or crash tick() (§0.5-PY).
        try:
            if use_batch:
                result_obj: Any = await _retry_with_backoff(
                    lambda: adapter.dispatch_batch(spec.model, [spec.prompt], opts)
                )
            else:
                result_obj = await _retry_with_backoff(
                    lambda: adapter.dispatch(spec.model, spec.prompt, opts)
                )
        except asyncio.CancelledError:
            raise
        except Exception as err:
            msg = str(err)
            record.status = "failed"
            record.completed_at = _iso_utc(_now_utc())
            record.error = msg
            self._tasks[task_id] = record
            if self._store is not None and self._connected:
                await self._store.upsert(record)
            return TickResultEntry(task_id=task_id, status="failed", error=msg)
        duration_ms = (_now_utc() - start).total_seconds() * 1000.0

        # The task may have been cancelled while the provider call was in
        # flight (this process, or another one via the shared store).
        # Keep the cancelled ledger row: do not overwrite it with
        # completed + result (§1.2).
        cancelled_elsewhere = False
        if self._store is not None and self._connected:
            try:
                persisted = await self._store.load(task_id)
                cancelled_elsewhere = (
                    persisted is not None and persisted.status == "cancelled"
                )
            except Exception:
                # Store read failure — fall back to the in-memory status.
                cancelled_elsewhere = False
        if record.status == "cancelled" or cancelled_elsewhere:
            record.status = "cancelled"
            _log.warning(
                "[ebb-ai/scheduler] task %s was cancelled while running; "
                "dropping its late result",
                task_id,
            )
            return TickResultEntry(
                task_id=task_id,
                status="failed",
                error="task was cancelled while running; late result dropped",
            )

        intensity_g: float | None = None
        grid_source: GridSource | None = None
        try:
            intensity_g, grid_source = await self._fetch_current_intensity(
                record.region, ran_at
            )
        except asyncio.CancelledError:
            raise
        except Exception as err:
            _log.warning(
                "[ebb-ai/scheduler] intensity fetch for the receipt failed (%s); "
                "receipt falls back to the schedule-time estimate",
                err,
            )
        source = (
            intensity_source_override
            if intensity_source_override is not None
            else "scored"
        )
        # Re-estimate energy with the real token counts the provider
        # reported so the receipt reflects this specific call rather than
        # a typical task at this model. The batch path returns a handle
        # with no usage, so tokens fall back to the per-model typical
        # estimate. ``estimated_carbon_g_co2`` was projected at schedule
        # time; the delta is the forecast drift between then and now.
        input_tokens = getattr(result_obj, "input_tokens", None)
        output_tokens = getattr(result_obj, "output_tokens", None)
        actual_model = getattr(result_obj, "model", None) or spec.model
        total_tokens = (
            input_tokens + output_tokens
            if input_tokens is not None and output_tokens is not None
            else None
        )
        receipt: CarbonReceipt | None = None
        try:
            actual_carbon = (
                _round_half_up(
                    _intensity_to_grams(
                        intensity_g,
                        model=actual_model,
                        input_tokens=input_tokens,
                        output_tokens=output_tokens,
                    )
                    * 10
                )
                / 10
                if intensity_g is not None
                else (record.estimated_carbon_g_co2 or 0.0)
            )
            estimated_carbon = (
                record.estimated_carbon_g_co2
                if record.estimated_carbon_g_co2 is not None
                else actual_carbon
            )
            delta_pct = (
                _round_half_up(
                    ((actual_carbon - estimated_carbon) / estimated_carbon) * 1000
                )
                / 10
                if estimated_carbon > 0
                else 0.0
            )
            receipt = self._maybe_sign(
                CarbonReceipt(
                    task_id=task_id,
                    ran_at=_iso_utc(ran_at),
                    region=record.region,
                    estimated_carbon_g_co2=estimated_carbon,
                    actual_carbon_g_co2=actual_carbon,
                    delta_pct=delta_pct,
                    # Record what actually ran (the adapter's result), not
                    # just what was requested — a runtime bridge may run a
                    # different model than spec.model. The batch path has
                    # no usage.
                    provider=getattr(result_obj, "provider", None) or spec.provider,
                    model=actual_model,
                    duration_ms=duration_ms,
                    prompt=_redact_prompt(spec.prompt, spec.redact_in_receipt),
                    total_tokens=total_tokens,
                    # Provenance (v0.12): the raw intensity, which feed
                    # produced it ("mock" = synthetic), and the confidence
                    # tier of the per-model energy coefficients. None
                    # intensity/grid_source means the receipt-side fetch
                    # failed and the actual side reuses the schedule-time
                    # estimate.
                    intensity_g_co2_per_kwh=intensity_g,
                    grid_source=grid_source,
                    energy_source=lookup_model_energy(actual_model).source,
                )
            )
        except Exception as err:
            _log.warning(
                "[ebb-ai/scheduler] failed to build the carbon receipt for %s: %s; "
                "task stays completed without a receipt",
                task_id,
                err,
            )
        record.status = "completed"
        record.completed_at = _iso_utc(_now_utc())
        record.result = _result_to_serializable(result_obj)
        record.receipt = receipt
        record.intensity_source = source  # type: ignore[assignment]
        # Terminal transition: redact secrets out of the persisted body.
        # The original (unredacted) body was needed up to this point so
        # the live dispatch used the caller's exact prompt; the ledger
        # keeps only the redacted form. (Failed tasks intentionally keep
        # the original body — retry_task must re-dispatch the exact
        # prompt.)
        record.body_json = _redact_body_json(record.body_json)
        self._tasks[task_id] = record
        if self._store is not None and self._connected:
            try:
                await self._store.upsert(record)
            except Exception as err:
                _log.warning(
                    "[ebb-ai/scheduler] failed to persist completed task %s: %s",
                    task_id,
                    err,
                )
        if spec.output_path and receipt is not None:
            await _write_output_file(
                spec.output_path, task_id, record.result, receipt
            )
        return TickResultEntry(task_id=task_id, status="completed")


def _result_to_serializable(value: Any) -> Any:
    """Best-effort coercion of an adapter return value into a JSON-able dict.

    The adapter base contracts return :class:`DispatchResult` /
    :class:`BatchHandle` dataclasses, which are slotted dataclasses with
    a ``raw`` attribute holding the vendor SDK object. We extract the
    flat scalar fields and drop ``raw`` so the value round-trips
    cleanly through SQLite without serializing a third-party SDK type.
    """
    if value is None:
        return None
    if isinstance(value, (str, int, float, bool, list, dict)):
        return value
    # Slotted dataclass-style objects (DispatchResult / BatchHandle).
    keys = (
        "text",
        "model",
        "provider",
        "input_tokens",
        "output_tokens",
        "batch_id",
        "prompt_count",
    )
    extracted: dict[str, Any] = {}
    for k in keys:
        if hasattr(value, k):
            v = getattr(value, k)
            if v is not None:
                extracted[k] = v
    if extracted:
        return extracted
    return {"_repr": repr(value)}


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
    # The dataclass holds the deadline as a string for serialization;
    # datetime instances are rendered to ISO here and re-parsed by
    # normalize_deadline when enqueue() runs.
    opts = DeferOptions(
        deadline=deadline.isoformat() if isinstance(deadline, datetime) else deadline,
        carbon_budget_g=carbon_budget_g,
        region=region,
        task_id=task_id,
    )
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
