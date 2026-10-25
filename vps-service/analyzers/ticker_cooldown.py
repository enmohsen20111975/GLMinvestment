"""
vps-service/analyzers/ticker_cooldown.py
=========================================
Ticker Cooldown — منع التكرار بعد الإشارات الكاذبة.

DEEPSEEK AUDIT (2026-10-22):
  "أضف عداداً: إذا أصدر رادار السيولة إشارة شراء على سهم، ثم انخفض السهم
   أكثر من 3% خلال 5 أيام (بدون ضرب ستوب)، يتم تجميد إشارات ذلك السهم
   لمدة 7 أيام."

الـ logic:
  1. لو فيه prediction سابق للسهم نزل أكثر من 3% خلال 5 أيام → cooldown 7 أيام.
  2. لو فيه STOPPED prediction → cooldown 3 أيام.
  3. لو فيه 2+ STOPPED predictions متتالية → cooldown 14 يوم.
"""
import sqlite3
from pathlib import Path
from datetime import datetime, timedelta
from typing import Optional, Dict


PROJECT_ROOT = Path(__file__).resolve().parents[2]
PREDICTIONS_DB = PROJECT_ROOT / 'db' / 'predictions.db'

# Cooldown periods (days)
COOLDOWN_FALSE_SIGNAL = 7   # نزل 3%+ خلال 5 أيام
COOLDOWN_STOPPED = 3        # ضرب ستوب
COOLDOWN_REPEAT_FAILURE = 14  # 2+ ستوب متتاليين

# Thresholds
FALSE_SIGNAL_DROP_PCT = 3.0  # نزول 3% خلال 5 أيام
FALSE_SIGNAL_WINDOW_DAYS = 5


def check_ticker_cooldown(ticker: str) -> Dict:
    """تحقق إذا كان السهم في فترة cooldown.

    Returns:
        dict: {
            'is_cooled_down': bool,
            'reason': str,
            'cooldown_until': str | None,
            'days_remaining': int | None,
        }
    """
    if not PREDICTIONS_DB.exists():
        return {'is_cooled_down': False, 'reason': 'DB not found', 'cooldown_until': None, 'days_remaining': None}

    try:
        # Phase 7.1: migrated to db_manager (writable=False)
        from core.db_manager import db_manager
        conn = db_manager.get_connection(str(PREDICTIONS_DB), writable=False)
        cur = conn.cursor()
        now = datetime.now()

        # 1. Check recent STOPPED predictions (within last 14 days)
        cur.execute("""
            SELECT outcome_date, actual_return, signal
            FROM predictions
            WHERE ticker = ? AND status = 'STOPPED'
            AND outcome_date IS NOT NULL
            AND outcome_date >= date('now', '-14 days')
            ORDER BY outcome_date DESC
        """, (ticker,))
        stopped_rows = cur.fetchall()

        if stopped_rows:
            # Count consecutive stops
            stop_count = len(stopped_rows)
            latest_stop = stopped_rows[0][0] if stopped_rows[0][0] else ''

            if stop_count >= 2:
                # 2+ consecutive stops → 14 day cooldown
                cooldown_days = COOLDOWN_REPEAT_FAILURE
                # Parse the latest stop date
                try:
                    stop_date = datetime.fromisoformat(latest_stop.replace('Z', ''))
                    cooldown_until = stop_date + timedelta(days=cooldown_days)
                    days_remaining = (cooldown_until - now).days
                    if days_remaining > 0:
                        conn.close()
                        return {
                            'is_cooled_down': True,
                            'reason': f'{stop_count} ستوب متتاليين — cooldown {days_remaining} يوم متبقي',
                            'cooldown_until': cooldown_until.isoformat(),
                            'days_remaining': days_remaining,
                        }
                except Exception:
                    pass
            elif stop_count == 1:
                # 1 stop → 3 day cooldown
                try:
                    stop_date = datetime.fromisoformat(latest_stop.replace('Z', ''))
                    cooldown_until = stop_date + timedelta(days=COOLDOWN_STOPPED)
                    days_remaining = (cooldown_until - now).days
                    if days_remaining > 0:
                        conn.close()
                        return {
                            'is_cooled_down': True,
                            'reason': f'ستوب حديث — cooldown {days_remaining} يوم متبقي',
                            'cooldown_until': cooldown_until.isoformat(),
                            'days_remaining': days_remaining,
                        }
                except Exception:
                    pass

        # 2. Check false signal: BUY prediction + price dropped >3% within 5 days
        # (without hitting stop — just price dropped)
        cur.execute("""
            SELECT prediction_date, entry_price, ticker
            FROM predictions
            WHERE ticker = ? AND signal IN ('BUY', 'STRONG_BUY', 'WHALE_RADAR_BUY')
            AND prediction_date >= date('now', '-30 days')
            ORDER BY prediction_date DESC
            LIMIT 5
        """, (ticker,))
        recent_buys = cur.fetchall()

        if recent_buys:
            # Check if price dropped >3% within 5 days of the prediction
            for pred_date_str, entry_price, _ in recent_buys:
                if not entry_price or entry_price <= 0:
                    continue

                # Get price 5 days after prediction
                try:
                    pred_date = datetime.fromisoformat(pred_date_str.replace('Z', '').split(' ')[0])
                except Exception:
                    continue

                check_date = pred_date + timedelta(days=FALSE_SIGNAL_WINDOW_DAYS)

                # Check current price from stocks.db
                stocks_db = PROJECT_ROOT / 'db' / 'stocks.db'
                if stocks_db.exists():
                    try:
                        # Phase 7.1: migrated to db_manager (writable=False)
                        from core.db_manager import db_manager
                        sconn = db_manager.get_connection(str(stocks_db), writable=False)
                        scur = sconn.cursor()
                        scur.execute("SELECT current_price FROM stocks WHERE ticker = ?", (ticker,))
                        row = scur.fetchone()
                        sconn.close()

                        if row and row[0] and row[0] > 0:
                            current_price = float(row[0])
                            drop_pct = (entry_price - current_price) / entry_price * 100

                            if drop_pct >= FALSE_SIGNAL_DROP_PCT:
                                # False signal: price dropped >3% without stop
                                cooldown_until = check_date + timedelta(days=COOLDOWN_FALSE_SIGNAL)
                                days_remaining = (cooldown_until - now).days
                                if days_remaining > 0:
                                    conn.close()
                                    return {
                                        'is_cooled_down': True,
                                        'reason': f'إشارة كاذبة — نزول {drop_pct:.1f}% خلال {FALSE_SIGNAL_WINDOW_DAYS} أيام — cooldown {days_remaining} يوم',
                                        'cooldown_until': cooldown_until.isoformat(),
                                        'days_remaining': days_remaining,
                                    }
                    except Exception:
                        pass

        conn.close()
        return {'is_cooled_down': False, 'reason': 'OK', 'cooldown_until': None, 'days_remaining': None}

    except Exception as e:
        return {'is_cooled_down': False, 'reason': f'error: {e}', 'cooldown_until': None, 'days_remaining': None}
