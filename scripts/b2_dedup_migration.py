#!/usr/bin/env python3
"""
B2 — Predictions Dedup Migration
================================
Task ID: 1-b (Bravo). Prevents daily prediction duplication.

Identity model (DECIDED — see investigation report):
    (ticker, date(prediction_date), persona, market, track) = ONE prediction per day.
WHY include `market` + `track`:
    - `track` = 'full_analysis' (daily_predictor EGX) | 'RADAR_PROMOTED' (intraday EGX)
                | 'liquidity' (US/CRYPTO liquidity breakouts). These ARE legitimately
                different prediction TYPES per owner's constraint #4 ("no blanket
                unique constraint"). Same ticker can have BOTH a daily-prediction row
                AND an intraday row on the same day without colliding.
    - `market` = future-proofing in case the same track gets used on different markets.
      (Currently each track maps to exactly one market, but adding market to the
      identity is a no-cost safety margin.)

Steps performed by this script (idempotent — safe to re-run):
  1. ALTER TABLE predictions ADD COLUMN update_count INTEGER DEFAULT 0   (B2 traceability)
  2. ALTER TABLE predictions ADD COLUMN is_duplicate  INTEGER DEFAULT 0  (B2 flag)
  3. CREATE TABLE predictions_duplicates_archive (mirror of predictions + archived_at)
  4. For every (ticker, day, persona, market, track) group with >1 rows:
        - Pick ORIGINAL: earliest prediction_date with non-null entry_price;
          tie-breaker = lowest rowid. (Owner rule — DO NOT assume newest is correct.)
        - For each non-original row:
            * COPY to predictions_duplicates_archive (preserves full row + archived_at)
            * DELETE from predictions (so UNIQUE INDEX can be created)
  5. CREATE UNIQUE INDEX idx_predictions_dedup
        ON predictions (ticker, substr(prediction_date,1,10), persona, market, track)
     (SQLite supports expression indexes since 3.9 — current libsqlite3 is 3.46.)

Safety:
  - Runs inside a transaction; commits at the end. On any error → ROLLBACK.
  - Print a "BEFORE / AFTER" report.
  - Does NOT push to remote. Local-only.

Usage:
    python3 scripts/b2_dedup_migration.py            # apply on db/predictions.db
    python3 scripts/b2_dedup_migration.py --dry-run   # report only, no changes
    python3 scripts/b2_dedup_migration.py --db /path/to/other.db
"""

import argparse
import sqlite3
import sys
from datetime import datetime
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_DB = PROJECT_ROOT / 'db' / 'predictions.db'


def _table_columns(conn, table):
    return [r[1] for r in conn.execute(f"PRAGMA table_info({table})")]


def _add_column_if_missing(conn, table, column, ddl_type):
    cols = _table_columns(conn, table)
    if column not in cols:
        conn.execute(f"ALTER TABLE {table} ADD COLUMN {column} {ddl_type}")
        print(f"  + ALTER TABLE {table} ADD COLUMN {column} {ddl_type}")
        return True
    print(f"  = column '{column}' already exists on {table} (skipped)")
    return False


def _create_archive_table_if_missing(conn):
    """Create predictions_duplicates_archive mirroring predictions + archived_at."""
    exists = conn.execute(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='predictions_duplicates_archive'"
    ).fetchone()
    if exists:
        print("  = predictions_duplicates_archive already exists (skipped)")
        return
    # Build CREATE TABLE based on predictions schema at runtime (avoid hardcoding).
    cols_sql = conn.execute(
        "SELECT sql FROM sqlite_master WHERE type='table' AND name='predictions'"
    ).fetchone()[0]
    # Replace the table name and append archived_at column.
    # The original CREATE TABLE has no trailing comma before the closing paren,
    # so we need to inject ", archived_at TEXT" before the final ")".
    arch_sql = cols_sql.replace("predictions", "predictions_duplicates_archive", 1)
    # Append archived_at before final close-paren. The schema's CREATE TABLE syntax
    # in this DB doesn't have a trailing comma; we add one with the new column.
    arch_sql = arch_sql.rstrip().rstrip(";")
    if arch_sql.endswith(")"):
        arch_sql = arch_sql[:-1] + ", archived_at TEXT DEFAULT CURRENT_TIMESTAMP)"
    conn.execute(arch_sql)
    print("  + CREATE TABLE predictions_duplicates_archive (mirror of predictions + archived_at)")


def _find_duplicate_groups(conn):
    """Return list of dicts: ticker, pd, persona, market, track, count, member_ids."""
    rows = conn.execute("""
        SELECT ticker,
               substr(prediction_date,1,10) AS pd,
               persona,
               market,
               track,
               COUNT(*) AS cnt
        FROM predictions
        GROUP BY ticker, substr(prediction_date,1,10), persona, market, track
        HAVING COUNT(*) > 1
        ORDER BY cnt DESC, ticker, pd
    """).fetchall()
    groups = []
    for r in rows:
        ticker, pd, persona, market, track, cnt = r
        # Fetch member ids ordered by (prediction_date ASC, rowid ASC) — earliest first.
        members = conn.execute("""
            SELECT id, prediction_date, entry_price, rowid
            FROM predictions
            WHERE ticker = ?
              AND substr(prediction_date,1,10) = ?
              AND persona = ?
              AND market = ?
              AND track = ?
            ORDER BY prediction_date ASC, rowid ASC
        """, (ticker, pd, persona, market, track)).fetchall()
        groups.append({
            'ticker': ticker, 'pd': pd, 'persona': persona,
            'market': market, 'track': track, 'cnt': cnt,
            'member_ids': [m[0] for m in members],
            'members': members,
        })
    return groups


def _pick_original(members):
    """Per owner rule: earliest prediction_date with non-null entry_price; tie → lowest rowid.
    `members` is already ordered by (prediction_date ASC, rowid ASC)."""
    for m in members:
        mid, pd, entry, rowid = m
        if entry is not None and entry > 0:
            return mid
    # Fallback: first member by ordering (already earliest).
    return members[0][0]


def run_migration(db_path: Path, dry_run: bool = False):
    print(f"\n{'='*70}")
    print(f"B2 Predictions Dedup Migration")
    print(f"  DB: {db_path}")
    print(f"  Mode: {'DRY-RUN' if dry_run else 'APPLY'}")
    print(f"  Started: {datetime.now().isoformat()}")
    print(f"{'='*70}")

    if not db_path.exists():
        print(f"FATAL: DB not found: {db_path}")
        sys.exit(2)

    conn = sqlite3.connect(str(db_path))
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = OFF")  # we manage cascades manually

    # ── BEFORE snapshot ─────────────────────────────────────────────────────
    total_before = conn.execute("SELECT COUNT(*) FROM predictions").fetchone()[0]
    dup_groups = _find_duplicate_groups(conn)
    total_dup_rows = sum(g['cnt'] for g in dup_groups)
    rows_to_archive = sum(g['cnt'] - 1 for g in dup_groups)
    print(f"\n[BEFORE] total rows: {total_before}")
    print(f"[BEFORE] duplicate groups (by ticker,day,persona,market,track): {len(dup_groups)}")
    print(f"[BEFORE] rows inside duplicate groups: {total_dup_rows}")
    print(f"[BEFORE] rows to archive (non-originals): {rows_to_archive}")

    if dry_run:
        print("\n[DRY-RUN] Sample 10 largest groups (no changes will be made):")
        for g in dup_groups[:10]:
            orig_id = _pick_original(g['members'])
            print(f"  {g['ticker']:<10} {g['pd']} {g['persona']:<12} {g['market']:<6} {g['track']:<18} cnt={g['cnt']:>3}  original_id={orig_id}  archive_ids={g['member_ids']}")
        if dup_groups:
            # Sanity: confirm we can create the unique index after archival.
            unique_idents = conn.execute("""
                SELECT COUNT(*) FROM (
                  SELECT DISTINCT ticker, substr(prediction_date,1,10), persona, market, track
                  FROM predictions
                )
            """).fetchone()[0]
            print(f"\n[DRY-RUN] After archive, predictions would have {unique_idents} unique rows.")
            print(f"[DRY-RUN] UNIQUE INDEX would be creatable on (ticker, substr(prediction_date,1,10), persona, market, track).")
        conn.close()
        return

    # ── APPLY migration in a transaction ────────────────────────────────────
    try:
        print("\n[STEP 1] Add B2 columns (update_count, is_duplicate)...")
        _add_column_if_missing(conn, "predictions", "update_count", "INTEGER DEFAULT 0")
        _add_column_if_missing(conn, "predictions", "is_duplicate",  "INTEGER DEFAULT 0")

        print("\n[STEP 2] Create predictions_duplicates_archive table...")
        _create_archive_table_if_missing(conn)

        print("\n[STEP 3] Identify + archive duplicates (copy → delete)...")
        archived_count = 0
        archive_cols = _table_columns(conn, "predictions")
        placeholders = ", ".join(["?"] * len(archive_cols))
        col_list = ", ".join(archive_cols)
        # The archive table has the same columns as predictions PLUS archived_at.
        # We insert into archive_cols (which excludes archived_at, so it gets the default CURRENT_TIMESTAMP).

        for g in dup_groups:
            orig_id = _pick_original(g['members'])
            non_original_ids = [mid for mid in g['member_ids'] if mid != orig_id]
            if not non_original_ids:
                continue
            # COPY each non-original to archive
            for nid in non_original_ids:
                row = conn.execute(
                    f"SELECT {col_list} FROM predictions WHERE id = ?",
                    (nid,)
                ).fetchone()
                if row is None:
                    continue
                conn.execute(
                    f"INSERT INTO predictions_duplicates_archive ({col_list}) VALUES ({placeholders})",
                    tuple(row)
                )
                archived_count += 1
            # DELETE non-originals from main
            placeholders_in = ",".join(["?"] * len(non_original_ids))
            conn.execute(
                f"DELETE FROM predictions WHERE id IN ({placeholders_in})",
                tuple(non_original_ids)
            )

        print(f"  + archived {archived_count} duplicate rows to predictions_duplicates_archive")
        print(f"  + deleted {archived_count} duplicate rows from predictions")

        print("\n[STEP 4] Create UNIQUE INDEX idx_predictions_dedup...")
        # Drop any prior partial/duplicate index first (idempotent).
        conn.execute("DROP INDEX IF EXISTS idx_predictions_dedup")
        # SQLite expression index on substr(prediction_date,1,10) — supported since 3.9.
        conn.execute("""
            CREATE UNIQUE INDEX idx_predictions_dedup
            ON predictions (ticker, substr(prediction_date,1,10), persona, market, track)
        """)
        print("  + CREATE UNIQUE INDEX idx_predictions_dedup ON")
        print("      (ticker, substr(prediction_date,1,10), persona, market, track)")

        conn.commit()
        print("\n[COMMITTED]")

    except Exception as e:
        conn.rollback()
        print(f"\n[ERROR] migration failed — ROLLED BACK: {e}")
        raise

    # ── AFTER snapshot ──────────────────────────────────────────────────────
    total_after = conn.execute("SELECT COUNT(*) FROM predictions").fetchone()[0]
    archive_total = conn.execute("SELECT COUNT(*) FROM predictions_duplicates_archive").fetchone()[0]
    remaining_dup_groups = conn.execute("""
        SELECT COUNT(*) FROM (
          SELECT ticker, substr(prediction_date,1,10), persona, market, track, COUNT(*) AS c
          FROM predictions
          GROUP BY ticker, substr(prediction_date,1,10), persona, market, track
          HAVING c > 1
        )
    """).fetchone()[0]
    unique_idents = conn.execute("""
        SELECT COUNT(*) FROM (
          SELECT DISTINCT ticker, substr(prediction_date,1,10), persona, market, track
          FROM predictions
        )
    """).fetchone()[0]

    print(f"\n[AFTER] total rows in predictions: {total_after}")
    print(f"[AFTER] unique (ticker,day,persona,market,track) identities: {unique_idents}")
    print(f"[AFTER] remaining duplicate groups in main: {remaining_dup_groups}  (expected: 0)")
    print(f"[AFTER] rows in predictions_duplicates_archive: {archive_total}")
    print(f"[AFTER] rows deleted from main: {total_before - total_after}")
    print(f"\n  Done: {datetime.now().isoformat()}")

    conn.close()


def main():
    ap = argparse.ArgumentParser(description="B2 predictions dedup migration")
    ap.add_argument("--db", default=str(DEFAULT_DB), help="Path to predictions.db")
    ap.add_argument("--dry-run", action="store_true", help="Report only, no changes")
    args = ap.parse_args()
    run_migration(Path(args.db), dry_run=args.dry_run)


if __name__ == "__main__":
    main()
