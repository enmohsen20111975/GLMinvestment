#!/usr/bin/env python3
"""
Unit tests for institutional_decision_engine.py — V39 Full Dynamic Adaptive
============================================================================

Tests verify that all thresholds, weights, and dynamic features read from
engine_settings via get_setting() instead of using hardcoded values.
No database required — all settings are mocked.
"""

import pytest
from unittest.mock import patch, MagicMock

from analyzers.institutional_decision_engine import (
    _compute_tech_score,
    _compute_signal_final,
    _compute_dynamic_sl_mult,
    _compute_self_learning_thresh,
    _compute_model_quality,
    _build_6_proofs,
    build_institutional_decision,
)


# ──────────────────────────────────────────────────────────────────────
# Helpers
# ──────────────────────────────────────────────────────────────────────

def _make_settings_mock(overrides: dict):
    """Return a side_effect function for get_setting that uses overrides or default."""
    _defaults = {
        'tech_score_base': 50,
        'institutional_buy_threshold': 70,
        'institutional_sell_threshold': 25,
        'institutional_reduce_threshold': 40,
        'base_buy_threshold': 75,
        'proof_weight_trend': 10,
        'proof_weight_makers': 25,
        'proof_weight_dna': 13,
        'proof_weight_fundamental': 13,
        'proof_weight_sector': 12,
        'proof_weight_benchmark': 22,
        'dynamic_rr_outperform': 2.0,
        'dynamic_rr_normal': 1.5,
        'atr_stop_mult_high_vol': 2.5,
        'atr_stop_mult_low_vol': 1.0,
        'atr_stop_mult_default': 1.5,
        'self_learning_adjustment_pct': 10,
        'self_learning_min_trades': 10,
        'adaptive_win_rate_lower': 65,
        'adaptive_win_rate_raise': 40,
        'fund_score_strong': 60,
        'fund_score_weak': 40,
        'candle_prob_bullish_threshold': 55,
        'candle_prob_bearish_threshold': 45,
        'volume_surge_std_mult': 1.5,
        'volume_absorption_ratio': 1.5,
        'volume_no_supply_ratio': 0.5,
        'smc_broke_resistance_score': 60,
        'smc_broke_support_score': 40,
        'volume_surge_institutional': 1.3,
        'vwap_premium_threshold': 5,
        'vwap_discount_threshold': -5,
        'partial_sell_pct': 50,
        'scale_in_pnl_threshold': 15,
        'trailing_stop_activation_gain': 2.0,
        'danger_pnl_threshold': -5,
        'rsi_overbought_base': 70,
        'rsi_trend_adjustment': 10,
        'rsi_oversold_base': 30,
    }

    def _side_effect(key, default=None):
        if key in overrides:
            return overrides[key]
        if key in _defaults:
            return _defaults[key]
        return default if default is not None else 0.0

    return _side_effect


# ──────────────────────────────────────────────────────────────────────
# 1. Tech Score Base Tests
# ──────────────────────────────────────────────────────────────────────

class TestTechScoreBase:
    """Verify _compute_tech_score reads tech_score_base from settings."""

    @patch('analyzers.institutional_decision_engine.get_setting')
    def test_tech_score_base_reads_from_settings(self, mock_gs):
        """tech_score_base is read from get_setting, not hardcoded."""
        mock_gs.return_value = 42  # custom base
        proofs = [{'score_impact': 0}]
        result = _compute_tech_score(proofs)
        # Should have called get_setting with 'tech_score_base'
        mock_gs.assert_called_with('tech_score_base', default=50)
        # Base=42 + impact 0 = 42
        assert result == 42

    @patch('analyzers.institutional_decision_engine.get_setting')
    def test_tech_score_base_default_50(self, mock_gs):
        """When get_setting returns the default (50), base is 50."""
        # Simulate get_setting returning the default value
        def _gs(key, default=None):
            return default if default is not None else 50
        mock_gs.side_effect = _gs

        proofs = []  # no proofs → no impact
        result = _compute_tech_score(proofs)
        assert result == 50

    @patch('analyzers.institutional_decision_engine.get_setting')
    def test_tech_score_base_custom_plus_proofs(self, mock_gs):
        """tech_score_base 30 + proof impacts → correct total."""
        mock_gs.return_value = 30
        proofs = [
            {'score_impact': 15},
            {'score_impact': 20},
            {'score_impact': -10},
        ]
        result = _compute_tech_score(proofs)
        assert result == 55  # 30 + 15 + 20 - 10


# ──────────────────────────────────────────────────────────────────────
# 2. Threshold Tests
# ──────────────────────────────────────────────────────────────────────

class TestThresholds:
    """Verify buy/sell/strong thresholds read from settings."""

    @patch('analyzers.institutional_decision_engine.get_setting')
    def test_buy_threshold_from_settings(self, mock_gs):
        """institutional_buy_threshold reads from settings (default 65)."""
        settings = _make_settings_mock({'institutional_buy_threshold': 70})
        mock_gs.side_effect = settings

        # tech_score=69 < 70 → NOT buy
        result = _compute_signal_final(
            tech_score=69,
            maker_state={'state': 'calm'},
            flight_state={'state': 'sideways'},
            dynamic_thresh=80,
        )
        signal, path, color = result
        assert 'شراء' not in signal

        # tech_score=70 ≥ 70 → buy (relaxed OR condition)
        # Need maker_bullish or flight_up for relaxed path
        result2 = _compute_signal_final(
            tech_score=70,
            maker_state={'state': 'absorption'},
            flight_state={'state': 'sideways'},
            dynamic_thresh=80,
        )
        signal2, _, _ = result2
        assert 'شراء' in signal2

    @patch('analyzers.institutional_decision_engine.get_setting')
    def test_sell_threshold_from_settings(self, mock_gs):
        """institutional_sell_threshold reads from settings (default 25)."""
        settings = _make_settings_mock({'institutional_sell_threshold': 30})
        mock_gs.side_effect = settings

        # tech_score=29 ≤ 30 → sell
        result = _compute_signal_final(
            tech_score=29,
            maker_state={'state': 'calm'},
            flight_state={'state': 'sideways'},
            dynamic_thresh=75,
        )
        signal, _, color = result
        assert 'بيع' in signal

    @patch('analyzers.institutional_decision_engine.get_setting')
    def test_sell_threshold_default_25(self, mock_gs):
        """Default sell threshold is 25."""
        settings = _make_settings_mock({})
        mock_gs.side_effect = settings

        # tech_score=25 ≤ 25 → sell
        result = _compute_signal_final(
            tech_score=25,
            maker_state={'state': 'calm'},
            flight_state={'state': 'sideways'},
            dynamic_thresh=75,
        )
        signal, _, _ = result
        assert 'بيع' in signal

    @patch('analyzers.institutional_decision_engine.get_setting')
    def test_strong_buy_threshold_from_settings(self, mock_gs):
        """Strong buy reads base_buy_threshold from settings (default 75)."""
        # base_buy_threshold is used via _compute_self_learning_thresh
        settings = _make_settings_mock({'base_buy_threshold': 80})
        mock_gs.side_effect = settings

        # With no backtest stats, dynamic_thresh = base = 80
        dynamic_thresh, reason = _compute_self_learning_thresh(
            base_thresh=80,
            backtest_stats=None,
        )
        assert dynamic_thresh == 80


# ──────────────────────────────────────────────────────────────────────
# 3. Proof Weights Tests
# ──────────────────────────────────────────────────────────────────────

class TestProofWeights:
    """Verify proof weights are read from settings and sum correctly."""

    @patch('analyzers.institutional_decision_engine.get_setting')
    def test_proof_weights_sum(self, mock_gs):
        """All 6 proof weights should sum to 95 (10+25+13+13+12+22 EGX-optimized)."""
        settings = _make_settings_mock({})
        mock_gs.side_effect = settings

        # Build proofs where ALL are bullish to get positive weights
        proofs = _build_6_proofs(
            closes=[100, 101, 102, 103, 104, 105, 106, 107, 108, 109,
                    110, 111, 112, 113, 114, 115, 116, 117, 118, 120],
            sma200=100.0,  # close > sma200 → trend_up
            maker_state={'state': 'absorption', 'reason': 'test'},  # maker bullish
            candle_probabilities={'bias': 'bullish', 'up_prob': 70},  # dna bullish
            stock_dna={'personality_type': 'momentum_stock'},  # dna bullish
            fundamental_score=70,  # strong → above 60
            sector_change=2.0,  # positive → sector bull
            market_regime={'trend': 'bull', 'name': 'صعودي'},
            stock_roc=3.0,
            benchmark_change=1.0,  # outperforming
        )

        # Sum positive score_impacts
        total_weight = sum(abs(p['score_impact']) for p in proofs if p['passed'])
        # Default weights: 10+25+13+13+12+22 = 95 (V39.3 EGX-optimized)
        assert total_weight == 95

    @patch('analyzers.institutional_decision_engine.get_setting')
    def test_proof_weights_from_settings(self, mock_gs):
        """Each weight reads from engine_settings, not hardcoded."""
        # Custom weights: trend=25, makers=30, dna=20, fundamental=10, sector=5, benchmark=15
        settings = _make_settings_mock({
            'proof_weight_trend': 25,
            'proof_weight_makers': 30,
            'proof_weight_dna': 20,
            'proof_weight_fundamental': 10,
            'proof_weight_sector': 5,
            'proof_weight_benchmark': 15,
            'fund_score_strong': 60,
        })
        mock_gs.side_effect = settings

        proofs = _build_6_proofs(
            closes=[100, 101, 102, 103, 104, 105, 106, 107, 108, 109,
                    110, 111, 112, 113, 114, 115, 116, 117, 118, 120],
            sma200=100.0,
            maker_state={'state': 'absorption', 'reason': 'test'},
            candle_probabilities={'bias': 'bullish', 'up_prob': 70},
            stock_dna={'personality_type': 'momentum_stock'},
            fundamental_score=70,
            sector_change=2.0,
            market_regime={'trend': 'bull', 'name': 'صعودي'},
            stock_roc=3.0,
            benchmark_change=1.0,
        )

        # Check each proof reads custom weight
        by_name = {p['name']: p for p in proofs}
        assert by_name['trend']['score_impact'] == 25
        assert by_name['maker']['score_impact'] == 30
        assert by_name['dna']['score_impact'] == 20
        assert by_name['fundamentals']['score_impact'] == 10
        assert by_name['sector']['score_impact'] == 5
        assert by_name['benchmark']['score_impact'] == 15


# ──────────────────────────────────────────────────────────────────────
# 4. V39 Dynamic Features
# ──────────────────────────────────────────────────────────────────────

class TestV39DynamicFeatures:
    """Verify dynamic R:R and ATR stop multiplier behavior."""

    @patch('analyzers.institutional_decision_engine.get_setting')
    def test_dynamic_rr_outperforming(self, mock_gs):
        """When stock outperforms benchmark, uses dynamic_rr_outperform (2.0)."""
        settings = _make_settings_mock({})
        mock_gs.side_effect = settings

        # Build decision with stock outperforming benchmark
        # stock_roc=5.0 > benchmark_change=1.0 → outperforming
        result = build_institutional_decision(
            ticker='TEST',
            closes=[100]*20,
            highs=[101]*20,
            lows=[99]*20,
            opens=[100]*20,
            volumes=[1000]*20,
            rsi=50,
            atr=0.5,
            sma20=100,
            sma50=100,
            sma200=100,
            stock_roc=5.0,
            benchmark_change=1.0,
        )

        assert result['outperforming_market'] is True
        assert result['dynamic_rr1'] == 2.0

    @patch('analyzers.institutional_decision_engine.get_setting')
    def test_dynamic_rr_normal(self, mock_gs):
        """When stock doesn't outperform, uses dynamic_rr_normal (1.5)."""
        settings = _make_settings_mock({})
        mock_gs.side_effect = settings

        # stock_roc=1.0 < benchmark_change=3.0 → NOT outperforming
        result = build_institutional_decision(
            ticker='TEST',
            closes=[100]*20,
            highs=[101]*20,
            lows=[99]*20,
            opens=[100]*20,
            volumes=[1000]*20,
            rsi=50,
            atr=0.5,
            sma20=100,
            sma50=100,
            sma200=100,
            stock_roc=1.0,
            benchmark_change=3.0,
        )

        assert result['outperforming_market'] is False
        assert result['dynamic_rr1'] == 1.5

    @patch('analyzers.institutional_decision_engine.get_setting')
    def test_dynamic_rr_custom_settings(self, mock_gs):
        """Dynamic R:R values can be overridden via settings."""
        settings = _make_settings_mock({
            'dynamic_rr_outperform': 3.0,
            'dynamic_rr_normal': 2.0,
        })
        mock_gs.side_effect = settings

        # Outperforming case
        result1 = build_institutional_decision(
            ticker='TEST',
            closes=[100]*20,
            highs=[101]*20,
            lows=[99]*20,
            opens=[100]*20,
            volumes=[1000]*20,
            rsi=50,
            atr=0.5,
            stock_roc=5.0,
            benchmark_change=1.0,
        )
        assert result1['dynamic_rr1'] == 3.0

        # Normal case
        result2 = build_institutional_decision(
            ticker='TEST',
            closes=[100]*20,
            highs=[101]*20,
            lows=[99]*20,
            opens=[100]*20,
            volumes=[1000]*20,
            rsi=50,
            atr=0.5,
            stock_roc=1.0,
            benchmark_change=3.0,
        )
        assert result2['dynamic_rr1'] == 2.0

    @patch('analyzers.institutional_decision_engine.get_setting')
    def test_atr_stop_multiplier_range(self, mock_gs):
        """ATR stop multiplier should be between 1.0 and 2.5."""
        settings = _make_settings_mock({})
        mock_gs.side_effect = settings

        # Test with insufficient data → returns default 1.5
        result = _compute_dynamic_sl_mult(
            closes=[100]*5,  # < 20 bars
            highs=[101]*5,
            lows=[99]*5,
            atr_val=0.5,
        )
        assert 1.0 <= result <= 2.5

        # Test with enough data
        closes = [100 + i * 0.1 for i in range(50)]
        highs = [c + 1 for c in closes]
        lows = [c - 1 for c in closes]
        result2 = _compute_dynamic_sl_mult(
            closes=closes,
            highs=highs,
            lows=lows,
            atr_val=0.5,
        )
        assert 1.0 <= result2 <= 2.5

    @patch('analyzers.institutional_decision_engine.get_setting')
    def test_atr_stop_multiplier_high_vol(self, mock_gs):
        """High volatility (ATR percentile > 80) → multiplier 2.5."""
        settings = _make_settings_mock({})
        mock_gs.side_effect = settings

        # Create data where ATR is very high relative to history (percentile > 80)
        # Use mostly small ranges, then a very large ATR
        closes = [100.0] * 99 + [100.0]
        highs = [100.1] * 99 + [100.1]
        lows = [99.9] * 99 + [99.9]
        # ATR is huge compared to historical TRs (0.2)
        result = _compute_dynamic_sl_mult(
            closes=closes,
            highs=highs,
            lows=lows,
            atr_val=5.0,  # Very high → high percentile
        )
        assert result == 2.5

    @patch('analyzers.institutional_decision_engine.get_setting')
    def test_atr_stop_multiplier_low_vol(self, mock_gs):
        """Low volatility (ATR percentile < 20) → multiplier 1.0."""
        settings = _make_settings_mock({})
        mock_gs.side_effect = settings

        # Create data where ATR is very low relative to history (percentile < 20)
        closes = [100.0] * 50
        highs = [101.0] * 50
        lows = [99.0] * 50
        # ATR is tiny compared to historical TRs (~2.0)
        result = _compute_dynamic_sl_mult(
            closes=closes,
            highs=highs,
            lows=lows,
            atr_val=0.01,  # Very low → low percentile
        )
        assert result == 1.0


# ──────────────────────────────────────────────────────────────────────
# 5. Self-Learning Threshold
# ──────────────────────────────────────────────────────────────────────

class TestSelfLearningThreshold:
    """Verify self-learning threshold adjustments based on win rate."""

    @patch('analyzers.institutional_decision_engine.get_setting')
    def test_self_learning_adjusts_threshold(self, mock_gs):
        """When win_rate ≥ 65%, threshold decreases (model is accurate)."""
        settings = _make_settings_mock({})
        mock_gs.side_effect = settings

        base = 75.0
        backtest = {'win_rate': 70.0, 'total_trades': 50}
        dynamic_thresh, reason = _compute_self_learning_thresh(base, backtest)

        # V39.3: 70% ≥ 65% → extra=(70-65)*0.3=1.5, total_adj=10+1.5=11.5%
        # 75 - (75*0.115) = 75 - 8.625 = 66.375
        assert dynamic_thresh == 66.375
        assert 'دقيق' in reason

    @patch('analyzers.institutional_decision_engine.get_setting')
    def test_self_learning_raises_threshold(self, mock_gs):
        """When win_rate < 40%, threshold increases (model is weak)."""
        settings = _make_settings_mock({})
        mock_gs.side_effect = settings

        base = 75.0
        backtest = {'win_rate': 30.0, 'total_trades': 50}
        dynamic_thresh, reason = _compute_self_learning_thresh(base, backtest)

        # V39.3: 30% < 40% → extra=(40-30)*0.3=3.0, total_adj=10+3.0=13.0%
        # 75 + (75*0.13) = 75 + 9.75 = 84.75
        assert dynamic_thresh == 84.75
        assert 'ضعيف' in reason

    @patch('analyzers.institutional_decision_engine.get_setting')
    def test_self_learning_no_history(self, mock_gs):
        """No backtest stats → threshold stays at base."""
        settings = _make_settings_mock({})
        mock_gs.side_effect = settings

        base = 75.0
        dynamic_thresh, reason = _compute_self_learning_thresh(base, None)
        assert dynamic_thresh == 75.0

    @patch('analyzers.institutional_decision_engine.get_setting')
    def test_self_learning_insufficient_trades(self, mock_gs):
        """Fewer than min_trades (10) trades → threshold stays at base."""
        settings = _make_settings_mock({})
        mock_gs.side_effect = settings

        base = 75.0
        backtest = {'win_rate': 80.0, 'total_trades': 3}
        dynamic_thresh, reason = _compute_self_learning_thresh(base, backtest)
        assert dynamic_thresh == 75.0

    @patch('analyzers.institutional_decision_engine.get_setting')
    def test_self_learning_custom_adjustment_pct(self, mock_gs):
        """Self-learning adjustment percentage reads from settings."""
        settings = _make_settings_mock({'self_learning_adjustment_pct': 20})
        mock_gs.side_effect = settings

        base = 75.0
        backtest = {'win_rate': 70.0, 'total_trades': 50}
        dynamic_thresh, reason = _compute_self_learning_thresh(base, backtest)

        # V39.3: 20% base + extra=(70-65)*0.3=1.5 → total_adj=21.5%
        # 75 - (75 * 0.215) = 75 - 16.125 = 58.875
        assert dynamic_thresh == 58.875


# ──────────────────────────────────────────────────────────────────────
# 6. Model Quality
# ──────────────────────────────────────────────────────────────────────

class TestModelQuality:
    """Verify model quality assessment (دقيق / محتاج ضبط)."""

    def test_model_quality_accurate(self):
        """High win rate + profit factor → 'دقيق'."""
        backtest = {'win_rate': 65.0, 'profit_factor': 1.85, 'total_trades': 57}
        quality, color = _compute_model_quality(backtest)
        assert 'دقيق' in quality
        assert color == 'lime'

    def test_model_quality_needs_tuning(self):
        """Low win rate → 'محتاج ضبط'."""
        backtest = {'win_rate': 45.0, 'profit_factor': 0.9, 'total_trades': 30}
        quality, color = _compute_model_quality(backtest)
        assert 'محتاج ضبط' in quality
        assert color == 'orange'

    def test_model_quality_no_data(self):
        """No backtest stats → insufficient history."""
        quality, color = _compute_model_quality(None)
        assert 'تاريخ' in quality
        assert color == 'gray'

    def test_model_quality_zero_trades(self):
        """Zero trades → insufficient history."""
        backtest = {'win_rate': 0, 'profit_factor': 0, 'total_trades': 0}
        quality, color = _compute_model_quality(backtest)
        assert 'تاريخ' in quality
        assert color == 'gray'

    def test_model_quality_high_wr_low_pf(self):
        """High win rate but low profit factor → needs tuning."""
        backtest = {'win_rate': 65.0, 'profit_factor': 0.8, 'total_trades': 20}
        quality, color = _compute_model_quality(backtest)
        # PF 0.8 ≤ 1.2 → not accurate
        assert 'محتاج ضبط' in quality
        assert color == 'orange'

    def test_model_quality_low_wr_high_pf(self):
        """Low win rate even with high PF → needs tuning."""
        backtest = {'win_rate': 50.0, 'profit_factor': 2.0, 'total_trades': 20}
        quality, color = _compute_model_quality(backtest)
        # WR 50% < 60% → not accurate
        assert 'محتاج ضبط' in quality
        assert color == 'orange'

    def test_model_quality_boundary(self):
        """Boundary: WR=60, PF=1.21 → accurate (≥60 and >1.2)."""
        backtest = {'win_rate': 60.0, 'profit_factor': 1.21, 'total_trades': 10}
        quality, color = _compute_model_quality(backtest)
        assert 'دقيق' in quality
        assert color == 'lime'
