"""recommend_window — non-committal planning endpoint.

Returns the optimal execution time for a task **without** scheduling it.
The agent calls this, sees the recommendation, then decides whether to
follow up with :meth:`Scheduler.defer` / :func:`defer`.

This module is deliberately stateless and never touches the Scheduler's
queue. It only reads the grid feed and runs pure scoring math, which makes
it safe to call from any context (an MCP handler, a CLI, a notebook).

Algorithm
---------
1. Validate the deadline (same rules as :func:`defer`).
2. Fetch a grid forecast for ``region``, horizon clamped to 72h.
3. Optionally drop entries above ``carbon_budget_g``.
4. Select a window via the shared ``select_window`` — a random pick from
   the cleanest-tolerance band, the SAME policy the committing scheduler
   paths use (§2.1), so planning and committing agree.
5. Compute alternatives = next 3 cheapest survivors (excluding the chosen).
6. Compute savings vs "now" using forecast ``entries[0]`` as the current cell.
7. Generate a one-line ``reasoning`` string tailored to the situation.

The result mirrors the TS port's :class:`RecommendResult` 1:1 (snake_case in
Python, camelCase in TypeScript) so JSON serialized over MCP round-trips.
"""

from __future__ import annotations

import logging
import math
from collections.abc import Callable
from dataclasses import asdict, dataclass, field
from datetime import UTC, datetime, timedelta
from typing import Any

from .energy import grams_for_intensity
from .errors import CarbonBudgetExceededError, InvalidDeadlineError
from .grid import GridFeed, mock_grid_feed
from .scheduler import select_window
from .types import Band, GridForecastEntry, GridSignalType, GridSource

_log = logging.getLogger(__name__)

#: Legacy flat estimate, retained for API stability (exported). Since
#: v0.10 the real math lives in :func:`ebb_ai.energy.grams_for_intensity`;
#: with no model it returns exactly this, so model-less callers are
#: unchanged.
ENERGY_KWH_PER_TASK: float = 0.0015
MAX_HORIZON_HOURS: int = 72
#: Anthropic & OpenAI Batch APIs both promise a 24h SLA.
BATCH_ELIGIBLE_HOURS: float = 24.0


@dataclass(slots=True)
class RecommendAlternative:
    """One non-chosen-but-still-clean alternative window."""

    scheduled_for: str
    intensity_g_co2_per_kwh: float
    band: Band
    estimated_carbon_g_co2: float
    estimated_savings_vs_now_pct: int

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass(slots=True)
class RecommendResult:
    """Output of :func:`recommend_window`.

    Field names are snake_case for Python ergonomics. The MCP server emits
    the same shape over JSON; the TS port mirrors this with camelCase.
    """

    scheduled_for: str
    intensity_g_co2_per_kwh: float
    band: Band
    estimated_carbon_g_co2: float
    estimated_savings_vs_now_pct: int
    batch_eligible: bool
    alternatives: list[RecommendAlternative] = field(default_factory=list)
    reasoning: str = ""
    grid_source: GridSource | None = None
    """Which grid feed produced the forecast this plan was scored against
    (v0.12+). ``"mock"`` means the recommendation is based on SYNTHETIC
    data — surface this to the caller."""
    signal_type: GridSignalType | None = None
    """Signal type of the forecast this plan was scored against (v0.14+):
    ``"marginal"`` (WattTime co2_moer) or ``None`` ⇒ ``"average"``. The
    ``reasoning`` string discloses it in prose; this field exposes it
    structurally. Mirrors the TS ``RecommendResult.signalType``."""

    def to_dict(self) -> dict[str, Any]:
        return {
            "scheduled_for": self.scheduled_for,
            "intensity_g_co2_per_kwh": self.intensity_g_co2_per_kwh,
            "band": self.band,
            "estimated_carbon_g_co2": self.estimated_carbon_g_co2,
            "estimated_savings_vs_now_pct": self.estimated_savings_vs_now_pct,
            "batch_eligible": self.batch_eligible,
            "alternatives": [a.to_dict() for a in self.alternatives],
            "reasoning": self.reasoning,
            "grid_source": self.grid_source,
            "signal_type": self.signal_type,
        }


# --------------------------------------------------------------------------- #
# Helpers


def _intensity_to_grams(g_co2_per_kwh: float, model: str | None = None) -> float:
    """Grams CO2 for one task at a given intensity, via the per-model
    coefficients (v0.10). ``model=None`` falls back to the legacy flat
    estimate, so callers that pass no model keep their pre-v0.10 numbers.
    """
    return grams_for_intensity(g_co2_per_kwh, model=model)


def _round_half_up(x: float) -> int:
    """Round halves toward +inf, matching JS ``Math.round`` (and the TS
    core). Python's builtin ``round`` is half-to-even, which diverges at
    exact ``.5`` boundaries; receipt/plan figures must match the TS port.
    """
    return math.floor(x + 0.5)


def _round_tenth(v: float) -> float:
    return _round_half_up(v * 10) / 10


def _format_hour(iso: str) -> str:
    """Match the spec's HH:MM formatting — strip date and seconds."""
    return iso[11:16]


def _compute_savings_pct(now_intensity: float, chosen_intensity: float) -> int:
    if now_intensity <= 0:
        return 0
    raw = (1.0 - chosen_intensity / now_intensity) * 100.0
    return max(0, _round_half_up(raw))


def _parse_iso(s: str) -> datetime | None:
    """Parse an ISO-8601 string; return ``None`` if unparseable.

    Accepts the JS-style trailing ``Z``.
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


def _normalize_deadline(
    d: str | datetime | None,
    now_fn: Callable[[], datetime] | None = None,
) -> datetime:
    """Validate and normalize a user-supplied deadline.

    Same rules as :func:`ebb_ai.scheduler.normalize_deadline`, but on this
    surface a missing deadline is an error (the spec says it's required).
    """
    if d is None:
        raise InvalidDeadlineError(d)
    if isinstance(d, datetime):
        parsed = d if d.tzinfo else d.replace(tzinfo=UTC)
    elif isinstance(d, str):
        maybe = _parse_iso(d)
        if maybe is None:
            raise InvalidDeadlineError(d)
        parsed = maybe
    else:
        raise InvalidDeadlineError(d)
    now = now_fn() if now_fn else datetime.now(UTC)
    if parsed < now - timedelta(seconds=5):
        raise InvalidDeadlineError(d)
    return parsed


def _with_source_disclosure(
    source: GridSource,
    signal_type: GridSignalType | None,
    reasoning: str,
) -> str:
    """Prefix the reasoning with a loud disclosure when the plan was
    scored against the synthetic mock curve, so an LLM caller (and the
    human it relays to) cannot mistake a keyless fallback for live grid
    data. Also discloses when the intensity is a MARGINAL signal (WattTime
    co2_moer) rather than the usual average — the two are not
    interchangeable. Mirrors the TS ``withSourceDisclosure``.
    """
    marginal_prefix = "MARGINAL-emissions signal — " if signal_type == "marginal" else ""
    if source == "mock":
        return f"SYNTHETIC (mock) grid data — {marginal_prefix}{reasoning}"
    return f"{marginal_prefix}{reasoning}"


def _build_reasoning(
    *,
    chosen: GridForecastEntry,
    savings_pct: int,
    batch_eligible: bool,
    budget_g: float | None,
    survivor_count: int,
    is_strict_cheapest: bool,
    clean_band_size: int,
) -> str:
    hour = _format_hour(chosen.datetime)
    band_str = chosen.band.replace("_", " ")
    savings_tail = (
        f"; ~{savings_pct}% cleaner than dispatching now" if savings_pct > 30 else ""
    )
    if budget_g is not None and survivor_count == 1:
        base = (
            f"only one window meets the carbon budget of {budget_g}g; "
            f"falls at {hour} UTC"
        )
    elif is_strict_cheapest:
        base = f"cleanest in-deadline window is {hour} UTC ({band_str} mix){savings_tail}"
    else:
        # Chosen at random from the cleanest-tolerance band, not the strict
        # minimum: be explicit so the wording does not contradict the
        # alternatives list, which will show a lower figure (§2.1).
        base = (
            f"{hour} UTC sits in the cleanest band ({band_str} mix; one of "
            f"{clean_band_size} near-equal low-carbon windows, picked to "
            f"spread grid load){savings_tail}"
        )
    if batch_eligible:
        return f"{base}; Batch API saves an additional 50% on cost (24h SLA)"
    return base


# --------------------------------------------------------------------------- #
# Public entrypoint


async def recommend_window(
    *,
    deadline: str | datetime,
    region: str,
    carbon_budget_g: float | None = None,
    model: str | None = None,  # per-model energy coefficients (v0.10); see below
    feed: GridFeed | None = None,
    now: Callable[[], datetime] | None = None,
    rng: Callable[[], float] | None = None,
) -> RecommendResult:
    """Compute a recommended execution window for a task.

    Pure planning — no side effects, no scheduler-queue mutation.

    Parameters
    ----------
    deadline:
        ISO-8601 string or :class:`datetime`. Must parse and be in the future.
    region:
        Electricity Maps zone code. Required.
    carbon_budget_g:
        Optional grams CO2e cap. Forecast entries above the budget are dropped
        before the cheapest window is selected.
    model:
        Optional vendor model name (e.g. ``"claude-sonnet-4-5"``). Selects
        the per-model energy coefficients (v0.10) used for the reported
        grams and the carbon-budget filter, matching the TS port. With no
        model the legacy flat estimate is used. It does not, on its own,
        change which window is cheapest (that's ranked by raw intensity),
        but it can change which windows survive a ``carbon_budget_g``.
    feed:
        Inject a grid feed. Defaults to :func:`mock_grid_feed`.
    now:
        Inject a clock. Defaults to :func:`datetime.now` (UTC).
    rng:
        Inject a pseudo-random generator returning ``[0, 1)``. Defaults to
        :func:`random.random`. Only affects the choice among entries within
        the cleanest-tolerance band when multiple equally-clean entries
        exist. A seeded generator makes the tie-break deterministic in
        tests. This is the SAME band+rng logic the committing scheduler
        paths use, so planning and committing agree on the candidate band
        (§2.1).

    Raises
    ------
    InvalidDeadlineError
        If ``deadline`` is missing/unparseable/past.
    CarbonBudgetExceededError
        If every in-deadline forecast entry exceeds the budget.
    """
    if not region:
        # region is a required field on this surface; matches the TS port.
        raise ValueError("recommend_window: region is required")

    parsed_deadline = _normalize_deadline(deadline, now)
    feed_impl = feed if feed is not None else mock_grid_feed()
    now_dt = now() if now else datetime.now(UTC)

    seconds_out = (parsed_deadline - now_dt).total_seconds()
    horizon_h = max(
        1,
        min(MAX_HORIZON_HOURS, int((seconds_out + 3599) // 3600)),
    )
    forecast = await feed_impl.fetch_forecast(region, horizon_h)
    entries = forecast.entries
    if not entries:
        raise RuntimeError("recommend_window: forecast returned no entries")

    # Entries mark the *start* of an hour, so the entry covering "now"
    # started up to an hour ago — it is a valid run-right-now candidate
    # and must not be excluded from the pick (or the savings math).
    in_deadline: list[GridForecastEntry] = []
    for e in entries:
        t = _parse_iso(e.datetime)
        if t is None:
            continue
        if now_dt - timedelta(hours=1) <= t <= parsed_deadline:
            in_deadline.append(e)

    if not in_deadline:
        head = entries[0]
        grams = _round_tenth(
            _intensity_to_grams(head.carbon_intensity_g_co2_per_kwh, model)
        )
        return RecommendResult(
            scheduled_for=head.datetime,
            intensity_g_co2_per_kwh=head.carbon_intensity_g_co2_per_kwh,
            band=head.band,
            estimated_carbon_g_co2=grams,
            estimated_savings_vs_now_pct=0,
            batch_eligible=False,
            alternatives=[],
            reasoning=_with_source_disclosure(
                forecast.source,
                forecast.signal_type,
                (
                    f"no in-deadline windows; best available is "
                    f"{_format_hour(head.datetime)} UTC"
                ),
            ),
            grid_source=forecast.source,
            signal_type=forecast.signal_type,
        )

    if carbon_budget_g is not None:
        survivors = [
            e
            for e in in_deadline
            if _intensity_to_grams(e.carbon_intensity_g_co2_per_kwh, model)
            <= carbon_budget_g
        ]
    else:
        survivors = list(in_deadline)

    if not survivors:
        cheapest = min(
            in_deadline, key=lambda e: e.carbon_intensity_g_co2_per_kwh
        )
        raise CarbonBudgetExceededError(
            _intensity_to_grams(cheapest.carbon_intensity_g_co2_per_kwh, model),
            carbon_budget_g,  # type: ignore[arg-type]  # cannot be None here
        )

    # Randomized cleanest-tolerance-band tie-break via the SAME
    # select_window the committing scheduler paths use, so planning and
    # committing agree on the candidate band (§2.1). Previously this port
    # took the strict minimum sorted_survivors[0] — the known PY gap where
    # every recommendation landed on the single trough hour. `survivors` is
    # already in-deadline + budget filtered; select_window's in-deadline
    # filter is idempotent over it.
    selection = select_window(survivors, parsed_deadline, now=now, rng=rng)
    assert selection is not None  # survivors is non-empty and in-deadline
    sorted_survivors = selection.sorted
    chosen = selection.chosen
    equally_clean = selection.band
    # Alternatives = next 3 cheapest entries that weren't chosen.
    alts_entries = [e for e in sorted_survivors if e is not chosen][:3]

    now_intensity = entries[0].carbon_intensity_g_co2_per_kwh
    savings_pct = _compute_savings_pct(
        now_intensity, chosen.carbon_intensity_g_co2_per_kwh
    )
    batch_eligible = seconds_out > BATCH_ELIGIBLE_HOURS * 3600

    alternatives = [
        RecommendAlternative(
            scheduled_for=e.datetime,
            intensity_g_co2_per_kwh=e.carbon_intensity_g_co2_per_kwh,
            band=e.band,
            estimated_carbon_g_co2=_round_tenth(
                _intensity_to_grams(e.carbon_intensity_g_co2_per_kwh, model)
            ),
            estimated_savings_vs_now_pct=_compute_savings_pct(
                now_intensity, e.carbon_intensity_g_co2_per_kwh
            ),
        )
        for e in alts_entries
    ]

    return RecommendResult(
        scheduled_for=chosen.datetime,
        intensity_g_co2_per_kwh=chosen.carbon_intensity_g_co2_per_kwh,
        band=chosen.band,
        estimated_carbon_g_co2=_round_tenth(
            _intensity_to_grams(chosen.carbon_intensity_g_co2_per_kwh, model)
        ),
        estimated_savings_vs_now_pct=savings_pct,
        batch_eligible=batch_eligible,
        alternatives=alternatives,
        reasoning=_with_source_disclosure(
            forecast.source,
            forecast.signal_type,
            _build_reasoning(
                chosen=chosen,
                savings_pct=savings_pct,
                batch_eligible=batch_eligible,
                budget_g=carbon_budget_g,
                survivor_count=len(survivors),
                # `chosen` is a random pick from the cleanest-tolerance
                # band, so it is not always the strict minimum. The
                # reasoning must say which case it is — otherwise it reads
                # as "cleanest" while the alternatives show a lower figure.
                is_strict_cheapest=chosen is sorted_survivors[0],
                clean_band_size=len(equally_clean),
            ),
        ),
        grid_source=forecast.source,
        signal_type=forecast.signal_type,
    )


__all__ = [
    "BATCH_ELIGIBLE_HOURS",
    "ENERGY_KWH_PER_TASK",
    "MAX_HORIZON_HOURS",
    "RecommendAlternative",
    "RecommendResult",
    "recommend_window",
]
