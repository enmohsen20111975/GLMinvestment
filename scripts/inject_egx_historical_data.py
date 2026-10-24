#!/usr/bin/env python3
"""
inject_egx_historical_data.py — حقن بيانات EGX التاريخية الناقصة
====================================================================
يدعم 3 مصادر للبيانات:
  1. stock_daily_prices (EODHD النظيفة) — المصدر الافتراضي
  2. CSV import — استيراد من ملف CSV (للبيانات من VPS/اللابتوب)
  3. VPS sync — مزامنة من VPS عبر SSH (لو متاح)

الاستخدام:
  python3 scripts/inject_egx_historical_data.py --dry-run    # فحص فقط
  python3 scripts/inject_egx_historical_data.py              # حقن فعلي
  python3 scripts/inject_egx_historical_data.py --ticker=COMI  # سهم محدد
  python3 scripts/inject_egx_historical_data.py --csv=data.csv  # استيراد من CSV
  python3 scripts/inject_egx_historical_data.py --csv-dir=./csv_data  # استيراد من مجلد CSVs

CSV format (headers required):
  ticker,date,open,high,low,close,volume
  COMI,2026-01-01,130.0,132.0,129.5,131.5,1000000
  ...
"""

import sqlite3
import os
import sys
import shutil
import argparse
from pathlib import Path
from datetime import datetime

PROJECT_ROOT = Path(__file__).parent.parent.resolve()
STOCKS_DB = PROJECT_ROOT / 'db' / 'stocks.db'
PRICE_DB = PROJECT_ROOT / 'db' / 'price_history.db'
BACKFILL_SOURCE = 'egksco_backfill'


def get_stocks_to_inject(specific_ticker=None):
    """تحديد الأسهم التي تحتاج حقن."""
    # Phase 7.1: migrated to db_manager (writable=False)
    from core.db_manager import db_manager
    conn = db_manager.connection(str(PRICE_DB), writable=False).__enter__()
    cur = conn.cursor()
    
    if specific_ticker:
        cur.execute("""
            SELECT DISTINCT ticker FROM price_history
            WHERE ticker = ? AND source = 'egksco'
        """, (specific_ticker,))
    else:
        # كل الأسهم التي لها بيانات egksco (نظيفة) لكن قليلة
        cur.execute("""
            SELECT ticker, COUNT(*) as cnt
            FROM price_history
            WHERE source = 'egksco'
            GROUP BY ticker
            HAVING cnt < 30
            ORDER BY ticker
        """)
    
    tickers = [r[0] for r in cur.fetchall()]
    conn.close()
    return tickers


def inject_ticker(ticker, dry_run=False):
    """حقن بيانات stock_daily_prices لسهم محدد في price_history.db."""
    # Phase 7.1: migrated to db_manager (writable=False)
    from core.db_manager import db_manager
    stocks_conn = db_manager.connection(str(STOCKS_DB), writable=False).__enter__()
    stocks_conn.row_factory = sqlite3.Row
    stocks_cur = stocks_conn.cursor()
    
    # جلب بيانات EODHD النظيفة من stock_daily_prices
    stocks_cur.execute("""
        SELECT ticker, price_date as date, open, high, low, close, volume
        FROM stock_daily_prices
        WHERE ticker = ? AND close IS NOT NULL AND close > 0
        ORDER BY price_date
    """, (ticker,))
    rows = [dict(r) for r in stocks_cur.fetchall()]
    stocks_conn.close()
    
    if not rows:
        return {'ticker': ticker, 'injected': 0, 'skipped': 'no stock_daily_prices data', 'date_range': None}
    
    # تحقق مما هو موجود بالفعل في price_history (idempotent)
    # Phase 7.1: migrated to db_manager (writable=False)
    from core.db_manager import db_manager
    price_conn = db_manager.connection(str(PRICE_DB), writable=False).__enter__()
    price_cur = price_conn.cursor()
    price_cur.execute("""
        SELECT date FROM price_history
        WHERE ticker = ? AND source = ?
    """, (ticker, BACKFILL_SOURCE))
    existing_dates = {r[0] for r in price_cur.fetchall()}
    
    # فلترة: فقط التواريخ غير الموجودة
    new_rows = [r for r in rows if r['date'] not in existing_dates]
    
    if not new_rows:
        price_conn.close()
        return {
            'ticker': ticker,
            'injected': 0,
            'skipped': 'already up to date',
            'date_range': f"{rows[0]['date']} to {rows[-1]['date']}",
            'total_available': len(rows),
        }
    
    if dry_run:
        price_conn.close()
        return {
            'ticker': ticker,
            'would_inject': len(new_rows),
            'date_range': f"{new_rows[0]['date']} to {new_rows[-1]['date']}",
            'total_available': len(rows),
        }
    
    # حقن فعلي
    inserted = 0
    
    def _parse_volume(v):
        """تحويل volume بأمان (int, float, أو نص مثل '26.92 M' → 26920000)."""
        if v is None:
            return 0
        try:
            return int(v)
        except (ValueError, TypeError):
            pass
        try:
            s = str(v).strip().replace('\u202f', '').replace(' ', '').replace(',', '')
            if s.endswith('M'):
                return int(float(s[:-1]) * 1_000_000)
            elif s.endswith('K'):
                return int(float(s[:-1]) * 1_000)
            elif s.endswith('B'):
                return int(float(s[:-1]) * 1_000_000_000)
            return int(float(s))
        except (ValueError, TypeError):
            return 0
    
    for r in new_rows:
        try:
            price_cur.execute("""
                INSERT INTO price_history (ticker, date, open_price, high_price, low_price, close_price, volume, source, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (
                ticker,
                r['date'],
                float(r['open']) if r['open'] else None,
                float(r['high']) if r['high'] else None,
                float(r['low']) if r['low'] else None,
                float(r['close']) if r['close'] else None,
                _parse_volume(r['volume']),
                BACKFILL_SOURCE,
                datetime.now().isoformat(),
            ))
            inserted += 1
        except Exception as e:
            print(f'  ⚠️ {ticker} {r["date"]}: {e}')
    
    price_conn.commit()
    price_conn.close()
    
    return {
        'ticker': ticker,
        'injected': inserted,
        'date_range': f"{new_rows[0]['date']} to {new_rows[-1]['date']}",
        'total_available': len(rows),
    }


def inject_from_csv(csv_path, dry_run=False):
    """استيراد بيانات تاريخية من ملف CSV."""
    import csv
    results = {'file': csv_path, 'injected': 0, 'tickers': set(), 'errors': []}

    if not os.path.exists(csv_path):
        results['errors'].append(f'File not found: {csv_path}')
        return results

    # backup
    if not dry_run:
        backup_path = PRICE_DB.with_suffix(f'.db.before_csv_{int(datetime.now().timestamp())}')
        shutil.copy(str(PRICE_DB), str(backup_path))

    # Phase 7.1: migrated to db_manager (writable=False)
    from core.db_manager import db_manager
    conn = db_manager.connection(str(PRICE_DB), writable=False).__enter__()
    cur = conn.cursor()

    with open(csv_path, 'r', encoding='utf-8') as f:
        reader = csv.DictReader(f)
        for row in reader:
            try:
                ticker = row.get('ticker', '').upper().strip()
                date = row.get('date', '').strip()
                close = float(row.get('close', 0) or 0)
                if not ticker or not date or close <= 0:
                    continue

                open_p = float(row.get('open', 0) or 0)
                high_p = float(row.get('high', 0) or 0)
                low_p = float(row.get('low', 0) or 0)
                volume = _parse_volume(row.get('volume', 0))

                if dry_run:
                    results['injected'] += 1
                    results['tickers'].add(ticker)
                    continue

                cur.execute("""
                    INSERT OR IGNORE INTO price_history
                    (ticker, date, open_price, high_price, low_price, close_price, volume, source, created_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                """, (ticker, date, open_p or None, high_p or None, low_p or None, close,
                      volume, BACKFILL_SOURCE, datetime.now().isoformat()))
                if cur.rowcount > 0:
                    results['injected'] += 1
                    results['tickers'].add(ticker)
            except Exception as e:
                results['errors'].append(f'{row.get("ticker","?")}: {e}')

    if not dry_run:
        conn.commit()
    conn.close()
    results['tickers'] = list(results['tickers'])
    return results


def main():
    parser = argparse.ArgumentParser(description='حقن بيانات EGX التاريخية الناقصة')
    parser.add_argument('--dry-run', action='store_true', help='فحص فقط بدون حقن')
    parser.add_argument('--ticker', type=str, help='سهم محدد')
    parser.add_argument('--csv', type=str, help='استيراد من ملف CSV')
    parser.add_argument('--csv-dir', type=str, help='استيراد من مجلد CSVs')
    args = parser.parse_args()

    print(f'═══ حقن بيانات EGX التاريخية ═══')
    print(f'Mode: {"DRY-RUN" if args.dry_run else "ACTIVE"}')

    # CSV import mode
    if args.csv or args.csv_dir:
        csv_files = []
        if args.csv:
            csv_files.append(args.csv)
        if args.csv_dir:
            for f in sorted(os.listdir(args.csv_dir)):
                if f.endswith('.csv'):
                    csv_files.append(os.path.join(args.csv_dir, f))

        print(f'CSV files: {len(csv_files)}')
        total_injected = 0
        for csv_file in csv_files:
            print(f'\n📊 Importing {csv_file}...')
            result = inject_from_csv(csv_file, dry_run=args.dry_run)
            print(f'  {"سيُحقن" if args.dry_run else "حقن"}: {result["injected"]} سجل، {len(result["tickers"])} سهم')
            if result['errors']:
                print(f'  ⚠️ {len(result["errors"])} أخطاء')
            total_injected += result['injected']
        print(f'\n═══ النتيجة: {total_injected} سجل {"سيُحقن" if args.dry_run else "محُقن"} ═══')
        sys.exit(0)

    # Default: inject from stock_daily_prices
    print(f'Source: stock_daily_prices (EODHD)')
    print()

    if not STOCKS_DB.exists() or not PRICE_DB.exists():
        print('❌ stocks.db or price_history.db not found')
        sys.exit(1)
    
    # backup قبل الحقن
    if not args.dry_run:
        backup_path = PRICE_DB.with_suffix(f'.db.before_inject_{int(datetime.now().timestamp())}')
        shutil.copy(str(PRICE_DB), str(backup_path))
        print(f'✅ Backup: {backup_path}')
        print()
    
    # تحديد الأسهم
    tickers = get_stocks_to_inject(args.ticker)
    print(f'الأسهم المرشحة للحقن: {len(tickers)}')
    if args.ticker:
        print(f'  (محدد: {args.ticker})')
    print()
    
    if not tickers:
        print('ℹ️ لا توجد أسهم تحتاج حقن')
        sys.exit(0)
    
    results = []
    total_injected = 0
    
    for ticker in tickers:
        result = inject_ticker(ticker, dry_run=args.dry_run)
        results.append(result)
        
        if result.get('injected', 0) > 0 or result.get('would_inject', 0) > 0:
            count = result.get('injected', result.get('would_inject', 0))
            total_injected += count
            action = 'حقن' if not args.dry_run else 'سيُحقن'
            print(f'  ✅ {ticker}: {action} {count} سجل ({result["date_range"]})')
        else:
            print(f'  ℹ️ {ticker}: {result.get("skipped", "no action")} (متاح: {result.get("total_available", 0)})')
    
    print()
    print(f'═══ النتيجة ═══')
    if args.dry_run:
        print(f'  سيتم حقن: {total_injected} سجل')
    else:
        print(f'  تم حقن: {total_injected} سجل')
        print(f'  المصدر: {BACKFILL_SOURCE}')
    
    # تحقق من النتيجة
    if not args.dry_run and total_injected > 0:
        print()
        print(f'═══ التحقق ═══')
        # Phase 7.1: migrated to db_manager (writable=False)
        from core.db_manager import db_manager
        conn = db_manager.connection(str(PRICE_DB), writable=False).__enter__()
        cur = conn.cursor()
        for r in results:
            if r.get('injected', 0) > 0:
                cur.execute("""
                    SELECT source, COUNT(*) FROM price_history
                    WHERE ticker = ? GROUP BY source ORDER BY source
                """, (r['ticker'],))
                sources = cur.fetchall()
                print(f'  {r["ticker"]}: {sources}')
        conn.close()


if __name__ == '__main__':
    main()
