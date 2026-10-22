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
    """Find tickers where removing last char gives another ticker (UBEEU → UBEE).

    CORRUPTION-PATTERN (2026-10-22 update):
    - NOT all suffix-tickers are fake. Some are real preferred shares.
    - Detection logic:
      1. ticker = base + extra_char AND base exists in stocks.db
      2. extra_char matches FIRST letter of company's English name
      3. CORRUPTED if: price_history rows < 100 (recent scraper artifact, ~55 rows)
         OR name starts with lowercase letter (scraper stripped first char)
      4. REAL (preferred) if: price_history rows >= 100 (established stock)
         AND name is properly capitalized
    """
    import sqlite3 as _sqlite3
    cur = conn.cursor()
    cur.execute("SELECT ticker, name, name_ar FROM stocks WHERE market='EGX' AND is_active=1")
    all_stocks = cur.fetchall()
    tickers = {r[0]: r for r in all_stocks}

    # Load price_history row counts to distinguish real vs fake
    ph_db = PROJECT_ROOT / 'db' / 'price_history.db'
    ph_counts = {}
    if ph_db.exists():
        ph_conn = _sqlite3.connect(str(ph_db))
        ph_cur = ph_conn.cursor()
        ph_cur.execute("SELECT ticker, COUNT(*) FROM price_history GROUP BY ticker")
        ph_counts = dict(ph_cur.fetchall())
        ph_conn.close()

    corrupted = []
    for t, name, ar in all_stocks:
        if len(t) < 4:
            continue
        base = t[:-1]
        if base not in tickers or base == t:
            continue

        base_stock = tickers[base]
        base_name = base_stock[1] or ''

        # Check 1: extra char = first letter of base name?
        extra = t[-1]
        first_char = base_name[0].upper() if base_name else '?'
        matches_first_char = (extra.upper() == first_char)

        # Check 2: price_history row count
        ph_rows = ph_counts.get(t, 0)
        base_ph_rows = ph_counts.get(base, 0)

        # Check 3: name corruption (starts with lowercase = scraper stripped first char)
        name_starts_lowercase = bool(name) and name[0].islower()

        # DECISION:
        # CORRUPTED if:
        #   - matches_first_char AND (ph_rows < 100 OR name_starts_lowercase)
        # REAL (preferred) if:
        #   - ph_rows >= 100 AND not name_starts_lowercase
        is_corrupted = matches_first_char and (ph_rows < 100 or name_starts_lowercase)

        if is_corrupted:
            corrupted.append({
                'corrupted_ticker': t,
                'corrupted_name': name,
                'real_ticker': base,
                'real_name': base_name,
                'ph_rows': ph_rows,
                'base_ph_rows': base_ph_rows,
                'name_starts_lowercase': name_starts_lowercase,
                'reason': (
                    'name_starts_lowercase' if name_starts_lowercase
                    else f'low_ph_rows ({ph_rows} < 100, base has {base_ph_rows})'
                ),
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
        print("Corrupted tickers (fake, will be deactivated):")
        for c in corrupted:
            print(f"  {c['corrupted_ticker']:12s} → {c['real_ticker']:8s} | ph_rows={c['ph_rows']:>4d} | reason={c['reason']} | name='{c['corrupted_name'][:40]}'")
        print()
        print(f"Total corrupted: {len(corrupted)}")
        print()
        print("ISIN-style tickers (will be deactivated):")
        for i in isins:
            print(f"  {i['ticker']:20s} | name: {i['name']}")
        print()
        print(f"Total to deactivate: {len(corrupted) + len(isins)}")
        print()
        print("NOTE: Preferred shares (FAITA, CCAPP) are PRESERVED (ph_rows >= 100 + proper name).")
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
