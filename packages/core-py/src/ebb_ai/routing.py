"""Cross-provider LLM routing — scored-candidate selection (Python mirror of
``routing.ts``, ROADMAP item 1).

Given a caller-allowed set of ``provider:model`` candidates and the grid
intensity at the already-chosen dispatch window, pick the best candidate on a
weighted blend of carbon, cost and latency. The window is chosen once by
``select_window`` BEFORE this runs — routing never shops for a per-candidate
window.

Honesty constraints (mirrored in the reasoning string):

1. No silent model swaps — routing only picks among the caller's candidates;
   there are no built-in equivalence tiers.
2. Grid honesty — hosted candidates are all scored against the SAME
   caller's-grid intensity (the receipt's documented assumption); carbon is
   differentiated via per-model energy coefficients, not pretend per-provider
   grids. Ollama is genuinely local.
3. Explainable pick — the full scored list + normalized weights are returned
   (and recorded on the receipt); the pick is reproducible given the rng seed.

See ``packages/core-ts/src/routing.ts`` for the full rationale.
"""

from __future__ import annotations

import math
import random
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any

from . import _data
from .energy import estimate_energy_kwh, normalize_model_name
from .types import Provider

#: Default weights when the caller does not supply ``route_weights``.
DEFAULT_ROUTE_WEIGHTS: dict[str, float] = {"carbon": 0.6, "cost": 0.3, "latency": 0.1}

#: Ties within this score epsilon are broken with the rng (reproducible given a seed).
SCORE_TIE_EPSILON = 1e-9

#: Disclosure prefix on a preview's reasoning line.
ROUTING_PREVIEW_DISCLOSURE = (
    "PREVIEW — the binding pick is decided at schedule time and may differ "
    "if the forecast shifts before commit"
)

_KNOWN_PROVIDERS = frozenset({"anthropic", "openai", "gemini", "ollama"})
_BATCH_CAPABLE_PROVIDERS = frozenset({"anthropic", "openai"})

_TYPICAL_INPUT_TOKENS: int = _data.TYPICAL_INPUT_TOKENS
_TYPICAL_OUTPUT_TOKENS: int = _data.TYPICAL_OUTPUT_TOKENS
#: Per-model public list prices (USD per Mtok), keyed by canonical model id.
MODEL_PRICES: dict[str, dict[str, Any]] = _data.MODEL_PRICES


class InvalidCandidateError(ValueError):
    """A ``provider:model`` candidate string is malformed."""


class MissingPriceError(ValueError):
    """One or more candidate models are absent from the SSOT price table.

    Loud by design — routing never guesses a price.
    """

    def __init__(self, missing: list[str]) -> None:
        self.missing = missing
        super().__init__(
            "No price in data/prices.json for routing candidate model(s): "
            + ", ".join(missing)
            + ". Add each to prices.json (with asOf + source) or drop it from the "
            "candidate list — routing never guesses a price."
        )


class InvalidRouteWeightsError(ValueError):
    """The caller-supplied weights cannot be normalized."""


@dataclass(frozen=True, slots=True)
class RoutingCandidate:
    """A parsed ``provider:model`` candidate."""

    provider: Provider
    model: str


@dataclass(slots=True)
class ScoredCandidate:
    """One fully-scored candidate, as recorded on the receipt's routing block."""

    provider: Provider
    model: str
    est_carbon_g: float
    est_cost_usd: float
    latency_class: float
    score: float

    def to_camel_dict(self) -> dict[str, Any]:
        return {
            "provider": self.provider,
            "model": self.model,
            "estCarbonG": self.est_carbon_g,
            "estCostUsd": self.est_cost_usd,
            "latencyClass": self.latency_class,
            "score": self.score,
        }

    def to_snake_dict(self) -> dict[str, Any]:
        return {
            "provider": self.provider,
            "model": self.model,
            "est_carbon_g": self.est_carbon_g,
            "est_cost_usd": self.est_cost_usd,
            "latency_class": self.latency_class,
            "score": self.score,
        }


@dataclass(slots=True)
class RoutingDecision:
    """The routing decision — persisted at schedule time, embedded in the
    signed receipt at completion. ``chosen`` / ``fallback_from`` are compact
    ``provider:model`` ids."""

    weights: dict[str, float]
    considered: list[ScoredCandidate]
    chosen: str
    reasoning: str
    fallback_from: str | None = None
    #: True for a NON-BINDING preview (recommend_window / dry_run). Never set
    #: on a committed / receipt-embedded decision.
    preview: bool = False

    def to_camel_dict(self) -> dict[str, Any]:
        d: dict[str, Any] = {
            "weights": {
                "carbon": self.weights["carbon"],
                "cost": self.weights["cost"],
                "latency": self.weights["latency"],
            },
            "considered": [c.to_camel_dict() for c in self.considered],
            "chosen": self.chosen,
            "reasoning": self.reasoning,
        }
        if self.fallback_from is not None:
            d["fallbackFrom"] = self.fallback_from
        if self.preview:
            d["preview"] = True
        return d

    def to_snake_dict(self) -> dict[str, Any]:
        """snake_case rendering for the planning-surface JSON payloads
        (recommend_window / dry_run), matching the TS ``routingBlockPayload``."""
        d: dict[str, Any] = {}
        if self.preview:
            d["preview"] = True
        d["chosen"] = self.chosen
        if self.fallback_from is not None:
            d["fallback_from"] = self.fallback_from
        d["weights"] = {
            "carbon": self.weights["carbon"],
            "cost": self.weights["cost"],
            "latency": self.weights["latency"],
        }
        d["considered"] = [c.to_snake_dict() for c in self.considered]
        d["reasoning"] = self.reasoning
        return d


def parse_candidate(spec: str) -> RoutingCandidate:
    """Parse a single ``"provider:model"`` string."""
    if not isinstance(spec, str):
        raise InvalidCandidateError(f"Invalid routing candidate {spec!r}: expected a string")
    trimmed = spec.strip()
    idx = trimmed.find(":")
    if idx <= 0:
        raise InvalidCandidateError(f'Invalid routing candidate {spec!r}: expected "provider:model"')
    provider = trimmed[:idx].strip().lower()
    model = trimmed[idx + 1 :].strip()
    if provider not in _KNOWN_PROVIDERS:
        raise InvalidCandidateError(
            f"Invalid routing candidate {spec!r}: unknown provider {provider!r} "
            "(expected one of anthropic, openai, gemini, ollama)"
        )
    if not model:
        raise InvalidCandidateError(f"Invalid routing candidate {spec!r}: model part is empty")
    return RoutingCandidate(provider=provider, model=model)  # type: ignore[arg-type]


def parse_candidates(specs: list[str]) -> list[RoutingCandidate]:
    return [parse_candidate(s) for s in specs]


def candidate_id(provider: str, model: str) -> str:
    return f"{provider}:{model}"


def normalize_route_weights(w: dict[str, float] | None = None) -> dict[str, float]:
    """Normalize caller weights to a non-negative vector summing to 1. ``None``
    ⇒ :data:`DEFAULT_ROUTE_WEIGHTS`. Missing keys default to 0; any negative
    value or an all-zero vector is rejected."""
    if w is None:
        return dict(DEFAULT_ROUTE_WEIGHTS)
    carbon = w.get("carbon", 0) or 0
    cost = w.get("cost", 0) or 0
    latency = w.get("latency", 0) or 0
    for name, v in (("carbon", carbon), ("cost", cost), ("latency", latency)):
        if not isinstance(v, (int, float)) or isinstance(v, bool) or math.isnan(v):
            raise InvalidRouteWeightsError(f"{name} must be a number, got {v!r}")
        if v < 0:
            raise InvalidRouteWeightsError(f"{name} must be non-negative, got {v}")
    total = carbon + cost + latency
    if total <= 0:
        raise InvalidRouteWeightsError("at least one weight must be positive")
    return {"carbon": carbon / total, "cost": cost / total, "latency": latency / total}


def price_for_model(model: str) -> dict[str, Any] | None:
    """Look up the SSOT price for a model id, trying exact then normalized."""
    exact = MODEL_PRICES.get(model.strip().lower())
    if exact is not None:
        return exact
    return MODEL_PRICES.get(normalize_model_name(model))


def _will_run_batch(
    candidate: RoutingCandidate,
    price: dict[str, Any],
    batch_eligible: bool,
    batch_capable: Callable[[str], bool],
) -> bool:
    return (
        batch_eligible
        and candidate.provider in _BATCH_CAPABLE_PROVIDERS
        and price.get("batch_discount") is not None
        and batch_capable(candidate.provider)
    )


def _latency_class_for(candidate: RoutingCandidate, runs_batch: bool) -> float:
    if candidate.provider == "ollama":
        return 0.0
    return 1.0 if runs_batch else 0.5


def _cost_usd_for(
    price: dict[str, Any], input_tokens: int, output_tokens: int, runs_batch: bool
) -> float:
    base = (input_tokens / 1_000_000) * price["in_usd_per_mtok"] + (
        output_tokens / 1_000_000
    ) * price["out_usd_per_mtok"]
    discount = price.get("batch_discount")
    mult = discount if (runs_batch and discount is not None) else 1
    return base * mult


def _round(v: float, places: int) -> float:
    factor = 10**places
    return math.floor(v * factor + 0.5) / factor


def _fmt_score(x: float) -> str:
    s = f"{x:.2f}"
    return s[1:] if s.startswith("0.") else s


def score_candidates(
    candidates: list[RoutingCandidate],
    intensity_g_co2_per_kwh: float,
    *,
    weights: dict[str, float] | None = None,
    batch_eligible: bool = False,
    batch_capable: Callable[[str], bool] | None = None,
    input_tokens: int | None = None,
    output_tokens: int | None = None,
    rng: Callable[[], float] | None = None,
) -> RoutingDecision:
    """Score a candidate set and pick the lowest-scoring one.

    Raises :class:`MissingPriceError` if any candidate model is absent from the
    price table (loud, never guessed).
    """
    if not candidates:
        raise ValueError("score_candidates: candidates must be non-empty")
    if batch_capable is None:
        batch_capable = lambda p: p in _BATCH_CAPABLE_PROVIDERS  # noqa: E731
    if input_tokens is None:
        input_tokens = _TYPICAL_INPUT_TOKENS
    if output_tokens is None:
        output_tokens = _TYPICAL_OUTPUT_TOKENS
    if rng is None:
        rng = random.random
    norm_weights = normalize_route_weights(weights)

    # Resolve every price FIRST so a missing one rejects the whole set loudly.
    prices: list[dict[str, Any]] = []
    missing: list[str] = []
    for c in candidates:
        p = price_for_model(c.model)
        if p is None:
            missing.append(candidate_id(c.provider, c.model))
        else:
            prices.append(p)
    if missing:
        raise MissingPriceError(missing)

    raw = []
    for c, price in zip(candidates, prices, strict=True):
        runs_batch = _will_run_batch(c, price, batch_eligible, batch_capable)
        carbon_g = (
            estimate_energy_kwh(
                model=c.model, input_tokens=input_tokens, output_tokens=output_tokens
            )
            * intensity_g_co2_per_kwh
        )
        cost_usd = _cost_usd_for(price, input_tokens, output_tokens, runs_batch)
        latency_class = _latency_class_for(c, runs_batch)
        raw.append((c, carbon_g, cost_usd, latency_class))

    def _norm(values: list[float]) -> list[float]:
        lo = min(values)
        hi = max(values)
        if hi - lo <= 0:
            return [0.0 for _ in values]
        return [(v - lo) / (hi - lo) for v in values]

    n_carbon = _norm([r[1] for r in raw])
    n_cost = _norm([r[2] for r in raw])
    n_latency = _norm([r[3] for r in raw])

    considered: list[ScoredCandidate] = []
    for i, (c, carbon_g, cost_usd, latency_class) in enumerate(raw):
        score = (
            norm_weights["carbon"] * n_carbon[i]
            + norm_weights["cost"] * n_cost[i]
            + norm_weights["latency"] * n_latency[i]
        )
        considered.append(
            ScoredCandidate(
                provider=c.provider,
                model=c.model,
                est_carbon_g=_round(carbon_g, 4),
                est_cost_usd=_round(cost_usd, 6),
                latency_class=latency_class,
                score=_round(score, 6),
            )
        )

    min_score = min(c.score for c in considered)
    tied = [c for c in considered if c.score - min_score <= SCORE_TIE_EPSILON]
    chosen = tied[math.floor(rng() * len(tied))] if len(tied) > 1 else tied[0]

    return RoutingDecision(
        weights=norm_weights,
        considered=considered,
        chosen=candidate_id(chosen.provider, chosen.model),
        reasoning=_build_reasoning(considered, chosen, norm_weights),
    )


def preview_routing(
    candidates: list[str] | None,
    intensity_g_co2_per_kwh: float,
    *,
    weights: dict[str, float] | None = None,
    batch_eligible: bool = False,
    rng: Callable[[], float] | None = None,
) -> RoutingDecision | None:
    """Non-binding routing preview for the planning surfaces
    (``recommend_window``, ``schedule_task`` dry_run). Runs the SAME scoring
    as :func:`score_candidates` at the previewed window's intensity, then
    marks the result ``preview=True`` and prefixes the reasoning with
    :data:`ROUTING_PREVIEW_DISCLOSURE`. Returns ``None`` when fewer than two
    candidates were supplied (routing is a no-op — so the params are never
    inert: they take effect exactly when >= 2 candidates are present). Raises
    :class:`MissingPriceError` / :class:`InvalidCandidateError` loudly, same
    as the committing path.
    """
    if not isinstance(candidates, list) or len(candidates) < 2:
        return None
    decision = score_candidates(
        parse_candidates(candidates),
        intensity_g_co2_per_kwh,
        weights=weights,
        batch_eligible=batch_eligible,
        rng=rng,
    )
    decision.preview = True
    decision.reasoning = f"{ROUTING_PREVIEW_DISCLOSURE}: {decision.reasoning}"
    return decision


def _is_min_by(all_c: list[ScoredCandidate], target: ScoredCandidate, key) -> bool:
    lo = min(key(c) for c in all_c)
    return key(target) <= lo + SCORE_TIE_EPSILON


def _build_reasoning(
    considered: list[ScoredCandidate],
    chosen: ScoredCandidate,
    weights: dict[str, float],
) -> str:
    others = [c for c in considered if c is not chosen]
    vs = (
        f" (score {_fmt_score(chosen.score)} vs "
        + "/".join(_fmt_score(o.score) for o in others)
        + ")"
        if others
        else ""
    )
    clauses: list[str] = []
    if weights["carbon"] > 0 and _is_min_by(considered, chosen, lambda c: c.est_carbon_g):
        clauses.append("lowest carbon at window")
    if weights["cost"] > 0 and _is_min_by(considered, chosen, lambda c: c.est_cost_usd):
        clauses.append("no per-token cost (local)" if chosen.est_cost_usd == 0 else "lowest cost")
    if weights["latency"] > 0 and _is_min_by(considered, chosen, lambda c: c.latency_class):
        clauses.append(
            "local (no network latency tier)"
            if chosen.latency_class == 0
            else "fastest latency tier"
        )
    if not clauses:
        clauses.append("best weighted blend of carbon/cost/latency")
    grid_honesty = (
        "runs locally on your own grid"
        if chosen.provider == "ollama"
        else "hosted-grid assumption applies (all hosted candidates scored at the same caller's-grid intensity)"
    )
    return (
        f"routed to {candidate_id(chosen.provider, chosen.model)}{vs}: "
        + "; ".join(clauses)
        + f"; {grid_honesty}"
    )


__all__ = [
    "DEFAULT_ROUTE_WEIGHTS",
    "MODEL_PRICES",
    "ROUTING_PREVIEW_DISCLOSURE",
    "SCORE_TIE_EPSILON",
    "InvalidCandidateError",
    "InvalidRouteWeightsError",
    "MissingPriceError",
    "RoutingCandidate",
    "RoutingDecision",
    "ScoredCandidate",
    "candidate_id",
    "normalize_route_weights",
    "parse_candidate",
    "parse_candidates",
    "preview_routing",
    "price_for_model",
    "score_candidates",
]
