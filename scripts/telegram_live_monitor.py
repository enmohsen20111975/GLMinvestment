#!/usr/bin/env python3
"""
telegram_live_monitor.py — فحص التوقعات النشطة + إرسال إشعارات للتليجرام
====================================================================
بيشتغل كل 15 دقيقة أثناء الجلسة المصرية (10:00 - 14:30 القاهرة).

الإشعارات اللي بـ يبعتها:
  1. notify_approaching_target — لما السهم يدخل 3% من الهدف
  2. notify_stop_warning — لما السهم يقرب 5% من الستوب

التشغيل اليدوي:
  python3 scripts/telegram_live_monitor.py

Cron tab:
  */15 10-14 * * 1-5 cd /path/to/project && python3 scripts/telegram_live_monitor.py
"""
import sys
from pathlib import Path

PROJECT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PROJECT / 'vps-service'))

from telegram.telegram_notifier import TelegramNotifier


def main():
    print(f"[{__file__}] running live monitor...")
    notifier = TelegramNotifier()
    if not notifier.enabled:
        print("Telegram مش مفعّل — TELEGRAM_BOT_TOKEN أو TELEGRAM_CHAT_ID ناقص")
        return 1

    sent = notifier.check_active_predictions_for_notifications()
    print(f"✅ تم إرسال {sent} إشعار للتليجرام")
    return 0


if __name__ == "__main__":
    sys.exit(main())
