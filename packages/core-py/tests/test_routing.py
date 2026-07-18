"""Cross-provider routing (ROADMAP item 1) — Python mirror of the TS suite.

The scoring-vector cases come from the SHARED fixture
``packages/core-ts/test/fixtures/routing-scoring-vectors.json`` — the TS
suite (``test/routing.test.ts``) reads the same file, so a drift in either
port's scoring math / price table / energy coefficients reddens both.
"""

from __future__ import annotations

import json
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

import pytest

from ebb_ai import Scheduler, mock_grid_feed
from ebb_ai.providers.base import (
    BatchHandle,
    BatchRetrieveResult,
    DispatchOptions,
    DispatchResult,
    ProviderAdapter,
)
from ebb_ai.recommend import recommend_window
from ebb_ai.routing import (
    DEFAULT_ROUTE_WEIGHTS,
    ROUTING_PREVIEW_DISCLOSURE,
    InvalidCandidateError,
    InvalidRouteWeightsError,
    MissingPriceError,
    normalize_route_weights,
    parse_candidate,
    parse_candidates,
    preview_routing,
    score_candidates,
)
from ebb_ai.sign import verify_receipt
from ebb_ai.types import DeferOptions, ProviderCallSpec

# Shared fixture, same file the TS suite reads (parents[2] == <repo>/packages).
FIXTURE_PATH = (
    Path(__file__).resolve().parents[2]
    / "core-ts"
    / "test"
    / "fixtures"
    / "routing-scoring-vectors.json"
)
CASES: list[dict[str, Any]] = json.loads(FIXTURE_PATH.read_text(encoding="utf-8"))["cases"]


@pytest.mark.parametrize("case", CASES, ids=[c["name"] for c in CASES])
def test_shared_scoring_vectors(case: dict[str, Any]) -> None:
    decision = score_candidates(
        parse_candidates(case["candidates"]),
        case["intensityGCo2PerKwh"],
        weights=case.get("routeWeights"),
        batch_eligible=case["batchEligible"],
        rng=lambda: 0.0,
    )
    assert decision.chosen == case["expectedChosen"]
    assert decision.reasoning == case["expectedReasoning"]
    for key, val in case["expectedWeights"].items():
        assert decision.weights[key] == pytest.approx(val)
    got = [c.to_camel_dict() for c in decision.considered]
    assert len(got) == len(case["expectedConsidered"])
    for g, exp in zip(got, case["expectedConsidered"], strict=True):
        assert g["provider"] == exp["provider"]
        assert g["model"] == exp["model"]
        assert g["latencyClass"] == pytest.approx(exp["latencyClass"])
        assert g["estCarbonG"] == pytest.approx(exp["estCarbonG"])
        assert g["estCostUsd"] == pytest.approx(exp["estCostUsd"])
        assert g["score"] == pytest.approx(exp["score"])


def test_parse_candidate() -> None:
    c = parse_candidate("anthropic:claude-opus-4")
    assert c.provider == "anthropic" and c.model == "claude-opus-4"
    for bad in ("acme:foo", "no-colon", ":model", "anthropic:"):
        with pytest.raises(InvalidCandidateError):
            parse_candidate(bad)


def test_weight_normalization() -> None:
    assert normalize_route_weights() == DEFAULT_ROUTE_WEIGHTS
    assert normalize_route_weights({"carbon": 2, "cost": 1, "latency": 1}) == {
        "carbon": 0.5,
        "cost": 0.25,
        "latency": 0.25,
    }
    assert normalize_route_weights({"carbon": 1}) == {"carbon": 1, "cost": 0, "latency": 0}
    with pytest.raises(InvalidRouteWeightsError):
        normalize_route_weights({"carbon": -1, "cost": 1, "latency": 0})
    with pytest.raises(InvalidRouteWeightsError):
        normalize_route_weights({"carbon": 0, "cost": 0, "latency": 0})


def test_loud_reject_on_missing_price() -> None:
    with pytest.raises(MissingPriceError) as ei:
        score_candidates(
            parse_candidates(
                [
                    "anthropic:claude-opus-4",
                    "openai:not-a-real-model",
                    "gemini:also-not-real",
                ]
            ),
            400,
        )
    missing = ei.value.missing
    assert "openai:not-a-real-model" in missing
    assert "gemini:also-not-real" in missing
    assert "anthropic:claude-opus-4" not in missing


def test_deterministic_seeded_tie_break() -> None:
    tied = parse_candidates(["gemini:gemini-1-5-pro", "gemini:gemini-2-0-pro"])
    weights = {"carbon": 0, "cost": 1, "latency": 0}
    a = score_candidates(tied, 400, weights=weights, rng=lambda: 0.0)
    b = score_candidates(tied, 400, weights=weights, rng=lambda: 0.999)
    assert all(c.score == a.considered[0].score for c in a.considered)
    assert a.chosen == "gemini:gemini-1-5-pro"
    assert b.chosen == "gemini:gemini-2-0-pro"


def test_batch_discount_lowers_cost() -> None:
    specs = parse_candidates(["anthropic:claude-sonnet-4"])
    sync = score_candidates(specs, 300, batch_eligible=False)
    batch = score_candidates(specs, 300, batch_eligible=True)
    assert batch.considered[0].est_cost_usd == pytest.approx(
        sync.considered[0].est_cost_usd / 2
    )
    assert sync.considered[0].latency_class == 0.5
    assert batch.considered[0].latency_class == 1


@pytest.mark.parametrize("case", CASES, ids=[c["name"] for c in CASES])
def test_preview_routing_wraps_score(case: dict[str, Any]) -> None:
    preview = preview_routing(
        case["candidates"],
        case["intensityGCo2PerKwh"],
        weights=case.get("routeWeights"),
        batch_eligible=case["batchEligible"],
        rng=lambda: 0.0,
    )
    assert preview is not None
    assert preview.preview is True
    assert preview.chosen == case["expectedChosen"]
    assert preview.reasoning == f"{ROUTING_PREVIEW_DISCLOSURE}: {case['expectedReasoning']}"
    assert preview.reasoning.startswith("PREVIEW —")


def test_preview_routing_none_for_single_or_absent() -> None:
    assert preview_routing(None, 400) is None
    assert preview_routing(["anthropic:claude-opus-4"], 400) is None


# ── Integration through the real Scheduler ──────────────────────────────────


class SyncAdapter(ProviderAdapter):
    """Minimal sync adapter, records its dispatch calls."""

    def __init__(self, name: str) -> None:
        self.name = name
        self.dispatch_calls: list[tuple[str, str]] = []

    async def dispatch(
        self, model: str, prompt: str, options: DispatchOptions | None = None
    ) -> DispatchResult:
        self.dispatch_calls.append((model, prompt))
        return DispatchResult(
            text=f"sync:{prompt}",
            model=model,
            provider=self.name,
            input_tokens=4,
            output_tokens=2,
        )


class FailingBatchAdapter(SyncAdapter):
    """Batch-capable adapter whose batch submit always fails; sync works."""

    def __init__(self, name: str) -> None:
        super().__init__(name)
        self.dispatch_batch_calls = 0

    async def dispatch_batch(
        self, model: str, prompts: list[str], options: DispatchOptions | None = None
    ) -> BatchHandle:
        self.dispatch_batch_calls += 1
        raise RuntimeError("simulated batch submit failure")

    async def retrieve_batch(self, batch_id: str) -> BatchRetrieveResult:
        return BatchRetrieveResult(status="completed", results=[])


def _deadline(hours: float) -> datetime:
    return datetime.now(UTC) + timedelta(hours=hours)


@pytest.mark.asyncio
async def test_signed_routing_block_on_receipt_verifies() -> None:
    s = Scheduler(feed=mock_grid_feed())
    rec = await s.enqueue_provider_call(
        ProviderCallSpec(
            provider="anthropic",
            model="claude-opus-4",
            prompt="hello",
            candidates=["anthropic:claude-opus-4", "ollama:llama-3-1-8b"],
            route_weights={"carbon": 1, "cost": 0, "latency": 0},
        ),
        DeferOptions(deadline=_deadline(3), region="US-CAL-CISO", task_id="rt-1"),
    )
    assert rec.routing_decision is not None
    assert len(rec.routing_decision["considered"]) == 2
    rec.scheduled_for = (datetime.now(UTC) - timedelta(seconds=1)).isoformat()
    await s.tick({"anthropic": SyncAdapter("anthropic"), "ollama": SyncAdapter("ollama")})
    done = s.get_task(rec.task_id)
    assert done is not None and done.status == "completed"
    routing = done.receipt.routing
    assert routing is not None
    assert len(routing["considered"]) == 2
    assert routing["chosen"] in ("anthropic:claude-opus-4", "ollama:llama-3-1-8b")
    outcome = verify_receipt(done.receipt.to_camel_dict())
    assert outcome.outcome == "valid"


@pytest.mark.asyncio
async def test_dispatch_fallback_when_chosen_adapter_unavailable() -> None:
    s = Scheduler(feed=mock_grid_feed())
    rec = await s.enqueue_provider_call(
        ProviderCallSpec(
            provider="gemini",
            model="gemini-2-0-flash",
            prompt="hi",
            candidates=["anthropic:claude-opus-4", "gemini:gemini-2-0-flash"],
            route_weights={"carbon": 1, "cost": 0, "latency": 0},
        ),
        DeferOptions(deadline=_deadline(3), region="US-CAL-CISO", task_id="rt-fallback"),
    )
    assert rec.routing_decision["chosen"] == "gemini:gemini-2-0-flash"
    rec.scheduled_for = (datetime.now(UTC) - timedelta(seconds=1)).isoformat()
    anthropic = SyncAdapter("anthropic")
    await s.tick({"anthropic": anthropic})  # gemini adapter absent
    done = s.get_task(rec.task_id)
    assert done is not None and done.status == "completed"
    assert len(anthropic.dispatch_calls) == 1
    assert done.receipt.routing["fallbackFrom"] == "gemini:gemini-2-0-flash"
    assert done.receipt.routing["chosen"] == "anthropic:claude-opus-4"
    assert done.receipt.provider == "anthropic"


@pytest.mark.asyncio
async def test_fails_when_no_candidate_adapter_ready() -> None:
    s = Scheduler(feed=mock_grid_feed())
    rec = await s.enqueue_provider_call(
        ProviderCallSpec(
            provider="anthropic",
            model="claude-opus-4",
            prompt="hi",
            candidates=["anthropic:claude-opus-4", "gemini:gemini-2-0-flash"],
        ),
        DeferOptions(deadline=_deadline(3), region="US-CAL-CISO", task_id="rt-none"),
    )
    rec.scheduled_for = (datetime.now(UTC) - timedelta(seconds=1)).isoformat()
    await s.tick({"ollama": SyncAdapter("ollama")})  # not among the candidates
    done = s.get_task(rec.task_id)
    assert done is not None and done.status == "failed"
    assert "no configured/ready adapter for any routing candidate" in (done.error or "")


@pytest.mark.asyncio
async def test_batch_failure_falls_back_to_routed_candidate_sync_path() -> None:
    s = Scheduler(feed=mock_grid_feed())
    rec = await s.enqueue_provider_call(
        ProviderCallSpec(
            provider="openai",
            model="gpt-4o",
            prompt="batch-me",
            candidates=["anthropic:claude-sonnet-4", "openai:gpt-4o"],
            route_weights={"carbon": 0, "cost": 1, "latency": 0},
        ),
        DeferOptions(deadline=_deadline(60), region="US-CAL-CISO", task_id="rt-batchfail"),
    )
    assert rec.routing_decision["chosen"] == "openai:gpt-4o"
    openai = FailingBatchAdapter("openai")
    anthropic = FailingBatchAdapter("anthropic")
    await s.tick({"openai": openai, "anthropic": anthropic})
    assert openai.dispatch_batch_calls == 1  # batch attempted
    assert len(openai.dispatch_calls) == 1  # then sync fell back
    done = s.get_task(rec.task_id)
    assert done is not None and done.status == "completed"
    assert done.batch_id is None  # receipt records the actual (sync) path
    assert done.receipt.routing["chosen"] == "openai:gpt-4o"


@pytest.mark.asyncio
async def test_recommend_window_emits_preview_only_when_two_candidates() -> None:
    dl = _deadline(6)
    none = await recommend_window(
        deadline=dl, region="US-CAL-CISO", feed=mock_grid_feed(), rng=lambda: 0.0
    )
    assert none.routing_preview is None
    one = await recommend_window(
        deadline=dl,
        region="US-CAL-CISO",
        candidates=["anthropic:claude-opus-4"],
        feed=mock_grid_feed(),
        rng=lambda: 0.0,
    )
    assert one.routing_preview is None
    many = await recommend_window(
        deadline=dl,
        region="US-CAL-CISO",
        candidates=["anthropic:claude-opus-4", "ollama:llama-3-1-8b"],
        route_weights={"carbon": 1, "cost": 0, "latency": 0},
        feed=mock_grid_feed(),
        rng=lambda: 0.0,
    )
    assert many.routing_preview is not None
    assert many.routing_preview.preview is True
    assert many.routing_preview.reasoning.startswith("PREVIEW —")
    assert len(many.routing_preview.considered) == 2
    # to_dict surfaces the snake_case preview block for the MCP JSON payload.
    assert many.to_dict()["routing_preview"]["preview"] is True


@pytest.mark.asyncio
async def test_recommend_preview_pick_matches_committed_pick() -> None:
    candidates = [
        "anthropic:claude-opus-4",
        "gemini:gemini-2-0-flash",
        "ollama:llama-3-1-8b",
    ]
    weights = {"carbon": 1, "cost": 0, "latency": 0}
    dl = _deadline(6)
    # Commit path.
    s = Scheduler(feed=mock_grid_feed(), rng=lambda: 0.0)
    rec = await s.enqueue_provider_call(
        ProviderCallSpec(
            provider="anthropic",
            model="claude-opus-4",
            prompt="x",
            candidates=candidates,
            route_weights=weights,
        ),
        DeferOptions(deadline=dl, region="US-CAL-CISO", task_id="cmp-preview"),
    )
    committed = rec.routing_decision
    # Preview path — same feed kind, same seed.
    r = await recommend_window(
        deadline=dl,
        region="US-CAL-CISO",
        candidates=candidates,
        route_weights=weights,
        feed=mock_grid_feed(),
        rng=lambda: 0.0,
    )
    assert r.routing_preview is not None
    assert r.routing_preview.chosen == committed["chosen"]
    assert [c.score for c in r.routing_preview.considered] == [
        c["score"] for c in committed["considered"]
    ]
