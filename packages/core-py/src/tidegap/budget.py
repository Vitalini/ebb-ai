"""Carbon-budget alerts over the receipt ledger (ROADMAP item 4).

Python port of ``packages/core-ts/src/budget.ts``. Distinct from the
per-task ``carbon_budget_g`` hard cap, an *aggregate* carbon budget is a
threshold on the total carbon actually spent across a rolling window —
daily / weekly / monthly — read straight off the completed receipts in the
ledger. Crossing the threshold fires an alert exactly once per (window,
threshold); the fired marker is persisted in the SQLite ledger so the alert
is idempotent across restarts and safe under a multi-process double-fire.

Pure over its inputs (no clock reads except where the caller passes ``at``;
the only I/O is :func:`load_carbon_budget_config`, which reads the config
file). No telemetry, no network — the budget is computed entirely from the
local ledger. Receipts and signing are untouched; an alert is derived
state, never a signed artifact.
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Literal

from .types import CarbonReceipt, TaskRecord

CarbonBudgetWindowKind = Literal["daily", "weekly", "monthly"]

_CONFIG_WINDOW_ENV = "EBB_CARBON_BUDGET_WINDOW"
_CONFIG_THRESHOLD_ENV = "EBB_CARBON_BUDGET_G"


@dataclass(frozen=True)
class CarbonBudgetConfig:
    """A configured aggregate carbon budget."""

    window_kind: CarbonBudgetWindowKind
    """Rolling window the threshold applies over."""
    threshold_g: float
    """Threshold in grams CO2-equivalent for one window."""


@dataclass(frozen=True)
class CarbonAlert:
    """Payload handed to the ``on_carbon_alert`` scheduler hook on a crossing."""

    window_kind: CarbonBudgetWindowKind
    window_start: str
    """ISO-8601 start of the crossed window."""
    threshold_g: float
    actual_g: float
    """Total window consumption at the moment of crossing, in grams."""
    task_id_that_crossed: str
    """Id of the task whose completion pushed the window over."""


@dataclass(frozen=True)
class CarbonBudgetUsage:
    """The consumption of a rolling window, summed over the supplied rows."""

    window_start: str
    window_end: str
    used_g: float
    task_count: int


@dataclass(frozen=True)
class CarbonBudgetStatus:
    """A computed budget-status snapshot for the current window."""

    window_kind: CarbonBudgetWindowKind
    window_start: str
    window_end: str
    threshold_g: float
    used_g: float
    pct: int
    task_count: int
    exceeded: bool
    alerted: bool


def carbon_budget_config_path() -> str:
    """Absolute path to the aggregate-budget config file."""
    return os.path.join(os.path.expanduser("~"), ".ebb-ai", "config")


def receipt_carbon_g(receipt: CarbonReceipt | None) -> float:
    """The carbon a single receipt contributes: *actual* grams, falling back
    to the schedule-time *estimate* when a task ran without a projection.
    """
    if receipt is None:
        return 0.0
    if receipt.actual_carbon_g_co2 is not None:
        return receipt.actual_carbon_g_co2
    if receipt.estimated_carbon_g_co2 is not None:
        return receipt.estimated_carbon_g_co2
    return 0.0


def _iso_midnight(dt: datetime) -> str:
    """Render a midnight-aligned UTC datetime the way ``Date.toISOString``
    does — millisecond precision, trailing ``Z`` (always ``.000``)."""
    return dt.strftime("%Y-%m-%dT%H:%M:%S") + ".000Z"


def window_bounds(
    kind: CarbonBudgetWindowKind, at: datetime,
) -> tuple[datetime, datetime]:
    """UTC bounds ``[start, end)`` of the window of ``kind`` containing ``at``.

    - daily:   the UTC calendar day.
    - weekly:  the ISO week (Monday 00:00 UTC -> next Monday).
    - monthly: the UTC calendar month.
    """
    aware = at.astimezone(UTC) if at.tzinfo else at.replace(tzinfo=UTC)
    y, m, d = aware.year, aware.month, aware.day
    if kind == "daily":
        start = datetime(y, m, d, tzinfo=UTC)
        return start, start + timedelta(days=1)
    if kind == "monthly":
        start = datetime(y, m, 1, tzinfo=UTC)
        end = (
            datetime(y + 1, 1, 1, tzinfo=UTC)
            if m == 12
            else datetime(y, m + 1, 1, tzinfo=UTC)
        )
        return start, end
    # weekly — ISO week starting Monday. weekday(): Mon=0..Sun=6.
    day_start = datetime(y, m, d, tzinfo=UTC)
    start = day_start - timedelta(days=day_start.weekday())
    return start, start + timedelta(days=7)


def _receipt_ran_at(row: TaskRecord) -> datetime | None:
    receipt = row.receipt
    if receipt is None or not receipt.ran_at:
        return None
    try:
        s = receipt.ran_at
        if s.endswith("Z"):
            s = s[:-1] + "+00:00"
        dt = datetime.fromisoformat(s)
    except (ValueError, TypeError):
        return None
    return dt.replace(tzinfo=UTC) if dt.tzinfo is None else dt


def carbon_budget_usage(
    rows: list[TaskRecord], kind: CarbonBudgetWindowKind, at: datetime,
) -> CarbonBudgetUsage:
    """Sum the carbon of every receipt whose ``ran_at`` falls inside the window
    of ``kind`` containing ``at``. Rows without a receipt (or an unparseable
    ``ran_at``) are skipped. Pure — deterministic over ``rows`` + ``at``.
    """
    start, end = window_bounds(kind, at)
    used_g = 0.0
    task_count = 0
    for row in rows:
        if row.receipt is None:
            continue
        t = _receipt_ran_at(row)
        if t is None or t < start or t >= end:
            continue
        used_g += receipt_carbon_g(row.receipt)
        task_count += 1
    return CarbonBudgetUsage(
        window_start=_iso_midnight(start),
        window_end=_iso_midnight(end),
        used_g=round(used_g, 2),
        task_count=task_count,
    )


def carbon_budget_status(
    rows: list[TaskRecord],
    config: CarbonBudgetConfig,
    at: datetime,
    alerted: bool,
) -> CarbonBudgetStatus:
    """A full budget-status snapshot for the current window. ``alerted`` is
    supplied by the caller (a DB probe) so this stays a pure function.
    """
    usage = carbon_budget_usage(rows, config.window_kind, at)
    pct = (
        round((usage.used_g / config.threshold_g) * 100)
        if config.threshold_g > 0
        else 0
    )
    return CarbonBudgetStatus(
        window_kind=config.window_kind,
        window_start=usage.window_start,
        window_end=usage.window_end,
        threshold_g=config.threshold_g,
        used_g=usage.used_g,
        pct=pct,
        task_count=usage.task_count,
        exceeded=usage.used_g >= config.threshold_g,
        alerted=alerted,
    )


def _normalize_window_kind(raw: str | None) -> CarbonBudgetWindowKind | None:
    v = raw.strip().lower() if raw is not None else None
    if v in ("daily", "weekly", "monthly"):
        return v  # type: ignore[return-value]
    return None


def _parse_key_values(contents: str) -> dict[str, str]:
    """Tiny KEY=VALUE parser — the same shape as the ``~/.config/ebb/env``
    secrets file. ``#`` comments, blank lines, one layer of surrounding
    quotes.
    """
    out: dict[str, str] = {}
    for raw_line in contents.splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue
        eq = line.find("=")
        if eq <= 0:
            continue
        key = line[:eq].strip()
        if not key:
            continue
        value = line[eq + 1 :].strip()
        if len(value) >= 2 and (
            (value.startswith('"') and value.endswith('"'))
            or (value.startswith("'") and value.endswith("'"))
        ):
            value = value[1:-1]
        out[key] = value
    return out


def load_carbon_budget_config(
    *,
    path: str | None = None,
    env: dict[str, str] | None = None,
) -> CarbonBudgetConfig | None:
    """Resolve the aggregate carbon budget from ``~/.ebb-ai/config`` (KEY=VALUE),
    with same-named environment variables taking precedence (an explicit env
    var always wins — exactly the secrets-file precedence).

    Returns ``None`` when no threshold is configured (feature off) or the
    values are malformed — a broken config never raises, it just disables the
    feature.

    Recognized keys (file or env):

    - ``EBB_CARBON_BUDGET_G``      — threshold in grams CO2e (required to enable)
    - ``EBB_CARBON_BUDGET_WINDOW`` — daily | weekly | monthly (default: daily)
    """
    # Read the two budget variables BY NAME rather than copying the whole
    # environment into this scope — the values here are a gram threshold and a
    # window name, and nothing else the host exports has any business being
    # visible to this function. (Mirrors the TS loader; see budget.ts.)
    environ = (
        env
        if env is not None
        else {
            k: v
            for k in (_CONFIG_THRESHOLD_ENV, _CONFIG_WINDOW_ENV)
            if (v := os.environ.get(k)) is not None
        }
    )
    cfg_path = path if path is not None else carbon_budget_config_path()
    file_values: dict[str, str] = {}
    if os.path.exists(cfg_path):
        try:
            with open(cfg_path, encoding="utf-8") as fh:
                file_values = _parse_key_values(fh.read())
        except OSError:
            file_values = {}
    raw_threshold = environ.get(_CONFIG_THRESHOLD_ENV) or file_values.get(
        _CONFIG_THRESHOLD_ENV
    )
    raw_window = environ.get(_CONFIG_WINDOW_ENV) or file_values.get(
        _CONFIG_WINDOW_ENV
    )
    if raw_threshold is None or str(raw_threshold).strip() == "":
        return None
    try:
        threshold_g = float(raw_threshold)
    except (ValueError, TypeError):
        return None
    if threshold_g <= 0:
        return None
    window_kind = _normalize_window_kind(raw_window) or "daily"
    return CarbonBudgetConfig(window_kind=window_kind, threshold_g=threshold_g)
