"""
Nightly Quant Job — Daily 03:00 Cairo refresh of SMFI + Monte Carlo cache
=========================================================================
شغّال ليلي 03:00 بتوقيت القاهرة. بيمرّ على كل أسهم EGX النشطة، يشغّل
SMFI + Monte Carlo، ويخزّن النتائج في `quant_cache` table (في predictions.db).

النتيجة: طول الجلسة (10:00 - 14:30) الآلة بقتاخد القيم من الكاش فورًا بدل
ما تعيد حساب المعادلات الثقيلة لـ 270 سهم كل دقيقة.

هذا الملف بيُستدعى من:
    - `EgyptScheduler.add_daily_task(name='nightly_quant', func=run_nightly_quant_job, hour=3, minute=0)`
    - `MarketScheduler.tick()` في market_scheduler.py (backup path at 03:00 Cairo)
    - CLI: `python3 -m analyzers.nightly_quant_job`

Author: دليل الاستثمار — AGILE-PHASE2-035 (CPU Throttling)
"""

from __future__ import annotations

import logging
import os
import sqlite3
import sys
import time
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List

# Ensure vps-service is on sys.path so `from analyzers...` works even when run
# standalone (CLI) or from market_scheduler.py.
_VPS_DIR = Path(__file__).resolve().parent.parent
if str(_VPS_DIR) not in sys.path:
    sys.path.insert(0, str(_VPS_DIR))

logger = logging.getLogger(__name__)

_PROJECT_ROOT = _VPS_DIR.parent
_STOCKS_DB = str(_PROJECT_ROOT / 'db' / 'stocks.db')


def _get_cairo_now() -> datetime:
    """يرجع الوقت الحالي بتوقيت القاهرة (بدون tzinfo) أو النظام كـ fallback."""
    try:
        import pytz
        return datetime.now(pytz.timezone('Africa/Cairo')).replace(tzinfo=None)
    except Exception:
        return datetime.now()


def _load_active_egx_tickers() -> List[Dict[str, Any]]:
    """يقرأ كل أسهم EGX النشطة (current_price > 0) من stocks.db.

    Returns:
        List of dicts: [{'ticker': str, 'name': str, 'current_price': float}, ...]
        مرتّب حسب value_traded DESC (الأسهم الأكثر سيولة الأول).

    آمن: أي خطأ → return [].
    """
    if not Path(_STOCKS_DB).exists():
        logger.warning(f"[NightlyQuant] stocks.db not found at {_STOCKS_DB}")
        return []

    conn = None
    try:
        # Phase 7.1: migrated to db_manager (writable=False)
        from core.db_manager import db_manager
        conn = db_manager.connection(_STOCKS_DB, writable=False).__enter__()
        conn.row_factory = sqlite3.Row
        cur = conn.cursor()

        # تحقق إن جدول stocks موجود
        cur.execute(
            "SELECT name FROM sqlite_master WHERE type='table' AND name='stocks'"
        )
        if not cur.fetchone():
            logger.warning("[NightlyQuant] 'stocks' table not in stocks.db")
            return []

        # خذ الأعمدة المتاحة
        cur.execute("PRAGMA table_info(stocks)")
        col_names = {row[1] for row in cur.fetchall()}
        if 'ticker' not in col_names or 'current_price' not in col_names:
            logger.warning("[NightlyQuant] 'stocks' missing ticker/current_price columns")
            return []

        # بناء SELECT الديناميكي
        select_cols = ['ticker']
        if 'name' in col_names:
            select_cols.append('name')
        elif 'name_ar' in col_names:
            select_cols.append('name_ar as name')
        else:
            select_cols.append("'' as name")
        select_cols.append('current_price')
        if 'value_traded' in col_names:
            select_cols.append('value_traded')
        elif 'volume' in col_names:
            select_cols.append('volume as value_traded')
        else:
            select_cols.append('0 as value_traded')

        # فلتر EGX (لو عمود market موجود)
        where_market = ""
        if 'market' in col_names:
            where_market = ("AND (market = 'EGX' OR market = 'مصر' "
                            "OR market IS NULL OR market = '')")
        # فلتر is_active (لو موجود)
        where_active = ""
        if 'is_active' in col_names:
            where_active = "AND is_active = 1"
        # فلتر الأسهم الرقمية (السعودي) خارج
        where_ticker = "AND ticker NOT GLOB '[0-9]*'"

        order_col = 'value_traded' if 'value_traded' in col_names else 'current_price'

        sql = (
            f"SELECT {', '.join(select_cols)} FROM stocks "
            f"WHERE current_price IS NOT NULL AND current_price > 0 "
            f"{where_market} {where_active} {where_ticker} "
            f"ORDER BY {order_col} DESC"
        )
        cur.execute(sql)
        rows = cur.fetchall()
        return [dict(r) for r in rows]
    except Exception as e:
        logger.warning(f"[NightlyQuant] load tickers error: {e}")
        return []
    finally:
        if conn is not None:
            try:
                conn.close()
            except Exception:
                pass


def run_nightly_quant_job() -> Dict[str, Any]:
    """الوظيفة الليلية الرئيسية — تُشغّل SMFI + Monte Carlo لكل أسهم EGX.

    Returns:
        dict: {
            'success': bool,
            'processed': int,
            'failed': int,
            'duration_sec': float,
            'started_at': str,
            'finished_at': str,
        }

    آمن: أي خطأ داخلي بيتابتلع وبيُسجَّل — الدالة دايماً بتُرجع dict
    بدل ما ترمي استثناء (عشان الـ scheduler ما يكسرش).
    """
    started_at = _get_cairo_now()
    t0 = time.time()
    summary: Dict[str, Any] = {
        'success': True,
        'processed': 0,
        'failed': 0,
        'duration_sec': 0.0,
        'started_at': started_at.strftime('%Y-%m-%d %H:%M:%S'),
        'finished_at': '',
        'errors': [],
    }

    try:
        # استورد compute_and_cache_quant بشكل آمن
        try:
            from analyzers.quant_cache import compute_and_cache_quant
        except Exception as e:
            logger.error(f"[NightlyQuant] cannot import compute_and_cache_quant: {e}")
            summary['success'] = False
            summary['errors'].append(f"import error: {e}")
            summary['duration_sec'] = round(time.time() - t0, 2)
            summary['finished_at'] = _get_cairo_now().strftime('%Y-%m-%d %H:%M:%S')
            return summary

        tickers = _load_active_egx_tickers()
        if not tickers:
            logger.warning("[NightlyQuant] no active EGX tickers found — nothing to do")
            summary['duration_sec'] = round(time.time() - t0, 2)
            summary['finished_at'] = _get_cairo_now().strftime('%Y-%m-%d %H:%M:%S')
            return summary

        logger.info(
            f"[NightlyQuant] starting nightly quant refresh for {len(tickers)} tickers "
            f"at {started_at.strftime('%Y-%m-%d %H:%M:%S')} Cairo"
        )

        for i, stock in enumerate(tickers, 1):
            ticker = stock.get('ticker') or ''
            if not ticker:
                continue
            try:
                result = compute_and_cache_quant(ticker)
                if result is not None:
                    summary['processed'] += 1
                else:
                    summary['failed'] += 1
                if i % 25 == 0 or i == len(tickers):
                    logger.info(
                        f"[NightlyQuant] progress {i}/{len(tickers)} "
                        f"(ok={summary['processed']}, fail={summary['failed']})"
                    )
            except Exception as e:
                summary['failed'] += 1
                if len(summary['errors']) < 20:
                    summary['errors'].append(f"{ticker}: {e}")
                logger.debug(f"[NightlyQuant] {ticker} failed: {e}")

            # تنفّس بين الأسهم (CPU throttle) — 0.2 ثانية
            try:
                time.sleep(0.2)
            except Exception:
                pass

        summary['duration_sec'] = round(time.time() - t0, 2)
        summary['finished_at'] = _get_cairo_now().strftime('%Y-%m-%d %H:%M:%S')
        logger.info(
            f"[NightlyQuant] DONE — processed={summary['processed']}, "
            f"failed={summary['failed']}, duration={summary['duration_sec']}s"
        )
        return summary
    except Exception as e:
        logger.error(f"[NightlyQuant] fatal error: {e}", exc_info=True)
        summary['success'] = False
        summary['errors'].append(f"fatal: {e}")
        summary['duration_sec'] = round(time.time() - t0, 2)
        summary['finished_at'] = _get_cairo_now().strftime('%Y-%m-%d %H:%M:%S')
        return summary


# ════════════════════════════════════════════════════════════════════════════
# CLI entrypoint
# ════════════════════════════════════════════════════════════════════════════

if __name__ == '__main__':
    logging.basicConfig(
        level=logging.INFO,
        format='%(asctime)s [%(levelname)s] %(name)s: %(message)s',
    )
    print("=" * 60)
    print("Nightly Quant Job — manual run")
    print("=" * 60)
    result = run_nightly_quant_job()
    print()
    print("Result:")
    for k, v in result.items():
        print(f"  {k}: {v}")
