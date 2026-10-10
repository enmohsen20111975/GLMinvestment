#!/usr/bin/env python3
"""
telegram_sniper_bot.py — PHASE5-052: Telegram Sniper Bot
==========================================================
يربط الـ LiveIndicatorEngine بـ Telegram Bot.
أول ما الـ Score يوصل 75+ لسهم معين → يبعت رسالة فورية:

🚨 فرصة شراء قوية: COMI - السعر 135.80 - الهدف 142.59 - وقف 131.73

التشغيل:
  python3 scripts/telegram_sniper_bot.py
  (أو عبر cron كل 5 دقايق أثناء الجلسة)
"""
import os
import sys
import json
import sqlite3
import logging
import urllib.request
from datetime import datetime, timedelta
from pathlib import Path

logging.basicConfig(level=logging.INFO, format='%(asctime)s [%(levelname)s] %(message)s')
logger = logging.getLogger(__name__)

PROJECT_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PROJECT_ROOT / 'vps-service'))

STOCKS_DB = str(PROJECT_ROOT / 'db' / 'stocks.db')
PREDICTIONS_DB = str(PROJECT_ROOT / 'db' / 'predictions.db')

TELEGRAM_BOT_TOKEN = os.getenv('TELEGRAM_BOT_TOKEN', '')
TELEGRAM_CHAT_ID = os.getenv('TELEGRAM_CHAT_ID', '')
SCORE_THRESHOLD = 75  # لو Live Score ≥ 75 → إشعار
ALERT_COOLDOWN_MINUTES = 30  # متبعتش نفس السهم تاني إلا بعد 30 دقيقة


def send_telegram(message: str):
    """يبعت رسالة على تليجرام."""
    if not TELEGRAM_BOT_TOKEN or not TELEGRAM_CHAT_ID:
        logger.info(f"[Sniper] (no Telegram) {message[:80]}")
        return
    try:
        url = f"https://api.telegram.org/bot{TELEGRAM_BOT_TOKEN}/sendMessage"
        data = json.dumps({
            'chat_id': TELEGRAM_CHAT_ID,
            'text': message,
            'parse_mode': 'HTML',
        }).encode('utf-8')
        req = urllib.request.Request(url, data=data, headers={'Content-Type': 'application/json'})
        urllib.request.urlopen(req, timeout=5)
        logger.info(f"[Sniper] Telegram sent: {message[:60]}...")
    except Exception as e:
        logger.error(f"[Sniper] Telegram send failed: {e}")


def get_stock_name(ticker: str) -> str:
    """يجيب اسم السهم بالعربي."""
    try:
        conn = sqlite3.connect(STOCKS_DB)
        conn.row_factory = sqlite3.Row
        row = conn.execute('SELECT name_ar, name FROM stocks WHERE ticker=? LIMIT 1', (ticker,)).fetchone()
        conn.close()
        if row:
            return row['name_ar'] or row['name'] or ticker
    except Exception:
        pass
    return ticker


def get_last_alert_time(ticker: str) -> datetime:
    """يجيب آخر ممة تم إرسال إشعار لسهم معين (من ملف مؤقت)."""
    state_file = PROJECT_ROOT / 'scripts' / '.sniper_state.json'
    try:
        if state_file.exists():
            with open(state_file, 'r') as f:
                state = json.load(f)
            last_str = state.get(ticker)
            if last_str:
                return datetime.fromisoformat(last_str)
    except Exception:
        pass
    return datetime.min


def save_alert_time(ticker: str):
    """يحفظ وقت آخر إشعار لسهم."""
    state_file = PROJECT_ROOT / 'scripts' / '.sniper_state.json'
    try:
        state = {}
        if state_file.exists():
            with open(state_file, 'r') as f:
                state = json.load(f)
        state[ticker] = datetime.now().isoformat()
        with open(state_file, 'w') as f:
            json.dump(state, f)
    except Exception:
        pass


def scan_and_alert():
    """يفحص الـ Live Engine ويبعت إشارات للأسهم اللي Score ≥ 75."""
    try:
        from analyzers.live_indicator_engine import get_live_engine
        engine = get_live_engine()
        result = engine.scan_live_opportunities(limit=20)
        if not result.get('success') or not result.get('opportunities'):
            logger.info("[Sniper] No opportunities found.")
            return

        now = datetime.now()
        alerts_sent = 0

        for opp in result['opportunities']:
            ticker = opp.get('ticker', '')
            score = opp.get('score', 0)
            signal = opp.get('signal', '')
            signal_ar = opp.get('signal_ar', '')
            reason = opp.get('reason', '')
            today_candle = opp.get('today_candle', {})
            price = today_candle.get('close', 0)
            breakdown = opp.get('breakdown', {})

            # فلتر: Score ≥ 75 + BUY signal فقط
            if score < SCORE_THRESHOLD or signal != 'BUY':
                continue

            # فلتر: Cooldown (متبعتش نفس السهم تاني إلا بعد 30 دقيقة)
            last_alert = get_last_alert_time(ticker)
            if (now - last_alert).total_seconds() < ALERT_COOLDOWN_MINUTES * 60:
                continue

            # بناء الرسالة
            name = get_stock_name(ticker)
            rsi = opp.get('live_rsi', 0)
            vol_ratio = opp.get('volume_ratio', 0)

            # Pine Script flags
            flags = []
            if opp.get('is_golden_pullback'):
                flags.append('🟢 تصحيح ذهبي')
            if opp.get('is_dead_cat'):
                flags.append('⚠️ فخ ارتداد')
            if opp.get('is_bullish_divergence'):
                flags.append('📊 تباعد إيجابي')
            if opp.get('is_trap'):
                flags.append('🚨 فخ مضارب')
            if opp.get('is_low_liquidity'):
                flags.append('⚠️ سيولة ضعيفة')

            flags_text = ' | '.join(flags) if flags else 'لا توجد إشارات ذكية'

            message = (
                f"🚨 <b>فرصة شراء قوية</b>\n\n"
                f"📊 <b>{ticker}</b> — {name}\n"
                f"💰 السعر: <b>{price:.2f}</b>\n"
                f"🎯 النتيجة: <b>{score:.0f}/100</b>\n"
                f"📡 الإشارة: {signal_ar}\n"
                f"📊 RSI: {rsi:.0f} | حجم: {vol_ratio:.1f}x\n"
                f"🧠 {reason}\n"
                f"🔍 {flags_text}\n\n"
                f"⏰ {now.strftime('%H:%M:%S')}\n"
                f"🔗 invist.m2y.net"
            )

            send_telegram(message)
            save_alert_time(ticker)
            alerts_sent += 1

        if alerts_sent > 0:
            logger.info(f"[Sniper] ✅ Sent {alerts_sent} alerts (Score ≥ {SCORE_THRESHOLD})")
        else:
            logger.info(f"[Sniper] No alerts (no BUY with Score ≥ {SCORE_THRESHOLD})")

    except ImportError:
        logger.error("[Sniper] LiveIndicatorEngine not available.")
    except Exception as e:
        logger.error(f"[Sniper] Error: {e}")


if __name__ == '__main__':
    scan_and_alert()
