#!/usr/bin/env python3
"""
S-1.4 — Verify lifecycle_status column + write path (Bravo, Integration Stabilization)
=====================================================================================
Tests that PredictionTracker.record_prediction() PRIMARY INSERT path
succeeds WITHOUT falling back to the legacy 16-col schema. The primary
INSERT (line 792-816 of prediction_tracker.py) hardcodes the literal
'testing' for the lifecycle_status column. If that column is missing,
INSERT fails with "table predictions has no column named lifecycle_status"
and the except branch falls back to a 16-column INSERT (no risk_reward,
no atr, no T2) — silently losing data.

This script:
  1. Connects to db/predictions.db (the one created by S-1.1).
  2. Confirms lifecycle_status column EXISTS via PRAGMA table_info.
  3. Calls PredictionTracker.record_prediction() with a test ticker
     "TESTBRAVO" + sane prices.
  4. Verifies the row was written WITH lifecycle_status = 'testing'.
  5. Greps the Python log (/tmp/bravo-python.log) for the
     "[PRED-TRACKER-PRIMARY-FAIL]" message — should be NONE for this test.
  6. Reports: PRIMARY INSERT works Y/N, with evidence.

Run:
    python3 scripts/s1_verify_lifecycle_status.py
"""
from __future__ import annotations

import sqlite3
import sys
from datetime import datetime
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[1]
PREDICTIONS_DB = PROJECT_ROOT / 'db' / 'predictions.db'
VPS_ROOT = PROJECT_ROOT / 'vps-service'
LOG_FILE = Path('/tmp/bravo-python.log')

sys.path.insert(0, str(VPS_ROOT))


def main():
    print(f"[S-1.4] Verifying lifecycle_status column + write path")
    print(f"  DB: {PREDICTIONS_DB}")
    if not PREDICTIONS_DB.exists():
        print(f"  ❌ predictions.db does not exist (run S-1.1 first).")
        return 2

    # ── 1. PRAGMA check ──────────────────────────────────────────────────
    conn = sqlite3.connect(str(PREDICTIONS_DB))
    cols = [r[1] for r in conn.execute("PRAGMA table_info(predictions)").fetchall()]
    if 'lifecycle_status' not in cols:
        print(f"  ❌ lifecycle_status column MISSING from predictions. Cols: {cols}")
        return 3
    print(f"  ✅ lifecycle_status column EXISTS in predictions table ({len(cols)} cols total)")

    # ── 2. Snapshot existing TESTBRAVO rows (should be 0) ───────────────
    cur = conn.execute(
        "SELECT COUNT(*) FROM predictions WHERE ticker = ?",
        ('TESTBRAVO',),
    )
    before_count = cur.fetchone()[0]
    print(f"  TESTBRAVO rows BEFORE: {before_count}")
    conn.close()

    # ── 3. Call PredictionTracker.record_prediction() directly ──────────
    # This exercises the SAME primary INSERT path the live pipeline uses.
    print(f"\n  Calling PredictionTracker.record_prediction(ticker='TESTBRAVO')...")
    try:
        from analyzers.prediction_tracker import PredictionTracker
        tracker = PredictionTracker(str(PREDICTIONS_DB))
        # Capture current log size so we can grep only new log lines.
        log_size_before = LOG_FILE.stat().st_size if LOG_FILE.exists() else 0

        today = datetime.now().strftime('%Y-%m-%d')
        pred_id = tracker.record_prediction(
            ticker='TESTBRAVO',
            signal='BUY',
            entry_price=100.0,
            target_price=110.0,
            stop_loss=95.0,
            master_score=72.5,
            technical_score=68.0,
            fundamental_score=70.0,
            ai_pattern_score=65.0,
            sentiment_score=75.0,
            notes='S-1.4 lifecycle_status write-path test (Bravo).',
            persona='balanced',
            atr_at_entry=2.5,
            target_price_2=115.0,
            explosive_score=35.0,
            explosive_label='SPARK',
            prediction_date=today,
            evidence_count=4,
            morning_bell=0,
            kill_filter_result='PASS',
            risk_reward=2.0,
            who_is_buying_state='🏦 شراء مؤسساتي',
            tp1_price=110.0,
            tp2_price=115.0,
            trailing_stop_pct=2.5,
            max_hold_days=5,
            exit_protocol='TP1_6PCT_TIME_STOP_5D',
            user_advice_ar='اختبار S-1.4 — تحقق من كتابة lifecycle_status.',
        )
        print(f"  → record_prediction returned pred_id={pred_id}")
    except Exception as e:
        print(f"  ❌ record_prediction raised: {type(e).__name__}: {e}")
        return 4

    # ── 4. Verify the row + lifecycle_status value ─────────────────────
    conn = sqlite3.connect(str(PREDICTIONS_DB))
    conn.row_factory = sqlite3.Row
    row = conn.execute(
        "SELECT id, ticker, signal, entry_price, target_price, stop_loss, "
        "risk_reward, atr_at_entry, target_price_2, lifecycle_status, "
        "track, persona, market, prediction_date, master_score "
        "FROM predictions WHERE id = ?",
        (pred_id,),
    ).fetchone()

    if not row:
        print(f"  ❌ Row with id={pred_id} not found in predictions.")
        return 5

    d = dict(row)
    print(f"\n  Row written:")
    for k, v in d.items():
        print(f"    {k:20s} = {v!r}")

    if d.get('lifecycle_status') != 'testing':
        print(f"\n  ❌ lifecycle_status != 'testing' (got {d.get('lifecycle_status')!r})")
        print(f"     → PRIMARY INSERT failed silently and fell back to legacy schema.")
        return 6
    print(f"\n  ✅ lifecycle_status = 'testing' (PRIMARY INSERT path succeeded)")

    # ── 5. Check the Python log for PRIMARY-FAIL messages ──────────────
    primary_fail_count = 0
    fallback_fail_count = 0
    if LOG_FILE.exists():
        log_size_after = LOG_FILE.stat().st_size
        with open(LOG_FILE, 'rb') as f:
            f.seek(log_size_before)
            new_log = f.read().decode('utf-8', errors='replace')
        primary_fail_count = new_log.count('[PRED-TRACKER-PRIMARY-FAIL]')
        fallback_fail_count = new_log.count('[PRED-TRACKER-FALLBACK-FAIL]')
        print(f"\n  Python log (last {log_size_after - log_size_before} bytes):")
        print(f"    [PRED-TRACKER-PRIMARY-FAIL] count = {primary_fail_count}  (expected: 0)")
        print(f"    [PRED-TRACKER-FALLBACK-FAIL] count = {fallback_fail_count}  (expected: 0)")

    if primary_fail_count > 0:
        print(f"\n  ❌ Primary INSERT path FAILED — see log above.")
        return 7
    if fallback_fail_count > 0:
        print(f"\n  ❌ Fallback INSERT path ALSO failed — schema is broken.")
        return 8

    # ── 6. Summary ──────────────────────────────────────────────────────
    cur = conn.execute(
        "SELECT COUNT(*) FROM predictions WHERE ticker = ?",
        ('TESTBRAVO',),
    )
    after_count = cur.fetchone()[0]
    conn.close()
    print(f"\n  TESTBRAVO rows AFTER: {after_count} (delta = {after_count - before_count})")
    print(f"\n[S-1.4] VERDICT: PRIMARY INSERT path WORKS (lifecycle_status='testing' written).")
    print(f"  → No [PRED-TRACKER-PRIMARY-FAIL] in log.")
    print(f"  → No fallback to 16-column legacy schema.")
    return 0


if __name__ == '__main__':
    sys.exit(main())
