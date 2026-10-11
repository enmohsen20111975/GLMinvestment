#!/usr/bin/env python3
"""
Cleanup Placeholder Predictions (Rule 27 NO-FAKE-DATA + Rule 35 ENGINE-UNIFY)
=============================================================================

Marks placeholder predictions (written by rogue paths) as status='INVALID'
so they don't pollute KPIs.

Context (MANAGER-FULL-AUDIT + ASSISTANT-INDEPENDENT-VERIFY 2026-10-12):
- 1061 rogue predictions (96.5% of total) with evidence_count=0 +
  kill_filter_result=NULL.
- 519 of these are from Maestro backfill with FABRICATED target_price
  (avg R:R = 49.55, EDBM target = entry × 106).
- 434 from telegram_target_hit_tracker with placeholder technical_score=50.0.
- Previous worklog claims about "cleanup executed" were FABRICATED —
  the script never existed.

This script cleans the EXISTING placeholders. PREDICTION-WRITE-GUARD
(now installed in record_prediction()) blocks NEW placeholder writes.

Usage:
    python3 vps-service/scripts/cleanup_placeholder_predictions.py --dry-run
    python3 vps-service/scripts/cleanup_placeholder_predictions.py --execute

Rule 27 (NO-FAKE-DATA): "NULL = NULL — no fabricated numbers."
Rule 35 (ENGINE-UNIFY): "V40.2 is the only sanctioned writer."
Rule 67 (ROOT-CAUSE-FIRST): "No symptom-fixing — trace to root."
"""
import sqlite3
import sys
import os
import shutil
from datetime import datetime
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
DB_PATH = PROJECT_ROOT / 'db' / 'predictions.db'
CUTOFF_DATE = '2026-09-01'  # clean all rogue from September onwards


def main():
    dry_run = '--execute' not in sys.argv

    if not DB_PATH.exists():
        print(f"[ERROR] DB not found: {DB_PATH}")
        sys.exit(1)

    print("=" * 70)
    print("CLEANUP PLACEHOLDER PREDICTIONS (Rule 27 + Rule 35)")
    print("=" * 70)
    print(f"DB:          {DB_PATH}")
    print(f"Cutoff:      {CUTOFF_DATE}")
    print(f"Mode:        {'DRY-RUN (no changes)' if dry_run else 'EXECUTE (will UPDATE)'}")
    print()

    conn = sqlite3.connect(str(DB_PATH), timeout=30.0)
    conn.row_factory = sqlite3.Row
    cur = conn.cursor()

    # Find placeholder predictions
    rows = cur.execute("""
        SELECT id, ticker, signal, prediction_date, evidence_count,
               kill_filter_result, master_score, technical_score, status, notes
        FROM predictions
        WHERE evidence_count = 0
          AND (kill_filter_result IS NULL OR kill_filter_result = '')
          AND prediction_date >= ?
        ORDER BY prediction_date DESC, id DESC
    """, (CUTOFF_DATE,)).fetchall()

    print(f"[CLEANUP] Found {len(rows)} placeholder predictions "
          f"(evidence=0 + kill_filter=NULL, since {CUTOFF_DATE})")

    if not rows:
        print("\n[CLEANUP] ✅ DB is clean. No placeholder predictions found.")
        conn.close()
        return

    # Show sample
    sample_size = min(15, len(rows))
    print(f"\n[CLEANUP] Sample (first {sample_size}):")
    print(f"  {'id':>6}  {'date':12s} {'ticker':8s} {'signal':12s} "
          f"{'score':>6} {'status':10s}")
    print(f"  {'-'*6}  {'-'*12} {'-'*8} {'-'*12} {'-'*6} {'-'*10}")
    for r in rows[:sample_size]:
        score = r['master_score'] if r['master_score'] is not None else 'NULL'
        print(f"  {r['id']:>6}  {r['prediction_date']:12s} {r['ticker']:8s} "
              f"{r['signal']:12s} {str(score):>6} {r['status']:10s}")

    # Breakdown by signal
    print(f"\n[CLEANUP] Breakdown by signal:")
    for r in cur.execute("""
        SELECT signal, COUNT(*) as cnt
        FROM predictions
        WHERE evidence_count = 0
          AND (kill_filter_result IS NULL OR kill_filter_result = '')
          AND prediction_date >= ?
        GROUP BY signal
        ORDER BY cnt DESC
    """, (CUTOFF_DATE,)).fetchall():
        print(f"  {r['signal']:12s}: {r['cnt']}")

    # Breakdown by date
    print(f"\n[CLEANUP] Breakdown by date:")
    for r in cur.execute("""
        SELECT prediction_date, COUNT(*) as cnt
        FROM predictions
        WHERE evidence_count = 0
          AND (kill_filter_result IS NULL OR kill_filter_result = '')
          AND prediction_date >= ?
        GROUP BY prediction_date
        ORDER BY prediction_date DESC
        LIMIT 15
    """, (CUTOFF_DATE,)).fetchall():
        print(f"  {r['prediction_date']}: {r['cnt']}")

    # Count sanctioned predictions for comparison
    sanctioned = cur.execute("""
        SELECT COUNT(*) FROM predictions
        WHERE evidence_count >= 3
          AND kill_filter_result IS NOT NULL
          AND kill_filter_result != ''
          AND prediction_date >= ?
    """, (CUTOFF_DATE,)).fetchone()[0]

    print(f"\n[CLEANUP] For comparison: {sanctioned} sanctioned predictions "
          f"(evidence>=3 + kill_filter non-empty)")

    conn.close()

    if dry_run:
        print()
        print("[CLEANUP] DRY-RUN complete — no changes made.")
        print("[CLEANUP] To apply, re-run with --execute:")
        print(f"  python3 {__file__} --execute")
        return

    # ── EXECUTE mode ──────────────────────────────────────────────────────
    print()
    print("[CLEANUP] EXECUTE mode — applying UPDATE...")
    conn = sqlite3.connect(str(DB_PATH), timeout=30.0)
    cur = conn.cursor()

    # Backup the affected rows first (Rule 1 — DB safety)
    backup_table = f'predictions_placeholder_backup_{datetime.now().strftime("%Y%m%d_%H%M%S")}'
    print(f"[CLEANUP] Step 1: Backup affected rows to {backup_table}...")
    try:
        cur.execute(f"DROP TABLE IF EXISTS {backup_table}")
        cur.execute(f"""
            CREATE TABLE {backup_table} AS
            SELECT * FROM predictions
            WHERE evidence_count = 0
              AND (kill_filter_result IS NULL OR kill_filter_result = '')
              AND prediction_date >= ?
        """, (CUTOFF_DATE,))
        backup_count = cur.rowcount
        conn.commit()
        print(f"[CLEANUP] ✅ Backup table created: {backup_count} rows preserved")
    except Exception as e:
        print(f"[CLEANUP] ⚠️ Backup failed: {e} — aborting UPDATE for safety")
        conn.close()
        sys.exit(1)

    # Mark placeholders as INVALID
    print("[CLEANUP] Step 2: Mark placeholders as status='INVALID'...")
    cur.execute("""
        UPDATE predictions
        SET status = 'INVALID',
            notes = COALESCE(notes, '') || ' | RULE35-CLEANUP (PRED-WRITE-GUARD)'
        WHERE evidence_count = 0
          AND (kill_filter_result IS NULL OR kill_filter_result = '')
          AND prediction_date >= ?
    """, (CUTOFF_DATE,))
    affected = cur.rowcount
    conn.commit()
    conn.close()

    print()
    print(f"[CLEANUP] ✅ Marked {affected} placeholder predictions as status='INVALID'")
    print(f"[CLEANUP] Backup preserved in: {backup_table}")
    print()
    print("[CLEANUP] These predictions are now excluded from KPI calculations:")
    print("  - WR / PF / Expectancy queries use WHERE status != 'INVALID'")
    print("  - live-tracking / honest-tracking / stored-analysis all filter INVALID")
    print("  - Per Rule 27 (NO-FAKE-DATA) + Rule 35 (ENGINE-UNIFY) + Rule 67 (ROOT-CAUSE-FIRST)")
    print()
    print("[CLEANUP] DONE. PREDICTION-WRITE-GUARD in record_prediction()")
    print("         will now block any NEW placeholder writes at the source.")


if __name__ == '__main__':
    main()
