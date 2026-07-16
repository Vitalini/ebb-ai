# GENERATED — DO NOT EDIT.
#
# Produced by scripts/gen-data.mjs from packages/core-ts/src/data/*.json.
# Edit those JSON files and run 'pnpm gen:data' to regenerate. CI fails
# on drift ('pnpm gen:data:check').
# ruff: noqa
"""Generated data tables mirrored from the JSON SSOT in @ebb-ai/core."""

from __future__ import annotations

from typing import Any

#: Industry-average Power Usage Effectiveness for hyperscaler data centres.
DEFAULT_PUE: float = 1.15

#: Backwards-compatible flat estimate. Used when no model is provided.
LEGACY_KWH_PER_TASK: float = 0.0015

#: Typical token shape used when a caller names a model but no token counts.
TYPICAL_INPUT_TOKENS: int = 500
TYPICAL_OUTPUT_TOKENS: int = 500

#: Per-model coefficient table. Keys are canonical lowercase names.
COEFFICIENTS: dict[str, dict[str, Any]] = {
    "claude-opus-4": {"wh_per_input_token": 0.003, "wh_per_output_token": 0.015, "params_b": 400, "source": "estimated"},
    "claude-opus-4-7": {"wh_per_input_token": 0.003, "wh_per_output_token": 0.015, "params_b": 400, "source": "estimated"},
    "claude-opus-4-6": {"wh_per_input_token": 0.003, "wh_per_output_token": 0.015, "params_b": 400, "source": "estimated"},
    "claude-opus-4-1": {"wh_per_input_token": 0.003, "wh_per_output_token": 0.015, "params_b": 400, "source": "estimated"},
    "claude-opus-3-5": {"wh_per_input_token": 0.003, "wh_per_output_token": 0.015, "params_b": 400, "source": "estimated"},
    "claude-opus-3": {"wh_per_input_token": 0.003, "wh_per_output_token": 0.015, "params_b": 400, "source": "estimated"},
    "claude-sonnet-4": {"wh_per_input_token": 0.001, "wh_per_output_token": 0.005, "params_b": 70, "source": "estimated"},
    "claude-sonnet-4-6": {"wh_per_input_token": 0.001, "wh_per_output_token": 0.005, "params_b": 70, "source": "estimated"},
    "claude-sonnet-4-5": {"wh_per_input_token": 0.001, "wh_per_output_token": 0.005, "params_b": 70, "source": "estimated"},
    "claude-sonnet-3-7": {"wh_per_input_token": 0.001, "wh_per_output_token": 0.005, "params_b": 70, "source": "estimated"},
    "claude-sonnet-3-5": {"wh_per_input_token": 0.001, "wh_per_output_token": 0.005, "params_b": 70, "source": "estimated"},
    "claude-sonnet-3": {"wh_per_input_token": 0.001, "wh_per_output_token": 0.005, "params_b": 70, "source": "estimated"},
    "claude-haiku-4-5": {"wh_per_input_token": 0.0003, "wh_per_output_token": 0.0015, "params_b": 13, "source": "estimated"},
    "claude-haiku-3-5": {"wh_per_input_token": 0.0003, "wh_per_output_token": 0.0015, "params_b": 13, "source": "estimated"},
    "claude-haiku-3": {"wh_per_input_token": 0.0003, "wh_per_output_token": 0.0015, "params_b": 13, "source": "estimated"},
    "gpt-4o": {"wh_per_input_token": 0.002, "wh_per_output_token": 0.01, "params_b": 200, "source": "estimated"},
    "gpt-4o-mini": {"wh_per_input_token": 0.0006, "wh_per_output_token": 0.003, "params_b": 30, "source": "estimated"},
    "gpt-4-turbo": {"wh_per_input_token": 0.003, "wh_per_output_token": 0.015, "params_b": 400, "source": "estimated"},
    "gpt-4": {"wh_per_input_token": 0.005, "wh_per_output_token": 0.025, "params_b": 1000, "source": "estimated"},
    "gpt-3-5-turbo": {"wh_per_input_token": 0.0003, "wh_per_output_token": 0.0015, "params_b": 20, "source": "estimated"},
    "o1": {"wh_per_input_token": 0.003, "wh_per_output_token": 0.015, "params_b": 400, "source": "estimated"},
    "o1-mini": {"wh_per_input_token": 0.0006, "wh_per_output_token": 0.003, "params_b": 30, "source": "estimated"},
    "o3": {"wh_per_input_token": 0.003, "wh_per_output_token": 0.015, "params_b": 400, "source": "estimated"},
    "o3-mini": {"wh_per_input_token": 0.0006, "wh_per_output_token": 0.003, "params_b": 30, "source": "estimated"},
    "gemini-1-5-pro": {"wh_per_input_token": 0.002, "wh_per_output_token": 0.01, "params_b": 200, "source": "estimated"},
    "gemini-1-5-flash": {"wh_per_input_token": 0.0003, "wh_per_output_token": 0.0015, "params_b": 20, "source": "estimated"},
    "gemini-2-0-flash": {"wh_per_input_token": 0.0003, "wh_per_output_token": 0.0015, "params_b": 20, "source": "estimated"},
    "gemini-2-0-pro": {"wh_per_input_token": 0.002, "wh_per_output_token": 0.01, "params_b": 200, "source": "estimated"},
    "llama-3-1-405b": {"wh_per_input_token": 0.005, "wh_per_output_token": 0.025, "params_b": 405, "source": "measured"},
    "llama-3-1-70b": {"wh_per_input_token": 0.001, "wh_per_output_token": 0.005, "params_b": 70, "source": "measured"},
    "llama-3-1-8b": {"wh_per_input_token": 0.0002, "wh_per_output_token": 0.001, "params_b": 8, "source": "measured"},
    "llama-3-70b": {"wh_per_input_token": 0.001, "wh_per_output_token": 0.005, "params_b": 70, "source": "measured"},
    "llama-3-8b": {"wh_per_input_token": 0.0002, "wh_per_output_token": 0.001, "params_b": 8, "source": "measured"},
    "mistral-7b": {"wh_per_input_token": 0.0002, "wh_per_output_token": 0.001, "params_b": 7, "source": "measured"},
    "mixtral-8x7b": {"wh_per_input_token": 0.0006, "wh_per_output_token": 0.003, "params_b": 47, "source": "measured"},
    "mixtral-8x22b": {"wh_per_input_token": 0.0015, "wh_per_output_token": 0.0075, "params_b": 141, "source": "measured"},
}

#: Ordered family-fallback rules (see _family_representative).
FAMILIES: list[dict[str, Any]] = [
    {"id": "claude-opus", "representative": "claude-opus-4", "contains": ["opus"], "prefix": None, "regex": None},
    {"id": "claude-sonnet", "representative": "claude-sonnet-4", "contains": ["sonnet"], "prefix": None, "regex": None},
    {"id": "claude-haiku", "representative": "claude-haiku-4-5", "contains": ["haiku"], "prefix": None, "regex": None},
    {"id": "gpt-4o", "representative": "gpt-4o", "contains": None, "prefix": "gpt-4o", "regex": None},
    {"id": "gpt-4", "representative": "gpt-4", "contains": None, "prefix": "gpt-4", "regex": None},
    {"id": "gpt-3", "representative": "gpt-3-5-turbo", "contains": None, "prefix": "gpt-3", "regex": None},
    {"id": "openai-o", "representative": "o3", "contains": None, "prefix": None, "regex": "^o[0-9]"},
    {"id": "gemini-flash", "representative": "gemini-2-0-flash", "contains": ["flash"], "prefix": "gemini", "regex": None},
    {"id": "gemini-pro", "representative": "gemini-1-5-pro", "contains": None, "prefix": "gemini", "regex": None},
    {"id": "mixtral", "representative": "mixtral-8x7b", "contains": None, "prefix": "mixtral", "regex": None},
    {"id": "mistral", "representative": "mistral-7b", "contains": None, "prefix": "mistral", "regex": None},
    {"id": "llama", "representative": "llama-3-1-70b", "contains": None, "prefix": "llama", "regex": None},
]

#: Citation metadata for the coefficient table.
ENERGY_SOURCES: dict[str, dict[str, str]] = {
    "patterson2021": {"citation": "Patterson et al. 2021, 'Carbon Emissions and Large Neural Network Training'", "arxiv": "2104.10350"},
    "luccioni2024": {"citation": "Luccioni, Jernite, Strubell 2024, 'Power Hungry Processing'", "venue": "FAccT 2024", "arxiv": "2311.16863"},
    "huggingface": {"citation": "Hugging Face AI Energy Score", "url": "https://huggingface.co/AIEnergyScore"},
}

#: Synthetic-curve region midpoints (gCO2/kWh).
REGION_FLOORS: dict[str, int] = {
    "US-CAL-CISO": 280,
    "US-TEX-ERCO": 340,
    "US-NE-ISNE": 320,
    "US-MIDA-PJM": 420,
    "GB": 220,
    "FR": 60,
    "DE": 380,
    "IE": 340,
    "NL": 350,
    "ES": 160,
    "BE": 140,
    "AT": 110,
    "PL": 650,
    "JP-TK": 470,
    "KR": 430,
    "SG": 420,
    "AU-NSW": 500,
    "CA-ON": 50,
    "US-NY-NYIS": 360,
    "US-MIDW-MISO": 460,
    "US-NW-BPAT": 110,
    "US-FLA-FPL": 400,
    "IT-NO": 320,
    "SE-SE3": 40,
    "NO-NO1": 30,
    "FI": 120,
    "DK-DK1": 180,
    "IN-WE": 700,
    "ZA": 700,
    "AE": 620,
    "NZ": 80,
}

#: Fallback midpoint for regions with no explicit floor.
DEFAULT_REGION_FLOOR: int = 380

#: Peak-to-trough half-swing of the synthetic curve (gCO2/kWh).
SYNTHETIC_AMPLITUDE: int = 220

#: Per-region UTC-hour offset applied to the synthetic curve's local trough.
REGION_UTC_OFFSETS: dict[str, int] = {
    "US-CAL-CISO": -8,
    "US-TEX-ERCO": -6,
    "US-NE-ISNE": -5,
    "US-MIDA-PJM": -5,
    "GB": 0,
    "FR": 1,
    "DE": 1,
    "IE": 0,
    "NL": 1,
    "ES": 1,
    "BE": 1,
    "AT": 1,
    "PL": 1,
    "JP-TK": 9,
    "KR": 9,
    "SG": 8,
    "AU-NSW": 10,
    "CA-ON": -5,
    "US-NY-NYIS": -5,
    "US-MIDW-MISO": -6,
    "US-NW-BPAT": -8,
    "US-FLA-FPL": -5,
    "IT-NO": 1,
    "SE-SE3": 1,
    "NO-NO1": 1,
    "FI": 2,
    "DK-DK1": 1,
    "IN-WE": 5,
    "ZA": 2,
    "AE": 4,
    "NZ": 12,
}

#: Band thresholds (ascending). A value maps to the first band it is below.
BAND_THRESHOLDS: list[tuple[int, str]] = [
    (100, "very_clean"),
    (250, "clean"),
    (450, "average"),
    (700, "dirty"),
]

#: Band for values at or above every threshold.
DEFAULT_BAND: str = "very_dirty"
