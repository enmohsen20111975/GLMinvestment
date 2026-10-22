#!/usr/bin/env python3
"""
=============================================================================
🧹 Cleanup stored_analyses — حذف التوصيات المشوهة + القديمة
=============================================================================

PROBLEM:
- stored_analyses on production has OLD entries for corrupted tickers
- auto_poster.py reads stored_analyses and publishes to Telegram
- Even after purge_corrupted_tickers.py (is_active=0), the OLD entries remain
- User saw UBEEU in Telegram message because stored_analyses still had it

FIX:
- DELETE from stored_analyses WHERE ticker is corrupted (not in active stocks)
- DELETE from stored_analyses WHERE created_at is too old (>7 days)

Usage:
    python3 scripts/cleanup_stored_analyses.py --dry-run
    python3 scripts/cleanup_stored_analyses.py
"""
import argparse
import sqlite3
import sys
from pathlib import Path
from datetime import datetime, timedelta

PROJECT_ROOT = Path(__file__).resolve().parent.parent
PREDICTIONS_DB = PROJECT_ROOT / 'db' / 'predictions.db'
STOCKS_DB = PROJECT_ROOT / 'db' / 'stocks.db'


def cleanup(dry_run=True, max_age_days=7):
    if not PREDICTIONS_DB.exists():
        print(f"❌ predictions.db not found: {PREDICTIONS_DB}")
        return 1

    # Load active tickers from stocks.db
    active_tickers = set()
    if STOCKS_DB.exists():
        conn_s = sqlite3.connect(str(STOCKS_DB))
        cur_s = conn_s.cursor()
        cur_s.execute("SELECT ticker FROM stocks WHERE is_active = 1 OR is_active IS NULL")
        active_tickers = {r[0] for r in cur_s.fetchall()}
        conn_s.close()
        print(f"✅ Loaded {len(active_tickers)} active tickers from stocks.db")
    else:
        print("⚠️ stocks.db not found — cannot verify active tickers")
        return 1

    conn = sqlite3.connect(str(PREDICTIONS_DB))
    cur = conn.cursor()

    # Get all stored_analyses entries
    cur.execute("SELECT ticker, recommendation, confidence, created_at FROM stored_analyses")
    all_entries = cur.fetchall()
    print(f"\n📊 Total stored_analyses entries: {len(all_entries)}")

    # Find entries to delete:
    # 1. ticker not in active_tickers (corrupted/deactivated)
    # 2. created_at older than max_age_days
    cutoff_date = (datetime.now() - timedelta(days=max_age_days)).isoformat()

    to_delete = []
    for ticker, rec, conf, created in all_entries:
        reason = None
        if ticker not in active_tickers:
            reason = f'ticker not active (corrupted/deactivated)'
        elif created and created < cutoff_date:
            reason = f'older than {max_age_days} days'

        if reason:
            to_delete.append((ticker, rec, conf, created, reason))

    print(f"🗑️  Entries to delete: {len(to_delete)}")
    print(f"   - Corrupted/deactivated tickers: {sum(1 for t in to_delete if 'not active' in t[4])}")
    print(f"   - Older than {max_age_days} days: {sum(1 for t in to_delete if 'older' in t[4])}")

    if to_delete:
        print("\nEntries to be deleted:")
        for ticker, rec, conf, created, reason in to_delete[:20]:
            print(f"  {ticker:10s} | rec={rec:15s} | conf={conf} | created={created} | {reason}")
        if len(to_delete) > 20:
            print(f"  ... and {len(to_delete) - 20} more")

    if dry_run:
        print("\n=== DRY RUN — no changes made ===")
        conn.close()
        return 0

    # Delete
    deleted = 0
    for ticker, rec, conf, created, reason in to_delete:
        cur.execute(
            "DELETE FROM stored_analyses WHERE ticker = ? AND created_at = ?",
            (ticker, created)
        )
        deleted += cur.rowcount

    conn.commit()
    conn.close()

    print(f"\n✅ Deleted {deleted} entries from stored_analyses")
    return 0


def main():
    parser = argparse.ArgumentParser(description='Cleanup stored_analyses — remove corrupted + stale entries')
    parser.add_argument('--dry-run', action='store_true', help='Preview without changes')
    parser.add_argument('--max-age-days', type=int, default=7, help='Delete entries older than N days (default: 7)')
    args = parser.parse_args()

    return cleanup(dry_run=args.dry_run, max_age_days=args.max_age_days)


if __name__ == '__main__':
    sys.exit(main())
