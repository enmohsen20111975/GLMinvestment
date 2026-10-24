#!/usr/bin/env python3
"""
export_price_history.py — تصدير البيانات التاريخية من price_history.db إلى CSV
==============================================================================
شغّله على VPS/اللابتوب لتصدير البيانات، ثم انقل الـ CSV للساندبوكس واستورده
بـ inject_egx_historical_data.py --csv

الاستخدام:
  python3 scripts/export_price_history.py                    # كل الأسهم
  python3 scripts/export_price_history.py --tickers COMI,PHDC  # أسهم محددة
  python3 scripts/export_price_history.py --output=data.csv  # ملف محدد
"""
import sqlite3
import csv
import argparse
import sys
from pathlib import Path

DB_PATH = Path(__file__).parent.parent / 'db' / 'price_history.db'
DEFAULT_OUTPUT = Path(__file__).parent.parent / 'db' / 'price_history_export.csv'


def main():
    parser = argparse.ArgumentParser(description='تصدير البيانات التاريخية إلى CSV')
    parser.add_argument('--tickers', type=str, help='أسهم محددة (مفصولة بفاصلة)')
    parser.add_argument('--output', type=str, default=str(DEFAULT_OUTPUT), help='ملف الإخراج')
    args = parser.parse_args()

    if not DB_PATH.exists():
        print(f'❌ DB not found: {DB_PATH}')
        sys.exit(1)

    # Phase 7.1: migrated to db_manager (writable=False)
    from core.db_manager import db_manager
    conn = db_manager.connection(DB_PATH, writable=False).__enter__()
    cur = conn.cursor()

    # تحديد الأسهم
    if args.tickers:
        tickers = [t.strip().upper() for t in args.tickers.split(',')]
        placeholders = ','.join(['?'] * len(tickers))
        cur.execute(f"""
            SELECT ticker, date, open_price, high_price, low_price, close_price, volume, source
            FROM price_history
            WHERE ticker IN ({placeholders})
            ORDER BY ticker, date
        """, tickers)
    else:
        cur.execute("""
            SELECT ticker, date, open_price, high_price, low_price, close_price, volume, source
            FROM price_history
            ORDER BY ticker, date
        """)

    rows = cur.fetchall()
    conn.close()

    if not rows:
        print('❌ لا توجد بيانات للتصدير')
        sys.exit(1)

    # كتابة CSV
    output_path = Path(args.output)
    output_path.parent.mkdir(parents=True, exist_ok=True)

    with open(output_path, 'w', newline='', encoding='utf-8') as f:
        writer = csv.writer(f)
        writer.writerow(['ticker', 'date', 'open', 'high', 'low', 'close', 'volume', 'source'])
        for row in rows:
            writer.writerow(row)

    # إحصائيات
    tickers_set = set(r[0] for r in rows)
    print(f'✅ تم التصدير: {output_path}')
    print(f'   السجلات: {len(rows)}')
    print(f'   الأسهم: {len(tickers_set)}')
    if args.tickers:
        print(f'   المحدد: {args.tickers}')

    print(f'\n💡 للاستيراد في الساندبوكس:')
    print(f'   python3 scripts/inject_egx_historical_data.py --csv={output_path.name}')


if __name__ == '__main__':
    main()
