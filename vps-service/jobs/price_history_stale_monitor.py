#!/usr/bin/env python3
"""
price_history_stale_monitor.py — مراقب جمود price_history.db
==============================================================

WHY
---
pm2 status = online بـ يقولك حاجة واحدة بس: العملية شغّالة.
بس الـ price_history.db ممكن يبقى متجمّد لأيام من غير ما حد يحس.
ده حصل بالظبط: MAX(date)=2026-07-30 لمدة 9 أيام و data-engine online.

الحل
----
مراقب بـ يشتغل كل ساعة (من market_scheduler) وبيقارن MAX(date) في
price_history.db بـ آخر يوم تداول متوقّع لـ EGX (Sun-Thu).

لو الفجوة > 1 يوم تداول → بـ يسجلّ [PRICE_HISTORY_STALE] WARNING.
لو الفجوة > 3 أيام تداول → بـ يسجلّ [PRICE_HISTORY_STALE] CRITICAL.

المراقب ده مش بيصلّح حاجة — بـ ينبّه بس. الـ safetynet هو اللي بيصلّح.

Usage (from market_scheduler):
    from jobs.price_history_stale_monitor import check_price_history_stale
    status = check_price_history_stale()

Author: P0 fix — price_history freeze
"""

import os
import logging
import sqlite3
from datetime import datetime, timedelta
from pathlib import Path
from typing import Dict, Any, Optional

logger = logging.getLogger(__name__)

_PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
PRICE_HISTORY_DB = str(_PROJECT_ROOT / 'db' / 'price_history.db')


def _cairo_now() -> datetime:
    """التوقيت المصري — مع fallback آمن لو pytz ناقص."""
    try:
        import pytz
        return datetime.now(pytz.timezone('Africa/Cairo'))
    except Exception:
        return datetime.utcnow() + timedelta(hours=2)


def _last_egx_trading_day(now: datetime) -> datetime.date:
    """
    آخر يوم تداول مكتمل لـ EGX (Sun-Thu، Fri/Sat إجازة).

    القواعد:
    - لو النهاردة يوم تداول AND السوق قفل (≥14:30 Cairo) → النهاردة.
    - لو النهاردة يوم تداول AND السوق لسه فاتح (10:00-14:30) → أمس آخر يوم تداول
      (لأن شمعة النهاردة لسه بتتكوّن ومش مكتملة).
    - لو النهاردة يوم تداول AND لسه قبل الفتح (<10:00) → أمس آخر يوم تداول.
    - لو النهاردة جمعة/سبت → آخر خميس.
    """
    cairo = now.replace(tzinfo=None) if hasattr(now, 'tzinfo') and now.tzinfo else now
    today = cairo.date()
    weekday = today.weekday()  # Mon=0 .. Sun=6 (Fri=4, Sat=5)

    is_trading_day = weekday not in (4, 5)  # Fri=4, Sat=5 → إجازة
    # EGX close = 14:30 Cairo. لو الساعة ≥ 14:30 → السوق قفل النهاردة
    market_closed_today = cairo.hour > 14 or (cairo.hour == 14 and cairo.minute >= 30)

    if is_trading_day and market_closed_today:
        # السوق قفل النهاردة → شمعة النهاردة مكتملة
        return today

    # غير كده → امشي لورا لحد ما تلاقي يوم تداول
    cursor = today - timedelta(days=1)
    while cursor.weekday() in (4, 5):  # skip Fri/Sat
        cursor -= timedelta(days=1)
    return cursor


def check_price_history_stale(
    ph_db: Optional[str] = None,
) -> Dict[str, Any]:
    """
    افحص جمود price_history.db.

    Returns:
        dict: {
            status: 'OK' | 'STALE' | 'CRITICAL' | 'ERROR',
            max_date: str | None,
            expected_latest: str,
            trading_days_behind: int,
            total_rows: int,
            message: str,
        }
    """
    ph_db = ph_db or PRICE_HISTORY_DB
    result = {
        'status': 'ERROR',
        'max_date': None,
        'expected_latest': None,
        'trading_days_behind': 0,
        'total_rows': 0,
        'message': '',
    }

    if not os.path.exists(ph_db):
        result['message'] = f'price_history.db not found: {ph_db}'
        logger.critical(f"[PRICE_HISTORY_STALE] {result['message']}")
        return result

    try:
        # B2.2: migrated from raw sqlite3.connect → db_manager
        from core.db_manager import db_manager
        row = db_manager.query_one('price_history',
            "SELECT MAX(date) as max_date, COUNT(*) as total_rows FROM price_history"
        )

        if not row or not row.get('max_date'):
            result['message'] = 'price_history table empty or missing'
            logger.critical(f"[PRICE_HISTORY_STALE] {result['message']}")
            return result

        max_date_str = str(row['max_date'])[:10]
        total_rows = row['total_rows']
        result['max_date'] = max_date_str
        result['total_rows'] = total_rows

        max_date = datetime.strptime(max_date_str, '%Y-%m-%d').date()
        now = _cairo_now()
        expected = _last_egx_trading_day(now)
        result['expected_latest'] = expected.strftime('%Y-%m-%d')

        # احسب أيام التداول الفعلية بين max_date و expected
        # (امشي يوم بيوم، تخطّى Fri/Sat)
        trading_days_behind = 0
        cursor = max_date + timedelta(days=1)
        while cursor <= expected:
            if cursor.weekday() not in (4, 5):  # not Fri/Sat
                trading_days_behind += 1
            cursor += timedelta(days=1)
        result['trading_days_behind'] = trading_days_behind

        if trading_days_behind == 0:
            result['status'] = 'OK'
            result['message'] = (
                f"price_history up to date (MAX={max_date_str}, "
                f"expected={result['expected_latest']}, rows={total_rows})"
            )
            logger.info(f"[PRICE_HISTORY_STALE] OK: {result['message']}")
        elif trading_days_behind <= 1:
            result['status'] = 'STALE'
            result['message'] = (
                f"price_history STALE: MAX={max_date_str} but expected "
                f"{result['expected_latest']} ({trading_days_behind} trading day behind, "
                f"rows={total_rows})"
            )
            logger.warning(f"[PRICE_HISTORY_STALE] {result['message']}")
        else:
            result['status'] = 'CRITICAL'
            result['message'] = (
                f"price_history CRITICAL: MAX={max_date_str} but expected "
                f"{result['expected_latest']} ({trading_days_behind} trading days behind, "
                f"rows={total_rows}) — safetynet likely failed"
            )
            logger.critical(f"[PRICE_HISTORY_STALE] {result['message']}")

    except Exception as e:
        result['message'] = f'Monitor error: {e}'
        logger.critical(f"[PRICE_HISTORY_STALE] {result['message']}")

    return result


if __name__ == '__main__':
    import json
    logging.basicConfig(
        level=logging.INFO,
        format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    )
    print(json.dumps(check_price_history_stale(), indent=2, ensure_ascii=False))
