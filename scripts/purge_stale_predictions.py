#!/usr/bin/env python3
"""
scripts/purge_stale_predictions.py
==================================
سكريبت التطهير اللحظي للتوصيات الميتة.

يطابق السعر اللحظي لكل سهم بجدول stored_analyses و predictions.
أي توصية شراء (BUY / STRONG_BUY) يتحقق فيها أحد الشرطين:
  1. current_price <= stop_loss (السهم كسر الوقف ومات)
  2. تاريخ التوصية أقدم من 48 ساعة + ابتعاد السعر عن الدخول > 6%

الإجراء الحتمي:
  - status = 'STOPPED_OUT'
  - recommendation = 'HOLD', recommendation_ar = 'ملغية - كسر الوقف'
  - تصفير أهداف الصعود الوهمية

Usage:
    python3 scripts/purge_stale_predictions.py
    python3 scripts/purge_stale_predictions.py --dry-run  # عرض فقط بدون تعديل
"""
import sqlite3
import os
import sys
import argparse
from pathlib import Path
from datetime import datetime

PROJECT_ROOT = Path(__file__).resolve().parents[1]
PREDICTIONS_DB = PROJECT_ROOT / 'db' / 'predictions.db'
STOCKS_DB = PROJECT_ROOT / 'db' / 'stocks.db'

STALE_HOURS = 48
PRICE_DEVIATION_PCT = 6.0  # > 6% من سعر الدخول


def get_current_prices(tickers: list) -> dict:
    """اقرأ السعر اللحظي من stocks.db لكل سهم."""
    prices = {}
    if not STOCKS_DB.exists():
        return prices
    try:
        # Phase 7.1: migrated to db_manager (writable=False)
        from core.db_manager import db_manager
        conn = db_manager.connection(STOCKS_DB, writable=False).__enter__()
        for ticker in tickers:
            row = conn.execute(
                "SELECT current_price FROM stocks WHERE ticker = ?", (ticker,)
            ).fetchone()
            if row and row[0] and row[0] > 0:
                prices[ticker] = float(row[0])
        conn.close()
    except Exception as e:
        print(f"⚠️ stocks.db read error: {e}")
    return prices


def purge_stale(dry_run: bool = False) -> dict:
    """تشغيل التطهير اللحظي."""
    if not PREDICTIONS_DB.exists():
        print(f"❌ predictions.db not found: {PREDICTIONS_DB}")
        return {'error': 'DB not found'}

    # Phase 7.1: migrated to db_manager (writable=False)
    from core.db_manager import db_manager
    conn = db_manager.connection(str(PREDICTIONS_DB), writable=False).__enter__()
    cur = conn.cursor()
    stats = {
        'stop_broken': 0,
        'stale_48h': 0,
        'rr_low': 0,
        'total_purged': 0,
        'remaining_buy': 0,
    }

    # ── 1. stored_analyses: BUY + current_price <= stop_loss ──
    print("\n━━━ 1. stored_analyses: كسر الوقف ━━━")
    sa_rows = cur.execute("""
        SELECT id, ticker, entry_price, stop_loss, target_price, recommendation, created_at
        FROM stored_analyses
        WHERE recommendation LIKE '%BUY%'
    """).fetchall()

    tickers = [r[1] for r in sa_rows]
    prices = get_current_prices(tickers)

    for row in sa_rows:
        sa_id, ticker, entry, stop, target, rec, created = row
        current = prices.get(ticker, 0)

        should_purge = False
        reason = ''

        # شرط 1: current_price <= stop_loss
        if current > 0 and stop and current <= stop:
            should_purge = True
            reason = f'كسر الوقف: current={current} <= stop={stop}'

        # شرط 2: أقدم من 48h + ابتعاد > 6%
        elif created:
            try:
                created_dt = datetime.fromisoformat(str(created).replace(' ', 'T').split('.')[0])
                hours_old = (datetime.now() - created_dt).total_seconds() / 3600
                if hours_old > STALE_HOURS and entry and current > 0:
                    deviation = abs((current - entry) / entry * 100)
                    if deviation > PRICE_DEVIATION_PCT:
                        should_purge = True
                        reason = f'قديمة {hours_old:.0f}h + ابتعاد {deviation:.1f}%'
            except Exception:
                pass

        if should_purge:
            stats['stop_broken' if 'كسر' in reason else 'stale_48h'] += 1
            print(f"  🔴 {ticker}: {reason}")
            if not dry_run:
                cur.execute("""
                    UPDATE stored_analyses SET
                        recommendation = 'HOLD',
                        recommendation_ar = 'ملغية - كسر الوقف',
                        target_price = NULL,
                        stop_loss = NULL,
                        confidence = 0,
                        updated_at = datetime('now')
                    WHERE id = ?
                """, (sa_id,))

    # ── 2. predictions: BUY + stop_broken or stale ──
    print("\n━━━ 2. predictions: كسر الوقف + قديمة ━━━")
    pred_rows = cur.execute("""
        SELECT id, ticker, entry_price, stop_loss, signal, created_at
        FROM predictions
        WHERE signal IN ('BUY', 'STRONG_BUY', 'WHALE_RADAR_BUY')
        AND status = 'testing'
    """).fetchall()

    pred_tickers = [r[1] for r in pred_rows]
    pred_prices = get_current_prices(pred_tickers)

    for row in pred_rows:
        pred_id, ticker, entry, stop, signal, created = row
        current = pred_prices.get(ticker, 0)

        should_purge = False
        reason = ''

        if current > 0 and stop and current <= stop:
            should_purge = True
            reason = f'كسر الوقف: current={current} <= stop={stop}'
        elif created:
            try:
                created_dt = datetime.fromisoformat(str(created).replace(' ', 'T').split('.')[0])
                hours_old = (datetime.now() - created_dt).total_seconds() / 3600
                if hours_old > STALE_HOURS and entry and current > 0:
                    deviation = abs((current - entry) / entry * 100)
                    if deviation > PRICE_DEVIATION_PCT:
                        should_purge = True
                        reason = f'قديمة {hours_old:.0f}h + ابتعاد {deviation:.1f}%'
            except Exception:
                pass

        if should_purge:
            stats['stop_broken' if 'كسر' in reason else 'stale_48h'] += 1
            print(f"  🔴 {ticker}: {reason}")
            if not dry_run:
                cur.execute("""
                    UPDATE predictions SET
                        status = 'STOPPED_OUT',
                        exit_type = 'STALE_PURGE',
                        outcome_date = datetime('now'),
                        updated_at = datetime('now'),
                        target_price = NULL
                    WHERE id = ?
                """, (pred_id,))

    # ── 3. predictions: R/R < 2.0 ──
    print("\n━━━ 3. predictions: R/R < 2.0 ━━━")
    if not dry_run:
        low_rr = cur.execute("""
            UPDATE predictions SET
                status = 'STOPPED_OUT',
                exit_type = 'LOW_RR_PURGE',
                outcome_date = datetime('now'),
                updated_at = datetime('now'
            )
            WHERE signal IN ('BUY', 'STRONG_BUY', 'WHALE_RADAR_BUY')
            AND status = 'testing'
            AND risk_reward IS NOT NULL
            AND risk_reward < 2.0
        """).rowcount
        stats['rr_low'] = low_rr
        if low_rr > 0:
            print(f"  🔴 {low_rr} predictions with R/R < 2.0 → STOPPED_OUT")

    if not dry_run:
        conn.commit()

    # ── 4. Verification ──
    remaining = cur.execute("""
        SELECT COUNT(*) FROM stored_analyses
        WHERE (recommendation LIKE '%BUY%' OR signal LIKE '%BUY%')
        AND stop_loss IS NOT NULL
        AND entry_price IS NOT NULL
        AND stop_loss >= entry_price
    """).fetchone()[0]

    remaining_buy = cur.execute("""
        SELECT COUNT(*) FROM stored_analyses
        WHERE recommendation LIKE '%BUY%'
    """).fetchone()[0]

    stats['remaining_violations'] = remaining
    stats['remaining_buy'] = remaining_buy
    stats['total_purged'] = stats['stop_broken'] + stats['stale_48h'] + stats['rr_low']

    conn.close()
    return stats


def main():
    parser = argparse.ArgumentParser(description='Purge stale predictions')
    parser.add_argument('--dry-run', action='store_true', help='عرض فقط بدون تعديل')
    args = parser.parse_args()

    print("=" * 60)
    print("🧹 BRAVO — Purge Stale Predictions")
    print(f"   DB: {PREDICTIONS_DB}")
    print(f"   Mode: {'DRY RUN' if args.dry_run else 'LIVE'}")
    print("=" * 60)

    stats = purge_stale(dry_run=args.dry_run)

    print(f"\n━━━ Results ━━━")
    for k, v in stats.items():
        print(f"  {k}: {v}")

    # Proof query
    print(f"\n━━━ Proof Query ━━━")
    print(f"  SELECT count(*) FROM stored_analyses")
    print(f"  WHERE (recommendation LIKE '%BUY%' OR signal LIKE '%BUY%')")
    print(f"    AND stop_loss >= current_price;")
    print(f"  Result: {stats.get('remaining_violations', '?')}")

    if stats.get('remaining_violations') == 0:
        print(f"\n✅ PROOF PASSED: 0 violations")
    else:
        print(f"\n❌ PROOF FAILED: {stats.get('remaining_violations')} violations remain")

    return 0 if stats.get('remaining_violations') == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
