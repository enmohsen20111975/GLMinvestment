#!/usr/bin/env python3
"""
RL-FIX-9 Migration: Fix Existing Contradictory Rows in predictions.db
=====================================================================
One-shot migration script to retroactively fix rows that have illogical
status/return combinations:

  BUG #1: hit_stop=1 AND actual_return > 0
    → "❌ ضرب وقف" but showing +14% profit (FAIT, ORWE)
    → Reclassify as exit_type='trailing_profit', hit_stop=0, hit_target=1,
      is_correct=1, status='CLOSED'

  BUG #2: outcome_date IS NULL (PENDING) but actual_return IS NOT NULL
    → "⏳ لسه معلقة" but showing -4.4% (ZMID)
    → Clear actual_return to NULL for pending rows (PENDING = no return yet)

  BUG #4: highest_price_reached=0 OR lowest_price_reached=0 for closed rows
    → High==Low==0 (falls back to entry in UI)
    → Set highest/lowest to entry_price if they're 0/NULL

Usage (on VPS):
    cd ~/GLMinvestment
    python3 vps-service/scripts/rl_fix_9_migrate_bad_rows.py
    pm2 restart python-backend
"""
import sqlite3
import sys
import time
from pathlib import Path
from datetime import datetime

ROOT = Path(__file__).parent.parent.parent.resolve()
DB = str(ROOT / 'db' / 'predictions.db')

# RL-FIX-11b: إعدادات الـ DB — busy_timeout 60 ثانية + WAL mode علشان الـ
# migration ما بـ يقفلش لو الـ python-backend (PM2) بـ يستخدم الـ DB.
# قبل كده كان الـ connect بـ timeout افتراضي (5 ثواني) فـ كان بـ يـ fail بـ
# "database is locked" لأن الـ python-backend بـ يـ hold write lock.
DB_TIMEOUT = 60.0
MAX_RETRIES = 3
RETRY_DELAY = 5.0

def log(msg):
    print(f"[{datetime.now().strftime('%H:%M:%S')}] {msg}")

def open_db_with_retry():
    """افتح الـ DB مع retry logic — علشان الـ PM2 ما بـ يقفلش الـ migration."""
    last_err = None
    for attempt in range(1, MAX_RETRIES + 1):
        try:
            conn = sqlite3.connect(DB, timeout=DB_TIMEOUT)
            # busy_timeout: لو الـ DB مقفول، استنى لحد DB_TIMEOUT ثانية قبل ما تـ fail.
            conn.execute(f'PRAGMA busy_timeout = {int(DB_TIMEOUT * 1000)}')
            # WAL mode: بـ يسمح بـ concurrent reads + single writer بدون lock.
            try:
                conn.execute('PRAGMA journal_mode = WAL')
            except Exception:
                pass  # WAL مش متاح في كل الـ SQLite builds
            # تحقق إن الـ connection شغّال
            conn.execute('SELECT 1').fetchone()
            return conn
        except Exception as e:
            last_err = e
            log(f"  ⚠️ DB open attempt {attempt}/{MAX_RETRIES} failed: {e}")
            if attempt < MAX_RETRIES:
                log(f"  Retrying in {RETRY_DELAY}s...")
                time.sleep(RETRY_DELAY)
    raise RuntimeError(f"Cannot open DB after {MAX_RETRIES} attempts: {last_err}")

def execute_with_retry(cur, sql, params=None, label="query"):
    """نفّذ query مع retry لو الـ DB مقفول."""
    last_err = None
    for attempt in range(1, MAX_RETRIES + 1):
        try:
            if params:
                return cur.execute(sql, params)
            return cur.execute(sql)
        except sqlite3.OperationalError as e:
            last_err = e
            if 'locked' in str(e).lower() or 'busy' in str(e).lower():
                log(f"  ⚠️ {label} attempt {attempt}/{MAX_RETRIES}: DB locked, retrying in {RETRY_DELAY}s...")
                if attempt < MAX_RETRIES:
                    time.sleep(RETRY_DELAY)
                    continue
            raise  # Re-raise non-locking errors immediately
    raise last_err

def main():
    if not Path(DB).exists():
        print(f"ERROR: DB not found at {DB}")
        sys.exit(1)

    log("Opening DB (with retry + busy_timeout=60s + WAL mode)...")
    conn = open_db_with_retry()
    cur = conn.cursor()

    # ── BUG #1: hit_stop=1 AND actual_return > 0 → trailing_profit ────────────
    log("BUG #1: Fixing hit_stop=1 AND actual_return > 0 (STOPPED+profit contradiction)...")
    try:
        bad_stopped_profit = execute_with_retry(cur, """
            SELECT COUNT(*) FROM predictions
            WHERE hit_stop = 1 AND actual_return > 0
        """, label="BUG #1 SELECT").fetchone()[0]
        log(f"  Found {bad_stopped_profit} rows with STOPPED+profit contradiction")

        if bad_stopped_profit > 0:
            execute_with_retry(cur, """
                UPDATE predictions
                SET hit_stop = 0,
                    hit_target = 1,
                    is_correct = 1,
                    exit_type = 'trailing_profit',
                    status = 'CLOSED'
                WHERE hit_stop = 1 AND actual_return > 0
            """, label="BUG #1 UPDATE")
            log(f"  ✅ Fixed {cur.rowcount} rows → exit_type='trailing_profit'")
    except Exception as e:
        log(f"  ⚠️ BUG #1 fix skipped: {e}")

    # ── BUG #2: PENDING (outcome_date NULL) with actual_return → clear it ────
    log("BUG #2: Clearing actual_return for PENDING rows (pending+return contradiction)...")
    try:
        bad_pending_return = execute_with_retry(cur, """
            SELECT COUNT(*) FROM predictions
            WHERE outcome_date IS NULL AND actual_return IS NOT NULL
        """, label="BUG #2 SELECT").fetchone()[0]
        log(f"  Found {bad_pending_return} PENDING rows with stale actual_return")

        if bad_pending_return > 0:
            execute_with_retry(cur, """
                UPDATE predictions
                SET actual_return = NULL,
                    exit_price = NULL
                WHERE outcome_date IS NULL AND actual_return IS NOT NULL
            """, label="BUG #2 UPDATE")
            log(f"  ✅ Cleared actual_return for {cur.rowcount} PENDING rows")
    except Exception as e:
        log(f"  ⚠️ BUG #2 fix skipped: {e}")

    # ── BUG #4: highest/lowest = 0 or NULL for closed rows → set to entry ────
    log("BUG #4: Fixing highest_price_reached/lowest_price_reached = 0 for closed rows...")
    try:
        bad_high = execute_with_retry(cur, """
            SELECT COUNT(*) FROM predictions
            WHERE outcome_date IS NOT NULL
              AND (highest_price_reached IS NULL OR highest_price_reached = 0)
              AND entry_price > 0
        """, label="BUG #4 SELECT high").fetchone()[0]
        log(f"  Found {bad_high} closed rows with highest_price_reached=0/NULL")

        if bad_high > 0:
            execute_with_retry(cur, """
                UPDATE predictions
                SET highest_price_reached = entry_price
                WHERE outcome_date IS NOT NULL
                  AND (highest_price_reached IS NULL OR highest_price_reached = 0)
                  AND entry_price > 0
            """, label="BUG #4 UPDATE high")
            log(f"  ✅ Fixed highest_price_reached for {cur.rowcount} rows")

        bad_low = execute_with_retry(cur, """
            SELECT COUNT(*) FROM predictions
            WHERE outcome_date IS NOT NULL
              AND (lowest_price_reached IS NULL OR lowest_price_reached = 0)
              AND entry_price > 0
        """, label="BUG #4 SELECT low").fetchone()[0]
        if bad_low > 0:
            execute_with_retry(cur, """
                UPDATE predictions
                SET lowest_price_reached = entry_price
                WHERE outcome_date IS NOT NULL
                  AND (lowest_price_reached IS NULL OR lowest_price_reached = 0)
                  AND entry_price > 0
            """, label="BUG #4 UPDATE low")
            log(f"  ✅ Fixed lowest_price_reached for {cur.rowcount} rows")
    except Exception as e:
        log(f"  ⚠️ BUG #4 fix skipped: {e}")

    # ── Ensure exit_type column exists ───────────────────────────────────────
    log("Ensuring exit_type column exists...")
    try:
        execute_with_retry(cur, "PRAGMA table_info(predictions)", label="PRAGMA table_info")
        cols = [r[1] for r in cur.fetchall()]
        if 'exit_type' not in cols:
            execute_with_retry(cur, "ALTER TABLE predictions ADD COLUMN exit_type TEXT", label="ALTER exit_type")
            log("  ✅ Added exit_type column")
        else:
            log("  ✓ exit_type column already exists")
        if 'lowest_price_reached' not in cols:
            execute_with_retry(cur, "ALTER TABLE predictions ADD COLUMN lowest_price_reached REAL", label="ALTER lowest")
            log("  ✅ Added lowest_price_reached column")
        else:
            log("  ✓ lowest_price_reached column already exists")
    except Exception as e:
        log(f"  ⚠️ Column check skipped: {e}")

    conn.commit()

    # ── Summary ──────────────────────────────────────────────────────────────
    log("\n" + "=" * 60)
    log("MIGRATION SUMMARY")
    log("=" * 60)
    execute_with_retry(cur, """
        SELECT
            SUM(CASE WHEN hit_stop = 1 AND actual_return > 0 THEN 1 ELSE 0 END) as bug1_remaining,
            SUM(CASE WHEN outcome_date IS NULL AND actual_return IS NOT NULL THEN 1 ELSE 0 END) as bug2_remaining,
            SUM(CASE WHEN exit_type = 'trailing_profit' THEN 1 ELSE 0 END) as trailing_profit_count,
            SUM(CASE WHEN outcome_date IS NOT NULL THEN 1 ELSE 0 END) as closed_count,
            SUM(CASE WHEN outcome_date IS NULL THEN 1 ELSE 0 END) as pending_count,
            COUNT(*) as total
        FROM predictions
    """, label="SUMMARY SELECT")
    row = cur.fetchone()
    log(f"  Bug #1 remaining (STOPPED+profit): {row[0]}")
    log(f"  Bug #2 remaining (PENDING+return): {row[1]}")
    log(f"  trailing_profit rows: {row[2]}")
    log(f"  Closed rows: {row[3]}")
    log(f"  Pending rows: {row[4]}")
    log(f"  Total rows: {row[5]}")
    log("=" * 60)

    conn.close()
    log("\n✅ Migration complete. Run `pm2 restart python-backend` to apply.")

if __name__ == '__main__':
    main()
