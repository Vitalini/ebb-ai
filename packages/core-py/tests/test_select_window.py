"""select_window — shared window-selection policy tests (§2.1).

Covers:
  - seeded-rng determinism (same seed -> same pick)
  - tolerance-band boundary (entries within / outside max(15%, 30g))
  - in-deadline filter including the current hour (>= now - 1h)
  - recommend / scheduler agreement on the candidate SET
  - the committing scheduler path (enqueue_provider_call) actually SPREADS
    dispatch hours across N tasks

The scheduler-spread test drives ``enqueue_provider_call`` (a real
committing path), not ``recommend_window``, which is the point of §2.1.
"""

from __future__ import annotations

import math
from collections.abc import Callable
from datetime import UTC, datetime, timedelta

import pytest

from ebb_ai import (
    DeferOptions,
    ProviderCallSpec,
    Scheduler,
    recommend_window,
    select_window,
)
from ebb_ai.grid import GridFeed
from ebb_ai.types import Band, GridForecast, GridForecastEntry


def _seeded(seed: int) -> Callable[[], float]:
    """mulberry32 — deterministic PRNG so the tie-break is reproducible."""
    s = seed & 0xFFFFFFFF

    def _next() -> float:
        nonlocal s
        s = (s + 0x6D2B79F5) & 0xFFFFFFFF
        t = s
        t = (t ^ (t >> 15)) * (t | 1) & 0xFFFFFFFF
        t ^= (t + ((t ^ (t >> 7)) * (t | 61) & 0xFFFFFFFF)) & 0xFFFFFFFF
        return ((t ^ (t >> 14)) & 0xFFFFFFFF) / 4294967296.0

    return _next


def _cycling(values: list[float]) -> Callable[[], float]:
    """Cycle a fixed sequence of rng values — walks every band index."""
    i = 0

    def _next() -> float:
        nonlocal i
        v = values[i % len(values)]
        i += 1
        return v

    return _next


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


def _entries(
    now: datetime, pairs: list[tuple[float, float]]
) -> list[GridForecastEntry]:
    return [
        GridForecastEntry(
            datetime=(now + timedelta(hours=h)).isoformat(),
            carbon_intensity_g_co2_per_kwh=g,
            band=_band(g),
        )
        for h, g in pairs
    ]


class _StaticFeed(GridFeed):
    source: str = "mock"  # type: ignore[assignment]

    def __init__(self, now: datetime, entries: list[GridForecastEntry]) -> None:
        self._now = now
        self._entries = entries

    async def fetch_forecast(self, region: str, hours: int) -> GridForecast:
        return GridForecast(
            region=region,
            source="mock",
            generated_at=self._now.isoformat(),
            entries=list(self._entries),
        )


# --------------------------------------------------------------------------- #
# Determinism


def test_select_window_deterministic_under_seed() -> None:
    now = datetime(2026, 5, 12, 10, 0, 0, tzinfo=UTC)
    entries = _entries(now, [(0, 500), (1, 100), (2, 110), (3, 120), (4, 400)])
    deadline = now + timedelta(hours=6)
    a = select_window(entries, deadline, now=lambda: now, rng=_seeded(42))
    b = select_window(entries, deadline, now=lambda: now, rng=_seeded(42))
    assert a is not None and b is not None
    assert a.chosen.datetime == b.chosen.datetime
    # cheapest 100 -> tolerance max(15, 30) = 30 -> band [100, 110, 120].
    assert [e.carbon_intensity_g_co2_per_kwh for e in a.band] == [100, 110, 120]


def test_select_window_none_when_out_of_deadline() -> None:
    now = datetime(2026, 5, 12, 10, 0, 0, tzinfo=UTC)
    entries = _entries(now, [(10, 100), (11, 120)])
    deadline = now + timedelta(hours=5)
    assert select_window(entries, deadline, now=lambda: now) is None


# --------------------------------------------------------------------------- #
# Tolerance band boundary


def test_band_edge_inclusive_and_exclusive() -> None:
    now = datetime(2026, 5, 12, 10, 0, 0, tzinfo=UTC)
    # cheapest 200 -> tolerance max(30, 30) = 30 -> edge at 230.
    entries = _entries(now, [(0, 500), (1, 200), (2, 230), (3, 231), (4, 260)])
    deadline = now + timedelta(hours=6)
    sel = select_window(entries, deadline, now=lambda: now)
    assert sel is not None
    assert sel.tolerance == 30
    assert [e.carbon_intensity_g_co2_per_kwh for e in sel.band] == [200, 230]


def test_band_uses_30g_floor() -> None:
    now = datetime(2026, 5, 12, 10, 0, 0, tzinfo=UTC)
    # cheapest 80 -> 15% = 12, floor 30 wins -> edge at 110.
    entries = _entries(now, [(1, 80), (2, 105), (3, 111)])
    deadline = now + timedelta(hours=6)
    sel = select_window(entries, deadline, now=lambda: now)
    assert sel is not None
    assert sel.tolerance == 30
    assert [e.carbon_intensity_g_co2_per_kwh for e in sel.band] == [80, 105]


def test_band_uses_15pct_when_above_floor() -> None:
    now = datetime(2026, 5, 12, 10, 0, 0, tzinfo=UTC)
    # cheapest 400 -> 15% = 60 > 30 -> edge at 460.
    entries = _entries(now, [(1, 400), (2, 460), (3, 461)])
    deadline = now + timedelta(hours=6)
    sel = select_window(entries, deadline, now=lambda: now)
    assert sel is not None
    assert sel.tolerance == 60
    assert [e.carbon_intensity_g_co2_per_kwh for e in sel.band] == [400, 460]


# --------------------------------------------------------------------------- #
# Current-hour inclusion (§1.7)


def test_in_deadline_includes_current_hour() -> None:
    now = datetime(2026, 5, 12, 10, 30, 0, tzinfo=UTC)
    anchor = datetime(2026, 5, 12, 10, 0, 0, tzinfo=UTC)
    # Entry at 10:00 started 30min ago -> the current hour, still valid.
    entries = _entries(anchor, [(0, 300), (1, 200)])
    deadline = now + timedelta(hours=3)
    sel = select_window(entries, deadline, now=lambda: now)
    assert sel is not None
    assert {e.carbon_intensity_g_co2_per_kwh for e in sel.sorted} == {200, 300}


def test_in_deadline_excludes_older_than_hour() -> None:
    now = datetime(2026, 5, 12, 12, 0, 0, tzinfo=UTC)
    anchor = datetime(2026, 5, 12, 10, 0, 0, tzinfo=UTC)
    entries = _entries(anchor, [(0, 300), (2, 200)])  # 10:00 is 2h old -> OUT
    deadline = now + timedelta(hours=3)
    sel = select_window(entries, deadline, now=lambda: now)
    assert sel is not None
    assert [e.carbon_intensity_g_co2_per_kwh for e in sel.sorted] == [200]


# --------------------------------------------------------------------------- #
# recommend / scheduler agreement on candidate set (§2.1)


@pytest.mark.asyncio
async def test_recommend_and_scheduler_agree_on_band() -> None:
    # The Scheduler scores against real _now_utc(); anchor entries at the
    # current hour so both the recommend path (injected clock) and the
    # committing path (real clock) see the same in-deadline window.
    now = datetime.now(UTC).replace(minute=0, second=0, microsecond=0)
    entries = _entries(now, [(0, 500), (1, 100), (2, 115), (3, 125), (4, 400)])
    deadline = now + timedelta(hours=6)
    feed = _StaticFeed(now, entries)

    truth = select_window(entries, deadline, now=lambda: now)
    assert truth is not None
    band_intensities = [e.carbon_intensity_g_co2_per_kwh for e in truth.band]
    assert band_intensities == [100, 115, 125]

    rec = await recommend_window(
        deadline=deadline,
        region="US-CAL-CISO",
        feed=feed,
        now=lambda: now,
        rng=_seeded(7),
    )
    rec_set = {rec.intensity_g_co2_per_kwh} | {
        a.intensity_g_co2_per_kwh for a in rec.alternatives
    }
    for g in band_intensities:
        assert g in rec_set


# --------------------------------------------------------------------------- #
# Committing scheduler path spreads dispatch hours (§2.1)


@pytest.mark.asyncio
async def test_enqueue_provider_call_spreads_across_hours() -> None:
    # Three near-equal troughs at +1h, +2h, +3h from the current hour.
    now = datetime.now(UTC).replace(minute=0, second=0, microsecond=0)
    entries = _entries(
        now, [(0, 500), (1, 100), (2, 108), (3, 116), (4, 480), (5, 470)]
    )
    feed = _StaticFeed(now, entries)
    deadline = (now + timedelta(hours=6)).isoformat()

    n = 50
    rng = _cycling([0.05, 0.4, 0.75])
    async with Scheduler(feed=feed, rng=rng) as s:
        hours: set[int] = set()
        for i in range(n):
            spec = ProviderCallSpec(
                provider="anthropic", model="claude-sonnet-4-5", prompt=f"task {i}"
            )
            rec = await s.enqueue_provider_call(
                spec,
                DeferOptions(
                    deadline=deadline, region="US-CAL-CISO", task_id=f"spread-{i}"
                ),
            )
            assert rec.scheduled_for is not None
            parsed = rec.scheduled_for.replace("Z", "+00:00")
            hours.add(datetime.fromisoformat(parsed).astimezone(UTC).hour)
        # The point of §2.1: committed tasks do NOT all pile on one hour.
        assert len(hours) > 1


def test_default_rng_returns_unit_interval() -> None:
    from ebb_ai.scheduler import _default_rng

    for _ in range(100):
        v = _default_rng()
        assert 0.0 <= v < 1.0
    assert not math.isnan(_default_rng())
