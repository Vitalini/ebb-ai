"""Per-model inference energy estimation (Python mirror of ``energy.ts``).

Replaces the v0.1-v0.5 flat ``ENERGY_KWH_PER_TASK = 0.0015`` placeholder
with cited per-model Wh/token coefficients drawn from public research.

The flat constant is preserved as the backwards-compatible fallback for
callers that have no model information (closure-based ``defer``, pre-v0.6
telemetry replays, etc.). Callers that pass a model name plus optional
input/output token counts get calibrated math.

Sources
-------
* **Patterson et al. 2021.** "Carbon Emissions and Large Neural Network
  Training." arXiv:2104.10350.
* **Luccioni, Jernite, Strubell 2024.** "Power Hungry Processing: Watts
  Driving the Cost of AI Deployment." FAccT 2024. arXiv:2311.16863.
* **Hugging Face AI Energy Score** (2024-).
  https://huggingface.co/AIEnergyScore

See ``packages/core-ts/src/energy.ts`` for the full design rationale and
closed-model caveat.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Literal

from . import _data

EnergySourceTier = Literal["measured", "estimated", "fallback"]

#: How a coefficient was resolved for a given model id (v0.13+). Orthogonal
#: to :data:`EnergySourceTier` (the number's confidence). ``exact`` — the id
#: matched a table key verbatim; ``normalized`` — matched after stripping
#: dated / provider / word-order variance; ``family-fallback`` — unknown id,
#: known family, representative coefficients used; ``default`` — fully
#: unrecognized, flat legacy constant.
EnergyResolutionTier = Literal["exact", "normalized", "family-fallback", "default"]


@dataclass(frozen=True, slots=True)
class ModelEnergyCoefficients:
    """Per-model inference energy coefficients (chip-level Wh, no PUE)."""

    wh_per_input_token: float
    wh_per_output_token: float
    source: EnergySourceTier
    params_b: float | None = None


@dataclass(frozen=True, slots=True)
class ResolvedModelEnergy:
    """Coefficients plus the provenance tier describing how they matched."""

    coeffs: ModelEnergyCoefficients
    tier: EnergyResolutionTier


#: Industry-average Power Usage Effectiveness for hyperscaler data centres.
DEFAULT_PUE: float = _data.DEFAULT_PUE

#: Backwards-compatible flat estimate. Used when no model is provided.
LEGACY_KWH_PER_TASK: float = _data.LEGACY_KWH_PER_TASK

_TYPICAL_INPUT_TOKENS: int = _data.TYPICAL_INPUT_TOKENS
_TYPICAL_OUTPUT_TOKENS: int = _data.TYPICAL_OUTPUT_TOKENS

_FALLBACK = ModelEnergyCoefficients(
    wh_per_input_token=LEGACY_KWH_PER_TASK
    * 1000
    / (_TYPICAL_INPUT_TOKENS + _TYPICAL_OUTPUT_TOKENS),
    wh_per_output_token=LEGACY_KWH_PER_TASK
    * 1000
    / (_TYPICAL_INPUT_TOKENS + _TYPICAL_OUTPUT_TOKENS),
    source="fallback",
)


#: Per-model coefficient table. Keys are canonical lowercase names (no
#: dated suffixes; see ``normalize_model_name``). Built from the JSON SSOT
#: via the generated ``_data`` module.
MODEL_ENERGY_COEFFICIENTS: dict[str, ModelEnergyCoefficients] = {
    name: ModelEnergyCoefficients(
        wh_per_input_token=c["wh_per_input_token"],
        wh_per_output_token=c["wh_per_output_token"],
        source=c["source"],
        params_b=c["params_b"],
    )
    for name, c in _data.COEFFICIENTS.items()
}

#: Ordered family-fallback rules (from the JSON SSOT).
MODEL_FAMILIES: list[dict[str, object]] = _data.FAMILIES

#: Citation metadata for the coefficient table.
ENERGY_SOURCES: dict[str, dict[str, str]] = _data.ENERGY_SOURCES


_DATED_SUFFIX = re.compile(r"-\d{4}-?\d{2}-?\d{2}$")
_LATEST_PREVIEW = re.compile(r"-(latest|preview)$")
_VERSION_SUFFIX = re.compile(r"-v\d+$")
_NUMERIC_SUFFIX = re.compile(r"-\d{3,4}$")
_PROVIDER_DOTTED = re.compile(
    r"^(?:us|eu|apac)\.(?:anthropic|meta|amazon|cohere|mistral|ai21|stability)\."
)
_BEDROCK_TAG = re.compile(r":\d+$")
_CLAUDE_REORDER = re.compile(r"^claude-(\d+(?:-\d+)*)-(opus|sonnet|haiku)(-.*)?$")


def normalize_model_name(model: str) -> str:
    """Strip provider prefixes, version-date suffixes and normalise
    punctuation and word order.

    Callers can pass ``"claude-sonnet-4-5-20251022"``,
    ``"anthropic/claude-3.5-sonnet"``, ``"gpt-4o-2024-11-20"`` or
    ``"us.anthropic.claude-opus-4-7-v1:0"`` and still hit the canonical entry.
    """
    name = model.strip().lower()
    if "/" in name:
        name = name.rsplit("/", 1)[1]
    name = _PROVIDER_DOTTED.sub("", name)
    name = _BEDROCK_TAG.sub("", name)
    name = name.replace(".", "-")
    name = _DATED_SUFFIX.sub("", name)
    name = _LATEST_PREVIEW.sub("", name)
    name = _VERSION_SUFFIX.sub("", name)
    name = _NUMERIC_SUFFIX.sub("", name)
    m = _CLAUDE_REORDER.match(name)
    if m:
        name = f"claude-{m.group(2)}-{m.group(1)}{m.group(3) or ''}"
    return name


def _family_representative(normalized: str) -> ModelEnergyCoefficients | None:
    """Coefficients of the first family rule that matches, else ``None``."""
    for fam in MODEL_FAMILIES:
        prefix = fam.get("prefix")
        if prefix is not None and not normalized.startswith(prefix):
            continue
        contains = fam.get("contains")
        if contains is not None and not all(t in normalized for t in contains):
            continue
        regex = fam.get("regex")
        if regex is not None and re.search(regex, normalized) is None:
            continue
        return MODEL_ENERGY_COEFFICIENTS[fam["representative"]]
    return None


def resolve_model_energy(model: str | None = None) -> ResolvedModelEnergy:
    """Resolve a (possibly messy) model id to coefficients + provenance tier.

    See :data:`EnergyResolutionTier`.
    """
    if not model:
        return ResolvedModelEnergy(_FALLBACK, "default")
    exact = MODEL_ENERGY_COEFFICIENTS.get(model.strip().lower())
    if exact is not None:
        return ResolvedModelEnergy(exact, "exact")
    normalized = normalize_model_name(model)
    norm = MODEL_ENERGY_COEFFICIENTS.get(normalized)
    if norm is not None:
        return ResolvedModelEnergy(norm, "normalized")
    family = _family_representative(normalized)
    if family is not None:
        return ResolvedModelEnergy(family, "family-fallback")
    return ResolvedModelEnergy(_FALLBACK, "default")


def lookup_model_energy(model: str | None = None) -> ModelEnergyCoefficients:
    """Look up coefficients for a (possibly suffixed) model name."""
    return resolve_model_energy(model).coeffs


def estimate_energy_kwh(
    *,
    model: str | None = None,
    input_tokens: int | None = None,
    output_tokens: int | None = None,
    pue: float = DEFAULT_PUE,
) -> float:
    """Estimate grid-level energy (kWh) for an inference call.

    Resolution order:
        1. No arguments → :data:`LEGACY_KWH_PER_TASK` (0.0015 kWh).
           Backwards-compatible behaviour for closure-based ``defer``.
        2. Unknown model name (no tokens) → same fallback.
        3. Known model, no token counts → typical-task estimate
           (500 + 500 tokens) times the model's coefficients, times PUE.
        4. Known model + token counts → exact per-token math, times PUE.
    """
    if model is None and input_tokens is None and output_tokens is None:
        return LEGACY_KWH_PER_TASK

    resolved = resolve_model_energy(model)
    coeffs = resolved.coeffs

    # Only fully-unrecognized models with no token counts fall back to the
    # flat legacy constant. A family-recognized unknown (tier
    # ``family-fallback``) instead uses the family representative's
    # coefficients — the §1.8 family fallback.
    if (
        resolved.tier == "default"
        and input_tokens is None
        and output_tokens is None
    ):
        return LEGACY_KWH_PER_TASK

    ins = input_tokens if input_tokens is not None else _TYPICAL_INPUT_TOKENS
    outs = output_tokens if output_tokens is not None else _TYPICAL_OUTPUT_TOKENS

    chip_wh = ins * coeffs.wh_per_input_token + outs * coeffs.wh_per_output_token
    grid_wh = chip_wh * pue
    return grid_wh / 1000.0


def grams_for_intensity(
    g_co2_per_kwh: float,
    *,
    model: str | None = None,
    input_tokens: int | None = None,
    output_tokens: int | None = None,
    pue: float = DEFAULT_PUE,
) -> float:
    """Grams CO2-equivalent for one inference call at a given grid intensity."""
    kwh = estimate_energy_kwh(
        model=model,
        input_tokens=input_tokens,
        output_tokens=output_tokens,
        pue=pue,
    )
    return kwh * g_co2_per_kwh


__all__ = [
    "DEFAULT_PUE",
    "ENERGY_SOURCES",
    "LEGACY_KWH_PER_TASK",
    "MODEL_ENERGY_COEFFICIENTS",
    "MODEL_FAMILIES",
    "EnergyResolutionTier",
    "EnergySourceTier",
    "ModelEnergyCoefficients",
    "ResolvedModelEnergy",
    "estimate_energy_kwh",
    "grams_for_intensity",
    "lookup_model_energy",
    "normalize_model_name",
    "resolve_model_energy",
]
