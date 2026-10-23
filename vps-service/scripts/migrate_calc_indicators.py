#!/usr/bin/env python3
"""
Migration: Phase 1.5 — حساب المؤشرات الفنية (RSI / MA / 52w)
==============================================================
AUDIT-FIX (2026-10-09): حساب high_52w/low_52w/ma_50/ma_200/RSI
من stock_daily_prices.

PRODUCTION-SAFE: يستخدم بيانات موجودة بدون حذف أو تعديل مخرب.

Calculates:
  - high_52w / low_52w (نطاق 52 أسبوع)
  - ma_50 / ma_200 (Moving Averages)
  - RSI (Wilder's 14-period)

Source: stocks.db.stock_daily_prices
Target: stocks.db.stocks (UPDATE columns)

Usage:
  cd /root/GLMinvestment
  python3 vps-service/scripts/migrate_calc_indicators.py
  python3 vps-service/scripts/migrate_calc_indicators.py --dry-run

Author: Main Agent (Z.ai Code) — Audit Deep Inspection
Date: 2026-10-09
"""

import sqlite3
import argparse
from pathlib import Path
from datetime import datetime

# BRAVO UNIFY (Rule 67 — CALCULATION-CANONICAL): delegate RSI to canonical.
import sys as _sys
_sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from analyzers.indicators.rsi import calc_rsi as _canonical_calc_rsi

PROJECT_ROOT = Path(__file__).resolve().parents[2]
STOCKS_DB = PROJECT_ROOT / 'db' / 'stocks.db'


def log(msg, level='INFO'):
    ts = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
    print(f'[{ts}] [{level}] {msg}')


def calc_rsi(closes, period=14):
    """حساب RSI — BRAVO UNIFY: delegates to canonical analyzers.indicators.rsi (Wilder's)."""
    return _canonical_calc_rsi(closes, period)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--dry-run', action='store_true')
    args = parser.parse_args()

    log('═══════════════════════════════════════════════════════════')
    log('  Phase 1.5: Calculate Technical Indicators')
    if args.dry_run:
        log('  ⚠️  DRY-RUN MODE')
    log('═══════════════════════════════════════════════════════════\n')

    if not STOCKS_DB.exists():
        log(f'❌ {STOCKS_DB} غير موجود', 'ERROR')
        return

    # Phase 7.1: migrated to db_manager (writable=True)
    from core.db_manager import db_manager
    db = db_manager.get_connection(str(STOCKS_DB), writable=True)
    db.execute("PRAGMA journal_mode=WAL")

    # جيب كل الأسهم النشطة
    stocks = db.execute(
        "SELECT ticker FROM stocks WHERE ticker IS NOT NULL AND is_active = 1"
    ).fetchall()
    log(f'📊 عدد الأسهم النشطة: {len(stocks)}\n')

    updated_52w = 0
    updated_ma = 0
    updated_rsi = 0
    no_data = 0

    stmt = db.cursor()

    for (ticker,) in stocks:
        # جيب آخر 252 يوم (سنة)
        rows = db.execute("""
            SELECT close FROM stock_daily_prices
            WHERE ticker = ? AND close IS NOT NULL AND close > 0
            ORDER BY price_date DESC LIMIT 252
        """, (ticker,)).fetchall()

        if len(rows) < 5:
            no_data += 1
            continue

        closes = [r[0] for r in rows if r[0] and r[0] > 0]
        if len(closes) < 5:
            continue

        # 52w high/low
        high_52 = max(closes)
        low_52 = min(closes)

        # ma_50 / ma_200 (أحدث أولاً في stock_daily_prices)
        ma_50 = sum(closes[:50]) / 50 if len(closes) >= 50 else None
        ma_200 = sum(closes[:200]) / 200 if len(closes) >= 200 else None

        # RSI (Wilder's 14)
        closes_rev = list(reversed(closes))  # أقدم → أحدث
        rsi = calc_rsi(closes_rev, 14)

        if not args.dry_run:
            stmt.execute(
                "UPDATE stocks SET high_52w = ?, low_52w = ?, ma_50 = ?, ma_200 = ?, rsi = ? WHERE ticker = ?",
                (high_52, low_52, ma_50, ma_200, rsi, ticker)
            )

        updated_52w += 1
        if ma_50 or ma_200:
            updated_ma += 1
        if rsi is not None:
            updated_rsi += 1

    if not args.dry_run:
        db.commit()
    db.close()

    log(f'✅ النتائج:')
    log(f'   high_52w/low_52w: {updated_52w} سهم')
    log(f'   ma_50/ma_200: {updated_ma} سهم')
    log(f'   RSI: {updated_rsi} سهم')
    log(f'   بدون بيانات تاريخية: {no_data} سهم')
    log(f'\n{"="*60}')
    log('  ✅ Phase 1.5 Complete')


if __name__ == '__main__':
    main()
