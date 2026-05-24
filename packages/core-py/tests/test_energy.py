"""Tests for the per-model energy module (mirrors core-ts/test/energy.test.ts)."""

from __future__ import annotations

import pytest

from ebb_ai.energy import (
    DEFAULT_PUE,
    ENERGY_SOURCES,
    LEGACY_KWH_PER_TASK,
    MODEL_ENERGY_COEFFICIENTS,
    estimate_energy_kwh,
    grams_for_intensity,
    lookup_model_energy,
    normalize_model_name,
)


class TestNormalizeModelName:
    def test_lowercases_and_strips_dated_suffix(self) -> None:
        assert normalize_model_name("Claude-Sonnet-4-5-20251022") == "claude-sonnet-4-5"
        assert normalize_model_name("gpt-4o-2024-11-20") == "gpt-4o"

    def test_dots_become_dashes(self) -> None:
        assert normalize_model_name("gpt-3.5-turbo") == "gpt-3-5-turbo"

    def test_strips_latest_preview_version_suffixes(self) -> None:
        assert normalize_model_name("claude-haiku-3-5-latest") == "claude-haiku-3-5"
        assert normalize_model_name("gpt-4o-preview") == "gpt-4o"
        assert normalize_model_name("model-v2") == "model"
        assert normalize_model_name("model-001") == "model"

    def test_canonical_untouched(self) -> None:
        assert normalize_model_name("claude-opus-4-7") == "claude-opus-4-7"
        assert normalize_model_name("llama-3-1-8b") == "llama-3-1-8b"


class TestLookupModelEnergy:
    def test_measured_for_open_weight(self) -> None:
        c = lookup_model_energy("llama-3-1-70b")
        assert c.source == "measured"
        assert c.wh_per_output_token > c.wh_per_input_token

    def test_estimated_for_closed_frontier(self) -> None:
        assert lookup_model_energy("claude-opus-4-7").source == "estimated"

    def test_fallback_for_unknown(self) -> None:
        assert lookup_model_energy("totally-unknown-model").source == "fallback"
        assert lookup_model_energy("").source == "fallback"
        assert lookup_model_energy(None).source == "fallback"

    def test_dated_and_undated_collapse(self) -> None:
        a = lookup_model_energy("claude-sonnet-4-5")
        b = lookup_model_energy("claude-sonnet-4-5-20251022")
        assert a == b


class TestEstimateEnergyKwhBackwardsCompat:
    def test_no_args_is_legacy_flat(self) -> None:
        assert estimate_energy_kwh() == LEGACY_KWH_PER_TASK

    def test_unknown_model_no_tokens_is_legacy_flat(self) -> None:
        assert estimate_energy_kwh(model="ghost-model") == LEGACY_KWH_PER_TASK


class TestEstimateEnergyKwhPerModel:
    def test_per_token_math_with_pue(self) -> None:
        # claude-sonnet-4: 0.0010 in + 0.0050 out Wh/token
        # 1000 in + 2000 out = 1.0 + 10.0 = 11.0 Wh chip * 1.15 PUE
        # = 12.65 Wh = 0.01265 kWh
        got = estimate_energy_kwh(
            model="claude-sonnet-4", input_tokens=1000, output_tokens=2000
        )
        assert got == pytest.approx(0.01265, abs=1e-6)

    def test_typical_token_defaults(self) -> None:
        # 500 + 500 for claude-sonnet-4 = 3.0 Wh * 1.15 = 0.00345 kWh
        assert estimate_energy_kwh(model="claude-sonnet-4") == pytest.approx(
            0.00345, abs=1e-6
        )

    def test_frontier_dwarfs_compact(self) -> None:
        opus = estimate_energy_kwh(
            model="claude-opus-4-7", input_tokens=500, output_tokens=500
        )
        haiku = estimate_energy_kwh(
            model="claude-haiku-4-5", input_tokens=500, output_tokens=500
        )
        assert opus > haiku * 5

    def test_pue_override(self) -> None:
        default = estimate_energy_kwh(
            model="llama-3-1-8b", input_tokens=100, output_tokens=100
        )
        no_pue = estimate_energy_kwh(
            model="llama-3-1-8b", input_tokens=100, output_tokens=100, pue=1.0
        )
        assert default / no_pue == pytest.approx(DEFAULT_PUE, abs=1e-6)

    def test_scales_linearly_with_tokens(self) -> None:
        a = estimate_energy_kwh(
            model="gpt-4o", input_tokens=100, output_tokens=200
        )
        b = estimate_energy_kwh(
            model="gpt-4o", input_tokens=1000, output_tokens=2000
        )
        assert b / a == pytest.approx(10.0, abs=1e-6)


class TestGramsForIntensity:
    def test_multiplies_by_intensity(self) -> None:
        legacy = estimate_energy_kwh()
        assert grams_for_intensity(250) == pytest.approx(legacy * 250, abs=1e-6)

    def test_frontier_grams_higher_than_compact(self) -> None:
        opus = grams_for_intensity(400, model="claude-opus-4-7")
        haiku = grams_for_intensity(400, model="claude-haiku-4-5")
        assert opus > haiku


class TestTableSanity:
    def test_output_geq_input_per_token(self) -> None:
        for name, c in MODEL_ENERGY_COEFFICIENTS.items():
            assert c.wh_per_output_token >= c.wh_per_input_token, name

    def test_all_positive_finite(self) -> None:
        import math

        for name, c in MODEL_ENERGY_COEFFICIENTS.items():
            assert math.isfinite(c.wh_per_input_token), name
            assert math.isfinite(c.wh_per_output_token), name
            assert c.wh_per_input_token > 0, name
            assert c.wh_per_output_token > 0, name

    def test_recognized_source_tier(self) -> None:
        for name, c in MODEL_ENERGY_COEFFICIENTS.items():
            assert c.source in {"measured", "estimated"}, name

    def test_llama_family_monotonic(self) -> None:
        a = MODEL_ENERGY_COEFFICIENTS["llama-3-1-8b"]
        b = MODEL_ENERGY_COEFFICIENTS["llama-3-1-70b"]
        c = MODEL_ENERGY_COEFFICIENTS["llama-3-1-405b"]
        assert b.wh_per_output_token > a.wh_per_output_token
        assert c.wh_per_output_token > b.wh_per_output_token


class TestCitations:
    def test_primary_sources_present(self) -> None:
        assert ENERGY_SOURCES["patterson2021"]["arxiv"] == "2104.10350"
        assert ENERGY_SOURCES["luccioni2024"]["arxiv"] == "2311.16863"
        assert "huggingface.co/AIEnergyScore" in ENERGY_SOURCES["huggingface"]["url"]
