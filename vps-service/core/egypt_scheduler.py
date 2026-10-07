#!/usr/bin/env python3
"""
Egypt Scheduler - Internal Timer for Stock Data Updates
========================================================
مجدول داخلي لتحديث بيانات الأسهم بتوقيت مصر

Features:
- تشغيل تلقائي خلال ساعات التداول المصرية
- تحديث كل 15 دقيقة
- توقيت مصر (Africa/Cairo)
- يعمل في الخلفية بدون cron job

Trading Hours (EGX):
- الأحد إلى الخميس
- 9:00 صباحاً - 3:00 مساءً (توقيت القاهرة)

Author:M2yDevelopers Team
Version: 1.0.0
"""

import os
import sys
import time
import logging
import threading
from datetime import datetime, timedelta
from typing import Callable, Optional, Dict, Any
from pathlib import Path

# Try to import pytz for proper timezone handling
try:
    import pytz
    EGYPT_TZ = pytz.timezone('Africa/Cairo')
    HAS_PYTZ = True
except ImportError:
    HAS_PYTZ = False
    EGYPT_TZ = None
    print("[WARNING] pytz not installed, using system timezone")

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


class EgyptScheduler:
    """
    مجدول بتوقيت مصر للتحديثات التلقائية
    
    Usage:
        scheduler = EgyptScheduler()
        scheduler.add_task('egksco_sync', sync_function, interval_minutes=15)
        scheduler.start()
    """
    
    # EGX Trading hours (Cairo time) - 9:00 AM to 3:00 PM (wider coverage)
    TRADING_START_HOUR = 9
    TRADING_START_MINUTE = 0
    TRADING_END_HOUR = 15
    TRADING_END_MINUTE = 0

    # AGILE-PHASE2-035 (D): Price cutoff — threads fetching live prices STOP
    # after 14:30 (2:30 PM) Cairo. EGX session closes at 14:30, so pulling
    # prices after that just burns CPU for nothing. Trading-hours tasks that
    # are NOT price-related (e.g. analysis cleanup) can keep using
    # is_trading_hours() until 15:00.
    PRICE_CUTOFF_HOUR = 14
    PRICE_CUTOFF_MINUTE = 30

    # Trading days: Sunday to Thursday
    # Python weekday: Monday=0, Tuesday=1, Wednesday=2, Thursday=3, Friday=4, Saturday=5, Sunday=6
    # EGX Trading: Sunday(6), Monday(0), Tuesday(1), Wednesday(2), Thursday(3)
    # Weekend: Friday(4), Saturday(5) - NO TRADING
    TRADING_DAYS = [6, 0, 1, 2, 3]  # Sun, Mon, Tue, Wed, Thu (NO Fri, Sat)

    def __init__(self):
        self.tasks: Dict[str, Dict] = {}
        self.running = False
        self.thread: Optional[threading.Thread] = None
        self.last_run: Dict[str, datetime] = {}
        # AGILE-PHASE2-035: track last-run DATE for daily tasks so each
        # daily task fires at most once per calendar day.
        self._daily_last_run_date: Dict[str, str] = {}
        
    def get_egypt_time(self) -> datetime:
        """الحصول على الوقت الحالي بتوقيت مصر"""
        if HAS_PYTZ:
            return datetime.now(EGYPT_TZ).replace(tzinfo=None)
        else:
            # Fallback: assume system is set to Egypt time
            return datetime.now()
    
    def is_trading_hours(self) -> bool:
        """التحقق من هل نحن في ساعات التداول (9:00 - 15:00 Cairo)"""
        now = self.get_egypt_time()

        # Check if today is a trading day
        if now.weekday() not in self.TRADING_DAYS:
            return False

        # Check if within trading hours
        current_time = now.hour * 60 + now.minute
        start_time = self.TRADING_START_HOUR * 60 + self.TRADING_START_MINUTE
        end_time = self.TRADING_END_HOUR * 60 + self.TRADING_END_MINUTE

        return start_time <= current_time <= end_time

    def is_price_window(self) -> bool:
        """AGILE-PHASE2-035 (D): هل نحن في نافذة سحب الأسعار؟

        نافذة الأسعار = 09:00 - 14:30 Cairo في أيام التداول فقط.
        بعد 14:30 الـ EGX بيقفل، فسحب الأسعار بيبقى waste of CPU.
        بقية مهام التحليل (cleanup, learning) ممكن تكمل لحد 15:00
        باستخدام is_trading_hours().
        """
        now = self.get_egypt_time()

        # لازم يكون يوم تداول
        if now.weekday() not in self.TRADING_DAYS:
            return False

        current_time = now.hour * 60 + now.minute
        start_time = self.TRADING_START_HOUR * 60 + self.TRADING_START_MINUTE
        # نهاية النافذة = cutoff (14:30) بدل end (15:00)
        end_time = self.PRICE_CUTOFF_HOUR * 60 + self.PRICE_CUTOFF_MINUTE

        return start_time <= current_time <= end_time
    
    def is_trading_day(self) -> bool:
        """التحقق من هل اليوم يوم تداول"""
        now = self.get_egypt_time()
        return now.weekday() in self.TRADING_DAYS
    
    def get_next_trading_time(self) -> datetime:
        """الحصول على وقت التداول القادم"""
        now = self.get_egypt_time()
        
        # If today is trading day and we haven't reached trading hours yet
        if now.weekday() in self.TRADING_DAYS:
            trading_start = now.replace(
                hour=self.TRADING_START_HOUR,
                minute=self.TRADING_START_MINUTE,
                second=0,
                microsecond=0
            )
            if now < trading_start:
                return trading_start
            
            # If we're past trading hours, check next trading day
            trading_end = now.replace(
                hour=self.TRADING_END_HOUR,
                minute=self.TRADING_END_MINUTE,
                second=0,
                microsecond=0
            )
            if now > trading_end:
                return self._get_next_trading_day_start(now)
        else:
            return self._get_next_trading_day_start(now)
        
        return now
    
    def _get_next_trading_day_start(self, from_date: datetime) -> datetime:
        """الحصول على بداية يوم التداول القادم"""
        next_day = from_date + timedelta(days=1)
        
        # Find next trading day (max 7 days)
        for _ in range(7):
            if next_day.weekday() in self.TRADING_DAYS:
                return next_day.replace(
                    hour=self.TRADING_START_HOUR,
                    minute=self.TRADING_START_MINUTE,
                    second=0,
                    microsecond=0
                )
            next_day += timedelta(days=1)
        
        return next_day
    
    def add_task(self, name: str, func: Callable, interval_minutes: int = 15,
                 trading_hours_only: bool = True, run_on_start: bool = False,
                 price_window_only: bool = False):
        """
        إضافة مهمة للجدول

        Args:
            name: اسم المهمة
            func: الدالة التي سيتم تنفيذها
            interval_minutes: الفاصل الزمني بالدقائق
            trading_hours_only: تشغيل خلال ساعات التداول فقط (9:00-15:00)
            run_on_start: تشغيل عند بدء الجدول
            price_window_only: AGILE-PHASE2-035 (D) — تشغيل خلال نافذة
                الأسعار فقط (9:00-14:30). لو True، يبطل is_trading_hours
                ويستخدم is_price_window بدلاً منه. بيوقف الأسعار بعد 14:30.
        """
        self.tasks[name] = {
            'func': func,
            'interval_minutes': interval_minutes,
            'trading_hours_only': trading_hours_only,
            'price_window_only': price_window_only,
            'run_on_start': run_on_start,
            'is_daily': False,
        }
        logger.info(
            f"[SCHEDULER] Added task '{name}' - interval: {interval_minutes}min, "
            f"trading_hours_only: {trading_hours_only}, price_window_only: {price_window_only}"
        )

    def add_daily_task(self, name: str, func: Callable, hour: int, minute: int = 0) -> None:
        """AGILE-PHASE2-035 (A): إضافة مهمة يومية تُشغّل مرة واحدة في اليوم
        في توقيت Cairo المحدد (hour:minute).

        مثال: nightly quant job يشتغل 03:00 Cairo كل يوم.

        الآلية:
        - المهمة بتتصفح كل loop iteration (60s).
        - لو الوقت الحالي >= scheduled time وآخر تشغيل مش النهاردة → شغّل.
        - معنى كده: المهمة بتصير خلال أول دقيقة بعد الوقت المحدد، ومن بعدها
          ما تشتغلش تاني لحد اليوم التالي.
        - مهام الـ daily بتشتغل حتى لو مش يوم تداول (الليلي الكمي شغال 7/7).

        Args:
            name: اسم المهمة (unique)
            func: الدالة (must be no-args callable, return dict)
            hour: ساعة التشغيل بتوقيت Cairo (0-23)
            minute: دقيقة التشغيل (0-59, default 0)
        """
        self.tasks[name] = {
            'func': func,
            'interval_minutes': 0,        # مش مستخدم (daily)
            'trading_hours_only': False,  # daily tasks مش مرتبطة بالـ trading
            'price_window_only': False,
            'run_on_start': False,
            'is_daily': True,
            'daily_hour': int(hour),
            'daily_minute': int(minute),
        }
        logger.info(
            f"[SCHEDULER] Added DAILY task '{name}' at {hour:02d}:{minute:02d} Cairo time"
        )
    
    def _run_task(self, name: str, task: Dict):
        """تشغيل مهمة واحدة"""
        try:
            logger.info(f"[SCHEDULER] Running task: {name}")
            start_time = time.time()

            result = task['func']()

            duration = time.time() - start_time
            now = self.get_egypt_time()
            self.last_run[name] = now

            # AGILE-PHASE2-035 (A): mark daily tasks as run for today
            if task.get('is_daily'):
                self._daily_last_run_date[name] = now.strftime('%Y-%m-%d')

            logger.info(f"[SCHEDULER] Task '{name}' completed in {duration:.1f}s - Result: {result}")
            return result

        except Exception as e:
            logger.error(f"[SCHEDULER] Task '{name}' failed: {e}")
            # Even on failure, mark daily tasks as attempted today so we don't
            # retry on every loop iteration (60s) and spam logs.
            try:
                if task.get('is_daily'):
                    self._daily_last_run_date[name] = self.get_egypt_time().strftime('%Y-%m-%d')
            except Exception:
                pass
            return {'success': False, 'error': str(e)}
    
    def _should_run_task(self, name: str, task: Dict) -> bool:
        """التحقق من هل يجب تشغيل المهمة الآن"""
        # AGILE-PHASE2-035 (A): daily tasks — time-of-day scheduling
        if task.get('is_daily'):
            return self._should_run_daily_task(name, task)

        # AGILE-PHASE2-035 (D): price-window tasks (stop after 14:30)
        if task.get('price_window_only'):
            if not self.is_price_window():
                return False
        elif task['trading_hours_only']:
            # Standard trading-hours tasks (9:00-15:00)
            if not self.is_trading_hours():
                return False

        # Check interval
        if name in self.last_run:
            elapsed = (self.get_egypt_time() - self.last_run[name]).total_seconds() / 60
            if elapsed < task['interval_minutes']:
                return False

        return True

    def _should_run_daily_task(self, name: str, task: Dict) -> bool:
        """AGILE-PHASE2-035 (A): هل المهمة اليومية لازم تشتغل النهاردة؟

        شرط التشغيل:
        - الوقت الحالي (Cairo) >= scheduled_time النهاردة.
        - المهمة ما اشتغلتش النهاردة قبل كده (نتتبع last-run date).
        """
        now = self.get_egypt_time()
        scheduled_time = now.replace(
            hour=int(task.get('daily_hour', 0)),
            minute=int(task.get('daily_minute', 0)),
            second=0,
            microsecond=0,
        )

        # لو لسه ما وصلناش وقت التشغيل → لأ
        if now < scheduled_time:
            return False

        # شغّلها مرة واحدة في اليوم — نتتبع تاريخ آخر تشغيل
        today_str = now.strftime('%Y-%m-%d')
        last_run_date = self._daily_last_run_date.get(name)
        if last_run_date == today_str:
            return False  # اشتغلت النهاردة بالفعل

        return True
    
    def _scheduler_loop(self):
        """حلقة الجدول الرئيسية"""
        logger.info("[SCHEDULER] Scheduler loop started")

        # Run tasks that should run on start
        for name, task in self.tasks.items():
            if task.get('run_on_start'):
                self._run_task(name, task)

        while self.running:
            try:
                self.tick_once()

                # Sleep for 60 seconds before next check
                time.sleep(60)

            except Exception as e:
                logger.error(f"[SCHEDULER] Error in scheduler loop: {e}")
                time.sleep(60)

        logger.info("[SCHEDULER] Scheduler loop stopped")

    def tick_once(self):
        """Phase 3 — Single iteration of the scheduler (no sleep).

        Allows the central `scheduler_manager` to drive this scheduler
        instead of it spawning its own thread. The cadence is controlled
        externally (typically every 60s).

        Idempotent: each call iterates over all registered tasks and fires
        the ones whose `_should_run_task()` returns True. Tasks already
        fired in this minute are skipped (interval check).
        """
        try:
            egypt_time = self.get_egypt_time()
            # AGILE-PHASE2-035 (A): دايماً نفّذ دورة التحقق مش بس وقت
            # التداول — مهمام الـ daily (زي nightly quant 03:00) لازم
            # تتصير حتى لو مش يوم تداول. مهمام الـ trading_hours_only /
            # price_window_only بتتصفّى بنفسها في _should_run_task.
            for name, task in list(self.tasks.items()):
                try:
                    if self._should_run_task(name, task):
                        logger.info(
                            f"[SCHEDULER] Egypt time: "
                            f"{egypt_time.strftime('%H:%M:%S')} - Running: {name}"
                        )
                        self._run_task(name, task)
                except Exception as te:
                    logger.error(
                        f"[SCHEDULER] tick_once task '{name}' error: {te}"
                    )
        except Exception as e:
            logger.error(f"[SCHEDULER] tick_once error: {e}")

    def start(self):
        """بدء الجدول"""
        if self.running:
            logger.warning("[SCHEDULER] Already running")
            return
        
        self.running = True
        self.thread = threading.Thread(target=self._scheduler_loop, daemon=True)
        self.thread.start()
        
        logger.info(f"[SCHEDULER] Started - Egypt time: {self.get_egypt_time().strftime('%Y-%m-%d %H:%M:%S')}")
        logger.info(f"[SCHEDULER] Trading hours: {self.TRADING_START_HOUR:02d}:{self.TRADING_START_MINUTE:02d} - {self.TRADING_END_HOUR:02d}:{self.TRADING_END_MINUTE:02d}")
        logger.info(f"[SCHEDULER] Is trading hours now: {self.is_trading_hours()}")
    
    def stop(self):
        """إيقاف الجدول"""
        self.running = False
        if self.thread:
            self.thread.join(timeout=5)
        logger.info("[SCHEDULER] Stopped")
    
    def get_status(self) -> Dict:
        """حالة الجدول"""
        now = self.get_egypt_time()

        return {
            'running': self.running,
            'egypt_time': now.isoformat(),
            'is_trading_day': self.is_trading_day(),
            'is_trading_hours': self.is_trading_hours(),
            'is_price_window': self.is_price_window(),  # AGILE-PHASE2-035 (D)
            'next_trading_time': self.get_next_trading_time().isoformat(),
            'tasks': list(self.tasks.keys()),
            'last_runs': {k: v.isoformat() for k, v in self.last_run.items()},
            'daily_last_run_dates': dict(self._daily_last_run_date),  # AGILE-PHASE2-035 (A)
        }


# Singleton instance
_scheduler_instance: Optional[EgyptScheduler] = None


def get_scheduler() -> EgyptScheduler:
    """الحصول على نسخة واحدة من الجدول"""
    global _scheduler_instance
    if _scheduler_instance is None:
        _scheduler_instance = EgyptScheduler()
    return _scheduler_instance


def start_scheduler() -> EgyptScheduler:
    """بدء الجدول"""
    scheduler = get_scheduler()
    if not scheduler.running:
        scheduler.start()
    return scheduler


# ============================================================================
# EGKSCO SYNC TASK
# ============================================================================

def egksco_sync_task() -> Dict:
    """
    مهمة مزامنة EGKSCO
    تُشغل تلقائياً كل 15 دقيقة خلال ساعات التداول
    """
    try:
        from data.egksco_scraper import EGKSCOScraper
        
        logger.info("[EGKSCO] Starting auto sync...")
        scraper = EGKSCOScraper()
        result = scraper.run_full_sync()
        
        logger.info(f"[EGKSCO] Sync completed: {result['stocks']['count']} stocks")
        return result
        
    except Exception as e:
        logger.error(f"[EGKSCO] Sync failed: {e}")
        return {'success': False, 'error': str(e)}


def setup_egksco_scheduler(run_on_start: bool = True) -> EgyptScheduler:
    """
    إعداد جدول EGKSCO — مزامنة الأسعار.

    AGILE-PHASE2-035 (D): الـ sync بيتوقف بعد 14:30 Cairo (إغلاق EGX).
    قبل كده كان بيكمل لـ 15:00، بس بعد 14:30 مفيش أسعار جديدة فبيبقى
    waste of CPU + network. لاحظ إن price_window_only=True بيتفعّل بدل
    trading_hours_only=True — ده بيلغي 14:30-15:00 من نافذة المزامنة.

    Args:
        run_on_start: تشغيل المزامنة فوراً عند البدء
    """
    scheduler = get_scheduler()
    scheduler.add_task(
        name='egksco_sync',
        func=egksco_sync_task,
        interval_minutes=15,
        trading_hours_only=False,        # AGILE-PHASE2-035: بيطير من هنا
        price_window_only=True,          # AGILE-PHASE2-035: استخدم 9:00-14:30
        run_on_start=run_on_start,
    )
    return scheduler


def setup_nightly_quant_job() -> EgyptScheduler:
    """AGILE-PHASE2-035 (A): تسجيل وظيفة الـ quant الليلية على الـ scheduler.

    بتشغّل `run_nightly_quant_job` مرة واحدة في اليوم 03:00 Cairo time.
    الوظيفة بتعيد بناء كاش SMFI + Monte Carlo لكل أسهم EGX عشان الجلسة
    الصباحية تلاقي القيم جاهزة (بدل ما تعيد حسابها لكل سهم كل دقيقة).

    الـ scheduler لازم يكون start() عشان المهمة تشتغل. ده بيحصل بشكل
    منفصل في main.py startup hook (موازي مع MarketScheduler).
    """
    scheduler = get_scheduler()
    try:
        from analyzers.nightly_quant_job import run_nightly_quant_job
        scheduler.add_daily_task(
            name='nightly_quant',
            func=run_nightly_quant_job,
            hour=3,
            minute=0,
        )
        logger.info("[SCHEDULER] nightly_quant job registered for 03:00 Cairo daily")
    except Exception as e:
        # Guarded: لو الـ import فشل، السيرفر يكمل شغل عادي. الوظيفة
        # اللي بتعتمد على الكاش هتستخدم fallback للـ live computation.
        logger.error(f"[SCHEDULER] Failed to register nightly_quant: {e}")
    return scheduler


# ============================================================================
# CLI TEST
# ============================================================================

if __name__ == '__main__':
    print("=" * 60)
    print("Egypt Scheduler Test")
    print("=" * 60)
    
    scheduler = EgyptScheduler()
    
    print(f"\nEgypt Time: {scheduler.get_egypt_time()}")
    print(f"Is Trading Day: {scheduler.is_trading_day()}")
    print(f"Is Trading Hours: {scheduler.is_trading_hours()}")
    print(f"Next Trading Time: {scheduler.get_next_trading_time()}")
    
    # Add test task
    def test_task():
        return {'message': 'Test task executed'}
    
    scheduler.add_task('test', test_task, interval_minutes=1, trading_hours_only=False, run_on_start=True)
    
    print("\nStarting scheduler for 10 seconds...")
    scheduler.start()
    time.sleep(10)
    scheduler.stop()
    
    print("\nDone!")
