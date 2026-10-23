"""
cleanup.py — Strangler Pattern module (Phase 7.2)
==================================================
Extracted VERBATIM from `vps-service/jobs/daily_predictor.py` (lines ~575-632).
The original function `delete_old_v40_predictions()` is re-exported by
daily_predictor.py so callers see no behavior change.

🔴 DISABLED (2026-10-12 — PRODUCTION-AUDIT):
    This function is DISABLED. It used to delete legit V40.2 predictions.
    Per Rule 35 (ENGINE-UNIFY) + Rule 27 (NO-FAKE-DATA) + Rule 67
    (ROOT-CAUSE-FIRST), V40.2 predictions must NEVER be deleted — they
    are the canonical truth.

    The dead code below the early-return is preserved for audit trail
    (Rule 16 VERIFY-BEFORE-DELETE). The sqlite3.connect() call inside
    the dead code path is unreachable but kept for reference.
"""
from __future__ import annotations

# PREDICTIONS_DB is defined by the caller (daily_predictor.py imports it
# from this module). We use a module-level placeholder so the dead-code
# reference doesn't fail at import time. The caller overrides it.
PREDICTIONS_DB = None  # overridden by daily_predictor.py at import time


def delete_old_v40_predictions(start_date=None, end_date=None):
    """Delete previous V40 historical predictions to avoid duplicates.

    If start_date/end_date provided, only delete predictions in that range.
    Otherwise, delete ALL V40 predictions.

    🔴 DISABLED (2026-10-12 — PRODUCTION-AUDIT):
    This function DELETES legit V40.2 predictions (WHERE kill_filter_result
    LIKE 'V40 evidence%') — the ONLY sanctioned predictions! It leaves rogue
    predictions (evidence=0, kill_filter empty) untouched.

    Production evidence: sanctioned=10 on production (was 38 in sample) →
    28 legit V40.2 predictions were DELETED by this function.

    Per Rule 35 (ENGINE-UNIFY) + Rule 27 (NO-FAKE-DATA) + Rule 67
    (ROOT-CAUSE-FIRST): this function is disabled. V40.2 predictions must
    NEVER be deleted — they are the canonical truth.

    To re-enable (NOT RECOMMENDED): remove the early-return below.
    """
    print(
        "[RULE35-DISABLED] delete_old_v40_predictions() — BLOCKED. "
        "This function deletes legit V40.2 predictions (the only sanctioned ones). "
        "Rule 35 (ENGINE-UNIFY) + Rule 27 (NO-FAKE-DATA).",
        flush=True,
    )
    return  # safe exit — do NOT delete anything

    # ─── ORIGINAL CODE BELOW — preserved for reference (Rule 16 VERIFY-BEFORE-DELETE) ───
    # The block below is unreachable (early-return above). Kept for audit trail.
    # Imports + DB access preserved verbatim — they would only execute if the
    # early-return above were removed.
    import sqlite3  # local import — only needed if dead code is reactivated
    try:
        from core.db_manager import db_manager as _dbm
        _V402_DBM_AVAILABLE = True
    except Exception:
        _V402_DBM_AVAILABLE = False

    # Rule 54 / Phase 3: استخدم db_manager.connection(writable=True) — fallback sqlite3.connect
    _v402_dov_ctx = None
    try:
        if _V402_DBM_AVAILABLE:
            conn = _dbm.get_connection(PREDICTIONS_DB, writable=True)
        else:
            raise RuntimeError("db_manager unavailable")
    except Exception:
        conn = sqlite3.connect(PREDICTIONS_DB, timeout=30.0)
        _v402_dov_ctx = None
    cur = conn.cursor()
    if start_date and end_date:
        cur.execute(
            "DELETE FROM predictions WHERE kill_filter_result LIKE 'V40 evidence%' "  # DEV-06 verified-disabled (dead code — early-return at L548)
            "AND prediction_date >= ? AND prediction_date <= ?",
            (start_date, end_date),
        )
    else:
        cur.execute("DELETE FROM predictions WHERE kill_filter_result LIKE 'V40 evidence%'")  # DEV-06 verified-disabled (dead code — early-return at L548)
    deleted = cur.rowcount
    conn.commit()
    conn.close()
    if deleted > 0:
        range_str = f" ({start_date} → {end_date})" if start_date else ""
        print(f"🧹 Deleted {deleted} old V40 predictions{range_str}", flush=True)
    else:
        print("ℹ️  No old V40 predictions to delete", flush=True)
