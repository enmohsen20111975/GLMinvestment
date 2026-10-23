#!/usr/bin/env python3
"""
import_indices_csv.py — استيراد بيانات المؤشرات التاريخية من CSV
================================================================================

الاستخدام:
  1. ضع ملفات CSV في مجلد data/ (مثلاً data/egx30_history.csv)
  2. شغّل السكربت:
     .venv/bin/python vps-service/scripts/import_indices_csv.py data/egx30_history.csv

  صيغة CSV المتوقعة (أي من هذه الصيغ):
    date,value,change,change_percent
    2026-01-01,1200,5,0.4
    2026-01-02,1210,10,0.8
    
  أو:
    date,close,change_pct
    2026-01-01,1200,0.4
    
  أو (TradingView export):
    time,open,high,low,close,volume
    2026-01-01,1195,1210,1190,1200,1000000

الـ symbol يُحدد من اسم الملف (مثلاً egx30_history.csv → EGX30)
================================================================================
"""

import sqlite3
import csv
import sys
import os
from pathlib import Path
from datetime import datetime

PROJECT_ROOT = Path(__file__).resolve().parents[2]
DB_PATH = PROJECT_ROOT / 'db' / 'stocks.db'


def log(msg, level='INFO'):
    ts = datetime.now().strftime('%H:%M:%S')
    print(f"[{ts}] {level}: {msg}")


def detect_symbol_from_filename(filepath: str) -> str:
    """استخراج رمز المؤشر من اسم الملف"""
    name = os.path.basename(filepath).lower()
    if 'egx30' in name or 'egx_30' in name:
        return 'EGX30'
    elif 'egx70' in name or 'egx_70' in name:
        return 'EGX70'
    elif 'egx100' in name or 'egx_100' in name:
        return 'EGX100'
    elif 'egx33' in name:
        return 'EGX33'
    elif 'egx50' in name:
        return 'EGX50'
    # افتراضي
    return 'EGX30'


def import_csv(filepath: str, symbol: str = None):
    """استيراد ملف CSV إلى stocks.db.market_indices_history"""
    if not os.path.exists(filepath):
        log(f"❌ الملف غير موجود: {filepath}", 'ERROR')
        return 0

    if not symbol:
        symbol = detect_symbol_from_filename(filepath)

    log(f"📊 استيراد {filepath} → symbol={symbol}")

    # قراءة CSV
    rows = []
    with open(filepath, 'r', encoding='utf-8-sig') as f:
        reader = csv.DictReader(f)
        raw_rows = list(reader)

    if not raw_rows:
        log("  ❌ ملف CSV فارغ", 'ERROR')
        return 0

    # اكتشاف أسماء الأعمدة
    headers = raw_rows[0].keys()
    log(f"  الأعمدة المكتشفة: {list(headers)}")

    # تحويل البيانات (دعم صيغ متعددة)
    for row in raw_rows:
        # date
        date = row.get('date') or row.get('Date') or row.get('time') or row.get('Time') or ''
        # value/close
        value = row.get('value') or row.get('Value') or row.get('close') or row.get('Close') or row.get('last') or ''
        # change_percent
        change_pct = row.get('change_percent') or row.get('change_pct') or row.get('change_abs') or row.get('Change %') or ''
        # high/low
        high = row.get('high') or row.get('High') or ''
        low = row.get('low') or row.get('Low') or ''
        # volume
        volume = row.get('volume') or row.get('Volume') or ''

        if not date or not value:
            continue

        try:
            value = float(str(value).replace(',', '').replace('%', ''))
            change_pct = float(str(change_pct).replace(',', '').replace('%', '')) if change_pct else 0
            high = float(str(high).replace(',', '')) if high else 0
            low = float(str(low).replace(',', '')) if low else 0
            volume = float(str(volume).replace(',', '')) if volume else 0

            rows.append({
                'symbol': symbol,
                'date': date,
                'value': value,
                'change_percent': change_pct,
                'high': high,
                'low': low,
                'volume': volume,
            })
        except (ValueError, TypeError):
            continue

    if not rows:
        log("  ❌ لا توجد صفوف صالحة", 'ERROR')
        return 0

    log(f"  صفوف صالحة: {len(rows)}")
    log(f"  أول تاريخ: {rows[0]['date']}")
    log(f"  آخر تاريخ: {rows[-1]['date']}")

    # حفظ في DB
    # Phase 7.1: migrated to db_manager (writable=True)
    from core.db_manager import db_manager
    conn = db_manager.connection(str(DB_PATH), writable=True).__enter__()
    cur = conn.cursor()

    # إنشاء جدول التاريخ إذا لم يكن موجودًا
    cur.execute('''CREATE TABLE IF NOT EXISTS market_indices_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        symbol TEXT NOT NULL,
        date TEXT NOT NULL,
        value REAL,
        change_percent REAL,
        high REAL,
        low REAL,
        volume REAL,
        source TEXT DEFAULT 'csv_import',
        UNIQUE(symbol, date)
    )''')

    saved = 0
    for row in rows:
        try:
            cur.execute('''
                INSERT OR REPLACE INTO market_indices_history
                (symbol, date, value, change_percent, high, low, volume, source)
                VALUES (?, ?, ?, ?, ?, ?, ?, 'csv_import')
            ''', (row['symbol'], row['date'], row['value'], row['change_percent'],
                  row['high'], row['low'], row['volume']))
            saved += 1
        except Exception:
            pass

    conn.commit()
    conn.close()

    log(f"  ✅ تم حفظ {saved} صف في market_indices_history")
    return saved


if __name__ == '__main__':
    log("=" * 60)
    log("📊 استيراد بيانات المؤشرات التاريخية من CSV")
    log("=" * 60)

    if len(sys.argv) < 2:
        log("الاستخدام: python import_indices_csv.py <file.csv> [SYMBOL]")
        log("")
        log("أمثلة:")
        log("  python import_indices_csv.py data/egx30_history.csv")
        log("  python import_indices_csv.py data/my_data.csv EGX30")
        sys.exit(1)

    filepath = sys.argv[1]
    symbol = sys.argv[2] if len(sys.argv) > 2 else None

    imported = import_csv(filepath, symbol)

    # تحقق
    if imported > 0:
        try:
            # Phase 7.1: migrated to db_manager (writable=False)
            from core.db_manager import db_manager
            conn = db_manager.connection(str(DB_PATH), writable=False).__enter__()
            cur = conn.cursor()
            sym = symbol or detect_symbol_from_filename(filepath)
            count = cur.execute("SELECT COUNT(*) FROM market_indices_history WHERE symbol = ?", (sym,)).fetchone()[0]
            first = cur.execute("SELECT MIN(date) FROM market_indices_history WHERE symbol = ?", (sym,)).fetchone()[0]
            last = cur.execute("SELECT MAX(date) FROM market_indices_history WHERE symbol = ?", (sym,)).fetchone()[0]
            log(f"\n📋 تقرير: {sym} = {count} صف | من {first} إلى {last}")
            conn.close()
        except Exception:
            pass

    log("=" * 60)
    log("✅ اكتمل")
