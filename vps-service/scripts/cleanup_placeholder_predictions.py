#!/usr/bin/env python3
"""
Cleanup Placeholder Predictions (Rule 27 NO-FAKE-DATA + Rule 35 ENGINE-UNIFY)
=============================================================================

Marks placeholder predictions (written by rogue paths from 2026-09-27) as
status='INVALID' so they don't pollute KPIs.

The PREDICTION-WRITE-GUARD (core/prediction_write_guard.py) is now installed
in record_prediction() and will block NEW placeholder writes. This script
cleans the EXISTING placeholders that polluted the DB before the guard was
installed.

Placeholder criteria (ALL must be true):
- evidence_count = 0  (no V40.2 evidence — Rule 21 breach)
- kill_filter_result IS NULL OR kill_filter_result = ''  (no V40.2 kill filters)
- prediction_date >= '2026-09-27'  (when V40.2 broke per audit)

These are the rogue-path predictions from:
- B.1: sniper_routes.py::track_ticker() (now hard-gated with 422)
- B.2: daily_predictor.py CRYPTO path (now disabled)
- B.3: daily_predictor.py EGX path when V40.2 evidence engine fails
       (now early-skipped via V40.2 EVIDENCE GATE)
- IMPROVEMENT-12 WAIT→HOLD placeholders (now blocked by guard)

Usage:
    python3 vps-service/scripts/cleanup_placeholder_predictions.py --dry-run
    python3 vps-service/scripts/cleanup_placeholder_predictions.py --execute

Rule 27 (NO-FAKE-DATA): "NULL = NULL — no fabricated numbers."
Rule 35 (ENGINE-UNIFY): "V40.2 is the only sanctioned writer."
Rule 67 (ROOT-CAUSE-FIRST): "No symptom-fixing — trace to root."

Reference: worklog.md PRED-WRITE-GUARD task (2026-10-12)
"""
import sqlite3
import sys
import os
from pathlib import Path

# Resolve DB path: db/predictions.db relative to project root
PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
DB_PATH = PROJECT_ROOT / 'db' / 'predictions.db'
CUTOFF_DATE = '2026-09-27'


def main():
    dry_run = '--execute' not in sys.argv
    show_all = '--show-all' in sys.argv

    if not DB_PATH.exists():
        print(f"[ERROR] DB not found: {DB_PATH}")
        print(f"[HINT] In sandbox, extract from data/predictions.db.zip:")
        print(f"       unzip -o data/predictions.db.zip -d db/")
        sys.exit(1)

    print("=" * 70)
    print("CLEANUP PLACEHOLDER PREDICTIONS (Rule 27 NO-FAKE-DATA + Rule 35)")
    print("=" * 70)
    print(f"[CLEANUP] DB:          {DB_PATH}")
    print(f"[CLEANUP] Cutoff:      {CUTOFF_DATE}")
    print(f"[CLEANUP] Mode:        {'DRY-RUN (no changes)' if dry_run else 'EXECUTE (will UPDATE)'}")
    print()

    # Connect read-only first for audit
    conn = sqlite3.connect(str(DB_PATH))
    conn.row_factory = sqlite3.Row
    cur = conn.cursor()

    # Schema check — make sure columns exist (Rule 6 schema-aware)
    cols = {r['name'] for r in cur.execute("PRAGMA table_info(predictions)").fetchall()}
    required = {'id', 'ticker', 'signal', 'prediction_date', 'evidence_count',
                'kill_filter_result', 'master_score', 'persona', 'status', 'notes'}
    missing = required - cols
    if missing:
        print(f"[ERROR] predictions table missing columns: {missing}")
        print(f"[HINT] Run V40.2 schema migrations first (prediction_tracker.py).")
        conn.close()
        sys.exit(1)

    # Find placeholder predictions
    rows = cur.execute("""
        SELECT id, ticker, signal, prediction_date, evidence_count,
               kill_filter_result, master_score, persona, status
        FROM predictions
        WHERE evidence_count = 0
          AND (kill_filter_result IS NULL OR kill_filter_result = '')
          AND prediction_date >= ?
        ORDER BY prediction_date DESC, id DESC
    """, (CUTOFF_DATE,)).fetchall()

    print(f"[CLEANUP] Found {len(rows)} placeholder predictions "
          f"(evidence=0 + kill_filter=NULL, since {CUTOFF_DATE})")

    if not rows:
        print()
        print("[CLEANUP] ✅ DB is clean. No placeholder predictions found.")
        conn.close()
        return

    # Show sample
    sample_size = len(rows) if show_all else min(15, len(rows))
    print(f"\n[CLEANUP] Sample (first {sample_size} of {len(rows)}):")
    print(f"  {'id':>6}  {'date':12s} {'ticker':8s} {'signal':12s} "
          f"{'score':>6} {'persona':12s} {'status':10s}")
    print(f"  {'-'*6}  {'-'*12} {'-'*8} {'-'*12} {'-'*6} {'-'*12} {'-'*10}")
    for r in rows[:sample_size]:
        print(f"  {r['id']:>6}  {r['prediction_date']:12s} {r['ticker']:8s} "
              f"{r['signal']:12s} {str(r['master_score'] or '?'):>6} "
              f"{r['persona']:12s} {r['status']:10s}")

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
          f"(evidence>=3 + kill_filter non-empty) since {CUTOFF_DATE}")

    conn.close()

    if dry_run:
        print()
        print("[CLEANUP] DRY-RUN complete — no changes made.")
        print("[CLEANUP] To apply the cleanup, re-run with --execute:")
        print(f"  python3 {__file__} --execute")
        return

    # ── EXECUTE mode ──────────────────────────────────────────────────────
    print()
    print("[CLEANUP] EXECUTE mode — applying UPDATE...")
    conn = sqlite3.connect(str(DB_PATH))
    cur = conn.cursor()

    # Backup the affected rows first (Rule 1 — DB safety)
    print("[CLEANUP] Step 1: Backup affected rows to predictions_placeholder_backup_2026-10-12...")
    try:
        cur.execute("DROP TABLE IF EXISTS predictions_placeholder_backup_20261012")
        cur.execute("""
            CREATE TABLE predictions_placeholder_backup_20261012 AS
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
            notes = COALESCE(notes, '') || ' | RULE35-CLEANUP-2026-10-12 (PRED-WRITE-GUARD)'
        WHERE evidence_count = 0
          AND (kill_filter_result IS NULL OR kill_filter_result = '')
          AND prediction_date >= ?
    """, (CUTOFF_DATE,))
    affected = cur.rowcount
    conn.commit()
    conn.close()

    print()
    print(f"[CLEANUP] ✅ Marked {affected} placeholder predictions as status='INVALID'")
    print(f"[CLEANUP] Backup preserved in: predictions_placeholder_backup_20261012")
    print()
    print("[CLEANUP] These predictions are now excluded from KPI calculations:")
    print("  - WR / PF / Expectancy queries use WHERE status != 'INVALID'")
    print("  - live-tracking / honest-tracking / stored-analysis all filter INVALID")
    print("  - Per Rule 27 (NO-FAKE-DATA) + Rule 35 (ENGINE-UNIFY) + Rule 67 (ROOT-CAUSE-FIRST)")
    print()
    print("[CLEANUP] DONE. The PREDICTION-WRITE-GUARD in record_prediction()")
    print("         will now block any NEW placeholder writes at the source.")


if __name__ == '__main__':
    main()
