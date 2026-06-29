"""v0.11 receipt-parity tests: per-model energy, actual-vs-estimated
delta, token counts, prompt redaction, and Ed25519 signing — wired into
the scheduler to match ``packages/core-ts/src/scheduler.ts``.

These cover the gap where the Python ``energy.py`` / ``sign.py`` modules
shipped but were not consumed by the scheduler.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest

from ebb_ai import (
    CarbonReceipt,
    DeferOptions,
    ProviderCallSpec,
    Scheduler,
    is_signing_available,
    mock_grid_feed,
    verify_receipt,
)
from ebb_ai.grid import GridFeed
from ebb_ai.providers.base import (
    BatchHandle,
    DispatchOptions,
    DispatchResult,
    ProviderAdapter,
)
from ebb_ai.types import Band, GridForecast, GridForecastEntry

# --------------------------------------------------------------------- #
# Helpers


class FakeAdapter(ProviderAdapter):
    """Returns a deterministic DispatchResult with token usage."""

    name = "anthropic"

    def __init__(self) -> None:
        self.dispatch_calls: list[tuple[str, str]] = []

    async def dispatch(
        self, model: str, prompt: str, options: DispatchOptions | None = None
    ) -> DispatchResult:
        self.dispatch_calls.append((model, prompt))
        return DispatchResult(
            text=f"echo:{prompt}",
            model=model,
            provider=self.name,
            input_tokens=10,
            output_tokens=5,
        )

    async def dispatch_batch(
        self, model: str, prompts: list[str], options: DispatchOptions | None = None
    ) -> BatchHandle:
        return BatchHandle(
            batch_id="b-1", provider=self.name, model=model, prompt_count=len(prompts)
        )


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


class _OneEntryFeed(GridFeed):
    """A feed that always returns a single in-window entry at a fixed intensity."""

    source: str = "mock"  # type: ignore[assignment]

    def __init__(self, intensity: float = 400.0) -> None:
        self._intensity = intensity

    async def fetch_forecast(self, region: str, hours: int) -> GridForecast:
        now = datetime.now(UTC)
        entry = GridForecastEntry(
            datetime=(now + timedelta(hours=1)).isoformat(),
            carbon_intensity_g_co2_per_kwh=self._intensity,
            band=_band(self._intensity),
        )
        return GridForecast(
            region=region,
            source="mock",
            generated_at=now.isoformat(),
            entries=[entry],
        )


async def _tick_one(s: Scheduler, spec: ProviderCallSpec, task_id: str) -> CarbonReceipt:
    """Enqueue a provider-call task, force it due, tick once, return the receipt."""
    rec = await s.enqueue_provider_call(
        spec,
        DeferOptions(
            deadline=(datetime.now(UTC) + timedelta(hours=3)).isoformat(),
            task_id=task_id,
        ),
    )
    rec.scheduled_for = (datetime.now(UTC) - timedelta(seconds=1)).isoformat()
    s._tasks[rec.task_id] = rec  # type: ignore[index]
    if s._store is not None and s._connected:  # type: ignore[attr-defined]
        await s._store.upsert(rec)  # type: ignore[union-attr]
    await s.tick({"anthropic": FakeAdapter()})
    done = s.get_task(task_id)
    assert done is not None and done.receipt is not None
    return done.receipt


# --------------------------------------------------------------------- #
# Per-model energy wiring


@pytest.mark.asyncio
async def test_schedule_records_per_model_estimate() -> None:
    """The schedule-time projection uses the model's coefficients, not the
    flat 0.0015 kWh — a heavy model projects more carbon than a light one
    at the same window, and both differ from the legacy flat estimate.
    """
    feed = _OneEntryFeed(intensity=400.0)
    async with Scheduler(feed=feed, signing=False) as s:
        opus = await s.enqueue_provider_call(
            ProviderCallSpec(provider="anthropic", model="claude-opus-4", prompt="hi"),
            DeferOptions(
                deadline=(datetime.now(UTC) + timedelta(hours=3)).isoformat(),
                task_id="m:opus",
            ),
        )
        haiku = await s.enqueue_provider_call(
            ProviderCallSpec(provider="anthropic", model="claude-haiku-4-5", prompt="hi"),
            DeferOptions(
                deadline=(datetime.now(UTC) + timedelta(hours=3)).isoformat(),
                task_id="m:haiku",
            ),
        )
        # 500+500 typical tokens * per-model Wh * PUE 1.15 * 400 gCO2/kWh.
        assert opus.estimated_carbon_g_co2 == pytest.approx(4.1, abs=0.05)
        assert haiku.estimated_carbon_g_co2 == pytest.approx(0.4, abs=0.05)
        assert opus.estimated_carbon_g_co2 > haiku.estimated_carbon_g_co2
        # Legacy flat would be 0.0015 * 400 = 0.6 for both — confirm we left it.
        assert opus.estimated_carbon_g_co2 != pytest.approx(0.6, abs=0.05)


# --------------------------------------------------------------------- #
# Enriched receipt: actual vs estimated, tokens, redaction


@pytest.mark.asyncio
async def test_provider_call_receipt_is_enriched() -> None:
    feed = _OneEntryFeed(intensity=400.0)
    async with Scheduler(feed=feed, signing=False) as s:
        spec = ProviderCallSpec(
            provider="anthropic",
            model="claude-sonnet-4-5",
            prompt="summarize using key sk-ant-abcdefghijklmnopqrstuvwxyz0123",
        )
        receipt = await _tick_one(s, spec, "enr:1")
        # actual carbon comes from the real 10+5 token usage (very small),
        # estimated from the schedule-time 500+500 typical projection.
        assert receipt.actual_carbon_g_co2 is not None
        assert receipt.estimated_carbon_g_co2 > 0
        assert receipt.delta_pct is not None
        assert receipt.total_tokens == 15
        assert receipt.model == "claude-sonnet-4-5"
        assert receipt.provider == "anthropic"
        # The API key in the prompt is redacted on the receipt copy.
        assert receipt.prompt is not None
        assert "sk-ant-abcdefghijklmnopqrstuvwxyz0123" not in receipt.prompt
        assert "[REDACTED]" in receipt.prompt


@pytest.mark.asyncio
async def test_redaction_disabled_with_empty_list() -> None:
    feed = _OneEntryFeed()
    async with Scheduler(feed=feed, signing=False) as s:
        spec = ProviderCallSpec(
            provider="anthropic",
            model="m",
            prompt="token sk-ant-abcdefghijklmnopqrstuvwxyz0123",
            redact_in_receipt=[],
        )
        receipt = await _tick_one(s, spec, "enr:noredact")
        assert receipt.prompt is not None
        assert "sk-ant-abcdefghijklmnopqrstuvwxyz0123" in receipt.prompt


# --------------------------------------------------------------------- #
# Ed25519 signing wired into the scheduler


@pytest.mark.asyncio
async def test_signing_disabled_leaves_receipt_unsigned() -> None:
    async with Scheduler(feed=mock_grid_feed(), signing=False) as s:
        await s.defer(
            lambda: "ok",
            DeferOptions(
                deadline=(datetime.now(UTC) + timedelta(milliseconds=200)).isoformat()
            ),
        )
        rec = s.list_tasks()[0]
        assert rec.receipt is not None
        assert rec.receipt.signature is None
        assert rec.receipt.signer_public_key is None


@pytest.mark.skipif(not is_signing_available(), reason="signing extra not installed")
@pytest.mark.asyncio
async def test_closure_receipt_signed_by_default_and_verifies() -> None:
    async with Scheduler(feed=mock_grid_feed()) as s:
        await s.defer(
            lambda: "ok",
            DeferOptions(
                deadline=(datetime.now(UTC) + timedelta(milliseconds=200)).isoformat()
            ),
        )
        rec = s.list_tasks()[0]
        assert rec.receipt is not None
        assert rec.receipt.signature is not None
        assert rec.receipt.signer_public_key is not None
        assert rec.receipt.signed_at is not None
        result = verify_receipt(rec.receipt.to_dict())
        assert result.outcome == "valid"


@pytest.mark.skipif(not is_signing_available(), reason="signing extra not installed")
@pytest.mark.asyncio
async def test_provider_call_receipt_signed_and_survives_round_trip(
    tmp_path: Path,
) -> None:
    db = tmp_path / "queue.sqlite"
    async with Scheduler(feed=_OneEntryFeed(), db_path=str(db)) as s:
        spec = ProviderCallSpec(provider="anthropic", model="claude-sonnet-4-5", prompt="hi")
        receipt = await _tick_one(s, spec, "sign:rt")
        assert receipt.signature is not None
        assert verify_receipt(receipt.to_dict()).outcome == "valid"

        # Reload from SQLite: the enriched + signed receipt round-trips and
        # still verifies (the signature covers the persisted fields).
        loaded = await s.load_persisted_task("sign:rt")
        assert loaded is not None and loaded.receipt is not None
        assert loaded.receipt.signature == receipt.signature
        assert loaded.receipt.actual_carbon_g_co2 == receipt.actual_carbon_g_co2
        assert loaded.receipt.total_tokens == receipt.total_tokens
        assert verify_receipt(loaded.receipt.to_dict()).outcome == "valid"


@pytest.mark.skipif(not is_signing_available(), reason="signing extra not installed")
@pytest.mark.asyncio
async def test_tampering_with_persisted_receipt_is_detected() -> None:
    async with Scheduler(feed=mock_grid_feed()) as s:
        await s.defer(
            lambda: "ok",
            DeferOptions(
                deadline=(datetime.now(UTC) + timedelta(milliseconds=200)).isoformat()
            ),
        )
        receipt = s.list_tasks()[0].receipt
        assert receipt is not None
        tampered = {**receipt.to_dict(), "estimated_carbon_g_co2": 999.9}
        assert verify_receipt(tampered).outcome == "tampered"


# --------------------------------------------------------------------- #
# Rounding parity with the TS core (JS Math.round, not Python banker's)


def test_round_half_up_matches_js_math_round() -> None:
    """Receipt/plan figures must round identically to the TS core's
    ``Math.round`` (half away toward +inf), NOT Python's half-to-even
    builtin — otherwise the two ports disagree by 0.1 at exact .5
    boundaries (e.g. the reviewer's estimated=1.6/actual=0.1 case).
    """
    from ebb_ai.recommend import _round_half_up as rec_round
    from ebb_ai.scheduler import _round_half_up as sched_round

    cases = [
        (0.5, 1),
        (1.5, 2),
        (2.5, 3),
        (-0.5, 0),
        (-1.5, -1),
        (-2.5, -2),
        (-937.5, -937),  # provider path: large estimate vs tiny actual delta
        (2.4, 2),
        (2.6, 3),
    ]
    for fn in (sched_round, rec_round):
        for x, expected in cases:
            assert fn(x) == expected, f"{fn.__module__}._round_half_up({x})"
    # Guard against a silent regression back to the builtin, which differs.
    assert round(2.5) == 2 and sched_round(2.5) == 3
