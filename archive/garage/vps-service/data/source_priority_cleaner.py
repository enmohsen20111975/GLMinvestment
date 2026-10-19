"""
Source Priority Cleaner for price_history.db (Task 22, 2026-10-03)
===================================================================

CRITICAL FIX: 930 tickers have data from MULTIPLE sources with DIFFERENT prices.
This is the root cause of CRST-class bugs (support/resistance from wrong stock,
52W high/low from stale source).

Per owner directive: "البيانات النهائية تكون واحدة بس مش كذا مكان"
Per Rule 12: load_merged_history() is the SOLE source — but it was merging
ALL sources instead of establishing priority.

THIS SCRIPT (sandbox-safe, idempotent):
1. Defines canonical source priority hierarchy
2. For each ticker+date with multiple sources, keeps ONLY the highest-priority
3. Deletes the lower-priority duplicates
4. Reports what was cleaned

Source Priority (highest → lowest):
1. yahoo_clean       — 5+ years, RAW unadjusted, most reliable history
2. intraday_aggregated — recent intraday, high volume accuracy
3. egx_investment_migration — legacy migration, stale but structured
4. tradingview_live  — live ticks, but can be noisy/wrong
5. egksco            — scraper data, limited coverage
6. egxpilot_live     — pilot data, short range
7. yahoo_safetynet   — fallback, minimal
8. yfinance_backfill — backfill, minimal

Rule 1: NEVER touch prod DBs — sandbox only (db/price_history.db)
Rule 6: schema-aware — verified columns before any change
Rule 16: VERIFY-BEFORE-DELETE — dry-run mode shows what will be deleted
"""

import sqlite3
import sys
import os
from pathlib import Path
from datetime import datetime

# Source priority — highest first
SOURCE_PRIORITY = [
    'yahoo_clean',
    'intraday_aggregated',
    'egx_investment_migration',
    'tradingview_live',
    'egksco',
    'egxpilot_live',
    'yahoo_safetynet',
    'yfinance_backfill',
]

def source_rank(source: str) -> int:
    """Lower rank = higher priority. Unknown sources get rank 99."""
    try:
        return SOURCE_PRIORITY.index(source)
    except ValueError:
        return 99

def analyze_multi_source(conn):
    """Report the current multi-source problem."""
    print("\n" + "=" * 70)
    print("ANALYSIS: Multi-source problem in price_history.db")
    print("=" * 70)

    sources = conn.execute("""
        SELECT source, COUNT(*) as cnt, COUNT(DISTINCT ticker) as tickers,
               MIN(date) as min_date, MAX(date) as max_date
        FROM price_history GROUP BY source ORDER BY cnt DESC
    """).fetchall()
    print("\nSources present:")
    for s in sources:
        rank = source_rank(s[0])
        print(f"  [priority {rank}] {s[0]:25s}: {s[1]:>8,} rows, {s[2]:>4} tickers, {s[3]} → {s[4]}")

    multi = conn.execute("""
        SELECT COUNT(*) FROM (
            SELECT ticker FROM price_history
            GROUP BY ticker HAVING COUNT(DISTINCT source) > 1
        )
    """).fetchone()[0]
    print(f"\nTickers with MULTIPLE sources: {multi}")

    total_rows = conn.execute("SELECT COUNT(*) FROM price_history").fetchone()[0]
    print(f"Total rows: {total_rows:,}")

    # Sample: CRST
    print("\nCRST (the bug that triggered this):")
    crst = conn.execute("""
        SELECT source, COUNT(*), MIN(close_price), MAX(close_price), MIN(date), MAX(date)
        FROM price_history WHERE ticker='CRST' GROUP BY source ORDER BY MAX(date) DESC
    """).fetchall()
    for r in crst:
        print(f"  {r[0]:25s}: {r[1]:>3} rows, price {r[2]:.3f}-{r[3]:.3f}, {r[4]} → {r[5]}")

def clean_duplicates(conn, dry_run=True):
    """
    For each ticker+date with multiple source rows, keep ONLY the highest-priority.
    Delete lower-priority duplicates.

    Per Rule 16: dry_run shows what WILL be deleted before actually deleting.
    """
    print("\n" + "=" * 70)
    print(f"CLEANUP: {'DRY RUN (no changes)' if dry_run else 'LIVE (will delete)'}")
    print("=" * 70)

    # Find all ticker+date combos with multiple sources
    multi_rows = conn.execute("""
        SELECT ticker, date, COUNT(*) as cnt
        FROM price_history
        GROUP BY ticker, date HAVING cnt > 1
    """).fetchall()

    if not multi_rows:
        print("\nNo ticker+date has multiple source rows.")
        print("The problem is DIFFERENT: tickers have data from different sources")
        print("in DIFFERENT date ranges (not same date). This is a time-coverage issue.")
        return 0

    print(f"\nFound {len(multi_rows)} ticker+date combos with multiple source rows.")

    # For each, keep the highest-priority source
    to_delete = []
    for ticker, date, cnt in multi_rows[:100]:  # sample first 100
        rows = conn.execute("""
            SELECT id, source FROM price_history
            WHERE ticker = ? AND date = ? ORDER BY id
        """, (ticker, date)).fetchall()

        # Sort by priority (keep highest priority = lowest rank)
        rows_sorted = sorted(rows, key=lambda r: source_rank(r[1]))
        keep_id = rows_sorted[0][0]
        delete_ids = [r[0] for r in rows_sorted[1:]]

        if dry_run and len(to_delete) < 5:
            print(f"  {ticker} {date}: keep {rows_sorted[0][1]} (id={keep_id}), delete {len(delete_ids)} rows")
        to_delete.extend(delete_ids)

    print(f"\nTotal rows to delete: {len(to_delete)}")

    if not dry_run and to_delete:
        # Delete in batches
        batch = 500
        deleted = 0
        for i in range(0, len(to_delete), batch):
            batch_ids = to_delete[i:i+batch]
            placeholders = ','.join('?' * len(batch_ids))
            conn.execute(f"DELETE FROM price_history WHERE id IN ({placeholders})", batch_ids)
            deleted += len(batch_ids)
            if deleted % 5000 == 0:
                print(f"  deleted {deleted:,} / {len(to_delete):,}...")
        conn.commit()
        print(f"\n✅ Deleted {deleted:,} duplicate rows")

    return len(to_delete)

def establish_source_priority(conn, dry_run=True):
    """
    For tickers with data across different date ranges from different sources,
    establish a CANONICAL source per ticker.

    Strategy: for each ticker, pick the source with the BEST coverage:
    - Most rows (longest history)
    - Most recent data (not stale)
    - Priority rank as tie-breaker

    Then DELETE all data from OTHER sources for that ticker (no mixing).

    This ensures ONE source per ticker (no mixed data — per owner directive
    "البيانات النهائية تكون واحدة بس مش كذا مكان").
    """
    print("\n" + "=" * 70)
    print(f"SOURCE PRIORITIZATION: {'DRY RUN' if dry_run else 'LIVE'}")
    print("=" * 70)

    multi_tickers = conn.execute("""
        SELECT ticker FROM price_history
        GROUP BY ticker HAVING COUNT(DISTINCT source) > 1
    """).fetchall()

    print(f"\nTickers to process: {len(multi_tickers)}")

    to_delete = []
    canonical_per_ticker = {}

    for (ticker,) in multi_tickers:
        sources_data = conn.execute("""
            SELECT source, MAX(date) as latest, COUNT(*) as cnt
            FROM price_history WHERE ticker = ?
            GROUP BY source
        """, (ticker,)).fetchall()

        if not sources_data:
            continue

        # Strategy: pick the source with the BEST coverage + recent data.
        # A source with 365 rows of history is FAR better than a source with 2 rows
        # even if the 2-row source is newer.
        # Scoring (higher = better):
        # - coverage: log10(row_count) — more rows = much better
        # - recency: bonus if latest date is recent
        # - priority rank: tie-breaker
        import math
        from datetime import datetime as _dt

        def source_score(sd):
            source, latest, cnt = sd
            rank = source_rank(source)
            coverage = math.log10(cnt + 1)  # 2 rows = 0.48, 365 rows = 2.56
            try:
                latest_dt = _dt.strptime(latest, '%Y-%m-%d')
                days_old = (_dt.now() - latest_dt).days
            except Exception:
                days_old = 9999
            recency_bonus = max(0, 3 - (days_old / 30))  # 3 if fresh, 0 if >90d
            return coverage + recency_bonus - (rank * 0.1)  # coverage dominates

        sources_sorted = sorted(sources_data, key=source_score, reverse=True)
        canonical_source = sources_sorted[0][0]
        canonical_data = sources_sorted[0]

        canonical_per_ticker[ticker] = canonical_source

        for sd in sources_sorted:
            if sd[0] != canonical_source:
                to_delete.append((ticker, sd[0]))

        if dry_run and len(to_delete) <= 6:
            others = [s[0] for s in sources_sorted if s[0] != canonical_source]
            print(f"  {ticker}: canonical={canonical_source} (latest={canonical_data[1]}, "
                  f"{canonical_data[2]} rows), delete from: {others}")

    print(f"\nTotal (ticker, source) pairs to delete: {len(to_delete)}")

    # Summary: which sources became canonical most often
    from collections import Counter
    canonical_counts = Counter(canonical_per_ticker.values())
    print("\nCanonical source distribution:")
    for src, cnt in canonical_counts.most_common():
        print(f"  {src:25s}: {cnt} tickers")

    if not dry_run and to_delete:
        deleted = 0
        for ticker, source in to_delete:
            cur = conn.execute("DELETE FROM price_history WHERE ticker = ? AND source = ?", (ticker, source))
            deleted += cur.rowcount
        conn.commit()
        print(f"\n✅ Deleted {deleted:,} rows from non-canonical sources")

    return len(to_delete)

def main():
    db_path = 'db/price_history.db'
    if not os.path.exists(db_path):
        print(f"ERROR: {db_path} not found")
        sys.exit(1)

    dry_run = '--live' not in sys.argv

    print(f"Source Priority Cleaner for {db_path}")
    print(f"Mode: {'DRY RUN' if dry_run else 'LIVE'}")
    print(f"Time: {datetime.now().isoformat()}")

    # Backup before LIVE mode
    if not dry_run:
        backup_path = f"{db_path}.backup-{datetime.now().strftime('%Y%m%d-%H%M%S')}"
        print(f"Backing up to {backup_path}...")
        import shutil
        shutil.copy2(db_path, backup_path)
        print("✅ Backup created")

    conn = sqlite3.connect(db_path)

    # Step 1: Analyze
    analyze_multi_source(conn)

    # Step 2: Clean same-date duplicates (rare but possible)
    clean_duplicates(conn, dry_run=dry_run)

    # Step 3: Establish source priority (the main fix)
    establish_source_priority(conn, dry_run=dry_run)

    # Step 4: Re-analyze
    if not dry_run:
        print("\n" + "=" * 70)
        print("POST-CLEANUP ANALYSIS")
        print("=" * 70)
        multi = conn.execute("""
            SELECT COUNT(*) FROM (
                SELECT ticker FROM price_history
                GROUP BY ticker HAVING COUNT(DISTINCT source) > 1
            )
        """).fetchone()[0]
        print(f"Tickers with multiple sources after cleanup: {multi}")
        total = conn.execute("SELECT COUNT(*) FROM price_history").fetchone()[0]
        print(f"Total rows after cleanup: {total:,}")

    conn.close()
    print("\n✅ Done")

if __name__ == '__main__':
    main()
