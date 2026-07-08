"""recommend_window — planning endpoint tests.

Mirrors ``packages/core-ts/test/recommend.test.ts`` 1:1:
- happy path (chosen window + alternatives + savings number + reasoning)
- budget filter (drops dirty entries, throws when nothing survives)
- batch_eligible flag (true iff deadline > 24h out)
- alternatives ordering (ascending by intensity, excludes chosen)
- error propagation (InvalidDeadlineError, CarbonBudgetExceededError)
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

import pytest

from ebb_ai import (
    CarbonBudgetExceededError,
    InvalidDeadlineError,
    RecommendResult,
    recommend_window,
)
from ebb_ai.grid import GridFeed
from ebb_ai.types import Band, GridForecast, GridForecastEntry


def _band(g: float) -> Band:
    if g < 100:
        return "very_clean"
    if g < 250:
        return "clean"
    if g < 450:
        return "average"
    if g < 700:
        return "dirty"
    return "very_dirty"


def _iso(dt: datetime) -> str:
    """Match the TS port's ISO formatting (millisecond precision, trailing Z)."""
    aware = dt.astimezone(UTC) if dt.tzinfo else dt.replace(tzinfo=UTC)
    ms = aware.microsecond // 1000
    return aware.strftime("%Y-%m-%dT%H:%M:%S") + f".{ms:03d}Z"


class _StaticFeed(GridFeed):
    """Deterministic feed built from explicit (hours_from_now, intensity) pairs."""

    source: str = "mock"  # type: ignore[assignment]

    def __init__(self, now: datetime, pairs: list[tuple[float, float]]) -> None:
        self._entries = [
            GridForecastEntry(
                datetime=_iso(now + timedelta(hours=h)),
                carbon_intensity_g_co2_per_kwh=g,
                band=_band(g),
            )
            for h, g in pairs
        ]
        self._now = now

    async def fetch_forecast(self, region: str, hours: int) -> GridForecast:
        return GridForecast(
            region=region,
            source="mock",
            generated_at=_iso(self._now),
            entries=list(self._entries),
        )


# --------------------------------------------------------------------------- #
# Happy path


@pytest.mark.asyncio
async def test_picks_cheapest_in_deadline_window() -> None:
    now = datetime(2026, 5, 12, 10, 0, 0, tzinfo=UTC)
    feed = _StaticFeed(
        now,
        [(0, 500), (1, 400), (2, 300), (3, 100), (4, 200), (5, 250)],
    )
    deadline = now + timedelta(hours=6)
    r = await recommend_window(
        deadline=deadline,
        region="US-CAL-CISO",
        feed=feed,
        now=lambda: now,
    )
    assert isinstance(r, RecommendResult)
    assert r.intensity_g_co2_per_kwh == 100
    assert r.band == "clean"
    # 0.0015 * 100 = 0.15 → rounded to 0.2
    assert r.estimated_carbon_g_co2 == pytest.approx(0.2, abs=0.05)


@pytest.mark.asyncio
async def test_computes_savings_vs_now_as_integer_pct() -> None:
    now = datetime(2026, 5, 12, 10, 0, 0, tzinfo=UTC)
    feed = _StaticFeed(now, [(0, 500), (1, 100), (2, 250)])
    deadline = now + timedelta(hours=3)
    r = await recommend_window(
        deadline=deadline,
        region="US-CAL-CISO",
        feed=feed,
        now=lambda: now,
    )
    assert r.estimated_savings_vs_now_pct == 80


@pytest.mark.asyncio
async def test_reasoning_mentions_cleaner_than_now_when_savings_high() -> None:
    now = datetime(2026, 5, 12, 10, 0, 0, tzinfo=UTC)
    feed = _StaticFeed(now, [(0, 500), (2, 200)])
    r = await recommend_window(
        deadline=now + timedelta(hours=3),
        region="US-CAL-CISO",
        feed=feed,
        now=lambda: now,
    )
    assert "cleaner than dispatching now" in r.reasoning


@pytest.mark.asyncio
async def test_reasoning_generic_when_savings_low() -> None:
    now = datetime(2026, 5, 12, 10, 0, 0, tzinfo=UTC)
    feed = _StaticFeed(now, [(0, 300), (1, 290)])
    # Pin the tie-break to the strict cheapest (rng -> 0) so we exercise the
    # low-savings branch of the "cleanest in-deadline window" wording rather
    # than a random band pick (§2.1). 290 vs the 300 "now" cell is only ~3%,
    # below the 30% savings-tail threshold.
    r = await recommend_window(
        deadline=now + timedelta(hours=2),
        region="US-CAL-CISO",
        feed=feed,
        now=lambda: now,
        rng=lambda: 0.0,
    )
    assert "cleaner than dispatching now" not in r.reasoning
    assert "cleanest in-deadline window" in r.reasoning


# --------------------------------------------------------------------------- #
# Alternatives


@pytest.mark.asyncio
async def test_alternatives_top_three_excluding_chosen() -> None:
    now = datetime(2026, 5, 12, 10, 0, 0, tzinfo=UTC)
    feed = _StaticFeed(
        now,
        [
            (0, 600),
            (1, 100),  # chosen
            (2, 500),
            (3, 200),  # alt #1
            (4, 400),
            (5, 300),  # alt #3
            (6, 350),  # alt #2
        ],
    )
    deadline = now + timedelta(hours=7)
    r = await recommend_window(
        deadline=deadline,
        region="US-CAL-CISO",
        feed=feed,
        now=lambda: now,
    )
    assert r.intensity_g_co2_per_kwh == 100
    assert [a.intensity_g_co2_per_kwh for a in r.alternatives] == [200, 300, 350]
    for alt in r.alternatives:
        assert alt.estimated_carbon_g_co2 > 0
        assert alt.estimated_savings_vs_now_pct >= 0


@pytest.mark.asyncio
async def test_alternatives_shorter_when_few_entries() -> None:
    now = datetime(2026, 5, 12, 10, 0, 0, tzinfo=UTC)
    feed = _StaticFeed(now, [(0, 500), (1, 100)])
    deadline = now + timedelta(hours=2)
    r = await recommend_window(
        deadline=deadline,
        region="US-CAL-CISO",
        feed=feed,
        now=lambda: now,
    )
    assert len(r.alternatives) == 1


# --------------------------------------------------------------------------- #
# Carbon budget


@pytest.mark.asyncio
async def test_budget_drops_dirty_entries() -> None:
    now = datetime(2026, 5, 12, 10, 0, 0, tzinfo=UTC)
    # 0.0015 * intensity = grams. Budget 0.25g → only intensity ≤ 166.67 survives.
    feed = _StaticFeed(
        now,
        [(0, 500), (1, 200), (2, 150), (3, 100)],
    )
    deadline = now + timedelta(hours=4)
    r = await recommend_window(
        deadline=deadline,
        region="US-CAL-CISO",
        carbon_budget_g=0.25,
        feed=feed,
        now=lambda: now,
    )
    assert r.intensity_g_co2_per_kwh == 100
    assert len(r.alternatives) == 1
    assert r.alternatives[0].intensity_g_co2_per_kwh == 150


@pytest.mark.asyncio
async def test_budget_reasoning_when_one_survivor() -> None:
    now = datetime(2026, 5, 12, 10, 0, 0, tzinfo=UTC)
    feed = _StaticFeed(now, [(0, 500), (1, 400), (2, 100), (3, 350)])
    r = await recommend_window(
        deadline=now + timedelta(hours=4),
        region="US-CAL-CISO",
        carbon_budget_g=0.2,
        feed=feed,
        now=lambda: now,
    )
    assert "only one window meets the carbon budget" in r.reasoning


@pytest.mark.asyncio
async def test_budget_raises_when_nothing_survives() -> None:
    now = datetime(2026, 5, 12, 10, 0, 0, tzinfo=UTC)
    feed = _StaticFeed(now, [(0, 500), (1, 600), (2, 700)])
    with pytest.raises(CarbonBudgetExceededError):
        await recommend_window(
            deadline=now + timedelta(hours=3),
            region="US-CAL-CISO",
            carbon_budget_g=0.1,
            feed=feed,
            now=lambda: now,
        )


# --------------------------------------------------------------------------- #
# batch_eligible


@pytest.mark.asyncio
async def test_batch_eligible_when_deadline_over_24h() -> None:
    now = datetime(2026, 5, 12, 10, 0, 0, tzinfo=UTC)
    feed = _StaticFeed(now, [(0, 500), (10, 200), (25, 100)])
    r = await recommend_window(
        deadline=now + timedelta(hours=30),
        region="US-CAL-CISO",
        feed=feed,
        now=lambda: now,
    )
    assert r.batch_eligible is True
    assert "Batch API saves an additional 50%" in r.reasoning


@pytest.mark.asyncio
async def test_batch_ineligible_when_short_deadline() -> None:
    now = datetime(2026, 5, 12, 10, 0, 0, tzinfo=UTC)
    feed = _StaticFeed(now, [(0, 500), (1, 200)])
    r = await recommend_window(
        deadline=now + timedelta(hours=6),
        region="US-CAL-CISO",
        feed=feed,
        now=lambda: now,
    )
    assert r.batch_eligible is False
    assert "Batch API" not in r.reasoning


# --------------------------------------------------------------------------- #
# Errors


@pytest.mark.asyncio
async def test_invalid_deadline_string() -> None:
    with pytest.raises(InvalidDeadlineError):
        await recommend_window(deadline="not-a-date", region="US-CAL-CISO")


@pytest.mark.asyncio
async def test_past_deadline() -> None:
    with pytest.raises(InvalidDeadlineError):
        await recommend_window(
            deadline="2020-01-01T00:00:00Z", region="US-CAL-CISO"
        )


@pytest.mark.asyncio
async def test_empty_region() -> None:
    with pytest.raises(ValueError, match="region is required"):
        await recommend_window(
            deadline=datetime.now(UTC) + timedelta(hours=1),
            region="",
        )


# --------------------------------------------------------------------------- #
# Integration with default mock feed


@pytest.mark.asyncio
async def test_with_default_mock_feed() -> None:
    deadline = datetime.now(UTC) + timedelta(hours=6)
    r = await recommend_window(deadline=deadline, region="US-CAL-CISO")
    assert isinstance(r.scheduled_for, str)
    assert r.intensity_g_co2_per_kwh > 0
    assert r.band in {"very_clean", "clean", "average", "dirty", "very_dirty"}
    assert r.estimated_carbon_g_co2 > 0
