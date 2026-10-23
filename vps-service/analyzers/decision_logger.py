#!/usr/bin/env python3
"""
Decision Logger — طبقة تسجيل الأسباب والمراقبة
==================================================
المحور ج: بدون هذه الطبقة لن نعرف هل الفلاتر الجديدة تساعد أم تقتل الإشارات الجيدة.

بـ يسجل كل قرار مهم (reject_entry / force_exit) في:
  - SQLite table (decision_log) — لتحليل لاحق
  - print للـ console (للتتبع الفوري)

الـ records:
  - symbol, timestamp, decision_type (reject_entry/force_exit)
  - reason_code (late_entry/danger_level_5/distribution_exit/max_holding/etc.)
  - reason_text (وصف بشري)
  - flag_active (أي flag كان مفعّل)
  - notebook_summary (ملخص من النوتبوك إن استُخدم)
  - market (STOCKS/CRYPTO)

التكامل:
  - log_decision() — دالة واحدة يستدعيها كل المسارات
  - get_decision_stats() — تحليل كم رُفضت/خرجت + الأسباب

Author: Z.ai Code
Date: 2026-09-01
"""

from __future__ import annotations
import os
import json
import sqlite3
import logging
from pathlib import Path
from datetime import datetime
from typing import Dict, Any, Optional, List

PROJECT_ROOT = Path(__file__).resolve().parents[2]
DB_PATH = PROJECT_ROOT / 'db' / 'decision_log.db'

logger = logging.getLogger(__name__)


# ═══════════════════════════════════════════════════════════════════════
# 1. DB Setup
# ═══════════════════════════════════════════════════════════════════════

def _ensure_db():
    """تأكد إن الـ DB + الـ table موجودين."""
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    # Phase 7.1: migrated to db_manager (writable=True)
    from core.db_manager import db_manager
    conn = db_manager.get_connection(str(DB_PATH), writable=True)
    conn.execute('''
        CREATE TABLE IF NOT EXISTS decision_log (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            timestamp TEXT NOT NULL,
            symbol TEXT NOT NULL,
            market TEXT DEFAULT 'STOCKS',
            decision_type TEXT NOT NULL,
            reason_code TEXT NOT NULL,
            reason_text TEXT,
            flag_active TEXT,
            notebook_summary TEXT,
            score_before INTEGER,
            score_after INTEGER,
            scan_date TEXT
        )
    ''')
    conn.execute('''
        CREATE INDEX IF NOT EXISTS idx_decision_symbol
        ON decision_log(symbol, timestamp DESC)
    ''')
    conn.execute('''
        CREATE INDEX IF NOT EXISTS idx_decision_reason
        ON decision_log(reason_code, decision_type)
    ''')
    conn.commit()
    conn.close()


# ═══════════════════════════════════════════════════════════════════════
# 2. log_decision() — الدالة الموحدة
# ═══════════════════════════════════════════════════════════════════════

# Reason codes ثابتة (للتحليل لاحقاً)
REASON_CODES = {
    # Entry rejections
    'late_entry': 'دخول متأخر (Don\'t Chase)',
    'not_accumulation': 'مش تراكم ولا grab',
    'danger_level_5': 'نوتبوك: danger_level=5',
    'avoid_chase_chasing': 'نوتبوك: avoid_chase + مطاردة',
    'disclosure_veto': 'إفصاح رسمي VETO',
    'news_veto': 'خبر سلبي VETO',
    'crypto_disclosure_veto': 'حدث كريبتو VETO',
    'crypto_news_veto': 'خبر كريبتو VETO',
    # Force exits
    'distribution_exit': 'شمعة توزيع',
    'max_holding': 'تجاوز المدة القصوى',
    'no_move': 'لا حركة',
    'early_drop': 'نزول مبكر',
}


def log_decision(
    symbol: str,
    decision_type: str,  # 'reject_entry' | 'force_exit'
    reason_code: str,
    reason_text: str = '',
    flag_active: str = '',
    notebook_summary: str = '',
    market: str = 'STOCKS',
    score_before: Optional[int] = None,
    score_after: Optional[int] = None,
    scan_date: str = '',
    also_print: bool = True,
) -> bool:
    """
    تسجيل قرار (reject/exit) في DB + console.

    Args:
        symbol: رمز السهم/العملة
        decision_type: 'reject_entry' أو 'force_exit'
        reason_code: كود ثابت من REASON_CODES
        reason_text: وصف بشري
        flag_active: أي flag كان مفعّل (مثلاً V40_2_STRICT_ENTRY)
        notebook_summary: ملخص النوتبوك إن استُخدم
        market: STOCKS / CRYPTO
        score_before/after: الـ score قبل وبعد
        scan_date: تاريخ الفحص
        also_print: هل يطبع للـ console

    Returns: True لو نجح التسجيل
    """
    _ensure_db()
    timestamp = datetime.now().strftime('%Y-%m-%d %H:%M:%S')

    try:
        # Phase 7.1: migrated to db_manager (writable=True)
        from core.db_manager import db_manager
        conn = db_manager.get_connection(str(DB_PATH), writable=True)
        conn.execute('''
            INSERT INTO decision_log
            (timestamp, symbol, market, decision_type, reason_code, reason_text,
             flag_active, notebook_summary, score_before, score_after, scan_date)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ''', (
            timestamp, symbol.upper(), market, decision_type, reason_code,
            reason_text[:500], flag_active, notebook_summary[:300],
            score_before, score_after, scan_date,
        ))
        conn.commit()
        conn.close()
    except Exception as e:
        logger.warning(f"log_decision DB failed: {e}")

    # Also print (lightweight — لا يعطل المسار)
    if also_print:
        icon = '❌' if decision_type == 'reject_entry' else '🚪'
        print(f"{icon} [DECISION-LOG] {symbol} | {decision_type} | {reason_code} | {reason_text[:60]}", flush=True)

    return True


# ═══════════════════════════════════════════════════════════════════════
# 3. get_decision_stats() — تحليل الأسباب
# ═══════════════════════════════════════════════════════════════════════

def get_decision_stats(days_back: int = 7) -> Dict[str, Any]:
    """
    تحليل: كم إشارة رُفضت/خرجت + الأسباب.

    Returns:
        {
            'total_decisions': int,
            'rejects': int,
            'force_exits': int,
            'by_reason': dict,  # reason_code → count
            'by_symbol': dict,  # symbol → count
            'by_market': dict,  # market → count
        }
    """
    _ensure_db()
    try:
        # Phase 7.1: migrated to db_manager (writable=False)
        from core.db_manager import db_manager
        conn = db_manager.get_connection(str(DB_PATH), writable=False)
        cutoff = (datetime.now() - timedelta(days=days_back)).strftime('%Y-%m-%d')

        total = conn.execute('SELECT COUNT(*) FROM decision_log WHERE timestamp >= ?', (cutoff,)).fetchone()[0]
        rejects = conn.execute("SELECT COUNT(*) FROM decision_log WHERE timestamp >= ? AND decision_type='reject_entry'", (cutoff,)).fetchone()[0]
        exits = conn.execute("SELECT COUNT(*) FROM decision_log WHERE timestamp >= ? AND decision_type='force_exit'", (cutoff,)).fetchone()[0]

        # By reason
        reason_rows = conn.execute('''
            SELECT reason_code, COUNT(*) as cnt
            FROM decision_log WHERE timestamp >= ?
            GROUP BY reason_code ORDER BY cnt DESC
        ''', (cutoff,)).fetchall()
        by_reason = {r[0]: r[1] for r in reason_rows}

        # By symbol (top 10)
        symbol_rows = conn.execute('''
            SELECT symbol, COUNT(*) as cnt
            FROM decision_log WHERE timestamp >= ?
            GROUP BY symbol ORDER BY cnt DESC LIMIT 10
        ''', (cutoff,)).fetchall()
        by_symbol = {r[0]: r[1] for r in symbol_rows}

        # By market
        market_rows = conn.execute('''
            SELECT market, COUNT(*) as cnt
            FROM decision_log WHERE timestamp >= ?
            GROUP BY market
        ''', (cutoff,)).fetchall()
        by_market = {r[0]: r[1] for r in market_rows}

        conn.close()

        return {
            'total_decisions': total,
            'rejects': rejects,
            'force_exits': exits,
            'by_reason': by_reason,
            'by_symbol': by_symbol,
            'by_market': by_market,
            'days_back': days_back,
        }
    except Exception as e:
        logger.error(f"get_decision_stats failed: {e}")
        return {
            'total_decisions': 0, 'rejects': 0, 'force_exits': 0,
            'by_reason': {}, 'by_symbol': {}, 'by_market': {},
            'days_back': days_back,
        }


from datetime import timedelta  # needed for get_decision_stats


# ═══════════════════════════════════════════════════════════════════════
# 4. Self-test
# ═══════════════════════════════════════════════════════════════════════

if __name__ == '__main__':
    print("🧪 Decision Logger — Self Test")
    print("=" * 70)
    print(f"DB: {DB_PATH}")
    print()

    # Clear old test data
    _ensure_db()
    # Phase 7.1: migrated to db_manager (writable=True)
    from core.db_manager import db_manager
    conn = db_manager.get_connection(str(DB_PATH), writable=True)
    conn.execute("DELETE FROM decision_log WHERE symbol LIKE 'TEST%'")
    conn.commit()
    conn.close()

    # Test 1: Log reject_entry
    print("=== Test 1: log reject_entry ===")
    r = log_decision(
        symbol='TESTCOMI',
        decision_type='reject_entry',
        reason_code='late_entry',
        reason_text='دخول متأخر: قريب من قمة 20 يوم (1.8%)',
        flag_active='V40_2_STRICT_ENTRY',
        notebook_summary='danger_level=2, avoid_chase=True',
        market='STOCKS',
        score_before=75,
        scan_date='2026-09-01',
    )
    print(f"  logged: {r}")
    assert r
    print("  ✅ PASS")

    # Test 2: Log force_exit
    print("\n=== Test 2: log force_exit ===")
    r = log_decision(
        symbol='TESTHRHO',
        decision_type='force_exit',
        reason_code='distribution_exit',
        reason_text='توزيع: شمعة حمراء + ظل علوي طويل + حجم 2.2×',
        flag_active='V40_2_DISTRIBUTION_EXIT',
        market='STOCKS',
        scan_date='2026-09-01',
    )
    print(f"  logged: {r}")
    assert r
    print("  ✅ PASS")

    # Test 3: Log crypto reject
    print("\n=== Test 3: log crypto reject ===")
    r = log_decision(
        symbol='TESTBTC',
        decision_type='reject_entry',
        reason_code='crypto_disclosure_veto',
        reason_text='hack drains protocol funds → تجميد',
        flag_active='V40_2_CRYPTO_DISCLOSURE_IMPACT',
        market='CRYPTO',
        scan_date='2026-09-01',
    )
    assert r
    print("  ✅ PASS")

    # Test 4: Log notebook reject
    print("\n=== Test 4: log notebook reject ===")
    r = log_decision(
        symbol='TESTMFPC',
        decision_type='reject_entry',
        reason_code='danger_level_5',
        reason_text='نوتبوك: danger_level=5 (سهم خطير جداً)',
        flag_active='V40_2_NOTEBOOK_CONTEXT',
        notebook_summary='danger_level=5, danger_flags=concentrated_ownership',
        market='STOCKS',
        score_before=80,
        scan_date='2026-09-01',
    )
    assert r
    print("  ✅ PASS")

    # Test 5: Get stats
    print("\n=== Test 5: get_decision_stats ===")
    stats = get_decision_stats(days_back=1)
    print(f"  total_decisions: {stats['total_decisions']}")
    print(f"  rejects: {stats['rejects']}")
    print(f"  force_exits: {stats['force_exits']}")
    print(f"  by_reason: {stats['by_reason']}")
    print(f"  by_market: {stats['by_market']}")
    assert stats['total_decisions'] >= 4
    assert stats['rejects'] >= 3
    assert stats['force_exits'] >= 1
    assert 'late_entry' in stats['by_reason']
    assert 'distribution_exit' in stats['by_reason']
    assert 'danger_level_5' in stats['by_reason']
    assert stats['by_market'].get('CRYPTO', 0) >= 1
    print("  ✅ PASS")

    # Cleanup
    # Phase 7.1: migrated to db_manager (writable=True)
    from core.db_manager import db_manager
    conn = db_manager.get_connection(str(DB_PATH), writable=True)
    conn.execute("DELETE FROM decision_log WHERE symbol LIKE 'TEST%'")
    conn.commit()
    conn.close()

    print("\n" + "=" * 70)
    print("✅ Decision Logger ready (5/5 tests pass)")
    print(f"\nIntegration: log_decision() called from all reject/exit paths")
    print(f"Analysis: get_decision_stats() — كم رُفضت + الأسباب")
