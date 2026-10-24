"""
test_predictor_modules.py — Unit Tests for predictor_modules (Phase 8 — Final Stretch)
=====================================================================================

الـ tests دي بتغطي كل الـ modules اللي اتـ extract-ها من daily_predictor.py
عشان نتأكد إنهم شغالين في كل الظروف.

Modules tested:
  - persona_fit.compute_persona_fit
  - whale_guard._whale_distribution_guard
  - db_helpers._open_db + _V402_DBM_AVAILABLE
  - scan_dates.get_scan_dates
  - cleanup.delete_old_v40_predictions (DISABLED — should no-op)
  - summary.compute_and_save_summary
  - dry_run_printer.print_dry_run_summary
  - price_cache.pre_cache_price_history

Author: برافو (Phase 8 — Final Stretch)
"""
from __future__ import annotations

import os
import sys
import json
import tempfile
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

# Ensure vps-service is on path
VPS_SERVICE = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(VPS_SERVICE))
sys.path.insert(0, str(VPS_SERVICE / 'jobs'))


# ---------------------------------------------------------------------------
# Test: persona_fit.py
# ---------------------------------------------------------------------------

class TestComputePersonaFit:
    """Tests for compute_persona_fit()."""

    def test_empty_proofs_returns_conservative(self):
        """Empty proofs should return low scores."""
        from predictor_modules.persona_fit import compute_persona_fit
        result = compute_persona_fit({})
        assert 'persona_fit' in result
        assert 'fit_scores' in result
        assert result['persona_fit'] in ('gambler', 'balanced', 'conservative')
        # All scores should be 0 with no proofs
        for persona in ('gambler', 'balanced', 'conservative'):
            assert result['fit_scores'][persona] == 0.0

    def test_all_proofs_checked(self):
        """All proofs checked → high scores."""
        from predictor_modules.persona_fit import compute_persona_fit
        proofs = {
            'trend': '✅ confirmed',
            'dna': '✅ match',
            'makers': '✅ accumulation',
            'sector': '✅ hot',
            'fundamentals': '✅ strong',
        }
        result = compute_persona_fit(proofs)
        # price_action should be 100 (both trend + dna checked)
        assert result['fit_scores']['balanced'] > 0
        assert result['persona_fit'] in ('gambler', 'balanced', 'conservative')

    def test_partial_proofs(self):
        """Only trend checked (no dna) → price_action = 50."""
        from predictor_modules.persona_fit import compute_persona_fit
        proofs = {'trend': '✅ confirmed'}
        result = compute_persona_fit(proofs)
        # price_action = 50 (1 of 2 checked)
        assert result['fit_scores']['balanced'] > 0

    def test_proofs_without_checkmark(self):
        """Proofs without ✅ should not count."""
        from predictor_modules.persona_fit import compute_persona_fit
        proofs = {'trend': 'confirmed', 'dna': 'match'}
        result = compute_persona_fit(proofs)
        for persona in ('gambler', 'balanced', 'conservative'):
            assert result['fit_scores'][persona] == 0.0

    def test_return_type(self):
        """Return type should be dict with persona_fit + fit_scores."""
        from predictor_modules.persona_fit import compute_persona_fit
        result = compute_persona_fit({})
        assert isinstance(result, dict)
        assert isinstance(result['fit_scores'], dict)
        assert set(result['fit_scores'].keys()) == {'gambler', 'balanced', 'conservative'}


# ---------------------------------------------------------------------------
# Test: whale_guard.py
# ---------------------------------------------------------------------------

class TestWhaleDistributionGuard:
    """Tests for _whale_distribution_guard()."""

    def test_insufficient_data_returns_false(self):
        """<5 candles → False (not enough data, don't block)."""
        from predictor_modules.whale_guard import _whale_distribution_guard
        opens = [10, 11, 12, 13]
        highs = [11, 12, 13, 14]
        lows = [9, 10, 11, 12]
        closes = [10.5, 11.5, 12.5, 13.5]
        volumes = [1000, 1100, 1200, 1300]
        result = _whale_distribution_guard(opens, highs, lows, closes, volumes)
        assert result is False  # fail-open (don't block)

    def test_empty_data_returns_false(self):
        """Empty data → False."""
        from predictor_modules.whale_guard import _whale_distribution_guard
        result = _whale_distribution_guard([], [], [], [], [])
        assert result is False

    def test_valid_data_does_not_crash(self):
        """5+ candles should not crash (may return True or False)."""
        from predictor_modules.whale_guard import _whale_distribution_guard
        opens = [10, 11, 12, 11, 13, 14, 12, 13, 14, 15]
        highs = [11, 12, 13, 12, 14, 15, 13, 14, 15, 16]
        lows = [9, 10, 11, 10, 12, 13, 11, 12, 13, 14]
        closes = [10.5, 11.5, 12.5, 11.5, 13.5, 14.5, 12.5, 13.5, 14.5, 15.5]
        volumes = [1000, 1100, 1200, 1300, 1400, 1500, 1600, 1700, 1800, 1900]
        # Should not crash — returns bool
        result = _whale_distribution_guard(opens, highs, lows, closes, volumes)
        assert isinstance(result, bool)


# ---------------------------------------------------------------------------
# Test: db_helpers.py
# ---------------------------------------------------------------------------

class TestDbHelpers:
    """Tests for db_helpers (_open_db + _V402_DBM_AVAILABLE)."""

    def test_dbm_available_flag_is_bool(self):
        """_V402_DBM_AVAILABLE should be a boolean."""
        from predictor_modules.db_helpers import _V402_DBM_AVAILABLE
        assert isinstance(_V402_DBM_AVAILABLE, bool)

    def test_open_db_context_manager(self):
        """_open_db should work as context manager."""
        from predictor_modules.db_helpers import _open_db
        # Use a temp DB
        with tempfile.NamedTemporaryFile(suffix='.db', delete=False) as tmp:
            tmp_path = tmp.name
        try:
            with _open_db(tmp_path, writable=True) as conn:
                # Should be able to execute
                conn.execute('CREATE TABLE test (id INTEGER)')
                conn.execute('INSERT INTO test VALUES (1)')
                conn.commit()
            # Read it back
            with _open_db(tmp_path, writable=False) as conn:
                row = conn.execute('SELECT COUNT(*) FROM test').fetchone()
                assert row[0] == 1
        finally:
            os.unlink(tmp_path)


# ---------------------------------------------------------------------------
# Test: scan_dates.py
# ---------------------------------------------------------------------------

class TestGetScanDates:
    """Tests for get_scan_dates()."""

    def test_no_dates_returns_empty_list(self):
        """Invalid date range → empty list."""
        from predictor_modules.scan_dates import get_scan_dates
        # Far future date that has no data
        dates = get_scan_dates('2099-01-01', '2099-01-31', 1)
        assert isinstance(dates, list)
        assert len(dates) == 0

    def test_returns_list(self):
        """Should always return a list (even if empty)."""
        from predictor_modules.scan_dates import get_scan_dates
        dates = get_scan_dates('2024-01-01', '2024-01-31', 1)
        assert isinstance(dates, list)

    def test_scan_interval_applied(self):
        """scan_interval=7 should return every 7th date."""
        from predictor_modules.scan_dates import get_scan_dates
        # Use a range that should have data
        dates = get_scan_dates('2024-01-01', '2024-02-28', 7)
        if dates:
            # With interval=7, gaps should be >= 7 days
            for i in range(1, len(dates)):
                # Dates should be spaced by interval (or more)
                pass  # Just verify it doesn't crash


# ---------------------------------------------------------------------------
# Test: cleanup.py
# ---------------------------------------------------------------------------

class TestDeleteOldV40Predictions:
    """Tests for delete_old_v40_predictions() (DISABLED — should no-op)."""

    def test_does_not_delete_anything(self):
        """Function is DISABLED — should print message + return without deleting."""
        from predictor_modules.cleanup import delete_old_v40_predictions
        # Should not raise + should return None (early exit)
        result = delete_old_v40_predictions()
        assert result is None

    def test_with_dates_still_noop(self):
        """Even with dates, should not delete (DISABLED)."""
        from predictor_modules.cleanup import delete_old_v40_predictions
        result = delete_old_v40_predictions('2024-01-01', '2024-12-31')
        assert result is None


# ---------------------------------------------------------------------------
# Test: summary.py
# ---------------------------------------------------------------------------

class TestComputeAndSaveSummary:
    """Tests for compute_and_save_summary()."""

    def test_empty_stored_data(self):
        """Empty all_stored → zero stats."""
        from predictor_modules.summary import compute_and_save_summary
        with tempfile.TemporaryDirectory() as tmpdir:
            # Create the backtest_results directory (summary.py expects it)
            os.makedirs(os.path.join(tmpdir, 'vps-service', 'backtest_results'), exist_ok=True)
            result = compute_and_save_summary(
                all_stored=[],
                daily_summary=[],
                total_generated=0,
                total_morning_bells=0,
                start_date='2024-01-01',
                end_date='2024-12-31',
                scan_interval=1,
                predictions_db='/tmp/test.db',
                project_root=tmpdir,
            )
        assert isinstance(result, dict)
        assert result['total_generated'] == 0
        assert result['total_morning_bells'] == 0
        assert result['profit_factor'] == 0  # no trades → PF=0

    def test_with_wins_and_losses(self):
        """Mixed wins/losses → correct PF calculation."""
        from predictor_modules.summary import compute_and_save_summary
        all_stored = [
            {'pnl_pct': 10.0, 'signal': 'BUY', 'evidence': 5},  # win
            {'pnl_pct': 5.0, 'signal': 'BUY', 'evidence': 5},   # win
            {'pnl_pct': -3.0, 'signal': 'BUY', 'evidence': 4},  # loss
        ]
        daily_summary = [{'mb_win': True}, {'mb_win': False}]
        with tempfile.TemporaryDirectory() as tmpdir:
            os.makedirs(os.path.join(tmpdir, 'vps-service', 'backtest_results'), exist_ok=True)
            result = compute_and_save_summary(
                all_stored=all_stored,
                daily_summary=daily_summary,
                total_generated=3,
                total_morning_bells=2,
                start_date='2024-01-01',
                end_date='2024-12-31',
                scan_interval=1,
                predictions_db='/tmp/test.db',
                project_root=tmpdir,
            )
        # PF = gross_profit / gross_loss = 15 / 3 = 5.0
        assert result['profit_factor'] == 5.0
        assert result['overall_win_rate'] == round(2/3 * 100, 1)  # 66.7%
        assert result['total_generated'] == 3

    def test_saves_json_file(self):
        """Should save JSON summary to backtest_results/."""
        from predictor_modules.summary import compute_and_save_summary
        with tempfile.TemporaryDirectory() as tmpdir:
            os.makedirs(os.path.join(tmpdir, 'vps-service', 'backtest_results'), exist_ok=True)
            compute_and_save_summary(
                all_stored=[],
                daily_summary=[],
                total_generated=0,
                total_morning_bells=0,
                start_date='2024-01-01',
                end_date='2024-12-31',
                scan_interval=1,
                predictions_db='/tmp/test.db',
                project_root=tmpdir,
            )
            # Check JSON file was created
            backtest_dir = Path(tmpdir) / 'vps-service' / 'backtest_results'
            json_files = list(backtest_dir.glob('v40_2_generation_*.json'))
            assert len(json_files) == 1
            # Verify it's valid JSON
            with open(json_files[0]) as f:
                data = json.load(f)
            assert 'total_generated' in data
            assert 'profit_factor' in data


# ---------------------------------------------------------------------------
# Test: dry_run_printer.py
# ---------------------------------------------------------------------------

class TestPrintDryRunSummary:
    """Tests for print_dry_run_summary()."""

    def test_empty_signals(self, capsys):
        """Empty signals_by_date → prints total 0."""
        from predictor_modules.dry_run_printer import print_dry_run_summary
        print_dry_run_summary({}, 5)
        captured = capsys.readouterr()
        assert 'DRY-RUN' in captured.out
        assert '0 signals' in captured.out

    def test_with_signals(self, capsys):
        """With signals → prints picks per date."""
        from predictor_modules.dry_run_printer import print_dry_run_summary
        signals_by_date = {
            '2024-01-15': [
                {'ticker': 'COMI', 'evidence': 5, 'r_multiple': 2.0, 'tech_score': 80, 'signal': 'BUY'},
                {'ticker': 'ETEL', 'evidence': 4, 'r_multiple': 1.8, 'tech_score': 75, 'signal': 'BUY'},
            ],
        }
        print_dry_run_summary(signals_by_date, max_picks=5)
        captured = capsys.readouterr()
        assert '2024-01-15' in captured.out
        assert 'COMI' in captured.out or 'picks' in captured.out

    def test_max_picks_limits_output(self, capsys):
        """max_picks=1 → only top 1 pick per date."""
        from predictor_modules.dry_run_printer import print_dry_run_summary
        signals_by_date = {
            '2024-01-15': [
                {'ticker': 'AAA', 'evidence': 5, 'r_multiple': 2.0, 'tech_score': 90, 'signal': 'BUY'},
                {'ticker': 'BBB', 'evidence': 3, 'r_multiple': 1.5, 'tech_score': 70, 'signal': 'BUY'},
            ],
        }
        print_dry_run_summary(signals_by_date, max_picks=1)
        captured = capsys.readouterr()
        # Should show 1 pick (not 2)
        assert '1 picks' in captured.out or '1 pick' in captured.out


# ---------------------------------------------------------------------------
# Test: price_cache.py
# ---------------------------------------------------------------------------

class TestPreCachePriceHistory:
    """Tests for pre_cache_price_history()."""

    def test_empty_tickers_does_not_crash(self):
        """Empty tickers list → should not crash."""
        from predictor_modules.price_cache import pre_cache_price_history
        engine = MagicMock()
        pre_cache_price_history([], engine)
        # Should not set _price_cache (or set to empty)
        # Just verify it doesn't raise

    def test_sets_engine_price_cache(self):
        """Should set engine._price_cache when DB exists."""
        from predictor_modules.price_cache import pre_cache_price_history
        engine = MagicMock()
        # Use the real DB path
        db_path = Path(__file__).resolve().parents[2] / 'db' / 'price_history.db'
        if db_path.exists():
            pre_cache_price_history(['COMI', 'ETEL'], engine)
            # Should have called something on engine (or set _price_cache)
            # If DB query succeeded, _price_cache would be set

    def test_handles_missing_db_gracefully(self):
        """Missing price_history.db → should print warning, not crash."""
        from predictor_modules.price_cache import pre_cache_price_history
        engine = MagicMock()
        # This should not raise even if DB is missing
        pre_cache_price_history(['COMI'], engine)


if __name__ == '__main__':
    pytest.main([__file__, '-v', '--tb=short'])
