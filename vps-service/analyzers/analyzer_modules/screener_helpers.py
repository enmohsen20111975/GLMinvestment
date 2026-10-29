"""
screener_helpers.py — screener stale check + auto-fetch + tags (Phase 9.1)
==========================================================================

اتسحب من master_analyzer.py (lines 237-436).
بيوفر:
  - _check_screener_stale(): فحص قدم بيانات screener_lists
  - _trigger_screener_fetch_background(): تشغيل السكرابر في Thread خلفي
  - get_screener_tags(): قراءة تصنيفات السهم

Author: برافو (Phase 9.1 — Strangler Pattern V2)
"""
from __future__ import annotations

import sqlite3
import subprocess
import sys
import threading
import time
from datetime import datetime
from pathlib import Path
from typing import Any, Dict

from core.db_manager import db_manager

# Constants (imported from master_analyzer)
import os
_PROJECT_ROOT = Path(__file__).resolve().parents[3]
DATA_ENGINE_DB = str(_PROJECT_ROOT / 'db' / 'data_engine.db')
_SCREENER_SCRIPT = str(_PROJECT_ROOT / 'data_engine' / 'scrapers' / 'tradingview_screener_lists.py')
_SCREENER_FETCH_LOCK = threading.Lock()
_SCREENER_FETCH_COOLDOWN = 300  # 5 minutes
_SCREENER_LAST_FETCH_AT = 0.0

GOLD_LISTS = {'gold', 'strong_buy', 'breakout'}
TRAP_LISTS = {'trap', 'avoid', 'falling_knife'}


def _check_screener_stale() -> bool:
    """يتحقق من حالة جدول screener_lists.

    Returns:
        True لو الجدول فاضي أو آخر إدخال أقدم من 24 ساعة (يحتاج تحديث)
        False لو البيانات حديثة
    """
    try:
        if not Path(DATA_ENGINE_DB).exists():
            return True
        try:
            count_row = db_manager.query_one('data_engine', 'SELECT COUNT(*) as cnt FROM screener_lists')
            count = count_row['cnt'] if count_row else 0
            if count == 0:
                return True
            last_row = db_manager.query_one('data_engine', 'SELECT MAX(scraped_at) as last_ts FROM screener_lists')
            if not last_row or not last_row.get('last_ts'):
                return True
            last_ts = last_row['last_ts']
            last_dt = datetime.strptime(last_ts[:19], '%Y-%m-%d %H:%M:%S')
            now = datetime.now()
            diff_hours = (now - last_dt).total_seconds() / 3600.0
            return diff_hours > 24.0
        except Exception:
            # CATEGORY A fallback (safety) — direct DAL connection
            conn = db_manager.get_connection('data_engine', writable=False)
            cursor = conn.cursor()
            try:
                cursor.execute('SELECT COUNT(*) FROM screener_lists')
                count = cursor.fetchone()[0]
                if count == 0:
                    conn.close()
                    return True
                cursor.execute('SELECT MAX(scraped_at) FROM screener_lists')
                row = cursor.fetchone()
                if not row or not row[0]:
                    conn.close()
                    return True
                last_ts = row[0]
                last_dt = datetime.strptime(last_ts[:19], '%Y-%m-%d %H:%M:%S')
                now = datetime.now()
                diff_hours = (now - last_dt).total_seconds() / 3600.0
                conn.close()
                return diff_hours > 24.0
            except Exception:
                conn.close()
                return True
    except Exception:
        return False


def _trigger_screener_fetch_background():
    """يشغّل سكربت tradingview_screener_lists.py في Thread خلفي منفصل."""
    global _SCREENER_LAST_FETCH_AT
    now = time.time()
    if not _SCREENER_FETCH_LOCK.acquire(blocking=False):
        return
    try:
        if now - _SCREENER_LAST_FETCH_AT < _SCREENER_FETCH_COOLDOWN:
            return
        _SCREENER_LAST_FETCH_AT = now

        def _run():
            try:
                print(f"[AutoFetch] 🚀 تشغيل سكرابر القوائم في الخلفية ({_SCREENER_SCRIPT})")
                result = subprocess.run(
                    [sys.executable, _SCREENER_SCRIPT],
                    capture_output=True, text=True, timeout=180.0
                )
                lines = result.stdout.strip().split('\n')
                summary = [l for l in lines if '🎉' in l or '📋' in l or '⚠️' in l]
                print(f"[AutoFetch] ✅ سكرابر القوائم اكتمل! {summary[-1] if summary else 'انظر السجل'}")
                if result.returncode != 0:
                    print(f"[AutoFetch] ⚠️ السكرابر رجع كود {result.returncode}: {result.stderr[:200]}")
            except subprocess.TimeoutExpired:
                print(f"[AutoFetch] ⚠️ السكرابر أخذ أكثر من 3 دقائق — تم إلغاؤه")
            except Exception as e:
                print(f"[AutoFetch] ❌ خطأ في تشغيل السكرابر: {e}")

        thread = threading.Thread(target=_run, daemon=True, name='screener-auto-fetch')
        thread.start()
    finally:
        _SCREENER_FETCH_LOCK.release()


def get_screener_tags(ticker: str, market: str = '') -> Dict[str, Any]:
    """يقرأ تصنيف السهم من جدول screener_lists في data_engine.db.

    ⚡ Auto-Trigger: لو الجدول فاضي أو قديم (أكثر من 24 ساعة)، يشغّل
    سكربت tradingview_screener_lists.py تلقائياً في Thread خلفي ويستمر.

    Returns:
        {
            'tags': [category, ...],
            'list_types': {category: 'gold'|'trap'},
            'is_gold': bool,
            'is_trap': bool,
            'has_data': bool,
        }
    """
    result = {'tags': [], 'list_types': {}, 'is_gold': False,
              'is_trap': False, 'has_data': False}
    if not ticker:
        return result
    try:
        if not Path(DATA_ENGINE_DB).exists():
            return result
        try:
            from core.db_manager import db_manager
            if not db_manager.table_exists('data_engine', 'screener_lists'):
                _trigger_screener_fetch_background()
                return result
            last_row = db_manager.query_one('data_engine', 'SELECT MAX(scraped_at) as last_ts FROM screener_lists')
            if last_row and last_row.get('last_ts'):
                last_ts = last_row['last_ts'][:19]
                try:
                    last_dt = datetime.strptime(last_ts, '%Y-%m-%d %H:%M:%S')
                    diff_hours = (datetime.now() - last_dt).total_seconds() / 3600.0
                    if diff_hours > 24.0:
                        _trigger_screener_fetch_background()
                except Exception:
                    pass
            rows = db_manager.query('data_engine',
                "SELECT category, list_type FROM screener_lists WHERE ticker = ?",
                (ticker.upper(),))
            if not rows:
                rows = db_manager.query('data_engine',
                    "SELECT category, list_type FROM screener_lists WHERE LOWER(ticker) = LOWER(?)",
                    (ticker,))
            result['has_data'] = True
            for row in rows:
                cat = row.get('category', '')
                lt = row.get('list_type', '')
                if cat:
                    result['tags'].append(cat)
                    result['list_types'][cat] = lt
                    if lt == 'gold':
                        result['is_gold'] = True
                    elif lt == 'trap':
                        result['is_trap'] = True
            return result
        except Exception:
            pass
        from core.db_manager import db_manager
        conn = db_manager.get_connection(DATA_ENGINE_DB, writable=False)
        conn.row_factory = sqlite3.Row
        try:
            conn.execute('SELECT 1 FROM screener_lists LIMIT 1')
        except Exception:
            conn.close()
            _trigger_screener_fetch_background()
            return result
        try:
            cursor = conn.execute('SELECT MAX(scraped_at) FROM screener_lists')
            row = cursor.fetchone()
            if row and row[0]:
                last_ts = row[0][:19]
                last_dt = datetime.strptime(last_ts, '%Y-%m-%d %H:%M:%S')
                diff_hours = (datetime.now() - last_dt).total_seconds() / 3600.0
                if diff_hours > 24.0:
                    _trigger_screener_fetch_background()
        except Exception:
            pass
        result['has_data'] = True
        q = 'SELECT category, list_type FROM screener_lists WHERE symbol = ?'
        params = [ticker.upper()]
        if market:
            q += ' AND market = ?'
            params.append(market)
        rows = conn.execute(q, params).fetchall()
        conn.close()
        for r in rows:
            cat = r['category']
            result['tags'].append(cat)
            result['list_types'][cat] = r['list_type']
            if cat in GOLD_LISTS:
                result['is_gold'] = True
            if cat in TRAP_LISTS:
                result['is_trap'] = True
    except Exception as e:
        print(f"[MasterAnalyzer] screener_tags error for {ticker}: {e}")
    return result
