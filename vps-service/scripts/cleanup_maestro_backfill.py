#!/usr/bin/env python3
"""
Cleanup Maestro Backfill Predictions (Rule 27 NO-FAKE-DATA + Rule 35 ENGINE-UNIFY)
=================================================================================
Marks Maestro backfill predictions (with fabricated target_price) as
status='INVALID'. These predictions have:
- notes pattern: persona=X; score=Y; conf=Z; regime=... (Maestro orchestrator)
- evidence_count = 0 (no V40.2 evidence pipeline)
- avg R:R = 49.55 (impossible — normal range 1-5)
Usage:
    python3 vps-service/scripts/cleanup_maestro_backfill.py --dry-run
    python3 vps-service/scripts/cleanup_maestro_backfill.py --execute
"""
import sqlite3, sys
from datetime import datetime
from pathlib import Path

DB_PATH = str(Path(__file__).resolve().parent.parent.parent / 'db' / 'predictions.db')

def main():
    dry_run = '--execute' not in sys.argv
    print("=" * 70)
    print("CLEANUP MAESTRO BACKFILL (Rule 27 + Rule 35)")
    print("=" * 70)
    print(f"Mode: {'DRY-RUN' if dry_run else 'EXECUTE'}")
    conn = sqlite3.connect(DB_PATH, timeout=30)
    conn.row_factory = sqlite3.Row
    cur = conn.cursor()
    rows = cur.execute("""
        SELECT id, ticker, signal, prediction_date, evidence_count,
               kill_filter_result, technical_score, master_score, status, notes
        FROM predictions
        WHERE notes LIKE '%persona=%' AND notes LIKE '%score=%'
          AND notes LIKE '%conf=%' AND notes LIKE '%regime=%'
          AND evidence_count = 0
        ORDER BY prediction_date DESC
    """).fetchall()
    print(f"Found {len(rows)} Maestro backfill predictions")
    if not rows:
        print("DB is clean.")
        conn.close()
        return
    if dry_run:
        print("\nDRY-RUN — no changes. Use --execute to apply.")
        conn.close()
        return
    backup_table = f'maestro_backfill_backup_{datetime.now().strftime("%Y%m%d_%H%M%S")}'
    print(f"\nBackup: {backup_table}")
    cur.execute(f"DROP TABLE IF EXISTS {backup_table}")
    cur.execute(f"""CREATE TABLE {backup_table} AS SELECT * FROM predictions
        WHERE notes LIKE '%persona=%' AND notes LIKE '%score=%'
          AND notes LIKE '%conf=%' AND notes LIKE '%regime=%' AND evidence_count = 0""")
    conn.commit()
    cur.execute("""UPDATE predictions SET status = 'INVALID',
        notes = COALESCE(notes, '') || ' | MAESTRO-BACKFILL-CLEANUP (Rule 27)'
        WHERE notes LIKE '%persona=%' AND notes LIKE '%score=%'
          AND notes LIKE '%conf=%' AND notes LIKE '%regime=%' AND evidence_count = 0""")
    affected = cur.rowcount
    conn.commit()
    conn.close()
    print(f"\nMarked {affected} Maestro backfill -> status='INVALID'")
    print(f"Backup: {backup_table}")

if __name__ == '__main__':
    main()
