#!/usr/bin/env python3
"""
Daily Result Checker
====================
سكريبت يشتغل كل يوم الساعة 4:30 مساءً (بعد إغلاق السوق)
يفحص التوقعات المفتوحة ويحدّث نتائجها

المنطق:
1. جيب كل التوقعات اللي status = PENDING
2. قارن سعر الإغلاق مع:
   - الهدف (Target) → لو السعر وصل أو عداه → TARGET_HIT
   - الوقف (Stop Loss) → لو السعر وصل أو نزل عنه → STOPPED
3. لو عدى 14 يوم ولا حاجة حصلت → EXPIRED
4. احسب العائد الفعلي
5. سجل تاريخ الإغلاق وعدد الأيام

Usage:
    python3 scripts/daily_result_checker.py
    python3 scripts/daily_result_checker.py --dry-run
"""

import sqlite3
import os
from datetime import datetime, timedelta
from contextlib import contextmanager
from typing import Optional, Dict, List, Any

# ============================================================================
# CONFIGURATION
# ============================================================================

PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DB_DIR = os.path.join(PROJECT_ROOT, 'db')

PREDICTIONS_DB = os.path.join(DB_DIR, 'predictions.db')
STOCKS_DB = os.path.join(DB_DIR, 'stocks.db')
PRICE_HISTORY_DB = os.path.join(DB_DIR, 'price_history.db')

# عدد أيام التداول قبل ما التوقع يعتبر "منتهي الصلاحية"
EXPIRY_DAYS = 14


@contextmanager
def get_db(db_path: str):
    """Get database connection"""
    # Phase 7.1: migrated to db_manager (writable=False)
    from core.db_manager import db_manager
    conn = db_manager.connection(db_path, writable=False).__enter__()
    conn.row_factory = sqlite3.Row
    try:
        yield conn
    finally:
        conn.close()


def get_latest_price(symbol: str) -> Optional[float]:
    """الحصول على آخر سعر للسهم"""
    # Try stocks.db first (has current_price)
    try:
        with get_db(STOCKS_DB) as conn:
            c = conn.cursor()
            c.execute("SELECT current_price FROM stocks WHERE ticker = ?", (symbol,))
            row = c.fetchone()
            if row and row['current_price'] and row['current_price'] > 0:
                return float(row['current_price'])
    except Exception:
        pass

    # Try price_history.db
    try:
        with get_db(PRICE_HISTORY_DB) as conn:
            c = conn.cursor()
            c.execute(
                "SELECT close_price FROM price_history WHERE ticker = ? ORDER BY date DESC LIMIT 1",
                (symbol,)
            )
            row = c.fetchone()
            if row and row['close_price']:
                return float(row['close_price'])
    except Exception:
        pass

    # Try stock_price_history table in stocks.db
    try:
        with get_db(STOCKS_DB) as conn:
            c = conn.cursor()
            c.execute(
                "SELECT close_price FROM stock_price_history WHERE ticker = ? ORDER BY date DESC LIMIT 1",
                (symbol,)
            )
            row = c.fetchone()
            if row and row['close_price']:
                return float(row['close_price'])
    except Exception:
        pass

    return None


def get_prices_since(symbol: str, start_date: str) -> List[Dict[str, Any]]:
    """الحصول على كل أسعار الإغلاق منذ تاريخ التوقع"""
    prices = []
    
    # Try price_history.db first
    try:
        with get_db(PRICE_HISTORY_DB) as conn:
            c = conn.cursor()
            c.execute(
                """SELECT date, close_price, high_price, low_price 
                   FROM price_history 
                   WHERE ticker = ? AND date >= ? 
                   ORDER BY date ASC""",
                (symbol, start_date)
            )
            for row in c.fetchall():
                prices.append({
                    'date': row['date'],
                    'close': float(row['close_price'] or 0),
                    'high': float(row['high_price'] or 0),
                    'low': float(row['low_price'] or 0),
                })
    except Exception:
        pass

    # If no data, try stock_price_history in stocks.db
    if not prices:
        try:
            with get_db(STOCKS_DB) as conn:
                c = conn.cursor()
                c.execute(
                    """SELECT date, close_price, high_price, low_price 
                       FROM stock_price_history 
                       WHERE ticker = ? AND date >= ? 
                       ORDER BY date ASC""",
                    (symbol, start_date)
                )
                for row in c.fetchall():
                    prices.append({
                        'date': row['date'],
                        'close': float(row['close_price'] or 0),
                        'high': float(row['high_price'] or 0),
                        'low': float(row['low_price'] or 0),
                    })
        except Exception:
            pass

    # If still no data, use current price from stocks.db as fallback
    if not prices:
        current = get_latest_price(symbol)
        if current and current > 0:
            today = datetime.now().strftime('%Y-%m-%d')
            prices.append({
                'date': today,
                'close': current,
                'high': current,
                'low': current,
            })

    return prices


def check_prediction(pred: Dict) -> Dict:
    """
    فحص توقع واحد وتحديد نتيجته
    
    Returns:
        {
            'status': 'TARGET_HIT' | 'STOPPED' | 'EXPIRED' | 'PENDING',
            'final_price': float,
            'actual_return': float,
            'close_date': str,
            'days_held': int
        }
    """
    symbol = pred['stock_symbol']
    entry = float(pred['entry_price'] or 0)
    target = float(pred['target_price'] or 0)
    stop = float(pred['stop_loss'] or 0)
    signal = pred['signal_type'] or 'HOLD'
    pred_date = pred['prediction_date']

    if entry <= 0:
        return {'status': 'PENDING', 'final_price': None, 'actual_return': None, 'close_date': None, 'days_held': 0}

    # Get prices since prediction date
    prices = get_prices_since(symbol, pred_date)

    if not prices:
        # No price data - check if expired
        try:
            pred_datetime = datetime.strptime(pred_date, '%Y-%m-%d')
            days_since = (datetime.now() - pred_datetime).days
            if days_since >= EXPIRY_DAYS:
                return {
                    'status': 'EXPIRED',
                    'final_price': None,
                    'actual_return': None,
                    'close_date': datetime.now().strftime('%Y-%m-%d'),
                    'days_held': days_since
                }
        except Exception:
            pass
        return {'status': 'PENDING', 'final_price': None, 'actual_return': None, 'close_date': None, 'days_held': 0}

    # Check each day's prices
    for i, price in enumerate(prices):
        high = price['high']
        low = price['low']
        close = price['close']
        days_held = i + 1

        if signal == 'BUY':
            # BUY: target above entry, stop below entry
            if target > 0 and high >= target:
                actual_return = ((target - entry) / entry) * 100
                return {
                    'status': 'TARGET_HIT',
                    'final_price': target,
                    'actual_return': actual_return,
                    'close_date': price['date'],
                    'days_held': days_held
                }
            if stop > 0 and low <= stop:
                actual_return = ((stop - entry) / entry) * 100
                return {
                    'status': 'STOPPED',
                    'final_price': stop,
                    'actual_return': actual_return,
                    'close_date': price['date'],
                    'days_held': days_held
                }

        elif signal == 'SELL':
            # SELL: target below entry, stop above entry
            if target > 0 and low <= target:
                actual_return = ((entry - target) / entry) * 100
                return {
                    'status': 'TARGET_HIT',
                    'final_price': target,
                    'actual_return': actual_return,
                    'close_date': price['date'],
                    'days_held': days_held
                }
            if stop > 0 and high >= stop:
                actual_return = ((entry - stop) / entry) * 100
                return {
                    'status': 'STOPPED',
                    'final_price': stop,
                    'actual_return': actual_return,
                    'close_date': price['date'],
                    'days_held': days_held
                }

    # Check expiry
    try:
        pred_datetime = datetime.strptime(pred_date, '%Y-%m-%d')
        days_since = (datetime.now() - pred_datetime).days
        if days_since >= EXPIRY_DAYS:
            # Use last available price
            last_price = prices[-1]['close'] if prices else None
            actual_return = None
            if last_price and entry > 0:
                if signal == 'BUY':
                    actual_return = ((last_price - entry) / entry) * 100
                elif signal == 'SELL':
                    actual_return = ((entry - last_price) / entry) * 100
            return {
                'status': 'EXPIRED',
                'final_price': last_price,
                'actual_return': actual_return,
                'close_date': datetime.now().strftime('%Y-%m-%d'),
                'days_held': len(prices)
            }
    except Exception:
        pass

    # Still pending
    last_price = prices[-1]['close'] if prices else None
    actual_return = None
    if last_price and entry > 0:
        if signal == 'BUY':
            actual_return = ((last_price - entry) / entry) * 100
        elif signal == 'SELL':
            actual_return = ((entry - last_price) / entry) * 100

    return {
        'status': 'PENDING',
        'final_price': last_price,
        'actual_return': actual_return,
        'close_date': None,
        'days_held': len(prices)
    }


def run_check(dry_run=False):
    """تشغيل الفحص على كل التوقعات المفتوحة"""
    print("=" * 60)
    print("🔍 Daily Result Checker")
    print(f"📅 {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    if dry_run:
        print("⚠️  Dry Run - لن يتم حفظ التغييرات")
    print("=" * 60)

    with get_db(PREDICTIONS_DB) as conn:
        c = conn.cursor()

        # Get all pending predictions
        c.execute("""
            SELECT * FROM aiPrediction 
            WHERE status = 'PENDING' 
            ORDER BY prediction_date DESC
        """)
        pending = c.fetchall()

        print(f"\n📊 توقعات مفتوحة: {len(pending)}")

        if not pending:
            print("مفيش توقعات مفتوحة حالياً")
            return

        updated = 0
        results = {
            'TARGET_HIT': 0,
            'STOPPED': 0,
            'EXPIRED': 0,
            'PENDING': 0
        }

        for pred in pending:
            pred_dict = dict(pred)
            result = check_prediction(pred_dict)

            results[result['status']] = results.get(result['status'], 0) + 1

            if result['status'] != 'PENDING':
                updated += 1
                print(f"  {pred_dict['stock_symbol']}: {result['status']} "
                      f"({result['actual_return']:+.1f}% in {result['days_held']} days)" if result['actual_return'] 
                      else f"  {pred_dict['stock_symbol']}: {result['status']}")

                if not dry_run:
                    c.execute("""
                        UPDATE aiPrediction 
                        SET status = ?, 
                            final_price = ?, 
                            profit_loss_percent = ?,
                            hit_target = ?,
                            hit_stop_loss = ?,
                            days_to_target = ?,
                            days_held = ?,
                            close_date = ?,
                            updated_at = ?
                        WHERE id = ?
                    """, (
                        result['status'],
                        result['final_price'],
                        result['actual_return'],
                        1 if result['status'] == 'TARGET_HIT' else 0,
                        1 if result['status'] == 'STOPPED' else 0,
                        result['days_held'],
                        result['days_held'],
                        result['close_date'],
                        datetime.now().isoformat(),
                        pred_dict['id']
                    ))
            else:
                # Update pending with latest price
                if not dry_run and result['final_price']:
                    c.execute("""
                        UPDATE aiPrediction 
                        SET final_price = ?, 
                            days_held = ?,
                            updated_at = ?
                        WHERE id = ?
                    """, (
                        result['final_price'],
                        result['days_held'],
                        datetime.now().isoformat(),
                        pred_dict['id']
                    ))

        if not dry_run:
            conn.commit()

        print(f"\n{'='*60}")
        print(f"📊 النتائج:")
        print(f"  🎯 تم تحقيق الهدف: {results['TARGET_HIT']}")
        print(f"  🛑 وقف خسارة: {results['STOPPED']}")
        print(f"  ⚠️ منتهي الصلاحية: {results['EXPIRED']}")
        print(f"  ⏳ لسه مفتوح: {results['PENDING']}")
        print(f"  📝 تم تحديث: {updated}")
        print(f"{'='*60}")


def show_stats():
    """عرض إحصائيات التوقعات"""
    print("\n" + "=" * 60)
    print("📊 إحصائيات التوقعات")
    print("=" * 60)

    with get_db(PREDICTIONS_DB) as conn:
        c = conn.cursor()

        # Total by status
        c.execute("""
            SELECT status, COUNT(*) as cnt 
            FROM aiPrediction 
            GROUP BY status
        """)
        print("\nحسب الحالة:")
        for row in c.fetchall():
            print(f"  {row['status']}: {row['cnt']}")

        # Win rate
        c.execute("""
            SELECT 
                COUNT(*) as total,
                SUM(CASE WHEN status = 'TARGET_HIT' THEN 1 ELSE 0 END) as wins,
                SUM(CASE WHEN status = 'STOPPED' THEN 1 ELSE 0 END) as losses,
                AVG(CASE WHEN status = 'TARGET_HIT' THEN profit_loss_percent END) as avg_profit,
                AVG(CASE WHEN status = 'STOPPED' THEN profit_loss_percent END) as avg_loss
            FROM aiPrediction 
            WHERE status IN ('TARGET_HIT', 'STOPPED')
        """)
        stats = c.fetchone()
        total = stats['total'] or 0
        wins = stats['wins'] or 0
        losses = stats['losses'] or 0
        win_rate = (wins / total * 100) if total > 0 else 0

        print(f"\n📊 أداء التوقعات المغلقة:")
        print(f"  إجمالي: {total}")
        print(f"  🎯 رابحة: {wins}")
        print(f"  🛑 خاسرة: {losses}")
        print(f"  📈 نسبة النجاح: {win_rate:.1f}%")
        if stats['avg_profit']:
            print(f"  💚 متوسط الربح: {stats['avg_profit']:+.1f}%")
        if stats['avg_loss']:
            print(f"  ❤️ متوسط الخسارة: {stats['avg_loss']:+.1f}%")


def main():
    import argparse
    parser = argparse.ArgumentParser(description='Daily Result Checker')
    parser.add_argument('--dry-run', action='store_true', help='معاينة بدون حفظ')
    args = parser.parse_args()

    run_check(dry_run=args.dry_run)
    show_stats()


if __name__ == '__main__':
    main()
