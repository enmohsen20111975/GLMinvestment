#!/usr/bin/env python3
"""
Unified Prediction Cleanup Script (DEV-04 — DUAL-TRACK)
========================================================

Combines cleanup_placeholder_predictions.py + cleanup_maestro_backfill.py
into ONE script. On production: overlap = 100% (Maestro is subset of placeholder),
so running both separately is redundant.

This script does NOT delete anything. It:
1. Creates a backup table (snapshot of affected rows)
2. Updates status='INVALID' + appends cleanup tag to notes
3. Is idempotent (AND status != 'INVALID' guard)

Usage:
    python3 vps-service/scripts/unified_prediction_cleanup.py --dry-run
    python3 vps-service/scripts/unified_prediction_cleanup.py --execute

Rollback:
    UPDATE predictions SET status = b.status, notes = b.notes
    FROM predictions_rogue_backup_<timestamp> b
    WHERE predictions.id = b.id

Rule 27 (NO-FAKE-DATA): "NULL = NULL — no fabricated numbers."
Rule 35 (ENGINE-UNIFY): "V40.2 is the only sanctioned writer."
Rule 67 (ROOT-CAUSE-FIRST): "No symptom-fixing — trace to root."
"""
import sqlite3
import sys
import os
from datetime import datetime
from pathlib import Path

DB_PATH = str(Path(__file__).resolve().parent.parent.parent / 'db' / 'predictions.db')
CUTOFF_DATE = '2026-09-01'


def main():
    dry_run = '--execute' not in sys.argv

    if not os.path.exists(DB_PATH):
        print(f"[ERROR] DB not found: {DB_PATH}")
        sys.exit(1)

    print("=" * 70)
    print("UNIFIED PREDICTION CLEANUP (DEV-04 — DUAL-TRACK)")
    print("Rule 27 (NO-FAKE-DATA) + Rule 35 (ENGINE-UNIFY)")
    print("=" * 70)
    print(f"DB:          {DB_PATH}")
    print(f"Cutoff:      {CUTOFF_DATE}")
    print(f"Mode:        {'DRY-RUN (no changes)' if dry_run else 'EXECUTE (will UPDATE)'}")
    print()

    conn = sqlite3.connect(DB_PATH, timeout=30.0)
    conn.row_factory = sqlite3.Row
    cur = conn.cursor()

    # ── COUNT TARGETS ──────────────────────────────────────────────────
    # Unified condition: evidence_count=0 + kill_filter empty + not already INVALID
    # This captures BOTH placeholder AND Maestro backfill (Maestro is a subset).
    suspect = cur.execute("""
        SELECT COUNT(*) FROM predictions
        WHERE evidence_count = 0
          AND (kill_filter_result IS NULL OR kill_filter_result = '')
          AND prediction_date >= ?
          AND status != 'INVALID'
    """, (CUTOFF_DATE,)).fetchone()[0]

    total = cur.execute("SELECT COUNT(*) FROM predictions").fetchone()[0]
    sanctioned = cur.execute("""
        SELECT COUNT(*) FROM predictions
        WHERE evidence_count >= 3
          AND kill_filter_result IS NOT NULL
          AND kill_filter_result != ''
    """).fetchone()[0]
    already_invalid = cur.execute("SELECT COUNT(*) FROM predictions WHERE status = 'INVALID'").fetchone()[0]

    print(f"Total predictions:           {total}")
    print(f"Already INVALID:             {already_invalid}")
    print(f"Rogue (will be cleaned):      {suspect}")
    print(f"Sanctioned V40.2 (protected): {sanctioned}")
    print()

    if suspect == 0:
        print("✅ DB is clean. No rogue predictions found.")
        conn.close()
        return

    # ── BREAKDOWN ───────────────────────────────────────────────────────
    print("Rogue by status:")
    for r in cur.execute("""
        SELECT status, COUNT(*) as cnt FROM predictions
        WHERE evidence_count = 0
          AND (kill_filter_result IS NULL OR kill_filter_result = '')
          AND prediction_date >= ?
          AND status != 'INVALID'
        GROUP BY status ORDER BY cnt DESC
    """, (CUTOFF_DATE,)).fetchall():
        print(f"  {r['status']:15s}: {r['cnt']}")

    print("\nRogue by source pattern:")
    for r in cur.execute("""
        SELECT
            CASE
                WHEN notes LIKE '%persona=%' AND notes LIKE '%regime=%' THEN 'Maestro backfill'
                WHEN notes LIKE '%رادار السيولة%' OR notes LIKE '%توقعات المنصة%' THEN 'Telegram tracker'
                WHEN notes IS NULL OR notes = '' THEN 'Empty notes'
                ELSE 'Other'
            END as source,
            COUNT(*) as cnt
        FROM predictions
        WHERE evidence_count = 0
          AND (kill_filter_result IS NULL OR kill_filter_result = '')
          AND prediction_date >= ?
          AND status != 'INVALID'
        GROUP BY source ORDER BY cnt DESC
    """, (CUTOFF_DATE,)).fetchall():
        print(f"  {r['source']:20s}: {r['cnt']}")

    # ── SAMPLE ──────────────────────────────────────────────────────────
    print(f"\nSample (first 5):")
    for r in cur.execute("""
        SELECT id, ticker, signal, evidence_count, technical_score,
               master_score, status, notes
        FROM predictions
        WHERE evidence_count = 0
          AND (kill_filter_result IS NULL OR kill_filter_result = '')
          AND prediction_date >= ?
          AND status != 'INVALID'
        LIMIT 5
    """, (CUTOFF_DATE,)).fetchall():
        score = r['master_score'] if r['master_score'] is not None else 'NULL'
        print(f"  id={r['id']} {r['ticker']:8s} {r['signal']:8s} ev={r['evidence_count']} "
              f"tech={r['technical_score']} score={score} status={r['status']}")

    conn.close()

    if dry_run:
        print(f"\n{'=' * 70}")
        print("DRY-RUN complete — no changes made.")
        print(f"To execute: python3 {__file__} --execute")
        print(f"Expected: {suspect} rows → status='INVALID'")
        return

    # ── EXECUTE ─────────────────────────────────────────────────────────
    print(f"\n{'=' * 70}")
    print("EXECUTE mode — applying UPDATE...")
    conn = sqlite3.connect(DB_PATH, timeout=30.0)
    cur = conn.cursor()

    # Step 1: Backup (snapshot of affected rows BEFORE change)
    backup_table = f'predictions_rogue_backup_{datetime.now().strftime("%Y%m%d_%H%M%S")}'
    print(f"\nStep 1: Backup affected rows to {backup_table}...")
    cur.execute(f"DROP TABLE IF EXISTS {backup_table}")
    cur.execute(f"""
        CREATE TABLE {backup_table} AS
        SELECT * FROM predictions
        WHERE evidence_count = 0
          AND (kill_filter_result IS NULL OR kill_filter_result = '')
          AND prediction_date >= ?
          AND status != 'INVALID'
    """, (CUTOFF_DATE,))
    conn.commit()
    backup_count = cur.execute(f"SELECT COUNT(*) FROM {backup_table}").fetchone()[0]
    print(f"  ✅ Backup created: {backup_count} rows in {backup_table}")

    # Step 2: UPDATE — mark as INVALID (no DELETE, no DROP)
    print(f"\nStep 2: Mark {suspect} rogue predictions as status='INVALID'...")
    cur.execute("""
        UPDATE predictions
        SET status = 'INVALID',
            notes = COALESCE(notes, '') || ' | UNIFIED-CLEANUP (DEV-04 — Rule 27+35)'
        WHERE evidence_count = 0
          AND (kill_filter_result IS NULL OR kill_filter_result = '')
          AND prediction_date >= ?
          AND status != 'INVALID'
    """, (CUTOFF_DATE,))
    affected = cur.rowcount
    conn.commit()
    conn.close()

    print(f"\n{'=' * 70}")
    print(f"✅ Marked {affected} rogue predictions as status='INVALID'")
    print(f"   Backup: {backup_table} ({backup_count} rows)")
    print(f"   Rollback: UPDATE predictions SET status=b.status, notes=b.notes")
    print(f"             FROM {backup_table} b WHERE predictions.id = b.id")
    print(f"{'=' * 70}")
    print()
    print("These predictions are now excluded from:")
    print("  - honest-tracking stats (WHERE status != 'INVALID')")
    print("  - league-report (WHERE status != 'INVALID')")
    print("  - daily_closer (WHERE status != 'INVALID')")
    print("  - telegram tracker (WHERE status != 'INVALID')")
    print()
    print("PREDICTION-WRITE-GUARD will block any NEW rogue writes at the source.")


if __name__ == '__main__':
    main()
