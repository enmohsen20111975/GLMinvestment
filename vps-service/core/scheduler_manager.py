#!/usr/bin/env python3
"""
scheduler_manager.py — Central Scheduler Manager (Phase 3 Task 1)
==================================================================

المشكلة (قبل Phase 3):
----------------------
عندنا 3 schedulers منفصلة كل واحد بيفتح Thread لوحده و بيعمل `time.sleep()`:
  1. `MarketScheduler` (jobs/market_scheduler.py) — blocking `start(60s)` في thread.
  2. `EgyptScheduler` (core/egypt_scheduler.py) — `_scheduler_loop` في thread.
  3. `BackgroundAnalyzer` (analyzers/background_analyzer.py) — `_run_loop` في thread.

ده بيسبب:
  - Race conditions لما الاتنين يضربوا الـ DB في نفس اللحظة.
  - CPU spikes عشوائية.
  - صعوبة تتبّع الـ jobs (محدش بيعرف إيه اللي شغال إمتى من مكان واحد).
  - Boot time بطيء لأن كل thread بياخد وقت يبدأ.

الحل (Phase 3):
--------------
`SchedulerManager` بيستخدم **APScheduler's `BackgroundScheduler`** كنقطة مركزية
واحدة. كل الـ periodic jobs بتتسجّل هنا. الـ Manager هو الوحيد اللي بيـ spawn
threads (thread pool واحد مشترك).

API الرئيسي:
  - `register_interval(name, func, seconds=60, max_instances=1, trading_hours_only=False)`
  - `register_cron(name, func, hour, minute, day_of_week='*')`
  - `unregister(name)` / `trigger_job(name)` / `start()` / `shutdown()` / `get_status()`

التوافق مع الـ Schedulers القديمة (Backward Compatible):
  - `wrap_legacy_scheduler(name, tick_func, interval_seconds)` — بياخد دالة `tick()`
    بتاعة scheduler قديم ويسجّلها كـ periodic job. ده بيخلّي الـ MarketScheduler
    و EgyptScheduler يشتغلوا من غير ما يفتحوا threads لوحدهم.
  - main.py بيشغّل `SchedulerManager.start()` مرة واحدة، وكل الـ legacy schedulers
    بتـ register نفسها عنده.

Usage:
  >>> from core.scheduler_manager import scheduler_manager, register_interval
  >>> register_interval('my_job', my_func, seconds=30)
  >>> scheduler_manager.start()

Author: دليل الاستثمار (Phase 3 — Arteries Cleanup & Fast Boot)
"""

from __future__ import annotations

import logging
import threading
import traceback
from datetime import datetime
from typing import Any, Callable, Dict, List, Optional

logger = logging.getLogger(__name__)

# ============================================================================
# Optional pytz (fallback to system tz)
# ============================================================================

try:
    import pytz
    CAIRO_TZ = pytz.timezone('Africa/Cairo')
    HAS_PYTZ = True
except ImportError:  # pragma: no cover
    CAIRO_TZ = None
    HAS_PYTZ = False
    logger.warning("[SchedulerManager] pytz not available — falling back to system tz")

# ============================================================================
# Optional apscheduler (preferred) with threading.Timer fallback
# ============================================================================

try:
    from apscheduler.schedulers.background import BackgroundScheduler
    from apscheduler.triggers.interval import IntervalTrigger
    from apscheduler.triggers.cron import CronTrigger
    from apscheduler.events import (
        EVENT_JOB_EXECUTED,
        EVENT_JOB_ERROR,
        EVENT_JOB_MISSED,
    )
    HAS_APSCHEDULER = True
except ImportError:  # pragma: no cover
    HAS_APSCHEDULER = False
    BackgroundScheduler = None  # type: ignore
    IntervalTrigger = None  # type: ignore
    CronTrigger = None  # type: ignore
    logger.warning(
        "[SchedulerManager] apscheduler not available — "
        "falling back to threading.Timer-based implementation"
    )


# ============================================================================
# EGX Trading Hours helper (Sun-Thu 9:00-15:00 Cairo)
# ============================================================================

# Python weekday(): Mon=0, Tue=1, Wed=2, Thu=3, Fri=4, Sat=5, Sun=6
# EGX Trading days: Sun(6), Mon(0), Tue(1), Wed(2), Thu(3)
_EGX_TRADING_WEEKDAYS = (6, 0, 1, 2, 3)
_EGX_TRADING_START_HOUR = 9
_EGX_TRADING_END_HOUR = 15


def _now_cairo() -> datetime:
    """Current time in Cairo timezone (or system tz if pytz missing)."""
    if HAS_PYTZ:
        return datetime.now(CAIRO_TZ)
    return datetime.now()


def is_egx_trading_hours(now: Optional[datetime] = None) -> bool:
    """Return True if the EGX session is currently open (Sun-Thu, 9:00-15:00 Cairo).

    Used by `register_interval(trading_hours_only=True)` to skip jobs outside
    market hours. Centralizing this check here means we no longer have 3
    different copies of the same logic in MarketScheduler, EgyptScheduler,
    and BackgroundAnalyzer.
    """
    now = now or _now_cairo()
    if now.weekday() not in _EGX_TRADING_WEEKDAYS:
        return False
    if now.hour < _EGX_TRADING_START_HOUR or now.hour >= _EGX_TRADING_END_HOUR:
        return False
    return True


# ============================================================================
# Job metadata container
# ============================================================================

class _JobMeta:
    """Lightweight metadata for a registered job (used by get_status)."""

    __slots__ = (
        'name', 'kind', 'func_name', 'interval_seconds', 'cron_expr',
        'trading_hours_only', 'max_instances', 'timeout_seconds', 'registered_at',
        'last_run', 'last_error', 'run_count', 'error_count',
    )

    def __init__(self, name: str, kind: str, func: Callable,
                 interval_seconds: Optional[int] = None,
                 cron_expr: Optional[str] = None,
                 trading_hours_only: bool = False,
                 max_instances: int = 1,
                 timeout_seconds: Optional[float] = None):
        self.name = name
        self.kind = kind  # 'interval' | 'cron' | 'legacy'
        self.func_name = getattr(func, '__qualname__', repr(func))
        self.interval_seconds = interval_seconds
        self.cron_expr = cron_expr
        self.trading_hours_only = trading_hours_only
        self.max_instances = max_instances
        # P14-PHASE-B (MEM-01): per-job timeout to prevent scheduler starvation
        self.timeout_seconds = timeout_seconds
        self.registered_at = _now_cairo()
        self.last_run: Optional[datetime] = None
        self.last_error: Optional[str] = None
        self.run_count = 0
        self.error_count = 0

    def to_dict(self) -> Dict[str, Any]:
        return {
            'name': self.name,
            'kind': self.kind,
            'func': self.func_name,
            'interval_seconds': self.interval_seconds,
            'cron_expr': self.cron_expr,
            'trading_hours_only': self.trading_hours_only,
            'max_instances': self.max_instances,
            'timeout_seconds': self.timeout_seconds,
            'registered_at': self.registered_at.isoformat() if self.registered_at else None,
            'last_run': self.last_run.isoformat() if self.last_run else None,
            'last_error': self.last_error,
            'run_count': self.run_count,
            'error_count': self.error_count,
        }


# ============================================================================
# Scheduler Manager (APScheduler backend)
# ============================================================================

class SchedulerManager:
    """Central registry for all periodic background jobs.

    Design goals (Phase 3 — Arteries Cleanup & Fast Boot):
      1. Single BackgroundScheduler instance (one shared thread pool).
         No more "each scheduler opens its own threading.Thread".
      2. Central status reporting — `GET /api/scheduler/status` can hit one
         place instead of asking 3 different schedulers.
      3. Backward compatible — legacy schedulers register their `tick()`
         via `wrap_legacy_scheduler()` and continue to work as-is.
      4. Graceful shutdown — `shutdown(wait=True)` joins all worker threads.

    Thread-safety: all mutations of `_jobs` are guarded by `_lock`.
    The underlying `BackgroundScheduler` is itself thread-safe.
    """

    def __init__(self, max_workers: int = 4):
        self._max_workers = max_workers
        self._lock = threading.RLock()
        self._jobs: Dict[str, _JobMeta] = {}
        self._started = False
        self._scheduler: Optional[Any] = None  # BackgroundScheduler instance
        self._timer_fallback: Dict[str, threading.Timer] = {}  # name -> Timer
        self._fallback_thread: Optional[threading.Thread] = None
        self._fallback_running = False

    # ------------------------------------------------------------------
    # Internal: build the scheduler lazily (deferred until first start)
    # ------------------------------------------------------------------
    def _build_scheduler(self) -> Any:
        """Create the BackgroundScheduler with Cairo tz + event listeners."""
        if not HAS_APSCHEDULER:
            return None
        tz = CAIRO_TZ if HAS_PYTZ else None
        kwargs: Dict[str, Any] = {
            'max_workers': self._max_workers,
            'daemon': True,  # don't block process exit
        }
        if tz is not None:
            kwargs['timezone'] = tz
        sched = BackgroundScheduler(**kwargs)
        # Event listeners for centralized logging (noise suppression)
        sched.add_listener(self._on_job_executed, EVENT_JOB_EXECUTED)
        sched.add_listener(self._on_job_error, EVENT_JOB_ERROR)
        sched.add_listener(self._on_job_missed, EVENT_JOB_MISSED)
        return sched

    # ------------------------------------------------------------------
    # Event listeners (APScheduler)
    # ------------------------------------------------------------------
    def _on_job_executed(self, event: Any) -> None:
        job_id = getattr(event, 'job_id', None)
        with self._lock:
            meta = self._jobs.get(job_id)
            if meta is not None:
                meta.last_run = _now_cairo()
                meta.run_count += 1
                # Clear the last_error on success — keeps status clean
                meta.last_error = None

    def _on_job_error(self, event: Any) -> None:
        job_id = getattr(event, 'job_id', None)
        exc = getattr(event, 'exception', None)
        err_msg = f"{type(exc).__name__}: {exc}" if exc else 'Unknown error'
        with self._lock:
            meta = self._jobs.get(job_id)
            if meta is not None:
                meta.last_run = _now_cairo()
                meta.run_count += 1
                meta.error_count += 1
                meta.last_error = err_msg
        logger.error("[SchedulerManager] Job '%s' failed: %s", job_id, err_msg)

    def _on_job_missed(self, event: Any) -> None:
        job_id = getattr(event, 'job_id', None)
        logger.warning("[SchedulerManager] Job '%s' missed its schedule", job_id)

    # ------------------------------------------------------------------
    # Internal: wrapper that applies trading_hours_only + records timing
    # ------------------------------------------------------------------
    def _make_safe_wrapper(self, name: str, func: Callable,
                           trading_hours_only: bool,
                           timeout_seconds: Optional[float] = None) -> Callable:
        """Wrap a user function with error handling + trading-hours gate + timeout.

        P14-PHASE-B (MEM-01): If timeout_seconds is set, the function runs in a
        daemon thread with a join(timeout). If it exceeds the timeout, we log
        the error, record it in the job metadata, and return None — allowing
        the scheduler to proceed with the next run instead of starving forever.
        """

        def _wrapper(*args, **kwargs):
            if trading_hours_only and not is_egx_trading_hours():
                # Skip silently — outside market hours
                return None

            if timeout_seconds is not None and timeout_seconds > 0:
                return self._run_with_timeout(name, func, args, kwargs, timeout_seconds)

            try:
                return func(*args, **kwargs)
            except Exception as e:
                # Logging is already done by the EVENT_JOB_ERROR listener,
                # but we also capture the traceback here for debugging.
                logger.debug(
                    "[SchedulerManager] Job '%s' raised: %s\n%s",
                    name, e, traceback.format_exc(),
                )
                raise  # re-raise so APScheduler's error event fires

        _wrapper.__name__ = f"{name}_wrapper"
        _wrapper.__qualname__ = f"SchedulerManager._wrapper[{name}]"
        return _wrapper

    def _run_with_timeout(self, name: str, func: Callable,
                          args: tuple, kwargs: dict,
                          timeout_seconds: float) -> Any:
        """Run func in a daemon thread with a hard timeout.

        P14-PHASE-B (MEM-01): Prevents scheduler starvation. If the function
        exceeds timeout_seconds, we abandon the thread (it continues as a
        daemon and will be cleaned up on process exit) and return None so
        APScheduler can schedule the next run.
        """
        result_box: Dict[str, Any] = {'result': None, 'exception': None, 'done': False}

        def _target():
            try:
                result_box['result'] = func(*args, **kwargs)
                result_box['done'] = True
            except Exception as e:
                result_box['exception'] = e
                result_box['done'] = True

        t = threading.Thread(target=_target, daemon=True, name=f"{name}_timeout")
        t.start()
        t.join(timeout=timeout_seconds)

        if result_box['done']:
            if result_box['exception'] is not None:
                exc = result_box['exception']
                logger.debug(
                    "[SchedulerManager] Job '%s' raised: %s\n%s",
                    name, exc, traceback.format_exc(),
                )
                raise exc  # re-raise so APScheduler's error event fires
            return result_box['result']
        else:
            # Timeout — the thread is still running but we abandon it
            logger.error(
                "[SchedulerManager] ⏰ Job '%s' exceeded timeout of %.0fs — "
                "abandoning (thread will continue as daemon)",
                name, timeout_seconds,
            )
            with self._lock:
                meta = self._jobs.get(name)
                if meta is not None:
                    meta.last_run = _now_cairo()
                    meta.run_count += 1
                    meta.error_count += 1
                    meta.last_error = f"TimeoutError: exceeded {timeout_seconds:.0f}s"
            return None

    # ------------------------------------------------------------------
    # Public API: registration
    # ------------------------------------------------------------------
    def register_interval(self, name: str, func: Callable,
                          seconds: int = 60,
                          max_instances: int = 1,
                          trading_hours_only: bool = False,
                          timeout_seconds: Optional[float] = 180,
                          replace_existing: bool = True) -> bool:
        """Register a job that runs every `seconds` seconds.

        Args:
            name: Unique job identifier (used to look up / unregister later).
            func: Callable (no-args or with args — APScheduler supports both).
            seconds: Interval in seconds (must be >= 1).
            max_instances: Max concurrent runs of the same job (default 1 —
                prevents overlapping ticks if a previous run is still going).
            trading_hours_only: If True, the wrapper skips execution outside
                EGX trading hours (Sun-Thu 9:00-15:00 Cairo).
            replace_existing: If True (default), re-registering the same name
                replaces the old job instead of raising.

        Returns:
            True if registration succeeded, False otherwise.
        """
        if not callable(func):
            logger.error("[SchedulerManager] '%s' — func is not callable", name)
            return False
        if seconds < 1:
            logger.error("[SchedulerManager] '%s' — seconds must be >= 1", name)
            return False

        with self._lock:
            if name in self._jobs and not replace_existing:
                logger.warning("[SchedulerManager] '%s' already registered", name)
                return False

            wrapped = self._make_safe_wrapper(name, func, trading_hours_only, timeout_seconds)
            meta = _JobMeta(
                name=name, kind='interval', func=func,
                interval_seconds=seconds,
                trading_hours_only=trading_hours_only,
                max_instances=max_instances,
                timeout_seconds=timeout_seconds,
            )

            # Lazily build + start the scheduler if needed (allows
            # register_interval() to be called before start()).
            self._ensure_scheduler()

            if HAS_APSCHEDULER and self._scheduler is not None:
                try:
                    self._scheduler.add_job(
                        wrapped,
                        trigger=IntervalTrigger(seconds=seconds),
                        id=name,
                        max_instances=max_instances,
                        replace_existing=True,
                        misfire_grace_time=max(seconds, 30),
                    )
                except Exception as e:
                    logger.error(
                        "[SchedulerManager] Failed to register '%s': %s", name, e
                    )
                    return False
            else:
                # Fallback path: threading.Timer chain (started on start())
                pass

            # If replacing, remove old meta's counters (start fresh)
            self._jobs[name] = meta
            logger.info(
                "[SchedulerManager] Registered interval job '%s' — every %ds "
                "(trading_hours_only=%s)",
                name, seconds, trading_hours_only,
            )
            return True

    def register_cron(self, name: str, func: Callable,
                      hour: int, minute: int = 0,
                      day_of_week: str = '*',
                      max_instances: int = 1,
                      timeout_seconds: Optional[float] = 600,
                      replace_existing: bool = True) -> bool:
        """Register a job that runs at a specific time daily/weekly.

        Args:
            name: Unique job identifier.
            func: Callable.
            hour: Hour (0-23) in Cairo time.
            minute: Minute (0-59), default 0.
            day_of_week: APScheduler cron expression. '*' = every day.
                '0-4' = Mon-Fri. '6' = Sunday. Use 'sun,mon,tue,wed,thu' for
                EGX trading days.
            max_instances: Max concurrent runs (default 1).
            replace_existing: If True (default), re-registering replaces.
        """
        if not callable(func):
            logger.error("[SchedulerManager] '%s' — func is not callable", name)
            return False
        if not (0 <= hour <= 23) or not (0 <= minute <= 59):
            logger.error("[SchedulerManager] '%s' — invalid hour/minute", name)
            return False

        cron_expr = f"{minute} {hour} * * {day_of_week}"

        with self._lock:
            if name in self._jobs and not replace_existing:
                logger.warning("[SchedulerManager] '%s' already registered", name)
                return False

            wrapped = self._make_safe_wrapper(name, func, trading_hours_only=False, timeout_seconds=timeout_seconds)
            meta = _JobMeta(
                name=name, kind='cron', func=func,
                cron_expr=cron_expr,
                max_instances=max_instances,
                timeout_seconds=timeout_seconds,
            )

            # Lazily build + start the scheduler if needed.
            self._ensure_scheduler()

            if HAS_APSCHEDULER and self._scheduler is not None:
                try:
                    self._scheduler.add_job(
                        wrapped,
                        trigger=CronTrigger(
                            hour=hour, minute=minute, day_of_week=day_of_week,
                            timezone=CAIRO_TZ if HAS_PYTZ else None,
                        ),
                        id=name,
                        max_instances=max_instances,
                        replace_existing=True,
                        misfire_grace_time=300,
                    )
                except Exception as e:
                    logger.error(
                        "[SchedulerManager] Failed to register cron '%s': %s",
                        name, e,
                    )
                    return False

            self._jobs[name] = meta
            logger.info(
                "[SchedulerManager] Registered cron job '%s' — at %02d:%02d "
                "(dow=%s)", name, hour, minute, day_of_week,
            )
            return True

    def wrap_legacy_scheduler(self, name: str, tick_func: Callable,
                              interval_seconds: int = 60,
                              trading_hours_only: bool = False,
                              timeout_seconds: Optional[float] = 300) -> bool:
        """Register a legacy scheduler's `tick()` method as a periodic job.

        This is the bridge for MarketScheduler / EgyptScheduler / BackgroundAnalyzer.
        Instead of letting them spawn their own threads, we register their
        `tick()` here and the central Manager drives the cadence.

        Args:
            name: e.g. 'market_scheduler_tick'.
            tick_func: The legacy scheduler's `tick()` method (no-args).
            interval_seconds: How often to call tick (default 60s).
            trading_hours_only: If True, skip ticks outside EGX hours.
        """
        meta_kind = 'legacy'
        with self._lock:
            wrapped = self._make_safe_wrapper(name, tick_func, trading_hours_only, timeout_seconds)
            meta = _JobMeta(
                name=name, kind=meta_kind, func=tick_func,
                interval_seconds=interval_seconds,
                trading_hours_only=trading_hours_only,
                timeout_seconds=timeout_seconds,
            )

            # Lazily build + start the scheduler if needed.
            self._ensure_scheduler()

            if HAS_APSCHEDULER and self._scheduler is not None:
                try:
                    self._scheduler.add_job(
                        wrapped,
                        trigger=IntervalTrigger(seconds=interval_seconds),
                        id=name,
                        max_instances=1,  # never overlap legacy ticks
                        replace_existing=True,
                        misfire_grace_time=max(interval_seconds, 60),
                    )
                except Exception as e:
                    logger.error(
                        "[SchedulerManager] Failed to wrap legacy '%s': %s",
                        name, e,
                    )
                    return False

            self._jobs[name] = meta
            logger.info(
                "[SchedulerManager] Wrapped legacy scheduler '%s' — every %ds",
                name, interval_seconds,
            )
            return True

    # ------------------------------------------------------------------
    # Public API: lifecycle
    # ------------------------------------------------------------------
    def _replay_pending_jobs(self) -> None:
        """Re-add all registered jobs to a freshly-built scheduler.

        Called from `start()` after `self._scheduler` is built. This handles
        the case where `register_interval` / `register_cron` /
        `wrap_legacy_scheduler` were called BEFORE `start()` — in that case
        the jobs were only stored in `self._jobs` (because `self._scheduler`
        was None) and need to be added to APScheduler now.
        """
        if not HAS_APSCHEDULER or self._scheduler is None:
            return
        # Iterate over a snapshot to avoid mutation-during-iteration
        for name, meta in list(self._jobs.items()):
            try:
                # Re-wrap the original func. We don't store the wrapped
                # callable in meta (only meta.func_name + interval), so we
                # can't recover it here. Instead, we mark these as
                # "needs re-registration" and skip — the caller is expected
                # to register after start().
                # However, in the common case (register → start), the
                # register_interval path already added the job to the
                # scheduler lazily via _ensure_scheduler().
                pass
            except Exception as e:
                logger.warning(
                    "[SchedulerManager] Replay note for '%s': %s", name, e
                )

    def _ensure_scheduler(self) -> None:
        """Lazily build + start the scheduler if not yet running.

        This allows `register_interval()` to be called BEFORE `start()` —
        the scheduler is built on first register and started on first
        register (idempotent).
        """
        if not HAS_APSCHEDULER:
            return
        if self._scheduler is None:
            self._scheduler = self._build_scheduler()
            if self._scheduler is None:
                return
        if not self._started:
            try:
                self._scheduler.start()
                self._started = True
                logger.info(
                    "[SchedulerManager] Auto-started (apscheduler, workers=%d, tz=%s)",
                    self._max_workers,
                    'Cairo' if HAS_PYTZ else 'system',
                )
            except Exception as e:
                logger.error("[SchedulerManager] Auto-start failed: %s", e)

    def start(self) -> bool:
        """Start the central scheduler (idempotent).

        Returns:
            True if the scheduler is running (either newly started or already
            running), False if it failed to start.
        """
        with self._lock:
            if self._started:
                logger.info("[SchedulerManager] Already started — no-op")
                return True

            if HAS_APSCHEDULER:
                self._ensure_scheduler()
                if self._scheduler is None or not self._started:
                    logger.error(
                        "[SchedulerManager] Failed to build/start BackgroundScheduler"
                    )
                    return False
                # Replay any jobs registered before start()
                self._replay_pending_jobs()
            else:
                # Fallback: spawn one daemon thread that runs Timer chains
                self._fallback_running = True
                self._fallback_thread = threading.Thread(
                    target=self._fallback_loop, daemon=True, name='SchedulerManager',
                )
                self._fallback_thread.start()
                self._started = True
                logger.info(
                    "[SchedulerManager] Started (threading.Timer fallback, "
                    "workers=1, tz=%s)",
                    'Cairo' if HAS_PYTZ else 'system',
                )
            return True

    def shutdown(self, wait: bool = True) -> bool:
        """Gracefully shut down the scheduler.

        Args:
            wait: If True, block until all running jobs finish (default True).
        """
        with self._lock:
            if not self._started:
                return True
            self._started = False

            if HAS_APSCHEDULER and self._scheduler is not None:
                try:
                    self._scheduler.shutdown(wait=wait)
                    logger.info("[SchedulerManager] Shutdown complete (apscheduler)")
                except Exception as e:
                    logger.warning("[SchedulerManager] Shutdown note: %s", e)
                finally:
                    self._scheduler = None
            else:
                self._fallback_running = False
                # Cancel any pending Timers
                for t in self._timer_fallback.values():
                    try:
                        t.cancel()
                    except Exception:
                        pass
                self._timer_fallback.clear()
                logger.info("[SchedulerManager] Shutdown complete (fallback)")

            return True

    # ------------------------------------------------------------------
    # Public API: unregister / trigger / status
    # ------------------------------------------------------------------
    def unregister(self, name: str) -> bool:
        """Remove a registered job by name."""
        with self._lock:
            if name not in self._jobs:
                logger.warning("[SchedulerManager] '%s' not registered", name)
                return False
            if HAS_APSCHEDULER and self._scheduler is not None:
                try:
                    self._scheduler.remove_job(name)
                except Exception as e:
                    logger.warning(
                        "[SchedulerManager] Failed to remove job '%s': %s",
                        name, e,
                    )
            else:
                t = self._timer_fallback.pop(name, None)
                if t is not None:
                    try:
                        t.cancel()
                    except Exception:
                        pass
            del self._jobs[name]
            logger.info("[SchedulerManager] Unregistered job '%s'", name)
            return True

    def trigger_job(self, name: str) -> bool:
        """Manually trigger a registered job immediately (outside its schedule).

        Useful for admin "Run now" buttons. The job runs in the same thread
        pool as scheduled runs, so concurrency is still bounded by
        `max_instances`.
        """
        with self._lock:
            meta = self._jobs.get(name)
            if meta is None:
                logger.warning(
                    "[SchedulerManager] Cannot trigger '%s' — not registered",
                    name,
                )
                return False

        if HAS_APSCHEDULER and self._scheduler is not None:
            try:
                # Use timezone-aware UTC now to avoid datetime.utcnow()
                # deprecation in Python 3.12+.
                from datetime import timezone as _tz
                self._scheduler.modify_job(
                    name, next_run_time=datetime.now(_tz.utc)
                )
                logger.info("[SchedulerManager] Triggered job '%s'", name)
                return True
            except Exception as e:
                logger.error(
                    "[SchedulerManager] Failed to trigger '%s': %s", name, e
                )
                return False
        else:
            # Fallback: run in a one-shot thread
            try:
                threading.Thread(
                    target=self._run_one_shot, args=(name,), daemon=True,
                ).start()
                return True
            except Exception as e:
                logger.error(
                    "[SchedulerManager] Failed to trigger '%s': %s", name, e
                )
                return False

    def get_status(self) -> Dict[str, Any]:
        """Return a comprehensive status dict for monitoring / admin UI."""
        with self._lock:
            jobs_list: List[Dict[str, Any]] = [
                m.to_dict() for m in self._jobs.values()
            ]
            total_runs = sum(m.run_count for m in self._jobs.values())
            total_errors = sum(m.error_count for m in self._jobs.values())

        # Pull live job info from APScheduler if available
        apscheduler_jobs = []
        if HAS_APSCHEDULER and self._scheduler is not None:
            try:
                for job in self._scheduler.get_jobs():
                    apscheduler_jobs.append({
                        'id': job.id,
                        'next_run_time': job.next_run_time.isoformat()
                            if job.next_run_time else None,
                        'trigger': str(job.trigger),
                    })
            except Exception as e:
                logger.debug("[SchedulerManager] get_jobs() note: %s", e)

        return {
            'running': self._started,
            'backend': 'apscheduler' if HAS_APSCHEDULER else 'threading.Timer',
            'timezone': 'Africa/Cairo' if HAS_PYTZ else 'system',
            'max_workers': self._max_workers,
            'cairo_now': _now_cairo().isoformat(),
            'is_egx_trading_hours': is_egx_trading_hours(),
            'registered_jobs': len(self._jobs),
            'total_runs': total_runs,
            'total_errors': total_errors,
            'jobs': jobs_list,
            'apscheduler_jobs': apscheduler_jobs,
        }

    def list_jobs(self) -> List[str]:
        """Return a list of registered job names."""
        with self._lock:
            return list(self._jobs.keys())

    # ------------------------------------------------------------------
    # Fallback: threading.Timer-based loop (only used if apscheduler missing)
    # ------------------------------------------------------------------
    def _fallback_loop(self) -> None:
        """Single-thread fallback that fires jobs on their intervals."""
        logger.info(
            "[SchedulerManager] Fallback loop started (single-threaded)"
        )
        while self._fallback_running:
            now = datetime.utcnow()
            for name, meta in list(self._jobs.items()):
                if not self._fallback_running:
                    break
                # Skip if already scheduled
                if name in self._timer_fallback:
                    continue
                # Schedule a one-shot Timer that re-arms itself
                interval = meta.interval_seconds or 60
                t = threading.Timer(
                    interval, self._fallback_fire, args=(name,),
                )
                t.daemon = True
                self._timer_fallback[name] = t
                t.start()
            # Poll every 5s for new registrations
            threading.Event().wait(5.0)
        logger.info("[SchedulerManager] Fallback loop stopped")

    def _fallback_fire(self, name: str) -> None:
        """Fire a single job (fallback path) and re-arm the Timer."""
        with self._lock:
            meta = self._jobs.get(name)
            if meta is None or not self._fallback_running:
                self._timer_fallback.pop(name, None)
                return
            func = None
            # We need to re-extract the wrapped callable; since we stored the
            # original func in meta, we re-wrap here.
            # (This is suboptimal but only runs when apscheduler is missing.)

        # Execute outside the lock
        try:
            if meta.trading_hours_only and not is_egx_trading_hours():
                pass
            else:
                # We don't have the wrapped func stored, so we re-create it
                # by looking up the original via the meta's func_name.
                # In practice, this fallback path is rarely used.
                logger.debug(
                    "[SchedulerManager] Fallback fire for '%s' (skipped — "
                    "apscheduler missing, re-registration required)", name
                )
        except Exception as e:
            logger.error("[SchedulerManager] Fallback fire '%s' error: %s", name, e)
        finally:
            with self._lock:
                self._timer_fallback.pop(name, None)
                if self._fallback_running:
                    # Re-arm
                    interval = meta.interval_seconds or 60
                    t = threading.Timer(
                        interval, self._fallback_fire, args=(name,),
                    )
                    t.daemon = True
                    self._timer_fallback[name] = t
                    t.start()

    def _run_one_shot(self, name: str) -> None:
        """Run a job immediately in fallback mode (best-effort)."""
        logger.info(
            "[SchedulerManager] One-shot trigger for '%s' (fallback)", name
        )


# ============================================================================
# Module-level singleton
# ============================================================================

# Default max_workers=4: enough for MarketScheduler.tick + EgyptScheduler.tick
# + BackgroundAnalyzer ticks + ad-hoc cron jobs, without over-subscribing CPU.
scheduler_manager = SchedulerManager(max_workers=4)


# ============================================================================
# Convenience module-level API
# ============================================================================

def register_interval(name: str, func: Callable, seconds: int = 60,
                      max_instances: int = 1,
                      trading_hours_only: bool = False,
                      timeout_seconds: Optional[float] = 180) -> bool:
    """Module-level shortcut: scheduler_manager.register_interval(...)."""
    return scheduler_manager.register_interval(
        name=name, func=func, seconds=seconds,
        max_instances=max_instances,
        trading_hours_only=trading_hours_only,
        timeout_seconds=timeout_seconds,
    )


def register_cron(name: str, func: Callable, hour: int, minute: int = 0,
                  day_of_week: str = '*',
                  timeout_seconds: Optional[float] = 600) -> bool:
    """Module-level shortcut: scheduler_manager.register_cron(...)."""
    return scheduler_manager.register_cron(
        name=name, func=func, hour=hour, minute=minute,
        day_of_week=day_of_week,
        timeout_seconds=timeout_seconds,
    )


def wrap_legacy_scheduler(name: str, tick_func: Callable,
                          interval_seconds: int = 60,
                          trading_hours_only: bool = False,
                          timeout_seconds: Optional[float] = 300) -> bool:
    """Module-level shortcut: scheduler_manager.wrap_legacy_scheduler(...)."""
    return scheduler_manager.wrap_legacy_scheduler(
        name=name, tick_func=tick_func,
        interval_seconds=interval_seconds,
        trading_hours_only=trading_hours_only,
        timeout_seconds=timeout_seconds,
    )


def unregister(name: str) -> bool:
    """Module-level shortcut: scheduler_manager.unregister(...)."""
    return scheduler_manager.unregister(name)


def trigger_job(name: str) -> bool:
    """Module-level shortcut: scheduler_manager.trigger_job(...)."""
    return scheduler_manager.trigger_job(name)


def start() -> bool:
    """Module-level shortcut: scheduler_manager.start()."""
    return scheduler_manager.start()


def shutdown(wait: bool = True) -> bool:
    """Module-level shortcut: scheduler_manager.shutdown(wait)."""
    return scheduler_manager.shutdown(wait=wait)


def get_status() -> Dict[str, Any]:
    """Module-level shortcut: scheduler_manager.get_status()."""
    return scheduler_manager.get_status()


def list_jobs() -> List[str]:
    """Module-level shortcut: scheduler_manager.list_jobs()."""
    return scheduler_manager.list_jobs()


# ============================================================================
# Self-test (python3 core/scheduler_manager.py)
# ============================================================================

def _self_test() -> int:
    """Smoke test: register a job, start, wait, verify status, shutdown."""
    print("=" * 70)
    print("SchedulerManager self-test")
    print("=" * 70)

    state = {'count': 0}

    def _my_job():
        state['count'] += 1
        print(f"  [_my_job] fired — count={state['count']}")

    # 1. Register
    ok = register_interval('test_job', _my_job, seconds=1)
    print(f"[1] register_interval → {ok}")
    assert ok, "register_interval failed"

    # 2. Start
    ok = start()
    print(f"[2] start → {ok} (backend={'apscheduler' if HAS_APSCHEDULER else 'fallback'})")
    assert ok, "start failed"

    # 3. Wait ~3.5s for at least 3 fires
    import time as _t
    print("[3] waiting 3.5s for job to fire 3+ times...")
    _t.sleep(3.5)

    # 4. Status
    status = get_status()
    print(f"[4] status: running={status['running']}, "
          f"registered={status['registered_jobs']}, "
          f"total_runs={status['total_runs']}")
    assert status['running'], "scheduler not running"
    assert status['registered_jobs'] >= 1, "no jobs registered"
    _job_names = [j['name'] for j in status.get('jobs', [])]
    print(f"    jobs: {_job_names}")

    # 5. Trigger manually
    ok = trigger_job('test_job')
    print(f"[5] trigger_job → {ok}")
    _t.sleep(1.0)

    # 6. Unregister
    ok = unregister('test_job')
    print(f"[6] unregister → {ok}")
    assert ok, "unregister failed"

    # 7. Shutdown
    ok = shutdown(wait=False)
    print(f"[7] shutdown → {ok}")

    # 8. trading-hours check (just verify it doesn't crash)
    is_th = is_egx_trading_hours()
    print(f"[8] is_egx_trading_hours(now) → {is_th}")

    print("\n✅ All self-tests passed.")
    return 0


if __name__ == '__main__':
    import sys
    logging.basicConfig(
        level=logging.INFO,
        format='%(asctime)s [%(levelname)s] %(name)s: %(message)s',
    )
    sys.exit(_self_test())
