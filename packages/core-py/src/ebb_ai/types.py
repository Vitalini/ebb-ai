"""Public and internal types for ebb-ai.

These mirror the TypeScript definitions in ``@ebb-ai/core`` 1:1 so that
serialized records (carbon receipts, task snapshots) round-trip cleanly
across language boundaries — important because the MCP server is in
TypeScript and downstream Python agents will consume the same JSON.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
from typing import Any, Literal

# Public type aliases — kept narrow to match the TS literal unions.
TaskStatus = Literal["queued", "scheduled", "running", "completed", "failed"]
"""Lifecycle of a deferred task."""

Band = Literal["very_clean", "clean", "average", "dirty", "very_dirty"]
"""Classifier for grid carbon intensity, matching the TS implementation."""

GridSource = Literal["electricityMaps", "wattTime", "mock"]
"""Source of the carbon-intensity forecast."""

IntensitySource = Literal["scored", "current"]
"""Where the receipt's intensity number came from.

``scored`` means the receipt used the same forecast entry the scheduler
scored the window against; ``current`` means we dispatched immediately
(no scored window) and looked up a fresh intensity at dispatch time.
"""


@dataclass(slots=True)
class DeferOptions:
    """Options passed by callers of :func:`defer` / :meth:`Scheduler.defer`.

    Parameters
    ----------
    deadline:
        ISO-8601 timestamp or :class:`datetime.datetime` instance. Must be
        in the future. Defaults to 24 hours from now if omitted.
    carbon_budget_g:
        Maximum carbon budget for this task in grams CO2-equivalent. If
        set, the scheduler will reject windows whose estimated grams
        exceed this value and will fail the task with
        :class:`CarbonBudgetExceededError` if no window inside the
        deadline meets the budget.
    region:
        Electricity Maps zone code (e.g. ``"US-CAL-CISO"``).
    task_id:
        Caller-supplied identifier for tracing. Must be a non-empty
        string and unique within the scheduler.
    """

    deadline: str | None = None
    carbon_budget_g: float | None = None
    region: str | None = None
    task_id: str | None = None


@dataclass(slots=True)
class GridForecastEntry:
    """One hourly bucket of a grid carbon-intensity forecast."""

    datetime: str
    """ISO-8601 start of this hour, with UTC offset."""

    carbon_intensity_g_co2_per_kwh: float
    """Grams CO2-equivalent per kWh — marginal or average, see source."""

    band: Band
    """Convenience: same value classified into a band."""

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass(slots=True)
class GridForecast:
    """A full grid forecast for a region."""

    region: str
    source: GridSource
    generated_at: str
    """ISO-8601 timestamp when this forecast was generated."""

    entries: list[GridForecastEntry] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return {
            "region": self.region,
            "source": self.source,
            "generated_at": self.generated_at,
            "entries": [e.to_dict() for e in self.entries],
        }


@dataclass(slots=True)
class CarbonReceipt:
    """Audit trail for an executed task.

    The TS port serializes this with camelCase keys; here we use
    snake_case for Python ergonomics, but :meth:`to_camel_dict` produces
    the cross-language shape.
    """

    task_id: str
    ran_at: str
    region: str
    estimated_carbon_g_co2: float
    provider: str | None = None
    model: str | None = None
    duration_ms: float | None = None
    """Wall-clock duration of the dispatched call, in milliseconds."""

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)

    def to_camel_dict(self) -> dict[str, Any]:
        """Render with TS-compatible camelCase keys."""
        d: dict[str, Any] = {
            "taskId": self.task_id,
            "ranAt": self.ran_at,
            "region": self.region,
            "estimatedCarbonGCo2": self.estimated_carbon_g_co2,
        }
        if self.provider is not None:
            d["provider"] = self.provider
        if self.model is not None:
            d["model"] = self.model
        if self.duration_ms is not None:
            d["durationMs"] = self.duration_ms
        return d


@dataclass(slots=True)
class TaskRecord:
    """A single deferred task at any point in its lifecycle."""

    task_id: str
    status: TaskStatus
    enqueued_at: str
    region: str
    scheduled_for: str | None = None
    completed_at: str | None = None
    carbon_budget_g: float | None = None
    result: Any = None
    error: str | None = None
    receipt: CarbonReceipt | None = None
    intensity_source: IntensitySource | None = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "task_id": self.task_id,
            "status": self.status,
            "enqueued_at": self.enqueued_at,
            "region": self.region,
            "scheduled_for": self.scheduled_for,
            "completed_at": self.completed_at,
            "carbon_budget_g": self.carbon_budget_g,
            "result": self.result,
            "error": self.error,
            "receipt": self.receipt.to_dict() if self.receipt else None,
            "intensity_source": self.intensity_source,
        }


__all__ = [
    "Band",
    "CarbonReceipt",
    "DeferOptions",
    "GridForecast",
    "GridForecastEntry",
    "GridSource",
    "IntensitySource",
    "TaskRecord",
    "TaskStatus",
]
