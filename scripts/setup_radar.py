#!/usr/bin/env python3
"""
setup_radar.py — تجهيز بيئة رادار الميكرز
========================================
سكربت portable يكتشف البيئة الحالية ويجهزها:

  1. لو إحنا في الإنتاج (db/stocks.db موجود + فيه بيانات):
     → مفيش حاجة لازم نعملها. الـ APIs هتقرا مباشرة.

  2. لو إحنا في sandbox/laptop (مفيش stocks.db أو فيه بس قليل):
     → اسحب بيانات الإنتاج لـ db/production_snapshot.db

  3. لو فيه db/vps_real/stocks.db (نسخة من VPS):
     → الـ APIs هتستخدمه تلقائياً.

CLI:
  python3 scripts/setup_radar.py                  # اكتشف وجهز
  python3 scripts/setup_radar.py --force-fetch   # اسحب حتى لو في الإنتاج
  python3 scripts/setup_radar.py --status        # بس اعرض الحالة
"""
from __future__ import annotations

import argparse
import os
import sqlite3
import sys
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent

# Fallback chain (نفس اللي في maker_radar.py و radar-db.ts)
DB_CANDIDATES = [
    ('db/production_snapshot.db', 'stock_daily_prices'),
    ('db/vps_real/stocks.db', 'stock_daily_prices'),
    ('db/stocks.db', 'stock_daily_prices'),
    ('db/data_engine.db', 'historical_data'),
]


def log(msg):
    print(msg, flush=True)


def check_db(db_rel, table):
    """تحقق من وجود DB + table + عد الصفوف."""
    db_path = PROJECT_ROOT / db_rel
    if not db_path.exists():
        return {'exists': False, 'path': str(db_path)}
    try:
        size_mb = db_path.stat().st_size / (1024 * 1024)
        conn = sqlite3.connect(str(db_path))
        # تحقق من الـ table
        cur = conn.execute(
            "SELECT name FROM sqlite_master WHERE type='table' AND name=?", (table,)
        )
        row = cur.fetchone()
        if not row:
            conn.close()
            return {'exists': True, 'path': str(db_path), 'size_mb': round(size_mb, 1), 'table_exists': False, 'rows': 0}
        # عد الصفوف
        n_rows = conn.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]
        # عد الـ tickers
        ticker_col = 'ticker' if table == 'stock_daily_prices' else 'symbol'
        n_tickers = conn.execute(f"SELECT COUNT(DISTINCT {ticker_col}) FROM {table}").fetchone()[0]
        # أحدث تاريخ
        date_col = 'price_date' if table == 'stock_daily_prices' else 'date'
        latest = conn.execute(f"SELECT MAX({date_col}) FROM {table}").fetchone()[0]
        conn.close()
        return {
            'exists': True,
            'path': str(db_path),
            'size_mb': round(size_mb, 1),
            'table_exists': True,
            'rows': n_rows,
            'tickers': n_tickers,
            'latest_date': latest,
        }
    except Exception as e:
        return {'exists': True, 'path': str(db_path), 'error': str(e)}


def show_status():
    """اعرض حالة كل الـ DBs."""
    log("═══ حالة الـ DBs ═══\n")
    log(f"  PROJECT_ROOT: {PROJECT_ROOT}")
    log(f"  Environment: {'PRODUCTION' if _is_production() else 'sandbox/laptop'}")
    log("")

    log(f"  {'DB':30s} | {'Table':22s} | {'Exists':>6s} | {'Size':>8s} | {'Rows':>10s} | {'Tickers':>7s} | {'Latest':>12s}")
    log("  " + "-" * 110)

    found_any = False
    for db_rel, table in DB_CANDIDATES:
        info = check_db(db_rel, table)
        exists_str = "✅" if info['exists'] else "❌"
        size_str = f"{info.get('size_mb', 0)}MB" if info.get('size_mb') else "-"
        rows_str = f"{info.get('rows', 0):,}" if info.get('table_exists') else "-"
        tickers_str = str(info.get('tickers', '-')) if info.get('table_exists') else "-"
        latest_str = info.get('latest_date', '-') or '-'
        log(f"  {db_rel:30s} | {table:22s} | {exists_str:>6s} | {size_str:>8s} | {rows_str:>10s} | {tickers_str:>7s} | {latest_str:>12s}")
        if info.get('table_exists') and info.get('rows', 0) > 0:
            found_any = True

    log("")
    if found_any:
        log("  ✅ فيه DB متاح — الـ APIs هتشتغل.")
    else:
        log("  ❌ مفيش DB متاح — شغّل: python3 scripts/fetch_production_data.py")
    return found_any


def _is_production():
    """لو db/stocks.db موجود + فيه بيانات → إحنا في الإنتاج."""
    stocks_db = PROJECT_ROOT / "db" / "stocks.db"
    if not stocks_db.exists():
        return False
    try:
        conn = sqlite3.connect(str(stocks_db))
        n = conn.execute("SELECT COUNT(*) FROM stock_daily_prices").fetchone()[0]
        conn.close()
        return n > 1000
    except Exception:
        return False


def main():
    parser = argparse.ArgumentParser(description='تجهيز بيئة رادار الميكرز')
    parser.add_argument('--force-fetch', action='store_true', help='اسحب من الإنتاج حتى لو في الإنتاج')
    parser.add_argument('--status', action='store_true', help='بس اعرض الحالة')
    args = parser.parse_args()

    log("═══ تجهيز بيئة رادار الميكرز ═══\n")

    # اعرض الحالة دايماً
    has_db = show_status()

    if args.status:
        return 0 if has_db else 1

    # لو فيه DB متاح → تمام
    if has_db:
        log("\n✅ البيئة جاهزة. الـ APIs هتشتغل من الـ DB المتاح.")
        log("   مفيش حاجة للسحب.")
        return 0

    # مفيش DB → اسحب من الإنتاج
    log("\n⚠️ مفيش DB متاح. هنسحب من الإنتاج...")
    log("   شغّل: python3 scripts/fetch_production_data.py --days 365")
    log("   أو:   python3 scripts/setup_radar.py --force-fetch")

    if args.force_fetch:
        log("\n▶ تشغيل fetch_production_data.py...")
        import subprocess
        result = subprocess.run(
            [sys.executable, str(PROJECT_ROOT / 'scripts' / 'fetch_production_data.py'), '--days', '365'],
            cwd=str(PROJECT_ROOT),
        )
        return result.returncode

    return 1


if __name__ == "__main__":
    sys.exit(main())
