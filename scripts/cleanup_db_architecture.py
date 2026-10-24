#!/usr/bin/env python3
"""
cleanup_db_architecture.py — تنظيم هندسي لقواعد البيانات
============================================================
المشكلة: الأسعار اليومية متكررة في 4 أماكن + جداول ميتة كتيرة.
الحل: توحيد المصادر + حذف المكرر + توثيق المعمارية.

الخطوات:
  1. نسخ stocks.db.stock_daily_prices → data_engine.db.egksco_price_history
     (بنفس الـ schema — عشان data_engine.db يبقى source of truth)
  2. حذف الجداول الميتة الفاضية (0 rows + مش هتتأثر)
  3. عرض تقرير قبل/بعد

CLI:
  python3 scripts/cleanup_db_architecture.py --dry-run    # معاينة فقط
  python3 scripts/cleanup_db_architecture.py --execute   # تنفيذ فعلي
  python3 scripts/cleanup_db_architecture.py --report     # تقرير فقط
"""
from __future__ import annotations

import argparse
import sqlite3
import sys
from datetime import datetime
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent


def log(msg):
    print(msg, flush=True)


def get_db_path(name: str) -> Path:
    return PROJECT_ROOT / 'db' / name


def copy_stock_daily_prices_to_egksco(dry_run: bool = False):
    """نسخ البيانات التاريخية الكاملة لـ egksco_price_history في data_engine.db.

    المصدر الأولوية:
      1. price_history.db (1.2M+ rows، 2000-2026) — البيانات العميقة
      2. stocks.db.stock_daily_prices (29K rows، 60 يوم) — fallback

    ده بـ يخلي egksco_price_history فيها بيانات كاملة للتداول والباك-تست.
    """
    stocks_db = get_db_path('stocks.db')
    price_history_db = get_db_path('price_history.db')
    data_engine_db = get_db_path('data_engine.db')

    if not data_engine_db.exists():
        log(f"❌ {data_engine_db} مش موجود")
        return False

    log("\n═══ نسخ البيانات التاريخية → egksco_price_history ═══")

    # الأولوية 1: price_history.db (البيانات العميقة)
    use_price_history = price_history_db.exists()
    if use_price_history:
        log(f"  ✅ price_history.db موجود — بـ نستخدمه (بيانات عميقة)")
        # Phase 7.1: migrated to db_manager (writable=False)
        from core.db_manager import db_manager
        src_conn = db_manager.connection(str(price_history_db), writable=False).__enter__()
        src_conn.row_factory = sqlite3.Row
        # price_history schema: ticker, date, open_price, high_price, low_price, close_price, volume
        src_rows = src_conn.execute("""
            SELECT ticker, date, open_price, high_price, low_price, close_price, volume
            FROM price_history
            WHERE close_price IS NOT NULL AND close_price > 0
        """).fetchall()
        src_count = len(src_rows)
        log(f"  المصدر (price_history.db): {src_count:,} صف")
        src_conn.close()

        # فلتر EGX tickers فقط
                # Phase 7.1: migrated
        from core.db_manager import db_manager
        stocks_conn = db_manager.connection(str(stocks_db), writable=False).__enter__() if stocks_db.exists() else None
        if stocks_conn:
            egx_tickers = set(r[0] for r in stocks_conn.execute(
                "SELECT ticker FROM stocks WHERE market = 'EGX'"
            ).fetchall())
            stocks_conn.close()
            # شيل الأسهم المش EGX
            src_rows = [r for r in src_rows if r['ticker'] in egx_tickers]
            log(f"  بعد فلتر EGX: {len(src_rows):,} صف ({len(set(r['ticker'] for r in src_rows))} سهم)")
    elif stocks_db.exists():
        # fallback: stocks.db (بيانات سطحية)
        log(f"  ⚠️ price_history.db مش موجود — بـ نستخدم stocks.db (بيانات سطحية)")
        # Phase 7.1: migrated to db_manager (writable=False)
        from core.db_manager import db_manager
        src_conn = db_manager.connection(str(stocks_db), writable=False).__enter__()
        src_conn.row_factory = sqlite3.Row
        src_rows = src_conn.execute("""
            SELECT ticker, price_date, open, high, low, close, volume, turnover
            FROM stock_daily_prices
            WHERE close IS NOT NULL AND close > 0
        """).fetchall()
        src_count = len(src_rows)
        log(f"  المصدر (stocks.db.stock_daily_prices): {src_count:,} صف")
        src_conn.close()
    else:
        log("  ❌ مفيش DB مصدر متاح")
        return False

    if not src_rows:
        log("  ⚠️ مفيش بيانات للنسخ")
        return False

    if dry_run:
        log(f"  [DRY-RUN] كنت هنسخ {len(src_rows):,} صف لـ data_engine.db.egksco_price_history")
        return True

    # انسخ لـ data_engine.db (بنفس schema الموجود)
    # Phase 7.1: migrated to db_manager (writable=False)
    from core.db_manager import db_manager
    dst_conn = db_manager.connection(str(data_engine_db), writable=False).__enter__()

    def _parse_vol(v):
        if v is None:
            return 0
        if isinstance(v, (int, float)):
            return int(v)
        s = str(v).strip().upper().replace('\u202f', '').replace('\xa0', '').replace(' ', '')
        mult = 1
        if s.endswith('K'):
            mult = 1000; s = s[:-1]
        elif s.endswith('M'):
            mult = 1_000_000; s = s[:-1]
        elif s.endswith('B'):
            mult = 1_000_000_000; s = s[:-1]
        try:
            return int(float(s) * mult)
        except Exception:
            return 0

    # امسح القديم (لو فيه)
    dst_conn.execute("DELETE FROM egksco_price_history")

    # انسخ البيانات (مع mapping حسب المصدر)
    batch = []
    for r in src_rows:
        if use_price_history:
            # price_history.db schema: ticker, date, open_price, high_price, low_price, close_price, volume
            close = float(r['close_price'] or 0)
            volume = _parse_vol(r['volume'])
            value = (close * volume) if close and volume else None
            batch.append((
                r['ticker'], r['date'],
                float(r['open_price'] or 0), float(r['high_price'] or 0),
                float(r['low_price'] or 0), close, volume, value,
            ))
        else:
            # stocks.db schema: ticker, price_date, open, high, low, close, volume, turnover
            close = float(r['close'] or 0)
            volume = _parse_vol(r['volume'])
            turnover = r['turnover']
            if turnover is not None:
                try:
                    value = float(turnover)
                except (TypeError, ValueError):
                    value = (close * volume) if close and volume else None
            else:
                value = (close * volume) if close and volume else None
            batch.append((
                r['ticker'], r['price_date'],
                float(r['open'] or 0), float(r['high'] or 0),
                float(r['low'] or 0), close, volume, value,
            ))
    # schema الحقيقي: symbol, price_date, open_price, high_price, low_price, close_price, volume, turnover
    dst_conn.executemany("""
        INSERT INTO egksco_price_history
            (symbol, price_date, open_price, high_price, low_price, close_price, volume, turnover)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    """, batch)
    dst_conn.commit()

    # تحقق
    n = dst_conn.execute("SELECT COUNT(*) FROM egksco_price_history").fetchone()[0]
    latest = dst_conn.execute("SELECT MAX(price_date) FROM egksco_price_history").fetchone()[0]
    n_tickers = dst_conn.execute("SELECT COUNT(DISTINCT symbol) FROM egksco_price_history").fetchone()[0]
    dst_conn.close()

    log(f"  ✅ تم نسخ {n:,} صف لـ data_engine.db.egksco_price_history")
    log(f"     {n_tickers} ticker | آخر تاريخ: {latest}")
    return True


def find_empty_tables(db_path: Path, protect: list = None) -> list:
    """ارجع قائمة بالجداول اللي صفوفها = 0. استثني الـ protected tables."""
    if not db_path.exists():
        return []
    protect = protect or []
    # Phase 7.1: migrated to db_manager (writable=False)
    from core.db_manager import db_manager
    conn = db_manager.connection(str(db_path), writable=False).__enter__()
    conn.row_factory = sqlite3.Row
    tables = conn.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").fetchall()
    empty = []
    for t in tables:
        name = t[0]
        if name in protect:
            continue
        try:
            n = conn.execute(f"SELECT COUNT(*) FROM \"{name}\"").fetchone()[0]
            if n == 0:
                empty.append(name)
        except Exception:
            pass
    conn.close()
    return empty


def drop_empty_tables(db_path: Path, tables: list, dry_run: bool = False) -> int:
    """احذف الجداول الفاضية."""
    if not tables:
        return 0
    if dry_run:
        log(f"  [DRY-RUN] كنت هحذف {len(tables)} جدول فاضي من {db_path.name}")
        return len(tables)

    # Phase 7.1: migrated to db_manager (writable=False)
    from core.db_manager import db_manager
    conn = db_manager.connection(str(db_path), writable=False).__enter__()
    dropped = 0
    for table in tables:
        try:
            conn.execute(f"DROP TABLE IF EXISTS \"{table}\"")
            dropped += 1
        except Exception as e:
            log(f"  ⚠️ فشل حذف {table}: {e}")
    conn.commit()
    conn.close()
    return dropped


def show_report():
    """تقرير شامل لكل الـ DBs."""
    log("\n═══ تقرير قواعد البيانات ═══\n")
    log(f"  {'DB':25s} | {'Tables':>7s} | {'Total rows':>12s} | {'Empty':>6s} | {'Size':>10s}")
    log("  " + "-" * 75)

    db_dir = PROJECT_ROOT / 'db'
    total_size = 0
    total_tables = 0
    total_rows = 0
    total_empty = 0

    for db_file in sorted(db_dir.glob('*.db')):
        size_mb = db_file.stat().st_size / (1024 * 1024)
        total_size += size_mb
        try:
            # Phase 7.1: migrated to db_manager (writable=False)
            from core.db_manager import db_manager
            conn = db_manager.connection(str(db_file), writable=False).__enter__()
            tables = conn.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").fetchall()
            n_tables = len(tables)
            total_tables += n_tables
            n_rows = 0
            n_empty = 0
            for t in tables:
                try:
                    cnt = conn.execute(f"SELECT COUNT(*) FROM \"{t[0]}\"").fetchone()[0]
                    n_rows += cnt
                    if cnt == 0:
                        n_empty += 1
                except:
                    pass
            total_rows += n_rows
            total_empty += n_empty
            conn.close()
            log(f"  {db_file.name:25s} | {n_tables:>7d} | {n_rows:>12,} | {n_empty:>6d} | {size_mb:>9.1f}MB")
        except Exception as e:
            log(f"  {db_file.name:25s} | ERROR: {e}")

    log("  " + "-" * 75)
    log(f"  {'TOTAL':25s} | {total_tables:>7d} | {total_rows:>12,} | {total_empty:>6d} | {total_size:>9.1f}MB")


def main():
    parser = argparse.ArgumentParser(description='تنظيم هندسي لقواعد البيانات')
    parser.add_argument('--dry-run', action='store_true', help='معاينة فقط من غير تعديل')
    parser.add_argument('--execute', action='store_true', help='تنفيذ فعلي')
    parser.add_argument('--report', action='store_true', help='تقرير فقط')
    parser.add_argument('--skip-copy', action='store_true', help='تخطّي نسخ stock_daily_prices')
    parser.add_argument('--skip-cleanup', action='store_true', help='تخطّي حذف الجداول الفاضية')
    args = parser.parse_args()

    if args.report or (not args.dry_run and not args.execute):
        show_report()
        if args.report:
            return 0

    mode = 'DRY-RUN' if args.dry_run else 'EXECUTE'
    log(f"\n═══ تنظيم هندسي ({mode}) ═══")

    # 1. نسخ stock_daily_prices → egksco_price_history
    if not args.skip_copy:
        copy_stock_daily_prices_to_egksco(dry_run=args.dry_run)

    # 2. حذف الجداول الفاضية
    if not args.skip_cleanup:
        log("\n═══ حذف الجداول الفاضية ═══")
        # protect: جداول هنعبيها / مش هتتلمس
        protect_data_engine = ['egksco_price_history', 'egksco_stocks']  # هنعبيهم
        protect_stocks = ['egksco_price_history']  # هنعبيها من stocks.db كمان

        dbs_to_clean = [
            ('stocks.db', protect_stocks),
            ('data_engine.db', protect_data_engine),
            ('predictions.db', []),
        ]
        total_dropped = 0
        for db_name, protect_list in dbs_to_clean:
            db_path = get_db_path(db_name)
            if not db_path.exists():
                continue
            empty_tables = find_empty_tables(db_path, protect=protect_list)
            if empty_tables:
                log(f"\n  {db_name} — {len(empty_tables)} جدول فاضي:")
                for t in empty_tables:
                    log(f"    - {t}")
                n_dropped = drop_empty_tables(db_path, empty_tables, dry_run=args.dry_run)
                total_dropped += n_dropped
                log(f"  ✅ تم حذف {n_dropped} جدول من {db_name}")
            else:
                log(f"\n  {db_name} — مفيش جداول فاضية ✅")
        log(f"\n  إجمالي الجداول المحذوفة: {total_dropped}")

    # 3. تقرير نهائي
    show_report()

    return 0


if __name__ == "__main__":
    sys.exit(main())
