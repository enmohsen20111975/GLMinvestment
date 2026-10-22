#!/usr/bin/env python3
"""
=============================================================================
🧹 Purge Corrupted Tickers — حذف الأسهم المشوهة من قاعدة البيانات
=============================================================================

PROBLEM:
- TradingView scraper القديم كان بيلصق أول حرف من اسم الشركة في الـ ticker.
- النتيجة: UBEE + U → UBEEU (name = "nited Bank SAE" — missing first letter).
- 63 corrupted ticker + 18 ISIN-style tickers = 81 fake stocks in DB.
- These appear in predictions/radar as "real" stocks → user confusion.

PATTERN DETECTION:
1. Corrupted ticker: UBEEU → base = UBEE (if UBEE exists in stocks.db, UBEEU is fake).
2. ISIN-style: EGS3I0S1C019 (14 chars, starts with EGS, has name_ar=NULL).

ACTION:
- Mark corrupted tickers as is_active=0 (deactivate, NOT delete).
- This preserves historical data but removes them from active scans.
- Safe: can be reversed with is_active=1.

Usage:
    python3 scripts/purge_corrupted_tickers.py --dry-run   # preview
    python3 scripts/purge_corrupted_tickers.py              # apply
    python3 scripts/purge_corrupted_tickers.py --reactivate # undo
"""
import argparse
import sqlite3
import sys
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent
STOCKS_DB = PROJECT_ROOT / 'db' / 'stocks.db'
PREDICTIONS_DB = PROJECT_ROOT / 'db' / 'predictions.db'


def find_corrupted_tickers(conn):
    """Find tickers where removing last char gives another ticker (UBEEU → UBEE)."""
    cur = conn.cursor()
    cur.execute("SELECT ticker, name, name_ar FROM stocks WHERE market='EGX' AND is_active=1")
    all_stocks = cur.fetchall()
    tickers = {r[0] for r in all_stocks}

    corrupted = []
    for t, name, ar in all_stocks:
        if len(t) < 4:
            continue
        base = t[:-1]
        if base in tickers and base != t:
            base_stock = next((s for s in all_stocks if s[0] == base), None)
            if base_stock:
                corrupted.append({
                    'corrupted_ticker': t,
                    'corrupted_name': name,
                    'real_ticker': base,
                    'real_name': base_stock[1],
                })
    return corrupted


def find_isin_tickers(conn):
    """Find ISIN-style tickers (EGS + 12+ chars, name_ar=NULL)."""
    cur = conn.cursor()
    cur.execute("""
        SELECT ticker, name, name_ar FROM stocks
        WHERE market='EGX' AND is_active=1
        AND ticker LIKE 'EGS%' AND LENGTH(ticker) > 6
    """)
    return [{'ticker': r[0], 'name': r[1], 'name_ar': r[2]} for r in cur.fetchall()]


def purge(dry_run=True, reactivate=False):
    if not STOCKS_DB.exists():
        print(f"❌ stocks.db not found: {STOCKS_DB}")
        return 1

    conn = sqlite3.connect(str(STOCKS_DB))
    conn.row_factory = sqlite3.Row
    cur = conn.cursor()

    corrupted = find_corrupted_tickers(conn)
    isins = find_isin_tickers(conn)

    print(f"\n{'='*70}")
    print(f"🧹 Purge Corrupted Tickers")
    print(f"{'='*70}\n")
    print(f"Found {len(corrupted)} corrupted tickers (UBEEU pattern)")
    print(f"Found {len(isins)} ISIN-style tickers (EGS3I0S1C019 pattern)")
    print(f"Total to {'reactivate' if reactivate else 'deactivate'}: {len(corrupted) + len(isins)}")
    print()

    if dry_run:
        print("=== DRY RUN — no changes will be made ===\n")
        print("Corrupted tickers (sample 10):")
        for c in corrupted[:10]:
            print(f"  {c['corrupted_ticker']:12s} → {c['real_ticker']:8s} | name: '{c['corrupted_name']}' → '{c['real_name']}'")
        if len(corrupted) > 10:
            print(f"  ... and {len(corrupted) - 10} more")
        print()
        print("ISIN-style tickers:")
        for i in isins:
            print(f"  {i['ticker']:20s} | name: {i['name']} | ar: {i['name_ar']}")
        print()
        print(f"Total: {len(corrupted) + len(isins)} stocks would be {'reactivated' if reactivate else 'deactivated'}")
        conn.close()
        return 0

    # Apply
    new_status = 1 if reactivate else 0
    action = "reactivated" if reactivate else "deactivated"

    # Deactivate corrupted tickers
    corrupted_count = 0
    for c in corrupted:
        cur.execute(
            "UPDATE stocks SET is_active = ? WHERE ticker = ? AND market = 'EGX'",
            (new_status, c['corrupted_ticker'])
        )
        corrupted_count += cur.rowcount

    # Deactivate ISIN tickers
    isin_count = 0
    for i in isins:
        cur.execute(
            "UPDATE stocks SET is_active = ? WHERE ticker = ? AND market = 'EGX'",
            (new_status, i['ticker'])
        )
        isin_count += cur.rowcount

    conn.commit()

    # Also clean stored_analyses for deactivated tickers
    if not reactivate:
        all_bad = [c['corrupted_ticker'] for c in corrupted] + [i['ticker'] for i in isins]
        if all_bad:
            conn_pred = sqlite3.connect(str(PREDICTIONS_DB))
            cur_pred = conn_pred.cursor()
            placeholders = ",".join("?" for _ in all_bad)
            cur_pred.execute(
                f"DELETE FROM stored_analyses WHERE ticker IN ({placeholders})",
                all_bad
            )
            deleted = cur_pred.rowcount
            conn_pred.commit()
            conn_pred.close()
            print(f"🗑️  Deleted {deleted} stored_analyses entries for bad tickers")

    print(f"\n✅ {corrupted_count} corrupted tickers {action}")
    print(f"✅ {isin_count} ISIN-style tickers {action}")
    print(f"\nTotal: {corrupted_count + isin_count} stocks {action}")

    conn.close()
    return 0


def main():
    parser = argparse.ArgumentParser(description='Purge corrupted tickers from stocks.db')
    parser.add_argument('--dry-run', action='store_true', help='Preview without changes')
    parser.add_argument('--reactivate', action='store_true', help='Reactivate (undo purge)')
    args = parser.parse_args()

    return purge(dry_run=args.dry_run, reactivate=args.reactivate)


if __name__ == '__main__':
    sys.exit(main())
