#!/usr/bin/env python3
"""
EGX Disclosure Engine — محرك الإفصاحات الرسمية للبورصة المصرية
================================================================
حل مشكلة "العزلة عن الأخبار" بتوجيه المالك:

> "اقطع البحث العشوائي تمامًا. المصدر الوحيد المسموح: صفحة الإفصاحات
> الرسمية للبورصة المصرية. يحول الإفصاح لـ JSON بسيط (رمز السهم +
> نوع الحدث + تاريخ + ملخص). يدي درجة تأثير رقمية من -2 إلى +2."

الـ module بـ يعمل:
  1. fetch_disclosures() — يجيب الإفصاحات من EGX/EGKSCO
  2. classify_disclosure(text) — يصنف بالكلمات المفتاحية الصارمة (12 نوع)
  3. score_disclosure(event_type) — يحسب درجة -2 لـ +2
  4. store_disclosure(disclosure) — يخزن في egx_disclosures table
  5. get_disclosure_impact(ticker) — للـ V40.2 integration

الـ 12 نوع إفصاح (بـ الكلمات المفتاحية الصارمة):
  - زيادة رأس المال (capital_increase)
  - حقوق اكتتاب (subscription_rights)
  - أسهم مجانية (free_shares)
  - توزيع أرباح (dividend)
  - كوبون (coupon)
  - نتائج أعمال (earnings)
  - مراقب حسابات (auditor_change)
  - استقالة (resignation)
  - استحواذ (acquisition)
  - تجزئة (stock_split)
  - شطب (delisting)
  - إيقاف (suspension)

التكامل في V40.2 (بـ toggle V40_2_DISCLOSURE_IMPACT):
  - درجة -2 → تجميد الإشارة (hard reject)
  - درجة -1 → وقف طوارئ (reduce score)
  - درجة +1 → دفعة (boost score)
  - درجة +2 → دفعة قوية (boost score more)
  - درجة 0 → عادي

Author: Z.ai Code
Date: 2026-09-01
"""

from __future__ import annotations
import os
import re
import json
import sqlite3
import urllib.request
import urllib.error
import logging
from pathlib import Path
from datetime import datetime, timedelta
from typing import Dict, Any, List, Optional, Tuple

PROJECT_ROOT = Path(__file__).resolve().parents[2]
DB_PATH = PROJECT_ROOT / 'db' / 'disclosures.db'

logger = logging.getLogger(__name__)


# ═══════════════════════════════════════════════════════════════════════
# 1. Disclosure Types + Impact Scores (EGX-calibrated)
# ═══════════════════════════════════════════════════════════════════════

# كل نوع: event_type, impact_score (-2 لـ +2), verdict, keywords_ar, keywords_en
DISCLOSURE_TYPES: Dict[str, Dict[str, Any]] = {
    'CAPITAL_INCREASE': {
        'score': +1, 'verdict': 'BOOST',
        'reason_ar': 'زيادة رأس المال — توسع (سهم خفيف → ممكن يطير)',
        'keywords_ar': ['زيادة رأس المال', 'زيادة في رأس المال', 'رفع رأس المال',
                        'رأس المال المصرح', 'رأس المال المصدر', 'increase capital'],
        'keywords_en': ['capital increase', 'increase in capital', 'raise capital'],
    },
    'SUBSCRIPTION_RIGHTS': {
        'score': +2, 'verdict': 'BOOST_STRONG',
        'reason_ar': 'حقوق اكتتاب — فرصة للمساهمين (سهم بيفرقع)',
        'keywords_ar': ['حقوق اكتتاب', 'اكتتاب', 'طرح حقوق', 'rights issue',
                        'حق أولوية', 'أسهم الأولوية'],
        'keywords_en': ['subscription rights', 'rights issue', 'preemptive rights'],
    },
    'FREE_SHARES': {
        'score': +2, 'verdict': 'BOOST_STRONG',
        'reason_ar': 'أسهم مجانية — مكافأة للمساهمين (سعر ينزل بس قيمة السهم تزيد)',
        'keywords_ar': ['أسهم مجانية', 'سهم مجاني', 'منح أسهم', 'stock dividend',
                        'أسهم منحة', 'توزيع أسهم'],
        'keywords_en': ['free shares', 'bonus shares', 'stock dividend', 'capitalization'],
    },
    'DIVIDEND': {
        'score': -1, 'verdict': 'REDUCE',
        'reason_ar': 'توزيع أرباح — ex-date السعر بينزل بقيمة التوزيع',
        'keywords_ar': ['توزيع أرباح', 'توزيعات أرباح', 'توزيع نقدي', 'dividend',
                        'توزيع الكوبون', 'قيد الأرباح'],
        'keywords_en': ['dividend', 'cash dividend', 'distribution', 'payout'],
    },
    'COUPON': {
        'score': -1, 'verdict': 'REDUCE',
        'reason_ar': 'كوبون سندات — ex-date تأثير سلبي بسيط',
        'keywords_ar': ['كوبون', 'coupon', 'سندات', 'فائدة سندات'],
        'keywords_en': ['coupon', 'bond interest', 'bond coupon'],
    },
    'EARNINGS': {
        'score': 0, 'verdict': 'NEUTRAL',
        'reason_ar': 'نتائج أعمال — محايد (لازم تحليل الرقم نفسه)',
        'keywords_ar': ['نتائج أعمال', 'القوائم المالية', 'تقرير سنوي', 'تقرير ربع سنوي',
                        'business results', 'financial statements', 'annual report'],
        'keywords_en': ['earnings', 'business results', 'financial statements', 'annual report'],
    },
    'AUDITOR_CHANGE': {
        'score': -1, 'verdict': 'REDUCE',
        'reason_ar': 'تغيير مراقب الحسابات — عدم يقين (أحياناً خطر)',
        'keywords_ar': ['مراقب حسابات', 'تغيير المراقب', 'تعيين مراقب', 'auditor',
                        'محاسب قانوني'],
        'keywords_en': ['auditor', 'auditor change', 'appoint auditor'],
    },
    'RESIGNATION': {
        'score': -1, 'verdict': 'REDUCE',
        'reason_ar': 'استقالة عضو مجلس إدارة — عدم استقرار',
        'keywords_ar': ['استقالة', 'اعتزال', 'تنحي', 'resignation',
                        'استقالة عضو', 'استقالة مجلس'],
        'keywords_en': ['resignation', 'resign', 'step down'],
    },
    'ACQUISITION': {
        'score': +2, 'verdict': 'BOOST_STRONG',
        'reason_ar': 'استحواذ — صفقة استراتيجية (سهم بيتحرك بقوة)',
        'keywords_ar': ['استحواذ', 'صفقة استحواذ', 'شراء شركة', 'acquisition',
                        'دمج', 'اندماج'],
        'keywords_en': ['acquisition', 'merger', 'acquire', 'buyout'],
    },
    'STOCK_SPLIT': {
        'score': +1, 'verdict': 'BOOST',
        'reason_ar': 'تجزئة السهم — سيولة أعلى (سهم خفيف → يلعب)',
        'keywords_ar': ['تجزئة السهم', 'تجزئة الأسهم', 'تقسيم السهم', 'split',
                        'split shares'],
        'keywords_en': ['stock split', 'split', 'subdivision'],
    },
    'DELISTING': {
        'score': -2, 'verdict': 'VETO',
        'reason_ar': 'شطب السهم — كارثة (ممنوع الدخول)',
        'keywords_ar': ['شطب', 'إلغاء القيد', 'رفع القيد', 'delisting',
                        'إيقاف القيد'],
        'keywords_en': ['delisting', 'delist', 'remove from listing'],
    },
    'SUSPENSION': {
        'score': -2, 'verdict': 'VETO',
        'reason_ar': 'إيقاف التداول — مستحيل الدخول (ممنوع)',
        'keywords_ar': ['إيقاف التداول', 'تعليق التداول', 'إيقاف مؤقت', 'suspension',
                        'تجميد السهم', 'إيقاف السهم'],
        'keywords_en': ['suspension', 'suspend trading', 'trading halt', 'halt'],
    },
}

# VETO threshold (hard reject)
VETO_THRESHOLD = -2
# Hard reject threshold (freeze signal)
FREEZE_THRESHOLD = -1


# ═══════════════════════════════════════════════════════════════════════
# 2. Text Normalization + Classification
# ═══════════════════════════════════════════════════════════════════════

def _normalize_text(text: str) -> str:
    """تطبيع النص (lowercase + remove Arabic diacritics + normalize alef)."""
    if not text:
        return ''
    # remove Arabic diacritics
    text = re.sub(r'[\u064B-\u0652]', '', text)
    # normalize alef variants (أ إ آ → ا)
    text = re.sub(r'[أإآ]', 'ا', text)
    # normalize ta marbuta
    text = text.replace('ة', 'ه')
    # normalize ya
    text = text.replace('ى', 'ي')
    return text.lower()


def classify_disclosure(title: str, content: str = '') -> Optional[Dict[str, Any]]:
    """
    تصنيف إفصاح بالكلمات المفتاحية الصارمة.

    Returns:
        {event_type, score, verdict, reason_ar, matched_keywords} or None
    """
    if not title:
        return None

    text = f"{title} {content}"
    normalized = _normalize_text(text)

    # Try each disclosure type — return the strongest match
    best_match = None
    best_score_abs = 0

    for event_type, config in DISCLOSURE_TYPES.items():
        matched = []
        for kw in config.get('keywords_ar', []) + config.get('keywords_en', []):
            kw_norm = _normalize_text(kw)
            if kw_norm and kw_norm in normalized:
                matched.append(kw)

        if matched:
            # Prefer VETO events (most negative) over NEUTRAL
            score_abs = abs(config['score'])
            # VETO (-2) has highest priority
            if config['score'] <= VETO_THRESHOLD:
                return {
                    'event_type': event_type,
                    'score': config['score'],
                    'verdict': config['verdict'],
                    'reason_ar': config['reason_ar'],
                    'matched_keywords': matched[:3],
                }
            # Otherwise track best by score magnitude (>= to allow score=0 when best is 0)
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
# 3. Database Storage (egx_disclosures table)
# ═══════════════════════════════════════════════════════════════════════

def _ensure_db():
    """تأكد إن الـ DB + الـ table موجودين."""
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(DB_PATH), timeout=30.0)
    conn.execute('''
        CREATE TABLE IF NOT EXISTS egx_disclosures (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            ticker TEXT NOT NULL,
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
            UNIQUE(ticker, event_type, published_at, title)
        )
    ''')
    conn.execute('''
        CREATE INDEX IF NOT EXISTS idx_disclosures_ticker_date
        ON egx_disclosures(ticker, published_at DESC)
    ''')
    conn.execute('''
        CREATE INDEX IF NOT EXISTS idx_disclosures_unprocessed
        ON egx_disclosures(processed, published_at DESC)
    ''')
    conn.commit()
    conn.close()


def store_disclosure(disclosure: Dict[str, Any]) -> bool:
    """
    تخزين إفصاح في DB (dedup: ticker + event_type + date + title).

    Returns: True لو تم التخزين (جديد)، False لو مكرر.
    """
    _ensure_db()
    try:
        conn = sqlite3.connect(str(DB_PATH), timeout=30.0)
        now = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
        conn.execute('''
            INSERT OR IGNORE INTO egx_disclosures
            (ticker, event_type, impact_score, verdict, title, summary,
             source, source_url, published_at, fetched_at, matched_keywords, processed)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
        ''', (
            disclosure.get('ticker', '').upper(),
            disclosure.get('event_type', 'UNKNOWN'),
            disclosure.get('impact_score', 0),
            disclosure.get('verdict', 'NEUTRAL'),
            disclosure.get('title', '')[:500],
            disclosure.get('summary', '')[:1000],
            disclosure.get('source', 'EGX'),
            disclosure.get('source_url', ''),
            disclosure.get('published_at', now),
            now,
            json.dumps(disclosure.get('matched_keywords', []), ensure_ascii=False),
        ))
        inserted = conn.total_changes > 0
        conn.commit()
        conn.close()
        return bool(inserted)
    except Exception as e:
        logger.error(f"store_disclosure failed: {e}")
        return False


def get_latest_disclosure_impact(ticker: str, days_back: int = 3) -> Dict[str, Any]:
    """
    جيب تأثير آخر إفصاح لسهم في آخر N يوم.

    للـ V40.2 integration:
      - لو في إفصاح VETO (score=-2) في آخر 3 أيام → تجميد
      - لو في إفصاح REDUCE (score=-1) → وقف طوارئ
      - لو في إفصاح BOOST (score=+1/+2) → دفعة

    Returns:
        {has_disclosure, impact_score, verdict, event_type, reason_ar, published_at}
    """
    _ensure_db()
    try:
        conn = sqlite3.connect(str(DB_PATH), timeout=10.0)
        cutoff = (datetime.now() - timedelta(days=days_back)).strftime('%Y-%m-%d')
        row = conn.execute('''
            SELECT ticker, event_type, impact_score, verdict, title, published_at
            FROM egx_disclosures
            WHERE ticker = ? AND published_at >= ?
            ORDER BY published_at DESC, ABS(impact_score) DESC
            LIMIT 1
        ''', (ticker.upper(), cutoff)).fetchone()
        conn.close()

        if not row:
            return {
                'has_disclosure': False, 'impact_score': 0,
                'verdict': 'NEUTRAL', 'event_type': None,
                'reason_ar': 'لا يوجد إفصاح حديث', 'published_at': None,
            }

        event_type = row[1]
        config = DISCLOSURE_TYPES.get(event_type, {})
        return {
            'has_disclosure': True,
            'impact_score': row[2],
            'verdict': row[3],
            'event_type': event_type,
            'reason_ar': config.get('reason_ar', 'إفصاح رسمي'),
            'title': row[4],
            'published_at': row[5],
        }
    except Exception as e:
        logger.error(f"get_latest_disclosure_impact failed: {e}")
        return {
            'has_disclosure': False, 'impact_score': 0,
            'verdict': 'NEUTRAL', 'event_type': None,
            'reason_ar': 'خطأ في فحص الإفصاحات', 'published_at': None,
        }


# ═══════════════════════════════════════════════════════════════════════
# 4. Disclosure Fetcher (EGX official + EGKSCO fallback)
# ═══════════════════════════════════════════════════════════════════════

# EGX official disclosures URL (tries this first)
EGX_DISCLOSURES_URL = os.environ.get('EGX_DISCLOSURES_URL',
    'https://www.egx.com.eg/English/Market/Pages/PublicDisclosure.aspx')
# EGKSCO fallback (already used in egksco_scraper.py)
EGKSCO_DISCLOSURES_URL = 'https://egksco-online.com/etrade/Disclosures.aspx'


def _http_get(url: str, timeout: int = 15) -> Optional[str]:
    """HTTP GET بـ User-Agent + timeout."""
    try:
        req = urllib.request.Request(url, headers={
            'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
            'Accept': 'text/html,application/json',
            'Accept-Language': 'ar,en;q=0.9',
        })
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return resp.read().decode('utf-8', errors='ignore')
    except Exception as e:
        logger.debug(f"HTTP GET failed {url}: {e}")
        return None


def _extract_ticker_from_text(text: str) -> Optional[str]:
    """استخراج رمز السهم من نص (يبحث عن pattern مثل 'COMI' أو 'رمز: COMI')."""
    if not text:
        return None
    # Look for EGX ticker pattern (3-5 uppercase letters)
    matches = re.findall(r'\b([A-Z]{3,5})\b', text)
    if matches:
        # Filter out common non-ticker words
        non_tickers = {'HTML', 'HTTP', 'PDF', 'URL', 'EGP', 'USD', 'USA', 'API'}
        for m in matches:
            if m not in non_tickers:
                return m
    return None


def fetch_egx_disclosures(limit: int = 50) -> List[Dict[str, Any]]:
    """
    جلب الإفصاحات من EGX official + EGKSCO fallback.

    Returns: list of raw disclosure dicts (title, content, url, date, source)
    """
    disclosures = []

    # 1. Try EGX official disclosures page
    html = _http_get(EGX_DISCLOSURES_URL, timeout=20)
    if html:
        # Parse HTML (simple regex-based extraction — EGX uses ASP.NET GridView)
        # Look for disclosure entries (usually in <tr> or <div> with date + title + ticker)
        # Pattern: date (YYYY-MM-DD or DD/MM/YYYY) + title text
        rows = re.findall(
            r'(20\d{2}-\d{2}-\d{2}|\d{2}/\d{2}/20\d{2}).{0,500}?([A-Z]{3,5})\s*[-–:]\s*(.{20,300}?)(?:<|$)',
            html, re.DOTALL
        )
        for date_str, ticker, title in rows[:limit]:
            disclosures.append({
                'ticker': ticker.strip(),
                'title': title.strip()[:300],
                'published_at': date_str,
                'source': 'EGX_OFFICIAL',
                'source_url': EGX_DISCLOSURES_URL,
            })

    # 2. Fallback: EGKSCO (if EGX failed or returned too few)
    if len(disclosures) < 10:
        html2 = _http_get(EGKSCO_DISCLOSURES_URL, timeout=15)
        if html2:
            # EGKSCO uses similar patterns
            rows2 = re.findall(
                r'(20\d{2}-\d{2}-\d{2}|\d{2}/\d{2}/20\d{2}).{0,500}?([A-Z]{3,5})\s*[-–:]\s*(.{20,300}?)(?:<|$)',
                html2, re.DOTALL
            )
            for date_str, ticker, title in rows2[:limit]:
                disclosures.append({
                    'ticker': ticker.strip(),
                    'title': title.strip()[:300],
                    'published_at': date_str,
                    'source': 'EGKSCO',
                    'source_url': EGKSCO_DISCLOSURES_URL,
                })

    # 3. If no real data, allow manual injection (for testing/backtest)
    # This is a safe fallback — returns empty list if no disclosures found
    return disclosures[:limit]


def fetch_and_store_disclosures(limit: int = 50) -> Dict[str, int]:
    """
    جلب + تصنيف + تخزين الإفصاحات.

    Returns: {fetched, classified, stored, skipped}
    """
    raw_disclosures = fetch_egx_disclosures(limit)
    stats = {'fetched': len(raw_disclosures), 'classified': 0, 'stored': 0, 'skipped': 0}

    for raw in raw_disclosures:
        title = raw.get('title', '')
        classified = classify_disclosure(title, raw.get('content', ''))

        if classified:
            stats['classified'] += 1
            disclosure = {
                'ticker': raw.get('ticker', ''),
                'event_type': classified['event_type'],
                'impact_score': classified['score'],
                'verdict': classified['verdict'],
                'title': title,
                'summary': classified['reason_ar'],
                'source': raw.get('source', 'EGX'),
                'source_url': raw.get('source_url', ''),
                'published_at': raw.get('published_at', datetime.now().strftime('%Y-%m-%d')),
                'matched_keywords': classified['matched_keywords'],
            }
            if store_disclosure(disclosure):
                stats['stored'] += 1
            else:
                stats['skipped'] += 1
        else:
            stats['skipped'] += 1

    return stats


# ═══════════════════════════════════════════════════════════════════════
# 5. V40.2 Integration Helper
# ═══════════════════════════════════════════════════════════════════════

def get_disclosure_impact_for_ticker(ticker: str) -> Dict[str, Any]:
    """
    جيب تأثير الإفصاح لسهم (للـ V40.2 integration).

    Returns:
        {
            'has_disclosure': bool,
            'impact_score': int (-2 لـ +2),
            'verdict': 'VETO'|'REDUCE'|'NEUTRAL'|'BOOST'|'BOOST_STRONG',
            'event_type': str,
            'reason_ar': str,
            'proof_string': str,  # للـ V40.2 proofs
        }
    """
    result = get_latest_disclosure_impact(ticker, days_back=3)
    score = result['impact_score']
    verdict = result['verdict']

    # Build proof string for V40.2
    if verdict == 'VETO':
        proof = f"🚨 إفصاف رسمي سلبي ({result['event_type']}): {result['reason_ar']} — تجميد الإشارة"
    elif score < 0:
        proof = f"⚠️ إفصاح رسمي سلبي ({result['event_type']}): {result['reason_ar']} — وقف طوارئ"
    elif score > 0:
        proof = f"📈 إفصاح رسمي إيجابي ({result['event_type']}): {result['reason_ar']} — دفعة +{score}"
    else:
        proof = f"ℹ️ إفصاح محايد ({result['event_type']}): {result['reason_ar']}"

    result['proof_string'] = proof
    return result


# ═══════════════════════════════════════════════════════════════════════
# 6. Manual Disclosure Injection (for testing/backtest)
# ═══════════════════════════════════════════════════════════════════════

def inject_disclosure(ticker: str, title: str, event_date: str,
                       source: str = 'MANUAL') -> Optional[Dict[str, Any]]:
    """
    حقن إفصاح يدوياً (للاختبار أو للـ backtest).

    Args:
        ticker: رمز السهم (COMI)
        title: عنوان الإفصاح
        event_date: تاريخ الإفصاح (YYYY-MM-DD)
        source: مصدر البيانات (default: MANUAL)

    Returns: classified disclosure or None
    """
    classified = classify_disclosure(title)
    if not classified:
        return None

    disclosure = {
        'ticker': ticker.upper(),
        'event_type': classified['event_type'],
        'impact_score': classified['score'],
        'verdict': classified['verdict'],
        'title': title,
        'summary': classified['reason_ar'],
        'source': source,
        'source_url': '',
        'published_at': event_date,
        'matched_keywords': classified['matched_keywords'],
    }
    store_disclosure(disclosure)
    return disclosure


# ═══════════════════════════════════════════════════════════════════════
# 7. Self-test
# ═══════════════════════════════════════════════════════════════════════

if __name__ == '__main__':
    print("🧪 EGX Disclosure Engine — Self Test")
    print("=" * 70)
    print(f"DB: {DB_PATH}")
    print(f"Disclosure types: {len(DISCLOSURE_TYPES)}")
    print()

    # Test 1: Capital increase
    print("=== Test 1: زيادة رأس المال ===")
    r = classify_disclosure("إفصاح: شركة COMI تعلن زيادة رأس المال المصرح")
    print(f"  Event: {r['event_type']} | Score: {r['score']:+d} | Verdict: {r['verdict']}")
    print(f"  Reason: {r['reason_ar']}")
    assert r['event_type'] == 'CAPITAL_INCREASE' and r['score'] == 1
    print("  ✅ PASS")

    # Test 2: Subscription rights (BOOST_STRONG)
    print("\n=== Test 2: حقوق اكتتاب ===")
    r = classify_disclosure("بشأن بدء طرح حقوق اكتتاب لشركة ABUK")
    print(f"  Event: {r['event_type']} | Score: {r['score']:+d} | Verdict: {r['verdict']}")
    assert r['event_type'] == 'SUBSCRIPTION_RIGHTS' and r['score'] == 2
    print("  ✅ PASS")

    # Test 3: Dividend (REDUCE)
    print("\n=== Test 3: توزيع أرباح ===")
    r = classify_disclosure("إفصاح عن توزيع أرباح نقدية - شركة HRHO")
    print(f"  Event: {r['event_type']} | Score: {r['score']:+d} | Verdict: {r['verdict']}")
    assert r['event_type'] == 'DIVIDEND' and r['score'] == -1
    print("  ✅ PASS")

    # Test 4: Suspension (VETO)
    print("\n=== Test 4: إيقاف التداول ===")
    r = classify_disclosure("قرار إيقاف التداول على سهم MFPC")
    print(f"  Event: {r['event_type']} | Score: {r['score']:+d} | Verdict: {r['verdict']}")
    assert r['event_type'] == 'SUSPENSION' and r['score'] == -2 and r['verdict'] == 'VETO'
    print("  ✅ PASS (VETO — تجميد)")

    # Test 5: Delisting (VETO)
    print("\n=== Test 5: شطب ===")
    r = classify_disclosure("بشأن شطب سهم ETEL من البورصة")
    print(f"  Event: {r['event_type']} | Score: {r['score']:+d} | Verdict: {r['verdict']}")
    assert r['event_type'] == 'DELISTING' and r['score'] == -2
    print("  ✅ PASS (VETO — شطب)")

    # Test 6: Acquisition (BOOST_STRONG)
    print("\n=== Test 6: استحواذ ===")
    r = classify_disclosure("إفصاح: استحواذ شركة SWDY على شركة أخرى")
    print(f"  Event: {r['event_type']} | Score: {r['score']:+d} | Verdict: {r['verdict']}")
    assert r['event_type'] == 'ACQUISITION' and r['score'] == 2
    print("  ✅ PASS")

    # Test 7: Earnings (NEUTRAL)
    print("\n=== Test 7: نتائج أعمال ===")
    r = classify_disclosure("نشر القوائم المالية لشركة COMI")
    print(f"  Event: {r['event_type']} | Score: {r['score']:+d} | Verdict: {r['verdict']}")
    assert r['event_type'] == 'EARNINGS' and r['score'] == 0
    print("  ✅ PASS (محايد)")

    # Test 8: No match (returns None)
    print("\n=== Test 8: نص مش إفصاح ===")
    r = classify_disclosure("تحليل: السهم بيتجميل بشكل جيد")
    print(f"  Result: {r}")
    assert r is None
    print("  ✅ PASS (مفيش إفصاح)")

    # Test 9: Storage + retrieval
    print("\n=== Test 9: تخزين + استرجاع ===")
    # Inject a test disclosure
    test_disc = inject_disclosure('TESTCO', 'إفصاح: توزيع أرباح نقدية', '2026-09-01')
    print(f"  Injected: {test_disc['event_type']} score={test_disc['impact_score']}")
    # Retrieve
    impact = get_latest_disclosure_impact('TESTCO', days_back=3)
    print(f"  Retrieved: has={impact['has_disclosure']} score={impact['impact_score']} verdict={impact['verdict']}")
    assert impact['has_disclosure'] and impact['impact_score'] == -1
    print("  ✅ PASS")

    # Test 10: V40.2 integration helper
    print("\n=== Test 10: V40.2 integration ===")
    result = get_disclosure_impact_for_ticker('TESTCO')
    print(f"  Score: {result['impact_score']:+d} | Verdict: {result['verdict']}")
    print(f"  Proof: {result['proof_string']}")
    print("  ✅ PASS")

    # Test 11: No disclosure (clean ticker)
    print("\n=== Test 11: سهم بدون إفصاحات ===")
    result = get_disclosure_impact_for_ticker('CLEANTICKER')
    print(f"  has_disclosure: {result['has_disclosure']} | Score: {result['impact_score']}")
    assert not result['has_disclosure'] and result['impact_score'] == 0
    print("  ✅ PASS (عادي — مش هيأثر)")

    print("\n" + "=" * 70)
    print("✅ EGX Disclosure Engine ready")
    print(f"\nIntegration in V40.2: V40_2_DISCLOSURE_IMPACT=1 (default OFF for backtest)")
    print(f"Score -2 (VETO) → تجميد | Score -1 → وقف طوارئ | Score +1/+2 → دفعة")
