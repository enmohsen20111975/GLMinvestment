#!/usr/bin/env python3
"""
telegram_marketing_engine.py — المحرك التسويقي والإعلاني الشامل للتليجرام
========================================================================
الذراع الإعلاني والخدمي المتكامل لمنصة دليل المستثمر العربي (GLMinvestment).

يقوم بإدارة وجدولة كافة أنشطة التليجرام:
  1. بوت الردود التفاعلية الفورية (Interactive Query Bot) مع إرسال شارتات الشموع ومستويات الرادار.
  2. جرس الصباح الافتتاحي (Morning Bell - 08:30 ص) بفرص رادار الميكرز قبل الجلسة.
  3. تنبيهات الاختراق اللحظية (Intraday Breakout Alerts - كل 5 دقائق من 10:00 ص إلى 2:30 م) مع الشارت المصور.
  4. بطاقة حصاد الإغلاق المصورة (Closing Scorecard - 03:00 م) بنسب النجاح والأهداف المتحققة.
  5. بث الأخبار الاقتصادية العاجلة وإفصاحات الشركات (Breaking News - كل دقيقتين).
  6. درس الأكاديمية اليومي المصور (Daily Educational Lesson - 08:30 م) لتعليم المتداولين وبناء الولاء.

الاستخدام:
  python3 telegram_marketing_engine.py --daemon         # تشغيل المحرك التلقائي الشامل في الخلفية
  python3 telegram_marketing_engine.py --check-all       # فحص واختبار جميع الخدمات بدون انتظار
  python3 telegram_marketing_engine.py --test-interactive # اختبار معالجة استعلام مستخدم تجريبياً
"""

import os
import sys
import time
import json
import asyncio
import logging
import threading
from datetime import datetime, time as dtime
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
sys.path.insert(0, str(Path(__file__).resolve().parent))

# تحميل متغيرات البيئة إجبارياً حتى لو كانت فارغة في PM2
def load_env():
    for p in [PROJECT_ROOT / '.env', PROJECT_ROOT / 'news-agent' / '.env']:
        if p.exists():
            with open(p, 'r', encoding='utf-8') as f:
                for line in f:
                    line = line.strip()
                    if line and not line.startswith('#') and '=' in line:
                        k, v = line.split('=', 1)
                        val = v.strip().strip('"').strip("'")
                        if not os.environ.get(k.strip()):
                            os.environ[k.strip()] = val
            break

load_env()

# استيراد الخدمات المتخصصة
from telegram_interactive_bot import run_polling, search_stock, build_stock_card, get_stock_radar_status
from telegram_morning_bell import run_morning_bell
from telegram_intraday_alerts import run_intraday_alerts, is_market_hours
from telegram_closing_scorecard import run_closing_scorecard
from telegram_breaking_news import run_breaking_news
from telegram_daily_lessons import run_daily_lesson
from telegram_target_hit_tracker import run_target_hit_tracker
from telegram_sectors_report import run_sectors_report
from telegram_market_analysis import run_daily_market_analysis, run_weekly_market_analysis

logging.basicConfig(
    level=logging.INFO,
    format='[%(asctime)s] [%(levelname)s] %(message)s',
    datefmt='%H:%M:%S'
)
log = logging.getLogger("MarketingEngine")

class TelegramMarketingEngine:
    def __init__(self):
        self.running = False
        self.sent_morning_today = None
        self.sent_closing_today = None
        self.sent_daily_analysis_today = None
        self.sent_sectors_today = None
        self.sent_lesson_today = None
        self.sent_weekly_week = None

    def start_bot_thread(self):
        """تشغيل بوت التليجرام التفاعلي في Thread منفصل."""
        log.info("🤖 بدء تشغيل خيط بوت الردود التفاعلية (Interactive Bot)...")
        t = threading.Thread(target=run_polling, daemon=True, name="InteractiveBotThread")
        t.start()
        return t

    def scheduler_loop(self):
        """حلقة الجدولة الزمنية لبث التقارير والأخبار والتنبيهات والدروس."""
        log.info("⏱️ انطلاق حلقة الجدولة والمراقبة الزمنية...")
        
        while self.running:
            try:
                now = datetime.now()
                today_str = now.strftime('%Y-%m-%d')
                curr_week_str = now.strftime('%Y-W%W')
                curr_time = now.time()
                weekday = now.weekday() # Monday=0, Tuesday=1, Wednesday=2, Thursday=3, Friday=4, Saturday=5, Sunday=6
                is_trading_day = weekday in (6, 0, 1, 2, 3) # الأحد إلى الخميس في مصر

                # 1. جرس الصباح الافتتاحي وتوقعات الجلسة (Morning Bell - 08:30 ص في أيام التداول)
                if is_trading_day and dtime(8, 30) <= curr_time <= dtime(9, 30):
                    if self.sent_morning_today != today_str:
                        log.info("📢 حان موعد جرس الصباح الافتتاحي وتوقعات الجلسة...")
                        run_morning_bell()
                        self.sent_morning_today = today_str

                # 2. تنبيهات الاختراق اللحظية ورصد الأهداف المحققة (أثناء الجلسة 10:00 ص - 2:30 م)
                if is_trading_day and is_market_hours():
                    log.info("⚡ فحص إشارات الاختراق اللحظية لرادار السيولة...")
                    try:
                        import importlib
                        import telegram_intraday_alerts
                        importlib.reload(telegram_intraday_alerts)
                        telegram_intraday_alerts.run_intraday_alerts()
                    except Exception as e:
                        log.error(f"خطأ تشغيل تنبيهات الاختراق: {e}")

                    log.info("🎯 فحص ضربات الأهداف المحققة ونبض الصفقات الرابحة...")
                    try:
                        import importlib
                        import telegram_target_hit_tracker
                        importlib.reload(telegram_target_hit_tracker)
                        telegram_target_hit_tracker.run_target_hit_tracker()
                    except Exception as e:
                        log.error(f"خطأ تشغيل راصد الأهداف: {e}")

                # 3. بطاقة حصاد الإغلاق المصورة (Closing Scorecard - 03:00 م)
                if is_trading_day and dtime(15, 0) <= curr_time <= dtime(15, 30):
                    if self.sent_closing_today != today_str:
                        log.info("🏆 حان موعد بطاقة حصاد جلسة التداول...")
                        run_closing_scorecard()
                        self.sent_closing_today = today_str

                # 4. التحليل اليومي الشامل للجلسة وتوقعات الغد (Daily Market Analysis - 03:45 م)
                if is_trading_day and dtime(15, 45) <= curr_time <= dtime(16, 45):
                    if self.sent_daily_analysis_today != today_str:
                        log.info("📊 حان موعد بث التحليل اليومي الشامل للجلسة وتوقعات الغد...")
                        run_daily_market_analysis()
                        self.sent_daily_analysis_today = today_str

                # 5. تقرير حركة وتدوير القطاعات وتدفقات السيولة (Sectors Rotation - 05:00 م)
                if is_trading_day and dtime(17, 0) <= curr_time <= dtime(18, 0):
                    if self.sent_sectors_today != today_str:
                        log.info("🔄 حان موعد بث تقرير حركة وتدوير القطاعات وتدفقات السيولة...")
                        run_sectors_report()
                        self.sent_sectors_today = today_str

                # 6. التقرير الأسبوعي الاستراتيجي وتوقعات الأسبوع القادم (السبت 01:00 م أو الأحد 07:30 ص)
                is_weekend_analysis_time = (weekday == 5 and dtime(13, 0) <= curr_time <= dtime(17, 0)) or (weekday == 6 and dtime(7, 15) <= curr_time <= dtime(8, 15))
                if is_weekend_analysis_time:
                    if self.sent_weekly_week != curr_week_str:
                        log.info("🔭 حان موعد بث التقرير والتحليل الأسبوعي الشامل...")
                        run_weekly_market_analysis()
                        self.sent_weekly_week = curr_week_str

                # 7. بث الأخبار العاجلة وإفصاحات الشركات (يعمل دائماً كل دورتين)
                run_breaking_news()

                # 8. درس الأكاديمية اليومي المصور (Daily Lesson - 08:30 م كل يوم)
                if dtime(20, 30) <= curr_time <= dtime(22, 0):
                    if self.sent_lesson_today != today_str:
                        log.info("📚 حان موعد بث الدرس التعليمي اليومي المصور...")
                        run_daily_lesson()
                        self.sent_lesson_today = today_str

            except Exception as e:
                log.error(f"❌ خطأ غير متوقع في حلقة الجدولة: {e}")

            # انتظار دقيقتين قبل الدورة التالية
            time.sleep(120)

    def run_daemon(self):
        """تشغيل المحرك بالكامل كخدمة مستمرة."""
        print("=" * 65)
        print("🚀 محرك التليجرام التسويقي والإعلاني الشامل (GLM Telegram Engine)")
        print("=" * 65)
        self.running = True
        
        # 1. خيط البوت التفاعلي
        self.start_bot_thread()
        
        # 2. حلقة المهام المجدولة
        try:
            self.scheduler_loop()
        except KeyboardInterrupt:
            print("\n🛑 تم إيقاف المحرك التسويقي بواسطة المستخدم.")
            self.running = False

    def check_all(self):
        """فحص واختبار جميع الخدمات في وضع المعاينة السريع."""
        print("🔍 فحص شامل لكافة مكونات المنظومة الإعلانية والتحليلية على التليجرام...")
        print("\n[1/8] اختبار جرس الصباح وتوقعات الجلسة (Morning Bell)...")
        run_morning_bell(preview=True)
        
        print("\n[2/8] اختبار تنبيهات الاختراق اللحظية (Intraday Alerts)...")
        run_intraday_alerts(preview=True, force=True)

        print("\n[3/8] اختبار رادار متابعة الأهداف المحققة (Target Hit Tracker)...")
        run_target_hit_tracker(preview=True)
        
        print("\n[4/8] اختبار بطاقة حصاد الإغلاق المصورة (Closing Scorecard)...")
        run_closing_scorecard(preview=True, force=True)

        print("\n[5/8] اختبار التحليل اليومي للجلسة وتوقعات الغد (Daily Market Analysis)...")
        run_daily_market_analysis(preview=True)

        print("\n[6/8] اختبار تقرير حركة وتدوير القطاعات (Sectors Report)...")
        run_sectors_report(preview=True)

        print("\n[7/8] اختبار التحليل الأسبوعي الشامل (Weekly Market Outlook)...")
        run_weekly_market_analysis(preview=True)
        
        print("\n[8/8] اختبار الدرس التعليمي اليومي المصور (Daily Lesson)...")
        run_daily_lesson(preview=True)
        
        print("\n✅ اكتمل الفحص الشامل لجميع المكونات بنجاح!")

if __name__ == '__main__':
    engine = TelegramMarketingEngine()
    if '--check-all' in sys.argv:
        engine.check_all()
    elif '--daemon' in sys.argv:
        engine.run_daemon()
    else:
        print("يرجى تحديد نمط التشغيل:")
        print("  --daemon    تشغيل البوت والجدولة المستمرة في الخلفية")
        print("  --check-all اختبار سريع لجميع المكونات")
