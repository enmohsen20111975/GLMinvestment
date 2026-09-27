"""
test_weekly_radar_report.py — اختبارات scripts/weekly_radar_report.py
=====================================================================
L2-WEEKLY-RADAR-REPORT

Tests:
  1. Report data builds with empty radar cache + no tracking (graceful degradation)
  2. JSON output is valid JSON with the expected top-level keys
  3. PDF generation produces a non-empty file (or skips gracefully if no font)
  4. PNG generation produces a non-empty file (or skips gracefully if no matplotlib)
  5. pick_top_5 dedupes by ticker + sorts by signal_count + volume_ratio
  6. compute_target_stop returns sensible T1/T2/SL based on path
  7. compute_last_week_performance handles missing current_price (status='no_data')
  8. --dry-run mode prints the report to stdout without writing files
  9. --json-only mode writes JSON but skips PDF/PNG

الـ tests دي بتشتغل بدون DB (sandbox) عشان الرادار الكاش مفيش. بتـ verify
إن الـ script بيتحمل بشكل صحيح وبيـ handle الـ empty state بـ graceful messages.

التشغيل:
    cd vps-service && python3 -m pytest tests/test_weekly_radar_report.py -v
    # or directly:
    python3 vps-service/tests/test_weekly_radar_report.py
"""
from __future__ import annotations

import json
import os
import sys
import tempfile
from datetime import datetime
from pathlib import Path

# Ensure project root is importable
_PROJECT_ROOT = Path(__file__).resolve().parents[2]
_SCRIPTS_DIR = _PROJECT_ROOT / 'scripts'
if str(_SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(_SCRIPTS_DIR))

import pytest


# ============================================================================
# Helpers
# ============================================================================
def _import_weekly_radar_report():
    """Import the module fresh (so each test gets a clean state)."""
    import importlib
    if 'weekly_radar_report' in sys.modules:
        del sys.modules['weekly_radar_report']
    mod = importlib.import_module('weekly_radar_report')
    return mod


# ============================================================================
# Tests
# ============================================================================
class TestBuildReportData:
    """Verify build_report_data produces a well-formed payload."""

    def test_build_report_data_returns_dict_with_required_keys(self):
        wr = _import_weekly_radar_report()
        payload = wr.build_report_data('EGX')

        # Top-level keys
        required_keys = [
            'generated_at', 'market', 'week_number', 'year',
            'week_start', 'week_end', 'market_regime',
            'stock_of_week', 'top_5', 'last_week_performance',
            'sector_heatmap', 'radar_cache_found', 'tracking_count',
        ]
        for k in required_keys:
            assert k in payload, f"Missing key: {k}"

    def test_build_report_data_market_propagates(self):
        wr = _import_weekly_radar_report()
        payload = wr.build_report_data('TADAWUL')
        assert payload['market'] == 'TADAWUL'

    def test_build_report_data_week_dates_in_future(self):
        """The report should target the upcoming week (not the current week)."""
        wr = _import_weekly_radar_report()
        payload = wr.build_report_data('EGX')
        week_start = datetime.fromisoformat(payload['week_start'])
        now = datetime.now()
        # Week start should be in the future (or today at worst)
        delta_days = (week_start - now).days
        assert delta_days >= -1, f"week_start {week_start} should be in the future (now={now})"

    def test_build_report_data_handles_empty_cache_gracefully(self):
        """With no radar cache + no tracking, the report should still build."""
        wr = _import_weekly_radar_report()
        # Simulate empty cache by monkey-patching
        wr.load_radar_cache = lambda market: None
        wr.load_tracking = lambda: {}
        wr.load_market_regime = lambda market: {'regime': 'NORMAL', 'regime_ar': 'عادي', 'reasons': []}
        wr.load_sector_heatmap = lambda market, top_n=5: []

        payload = wr.build_report_data('EGX')
        assert payload['radar_cache_found'] is False
        assert payload['tracking_count'] == 0
        assert payload['top_5'] == []
        assert payload['stock_of_week'] is None
        assert payload['last_week_performance']['stocks'] == []
        assert payload['sector_heatmap'] == []


class TestPickTop5:
    """Verify pick_top_5 dedupes + sorts correctly."""

    def test_pick_top_5_dedupes_by_ticker(self):
        wr = _import_weekly_radar_report()
        radar_data = {
            'pre_surge_list': [
                {'ticker': 'AMIA', 'path': 'A_pre_surge', 'current_price': 12.50,
                 'volume_ratio_10d_vs_20d': 1.85, 'price_stability': 0.85,
                 'quiet_details': {'signal_count': 6}, 'reason': 'test'},
                {'ticker': 'AMIA', 'path': 'A_pre_surge', 'current_price': 12.50,
                 'volume_ratio_10d_vs_20d': 1.85, 'price_stability': 0.85,
                 'quiet_details': {'signal_count': 6}, 'reason': 'dup'},
            ],
            'quiet_list': [
                {'ticker': 'COMI', 'path': 'B_quiet_accumulation_strong', 'current_price': 138.55,
                 'volume_ratio_10d_vs_20d': 1.42, 'price_stability': 0.78,
                 'quiet_details': {'signal_count': 5}, 'reason': 'test'},
            ],
        }
        out = wr.pick_top_5(radar_data)
        # 2 unique tickers (AMIA dup is removed)
        assert len(out) == 2
        tickers = [s['ticker'] for s in out]
        assert 'AMIA' in tickers
        assert 'COMI' in tickers

    def test_pick_top_5_returns_empty_when_no_cache(self):
        wr = _import_weekly_radar_report()
        assert wr.pick_top_5(None) == []

    def test_pick_top_5_filters_low_conviction_paths(self):
        """Only A_pre_surge + B_quiet_accumulation_strong should be picked."""
        wr = _import_weekly_radar_report()
        radar_data = {
            'pre_surge_list': [
                {'ticker': 'AMIA', 'path': 'A_pre_surge', 'current_price': 12.50,
                 'volume_ratio_10d_vs_20d': 1.85, 'price_stability': 0.85,
                 'quiet_details': {'signal_count': 6}},
            ],
            'quiet_list': [
                # Weak path — should be excluded
                {'ticker': 'WEAK', 'path': 'C_quiet_accumulation_weak', 'current_price': 5.0,
                 'volume_ratio_10d_vs_20d': 1.1, 'price_stability': 0.6,
                 'quiet_details': {'signal_count': 3}},
            ],
        }
        out = wr.pick_top_5(radar_data)
        assert len(out) == 1
        assert out[0]['ticker'] == 'AMIA'

    def test_pick_top_5_limits_to_5(self):
        wr = _import_weekly_radar_report()
        stocks = [
            {'ticker': f'STK{i}', 'path': 'A_pre_surge', 'current_price': 10.0 + i,
             'volume_ratio_10d_vs_20d': 1.5 + i * 0.1, 'price_stability': 0.7,
             'quiet_details': {'signal_count': 6 - i}}
            for i in range(8)
        ]
        radar_data = {'pre_surge_list': stocks, 'quiet_list': []}
        out = wr.pick_top_5(radar_data)
        assert len(out) == 5
        # Sorted by signal_count desc → STK0 first
        assert out[0]['ticker'] == 'STK0'


class TestComputeTargetStop:
    """Verify target/stop computation per path."""

    def test_pre_surge_uses_higher_targets(self):
        wr = _import_weekly_radar_report()
        t1, t2, sl, t1_pct, sl_pct = wr.compute_target_stop(100.0, 'A_pre_surge')
        # T1 = +16%, T2 = +30%, SL = -5%
        assert t1 == 116.0
        assert t2 == 130.0
        assert sl == 95.0
        assert t1_pct == 16.0
        assert sl_pct == -5.0

    def test_quiet_accumulation_uses_lower_targets(self):
        wr = _import_weekly_radar_report()
        t1, t2, sl, t1_pct, sl_pct = wr.compute_target_stop(100.0, 'B_quiet_accumulation_strong')
        # T1 = +10%, T2 = +20%, SL = -5%
        assert t1 == 110.0
        assert t2 == 120.0
        assert sl == 95.0
        assert t1_pct == 10.0

    def test_zero_price_returns_zeros(self):
        wr = _import_weekly_radar_report()
        t1, t2, sl, t1_pct, sl_pct = wr.compute_target_stop(0.0, 'A_pre_surge')
        assert t1 == 0.0
        assert t2 == 0.0
        assert sl == 0.0


class TestLastWeekPerformance:
    """Verify last-week performance ranking."""

    def test_handles_no_tracking_gracefully(self):
        wr = _import_weekly_radar_report()
        # No DB available on sandbox — get_current_price returns None
        out = wr.compute_last_week_performance({'ATQA': {'entryPrice': 12.5, 'entryDate': '2026-09-20'}})
        # Should return 1 entry with status='no_data' (no DB to fetch current_price)
        assert len(out) == 1
        assert out[0]['ticker'] == 'ATQA'
        assert out[0]['status'] == 'no_data'
        assert out[0]['status_emoji'] == '⏸️'

    def test_skips_invalid_entry_price(self):
        wr = _import_weekly_radar_report()
        out = wr.compute_last_week_performance({'BAD': {'entryPrice': 0, 'entryDate': '2026-09-20'}})
        # Zero entry price → skipped
        assert len(out) == 0

    def test_empty_tracking_returns_empty_list(self):
        wr = _import_weekly_radar_report()
        out = wr.compute_last_week_performance({})
        assert out == []


class TestPickStockOfWeek:
    """Verify stock-of-week selection."""

    def test_returns_none_when_no_top5(self):
        wr = _import_weekly_radar_report()
        assert wr.pick_stock_of_week([]) is None
        assert wr.pick_stock_of_week(None) is None

    def test_picks_highest_signal_count_stock(self):
        wr = _import_weekly_radar_report()
        top5 = [
            {'ticker': 'LOW', 'path': 'A_pre_surge', 'current_price': 10.0, 'signal_count': 3},
            {'ticker': 'HIGH', 'path': 'A_pre_surge', 'current_price': 20.0, 'signal_count': 6},
            {'ticker': 'MID', 'path': 'A_pre_surge', 'current_price': 15.0, 'signal_count': 4},
        ]
        sow = wr.pick_stock_of_week(top5)
        assert sow is not None
        assert sow['ticker'] == 'HIGH'
        # Should have target/stop computed
        assert 'target_1' in sow
        assert 'target_2' in sow
        assert 'stop_loss' in sow
        assert 'risk_reward' in sow


class TestMainScript:
    """Smoke-test the main() CLI entrypoint."""

    def test_dry_run_returns_zero(self, capsys):
        """--dry-run should print the report to stdout and return 0."""
        wr = _import_weekly_radar_report()
        # Simulate argv
        import sys as _sys
        original_argv = _sys.argv
        _sys.argv = ['weekly_radar_report.py', '--dry-run', '--market', 'EGX']
        try:
            rc = wr.main()
            assert rc == 0
            captured = capsys.readouterr()
            # Dry-run prints the report
            assert 'التقرير الأسبوعي للرادار' in captured.out
        finally:
            _sys.argv = original_argv

    def test_json_only_writes_valid_json(self, tmp_path, monkeypatch):
        """--json-only should write a valid JSON file."""
        wr = _import_weekly_radar_report()
        # Patch OUTPUT_DIR to a temp dir
        monkeypatch.setattr(wr, 'OUTPUT_DIR', tmp_path)
        import sys as _sys
        original_argv = _sys.argv
        _sys.argv = ['weekly_radar_report.py', '--json-only', '--market', 'EGX']
        try:
            rc = wr.main()
            assert rc == 0
            # Find the JSON file
            json_files = list(tmp_path.glob('weekly_radar_report_*.json'))
            assert len(json_files) == 1
            # Validate JSON
            data = json.loads(json_files[0].read_text(encoding='utf-8'))
            assert 'generated_at' in data
            assert 'market' in data
            assert 'week_number' in data
            assert data['market'] == 'EGX'
        finally:
            _sys.argv = original_argv


class TestGeneratePdf:
    """Smoke-test PDF generation (skip if no Arabic font)."""

    def test_generate_pdf_returns_bool(self):
        """generate_pdf should return True or False, not raise."""
        wr = _import_weekly_radar_report()
        payload = wr.build_report_data('EGX')
        with tempfile.NamedTemporaryFile(suffix='.pdf', delete=False) as f:
            pdf_path = Path(f.name)
        try:
            result = wr.generate_pdf(payload, pdf_path)
            # Result is a bool — either True (generated) or False (skipped/failed)
            assert isinstance(result, bool)
            # If True, the file should be non-empty
            if result:
                assert pdf_path.exists()
                assert pdf_path.stat().st_size > 0
        finally:
            if pdf_path.exists():
                pdf_path.unlink()


class TestGeneratePng:
    """Smoke-test PNG generation."""

    def test_generate_png_returns_bool(self):
        """generate_png should return True or False, not raise."""
        wr = _import_weekly_radar_report()
        payload = wr.build_report_data('EGX')
        with tempfile.NamedTemporaryFile(suffix='.png', delete=False) as f:
            png_path = Path(f.name)
        try:
            result = wr.generate_png(payload, png_path)
            assert isinstance(result, bool)
            if result:
                assert png_path.exists()
                assert png_path.stat().st_size > 0
        finally:
            if png_path.exists():
                png_path.unlink()


if __name__ == '__main__':
    # Allow running directly: python3 test_weekly_radar_report.py
    pytest.main([__file__, '-v'])
