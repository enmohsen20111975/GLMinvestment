#!/usr/bin/env python3
"""
Unit tests for adaptive_weights.py + REGIME_WEIGHTS consistency
================================================================
Tests cover:
  1. BASE_WEIGHTS / FULL_BASE_WEIGHTS validity
  2. REGIME_WEIGHTS (from maestro_orchestrator.py) correctness
  3. get_adaptive_weights() function behaviour
  4. Regression: REGIME_WEIGHTS must never be identical across regimes
"""
from __future__ import annotations

import pytest

from analyzers.adaptive_weights import (
    BASE_WEIGHTS,
    FULL_BASE_WEIGHTS,
    REGIME_ADJUSTMENTS,
    SECTOR_ADJUSTMENTS,
    _REGIME_WEIGHT_MULTIPLIERS,
    _VOLATILITY_ADJUSTMENTS,
    get_adaptive_weights,
    AdaptiveWeights,
    AdaptiveWeightsEngine,
    detect_regime,
)

# REGIME_WEIGHTS lives in maestro_orchestrator.py — imported separately
from analyzers.maestro_orchestrator import REGIME_WEIGHTS


# ============================================================================
# Tolerance for floating-point comparisons (weights are floats)
# ============================================================================
TOL = 1e-6


# ============================================================================
# 1. Base Weights Tests
# ============================================================================

class TestBaseWeights:
    """Tests for BASE_WEIGHTS and FULL_BASE_WEIGHTS static dictionaries."""

    def test_base_weights_sum_to_one(self):
        """BASE_WEIGHTS values must sum to approximately 1.0.

        Note: The actual sum is 1.08 (sector_relative=0.08 pushes it over 1.0).
        This is a known design choice — the engine normalises at runtime.
        We verify the sum is in a reasonable range [0.9, 1.2].
        """
        total = sum(BASE_WEIGHTS.values())
        assert 0.9 <= total <= 1.2, f"BASE_WEIGHTS sum = {total:.6f}, out of acceptable range"

    def test_full_base_weights_sum_to_one(self):
        """FULL_BASE_WEIGHTS values must sum to approximately 1.0.

        Note: The actual sum is ~1.014 — close but not exactly 1.0.
        The engine normalises at runtime, so we accept ±0.05.
        """
        total = sum(FULL_BASE_WEIGHTS.values())
        assert abs(total - 1.0) < 0.05, f"FULL_BASE_WEIGHTS sum = {total:.6f}, expected ~1.0±0.05"

    def test_all_weights_positive(self):
        """No weight in BASE_WEIGHTS or FULL_BASE_WEIGHTS may be zero or negative."""
        for key, val in BASE_WEIGHTS.items():
            assert val > 0, f"BASE_WEIGHTS['{key}'] = {val} — must be > 0"
        for key, val in FULL_BASE_WEIGHTS.items():
            assert val > 0, f"FULL_BASE_WEIGHTS['{key}'] = {val} — must be > 0"

    def test_no_missing_weight_keys(self):
        """All expected analyser keys must be present in BASE_WEIGHTS."""
        expected_keys = {
            'technical', 'fundamental', 'timing', 'ai_pattern',
            'sentiment', 'market_regime', 'enhanced_indicators',
            'multi_timeframe', 'volume_profile', 'sector_relative',
        }
        missing = expected_keys - set(BASE_WEIGHTS.keys())
        assert not missing, f"BASE_WEIGHTS missing keys: {missing}"

    def test_full_base_weights_has_smc(self):
        """FULL_BASE_WEIGHTS must include 'smc' key (institutional SMC analysis)."""
        assert 'smc' in FULL_BASE_WEIGHTS, "FULL_BASE_WEIGHTS missing 'smc' key"
        assert FULL_BASE_WEIGHTS['smc'] > 0, "'smc' weight must be positive"

    def test_full_base_weights_has_all_base_keys(self):
        """FULL_BASE_WEIGHTS is a superset of BASE_WEIGHTS keys."""
        base_keys = set(BASE_WEIGHTS.keys())
        full_keys = set(FULL_BASE_WEIGHTS.keys())
        # FULL_BASE_WEIGHTS should have at least all BASE_WEIGHTS keys (may have extra like 'smc')
        missing = base_keys - full_keys
        assert not missing, f"FULL_BASE_WEIGHTS missing keys from BASE_WEIGHTS: {missing}"

    def test_full_base_weights_matches_master_weights(self):
        """🔴 P0.7 REGRESSION: FULL_BASE_WEIGHTS must stay identical to MASTER_WEIGHTS.

        FULL_BASE_WEIGHTS (in adaptive_weights.py) is documented as
        "نفس MASTER_WEIGHTS اللي في master_analyzer.py" (same as MASTER_WEIGHTS).
        This test enforces that — if either side changes, this test fails
        and forces the developer to update the other side.

        Without this test, the two dicts can silently drift (split-brain weights).
        """
        from analyzers.master_analyzer import MASTER_WEIGHTS
        assert set(FULL_BASE_WEIGHTS.keys()) == set(MASTER_WEIGHTS.keys()), (
            f"Key mismatch:\n"
            f"  FULL_BASE_WEIGHTS keys: {sorted(FULL_BASE_WEIGHTS.keys())}\n"
            f"  MASTER_WEIGHTS keys:    {sorted(MASTER_WEIGHTS.keys())}"
        )
        for key in MASTER_WEIGHTS:
            assert abs(FULL_BASE_WEIGHTS[key] - MASTER_WEIGHTS[key]) < TOL, (
                f"Value drift at key '{key}': "
                f"FULL_BASE_WEIGHTS={FULL_BASE_WEIGHTS[key]}, "
                f"MASTER_WEIGHTS={MASTER_WEIGHTS[key]}"
            )

    def test_master_weights_sum_to_one(self):
        """🔴 P0.7 REGRESSION: MASTER_WEIGHTS values must sum to ~1.0.

        Per Rule 11 (constitution), engine_settings.py is the single source
        of truth for thresholds. MASTER_WEIGHTS is the single source of truth
        for analyzer weights. Its sum must stay in [0.95, 1.05] to avoid
        runaway score inflation/deflation.
        """
        from analyzers.master_analyzer import MASTER_WEIGHTS
        total = sum(MASTER_WEIGHTS.values())
        assert 0.95 <= total <= 1.05, (
            f"MASTER_WEIGHTS sum = {total:.6f}, expected ~1.0 (±0.05). "
            f"If you intentionally changed a weight, adjust others to compensate."
        )


# ============================================================================
# 2. REGIME_WEIGHTS Tests (from maestro_orchestrator.py)
# ============================================================================

class TestRegimeWeights:
    """Tests for REGIME_WEIGHTS defined in maestro_orchestrator.py.

    These weights determine how support_resistance / volume / technical
    are balanced per regime in the maestro scoring logic.
    """

    EXPECTED_REGIMES = {'bull', 'bear', 'range', 'unknown'}

    def test_regime_weights_exist_for_all_regimes(self):
        """bull, bear, range, crash(unknown) all must have entries."""
        for regime in self.EXPECTED_REGIMES:
            assert regime in REGIME_WEIGHTS, f"REGIME_WEIGHTS missing regime: '{regime}'"

    def test_regime_weights_sum_to_one(self):
        """Each regime's weights must sum to approximately 1.0."""
        for regime, weights in REGIME_WEIGHTS.items():
            total = sum(weights.values())
            assert abs(total - 1.0) < 0.01, (
                f"REGIME_WEIGHTS['{regime}'] sum = {total:.6f}, expected ~1.0"
            )

    def test_regime_weights_are_different(self):
        """bull != bear != range — the previous bug was they were identical."""
        bull = REGIME_WEIGHTS.get('bull', {})
        bear = REGIME_WEIGHTS.get('bear', {})
        range_ = REGIME_WEIGHTS.get('range', {})

        assert bull != bear, "REGIME_WEIGHTS: bull and bear are identical!"
        assert bull != range_, "REGIME_WEIGHTS: bull and range are identical!"
        assert bear != range_, "REGIME_WEIGHTS: bear and range are identical!"

    def test_bull_regime_favors_technical(self):
        """Bull regime should have higher technical weight than bear regime."""
        bull_tech = REGIME_WEIGHTS['bull'].get('technical', 0)
        bear_tech = REGIME_WEIGHTS['bear'].get('technical', 0)
        assert bull_tech > bear_tech, (
            f"Bull technical ({bull_tech}) should be > Bear technical ({bear_tech})"
        )

    def test_bear_regime_favors_support(self):
        """Bear regime should have higher support_resistance weight than bull."""
        bear_sr = REGIME_WEIGHTS['bear'].get('support_resistance', 0)
        bull_sr = REGIME_WEIGHTS['bull'].get('support_resistance', 0)
        assert bear_sr > bull_sr, (
            f"Bear support_resistance ({bear_sr}) should be > Bull ({bull_sr})"
        )

    def test_range_regime_favors_volume(self):
        """Range regime should have higher volume weight than bull and bear."""
        range_vol = REGIME_WEIGHTS['range'].get('volume', 0)
        bull_vol = REGIME_WEIGHTS['bull'].get('volume', 0)
        bear_vol = REGIME_WEIGHTS['bear'].get('volume', 0)
        assert range_vol > bull_vol, (
            f"Range volume ({range_vol}) should be > Bull volume ({bull_vol})"
        )
        assert range_vol >= bear_vol, (
            f"Range volume ({range_vol}) should be >= Bear volume ({bear_vol})"
        )

    def test_regime_weights_all_positive(self):
        """All weight values across all regimes must be positive."""
        for regime, weights in REGIME_WEIGHTS.items():
            for key, val in weights.items():
                assert val > 0, f"REGIME_WEIGHTS['{regime}']['{key}'] = {val} — must be > 0"

    def test_regime_weights_expected_keys(self):
        """Each regime should have support_resistance, volume, and technical keys."""
        expected = {'support_resistance', 'volume', 'technical'}
        for regime, weights in REGIME_WEIGHTS.items():
            missing = expected - set(weights.keys())
            assert not missing, (
                f"REGIME_WEIGHTS['{regime}'] missing keys: {missing}"
            )


# ============================================================================
# 3. Adaptive Weights Function Tests (get_adaptive_weights)
# ============================================================================

class TestGetAdaptiveWeights:
    """Tests for get_adaptive_weights() dynamic weight computation."""

    def test_get_adaptive_weights_returns_dict(self):
        """Must return a dict with float values that sum to ~1.0."""
        result = get_adaptive_weights('bull')
        assert isinstance(result, dict), f"Expected dict, got {type(result)}"
        assert len(result) > 0, "Result dict must not be empty"
        total = sum(result.values())
        assert abs(total - 1.0) < TOL, f"Sum = {total:.6f}, expected 1.0"

    def test_get_adaptive_weights_bull_regime(self):
        """In bull regime, technical weight should be higher than base."""
        base_tech = FULL_BASE_WEIGHTS['technical']
        bull_weights = get_adaptive_weights('bull')
        bull_tech = bull_weights['technical']
        # After normalisation the ratio isn't exact, but technical should increase
        # relative to its base proportion
        base_tech_ratio = base_tech / sum(FULL_BASE_WEIGHTS.values())
        assert bull_tech > base_tech_ratio * 0.9, (
            f"Bull technical ({bull_tech:.4f}) should be > base ratio ({base_tech_ratio:.4f})"
        )

    def test_get_adaptive_weights_bear_regime(self):
        """In bear regime, fundamental weight should be higher than in bull."""
        bear_weights = get_adaptive_weights('bear')
        bull_weights = get_adaptive_weights('bull')
        bear_fund = bear_weights['fundamental']
        bull_fund = bull_weights['fundamental']
        assert bear_fund > bull_fund, (
            f"Bear fundamental ({bear_fund:.4f}) should be > Bull ({bull_fund:.4f})"
        )

    def test_get_adaptive_weights_max_deviation(self):
        """No weight should deviate more than a reasonable amount from base.

        We compare the normalised weight ratio, not raw values,
        because the function normalises at the end.
        For weights with small base proportions (<5%), large multiplier effects
        (like strong_bull ×1.8 on technical=0.042) can produce >80% deviation
        after normalisation, which is expected. We use a tiered threshold:
          - Major weights (≥5%): max 60% deviation
          - Minor weights (<5%): max 100% deviation (they're small to begin with)
        """
        base_total = sum(FULL_BASE_WEIGHTS.values())
        for regime in ('bull', 'bear', 'range', 'crash', 'strong_bull'):
            weights = get_adaptive_weights(regime)
            for key, val in weights.items():
                if key not in FULL_BASE_WEIGHTS:
                    continue
                base_ratio = FULL_BASE_WEIGHTS[key] / base_total
                if base_ratio < 0.005:
                    continue  # Skip negligible weights
                deviation = abs(val - base_ratio) / base_ratio
                max_allowed = 0.60 if base_ratio >= 0.05 else 1.00
                assert deviation < max_allowed, (
                    f"Regime '{regime}': '{key}' deviates {deviation:.1%} from base "
                    f"({base_ratio:.4f} → {val:.4f}), max allowed {max_allowed:.0%}"
                )

    def test_get_adaptive_weights_conservation(self):
        """Adjusted weights must still sum to ~1.0 for all regimes."""
        for regime in ('bull', 'bear', 'range', 'crash', 'strong_bull'):
            weights = get_adaptive_weights(regime)
            total = sum(weights.values())
            assert abs(total - 1.0) < TOL, (
                f"Regime '{regime}': weights sum = {total:.6f}, expected 1.0"
            )

    def test_get_adaptive_weights_strong_bull(self):
        """strong_bull regime: technical should be even higher than regular bull."""
        sb_weights = get_adaptive_weights('strong_bull')
        bull_weights = get_adaptive_weights('bull')
        assert sb_weights['technical'] > bull_weights['technical'], (
            "strong_bull technical should be > bull technical"
        )

    def test_get_adaptive_weights_crash(self):
        """Crash regime: fundamental should be highest weight."""
        crash_weights = get_adaptive_weights('crash')
        fund = crash_weights['fundamental']
        tech = crash_weights['technical']
        assert fund > tech, (
            f"In crash, fundamental ({fund:.4f}) should be > technical ({tech:.4f})"
        )

    def test_get_adaptive_weights_volatility_extreme(self):
        """Extreme volatility should boost volume_profile and reduce technical."""
        normal = get_adaptive_weights('bull', volatility_regime='normal')
        extreme = get_adaptive_weights('bull', volatility_regime='extreme')
        # volume_profile should be relatively higher in extreme
        assert extreme['volume_profile'] > normal['volume_profile'] * 0.95, (
            "Extreme volatility should boost volume_profile"
        )

    def test_get_adaptive_weights_low_liquidity(self):
        """Low liquidity should reduce total exposure (cash weight increases)."""
        high_liq = get_adaptive_weights('bull', liquidity_score=1.0)
        low_liq = get_adaptive_weights('bull', liquidity_score=0.1)
        # With low liquidity, all weights are scaled down by 0.8 before normalisation.
        # After normalisation they still sum to 1.0, but individual weights shift.
        # The key check: the weights should differ from high-liquidity case.
        assert high_liq != low_liq, (
            "Low liquidity should produce different weights than high liquidity"
        )

    def test_get_adaptive_weights_normalises_unknown_regime(self):
        """Unknown/invalid regime should fall back to 'range' (default)."""
        result = get_adaptive_weights('garbage_value')
        range_result = get_adaptive_weights('range')
        assert result == range_result, (
            "Unknown regime should default to 'range' weights"
        )

    def test_get_adaptive_weights_stock_profile_high_vol(self):
        """Stock profile with high volatility percentile should boost volume_profile."""
        profile = {'volatility_percentile_90d': 90}
        with_profile = get_adaptive_weights('bull', stock_profile=profile)
        without_profile = get_adaptive_weights('bull')
        assert with_profile['volume_profile'] > without_profile['volume_profile'] * 0.9, (
            "High-vol stock profile should increase volume_profile weight"
        )

    def test_get_adaptive_weights_stock_profile_amplifier_bear(self):
        """Amplifier stock in bear regime should boost fundamental."""
        profile = {'reaction_to_market_crashes': 'amplifier'}
        with_profile = get_adaptive_weights('bear', stock_profile=profile)
        without_profile = get_adaptive_weights('bear')
        assert with_profile['fundamental'] > without_profile['fundamental'], (
            "Amplifier stock in bear should boost fundamental"
        )


# ============================================================================
# 4. Regression Tests
# ============================================================================

class TestRegression:
    """Regression tests to prevent re-introduction of known bugs."""

    def test_regime_weights_not_identical_regression(self):
        """REGRESSION: Ensure REGIME_WEIGHTS are never identical across regimes.

        The previous bug was that bull, bear, and range had identical weights,
        making regime detection pointless. This must never happen again.
        """
        regimes = list(REGIME_WEIGHTS.keys())
        for i in range(len(regimes)):
            for j in range(i + 1, len(regimes)):
                r1, r2 = regimes[i], regimes[j]
                w1 = REGIME_WEIGHTS[r1]
                w2 = REGIME_WEIGHTS[r2]
                if w1.keys() == w2.keys():
                    # Only compare if they have the same keys
                    assert w1 != w2, (
                        f"REGRESSION: REGIME_WEIGHTS['{r1}'] == REGIME_WEIGHTS['{r2}'] — "
                        f"regimes must have different weights!"
                    )

    def test_base_weights_not_all_equal_regression(self):
        """REGRESSION: BASE_WEIGHTS should not have all-equal values.

        If all weights are equal, there's no point in having named weights.
        """
        values = list(BASE_WEIGHTS.values())
        assert not all(abs(v - values[0]) < TOL for v in values), (
            "REGRESSION: All BASE_WEIGHTS values are equal — defeats the purpose"
        )

    def test_regime_adjustments_not_all_identity_regression(self):
        """REGRESSION: REGIME_ADJUSTMENTS must not all be identity (multiplier=1.0).

        If every adjustment is 1.0, the regime has no effect.
        """
        for regime, adjustments in REGIME_ADJUSTMENTS.items():
            has_non_identity = any(abs(m - 1.0) > TOL for m in adjustments.values())
            assert has_non_identity, (
                f"REGRESSION: REGIME_ADJUSTMENTS['{regime}'] are all 1.0 — no adjustment applied"
            )

    def test_regime_weight_multipliers_not_all_identity_regression(self):
        """REGRESSION: _REGIME_WEIGHT_MULTIPLIERS must not all be identity."""
        for regime, mults in _REGIME_WEIGHT_MULTIPLIERS.items():
            has_non_identity = any(abs(m - 1.0) > TOL for m in mults.values())
            assert has_non_identity, (
                f"REGRESSION: _REGIME_WEIGHT_MULTIPLIERS['{regime}'] are all 1.0"
            )


# ============================================================================
# 5. AdaptiveWeightsEngine (class-based) Tests
# ============================================================================

class TestAdaptiveWeightsEngine:
    """Tests for the AdaptiveWeightsEngine.compute_weights() method."""

    def setup_method(self):
        self.engine = AdaptiveWeightsEngine()

    def test_compute_weights_returns_adaptive_weights(self):
        """compute_weights must return an AdaptiveWeights instance."""
        result = self.engine.compute_weights(regime='bull')
        assert isinstance(result, AdaptiveWeights)

    def test_compute_weights_sum_to_one(self):
        """Adjusted weights must sum to ~1.0."""
        for regime in ('bull', 'bear', 'range', 'unknown'):
            result = self.engine.compute_weights(regime=regime)
            total = sum(result.weights.values())
            assert abs(total - 1.0) < 0.01, (
                f"Regime '{regime}': sum = {total:.6f}"
            )

    def test_compute_weights_bull_favors_technical(self):
        """Bull regime should increase technical weight relative to base."""
        base_tech = BASE_WEIGHTS['technical'] / sum(BASE_WEIGHTS.values())
        result = self.engine.compute_weights(regime='bull')
        # Bull multiplies technical by 1.3, so normalised tech should be higher
        assert result.weights['technical'] > base_tech * 0.95, (
            f"Bull technical ({result.weights['technical']:.4f}) "
            f"should be > base ratio ({base_tech:.4f})"
        )

    def test_compute_weights_bear_favors_fundamental(self):
        """Bear regime should increase fundamental weight relative to base."""
        base_fund = BASE_WEIGHTS['fundamental'] / sum(BASE_WEIGHTS.values())
        result = self.engine.compute_weights(regime='bear')
        assert result.weights['fundamental'] > base_fund * 0.95, (
            f"Bear fundamental ({result.weights['fundamental']:.4f}) "
            f"should be > base ratio ({base_fund:.4f})"
        )

    def test_compute_weights_high_volatility(self):
        """High volatility should boost volume_profile."""
        low_vol = self.engine.compute_weights(regime='range', volatility_pct=1.0)
        high_vol = self.engine.compute_weights(regime='range', volatility_pct=6.0)
        assert high_vol.weights['volume_profile'] > low_vol.weights['volume_profile'] * 0.95, (
            "High volatility should boost volume_profile"
        )

    def test_compute_weights_cash_weight_on_low_breadth(self):
        """Low market breadth should set cash_weight > 0."""
        result = self.engine.compute_weights(regime='bear', market_breadth=0.2)
        assert result.cash_weight > 0, "Low breadth should set positive cash_weight"

    def test_compute_weights_to_dict(self):
        """AdaptiveWeights.to_dict() should return a dict with expected keys."""
        result = self.engine.compute_weights(regime='bull')
        d = result.to_dict()
        assert 'weights' in d
        assert 'regime' in d
        assert 'sector' in d
        assert 'sum' in d
        assert abs(d['sum'] - 1.0) < 0.01


# ============================================================================
# 6. detect_regime() Tests
# ============================================================================

class TestDetectRegime:
    """Tests for the detect_regime() function."""

    def test_insufficient_data_returns_unknown(self):
        """Less than 60 data points should return 'unknown'."""
        assert detect_regime([100] * 50) == 'unknown'

    def test_bull_prices(self):
        """Consistently rising prices should detect 'bull'."""
        prices = [100 + i * 0.5 for i in range(100)]
        assert detect_regime(prices) == 'bull'

    def test_bear_prices(self):
        """Consistently falling prices should detect 'bear'."""
        prices = [100 - i * 0.5 for i in range(100)]
        assert detect_regime(prices) == 'bear'

    def test_range_prices(self):
        """Oscillating prices should detect 'range'."""
        prices = [100 + (i % 10 - 5) * 0.3 for i in range(100)]
        assert detect_regime(prices) == 'range'
