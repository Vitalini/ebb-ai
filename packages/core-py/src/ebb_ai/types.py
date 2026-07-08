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
TaskStatus = Literal[
    "queued",
    "scheduled",
    "running",
    "submitted",
    "completed",
    "failed",
    "cancelled",
]
"""Lifecycle of a deferred task.

v0.5 adds ``cancelled``: a task explicitly stopped by the caller via
:meth:`Scheduler.cancel_task` before it ran. v0.12 adds ``submitted``:
the task was routed through a provider Batch API and is awaiting
results — ``tick()`` will transition it to ``completed`` only when
results actually arrive.
"""

Band = Literal["very_clean", "clean", "average", "dirty", "very_dirty"]
"""Classifier for grid carbon intensity, matching the TS implementation."""

GridSource = Literal[
    "electricityMaps", "ukCarbonIntensity", "eia", "entsoe", "wattTime", "mock"
]
"""Source of the carbon-intensity forecast.

Mirrors the TS ``GridForecast["source"]`` union. The Python feed module
currently only emits ``electricityMaps`` / ``mock``, but the wider set is
accepted so a record persisted by the TS port (``ukCarbonIntensity`` /
``eia`` / ``entsoe``) round-trips through the Python types unchanged.
"""

IntensitySource = Literal["scored", "current", "expedited"]
"""Where the receipt's intensity number came from.

``scored`` means the receipt used the same forecast entry the scheduler
scored the window against; ``current`` means we dispatched immediately
(no scored window) and looked up a fresh intensity at dispatch time;
``expedited`` means the caller invoked :meth:`Scheduler.expedite_task`
and the scheduler used the current-hour intensity from a fresh forecast.
"""

Provider = Literal["anthropic", "openai"]
"""Provider identifier for :class:`ProviderCallSpec`."""

ForecastKind = Literal["forecast", "persistence"]
"""How a :class:`GridForecast` series was produced (v0.12+).

``forecast`` is a genuine forward forecast; ``persistence`` means recent
realised observations were tiled onto future hours — a naive
persistence forecast. Feeds that relabel historical data must say so,
so downstream surfaces can disclose it.
"""

EnergySource = Literal["measured", "estimated", "fallback"]
"""Confidence tier of the per-model energy coefficients (v0.12+).

``measured`` — open-weight models with published measurements;
``estimated`` — closed models, size-class estimates; ``fallback`` —
unknown model (or closure task), flat legacy constant.
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

    kind: ForecastKind | None = None
    """How the series was produced (v0.12+): a genuine forward forecast
    (``"forecast"``) or realised observations tiled onto future hours
    (``"persistence"``). ``None`` on forecasts persisted before v0.12."""

    def to_dict(self) -> dict[str, Any]:
        d: dict[str, Any] = {
            "region": self.region,
            "source": self.source,
            "generated_at": self.generated_at,
            "entries": [e.to_dict() for e in self.entries],
        }
        if self.kind is not None:
            d["kind"] = self.kind
        return d


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
    """Carbon the scheduler projected for the chosen window at schedule
    time, in grams CO2-equivalent."""
    actual_carbon_g_co2: float | None = None
    """Carbon billed against the grid intensity actually observed at
    dispatch time. Equals ``estimated_carbon_g_co2`` when there was no
    separate projection step (immediate / expedited dispatch)."""
    delta_pct: float | None = None
    """Signed percentage drift of actual vs estimated, rounded to 0.1.
    Negative means the task ran cleaner than projected."""
    provider: str | None = None
    model: str | None = None
    duration_ms: float | None = None
    """Wall-clock duration of the dispatched call, in milliseconds."""
    prompt: str | None = None
    """The prompt as stored on the receipt — redacted per
    ``ProviderCallSpec.redact_in_receipt``. Provider-call tasks only;
    closure-based ``defer`` tasks leave this ``None``."""
    total_tokens: int | None = None
    """Total tokens (input + output) reported by the provider, if any."""
    intensity_g_co2_per_kwh: float | None = None
    """Grid intensity (gCO2eq/kWh) used to compute the actual side of this
    receipt (v0.12+). Recorded directly so consumers and ``ebb stats``
    never back-derive it from grams (which skews per-model receipts).
    ``None`` means the receipt-side intensity fetch failed and the actual
    side reused the schedule-time estimate."""
    grid_source: GridSource | None = None
    """Which grid feed produced the intensity (v0.12+). ``"mock"`` means
    the number is SYNTHETIC — the feed had no key or errored and fell
    back to the deterministic curve. Covered by the signature, so a
    signed receipt can no longer silently attest mock-derived carbon."""
    energy_source: EnergySource | None = None
    """Confidence tier of the per-model energy coefficients used
    (v0.12+): ``"measured"`` (open-weight, published measurements),
    ``"estimated"`` (closed models, size-class estimates), ``"fallback"``
    (unknown model or closure task, flat legacy constant)."""
    signature: str | None = None
    """Base64 Ed25519 signature over the canonical JSON encoding of every
    other field on this receipt (v0.11+). ``None`` on unsigned dispatches
    (signing disabled, or the ``[signing]`` extra absent); the verifier
    flags those as ``legacy-unsigned``."""
    signer_public_key: str | None = None
    """Base64-encoded raw 32-byte Ed25519 public key that produced
    ``signature``. Bundled on every signed receipt so a consumer can
    verify without out-of-band key distribution."""
    signed_at: str | None = None
    """ISO-8601 timestamp the signature was produced."""

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)

    def to_camel_dict(self) -> dict[str, Any]:
        """Render with TS-compatible camelCase keys.

        Optional fields are emitted only when set, mirroring how the TS
        port drops ``undefined`` properties.
        """
        d: dict[str, Any] = {
            "taskId": self.task_id,
            "ranAt": self.ran_at,
            "region": self.region,
            "estimatedCarbonGCo2": self.estimated_carbon_g_co2,
        }
        if self.actual_carbon_g_co2 is not None:
            d["actualCarbonGCo2"] = self.actual_carbon_g_co2
        if self.delta_pct is not None:
            d["deltaPct"] = self.delta_pct
        if self.provider is not None:
            d["provider"] = self.provider
        if self.model is not None:
            d["model"] = self.model
        if self.duration_ms is not None:
            d["durationMs"] = self.duration_ms
        if self.prompt is not None:
            d["prompt"] = self.prompt
        if self.total_tokens is not None:
            d["totalTokens"] = self.total_tokens
        if self.intensity_g_co2_per_kwh is not None:
            d["intensityGCo2PerKwh"] = self.intensity_g_co2_per_kwh
        if self.grid_source is not None:
            d["gridSource"] = self.grid_source
        if self.energy_source is not None:
            d["energySource"] = self.energy_source
        if self.signature is not None:
            d["signature"] = self.signature
        if self.signer_public_key is not None:
            d["signerPublicKey"] = self.signer_public_key
        if self.signed_at is not None:
            d["signedAt"] = self.signed_at
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
    body_json: str | None = None
    """JSON-serializable task body (v0.5).

    Populated when the task was enqueued via
    :meth:`Scheduler.enqueue_provider_call`. The cron-style :meth:`Scheduler.tick`
    rehydrates this string into a :class:`ProviderCallSpec` and dispatches it
    against the matching adapter, so the task survives the enqueuing
    process going away. Closure-based tasks
    (:meth:`Scheduler.defer` / :meth:`Scheduler.enqueue`) leave this
    field as ``None``.
    """

    estimated_carbon_g_co2: float | None = None
    """Carbon the scheduler projected for the chosen window when the task
    was scheduled, in grams CO2-equivalent. Recorded by
    :meth:`Scheduler._schedule_provider_call` so the dispatcher can compute
    the actual-vs-estimated delta on the receipt (v0.11). Absent for
    immediately-dispatched tasks, which have no projection step.
    """

    deadline: str | None = None
    """Normalized ISO deadline captured at enqueue (v0.12+). Persisted so
    dispatch-time decisions (Batch API eligibility) can be made against
    the real deadline instead of the ``scheduled_for`` proxy.
    """

    batch_id: str | None = None
    """Provider batch id when the task was routed through a Batch API
    (v0.12+). Set when status transitions to ``submitted``; ``tick()``
    polls this batch until results arrive.
    """

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
            "body_json": self.body_json,
            "estimated_carbon_g_co2": self.estimated_carbon_g_co2,
            "deadline": self.deadline,
            "batch_id": self.batch_id,
        }


@dataclass(slots=True)
class ProviderCallSpec:
    """JSON-serializable provider-call body (v0.5).

    Mirrors :class:`ProviderCallSpec` in
    ``packages/core-ts/src/types.ts`` field-for-field; snake_case here,
    camelCase on the wire when shipped to TS callers.

    Persisted in the SQLite ledger as ``body_json`` so a later
    :meth:`Scheduler.tick` — typically invoked from a cron — can
    rehydrate this struct and dispatch it against the matching provider
    adapter even after the enqueuing process has exited.
    """

    type: Literal["provider_call"] = "provider_call"
    provider: Provider = "anthropic"
    model: str = ""
    prompt: str = ""
    system_prompt: str | None = None
    max_tokens: int | None = None
    temperature: float | None = None
    prefer_batch: bool = True
    """If True (default), route through the provider's Batch API when the
    task's scheduled window is more than 24 hours out.
    """
    output_path: str | None = None
    """Optional file path. When set, the dispatcher writes
    ``{"taskId", "result", "receipt"}`` as JSON to this path after a
    successful dispatch. Useful when the caller wants to drop the result
    into an inbox or trigger a file-watcher rather than poll
    ``check_queue_status``. Accepted as camelCase ``outputPath`` from
    rows persisted by the TS port (a shared ``queue.db`` is a documented
    deployment).
    """
    redact_in_receipt: list[str] | None = None
    """Optional list of regex patterns the dispatcher redacts from the
    prompt before storing it on the receipt. ``None`` (default) applies a
    built-in set of vendor-shaped credential patterns; ``[]`` disables
    redaction entirely. The dispatched call always uses the original
    prompt — only the receipt's ``prompt`` field (and the terminal
    ``body_json`` ledger copy) is redacted.
    """

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> ProviderCallSpec:
        """Build a spec from a snake_case dict.

        Tolerates the camelCase keys ``systemPrompt`` / ``maxTokens`` /
        ``preferBatch`` so a record persisted by the TS port can also be
        rehydrated by the Python port.
        """
        if not isinstance(data, dict):
            raise ValueError(f"ProviderCallSpec.from_dict: expected dict, got {type(data)!r}")
        return cls(
            type=data.get("type", "provider_call"),
            provider=data.get("provider", "anthropic"),
            model=data.get("model", ""),
            prompt=data.get("prompt", ""),
            system_prompt=data.get("system_prompt", data.get("systemPrompt")),
            max_tokens=data.get("max_tokens", data.get("maxTokens")),
            temperature=data.get("temperature"),
            prefer_batch=data.get("prefer_batch", data.get("preferBatch", True)),
            output_path=data.get("output_path", data.get("outputPath")),
            redact_in_receipt=data.get(
                "redact_in_receipt", data.get("redactInReceipt")
            ),
        )


@dataclass(slots=True)
class TickResultEntry:
    """Per-task outcome returned by :meth:`Scheduler.tick`."""

    task_id: str
    status: Literal["completed", "failed", "submitted"]
    """``submitted`` (v0.12): the task was routed to a provider Batch API
    in this tick and is now awaiting results — a later tick polls it to
    ``completed`` or ``failed``. ``completed`` / ``failed`` are terminal.
    """
    error: str | None = None

    def to_dict(self) -> dict[str, Any]:
        d: dict[str, Any] = {"task_id": self.task_id, "status": self.status}
        if self.error is not None:
            d["error"] = self.error
        return d


@dataclass(slots=True)
class TickResult:
    """Aggregate result of one call to :meth:`Scheduler.tick`."""

    inspected: int = 0
    dispatched: int = 0
    failed: int = 0
    results: list[TickResultEntry] = field(default_factory=list)
    batch_submitted: int = 0
    """v0.12: tasks routed to a Batch API this tick (scheduled →
    submitted)."""
    batch_polled: int = 0
    """v0.12: submitted rows this tick observed as still in progress
    (stayed submitted). Batch tasks that completed/failed on poll are
    counted in ``dispatched`` / ``failed`` like any other terminal
    transition."""

    def to_dict(self) -> dict[str, Any]:
        return {
            "inspected": self.inspected,
            "dispatched": self.dispatched,
            "failed": self.failed,
            "results": [r.to_dict() for r in self.results],
            "batch_submitted": self.batch_submitted,
            "batch_polled": self.batch_polled,
        }


__all__ = [
    "Band",
    "CarbonReceipt",
    "DeferOptions",
    "EnergySource",
    "ForecastKind",
    "GridForecast",
    "GridForecastEntry",
    "GridSource",
    "IntensitySource",
    "Provider",
    "ProviderCallSpec",
    "TaskRecord",
    "TaskStatus",
    "TickResult",
    "TickResultEntry",
]
