"""
dry_run_printer.py — Strangler Pattern module (Phase 8.2)
=========================================================
Extracted from `vps-service/jobs/daily_predictor.py` run_generator()
(the dry-run block — lines ~3757-3767).

Prints what would have been generated when --dry-run is active.
Behavior is 100% equivalent (Strangler Pattern).
"""
from __future__ import annotations


def print_dry_run_summary(signals_by_date, max_picks):
    """Print a per-date summary of the picks that WOULD have been stored.

    Args:
        signals_by_date: dict[scan_date] → list[signal dict]. Each signal has
            'ticker', 'evidence', 'r_multiple', 'tech_score' (used for sorting).
        max_picks: int — top-N picks to show per date.

    Returns:
        None (this function only prints).
    """
    total_signals = sum(len(v) for v in signals_by_date.values())
    print(f"🔍 DRY-RUN: would have generated {total_signals} signals across {len(signals_by_date)} dates.", flush=True)
    # Still print the summary of what would have been picked
    for scan_date in sorted(signals_by_date.keys()):
        day_signals = signals_by_date[scan_date]
        day_signals.sort(key=lambda x: (-x['evidence'], -x['r_multiple'], -x['tech_score']))
        picks = day_signals[:max_picks]
        mb = picks[0] if picks else None
        print(f"  📅 {scan_date}: {len(picks)} picks | MB={mb['ticker'] if mb else '-'} (ev={mb['evidence'] if mb else 0})", flush=True)
    return None
