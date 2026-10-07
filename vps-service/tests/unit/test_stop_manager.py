"""
Unit tests for portfolio/stop_manager.py
========================================

Tests cover all stop types: Fixed, Time, Volatility, Trailing, Tiered,
Portfolio Heat, Break-Even, and the Optimal stop selector.

All external dependencies (engine_settings._get_setting) are mocked —
no database or network required.
"""

from __future__ import annotations

import math
from datetime import datetime, timedelta
from unittest.mock import patch, MagicMock

import pytest

from portfolio.stop_manager import (
    StopLossManager,
    StopType,
    StopResult,
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _make_settings_mock(mapping: dict):
    """Return a mock _get_setting callable that reads from *mapping*."""
    def _mock_get_setting(key, default=None):
        return mapping.get(key, default)
    return _mock_get_setting


# Default engine_settings values used across the codebase
_DEFAULT_SETTINGS = {
    'default_stop_pct': 5.0,
    'position_max_stop_pct': 10.0,
    'volatility_stop_atr_mult': 2.5,
    'trailing_stop_atr_mult': 2.0,
    'trailing_stop_activation_gain': 2.0,
    'time_stop_days': 45,
    'tiered_stop_before_t1_pct': 8.0,
    'max_portfolio_heat_pct': 2.0,
    'breakeven_trigger_pct': 7.0,
}


# ===========================================================================
# 1. Constructor Tests
# ===========================================================================

class TestConstructor:
    """StopLossManager reads defaults from engine_settings."""

    @patch('portfolio.stop_manager._get_setting')
    def test_default_values_from_engine_settings(self, mock_gs):
        """When no explicit params given, values come from _get_setting."""
        mock_gs.side_effect = _make_settings_mock(_DEFAULT_SETTINGS)

        mgr = StopLossManager()

        assert mgr.default_stop_pct == 5.0
        assert mgr.max_stop_pct == 10.0
        assert mgr.atr_multiplier == 2.5
        assert mgr.trailing_atr_multiplier == 2.0
        assert mgr.time_stop_days == 45

        # Verify _get_setting was called with the right keys
        called_keys = [call.args[0] for call in mock_gs.call_args_list]
        assert 'default_stop_pct' in called_keys
        assert 'position_max_stop_pct' in called_keys
        assert 'volatility_stop_atr_mult' in called_keys
        assert 'trailing_stop_atr_mult' in called_keys
        assert 'time_stop_days' in called_keys

    @patch('portfolio.stop_manager._get_setting')
    def test_explicit_values_override_settings(self, mock_gs):
        """Explicit constructor params take precedence over _get_setting."""
        mock_gs.side_effect = _make_settings_mock(_DEFAULT_SETTINGS)

        mgr = StopLossManager(
            default_stop_pct=3.0,
            max_stop_pct=8.0,
            atr_multiplier=1.5,
            trailing_atr_multiplier=1.0,
            time_stop_days=30,
        )

        assert mgr.default_stop_pct == 3.0
        assert mgr.max_stop_pct == 8.0
        assert mgr.atr_multiplier == 1.5
        assert mgr.trailing_atr_multiplier == 1.0
        assert mgr.time_stop_days == 30

    @patch('portfolio.stop_manager._get_setting')
    def test_fallback_when_settings_unavailable(self, mock_gs):
        """When _get_setting returns defaults (import failed), fallback values used."""
        # Simulate engine_settings unavailable — always returns the default arg
        mock_gs.side_effect = lambda key, default=None: default

        mgr = StopLossManager()

        assert mgr.default_stop_pct == 5.0
        assert mgr.max_stop_pct == 10.0
        assert mgr.atr_multiplier == 2.5
        assert mgr.trailing_atr_multiplier == 2.0
        assert mgr.time_stop_days == 45


# ===========================================================================
# 2. Fixed Stop Tests
# ===========================================================================

class TestFixedStop:

    @patch('portfolio.stop_manager._get_setting')
    def test_fixed_stop_calculation(self, mock_gs):
        """entry=100, stop_pct=5 -> stop_price=95"""
        mock_gs.side_effect = _make_settings_mock(_DEFAULT_SETTINGS)
        mgr = StopLossManager()

        result = mgr.calculate_fixed_stop(entry_price=100.0, stop_pct=5.0)

        assert result.stop_type == StopType.FIXED
        assert result.stop_price == pytest.approx(95.0)
        assert result.distance_pct == pytest.approx(5.0)
        assert result.triggered is False

    @patch('portfolio.stop_manager._get_setting')
    def test_fixed_stop_max_cap(self, mock_gs):
        """Stop_pct cannot exceed max_stop_pct (10%)."""
        mock_gs.side_effect = _make_settings_mock(_DEFAULT_SETTINGS)
        mgr = StopLossManager()

        # Request 15% stop but max is 10%
        result = mgr.calculate_fixed_stop(entry_price=100.0, stop_pct=15.0)

        assert result.distance_pct == pytest.approx(10.0)  # capped
        assert result.stop_price == pytest.approx(90.0)

    @patch('portfolio.stop_manager._get_setting')
    def test_fixed_stop_uses_default_when_no_pct_given(self, mock_gs):
        """When stop_pct is None/0, use default_stop_pct from settings."""
        mock_gs.side_effect = _make_settings_mock(_DEFAULT_SETTINGS)
        mgr = StopLossManager(default_stop_pct=6.0)

        result = mgr.calculate_fixed_stop(entry_price=100.0)

        assert result.stop_price == pytest.approx(94.0)  # 100 * (1 - 6/100)


# ===========================================================================
# 3. Time Stop Tests
# ===========================================================================

class TestTimeStop:

    @patch('portfolio.stop_manager._get_setting')
    def test_time_stop_not_triggered(self, mock_gs):
        """10 days < 45 max_days -> not triggered."""
        mock_gs.side_effect = _make_settings_mock(_DEFAULT_SETTINGS)
        mgr = StopLossManager()

        entry_date = datetime(2025, 1, 1)
        current_date = datetime(2025, 1, 11)  # 10 days

        result = mgr.calculate_time_stop(
            entry_price=100.0,
            entry_date=entry_date,
            current_price=101.0,
            current_date=current_date,
        )

        assert result.triggered is False
        assert result.details['days_held'] == 10

    @patch('portfolio.stop_manager._get_setting')
    def test_time_stop_triggered(self, mock_gs):
        """50 days with <3% movement -> triggered (dead money)."""
        mock_gs.side_effect = _make_settings_mock(_DEFAULT_SETTINGS)
        mgr = StopLossManager()

        entry_date = datetime(2025, 1, 1)
        current_date = datetime(2025, 2, 20)  # 50 days

        result = mgr.calculate_time_stop(
            entry_price=100.0,
            entry_date=entry_date,
            current_price=101.0,  # only 1% movement
            current_date=current_date,
        )

        assert result.triggered is True
        assert result.details['days_held'] == 50
        assert abs(result.details['price_change_pct']) < 3.0

    @patch('portfolio.stop_manager._get_setting')
    def test_time_stop_not_triggered_with_movement(self, mock_gs):
        """50 days but >3% movement -> not triggered."""
        mock_gs.side_effect = _make_settings_mock(_DEFAULT_SETTINGS)
        mgr = StopLossManager()

        entry_date = datetime(2025, 1, 1)
        current_date = datetime(2025, 2, 20)  # 50 days

        result = mgr.calculate_time_stop(
            entry_price=100.0,
            entry_date=entry_date,
            current_price=105.0,  # 5% movement > 3% threshold
            current_date=current_date,
        )

        assert result.triggered is False

    @patch('portfolio.stop_manager._get_setting')
    def test_time_stop_custom_max_days(self, mock_gs):
        """Custom max_days override works."""
        mock_gs.side_effect = _make_settings_mock(_DEFAULT_SETTINGS)
        mgr = StopLossManager()

        entry_date = datetime(2025, 1, 1)
        current_date = datetime(2025, 1, 11)  # 10 days

        result = mgr.calculate_time_stop(
            entry_price=100.0,
            entry_date=entry_date,
            current_price=101.0,
            current_date=current_date,
            max_days=10,  # exactly at the boundary
        )

        assert result.triggered is True  # 10 days >= 10 max_days with <3% move


# ===========================================================================
# 4. Volatility Stop Tests
# ===========================================================================

class TestVolatilityStop:

    @patch('portfolio.stop_manager._get_setting')
    def test_volatility_stop_calculation(self, mock_gs):
        """entry=100, ATR=2, mult=2.5 -> stop = 100 - 2.5*2 = 95."""
        mock_gs.side_effect = _make_settings_mock(_DEFAULT_SETTINGS)
        mgr = StopLossManager()

        result = mgr.calculate_volatility_stop(
            entry_price=100.0,
            atr=2.0,
        )

        assert result.stop_type == StopType.VOLATILITY
        assert result.stop_price == pytest.approx(95.0)
        assert result.distance_pct == pytest.approx(5.0)

    @patch('portfolio.stop_manager._get_setting')
    def test_volatility_stop_max_cap(self, mock_gs):
        """Stop cannot go below entry * (1 - max_stop_pct/100)."""
        mock_gs.side_effect = _make_settings_mock(_DEFAULT_SETTINGS)
        mgr = StopLossManager()

        # ATR=10, mult=2.5 -> raw stop = 100 - 25 = 75, but max is 10% -> 90
        result = mgr.calculate_volatility_stop(
            entry_price=100.0,
            atr=10.0,
        )

        # max_stop_price = 100 * (1 - 10/100) = 90
        assert result.stop_price == pytest.approx(90.0)
        assert result.distance_pct == pytest.approx(10.0)

    @patch('portfolio.stop_manager._get_setting')
    def test_volatility_stop_triggered_when_price_at_stop(self, mock_gs):
        """Triggered when current_price <= stop_price."""
        mock_gs.side_effect = _make_settings_mock(_DEFAULT_SETTINGS)
        mgr = StopLossManager()

        result = mgr.calculate_volatility_stop(
            entry_price=100.0,
            atr=2.0,
            current_price=94.0,  # below stop of 95
        )

        assert result.triggered is True


# ===========================================================================
# 5. Trailing Stop Tests (with activation gain)
# ===========================================================================

class TestTrailingStop:

    @patch('portfolio.stop_manager._get_setting')
    def test_trailing_stop_not_active_below_gain(self, mock_gs):
        """Gain < 3% -> returns fixed stop, not trailing."""
        mock_gs.side_effect = _make_settings_mock(_DEFAULT_SETTINGS)
        mgr = StopLossManager()

        # entry=100, current=101 -> gain = 1% < 3% threshold
        result = mgr.calculate_trailing_stop(
            highest_high=102.0,
            atr=1.5,
            current_price=101.0,
            entry_price=100.0,
        )

        assert result.stop_type == StopType.TRAILING
        assert result.details['active'] is False
        # Should return fixed stop (entry * (1 - default_stop_pct/100))
        assert result.stop_price == pytest.approx(95.0)

    @patch('portfolio.stop_manager._get_setting')
    def test_trailing_stop_active_above_gain(self, mock_gs):
        """Gain >= 3% -> calculates proper trailing stop."""
        mock_gs.side_effect = _make_settings_mock(_DEFAULT_SETTINGS)
        mgr = StopLossManager()

        # entry=100, current=105 -> gain = 5% >= 3% threshold
        # trailing_stop = highest_high - trailing_atr_mult * ATR = 108 - 2.0*1.5 = 105
        result = mgr.calculate_trailing_stop(
            highest_high=108.0,
            atr=1.5,
            current_price=105.0,
            entry_price=100.0,
        )

        assert result.details['active'] is True
        assert result.stop_price == pytest.approx(105.0)  # 108 - 2.0*1.5

    @patch('portfolio.stop_manager._get_setting')
    def test_trailing_stop_never_below_entry(self, mock_gs):
        """Trailing stop never goes below entry price."""
        mock_gs.side_effect = _make_settings_mock(_DEFAULT_SETTINGS)
        mgr = StopLossManager()

        # highest_high=104, ATR=10, mult=2.0 -> raw = 104 - 20 = 84 (below entry=100)
        # Should be clamped to entry * 1.01 = 101
        result = mgr.calculate_trailing_stop(
            highest_high=104.0,
            atr=10.0,
            current_price=105.0,
            entry_price=100.0,
        )

        assert result.details['active'] is True
        assert result.stop_price == pytest.approx(101.0)  # entry * 1.01

    @patch('portfolio.stop_manager._get_setting')
    def test_trailing_stop_custom_activation_gain(self, mock_gs):
        """Custom activation_gain_pct parameter overrides engine_settings."""
        mock_gs.side_effect = _make_settings_mock(_DEFAULT_SETTINGS)
        mgr = StopLossManager()

        # gain = 4%, custom threshold = 5% -> not active
        result = mgr.calculate_trailing_stop(
            highest_high=106.0,
            atr=1.0,
            current_price=104.0,
            entry_price=100.0,
            activation_gain_pct=5.0,
        )

        assert result.details['active'] is False


# ===========================================================================
# 6. Tiered Stop Tests (with engine_settings thresholds)
# ===========================================================================

class TestTieredStop:

    @patch('portfolio.stop_manager._get_setting')
    def test_tiered_stop_before_t1(self, mock_gs):
        """Before T1: uses tiered_stop_before_t1_pct (8%) from settings."""
        mock_gs.side_effect = _make_settings_mock(_DEFAULT_SETTINGS)
        mgr = StopLossManager()

        # current=102 < target_1=110 -> before T1
        result = mgr.calculate_tiered_stop(
            entry_price=100.0,
            current_price=102.0,
            target_1=110.0,
        )

        assert result.details['phase'] == 'before_target_1'
        # stop = 100 * (1 - 8/100) = 92
        assert result.stop_price == pytest.approx(92.0)
        assert result.details['initial_stop_pct'] == 8.0

    @patch('portfolio.stop_manager._get_setting')
    def test_tiered_stop_after_t1(self, mock_gs):
        """After T1: breakeven + 1%."""
        mock_gs.side_effect = _make_settings_mock(_DEFAULT_SETTINGS)
        mgr = StopLossManager()

        # current=115 > target_1=110, target_2=120 -> between T1 and T2
        result = mgr.calculate_tiered_stop(
            entry_price=100.0,
            current_price=115.0,
            target_1=110.0,
            target_2=120.0,
        )

        assert result.details['phase'] == 'after_target_1'
        # stop = entry * 1.01 = 101
        assert result.stop_price == pytest.approx(101.0)

    @patch('portfolio.stop_manager._get_setting')
    def test_tiered_stop_after_t2(self, mock_gs):
        """After T2: target_1 + 1%."""
        mock_gs.side_effect = _make_settings_mock(_DEFAULT_SETTINGS)
        mgr = StopLossManager()

        # current=125 > target_2=120, target_3=130 -> between T2 and T3
        result = mgr.calculate_tiered_stop(
            entry_price=100.0,
            current_price=125.0,
            target_1=110.0,
            target_2=120.0,
            target_3=130.0,
        )

        assert result.details['phase'] == 'after_target_2'
        # stop = target_1 * 1.01 = 111.1
        assert result.stop_price == pytest.approx(111.1)

    @patch('portfolio.stop_manager._get_setting')
    def test_tiered_stop_after_all_targets(self, mock_gs):
        """After all targets: trailing from last target."""
        mock_gs.side_effect = _make_settings_mock(_DEFAULT_SETTINGS)
        mgr = StopLossManager()

        # current=135 > target_3=130 -> after all targets
        result = mgr.calculate_tiered_stop(
            entry_price=100.0,
            current_price=135.0,
            target_1=110.0,
            target_2=120.0,
            target_3=130.0,
        )

        assert result.details['phase'] == 'after_all_targets'
        # stop = target_2 * 1.01 = 121.2
        assert result.stop_price == pytest.approx(121.2)

    @patch('portfolio.stop_manager._get_setting')
    def test_tiered_stop_custom_initial_stop_pct(self, mock_gs):
        """Custom initial_stop_pct overrides engine_settings."""
        mock_gs.side_effect = _make_settings_mock(_DEFAULT_SETTINGS)
        mgr = StopLossManager()

        result = mgr.calculate_tiered_stop(
            entry_price=100.0,
            current_price=102.0,
            target_1=110.0,
            initial_stop_pct=6.0,
        )

        # stop = 100 * (1 - 6/100) = 94
        assert result.stop_price == pytest.approx(94.0)
        assert result.details['initial_stop_pct'] == 6.0


# ===========================================================================
# 7. Portfolio Heat Stop Tests
# ===========================================================================

class TestPortfolioHeatStop:

    @patch('portfolio.stop_manager._get_setting')
    def test_portfolio_heat_from_settings(self, mock_gs):
        """max_heat_pct reads from engine_settings (2%)."""
        mock_gs.side_effect = _make_settings_mock(_DEFAULT_SETTINGS)
        mgr = StopLossManager()

        result = mgr.calculate_portfolio_heat_stop(
            portfolio_value=100000.0,
            position_value=10000.0,
        )

        assert result.details['max_heat_pct'] == 2.0

    @patch('portfolio.stop_manager._get_setting')
    def test_portfolio_heat_calculation(self, mock_gs):
        """Correct max_stop_pct calculation."""
        mock_gs.side_effect = _make_settings_mock(_DEFAULT_SETTINGS)
        mgr = StopLossManager()

        # portfolio=100000, position=10000, heat=2%
        # max_loss_amount = 100000 * 0.02 = 2000
        # max_stop_pct = (2000 / 10000) * 100 = 20%
        # capped by max_stop_pct=10% -> 10%
        result = mgr.calculate_portfolio_heat_stop(
            portfolio_value=100000.0,
            position_value=10000.0,
        )

        assert result.details['max_loss_amount'] == pytest.approx(2000.0)
        # min(20%, 10%) = 10%
        assert result.distance_pct == pytest.approx(10.0)

    @patch('portfolio.stop_manager._get_setting')
    def test_portfolio_heat_custom_max_heat(self, mock_gs):
        """Custom max_heat_pct overrides engine_settings."""
        mock_gs.side_effect = _make_settings_mock(_DEFAULT_SETTINGS)
        mgr = StopLossManager()

        # Custom heat=1% -> max_loss = 100000*0.01=1000, max_stop=(1000/10000)*100=10%
        result = mgr.calculate_portfolio_heat_stop(
            portfolio_value=100000.0,
            position_value=10000.0,
            max_heat_pct=1.0,
        )

        assert result.details['max_heat_pct'] == 1.0
        assert result.details['max_loss_amount'] == pytest.approx(1000.0)


# ===========================================================================
# 8. Break-Even Stop Tests
# ===========================================================================

class TestBreakEvenStop:

    @patch('portfolio.stop_manager._get_setting')
    def test_breakeven_from_settings(self, mock_gs):
        """trigger_pct reads from engine_settings (7%)."""
        mock_gs.side_effect = _make_settings_mock(_DEFAULT_SETTINGS)
        mgr = StopLossManager()

        # current=105, entry=100 -> return=5% < 7% -> not yet active
        result = mgr.calculate_break_even_stop(
            entry_price=100.0,
            current_price=105.0,
        )

        assert result.details['trigger_pct'] == 7.0

    @patch('portfolio.stop_manager._get_setting')
    def test_breakeven_not_yet_active(self, mock_gs):
        """Return < 7% -> not active, stop_price = entry."""
        mock_gs.side_effect = _make_settings_mock(_DEFAULT_SETTINGS)
        mgr = StopLossManager()

        result = mgr.calculate_break_even_stop(
            entry_price=100.0,
            current_price=105.0,  # 5% return < 7% threshold
        )

        assert result.stop_price == pytest.approx(100.0)  # entry price
        assert 'will activate' in result.message

    @patch('portfolio.stop_manager._get_setting')
    def test_breakeven_active(self, mock_gs):
        """Return >= 7% -> active at entry + buffer (default 1%)."""
        mock_gs.side_effect = _make_settings_mock(_DEFAULT_SETTINGS)
        mgr = StopLossManager()

        result = mgr.calculate_break_even_stop(
            entry_price=100.0,
            current_price=108.0,  # 8% return >= 7% threshold
        )

        # stop_price = entry * (1 + buffer/100) = 100 * 1.01 = 101
        assert result.stop_price == pytest.approx(101.0)
        assert 'active' in result.message

    @patch('portfolio.stop_manager._get_setting')
    def test_breakeven_custom_trigger_pct(self, mock_gs):
        """Custom trigger_pct overrides engine_settings."""
        mock_gs.side_effect = _make_settings_mock(_DEFAULT_SETTINGS)
        mgr = StopLossManager()

        # Custom trigger=5%, return=6% -> active
        result = mgr.calculate_break_even_stop(
            entry_price=100.0,
            current_price=106.0,
            trigger_pct=5.0,
        )

        assert result.stop_price == pytest.approx(101.0)
        assert result.details['trigger_pct'] == 5.0


# ===========================================================================
# 9. Optimal Stop Tests
# ===========================================================================

class TestOptimalStop:

    @patch('portfolio.stop_manager._get_setting')
    def test_get_optimal_stop_atr_preferred(self, mock_gs):
        """ATR stop preferred over fixed when tighter (closer to price)."""
        mock_gs.side_effect = _make_settings_mock(_DEFAULT_SETTINGS)
        mgr = StopLossManager()

        # Fixed stop at 8%: 100 * 0.92 = 92
        # ATR stop: entry=100, ATR=1, mult=2.5 -> 100 - 2.5 = 97.5
        # ATR stop (97.5) > Fixed stop (92) -> ATR is tighter -> preferred
        result = mgr.get_optimal_stop(
            entry_price=100.0,
            current_price=101.0,
            atr=1.0,
            persona_stop_pct=8.0,
        )

        assert result['optimal_stop']['stop_type'] == 'volatility'
        assert result['optimal_stop']['stop_price'] == pytest.approx(97.5)

    @patch('portfolio.stop_manager._get_setting')
    def test_get_optimal_stop_fallback(self, mock_gs):
        """Falls back to fixed when no ATR provided."""
        mock_gs.side_effect = _make_settings_mock(_DEFAULT_SETTINGS)
        mgr = StopLossManager()

        result = mgr.get_optimal_stop(
            entry_price=100.0,
            current_price=101.0,
            atr=None,
            persona_stop_pct=8.0,
        )

        assert result['optimal_stop']['stop_type'] == 'fixed'
        assert result['optimal_stop']['stop_price'] == pytest.approx(92.0)

    @patch('portfolio.stop_manager._get_setting')
    def test_get_optimal_stop_returns_all_stops(self, mock_gs):
        """get_optimal_stop includes all calculated stops."""
        mock_gs.side_effect = _make_settings_mock(_DEFAULT_SETTINGS)
        mgr = StopLossManager()

        result = mgr.get_optimal_stop(
            entry_price=100.0,
            current_price=101.0,
            persona_stop_pct=8.0,
        )

        assert 'all_stops' in result
        assert 'recommendation' in result
        # At minimum: fixed + breakeven
        assert len(result['all_stops']) >= 2


# ===========================================================================
# 10. Integration: Settings Consistency
# ===========================================================================

class TestSettingsConsistency:
    """Verify that engine_settings defaults produce consistent behavior."""

    @patch('portfolio.stop_manager._get_setting')
    def test_tiered_stop_matches_default_stop_pct_when_no_override(self, mock_gs):
        """When no override, tiered stop before T1 uses tiered_stop_before_t1_pct from settings."""
        mock_gs.side_effect = _make_settings_mock(_DEFAULT_SETTINGS)
        mgr = StopLossManager()

        result = mgr.calculate_tiered_stop(
            entry_price=100.0,
            current_price=102.0,
            target_1=110.0,
        )

        # Default tiered_stop_before_t1_pct = 8.0
        assert result.details['initial_stop_pct'] == 8.0
        assert result.stop_price == pytest.approx(92.0)

    @patch('portfolio.stop_manager._get_setting')
    def test_trailing_stop_atr_mult_matches_backtest(self, mock_gs):
        """trailing_stop_atr_mult same default as backtest (2.0)."""
        mock_gs.side_effect = _make_settings_mock(_DEFAULT_SETTINGS)
        mgr = StopLossManager()

        # The constructor should have read trailing_stop_atr_mult = 2.0
        assert mgr.trailing_atr_multiplier == 2.0

    @patch('portfolio.stop_manager._get_setting')
    def test_volatility_stop_atr_mult_matches_backtest(self, mock_gs):
        """volatility_stop_atr_mult same default as backtest (2.5)."""
        mock_gs.side_effect = _make_settings_mock(_DEFAULT_SETTINGS)
        mgr = StopLossManager()

        assert mgr.atr_multiplier == 2.5

    @patch('portfolio.stop_manager._get_setting')
    def test_stop_result_to_dict(self, mock_gs):
        """StopResult.to_dict() produces valid dict with rounded values."""
        mock_gs.side_effect = _make_settings_mock(_DEFAULT_SETTINGS)
        mgr = StopLossManager()

        result = mgr.calculate_fixed_stop(entry_price=100.0, stop_pct=5.0)
        d = result.to_dict()

        assert isinstance(d, dict)
        assert d['stop_type'] == 'fixed'
        assert 'stop_price' in d
        assert 'distance_pct' in d
        assert 'triggered' in d
        assert 'message' in d
        assert 'message_ar' in d
        assert 'details' in d
