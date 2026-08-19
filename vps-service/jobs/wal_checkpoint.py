#!/usr/bin/env python3
"""
wal_checkpoint.py — WAL Checkpoint المجدول (Phase 4 Task 4)
=============================================================

المشكلة (قبل Phase 4):
----------------------
ملفات الـ WAL (Write-Ahead Log) بتنم وفيها عمليات كتابة كتير. SQLite بـ
check-ponit تلقائياً كل 1000 صفحة (wal_autocheckpoint=1000)، بس ده مش
كافي لو فيه writes كتير في وقت قصير. النتيجة:
  - ملفات `.db-wal` بتكبر (شفتها وصلت 5-10MB في الـ data_engine.db).
  - القراءة تبقى بطيئة شوية (SQLite بيـ merge الـ WAL + main DB في كل read).
  - مساحة قرص بترتفع بلا فايدة.

الحل (Phase 4 — Resilience & Observability):
--------------------------------------------
`run_wal_checkpoint()` بتعمل:
  1. `PRAGMA wal_checkpoint(TRUNCATE)` — بيـ merge الـ WAL في الـ main DB
     وبيقصّ الـ WAL file لـ 0 bytes. ده أقوى من `PASSIVE` (اللي بيـ merge
     بس مابيقصّش).
  2. `PRAGMA optimize` — بيـ optimize الـ query planner (بتـ update
     sqlite_stat1 table). بيسرّع الـ SELECT queries.

بتشتغل على الـ 3 DBs الأساسية + data_engine (شديدة الـ writes):
  - stocks.db (المستخدم طلبها)
  - predictions.db (المستخدم طلبها)
  - price_history.db (المستخدم طلبها)
  - data_engine.db (بيشيل writes كتير من الـ scrapers — bonus)

الجدولة:
  بتشتغل كل ساعة عن طريق الـ `scheduler_manager` (Phase 3 Task 1).
  الـ job مسجّل باسم `wal_checkpoint_hourly`.

الـ backward compatibility:
  - ما بفتحش connections جديدة لو الـ DB مش موجود (بيـ skip).
  - ما بيرفعش exception لو check واحد فشل (بيكمّل الباقي).
  - بيرجّع dict فيه summary للـ /api/health.

Author: دليل الاستثمار (Phase 4 — Resilience & Observability)
"""

from __future__ import annotations

import logging
import os
import sqlite3
import threading
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# مسارات الـ DBs — reuse من utils/db_paths.py أو db_manager
# ---------------------------------------------------------------------------
try:
    import sys as _sys
    _VPS_DIR = str(Path(__file__).resolve().parent.parent)
    if _VPS_DIR not in _sys.path:
        _sys.path.insert(0, _VPS_DIR)
    from core.db_manager import _resolve_db_name  # type: ignore
    _HAS_DB_MANAGER = True
except ImportError:
    _HAS_DB_MANAGER = False
    # Fallback: مسارات مباشرة
    _PROJECT_ROOT = Path(__file__).resolve().parents[2]
    _DB_DIR = _PROJECT_ROOT / 'db'

    def _resolve_db_name(name: str) -> str:  # type: ignore[no-redef]
        key = name.lower().strip()
        if key.endswith('.db'):
            key = key[:-3]
        return str(_DB_DIR / f"{key}.db")


# ---------------------------------------------------------------------------
# الـ DBs اللي بنـ checkpoint عليها (الـ 3 الأساسية + data_engine)
# ---------------------------------------------------------------------------
_TARGET_DBS: List[str] = [
    'stocks',
    'predictions',
    'price_history',
    'data_engine',
]

# ---------------------------------------------------------------------------
# Lock عشان نمنع overlap لو الـ job اتـ trigger مرتين في نفس الوقت
# (defense-in-depth — الـ scheduler_manager بيعمل max_instances=1 بس إحنا كمان)
# ---------------------------------------------------------------------------
_checkpoint_lock = threading.Lock()

# ---------------------------------------------------------------------------
# آخر تشغيل (للـ /api/health)
# ---------------------------------------------------------------------------
_last_run: Optional[Dict[str, Any]] = None


def _checkpoint_one_db(db_name: str) -> Dict[str, Any]:
    """اعمل wal_checkpoint(TRUNCATE) + optimize على DB واحد.

    بيرجّع dict فيه: {db, ok, wal_before_mb, wal_after_mb, duration_ms, error}
    """
    result: Dict[str, Any] = {
        'db': db_name,
        'ok': False,
        'wal_before_mb': None,
        'wal_after_mb': None,
        'duration_ms': 0.0,
        'error': None,
    }
    start = time.time()

    try:
        db_path = _resolve_db_name(db_name)
        if not os.path.exists(db_path):
            result['error'] = f'DB file not found: {db_path}'
            return result

        wal_path = db_path + '-wal'

        # WAL size before
        if os.path.exists(wal_path):
            result['wal_before_mb'] = round(
                os.path.getsize(wal_path) / (1024 * 1024), 3
            )
        else:
            result['wal_before_mb'] = 0.0

        # افتح writable connection (الـ TRUNCATE لازم write access)
        conn = sqlite3.connect(db_path, timeout=30.0)
        try:
            # ضمانات الـ WAL mode
            try:
                conn.execute('PRAGMA journal_mode=WAL')
                conn.execute('PRAGMA busy_timeout=30000')
                conn.execute('PRAGMA synchronous=NORMAL')
            except Exception:
                pass  # non-fatal

            # 1) wal_checkpoint(TRUNCATE) — merge WAL into main DB + truncate WAL
            checkpoint_result = conn.execute(
                'PRAGMA wal_checkpoint(TRUNCATE)'
            ).fetchone()
            # result = (busy, log, checkpointed)
            # busy=0 → success, busy=1 → couldn't acquire lock
            busy = checkpoint_result[0] if checkpoint_result else 1
            if busy != 0:
                result['error'] = (
                    f'wal_checkpoint busy (could not acquire lock): {checkpoint_result}'
                )
                # Don't return — still try optimize

            # 2) PRAGMA optimize — update sqlite_stat1 for query planner
            try:
                conn.execute('PRAGMA optimize')
            except Exception as opt_err:
                # optimize is non-critical — log but don't fail
                logger.debug(
                    "[WALCheckpoint] PRAGMA optimize failed for %s: %s",
                    db_name, opt_err,
                )

            result['ok'] = (busy == 0)
        finally:
            try:
                conn.close()
            except Exception:
                pass

        # WAL size after (may take a moment to reflect truncation)
        time.sleep(0.05)
        if os.path.exists(wal_path):
            result['wal_after_mb'] = round(
                os.path.getsize(wal_path) / (1024 * 1024), 3
            )
        else:
            result['wal_after_mb'] = 0.0

    except Exception as e:
        result['error'] = str(e)[:300]
        logger.error("[WALCheckpoint] Failed for %s: %s", db_name, e)

    result['duration_ms'] = round((time.time() - start) * 1000, 1)
    return result


def run_wal_checkpoint() -> Dict[str, Any]:
    """اعمل wal_checkpoint(TRUNCATE) + optimize على كل الـ DBs الأساسية.

    بتشتغل كل ساعة عن طريق الـ scheduler_manager. Thread-safe (lock).
    ما بترفعش exception — لو check واحد فشل، بيكمّل الباقي.

    Returns:
        Dict فيه:
          - timestamp: وقت التشغيل (ISO format).
          - total_dbs: عدد الـ DBs اللي اتـ check-ponit عليها.
          - success_count: عدد اللي نجحوا.
          - failure_count: عدد اللي فشلوا.
          - total_duration_ms: إجمالي الوقت.
          - results: list of per-DB results.
          - total_wal_freed_mb: إجمالي الـ WAL اللي اترفع.
    """
    global _last_run

    # Acquire lock — prevent overlap
    if not _checkpoint_lock.acquire(blocking=False):
        logger.info(
            "[WALCheckpoint] Skipped — previous run still in progress"
        )
        return {
            'skipped': True,
            'reason': 'previous run still in progress',
            'timestamp': datetime.now(timezone.utc).isoformat().replace('+00:00', 'Z'),
        }

    start = time.time()
    timestamp = datetime.now(timezone.utc).isoformat().replace('+00:00', 'Z')
    results: List[Dict[str, Any]] = []

    logger.info(
        "[WALCheckpoint] Starting hourly WAL checkpoint on %d DBs: %s",
        len(_TARGET_DBS), ', '.join(_TARGET_DBS),
    )

    try:
        for db_name in _TARGET_DBS:
            try:
                res = _checkpoint_one_db(db_name)
                results.append(res)
                status = '✅' if res['ok'] else '⚠️'
                logger.info(
                    "[WALCheckpoint] %s %s — wal %.2f→%.2f MB in %sms "
                    "(err: %s)",
                    status,
                    db_name,
                    res.get('wal_before_mb', 0) or 0,
                    res.get('wal_after_mb', 0) or 0,
                    res.get('duration_ms', 0),
                    res.get('error') or 'none',
                )
            except Exception as e:
                results.append({
                    'db': db_name,
                    'ok': False,
                    'error': str(e)[:300],
                    'duration_ms': 0.0,
                })
                logger.error("[WALCheckpoint] %s crashed: %s", db_name, e)
    finally:
        _checkpoint_lock.release()

    success_count = sum(1 for r in results if r.get('ok'))
    failure_count = len(results) - success_count
    total_wal_freed = sum(
        max(0, (r.get('wal_before_mb', 0) or 0) - (r.get('wal_after_mb', 0) or 0))
        for r in results
    )
    total_duration = round((time.time() - start) * 1000, 1)

    summary = {
        'timestamp': timestamp,
        'total_dbs': len(results),
        'success_count': success_count,
        'failure_count': failure_count,
        'total_duration_ms': total_duration,
        'total_wal_freed_mb': round(total_wal_freed, 3),
        'results': results,
    }

    # Cache for /api/health
    _last_run = summary

    logger.info(
        "[WALCheckpoint] Done — %d/%d succeeded, freed %.2f MB WAL in %sms",
        success_count, len(results), total_wal_freed, total_duration,
    )

    return summary


def get_last_run_status() -> Optional[Dict[str, Any]]:
    """ارجع آخر نتيجة تشغيل (للـ /api/health)."""
    return _last_run


# ---------------------------------------------------------------------------
# Self-test (python3 jobs/wal_checkpoint.py)
# ---------------------------------------------------------------------------

def _self_test() -> int:
    print("=" * 70)
    print("WAL Checkpoint self-test (Phase 4 Task 4)")
    print("=" * 70)

    print(f"\n[1] Target DBs: {_TARGET_DBS}")
    print(f"    Has db_manager: {_HAS_DB_MANAGER}")

    print("\n[2] Running checkpoint on all DBs...")
    result = run_wal_checkpoint()
    print(f"    timestamp: {result.get('timestamp')}")
    print(f"    total_dbs: {result.get('total_dbs')}")
    print(f"    success_count: {result.get('success_count')}")
    print(f"    failure_count: {result.get('failure_count')}")
    print(f"    total_duration_ms: {result.get('total_duration_ms')}")
    print(f"    total_wal_freed_mb: {result.get('total_wal_freed_mb')}")
    print("    Per-DB results:")
    for r in result.get('results', []):
        status = '✅' if r.get('ok') else '⚠️'
        print(f"      {status} {r['db']}: "
              f"wal {r.get('wal_before_mb', 0)}→{r.get('wal_after_mb', 0)} MB "
              f"in {r.get('duration_ms', 0)}ms")
        if r.get('error'):
            print(f"         error: {r['error']}")

    assert result['total_dbs'] == len(_TARGET_DBS), "should checkpoint all DBs"

    print("\n[3] get_last_run_status():")
    last = get_last_run_status()
    print(f"    has last run: {last is not None}")
    assert last is not None, "last run should be cached"

    print("\n[4] Running again (should be fast — WAL already truncated):")
    result2 = run_wal_checkpoint()
    print(f"    success_count: {result2.get('success_count')}")
    print(f"    total_duration_ms: {result2.get('total_duration_ms')}")

    print("\n" + "=" * 70)
    print("✅ WAL Checkpoint self-test passed.")
    print("=" * 70)
    return 0


if __name__ == '__main__':
    import sys
    logging.basicConfig(
        level=logging.INFO,
        format='%(asctime)s [%(levelname)s] %(name)s: %(message)s',
    )
    sys.exit(_self_test())
