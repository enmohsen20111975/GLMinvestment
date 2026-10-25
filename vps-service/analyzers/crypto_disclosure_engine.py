#!/usr/bin/env python3
"""
Crypto Disclosure Engine — محرك أحداث العملات الرقمية
========================================================
تطبيق القاعدة 36 (DISCLOSURE-ENGINE) على الكريبتو.

الفرق عن الأسهم:
  - مفيش إفصاحات رسمية بـ المعنى التقليدي
  - بـ نعتمد على: on-chain events + project announcements + exchange listings
  - الأحداث: mainnet upgrade, fork, token unlock, delisting, hack, partnership

الـ 10 أنواع أحداث:
  - VETO (-2): hack, exploit, delisting, SEC lawsuit, bankrupt
  - REDUCE (-1): token unlock, whale dump, large liquidation
  - NEUTRAL (0): scheduled upgrade, governance vote
  - BOOST (+1): partnership, integration, new listing
  - BOOST_STRONG (+2): ETF approval, institutional adoption, major upgrade

التكامل في V40.2:
  - V40_2_CRYPTO_DISCLOSURE_IMPACT=1 (default OFF)

Author: Z.ai Code
Date: 2026-09-01
"""

from __future__ import annotations
import os
import re
import json
import sqlite3
import urllib.request
import logging
from pathlib import Path
from datetime import datetime, timedelta
from typing import Dict, Any, List, Optional, Tuple

PROJECT_ROOT = Path(__file__).resolve().parents[2]
DB_PATH = PROJECT_ROOT / 'db' / 'crypto_disclosures.db'

logger = logging.getLogger(__name__)


# ═══════════════════════════════════════════════════════════════════════
# 1. Event Types + Impact Scores (Crypto-calibrated)
# ═══════════════════════════════════════════════════════════════════════

CRYPTO_EVENT_TYPES: Dict[str, Dict[str, Any]] = {
    'HACK_EXPLOIT': {
        'score': -2, 'verdict': 'VETO',
        'reason_ar': 'اختراق/استغلال — خسائر فادحة (ممنوع الدخول)',
        'keywords': ['hack', 'exploit', 'breach', 'drained', 'stolen', ' vulnerability',
                     'smart contract bug', 'flash loan attack', 'rug pull'],
    },
    'DELISTING': {
        'score': -2, 'verdict': 'VETO',
        'reason_ar': 'شطب من بورصة — خسارة سيولة',
        'keywords': ['delisting', 'delist', 'removed from exchange', 'trading halted',
                     'suspended', 'withdrawal paused'],
    },
    'SEC_LAWSUIT': {
        'score': -2, 'verdict': 'VETO',
        'reason_ar': 'دعوى SEC — خطر قانوني',
        'keywords': ['sec lawsuit', 'sec charges', 'securities violation', 'regulatory action',
                     'enforcement', 'subpoena', 'sec investigation'],
    },
    'TOKEN_UNLOCK': {
        'score': -1, 'verdict': 'REDUCE',
        'reason_ar': 'فتح أ tokens — ضغط بيع متوقع',
        'keywords': ['token unlock', 'vesting', 'unlock schedule', 'token release',
                     'cliff unlock', 'team tokens unlock'],
    },
    'WHALE_DUMP': {
        'score': -1, 'verdict': 'REDUCE',
        'reason_ar': 'حوت بـ يبيع — ضغط بيع',
        'keywords': ['whale dump', 'whale sell', 'large transfer', 'whale moved',
                     'exchange inflow', 'big sell order'],
    },
    'LIQUIDATION': {
        'score': -1, 'verdict': 'REDUCE',
        'reason_ar': 'تصفية مراكز كبيرة — تقلب عنيف',
        'keywords': ['liquidation', 'long squeeze', 'short squeeze', 'margin call',
                     'forced liquidation', 'cascade'],
    },
    'NETWORK_UPGRADE': {
        'score': 0, 'verdict': 'NEUTRAL',
        'reason_ar': 'ترقية شبكة — محايد (لازم تحليل التفاصيل)',
        'keywords': ['upgrade', 'fork', 'mainnet', 'hard fork', 'soft fork',
                     'network update', 'protocol upgrade', 'v2', 'migration'],
    },
    'PARTNERSHIP': {
        'score': +1, 'verdict': 'BOOST',
        'reason_ar': 'شراكة — توسع',
        'keywords': ['partnership', 'collaboration', 'integration', 'adoption',
                     'strategic alliance', 'joint venture'],
    },
    'NEW_LISTING': {
        'score': +1, 'verdict': 'BOOST',
        'reason_ar': 'إدراج جديد في بورصة — سيولة أعلى',
        'keywords': ['listing', 'new listing', 'added to exchange', 'now trading on',
                     'available on', 'launches on'],
    },
    'ETF_APPROVAL': {
        'score': +2, 'verdict': 'BOOST_STRONG',
        'reason_ar': 'موافقة ETF — تدفق مؤسسي',
        'keywords': ['etf approval', 'etf approved', 'spot etf', 'institutional adoption',
                     'etf launch', 'fund approval'],
    },
}

VETO_THRESHOLD = -2
FREEZE_THRESHOLD = -1


# ═══════════════════════════════════════════════════════════════════════
# 2. Classification
# ═══════════════════════════════════════════════════════════════════════

def _normalize_text(text: str) -> str:
    if not text:
        return ''
    return text.lower()


def classify_crypto_event(title: str, content: str = '') -> Optional[Dict[str, Any]]:
    """
    تصنيف حدث كريبتو بالكلمات المفتاحية.

    Returns:
        {event_type, score, verdict, reason_ar, matched_keywords} or None
    """
    if not title:
        return None

    text = _normalize_text(f"{title} {content}")

    best_match = None
    best_score_abs = 0

    for event_type, config in CRYPTO_EVENT_TYPES.items():
        matched = []
        for kw in config.get('keywords', []):
            kw_norm = _normalize_text(kw)
            if kw_norm and kw_norm in text:
                matched.append(kw)

        if matched:
            score_abs = abs(config['score'])
            # VETO has highest priority
            if config['score'] <= VETO_THRESHOLD:
                return {
                    'event_type': event_type,
                    'score': config['score'],
                    'verdict': config['verdict'],
                    'reason_ar': config['reason_ar'],
                    'matched_keywords': matched[:3],
                }
            if best_match is None or score_abs > best_score_abs:
                best_score_abs = score_abs
                best_match = {
                    'event_type': event_type,
                    'score': config['score'],
                    'verdict': config['verdict'],
                    'reason_ar': config['reason_ar'],
                    'matched_keywords': matched[:3],
                }

    return best_match


# ═══════════════════════════════════════════════════════════════════════
# 3. Database Storage
# ═══════════════════════════════════════════════════════════════════════

def _ensure_db():
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    # Phase 7.1: migrated to db_manager (writable=True)
    from core.db_manager import db_manager
    conn = db_manager.get_connection(str(DB_PATH), writable=True)
    conn.execute('''
        CREATE TABLE IF NOT EXISTS crypto_disclosures (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            symbol TEXT NOT NULL,
            event_type TEXT NOT NULL,
            impact_score INTEGER NOT NULL,
            verdict TEXT NOT NULL,
            title TEXT,
            summary TEXT,
            source TEXT,
            source_url TEXT,
            published_at TEXT NOT NULL,
            fetched_at TEXT NOT NULL,
            matched_keywords TEXT,
            processed INTEGER DEFAULT 0,
            UNIQUE(symbol, event_type, published_at, title)
        )
    ''')
    conn.execute('''
        CREATE INDEX IF NOT EXISTS idx_crypto_disc_symbol_date
        ON crypto_disclosures(symbol, published_at DESC)
    ''')
    conn.commit()
    conn.close()


def store_crypto_disclosure(disclosure: Dict[str, Any]) -> bool:
    """تخزين حدث كريبتو في DB (dedup)."""
    _ensure_db()
    try:
        # Phase 7.1: migrated to db_manager (writable=True)
        from core.db_manager import db_manager
        conn = db_manager.get_connection(str(DB_PATH), writable=True)
        now = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
        conn.execute('''
            INSERT OR IGNORE INTO crypto_disclosures
            (symbol, event_type, impact_score, verdict, title, summary,
             source, source_url, published_at, fetched_at, matched_keywords, processed)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
        ''', (
            disclosure.get('symbol', '').upper(),
            disclosure.get('event_type', 'UNKNOWN'),
            disclosure.get('impact_score', 0),
            disclosure.get('verdict', 'NEUTRAL'),
            disclosure.get('title', '')[:500],
            disclosure.get('summary', '')[:1000],
            disclosure.get('source', 'CRYPTO'),
            disclosure.get('source_url', ''),
            disclosure.get('published_at', now),
            now,
            json.dumps(disclosure.get('matched_keywords', [])),
        ))
        inserted = conn.total_changes > 0
        conn.commit()
        conn.close()
        return bool(inserted)
    except Exception as e:
        logger.error(f"store_crypto_disclosure failed: {e}")
        return False


def get_latest_crypto_disclosure_impact(symbol: str, hours_back: int = 48) -> Dict[str, Any]:
    """
    جيب تأثير آخر حدث لعملة في آخر N ساعة.

    للـ V40.2 integration:
      - VETO (hack/delisting/SEC) → تجميد
      - REDUCE (unlock/whale dump) → وقف طوارئ
      - BOOST (partnership/listing) → دفعة
    """
    _ensure_db()
    try:
        # Phase 7.1: migrated to db_manager (writable=False)
        from core.db_manager import db_manager
        conn = db_manager.get_connection(str(DB_PATH), writable=False)
        cutoff = (datetime.now() - timedelta(hours=hours_back)).strftime('%Y-%m-%d %H:%M')
        row = conn.execute('''
            SELECT symbol, event_type, impact_score, verdict, title, published_at
            FROM crypto_disclosures
            WHERE symbol = ? AND published_at >= ?
            ORDER BY published_at DESC, ABS(impact_score) DESC
            LIMIT 1
        ''', (symbol.upper(), cutoff)).fetchone()
        conn.close()

        if not row:
            return {
                'has_disclosure': False, 'impact_score': 0,
                'verdict': 'NEUTRAL', 'event_type': None,
                'reason_ar': 'لا يوجد حدث حديث', 'published_at': None,
            }

        event_type = row[1]
        config = CRYPTO_EVENT_TYPES.get(event_type, {})
        return {
            'has_disclosure': True,
            'impact_score': row[2],
            'verdict': row[3],
            'event_type': event_type,
            'reason_ar': config.get('reason_ar', 'حدث كريبتو'),
            'title': row[4],
            'published_at': row[5],
        }
    except Exception as e:
        logger.error(f"get_latest_crypto_disclosure_impact failed: {e}")
        return {
            'has_disclosure': False, 'impact_score': 0,
            'verdict': 'NEUTRAL', 'event_type': None,
            'reason_ar': 'خطأ في فحص الأحداث', 'published_at': None,
        }


# ═══════════════════════════════════════════════════════════════════════
# 4. Manual Injection (for testing)
# ═══════════════════════════════════════════════════════════════════════

def inject_crypto_disclosure(symbol: str, title: str, event_time: str,
                               source: str = 'MANUAL') -> Optional[Dict[str, Any]]:
    """حقن حدث يدوياً (للاختبار)."""
    classified = classify_crypto_event(title)
    if not classified:
        return None

    disclosure = {
        'symbol': symbol.upper(),
        'event_type': classified['event_type'],
        'impact_score': classified['score'],
        'verdict': classified['verdict'],
        'title': title,
        'summary': classified['reason_ar'],
        'source': source,
        'source_url': '',
        'published_at': event_time,
        'matched_keywords': classified['matched_keywords'],
    }
    store_crypto_disclosure(disclosure)
    return disclosure


# ═══════════════════════════════════════════════════════════════════════
# 5. V40.2 Integration Helper
# ═══════════════════════════════════════════════════════════════════════

def get_crypto_disclosure_impact_for_symbol(symbol: str) -> Dict[str, Any]:
    """
    جيب تأثير الحدث لعملة (للـ V40.2 integration).
    """
    result = get_latest_crypto_disclosure_impact(symbol, hours_back=48)
    score = result['impact_score']
    verdict = result['verdict']

    if verdict == 'VETO':
        proof = f"🚨 CRYPTO EVENT ({result['event_type']}): {result['reason_ar']} — تجميد"
    elif score < 0:
        proof = f"⚠️ CRYPTO EVENT ({result['event_type']}): {result['reason_ar']} — وقف طوارئ"
    elif score > 0:
        proof = f"📈 CRYPTO EVENT ({result['event_type']}): {result['reason_ar']} — دفعة +{score}"
    else:
        proof = f"ℹ️ CRYPTO EVENT ({result['event_type']}): {result['reason_ar']}"

    result['proof_string'] = proof
    return result


# ═══════════════════════════════════════════════════════════════════════
# 6. Self-test
# ═══════════════════════════════════════════════════════════════════════

if __name__ == '__main__':
    print("🧪 Crypto Disclosure Engine — Self Test")
    print("=" * 70)
    print(f"Event types: {len(CRYPTO_EVENT_TYPES)}")
    print()

    # Test 1: Hack (VETO)
    print("=== Test 1: اختراق (VETO) ===")
    r = classify_crypto_event("Major hack drains $50M from DeFi protocol")
    print(f"  Event: {r['event_type']} | Score: {r['score']:+d} | Verdict: {r['verdict']}")
    assert r['event_type'] == 'HACK_EXPLOIT' and r['score'] == -2
    print("  ✅ PASS")

    # Test 2: Delisting (VETO)
    print("\n=== Test 2: شطب (VETO) ===")
    r = classify_crypto_event("Exchange delists XRP after SEC charges")
    print(f"  Event: {r['event_type']} | Score: {r['score']:+d}")
    assert r['score'] == -2 and r['verdict'] == 'VETO'
    print("  ✅ PASS")

    # Test 3: ETF approval (BOOST_STRONG)
    print("\n=== Test 3: موافقة ETF (BOOST_STRONG) ===")
    r = classify_crypto_event("SEC approves Bitcoin spot ETF")
    print(f"  Event: {r['event_type']} | Score: {r['score']:+d}")
    assert r['score'] == +2
    print("  ✅ PASS")

    # Test 4: Token unlock (REDUCE)
    print("\n=== Test 4: فتح tokens (REDUCE) ===")
    r = classify_crypto_event("Major token unlock scheduled next week")
    print(f"  Event: {r['event_type']} | Score: {r['score']:+d}")
    assert r['score'] == -1
    print("  ✅ PASS")

    # Test 5: Partnership (BOOST)
    print("\n=== Test 5: شراكة (BOOST) ===")
    r = classify_crypto_event("Chainlink announces partnership with major bank")
    print(f"  Event: {r['event_type']} | Score: {r['score']:+d}")
    assert r['score'] == +1
    print("  ✅ PASS")

    # Test 6: Network upgrade (NEUTRAL)
    print("\n=== Test 6: ترقية شبكة (NEUTRAL) ===")
    r = classify_crypto_event("Ethereum mainnet upgrade scheduled")
    print(f"  Event: {r['event_type']} | Score: {r['score']:+d}")
    assert r['score'] == 0
    print("  ✅ PASS")

    # Test 7: Storage + retrieval
    print("\n=== Test 7: تخزين + استرجاع ===")
    _ensure_db()  # ensure table exists first
    import sqlite3 as _sql
    _c = _sql.connect(str(DB_PATH))
    _c.execute("DELETE FROM crypto_disclosures WHERE symbol = 'TESTCOIN'")
    _c.commit()
    _c.close()
    test_disc = inject_crypto_disclosure('TESTCOIN', 'hack drains protocol funds', '2026-09-01 12:00')
    print(f"  Injected: {test_disc['event_type']} score={test_disc['impact_score']}")
    impact = get_latest_crypto_disclosure_impact('TESTCOIN', hours_back=48)
    print(f"  Retrieved: has={impact['has_disclosure']} score={impact['impact_score']}")
    assert impact['has_disclosure'] and impact['impact_score'] == -2
    print("  ✅ PASS")

    # Test 8: No event
    print("\n=== Test 8: عملة بدون أحداث ===")
    result = get_crypto_disclosure_impact_for_symbol('CLEANCOIN')
    print(f"  has_disclosure: {result['has_disclosure']} | Score: {result['impact_score']}")
    assert not result['has_disclosure']
    print("  ✅ PASS")

    print("\n" + "=" * 70)
    print("✅ Crypto Disclosure Engine ready (8/8 tests pass)")
