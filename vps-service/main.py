#!/usr/bin/env python3
"""
GLM Finance VPS Service Main Entrypoint (FastAPI)
==================================================
Serves /api/ai and /api/portfolio routes for GLMinvestment.
"""

import sys
import logging
import threading
import os
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(BASE_DIR))
sys.path.insert(0, str(BASE_DIR / "ai"))

# ─── .env loader (يوليو 2026) ─────────────────────────────────────────────
# حمّل .env من جذر المشروع عشان الباك-إند يحترم نفس متغيرات البيئة مثل Next.js.
# متوافق للإنتاج/الساندبوكس/اللابتوب. لو الملف مش موجود أو المتغير معرّف بالفعل
# في بيئة التشغيل → يتخطّى (production env vars تاخد الأولوية).
# مفيش dependency خارجية — parser يدوي بسيط.
_env_path = BASE_DIR.parent / '.env'
if _env_path.exists():
    try:
        with open(_env_path, 'r', encoding='utf-8') as _f:
            for _line in _f:
                _line = _line.strip()
                if not _line or _line.startswith('#') or '=' not in _line:
                    continue
                _k, _, _v = _line.partition('=')
                _k = _k.strip()
                _v = _v.strip().strip('"').strip("'")
                if _k and _k not in os.environ:
                    os.environ[_k] = _v
    except Exception as _e:
        print(f"[main.py] .env load warning: {_e}")
# ─── end .env loader ──────────────────────────────────────────────────────

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

# ============================================================================
# Phase 3 — Central Logging Configuration (Noise Suppression)
# ============================================================================
# Call setup_logging() BEFORE any other app imports so that any logging done
# during module imports is also properly configured. This silences library
# noise (httpx retries, urllib3 pool, apscheduler per-tick messages, uvicorn
# access log) while keeping our own modules at INFO/DEBUG.
# ============================================================================
try:
    from core.logging_config import setup_logging as _setup_logging
    _setup_logging()
except ImportError as _imp_err:
    # Fallback: basic config if logging_config isn't available
    logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(name)s: %(message)s")
    print(f"[main.py] core.logging_config not available — using basicConfig: {_imp_err}")
except Exception as _lc_err:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(name)s: %(message)s")
    print(f"[main.py] logging_config setup failed (non-fatal): {_lc_err}")

logger = logging.getLogger(__name__)

# ============================================================================
# Phase 3 — Arteries Cleanup & Fast Boot
# ============================================================================
# Run database migrations ONCE at boot (central schema source-of-truth).
# This replaces the scattered CREATE TABLE IF NOT EXISTS calls across 67 files
# with a single, fast migrator run. Idempotent — safe to call multiple times.
# Also initializes the central SchedulerManager (single APScheduler instance
# shared by all background jobs — no more thread-per-scheduler).
# ============================================================================
try:
    from core.migrator import run_migrations as _run_migrations
    try:
        _mig_result = _run_migrations()
        _mig_totals = _mig_result.get('totals', {}) if isinstance(_mig_result, dict) else {}
        logger.info(
            "[main.py] Migrations applied — tables=%s, indexes=%s, errors=%s, "
            "duration_ms=%.1f",
            _mig_totals.get('tables', 0),
            _mig_totals.get('indexes', 0),
            _mig_totals.get('errors', 0),
            _mig_result.get('duration_ms', 0) if isinstance(_mig_result, dict) else 0,
        )
    except Exception as _mig_err:
        logger.error(f"[main.py] Migrator failed (non-fatal — continuing): {_mig_err}")
except ImportError as _imp_err:
    logger.warning(f"[main.py] core.migrator not available — skipping migrations: {_imp_err}")

# Start the central SchedulerManager (Phase 3 — single APScheduler instance).
try:
    from core.scheduler_manager import scheduler_manager as _scheduler_manager
    try:
        _scheduler_manager.start()
        logger.info("[main.py] SchedulerManager started (central APScheduler)")
    except Exception as _sm_err:
        logger.error(f"[main.py] SchedulerManager start failed (non-fatal): {_sm_err}")
except ImportError as _imp_err:
    logger.warning(f"[main.py] core.scheduler_manager not available: {_imp_err}")
    _scheduler_manager = None

app = FastAPI(
    title="GLM Finance Backend",
    description="Python Backend for GLMinvestment (Wealth Command Center, AI Analysis & Market Monitoring)",
    version="2.0.0"
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Mount Portfolio Command Center Router
try:
    from ai.portfolio_routes import portfolio_router
    app.include_router(portfolio_router)
    logger.info("✅ Mounted portfolio_router via ai.portfolio_routes")
except ImportError:
    try:
        from portfolio_routes import portfolio_router
        app.include_router(portfolio_router)
        logger.info("✅ Mounted portfolio_router directly")
    except Exception as e:
        logger.error(f"❌ Failed to mount portfolio_router: {e}")

# Mount AI Analysis Router
try:
    from ai.api_routes import ai_router
    app.include_router(ai_router)
    logger.info("✅ Mounted ai_router")
except Exception as e:
    logger.warning(f"⚠️ Note on ai_router: {e}")

# Start MarketScheduler in background thread
_scheduler_thread = None
_egypt_scheduler_thread = None

def _start_scheduler():
    """Phase 3: Register MarketScheduler.tick with the central SchedulerManager.

    Backward compatible — if scheduler_manager isn't available, fall back to
    the legacy thread-based start(interval_seconds=60).
    """
    global _scheduler_thread
    try:
        from jobs.market_scheduler import MarketScheduler
        scheduler = MarketScheduler()
        logger.info("[main.py] MarketScheduler instantiated — predictions will update every cycle")

        # Phase 3: prefer the central SchedulerManager
        if _scheduler_manager is not None:
            try:
                # Don't call scheduler.start(60) — that blocks in its own thread.
                # Instead, register tick() as a periodic job.
                ok = _scheduler_manager.wrap_legacy_scheduler(
                    'market_scheduler_tick',
                    scheduler.tick,
                    interval_seconds=60,
                )
                if ok:
                    logger.info(
                        "[main.py] MarketScheduler.tick registered with "
                        "SchedulerManager (no separate thread)"
                    )
                    return
            except Exception as e_reg:
                logger.warning(
                    f"[main.py] SchedulerManager registration failed, "
                    f"falling back to thread: {e_reg}"
                )

        # Legacy fallback: blocking start in its own thread
        scheduler.start(interval_seconds=60)
    except Exception as e:
        logger.error(f"[main.py] Failed to start MarketScheduler: {e}")

def _start_egypt_scheduler():
    """AGILE-PHASE2-035 (A) + Phase 3: Start EgyptScheduler via SchedulerManager.

    Phase 3 change: instead of spawning a thread per scheduler, register
    `tick_once()` with the central SchedulerManager. Falls back to the
    legacy thread-based start() if the manager isn't available.
    """
    try:
        from core.egypt_scheduler import (
            get_scheduler,
            setup_nightly_quant_job,
            setup_egksco_scheduler,
        )
        # سجّل المهمام قبل الـ start
        try:
            setup_nightly_quant_job()  # 03:00 Cairo daily — SMFI + Monte Carlo cache
            logger.info("[main.py] nightly_quant job registered (03:00 Cairo)")
        except Exception as e_nq:
            logger.error(f"[main.py] Failed to register nightly_quant: {e_nq}")

        try:
            setup_egksco_scheduler(run_on_start=False)
            logger.info("[main.py] egksco_sync task registered (9:00-14:30 Cairo)")
        except Exception as e_eg:
            logger.error(f"[main.py] Failed to register egksco_sync: {e_eg}")

        egypt_sched = get_scheduler()

        # Phase 3: prefer the central SchedulerManager
        if _scheduler_manager is not None:
            try:
                # Mark running=True so tick_once's internal state is correct
                # (some legacy code checks self.running before doing work).
                egypt_sched.running = True
                # Run any run_on_start tasks once, immediately
                for _name, _task in list(egypt_sched.tasks.items()):
                    if _task.get('run_on_start'):
                        try:
                            egypt_sched._run_task(_name, _task)
                        except Exception as _e:
                            logger.error(f"[main.py] run_on_start '{_name}' failed: {_e}")

                ok = _scheduler_manager.wrap_legacy_scheduler(
                    'egypt_scheduler_tick',
                    egypt_sched.tick_once,
                    interval_seconds=60,
                )
                if ok:
                    logger.info(
                        "[main.py] EgyptScheduler.tick_once registered with "
                        "SchedulerManager (no separate thread)"
                    )
                    return
            except Exception as e_reg:
                logger.warning(
                    f"[main.py] SchedulerManager registration failed, "
                    f"falling back to thread: {e_reg}"
                )

        # Legacy fallback: start_egypt_sched() spawns a thread
        from core.egypt_scheduler import start_scheduler as start_egypt_sched
        start_egypt_sched()
        logger.info("[main.py] EgyptScheduler started (legacy thread)")
    except Exception as e:
        logger.error(f"[main.py] Failed to start EgyptScheduler: {e}")

@app.on_event("startup")
async def startup_event():
    global _scheduler_thread, _egypt_scheduler_thread

    # Phase 3: if the central SchedulerManager is available, we don't need
    # to spawn dedicated threads for MarketScheduler / EgyptScheduler —
    # their tick methods are registered as periodic jobs on the manager's
    # single APScheduler instance. We still call the _start_* helpers
    # (they handle the registration) but we DON'T spawn the wrapping thread
    # unless we're on the legacy fallback path.
    if _scheduler_manager is not None:
        # Register both schedulers directly (no wrapper threads needed)
        try:
            _start_scheduler()
        except Exception as e:
            logger.error(f"[main.py] MarketScheduler init error: {e}")
        try:
            _start_egypt_scheduler()
        except Exception as e:
            logger.error(f"[main.py] EgyptScheduler init error: {e}")
        # Phase 4 Task 4: Register the hourly WAL checkpoint job.
        # This runs `PRAGMA wal_checkpoint(TRUNCATE)` + `PRAGMA optimize`
        # on stocks.db, predictions.db, price_history.db, and data_engine.db
        # every hour to keep the DBs compact and fast.
        try:
            from jobs.wal_checkpoint import run_wal_checkpoint
            ok = _scheduler_manager.register_interval(
                'wal_checkpoint_hourly',
                run_wal_checkpoint,
                seconds=3600,  # hourly
                max_instances=1,  # never overlap
            )
            if ok:
                logger.info(
                    "[main.py] WAL checkpoint job registered "
                    "(hourly, 4 DBs: stocks + predictions + price_history + data_engine)"
                )
                # Run once at startup so the DBs start compact (best-effort,
                # non-blocking — runs in the scheduler's thread pool).
                try:
                    _scheduler_manager.trigger_job('wal_checkpoint_hourly')
                    logger.info("[main.py] WAL checkpoint initial run triggered")
                except Exception as e_trig:
                    logger.warning(
                        f"[main.py] WAL checkpoint initial trigger failed: {e_trig}"
                    )
        except ImportError as e_imp:
            logger.warning(
                f"[main.py] jobs.wal_checkpoint not available: {e_imp}"
            )
        except Exception as e_wal:
            logger.error(
                f"[main.py] WAL checkpoint job registration failed: {e_wal}"
            )

        # P23-CRYPTO-LAB-FUSION: Crypto 24/7 Live Lab — BTC + ETH analysis every 15 min.
        # Runs independently of EGX market hours (crypto trades 24/7). Logs each
        # prediction to `crypto_predictions_log` in predictions.db. Uses the same
        # LiveIndicatorEngine + FusionEngineV20 + SMC pattern as the EGX pipeline.
        # Env var SKIP_CRYPTO_LAB=1 يتعطّل في البيئات منخفضة الذاكرة (sandbox).
        try:
            if os.environ.get('SKIP_CRYPTO_LAB', '0') == '1':
                logger.info("[main.py] Crypto Lab Scheduler SKIPPED (SKIP_CRYPTO_LAB=1)")
            else:
                from jobs.crypto_lab_scheduler import get_crypto_lab_scheduler
                _crypto_lab = get_crypto_lab_scheduler()
                _crypto_lab.start(
                    interval_seconds=15 * 60,  # 15 minutes
                    use_scheduler_manager=True,
                )
                logger.info(
                    "[main.py] Crypto Lab Scheduler registered "
                    "(every 15 min, 24/7, BTC + ETH → crypto_predictions_log)"
                )
        except ImportError as e_imp:
            logger.warning(
                f"[main.py] jobs.crypto_lab_scheduler not available: {e_imp}"
            )
        except Exception as e_clab:
            logger.error(
                f"[main.py] Crypto Lab Scheduler registration failed: {e_clab}"
            )
    else:
        # Legacy path: spawn threads as before
        if _scheduler_thread is None or not _scheduler_thread.is_alive():
            _scheduler_thread = threading.Thread(target=_start_scheduler, daemon=True)
            _scheduler_thread.start()
            logger.info("[main.py] MarketScheduler thread started (legacy)")
        if _egypt_scheduler_thread is None or not _egypt_scheduler_thread.is_alive():
            _egypt_scheduler_thread = threading.Thread(target=_start_egypt_scheduler, daemon=True)
            _egypt_scheduler_thread.start()
            logger.info("[main.py] EgyptScheduler thread started (legacy)")

@app.get("/health")
async def health_check():
    return {"status": "ok", "service": "GLM Finance Backend", "version": "2.0.0"}

# Mount Flask app for all chart / stock / market-pulse endpoints
# Migration (2026-09-03): استبدال fastapi.middleware.wsgi ( buggy مع starlette 0.50+)
# بـ a2wsgi.WSGIMiddleware (البديل الموصى بيه من starlette docs نفسها).
# الـ fastapi.middleware.wsgi بتعمل segfault/crash مع anyio 4.13.
try:
    from a2wsgi import WSGIMiddleware as A2WSGIMiddleware
    from lightweight_server import app as flask_app
    app.mount("/", A2WSGIMiddleware(flask_app))
    logger.info("✅ Mounted Flask lightweight_server WSGI app on / (via a2wsgi.WSGIMiddleware)")
except Exception as e:
    logger.error(f"❌ Failed to mount Flask app via a2wsgi: {e}")
    # Fallback: try the old WSGIMiddleware (might crash but at least it'll start)
    try:
        from fastapi.middleware.wsgi import WSGIMiddleware
        from lightweight_server import app as flask_app
        app.mount("/", WSGIMiddleware(flask_app))
        logger.warning("⚠️ Using fastapi WSGIMiddleware fallback (may crash on WSGI requests)")
    except Exception as e2:
        logger.error(f"❌ Fallback also failed: {e2}")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8010, reload=False)
