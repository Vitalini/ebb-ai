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

EnergySourceTier = Literal["measured", "estimated", "fallback"]


@dataclass(frozen=True, slots=True)
class ModelEnergyCoefficients:
    """Per-model inference energy coefficients (chip-level Wh, no PUE)."""

    wh_per_input_token: float
    wh_per_output_token: float
    source: EnergySourceTier
    params_b: float | None = None


#: Industry-average Power Usage Effectiveness for hyperscaler data centres.
DEFAULT_PUE: float = 1.15

#: Backwards-compatible flat estimate. Used when no model is provided.
LEGACY_KWH_PER_TASK: float = 0.0015

_TYPICAL_INPUT_TOKENS: int = 500
_TYPICAL_OUTPUT_TOKENS: int = 500

_FALLBACK = ModelEnergyCoefficients(
    wh_per_input_token=LEGACY_KWH_PER_TASK
    * 1000
    / (_TYPICAL_INPUT_TOKENS + _TYPICAL_OUTPUT_TOKENS),
    wh_per_output_token=LEGACY_KWH_PER_TASK
    * 1000
    / (_TYPICAL_INPUT_TOKENS + _TYPICAL_OUTPUT_TOKENS),
    source="fallback",
)


def _coef(
    wi: float,
    wo: float,
    *,
    params_b: float,
    source: EnergySourceTier,
) -> ModelEnergyCoefficients:
    return ModelEnergyCoefficients(
        wh_per_input_token=wi,
        wh_per_output_token=wo,
        source=source,
        params_b=params_b,
    )


#: Per-model coefficient table. Keys are canonical lowercase names (no
#: dated suffixes; see ``normalize_model_name``).
MODEL_ENERGY_COEFFICIENTS: dict[str, ModelEnergyCoefficients] = {
    # ---------- Anthropic (closed, estimated) ----------
    "claude-opus-4": _coef(0.0030, 0.0150, params_b=400, source="estimated"),
    "claude-opus-4-7": _coef(0.0030, 0.0150, params_b=400, source="estimated"),
    "claude-opus-4-6": _coef(0.0030, 0.0150, params_b=400, source="estimated"),
    "claude-opus-4-1": _coef(0.0030, 0.0150, params_b=400, source="estimated"),
    "claude-opus-3-5": _coef(0.0030, 0.0150, params_b=400, source="estimated"),
    "claude-opus-3": _coef(0.0030, 0.0150, params_b=400, source="estimated"),
    "claude-sonnet-4": _coef(0.0010, 0.0050, params_b=70, source="estimated"),
    "claude-sonnet-4-6": _coef(0.0010, 0.0050, params_b=70, source="estimated"),
    "claude-sonnet-4-5": _coef(0.0010, 0.0050, params_b=70, source="estimated"),
    "claude-sonnet-3-7": _coef(0.0010, 0.0050, params_b=70, source="estimated"),
    "claude-sonnet-3-5": _coef(0.0010, 0.0050, params_b=70, source="estimated"),
    "claude-sonnet-3": _coef(0.0010, 0.0050, params_b=70, source="estimated"),
    "claude-haiku-4-5": _coef(0.0003, 0.0015, params_b=13, source="estimated"),
    "claude-haiku-3-5": _coef(0.0003, 0.0015, params_b=13, source="estimated"),
    "claude-haiku-3": _coef(0.0003, 0.0015, params_b=13, source="estimated"),
    # ---------- OpenAI (closed, estimated) ----------
    "gpt-4o": _coef(0.0020, 0.0100, params_b=200, source="estimated"),
    "gpt-4o-mini": _coef(0.0006, 0.0030, params_b=30, source="estimated"),
    "gpt-4-turbo": _coef(0.0030, 0.0150, params_b=400, source="estimated"),
    "gpt-4": _coef(0.0050, 0.0250, params_b=1000, source="estimated"),
    "gpt-3-5-turbo": _coef(0.0003, 0.0015, params_b=20, source="estimated"),
    "o1": _coef(0.0030, 0.0150, params_b=400, source="estimated"),
    "o1-mini": _coef(0.0006, 0.0030, params_b=30, source="estimated"),
    "o3": _coef(0.0030, 0.0150, params_b=400, source="estimated"),
    "o3-mini": _coef(0.0006, 0.0030, params_b=30, source="estimated"),
    # ---------- Google (closed, estimated) ----------
    "gemini-1-5-pro": _coef(0.0020, 0.0100, params_b=200, source="estimated"),
    "gemini-1-5-flash": _coef(0.0003, 0.0015, params_b=20, source="estimated"),
    "gemini-2-0-flash": _coef(0.0003, 0.0015, params_b=20, source="estimated"),
    "gemini-2-0-pro": _coef(0.0020, 0.0100, params_b=200, source="estimated"),
    # ---------- Open-weight (measured via HF AI Energy Score / Luccioni 2024) ----------
    "llama-3-1-405b": _coef(0.0050, 0.0250, params_b=405, source="measured"),
    "llama-3-1-70b": _coef(0.0010, 0.0050, params_b=70, source="measured"),
    "llama-3-1-8b": _coef(0.0002, 0.0010, params_b=8, source="measured"),
    "llama-3-70b": _coef(0.0010, 0.0050, params_b=70, source="measured"),
    "llama-3-8b": _coef(0.0002, 0.0010, params_b=8, source="measured"),
    "mistral-7b": _coef(0.0002, 0.0010, params_b=7, source="measured"),
    "mixtral-8x7b": _coef(0.0006, 0.0030, params_b=47, source="measured"),
    "mixtral-8x22b": _coef(0.0015, 0.0075, params_b=141, source="measured"),
}


#: Citation metadata for the coefficient table.
ENERGY_SOURCES: dict[str, dict[str, str]] = {
    "patterson2021": {
        "citation": "Patterson et al. 2021, 'Carbon Emissions and Large Neural Network Training'",
        "arxiv": "2104.10350",
    },
    "luccioni2024": {
        "citation": "Luccioni, Jernite, Strubell 2024, 'Power Hungry Processing'",
        "venue": "FAccT 2024",
        "arxiv": "2311.16863",
    },
    "huggingface": {
        "citation": "Hugging Face AI Energy Score",
        "url": "https://huggingface.co/AIEnergyScore",
    },
}


_DATED_SUFFIX = re.compile(r"-\d{4}-?\d{2}-?\d{2}$")
_LATEST_PREVIEW = re.compile(r"-(latest|preview)$")
_VERSION_SUFFIX = re.compile(r"-v\d+$")
_NUMERIC_SUFFIX = re.compile(r"-\d{3,4}$")


def normalize_model_name(model: str) -> str:
    """Strip version-date suffixes and normalise punctuation.

    Callers can pass ``"claude-sonnet-4-5-20251022"`` or
    ``"gpt-4o-2024-11-20"`` and still hit the canonical entry.
    """
    name = model.strip().lower()
    name = name.replace(".", "-")
    name = _DATED_SUFFIX.sub("", name)
    name = _LATEST_PREVIEW.sub("", name)
    name = _VERSION_SUFFIX.sub("", name)
    name = _NUMERIC_SUFFIX.sub("", name)
    return name


def lookup_model_energy(model: str | None = None) -> ModelEnergyCoefficients:
    """Look up coefficients for a (possibly suffixed) model name."""
    if not model:
        return _FALLBACK
    return MODEL_ENERGY_COEFFICIENTS.get(normalize_model_name(model), _FALLBACK)


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

    coeffs = lookup_model_energy(model)

    if (
        coeffs.source == "fallback"
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
    "EnergySourceTier",
    "ModelEnergyCoefficients",
    "estimate_energy_kwh",
    "grams_for_intensity",
    "lookup_model_energy",
    "normalize_model_name",
]
