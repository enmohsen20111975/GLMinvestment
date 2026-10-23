#!/usr/bin/env python3
"""
data_heartbeat_checker.py — Dead Man's Switch (P0-KILLSWITCH-050)
==================================================================
يفحص كل 10 دقايق (عبر cron) لو محرك البيانات شغال وبيجمع داتا.
لو الداتا قديمة (> 3 أيام)، يبعت رسالة إنذار على تليجرام.

التشغيل:
  crontab -e
  */10 * * * * /usr/bin/python3 /home/z/my-project/scripts/data_heartbeat_checker.py >> /var/log/data_heartbeat.log 2>&1
"""
import sqlite3
import os
import sys
import logging
from datetime import datetime, timedelta

logging.basicConfig(level=logging.INFO, format='%(asctime)s [%(levelname)s] %(message)s')
logger = logging.getLogger(__name__)

# ── إعدادات ──
PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
STOCKS_DB = os.path.join(PROJECT_ROOT, 'db', 'stocks.db')
PRICE_HISTORY_DB = os.path.join(PROJECT_ROOT, 'db', 'price_history.db')
PREDICTIONS_DB = os.path.join(PROJECT_ROOT, 'db', 'predictions.db')

TELEGRAM_BOT_TOKEN = os.getenv('TELEGRAM_BOT_TOKEN', '')
TELEGRAM_CHAT_ID = os.getenv('TELEGRAM_CHAT_ID', '')
ALERT_THRESHOLD_DAYS = 3  # لو الداتا أقدم من 3 أيام → إنذار


def send_telegram(message: str):
    """يبعت رسالة على تليجرام (لو التوكين متاح)."""
    if not TELEGRAM_BOT_TOKEN or not TELEGRAM_CHAT_ID:
        logger.warning(f"[Heartbeat] Telegram not configured. Message: {message}")
        return
    try:
        import urllib.request
        import json
        url = f"https://api.telegram.org/bot{TELEGRAM_BOT_TOKEN}/sendMessage"
        data = json.dumps({
            'chat_id': TELEGRAM_CHAT_ID,
            'text': message,
            'parse_mode': 'HTML',
        }).encode('utf-8')
        req = urllib.request.Request(url, data=data, headers={'Content-Type': 'application/json'})
        urllib.request.urlopen(req, timeout=5)
    except Exception as e:
        logger.error(f"[Heartbeat] Telegram send failed: {e}")


def check_price_history() -> dict:
    """يفحص price_history.db — آخر تاريخ مسجل."""
    result = {'db': 'price_history.db', 'last_date': None, 'table': 'price_history', 'error': None}
    if not os.path.exists(PRICE_HISTORY_DB):
        result['error'] = 'DB file not found'
        return result
    try:
        # Phase 7.1: migrated to db_manager (writable=False)
        from core.db_manager import db_manager
        conn = db_manager.connection(PRICE_HISTORY_DB, writable=False).__enter__()
        cur = conn.cursor()
        # جرّب price_history table
        try:
            cur.execute("SELECT MAX(date) FROM price_history")
            row = cur.fetchone()
            result['last_date'] = row[0] if row else None
            result['table'] = 'price_history'
        except sqlite3.OperationalError:
            # جرّب stock_daily_prices
            try:
                cur.execute("SELECT MAX(price_date) FROM stock_daily_prices")
                row = cur.fetchone()
                result['last_date'] = row[0] if row else None
                result['table'] = 'stock_daily_prices'
            except sqlite3.OperationalError:
                result['error'] = 'No valid table found'
        conn.close()
    except Exception as e:
        result['error'] = str(e)
    return result


def check_stocks_db() -> dict:
    """يفحص stocks.db — آخر تحديث لـ last_update."""
    result = {'db': 'stocks.db', 'last_update': None, 'error': None}
    if not os.path.exists(STOCKS_DB):
        result['error'] = 'DB file not found'
        return result
    try:
        # Phase 7.1: migrated to db_manager (writable=True)
        from core.db_manager import db_manager
        conn = db_manager.connection(STOCKS_DB, writable=True).__enter__()
        cur = conn.cursor()
        cur.execute("SELECT MAX(last_update) FROM stocks WHERE last_update IS NOT NULL")
        row = cur.fetchone()
        result['last_update'] = row[0] if row else None
        conn.close()
    except Exception as e:
        result['error'] = str(e)
    return result


def parse_date(date_str: str) -> datetime:
    """يحاول يحوّل نص تاريخ لـ datetime object."""
    if not date_str:
        return None
    for fmt in ['%Y-%m-%d %H:%M:%S', '%Y-%m-%dT%H:%M:%S', '%Y-%m-%d', '%Y-%m-%dT%H:%M:%S.%f']:
        try:
            return datetime.strptime(str(date_str).split('.')[0], fmt)
        except ValueError:
            continue
    return None


def check_heartbeat():
    """الفحص الرئيسي — لو الداتا قديمة → إنذار تليجرام."""
    logger.info("[Heartbeat] Starting data heartbeat check...")

    # 1. فحص price_history.db
    ph_result = check_price_history()
    ph_last = parse_date(ph_result.get('last_date', '')) if ph_result.get('last_date') else None

    # 2. فحص stocks.db
    st_result = check_stocks_db()
    st_last = parse_date(st_result.get('last_update', '')) if st_result.get('last_update') else None

    now = datetime.now()
    alerts = []

    # فحص price_history
    if ph_result.get('error'):
        alerts.append(f"🚨 price_history.db: خطأ — {ph_result['error']}")
    elif not ph_last:
        alerts.append("🚨 price_history.db: مفيش ولا صف! محرك البيانات ميت تماماً.")
    else:
        ph_diff = (now - ph_last).days
        if ph_diff >= ALERT_THRESHOLD_DAYS:
            alerts.append(
                f"🚨 <b>price_history.db:</b> آخر تحديث كان <b>{ph_last.strftime('%Y-%m-%d')}</b> "
                f"(من <b>{ph_diff} أيام</b>) — محرك البيانات متوقف!"
            )
        else:
            logger.info(f"[Heartbeat] price_history OK — last: {ph_last.strftime('%Y-%m-%d')} ({ph_diff}d ago)")

    # فحص stocks.db
    if st_result.get('error'):
        alerts.append(f"⚠️ stocks.db: خطأ — {st_result['error']}")
    elif not st_last:
        alerts.append("⚠️ stocks.db: مفيش last_update! محرك البيانات مش بيكتب.")
    else:
        st_diff_hours = (now - st_last).total_seconds() / 3600
        if st_diff_hours >= 24:
            alerts.append(
                f"🚨 <b>stocks.db:</b> آخر تحديث كان <b>{st_last.strftime('%Y-%m-%d %H:%M')}</b> "
                f"(من <b>{st_diff_hours:.0f} ساعة</b>) — محرك البيانات متوقف!"
            )
        else:
            logger.info(f"[Heartbeat] stocks.db OK — last: {st_last.strftime('%Y-%m-%d %H:%M')} ({st_diff_hours:.1f}h ago)")

    # لو فيه إنذارات → ابعت تليجرام
    if alerts:
        msg = "🚨 <b>إنذار: محرك البيانات متوقف!</b>\n\n" + "\n\n".join(alerts)
        msg += "\n\n⚠️ افحص السيرفر فوراً!"
        logger.error(f"[Heartbeat] ALERTS: {len(alerts)}")
        send_telegram(msg)
        # طباعة للـ log كمان
        for a in alerts:
            logger.error(f"[Heartbeat] {a}")
    else:
        logger.info("[Heartbeat] ✅ All data sources are fresh. No alerts.")


if __name__ == '__main__':
    check_heartbeat()
