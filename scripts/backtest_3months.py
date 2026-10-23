#!/usr/bin/env python3
"""
backtest_3months.py — باك تست لـ 3 شهور (Phase 9 — Backtest Tool)
===================================================================

الـ script ده بيـ:
  1. يتحقق من الـ DBs (price_history.db + stocks.db)
  2. يشغل daily_predictor.py لفترة 3 شهور
  3. يشغل daily_closer.py عشان يقفل التوقعات
  4. يطبع تقرير بالنتايج (win rate, profit factor, picks count)

الاستخدام على الابتوب:
  cd ~/my_apps/GLMinvestment
  .venv/bin/python3 scripts/backtest_3months.py

أو بـ فترة مخصصة:
  .venv/bin/python3 scripts/backtest_3months.py --start 2026-03-10 --end 2026-06-10

أو dry-run (بدون كتابة في DB):
  .venv/bin/python3 scripts/backtest_3months.py --dry-run

Author: برافو (Phase 9 — Backtest Tool)
"""
from __future__ import annotations

import os
import sys
import json
import argparse
import sqlite3
from datetime import datetime, timedelta
from pathlib import Path
from collections import Counter
from subprocess import run, PIPE

# ─── Project paths ───
SCRIPT_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = SCRIPT_DIR.parent
VPS_SERVICE = PROJECT_ROOT / 'vps-service'
DB_DIR = PROJECT_ROOT / 'db'

# ─── Default backtest period: last 3 months from latest data ───
DEFAULT_END = '2026-06-10'      # latest data in price_history.db
DEFAULT_START = '2026-03-10'    # 3 months before


def check_dbs():
    """التحقق من وجود الـ DBs المطلوبة."""
    print("=" * 70)
    print("  الخطوة 1: التحقق من قواعد البيانات")
    print("=" * 70)
    print()

    required = ['stocks.db', 'price_history.db', 'predictions.db']
    missing = []

    for db_name in required:
        db_path = DB_DIR / db_name
        if db_path.exists():
            # Check date range
            try:
                conn = sqlite3.connect(str(db_path), timeout=10.0)
                if db_name == 'price_history.db':
                    result = conn.execute(
                        "SELECT MIN(date), MAX(date), COUNT(*) FROM price_history"
                    ).fetchone()
                    print(f"  ✅ {db_name}: {result[0]} → {result[1]} ({result[2]:,} rows)")
                elif db_name == 'stocks.db':
                    result = conn.execute(
                        "SELECT COUNT(*) FROM stocks WHERE is_active=1"
                    ).fetchone()
                    print(f"  ✅ {db_name}: {result[0]} active stocks")
                elif db_name == 'predictions.db':
                    result = conn.execute(
                        "SELECT COUNT(*) FROM predictions"
                    ).fetchone()
                    print(f"  ✅ {db_name}: {result[0]} existing predictions")
                conn.close()
            except Exception as e:
                print(f"  ⚠️  {db_name}: exists but error reading ({e})")
        else:
            print(f"  ❌ {db_name}: MISSING")
            missing.append(db_name)

    if missing:
        print(f"\n❌ مفقود: {missing}")
        print("  نفك الـ DBs من data/*.zip:")
        print("  unzip data/predictions.db.zip -d db/")
        print("  unzip db/stocks.db.zip -d db/")
        print("  unzip db/price_history.db.zip -d db/")
        return False

    print()
    return True


def run_predictor(start_date, end_date, dry_run=False):
    """تشغيل daily_predictor.py لفترة الباك تست."""
    print("=" * 70)
    print("  الخطوة 2: توليد التوقعات (daily_predictor.py)")
    print("=" * 70)
    print(f"  الفترة: {start_date} → {end_date}")
    print(f"  Dry-run: {dry_run}")
    print()

    cmd = [
        sys.executable,
        str(VPS_SERVICE / 'jobs' / 'daily_predictor.py'),
        '--start', start_date,
        '--end', end_date,
        '--scan-interval', '1',
        '--max-tickers', '200',
        
    ]
    if dry_run:
        cmd.append('--dry-run')

    print(f"  Command: {' '.join(cmd)}")
    print()

    # Set PYTHONPATH so analyzer_modules can be found
    env = os.environ.copy()
    env['PYTHONPATH'] = ':'.join([
        str(VPS_SERVICE),
        str(VPS_SERVICE / 'analyzers'),
        str(VPS_SERVICE / 'jobs'),
        env.get('PYTHONPATH', ''),
    ])

    result = run(cmd, cwd=str(PROJECT_ROOT), capture_output=True, text=True, timeout=3600, env=env)

    # Print last 50 lines of output
    output_lines = result.stdout.strip().split('\n')
    print("  Output (last 50 lines):")
    for line in output_lines[-50:]:
        print(f"    {line}")

    if result.returncode != 0:
        print(f"\n  ❌ EXIT CODE: {result.returncode}")
        if result.stderr:
            print(f"  STDERR: {result.stderr[-500:]}")
        return False

    print(f"\n  ✅ daily_predictor.py completed successfully")
    return True


def run_closer(start_date, end_date, dry_run=False):
    """تشغيل daily_closer.py لقفل التوقعات."""
    if dry_run:
        print("\n  ⏭️  تخطي daily_closer.py (--dry-run mode)")
        return True

    print("\n" + "=" * 70)
    print("  الخطوة 3: قفل التوقعات (daily_closer.py)")
    print("=" * 70)
    print()

    cmd = [
        sys.executable,
        str(VPS_SERVICE / 'jobs' / 'daily_closer.py'),
    ]

    print(f"  Command: {' '.join(cmd)}")
    print()

    # Set PYTHONPATH for daily_closer imports
    closer_env = os.environ.copy()
    closer_env['PYTHONPATH'] = ':'.join([
        str(VPS_SERVICE),
        str(VPS_SERVICE / 'jobs'),
        closer_env.get('PYTHONPATH', ''),
    ])
    result = run(cmd, cwd=str(VPS_SERVICE), capture_output=True, text=True, timeout=3600, env=closer_env)

    output_lines = result.stdout.strip().split('\n')
    print("  Output (last 30 lines):")
    for line in output_lines[-30:]:
        print(f"    {line}")

    if result.returncode != 0:
        print(f"\n  ⚠️  daily_closer.py exited with code {result.returncode}")
        return False

    print(f"\n  ✅ daily_closer.py completed successfully")
    return True


def generate_report(start_date, end_date):
    """توليد تقرير بالنتايج."""
    print("\n" + "=" * 70)
    print("  الخطوة 4: تقرير النتائج")
    print("=" * 70)
    print()

    pred_db = str(DB_DIR / 'predictions.db')
    try:
        conn = sqlite3.connect(pred_db, timeout=30.0)
        conn.row_factory = sqlite3.Row

        # Total predictions in the period
        total = conn.execute("""
            SELECT COUNT(*) as cnt FROM predictions
            WHERE prediction_date >= ? AND prediction_date <= ?
        """, (start_date, end_date)).fetchone()['cnt']
        print(f"  إجمالي التوقعات: {total}")

        if total == 0:
            print("  ⚠️  مفيش توقعات في الفترة دي. تأكد إن daily_predictor.py شغل صح.")
            conn.close()
            return

        # Closed predictions
        closed = conn.execute("""
            SELECT COUNT(*) as cnt FROM predictions
            WHERE prediction_date >= ? AND prediction_date <= ?
              AND outcome_date IS NOT NULL
        """, (start_date, end_date)).fetchone()['cnt']
        print(f"  توقعات مقفولة: {closed}")

        # Win/loss stats
        wins = conn.execute("""
            SELECT COUNT(*) as cnt FROM predictions
            WHERE prediction_date >= ? AND prediction_date <= ?
              AND hit_target = 1
        """, (start_date, end_date)).fetchone()['cnt']
        losses = conn.execute("""
            SELECT COUNT(*) as cnt FROM predictions
            WHERE prediction_date >= ? AND prediction_date <= ?
              AND hit_stop = 1
        """, (start_date, end_date)).fetchone()['cnt']
        expired = closed - wins - losses

        print(f"  🎯 Target hit: {wins}")
        print(f"  🛑 Stopped: {losses}")
        print(f"  ⏰ Expired: {expired}")

        if closed > 0:
            win_rate = wins / closed * 100
            print(f"\n  📊 Win Rate: {win_rate:.1f}%")

        # Signal distribution
        sig_dist = conn.execute("""
            SELECT signal, COUNT(*) as cnt FROM predictions
            WHERE prediction_date >= ? AND prediction_date <= ?
            GROUP BY signal ORDER BY cnt DESC
        """, (start_date, end_date)).fetchall()
        if sig_dist:
            print(f"\n  توزيع الإشارات:")
            for s in sig_dist:
                print(f"    {s['signal']}: {s['cnt']}")

        # Average return
        avg_return = conn.execute("""
            SELECT AVG(actual_return) as avg_ret FROM predictions
            WHERE prediction_date >= ? AND prediction_date <= ?
              AND actual_return IS NOT NULL
        """, (start_date, end_date)).fetchone()['avg_ret']
        if avg_return is not None:
            print(f"\n  📈 متوسط العائد: {avg_return:.2f}%")

        # Top 5 tickers by predictions count
        top_tickers = conn.execute("""
            SELECT ticker, COUNT(*) as cnt FROM predictions
            WHERE prediction_date >= ? AND prediction_date <= ?
            GROUP BY ticker ORDER BY cnt DESC LIMIT 5
        """, (start_date, end_date)).fetchall()
        if top_tickers:
            print(f"\n  أكثر 5 أسهم توقعات:")
            for t in top_tickers:
                print(f"    {t['ticker']}: {t['cnt']} توقع")

        conn.close()

        # Save report to file
        report = {
            'period': f'{start_date} → {end_date}',
            'generated_at': datetime.now().isoformat(),
            'total_predictions': total,
            'closed': closed,
            'wins': wins,
            'losses': losses,
            'expired': expired,
            'win_rate': round(wins / closed * 100, 1) if closed > 0 else 0,
            'avg_return': round(avg_return, 2) if avg_return else None,
        }
        report_path = PROJECT_ROOT / 'backtest_results'
        report_path.mkdir(exist_ok=True)
        report_file = report_path / f'backtest_3months_{datetime.now().strftime("%Y%m%d_%H%M%S")}.json'
        with open(report_file, 'w') as f:
            json.dump(report, f, indent=2, ensure_ascii=False)
        print(f"\n  💾 التقرير محفوظ: {report_file}")

    except Exception as e:
        print(f"  ❌ خطأ في توليد التقرير: {e}")


def main():
    parser = argparse.ArgumentParser(
        description='باك تست لـ 3 شهور — يولّد توقعات + يقفلها + يطبع تقرير',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
أمثلة:
  %(prog)s                                    # باك تست 3 شهور (افتراضي)
  %(prog)s --start 2026-03-10 --end 2026-06-10  # فترة مخصصة
  %(prog)s --dry-run                          # جاف فقط (بدون كتابة في DB)
  %(prog)s --skip-closer                      # تخطي القفل
        """
    )
    parser.add_argument('--start', default=DEFAULT_START,
                        help=f'تاريخ البداية (افتراضي: {DEFAULT_START})')
    parser.add_argument('--end', default=DEFAULT_END,
                        help=f'تاريخ النهاية (افتراضي: {DEFAULT_END})')
    parser.add_argument('--dry-run', action='store_true',
                        help='جاف فقط — لا كتابة في DB')
    parser.add_argument('--skip-closer', action='store_true',
                        help='تخطي daily_closer.py')
    args = parser.parse_args()

    print()
    print("╔══════════════════════════════════════════════════════════════╗")
    print("║  📊 باك تست لـ 3 شهور — GLMinvestment                        ║")
    print("╚══════════════════════════════════════════════════════════════╝")
    print(f"  الفترة: {args.start} → {args.end}")
    print(f"  Mode: {'DRY-RUN' if args.dry_run else 'LIVE (writes to DB)'}")
    print()

    # Step 1: Check DBs
    if not check_dbs():
        sys.exit(1)

    # Step 2: Run predictor
    if not run_predictor(args.start, args.end, args.dry_run):
        print("\n❌ فشل في توليد التوقعات. توقف.")
        sys.exit(1)

    # Step 3: Run closer (skip in dry-run or --skip-closer)
    if not args.skip_closer:
        if not run_closer(args.start, args.end, args.dry_run):
            print("\n⚠️  daily_closer.py فيه مشاكل — كمّل مع التقرير.")

    # Step 4: Generate report
    if not args.dry_run:
        generate_report(args.start, args.end)
    else:
        print("\n  ⏭️  تخطي التقرير (--dry-run mode)")

    print("\n" + "=" * 70)
    print("  ✅ الباك تست اكتمل!")
    print("=" * 70)
    print()


if __name__ == '__main__':
    main()
