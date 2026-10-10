#!/usr/bin/env python3
"""
Price History Migration Tool
=============================
يهيّئ db/price_history.db بجدول price_history (المتوقع من V40.2 generator + V38 engine).

يدعم 3 مصادر للبيانات (بترتيب الأولوية):
  1. db/price_history.db لديه جدول price_history بالفعل → التحقق فقط
  2. db/historical.db لديه جدول historical_prices → migration (symbol→ticker)
  3. db/stocks.db لديه stock_price_history + stocks → migration (JOIN stock_id→ticker)

الاستخدام:
  python3 vps-service/tools/migrate_price_history.py           # فحص + migration
  python3 vps-service/tools/migrate_price_history.py --check   # فحص فقط
  python3 vps-service/tools/migrate_price_history.py --force   # إعادة بناء كاملة
  python3 vps-service/tools/migrate_price_history.py --egx-only # ترحيل EGX فقط
"""
import sqlite3
import os
import sys
import argparse
import shutil
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
PRICE_HISTORY_DB = PROJECT_ROOT / 'db' / 'price_history.db'
STOCKS_DB = PROJECT_ROOT / 'db' / 'stocks.db'
HISTORICAL_DB = PROJECT_ROOT / 'db' / 'historical.db'

EXPECTED_COLUMNS = [
    ('id',              'INTEGER PRIMARY KEY AUTOINCREMENT'),
    ('ticker',          'TEXT NOT NULL'),
    ('date',            'TEXT NOT NULL'),
    ('open_price',      'REAL'),
    ('high_price',      'REAL'),
    ('low_price',       'REAL'),
    ('close_price',     'REAL'),
    ('volume',          'REAL'),
    ('source',          "TEXT DEFAULT ''"),
    ('created_at',      'TEXT DEFAULT CURRENT_TIMESTAMP'),
]


def check_price_history_db():
    """Check if price_history.db exists and has the price_history table with data."""
    if not PRICE_HISTORY_DB.exists():
        return {'exists': False, 'table': False, 'rows': 0, 'error': 'file not found'}

    try:
        db = sqlite3.connect(str(PRICE_HISTORY_DB), timeout=5)
        tables = [r[0] for r in db.execute(
            "SELECT name FROM sqlite_master WHERE type='table'"
        ).fetchall()]
        has_table = 'price_history' in tables
        rows = 0
        date_range = (None, None)
        tickers = 0
        if has_table:
            rows = db.execute('SELECT COUNT(*) FROM price_history').fetchone()[0]
            if rows > 0:
                date_range = db.execute(
                    'SELECT MIN(date), MAX(date) FROM price_history'
                ).fetchone()
                tickers = db.execute(
                    'SELECT COUNT(DISTINCT ticker) FROM price_history'
                ).fetchone()[0]
        db.close()
        return {
            'exists': True,
            'table': has_table,
            'rows': rows,
            'tickers': tickers,
            'date_range': date_range,
        }
    except Exception as e:
        return {'exists': True, 'table': False, 'rows': 0, 'error': str(e)}


def check_stocks_db():
    """Check if stocks.db has stock_price_history + stocks tables."""
    if not STOCKS_DB.exists():
        return {'exists': False, 'has_sph': False, 'has_stocks': False}

    try:
        db = sqlite3.connect(str(STOCKS_DB), timeout=5)
        tables = [r[0] for r in db.execute(
            "SELECT name FROM sqlite_master WHERE type='table'"
        ).fetchall()]
        has_sph = 'stock_price_history' in tables
        has_stocks = 'stocks' in tables
        sph_rows = 0
        date_range = (None, None)
        tickers = 0
        if has_sph:
            sph_rows = db.execute('SELECT COUNT(*) FROM stock_price_history').fetchone()[0]
            if sph_rows > 0:
                date_range = db.execute(
                    'SELECT MIN(date), MAX(date) FROM stock_price_history WHERE date IS NOT NULL'
                ).fetchone()
        if has_stocks:
            tickers = db.execute('SELECT COUNT(*) FROM stocks').fetchone()[0]
        db.close()
        return {
            'exists': True,
            'has_sph': has_sph,
            'has_stocks': has_stocks,
            'sph_rows': sph_rows,
            'tickers': tickers,
            'date_range': date_range,
        }
    except Exception as e:
        return {'exists': True, 'has_sph': False, 'has_stocks': False, 'error': str(e)}


def check_historical_db():
    """Check if historical.db has historical_prices table."""
    if not HISTORICAL_DB.exists():
        return {'exists': False, 'has_hp': False}

    try:
        db = sqlite3.connect(str(HISTORICAL_DB), timeout=5)
        tables = [r[0] for r in db.execute(
            "SELECT name FROM sqlite_master WHERE type='table'"
        ).fetchall()]
        has_hp = 'historical_prices' in tables
        hp_rows = 0
        date_range = (None, None)
        symbols = 0
        categories = []
        if has_hp:
            hp_rows = db.execute('SELECT COUNT(*) FROM historical_prices').fetchone()[0]
            if hp_rows > 0:
                date_range = db.execute(
                    'SELECT MIN(date), MAX(date) FROM historical_prices WHERE date IS NOT NULL'
                ).fetchone()
                symbols = db.execute(
                    'SELECT COUNT(DISTINCT symbol) FROM historical_prices'
                ).fetchone()[0]
                categories = db.execute(
                    'SELECT category, COUNT(*) FROM historical_prices GROUP BY category ORDER BY COUNT(*) DESC'
                ).fetchall()
        db.close()
        return {
            'exists': True,
            'has_hp': has_hp,
            'hp_rows': hp_rows,
            'symbols': symbols,
            'date_range': date_range,
            'categories': categories,
        }
    except Exception as e:
        return {'exists': True, 'has_hp': False, 'error': str(e)}


def create_target_table(force=False):
    """Create or recreate price_history.db with the expected schema."""
    if force and PRICE_HISTORY_DB.exists():
        backup = PRICE_HISTORY_DB.with_suffix('.db.bak_pre_migration')
        shutil.copy2(str(PRICE_HISTORY_DB), str(backup))
        print(f"📦 Backup: {backup}")
        PRICE_HISTORY_DB.unlink()

    os.makedirs(str(PRICE_HISTORY_DB.parent), exist_ok=True)
    target = sqlite3.connect(str(PRICE_HISTORY_DB))
    target.execute(f'''
        CREATE TABLE IF NOT EXISTS price_history (
            {', '.join(f'{c} {t}' for c, t in EXPECTED_COLUMNS)}
        )
    ''')
    target.execute('''
        CREATE INDEX IF NOT EXISTS idx_ph_ticker_date
        ON price_history(ticker, date)
    ''')
    target.execute('''
        CREATE INDEX IF NOT EXISTS idx_ph_date
        ON price_history(date)
    ''')

    existing = target.execute('SELECT COUNT(*) FROM price_history').fetchone()[0]
    if existing > 0 and not force:
        print(f"ℹ️  price_history.db يحتوي بالفعل على {existing:,} صف — تخطي الترحيل")
        print("   (استخدم --force لإعادة البناء الكامل)")
        target.close()
        return None  # signal: no migration needed

    if force:
        target.execute('DELETE FROM price_history')

    return target


def migrate_from_historical(force=False, egx_only=False):
    """Migrate price data from historical.db.historical_prices → price_history.db.price_history."""
    hist_info = check_historical_db()
    if not hist_info['exists'] or not hist_info.get('has_hp'):
        print("❌ historical.db لا يحتوي على historical_prices — لا يمكن الترحيل")
        return False

    target = create_target_table(force)
    if target is None:
        return True

    source = sqlite3.connect(str(HISTORICAL_DB))
    source.row_factory = sqlite3.Row

    hp_cols = [c[1] for c in source.execute('PRAGMA table_info(historical_prices)').fetchall()]
    print(f"  historical_prices columns: {hp_cols}")

    # Build query — historical_prices has: symbol, date, open, high, low, close, volume, category
    # Map: symbol→ticker, open→open_price, high→high_price, low→low_price, close→close_price
    where_clause = "WHERE date IS NOT NULL AND symbol IS NOT NULL"
    if egx_only:
        # EGX categories in historical.db
        where_clause += " AND category LIKE '%EGX%'"

    query = f'''
        SELECT symbol, date, open, high, low, close, volume
        FROM historical_prices
        {where_clause}
    '''

    print(f"⏳ جارٍ الترحيل{' (EGX فقط)' if egx_only else ''} (قد يستغرق دقائق)...")
    cursor = source.execute(query)
    batch = []
    batch_size = 5000
    total = 0

    while True:
        rows = cursor.fetchmany(batch_size)
        if not rows:
            break
        for row in rows:
            batch.append((
                row['symbol'], row['date'],
                row['open'], row['high'],
                row['low'], row['close'],
                row['volume'],
                'migration_from_historical_db',
            ))
        target.executemany('''
            INSERT INTO price_history
                (ticker, date, open_price, high_price, low_price, close_price, volume, source)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ''', batch)
        total += len(batch)
        batch.clear()
        if total % 50000 == 0:
            target.commit()
            print(f"  ... {total:,} صف", flush=True)

    target.commit()
    target.close()
    source.close()

    print(f"✅ تم ترحيل {total:,} صف إلى price_history.db")
    return True


def migrate_from_stocks_db(force=False):
    """Migrate price data from stocks.db.stock_price_history → price_history.db.price_history."""
    stocks_info = check_stocks_db()
    if not stocks_info['exists'] or not stocks_info.get('has_sph'):
        print("❌ stocks.db لا يحتوي على stock_price_history — لا يمكن الترحيل")
        return False

    target = create_target_table(force)
    if target is None:
        return True

    source = sqlite3.connect(str(STOCKS_DB))
    source.row_factory = sqlite3.Row

    sph_cols = [c[1] for c in source.execute('PRAGMA table_info(stock_price_history)').fetchall()]
    stocks_cols = [c[1] for c in source.execute('PRAGMA table_info(stocks)').fetchall()]

    print(f"  stock_price_history columns: {sph_cols}")
    print(f"  stocks columns: {stocks_cols}")

    if 'stock_id' in sph_cols and 'id' in stocks_cols and 'ticker' in stocks_cols:
        query = '''
            SELECT s.ticker, sph.date, sph.open_price, sph.high_price,
                   sph.low_price, sph.close_price, sph.volume
            FROM stock_price_history sph
            JOIN stocks s ON sph.stock_id = s.id
            WHERE sph.date IS NOT NULL AND s.ticker IS NOT NULL
        '''
    elif 'ticker' in sph_cols:
        query = '''
            SELECT ticker, date, open_price, high_price,
                   low_price, close_price, volume
            FROM stock_price_history
            WHERE date IS NOT NULL AND ticker IS NOT NULL
        '''
    else:
        print(f"❌ لا يمكن تحديد مخطط stock_price_history: {sph_cols}")
        target.close()
        source.close()
        return False

    print("⏳ جارٍ الترحيل (قد يستغرق دقائق)...")
    cursor = source.execute(query)
    batch = []
    batch_size = 5000
    total = 0

    while True:
        rows = cursor.fetchmany(batch_size)
        if not rows:
            break
        for row in rows:
            batch.append((
                row['ticker'], row['date'],
                row['open_price'], row['high_price'],
                row['low_price'], row['close_price'],
                row['volume'],
                'migration_from_stocks_db',
            ))
        target.executemany('''
            INSERT INTO price_history
                (ticker, date, open_price, high_price, low_price, close_price, volume, source)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ''', batch)
        total += len(batch)
        batch.clear()
        if total % 50000 == 0:
            target.commit()
            print(f"  ... {total:,} صف", flush=True)

    target.commit()
    target.close()
    source.close()

    print(f"✅ تم ترحيل {total:,} صف إلى price_history.db")
    return True


def main():
    parser = argparse.ArgumentParser(description='Price History Migration Tool')
    parser.add_argument('--check', action='store_true', help='فحص فقط بدون ترحيل')
    parser.add_argument('--force', action='store_true', help='إعادة بناء كاملة (يحذف البيانات الحالية)')
    parser.add_argument('--egx-only', action='store_true', help='ترحيل بيانات EGX فقط من historical.db')
    args = parser.parse_args()

    print("=" * 60)
    print("  Price History Migration Tool")
    print("=" * 60)

    # Check all sources
    ph_info = check_price_history_db()
    stocks_info = check_stocks_db()
    hist_info = check_historical_db()

    print("\n📊 db/price_history.db (الهدف):")
    if ph_info.get('exists'):
        if ph_info.get('table'):
            print(f"  ✅ جدول price_history موجود")
            print(f"  الصفوف: {ph_info['rows']:,}")
            if ph_info['rows'] > 0:
                print(f"  الأسهم: {ph_info['tickers']:,}")
                print(f"  النطاق: {ph_info['date_range'][0]} → {ph_info['date_range'][1]}")
        else:
            print(f"  ⚠️  الملف موجود لكن جدول price_history غير موجود")
    else:
        print(f"  ❌ الملف غير موجود")

    print("\n📊 db/historical.db (مصدر محتمل 1):")
    if hist_info.get('exists'):
        if hist_info.get('has_hp'):
            print(f"  ✅ جدول historical_prices موجود ({hist_info['hp_rows']:,} صف)")
            if hist_info['hp_rows'] > 0:
                print(f"  الرموز: {hist_info['symbols']:,}")
                print(f"  النطاق: {hist_info['date_range'][0]} → {hist_info['date_range'][1]}")
                if hist_info.get('categories'):
                    print(f"  الفئات:")
                    for cat, cnt in hist_info['categories'][:5]:
                        print(f"    {cat}: {cnt:,}")
        else:
            print(f"  ⚠️  جدول historical_prices غير موجود")
    else:
        print(f"  ❌ الملف غير موجود")

    print("\n📊 db/stocks.db (مصدر محتمل 2):")
    if stocks_info.get('exists'):
        if stocks_info.get('has_sph'):
            print(f"  ✅ جدول stock_price_history موجود ({stocks_info['sph_rows']:,} صف)")
            if stocks_info['sph_rows'] > 0:
                print(f"  النطاق: {stocks_info['date_range'][0]} → {stocks_info['date_range'][1]}")
        else:
            print(f"  ⚠️  جدول stock_price_history غير موجود")
        if stocks_info.get('has_stocks'):
            print(f"  ✅ جدول stocks موجود ({stocks_info['tickers']:,} سهم)")
    else:
        print(f"  ❌ الملف غير موجود")

    # Decision: is migration needed?
    needs_migration = (
        not ph_info.get('exists') or
        not ph_info.get('table') or
        ph_info.get('rows', 0) == 0
    )

    if not needs_migration:
        print("\n✅ price_history.db جاهز — لا حاجة للترحيل")
        return 0

    if args.check:
        print("\n⚠️  يحتاج ترحيل — شغّل بدون --check للتنفيذ")
        return 1

    # Try sources in priority order
    print("\n🚀 بدء الترحيل...")

    if hist_info.get('has_hp'):
        print("\n📋 المصدر: db/historical.db.historical_prices")
        success = migrate_from_historical(force=args.force, egx_only=args.egx_only)
    elif stocks_info.get('has_sph'):
        print("\n📋 المصدر: db/stocks.db.stock_price_history")
        success = migrate_from_stocks_db(force=args.force)
    else:
        print("\n❌ لا يوجد مصدر للبيانات (لا historical_prices ولا stock_price_history)")
        print("   تحقق من تثبيت بيانات الأسعار أولاً")
        return 1

    if success:
        final = check_price_history_db()
        print(f"\n✅ التحقق النهائي:")
        print(f"  الصفوف: {final.get('rows', 0):,}")
        print(f"  الأسهم: {final.get('tickers', 0):,}")
        if final.get('date_range'):
            print(f"  النطاق: {final['date_range'][0]} → {final['date_range'][1]}")
        return 0
    else:
        print("\n❌ فشل الترحيل")
        return 1


if __name__ == '__main__':
    sys.exit(main())
