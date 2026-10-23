#!/usr/bin/env python3
"""
post_market_feedback.py — PHASE5-052: Automated Feedback Loop
================================================================
يشغل كل يوم بعد إغلاق السوق (15:30 عبر cron).
يفحص التوقعات اللي اتطلعت أمس:
- لو 80% من إشارات BUY خسرت (Hit SL) → يبعت رسالة تليجرام للأدمن:
  "⚠️ تحذير: محرك التحليل فقد بوصلة اليوم، 80% من التوصيات خسرت"

التشغيل:
  crontab -e
  30 15 * * 1-5 /usr/bin/python3 /home/z/my-project/scripts/post_market_feedback.py
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
PREDICTIONS_DB = str(PROJECT_ROOT / 'db' / 'predictions.db')

TELEGRAM_BOT_TOKEN = os.getenv('TELEGRAM_BOT_TOKEN', '')
TELEGRAM_CHAT_ID = os.getenv('TELEGRAM_CHAT_ID', '')

# عتبة الإنذار: لو أكثر من 70% من توصيات BUY خسرت → إنذار
LOSS_RATE_THRESHOLD = 0.70


def send_telegram(message: str):
    """يبعت رسالة على تليجرام."""
    if not TELEGRAM_BOT_TOKEN or not TELEGRAM_CHAT_ID:
        logger.info(f"[Feedback] (no Telegram) {message[:80]}")
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
    except Exception as e:
        logger.error(f"[Feedback] Telegram send failed: {e}")


def check_yesterday_performance():
    """يفحص أداء التوقعات المغلقة أمس."""
    try:
        # Phase 7.1: migrated to db_manager (writable=False)
        from core.db_manager import db_manager
        conn = db_manager.connection(PREDICTIONS_DB, writable=False).__enter__()
        conn.row_factory = sqlite3.Row
        cur = conn.cursor()

        # تواريخ أمس
        yesterday = (datetime.now() - timedelta(days=1)).strftime('%Y-%m-%d')

        # جلب التوقعات المغلقة أمس
        rows = cur.execute("""
            SELECT ticker, signal, signal_type, entry_price, exit_price,
                   actual_return, hit_target, hit_stop, outcome_date,
                   maestro_score
            FROM predictions
            WHERE outcome_date IS NOT NULL
              AND date(outcome_date) = date(?)
            ORDER BY maestro_score DESC
        """, (yesterday,)).fetchall()

        conn.close()

        if not rows:
            logger.info(f"[Feedback] No closed predictions for {yesterday}")
            return

        total = len(rows)
        buy_signals = [r for r in rows if r['signal'] in ('BUY', 'STRONG_BUY') or 'buy' in (r['signal_type'] or '').lower()]
        sell_signals = [r for r in rows if r['signal'] in ('SELL', 'STRONG_SELL') or 'sell' in (r['signal_type'] or '').lower()]

        buy_total = len(buy_signals)
        buy_wins = sum(1 for r in buy_signals if r['hit_target'] or (r['actual_return'] and r['actual_return'] > 0))
        buy_losses = sum(1 for r in buy_signals if r['hit_stop'] or (r['actual_return'] and r['actual_return'] < 0))

        sell_total = len(sell_signals)
        sell_wins = sum(1 for r in sell_signals if r['hit_target'] or (r['actual_return'] and r['actual_return'] > 0))
        sell_losses = sum(1 for r in sell_signals if r['hit_stop'] or (r['actual_return'] and r['actual_return'] < 0))

        win_rate = (buy_wins / buy_total * 100) if buy_total > 0 else 0
        loss_rate = (buy_losses / buy_total * 100) if buy_total > 0 else 0

        logger.info(
            f"[Feedback] {yesterday}: Total={total}, BUY={buy_total} (W:{buy_wins} L:{buy_losses}), "
            f"SELL={sell_total} (W:{sell_wins} L:{sell_losses}), WinRate={win_rate:.1f}%"
        )

        # لو loss_rate > 70% → إنذار
        if buy_total >= 5 and (buy_losses / buy_total) >= LOSS_RATE_THRESHOLD:
            msg = (
                f"⚠️ <b>تحذير: محرك التحليل فقد بوصلة اليوم!</b>\n\n"
                f"📅 التاريخ: {yesterday}\n"
                f"📊 إجمالي التوصيات: {total}\n"
                f"🟢 توصيات شراء: {buy_total}\n"
                f"  ✅ ناجحة: {buy_wins}\n"
                f"  ❌ خاسرة: {buy_losses}\n"
                f"  📈 نسبة النجاح: {win_rate:.1f}%\n"
                f"  📉 نسبة الخسارة: {loss_rate:.1f}%\n\n"
                f"🚨 <b>{loss_rate:.0f}% من توصيات الشراء خسرت اليوم!</b>\n"
                f"يرجى مراجعة الـ Weights في الـ 8 Layers و الـ TUNING.\n"
                f"🔗 راجع: /admin/honest-predictions"
            )
            send_telegram(msg)
            logger.error(f"[Feedback] ALERT SENT: {loss_rate:.0f}% loss rate!")
        else:
            # تقرير يومي عادي (لو فيه على الأقل 5 توصيات)
            if buy_total >= 5:
                msg = (
                    f"📊 <b>تقرير أداء يومي</b>\n\n"
                    f"📅 {yesterday}\n"
                    f"📈 توصيات شراء: {buy_total} (نجاح {win_rate:.0f}%)\n"
                    f"📉 توصيات بيع: {sell_total}\n"
                    f"✅ الأداء: {'ممتاز ✅' if win_rate >= 60 else 'متوسط ⚠️' if win_rate >= 40 else 'ضعيف ❌'}"
                )
                send_telegram(msg)
                logger.info(f"[Feedback] Daily report sent: WinRate={win_rate:.1f}%")

    except Exception as e:
        logger.error(f"[Feedback] Error: {e}")


if __name__ == '__main__':
    check_yesterday_performance()
