#!/usr/bin/env python3
"""
backfill_price_history_gap.py — ملء فجوة price_history.db من Yahoo (one-shot)
============================================================================

WHY
---
price_history.db متجمّد عند MAX(date)=2026-07-30 رغم وجود توصيات أغسطس.
ده بـ يكسر phase1a_retrospective (Eligible=0) وكل قياس تاريخي.
السكريبت ده بـ يملي الفجوة من Yahoo Finance لكل التيكرز الموجودة في
predictions.db + stocks.db.

ده مجرد CLI wrapper حوالين fill_price_history_gap() في
vps-service/jobs/price_history_safetynet.py — نفس الـ function اللي
market_scheduler بـ يشغّلها تلقائياً يومياً.

Usage:
    # افحص الأول (dry-run) — بـ يسحب Yahoo بس ما يكتبش، ويطبعّ التقرير
    python3 scripts/backfill_price_history_gap.py --dry-run

    # نفّذ (املأ الفجوة)
    python3 scripts/backfill_price_history_gap.py

    # سوق مختلف
    python3 scripts/backfill_price_history_gap.py --market TADAWUL

    # whichكرز محددة بس
    python3 scripts/backfill_price_history_gap.py --tickers COMI,ETEL,SWDY,RMDA

    # cap أكبر للفجوات الكبيرة (default=45 يوم)
    python3 scripts/backfill_price_history_gap.py --max-days 90

بعد التشغيل، تحقّق:
    python3 -c "
    import sqlite3
    # Phase 7.1: migrated to db_manager (writable=False)
    from core.db_manager import db_manager
    ph = db_manager.connection('db/price_history.db', writable=False).__enter__()
    print(ph.execute('SELECT MAX(date), COUNT(*) FROM price_history').fetchone())
    print(ph.execute(\"SELECT MAX(date) FROM price_history WHERE ticker='RMDA'\").fetchone())
    "

Author: P0 fix — price_history freeze
"""

import sys
import os
import json
import argparse
import logging
from pathlib import Path

# ── أضف vps-service لـ sys.path عشان نستورد الـ safetynet ──
PROJECT_ROOT = Path(__file__).resolve().parent.parent
VPS_PATH = PROJECT_ROOT / 'vps-service'
if str(VPS_PATH) not in sys.path:
    sys.path.insert(0, str(VPS_PATH))


def main():
    parser = argparse.ArgumentParser(
        description='Backfill price_history.db gaps from Yahoo Finance',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    parser.add_argument(
        '--pred-db',
        default=str(PROJECT_ROOT / 'db' / 'predictions.db'),
        help='Path to predictions.db (default: db/predictions.db)',
    )
    parser.add_argument(
        '--ph-db',
        default=str(PROJECT_ROOT / 'db' / 'price_history.db'),
        help='Path to price_history.db (default: db/price_history.db)',
    )
    parser.add_argument(
        '--stocks-db',
        default=str(PROJECT_ROOT / 'db' / 'stocks.db'),
        help='Path to stocks.db (default: db/stocks.db)',
    )
    parser.add_argument(
        '--market',
        default='EGX',
        choices=['EGX', 'TADAWUL', 'KSE', 'QSE', 'US'],
        help='Market (default: EGX)',
    )
    parser.add_argument(
        '--tickers',
        default=None,
        help='Comma-separated ticker list (default: auto from predictions + stocks)',
    )
    parser.add_argument(
        '--max-days',
        type=int,
        default=45,
        help='Max gap days to fill per ticker (default: 45)',
    )
    parser.add_argument(
        '--sleep',
        type=float,
        default=0.3,
        help='Sleep seconds between tickers for Yahoo rate limits (default: 0.3)',
    )
    parser.add_argument(
        '--dry-run',
        action='store_true',
        help='Fetch from Yahoo but do NOT write to DB (just report)',
    )
    args = parser.parse_args()

    logging.basicConfig(
        level=logging.INFO,
        format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    )

    tickers = None
    if args.tickers:
        tickers = [t.strip().upper() for t in args.tickers.split(',') if t.strip()]

    # ── استورد الـ function الموحّد ──
    try:
        from jobs.price_history_safetynet import fill_price_history_gap
    except ImportError as e:
        print(f"❌ Cannot import fill_price_history_gap: {e}")
        print(f"   VPS_PATH={VPS_PATH}")
        sys.exit(1)

    print(f"\n{'='*70}")
    print(f"📊 price_history.db Backfill (Yahoo Finance — Safety Net)")
    print(f"{'='*70}")
    print(f"  ph_db      : {args.ph_db}")
    print(f"  pred_db    : {args.pred_db}")
    print(f"  stocks_db  : {args.stocks_db}")
    print(f"  market     : {args.market}")
    print(f"  tickers    : {'auto' if not tickers else f'{len(tickers)} provided'}")
    print(f"  max_days   : {args.max_days}")
    print(f"  sleep      : {args.sleep}s")
    print(f"  mode       : {'DRY-RUN (no writes)' if args.dry_run else 'APPLY (will write)'}")
    print(f"{'='*70}\n")

    result = fill_price_history_gap(
        pred_db=args.pred_db,
        ph_db=args.ph_db,
        stocks_db=args.stocks_db,
        market=args.market,
        tickers=tickers,
        max_days=args.max_days,
        sleep_sec=args.sleep,
        dry_run=args.dry_run,
    )

    # ── ملخص ──
    print(f"\n{'='*70}")
    print(f"📋 RESULT")
    print(f"{'='*70}")
    print(f"  Tickers processed : {result.get('tickers_processed', 0)}")
    print(f"  Tickers updated   : {result.get('tickers_updated', 0)}")
    print(f"  Tickers skipped   : {result.get('tickers_skipped', 0)}  (already up to date)")
    print(f"  Tickers failed    : {result.get('tickers_failed', 0)}")
    print(f"  Rows inserted     : {result.get('rows_inserted', 0)}")
    print(f"  MAX(date) before  : {result.get('gap_days_before_max')}")
    print(f"  MAX(date) after   : {result.get('gap_days_after_max')}")
    if result.get('report_path'):
        print(f"  Report            : {result['report_path']}")
    if result.get('sample_updated'):
        print(f"\n  Sample updated:")
        for s in result['sample_updated'][:5]:
            print(f"    • {s['ticker']}: {s['rows']} rows ({s.get('from','?')} → {s.get('to','?')})")
    if result.get('sample_failures'):
        print(f"\n  Sample failures (first 5):")
        for s in result['sample_failures'][:5]:
            print(f"    • {s.get('ticker','?')}: {s.get('reason','?')}")
    print(f"{'='*70}\n")

    if result.get('error'):
        print(f"❌ ERROR: {result['error']}")
        sys.exit(1)

    # ── تحقّق نهائي ──
    if not args.dry_run and result.get('rows_inserted', 0) > 0:
        try:
            import sqlite3
            # Phase 7.1: migrated to db_manager (writable=False)
            from core.db_manager import db_manager
            conn = db_manager.connection(args.ph_db, writable=False).__enter__()
            row = conn.execute("SELECT MAX(date), COUNT(*) FROM price_history").fetchone()
            print(f"✅ Verification: MAX(date)={row[0]}, total rows={row[1]}")
            conn.close()
        except Exception as e:
            print(f"⚠️ Verification query failed: {e}")


if __name__ == '__main__':
    main()
