"""
predictor_modules/ — Strangler Pattern extractions from daily_predictor.py
==========================================================================
(Phase 7.2 — Modularization)

The mega-file `daily_predictor.py` (4,986 LOC) is being incrementally
decomposed into focused modules. Each function extracted here is copied
verbatim from `daily_predictor.py` and the original is replaced with a
re-export. This preserves 100% semantic equivalence (Strangler Pattern).

Modules:
    persona_fit     — compute_persona_fit() (evidence → persona fit scores)
    whale_guard     — _whale_distribution_guard() (whale flow filter)
    db_helpers       — _open_db() context manager + _V402_DBM_AVAILABLE flag
    scan_dates       — get_scan_dates() (price_history PRIMARY + fallbacks)
    cleanup           — delete_old_v40_predictions() (DISABLED — Rule 35 + 27)

Phase 8.2 additions:
    summary           — compute_and_save_summary() (PF + win rate + JSON)
    dry_run_printer   — print_dry_run_summary() (dry-run output)
    price_cache       — pre_cache_price_history() (BRAVO-SPEED-FIX batch)

API guarantee:
    Every name re-exported here MUST stay in sync with `daily_predictor.py`.
    The original `daily_predictor.py` imports these names so callers don't
    see any change (backward compatible).
"""
