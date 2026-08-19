#!/usr/bin/env python3
"""
Database Structure Diagnostic
==============================
يفحص كل قواعد البيانات في مجلد db/ ويطبع:
  - الجداول في كل DB
  - الجداول المرتبطة بالأسعار (price/history/ohlc/candle)
  - عدد الصفوف + النطاق الزمني + الأعمدة
  - عيّنة بيانات

الاستخدام:
  python3 vps-service/tools/diagnose_db_structure.py
  python3 vps-service/tools/diagnose_db_structure.py --verbose
"""
import sqlite3
import os
import glob
import sys
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
DB_DIR = PROJECT_ROOT / 'db'

# Keywords that indicate price-related tables
PRICE_KEYWORDS = ['price', 'histor', 'ohlc', 'candle', 'quote', 'eod', 'bar']


def is_price_table(name):
    """Check if a table name looks like it contains price data."""
    lower = name.lower()
    return any(kw in lower for kw in PRICE_KEYWORDS)


def inspect_table(db_path, table_name, verbose=False):
    """Inspect a single table: row count, columns, date range, sample."""
    try:
        db = sqlite3.connect(f'file:{db_path}?mode=ro', uri=True, timeout=3)
        db.row_factory = sqlite3.Row

        # Row count
        count = db.execute(f'SELECT COUNT(*) FROM "{table_name}"').fetchone()[0]

        # Columns
        cols = [(c[1], c[2]) for c in db.execute(f'PRAGMA table_info("{table_name}")').fetchall()]
        col_names = [c[0] for c in cols]

        result = {
            'table': table_name,
            'rows': count,
            'columns': col_names,
            'date_col': None,
            'date_range': None,
            'ticker_col': None,
            'sample': None,
        }

        # Find date column
        date_candidates = [c for c in col_names if c.lower() in ('date', 'price_date', 'fetch_date', 'created_at', 'timestamp')]
        if date_candidates:
            date_col = date_candidates[0]
            result['date_col'] = date_col
            try:
                rng = db.execute(
                    f'SELECT MIN("{date_col}"), MAX("{date_col}") FROM "{table_name}" WHERE "{date_col}" IS NOT NULL'
                ).fetchone()
                result['date_range'] = (rng[0], rng[1])
            except Exception:
                pass

        # Find ticker/symbol column
        ticker_candidates = [c for c in col_names if c.lower() in ('ticker', 'symbol', 'stock_id', 'coin_id')]
        if ticker_candidates:
            result['ticker_col'] = ticker_candidates[0]
            try:
                tickers = db.execute(
                    f'SELECT COUNT(DISTINCT "{ticker_candidates[0]}") FROM "{table_name}"'
                ).fetchone()[0]
                result['distinct_tickers'] = tickers
            except Exception:
                pass

        # Sample row
        if verbose and count > 0:
            sample = db.execute(f'SELECT * FROM "{table_name}" LIMIT 1').fetchone()
            if sample:
                result['sample'] = dict(sample)

        db.close()
        return result
    except Exception as e:
        return {'table': table_name, 'error': str(e)}


def main():
    verbose = '--verbose' in sys.argv

    print("=" * 70)
    print("  Database Structure Diagnostic")
    print(f"  DB directory: {DB_DIR}")
    print("=" * 70)

    if not DB_DIR.exists():
        print(f"❌ مجلد db/ غير موجود: {DB_DIR}")
        return 1

    # Find all .db files
    db_files = sorted(set(
        glob.glob(str(DB_DIR / '*.db')) +
        glob.glob(str(DB_DIR / '**' / '*.db'), recursive=True)
    ))

    if not db_files:
        print("❌ لا توجد ملفات .db في المجلد")
        return 1

    print(f"\n📦 Found {len(db_files)} database files\n")

    price_tables_found = []

    for db_path in db_files:
        rel_path = os.path.relpath(db_path, PROJECT_ROOT)
        size_mb = os.path.getsize(db_path) / (1024 * 1024)

        print(f"─" * 70)
        print(f"📁 {rel_path} ({size_mb:.1f} MB)")
        print(f"─" * 70)

        try:
            db = sqlite3.connect(f'file:{db_path}?mode=ro', uri=True, timeout=3)
            tables = [r[0] for r in db.execute(
                "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"
            ).fetchall()]
            db.close()

            if not tables:
                print(f"   (لا توجد جداول)")
                continue

            print(f"   الجداول ({len(tables)}): {', '.join(tables[:10])}{'...' if len(tables) > 10 else ''}")

            # Inspect price-related tables in detail
            price_tables = [t for t in tables if is_price_table(t)]
            if price_tables:
                print(f"\n   📊 جداول الأسعار:")
                for t in price_tables:
                    info = inspect_table(db_path, t, verbose=verbose)
                    if 'error' in info:
                        print(f"      ❌ {t}: {info['error']}")
                        continue
                    print(f"      ✅ {t}")
                    print(f"         الصفوف: {info['rows']:,}")
                    print(f"         الأعمدة: {info['columns']}")
                    if info.get('ticker_col'):
                        print(f"         عمود الرمز: {info['ticker_col']} ({info.get('distinct_tickers', '?')} رمز)")
                    if info.get('date_col'):
                        print(f"         عمود التاريخ: {info['date_col']}")
                        if info['date_range']:
                            print(f"         النطاق: {info['date_range'][0]} → {info['date_range'][1]}")
                    if info.get('sample'):
                        sample_str = ', '.join(f"{k}={v}" for k, v in list(info['sample'].items())[:6])
                        print(f"         عيّنة: {sample_str}")
                    price_tables_found.append((rel_path, t, info))

            # Also show row counts for other tables
            non_price = [t for t in tables if not is_price_table(t)]
            if non_price and verbose:
                print(f"\n   📋 جداول أخرى:")
                for t in non_price[:5]:
                    info = inspect_table(db_path, t, verbose=False)
                    if 'error' not in info:
                        print(f"      {t}: {info['rows']:,} صف")

        except Exception as e:
            print(f"   ❌ خطأ: {e}")

        print()

    # Summary
    print("=" * 70)
    print("  SUMMARY — جداول الأسعار المكتشفة")
    print("=" * 70)
    if price_tables_found:
        for db_path, table, info in price_tables_found:
            print(f"\n  📊 {db_path} → {table}")
            print(f"     الصفوف: {info['rows']:,}")
            if info.get('date_range'):
                print(f"     النطاق: {info['date_range'][0]} → {info['date_range'][1]}")
            if info.get('ticker_col'):
                print(f"     الرموز: {info.get('distinct_tickers', '?')}")
            print(f"     الأعمدة: {info['columns']}")
    else:
        print("\n❌ لم يتم العثور على أي جداول أسعار!")

    print("\n" + "=" * 70)
    print("  التوصية:")
    print("=" * 70)
    if price_tables_found:
        best = max(price_tables_found, key=lambda x: x[2]['rows'])
        print(f"  أفضل مصدر للترحيل: {best[0]} → {best[1]}")
        print(f"  عدد الصفوف: {best[2]['rows']:,}")
        print(f"  عمود الرمز: {best[2].get('ticker_col', 'غير محدد')}")
        print(f"  عمود التاريخ: {best[2].get('date_col', 'غير محدد')}")
    else:
        print("  ❌ لا يوجد مصدر للبيانات — تأكد من تثبيت بيانات الأسعار")

    return 0


if __name__ == '__main__':
    sys.exit(main())
