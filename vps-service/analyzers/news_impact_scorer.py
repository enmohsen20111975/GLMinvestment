#!/usr/bin/env python3
"""
News Impact Scorer — محرك تصنيف وتقييم تأثير الأخبار
=====================================================
حل مشكلة "الأخبار بتحرك السود بطريقة مش طبيعية":
  - اكتتابات بتطير الأسهم (+15% في يوم)
  - توزيع أرباح بيموت سعر السهم (-10% في ex-date)
  - أرباح超标 / خسائر / استحواذ / موافقات تنظيمية

الـ module بـ يـ classify كل خبر حسب event type ويحسب impact_score (-25 لـ +20).

التكامل:
  1. من news_agent.py (live DuckDuckGo search) — للإنتاج
  2. من news.db (محلي) — للـ backtest (لو فيه بيانات)
  3. في V40.2 كـ proof #9 + hard veto / boost

تصحيح خطأ مفاهيمي في news_agent.py keyword_fallback:
  - "توزيع" كان POSITIVE (وزن 3) — خطأ! توزيع الأرباح NEGATIVE على ex-date
  - "اكتتاب" كان مش موجود — أضفته كـ POSITIVE strong

Author: Z.ai Code
Date: 2026-09-01
"""

from __future__ import annotations
import re
import math
from typing import List, Dict, Any, Optional, Tuple
from datetime import datetime, timedelta


# ═══════════════════════════════════════════════════════════════════════
# Event Types + Impact Scores (EGX-calibrated)
# ═══════════════════════════════════════════════════════════════════════

# كل event له: impact_score (-25 لـ +20), confidence_weight, verdict
EVENT_TYPES: Dict[str, Dict[str, Any]] = {
    'IPO_SUBSCRIPTION': {
        'score': +18, 'verdict': 'BOOST',
        'reason_ar': 'اكتتاب/طرح عام — السهم بيطير',
        'keywords_ar': ['اكتتاب', 'طرح عام', 'طرح أسهم', 'طرح للاكتتاب', 'بدء اكتتاب'],
        'keywords_en': ['IPO', 'initial public offering', 'subscription', 'listing', 'public offering'],
    },
    'DIVIDEND_EX_DATE': {
        'score': -12, 'verdict': 'REDUCE',
        'reason_ar': 'توزيع أرباح (ex-date) — السعر بينزل بقيمة التوزيع',
        'keywords_ar': ['توزيع أرباح', 'توزيعات', 'توزيع نقدي', 'قيد الأرباح', 'ex-date', 'تاريخ الاستحقاق'],
        'keywords_en': ['dividend', 'ex-dividend', 'ex date', 'distribution', 'cash dividend', 'payout'],
    },
    'DIVIDEND_ANNOUNCE': {
        # مجرد الإعلان عن توزيع (مش ex-date) — إيجابي للسمعة
        'score': +6, 'verdict': 'BOOST',
        'reason_ar': 'إعلان توزيع أرباح — إيجابي للسمعة',
        'keywords_ar': ['أعلن توزيع', 'موافقة على التوزيع', 'توزيع مجزٍ'],
        'keywords_en': ['announces dividend', 'declares dividend', 'approved dividend'],
    },
    'EARNINGS_BEAT': {
        'score': +14, 'verdict': 'BOOST',
        'reason_ar': 'أرباح超标 — نمو أقوى من المتوقع',
        'keywords_ar': ['تجاوز التوقعات', 'أرباح قياسية', 'نمو الأرباح', 'ارتفاع الأرباح', 'أرباح استثنائية'],
        'keywords_en': ['earnings beat', 'beat expectations', 'record profit', 'profit surge', 'tops estimates'],
    },
    'EARNINGS_MISS': {
        'score': -14, 'verdict': 'REDUCE',
        'reason_ar': 'أرباح أقل من المتوقع — تراجع',
        'keywords_ar': ['خسارة', 'تراجع الأرباح', 'انخفاض الأرباح', 'خيبة أمل', 'أقل من المتوقع'],
        'keywords_en': ['earnings miss', 'loss', 'profit decline', 'disappointing', 'below estimates', 'warns'],
    },
    'MA_ACQUISITION': {
        'score': +12, 'verdict': 'BOOST',
        'reason_ar': 'استحواذ/اندماج — توسع استراتيجي',
        'keywords_ar': ['استحواذ', 'اندماج', 'شراء', 'صفقة استحواذ', 'استحوذ'],
        'keywords_en': ['acquisition', 'merger', 'acquire', 'buyout', 'takeover', 'M&A'],
    },
    'REGULATORY_APPROVAL': {
        'score': +10, 'verdict': 'BOOST',
        'reason_ar': 'موافقة تنظيمية — ترخيص/اعتماد',
        'keywords_ar': ['موافقة', 'ترخيص', 'اعتماد', 'تنسيق', 'موافقة البورصة', 'موافقة هيئة'],
        'keywords_en': ['approval', 'approved', 'license', 'clearance', 'authorized', 'FRA', 'regulatory'],
    },
    'STOCK_SPLIT': {
        'score': +4, 'verdict': 'BOOST',
        'reason_ar': 'تجزئة سهم — سيولة أعلى',
        'keywords_ar': ['تجزئة', 'تقسيم السهم', 'تجزئة الأسهم'],
        'keywords_en': ['stock split', 'split', 'subdivision'],
    },
    'MANAGEMENT_CHANGE': {
        'score': -3, 'verdict': 'REDUCE',
        'reason_ar': 'تغيير إدارة — عدم يقين',
        'keywords_ar': ['استقالة', 'تعيين', 'تغيير مجلس', 'رئيس جديد', 'إعفاء'],
        'keywords_en': ['resign', 'appoint', 'CEO', 'executive', 'management change', 'steps down'],
    },
    'CONTRACT_AWARD': {
        'score': +8, 'verdict': 'BOOST',
        'reason_ar': 'عقد جديد — إيرادات متوقعة',
        'keywords_ar': ['عقد', 'اتفاقية', 'تعاقد', 'فاز بعقد', 'توقيع عقد'],
        'keywords_en': ['contract', 'agreement', 'award', 'signs', 'deal'],
    },
    'EXPANSION': {
        'score': +7, 'verdict': 'BOOST',
        'reason_ar': 'توسع — افتتاح/مشروع جديد',
        'keywords_ar': ['توسع', 'افتتاح', 'مشروع جديد', 'إطلاق', 'فرع جديد'],
        'keywords_en': ['expansion', 'expand', 'open', 'launch', 'new branch', 'new plant'],
    },
    'INVESTIGATION_FRAUD': {
        'score': -22, 'verdict': 'VETO',
        'reason_ar': 'تحقيقات/قضايا — خطر شديد',
        'keywords_ar': ['تحقيق', 'قضية', 'محكمة', 'احتيال', 'مخالفة', 'غرامة', 'شكوى', 'تجميد'],
        'keywords_en': ['investigation', 'lawsuit', 'fraud', 'probe', 'SEC', 'charged', 'frozen', 'halted'],
    },
    'TRADING_HALT': {
        'score': -25, 'verdict': 'VETO',
        'reason_ar': 'إيقاف تداول — مستحيل الدخول',
        'keywords_ar': ['إيقاف تداول', 'تعليق التداول', 'إيقاف مؤقت', 'تجميد السهم'],
        'keywords_en': ['trading halt', 'suspended', 'halted', 'trading suspended', 'freeze'],
    },
    'CBE_DECISION': {
        # قرار بنك مركزي — market-wide uncertainty
        'score': -8, 'verdict': 'REDUCE',
        'reason_ar': 'قرار بنك مركزي — عدم يقين على مستوى السوق',
        'keywords_ar': ['بنك مركزي', 'فائدة', 'تخفيض الجنيه', 'تعويم', 'قرار البنك المركزي', 'CBE'],
        'keywords_en': ['central bank', 'interest rate', 'rate decision', 'CBE', 'monetary policy', 'fed'],
    },
}

# Veto threshold (hard reject)
VETO_THRESHOLD = -15
# Boost threshold
BOOST_THRESHOLD = +8
# Reduce threshold
REDUCE_THRESHOLD = -5
# STRONG thresholds (2026-09-02): 5 levels for live predictions
STRONG_BOOST_THRESHOLD = +15   # إيجابي قوي (الخبر اللي ممكن يقلب القرار 180°)
STRONG_REDUCE_THRESHOLD = -12  # سلبي قوي


# ═══════════════════════════════════════════════════════════════════════
# 5-Level Classification (2026-09-02) — for live predictions
# ═══════════════════════════════════════════════════════════════════════
# Owner directive: "تصنيف تأثير الخبر على السهم
#   (إيجابي قوي / إيجابي / محايد / سلبي / سلبي قوي)."

NEWS_IMPACT_LEVELS = {
    'STRONG_POSITIVE': {
        'label_ar': 'إيجابي قوي',
        'label_en': 'Strong Positive',
        'description_ar': 'خبر ممكن يقلب القرار 180° (استحواذ ضخم / زيادة رأس مال / عقد مليار)',
        'color': 'green',
        'emoji': '🚀',
        'score_range': (15, 25),
        'action_ar': 'يدعم قرار الشراء بقوة / يقلل الرغبة في البيع',
    },
    'POSITIVE': {
        'label_ar': 'إيجابي',
        'label_en': 'Positive',
        'description_ar': 'خبر إيجابي مؤثر (أرباح超标 / توزيع / عقد)',
        'color': 'lightgreen',
        'emoji': '📈',
        'score_range': (5, 14),
        'action_ar': 'يرفع تقييم السهم / يدعم قرار الشراء',
    },
    'NEUTRAL': {
        'label_ar': 'محايد',
        'label_en': 'Neutral',
        'description_ar': 'خبر عام بدون تأثير مباشر',
        'color': 'gray',
        'emoji': '➖',
        'score_range': (-4, 4),
        'action_ar': 'لا تأثير — يفضل التحليل الفني',
    },
    'NEGATIVE': {
        'label_ar': 'سلبي',
        'label_en': 'Negative',
        'description_ar': 'خبر سلبي مؤثر (أرباح أقل / تغيير إدارة / نزول أرباح)',
        'color': 'orange',
        'emoji': '📉',
        'score_range': (-11, -5),
        'action_ar': 'يخلي النظام أكثر حذر / يفضل التخفيف',
    },
    'STRONG_NEGATIVE': {
        'label_ar': 'سلبي قوي',
        'label_en': 'Strong Negative',
        'description_ar': 'خبر ممكن يوقف التداول (تحقيقات / إيقاف تداول / قضايا)',
        'color': 'red',
        'emoji': '🚨',
        'score_range': (-25, -12),
        'action_ar': 'يفضل التخفيف/الخروج — تجنب الدخول',
    },
}


def classify_news_impact_level(news_score: int) -> Dict[str, Any]:
    """
    تصنيف درجة الخبر لـ 5 levels (للـ live predictions + UI display).

    Args:
        news_score: النتيجة من news_impact_scorer (-25 لـ +20).

    Returns:
        {
            'level': 'STRONG_POSITIVE' | 'POSITIVE' | 'NEUTRAL' | 'NEGATIVE' | 'STRONG_NEGATIVE',
            'label_ar': str,
            'label_en': str,
            'description_ar': str,
            'emoji': str,
            'color': str,
            'action_ar': str,
        }
    """
    for level_key, level_data in NEWS_IMPACT_LEVELS.items():
        low, high = level_data['score_range']
        if low <= news_score <= high:
            return {
                'level': level_key,
                'label_ar': level_data['label_ar'],
                'label_en': level_data['label_en'],
                'description_ar': level_data['description_ar'],
                'emoji': level_data['emoji'],
                'color': level_data['color'],
                'action_ar': level_data['action_ar'],
            }
    # fallback
    if news_score >= 15:
        return NEWS_IMPACT_LEVELS['STRONG_POSITIVE']
    elif news_score >= 5:
        return NEWS_IMPACT_LEVELS['POSITIVE']
    elif news_score >= -4:
        return NEWS_IMPACT_LEVELS['NEUTRAL']
    elif news_score >= -11:
        return NEWS_IMPACT_LEVELS['NEGATIVE']
    else:
        return NEWS_IMPACT_LEVELS['STRONG_NEGATIVE']


# ═══════════════════════════════════════════════════════════════════════
# Live Prediction Impact (2026-09-02) — لربط الأخبار بالتوقعات الحية
# ═══════════════════════════════════════════════════════════════════════
# Owner directive: "خبر إيجابي قوي (صفقة استحواذ كبيرة، زيادة رأس مال، عقد ضخم)
# → يرفع تقييم السهم أو يدعم قرار الشراء أو يقلل من الرغبة في البيع.
# خبر سلبي قوي → يخلي النظام أكثر حذرًا أو يفضل التخفيف/الخروج."

LIVE_PREDICTION_IMPACT = {
    'STRONG_POSITIVE': {
        'score_delta': +15,        # +15 points on V40.2 score
        'action_recommendation': 'شراء قوي',
        'action_ar': 'الخبر يدعم قرار الشراء بقوة — ممكن نزيد الحجم لو الصفقة مفتوحة',
        'client_message_template': '📊 خبر إيجابي قوي على {ticker}: {news_summary}\nالتوصية: الخبر بيأكد على فرصة الشراء.',
    },
    'POSITIVE': {
        'score_delta': +8,
        'action_recommendation': 'شراء',
        'action_ar': 'الخبر بيرفع تقييم السهم — يدعم قرار الشراء',
        'client_message_template': '📈 خبر إيجابي على {ticker}: {news_summary}\nالتوصية: الخبر بيدعم فرصة الشراء.',
    },
    'NEUTRAL': {
        'score_delta': 0,
        'action_recommendation': 'محايد',
        'action_ar': 'الخبر محايد — يفضل الاعتماد على التحليل الفني',
        'client_message_template': '➖ خبر محايد على {ticker}: {news_summary}\nالتوصية: لا تأثير مباشر — التحليل الفني هو المرجع.',
    },
    'NEGATIVE': {
        'score_delta': -8,
        'action_recommendation': 'حذر',
        'action_ar': 'الخبر سلبي — يخلي النظام أكثر حذر',
        'client_message_template': '📉 خبر سلبي على {ticker}: {news_summary}\nالتوصية: حذر — يُفضّل تخفيف الحجم أو الانتظار.',
    },
    'STRONG_NEGATIVE': {
        'score_delta': -15,
        'action_recommendation': 'تجنب / تخفيف',
        'action_ar': 'الخبر سلبي قوي — يُفضّل التخفيف/الخروج',
        'client_message_template': '🚨 خبر سلبي قوي على {ticker}: {news_summary}\nالتوصية: تجنب الدخول — لو الصفقة مفتوحة، يُفضّل التخفيف أو الخروج.',
    },
}


def get_live_prediction_impact(news_score: int, ticker: str, news_summary: str = '') -> Dict[str, Any]:
    """
    الحصول على تأثير الخبر على التوقع الحي.

    Args:
        news_score: النتيجة من news_impact_scorer (-25 لـ +20).
        ticker: رمز السهم.
        news_summary: ملخص الخبر (للرسالة).

    Returns:
        {
            'level': str,
            'score_delta': int,
            'action_recommendation': str,
            'action_ar': str,
            'client_message': str,
            'label_ar': str,
            'emoji': str,
            'color': str,
        }
    """
    level_info = classify_news_impact_level(news_score)
    level_key = level_info['level']
    impact = LIVE_PREDICTION_IMPACT.get(level_key, LIVE_PREDICTION_IMPACT['NEUTRAL'])

    client_message = impact['client_message_template'].format(
        ticker=ticker,
        news_summary=news_summary or level_info['description_ar'],
    )

    return {
        'level': level_key,
        'score_delta': impact['score_delta'],
        'action_recommendation': impact['action_recommendation'],
        'action_ar': impact['action_ar'],
        'client_message': client_message,
        'label_ar': level_info['label_ar'],
        'label_en': level_info['label_en'],
        'emoji': level_info['emoji'],
        'color': level_info['color'],
        'description_ar': level_info['description_ar'],
    }


# ═══════════════════════════════════════════════════════════════════════
# Event Detection
# ═══════════════════════════════════════════════════════════════════════

def _normalize_text(text: str) -> str:
    """تطبيع النص (lowercase + remove diacritics)."""
    if not text:
        return ''
    # remove Arabic diacritics
    text = re.sub(r'[\u064B-\u0652]', '', text)
    return text.lower()


def detect_events(text: str) -> List[Dict[str, Any]]:
    """
    كشف الأحداث في نص خبر.

    Returns:
        list of {event_type, score, reason, matched_keywords}
    """
    if not text:
        return []
    normalized = _normalize_text(text)
    detected = []

    for event_type, config in EVENT_TYPES.items():
        matched = []
        for kw in config.get('keywords_ar', []) + config.get('keywords_en', []):
            kw_norm = _normalize_text(kw)
            if kw_norm and kw_norm in normalized:
                matched.append(kw)

        if matched:
            detected.append({
                'event_type': event_type,
                'score': config['score'],
                'verdict': config['verdict'],
                'reason_ar': config['reason_ar'],
                'matched_keywords': matched[:3],  # top 3 matches
            })

    return detected


def score_news_articles(articles: List[Dict[str, str]],
                         days_window: int = 3) -> Dict[str, Any]:
    """
    تقييم قائمة أخبار لسهم معين.

    Args:
        articles: list of {title, content, published_at, source}
        days_window: الأخبار في آخر N يوم تعتبر relevant

    Returns:
        {
            'news_score': int (-25 لـ +20),
            'verdict': 'BOOST'|'REDUCE'|'VETO'|'NEUTRAL',
            'events': list of detected events,
            'summary_ar': str,
            'article_count': int,
            'strongest_event': dict or None,
        }
    """
    if not articles:
        return {
            'news_score': 0, 'verdict': 'NEUTRAL',
            'events': [], 'summary_ar': 'لا توجد أخبار',
            'article_count': 0, 'strongest_event': None,
        }

    # Filter by date window
    cutoff = datetime.now() - timedelta(days=days_window)
    relevant = []
    for a in articles:
        pub_str = a.get('published_at', '')
        try:
            # try multiple formats
            pub_date = None
            for fmt in ('%Y-%m-%dT%H:%M:%S', '%Y-%m-%d %H:%M:%S', '%Y-%m-%d',
                        '%Y%m%dT%H%M%S', '%Y-%m-%dT%H:%M:%S.%f'):
                try:
                    pub_date = datetime.strptime(pub_str[:19], fmt[:19] if '%f' not in fmt else fmt)
                    break
                except ValueError:
                    continue
            if pub_date and pub_date >= cutoff:
                relevant.append(a)
            elif not pub_date:
                # if can't parse date, include it (be conservative)
                relevant.append(a)
        except Exception:
            relevant.append(a)

    if not relevant:
        return {
            'news_score': 0, 'verdict': 'NEUTRAL',
            'events': [], 'summary_ar': 'لا توجد أخبار حديثة',
            'article_count': 0, 'strongest_event': None,
        }

    # Detect events in all articles
    all_events = []
    for a in relevant:
        text = f"{a.get('title', '')} {a.get('content', '')} {a.get('summary', '')}"
        events = detect_events(text)
        for e in events:
            e['article_title'] = a.get('title', '')[:60]
            all_events.append(e)

    if not all_events:
        # أخبار موجودة بس مش فيها event معروف → neutral (لا veto ولا boost)
        return {
            'news_score': 0, 'verdict': 'NEUTRAL',
            'events': [], 'summary_ar': f'{len(relevant)} خبر — بدون event محدد',
            'article_count': len(relevant), 'strongest_event': None,
        }

    # Aggregate: take the strongest event (most negative or most positive)
    # لو فيه VETO event → veto كله
    veto_events = [e for e in all_events if e['verdict'] == 'VETO']
    if veto_events:
        strongest = min(veto_events, key=lambda x: x['score'])
        return {
            'news_score': strongest['score'],
            'verdict': 'VETO',
            'events': all_events,
            'summary_ar': f'🚨 {strongest["reason_ar"]} ({len(all_events)} event)',
            'article_count': len(relevant),
            'strongest_event': strongest,
        }

    # Otherwise: sum of event scores (capped)
    total_score = sum(e['score'] for e in all_events)
    total_score = max(-25, min(20, total_score))  # clamp [-25, +20]

    if total_score >= BOOST_THRESHOLD:
        verdict = 'BOOST'
    elif total_score <= VETO_THRESHOLD:
        verdict = 'VETO'
    elif total_score <= REDUCE_THRESHOLD:
        verdict = 'REDUCE'
    else:
        verdict = 'NEUTRAL'

    # Strongest = max abs score
    strongest = max(all_events, key=lambda x: abs(x['score']))

    # Summary
    event_counts: Dict[str, int] = {}
    for e in all_events:
        event_counts[e['event_type']] = event_counts.get(e['event_type'], 0) + 1
    summary_parts = [f"{cnt}× {et}" for et, cnt in event_counts.items()]
    summary_ar = f"أخبار ({len(relevant)} مقال): {', '.join(summary_parts[:3])}"

    return {
        'news_score': total_score,
        'verdict': verdict,
        'events': all_events,
        'summary_ar': summary_ar,
        'article_count': len(relevant),
        'strongest_event': strongest,
    }


# ═══════════════════════════════════════════════════════════════════════
# Integration helper: get score for V40.2
# ═══════════════════════════════════════════════════════════════════════

def get_news_impact_for_ticker(ticker: str,
                                articles: Optional[List[Dict]] = None,
                                use_live_search: bool = False) -> Dict[str, Any]:
    """
    جيب تأثير الأخبار لسهم معين.

    Args:
        ticker: رمز السهم (مثل COMI)
        articles: قائمة أخبار (لو موجودة من news.db)
        use_live_search: لو True، بـ يعمل DuckDuckGo search live

    Returns:
        نفس output score_news_articles + proof string
    """
    if articles is None and use_live_search:
        try:
            from ai.news_agent import NewsAgent
            agent = NewsAgent()
            if agent.is_ready():
                result = agent.analyze_stock_news(ticker)
                articles = result.get('articles', [])
        except Exception:
            pass

    result = score_news_articles(articles or [], days_window=3)

    # Build proof string for V40.2 integration
    if result['verdict'] == 'VETO':
        proof = f"🚨 NEWS VETO: {result['strongest_event']['reason_ar']}"
    elif result['verdict'] == 'BOOST' and result['news_score'] >= BOOST_THRESHOLD:
        proof = f"📈 NEWS BOOST (+{result['news_score']}): {result['summary_ar']}"
    elif result['verdict'] == 'REDUCE':
        proof = f"⚠️ NEWS REDUCE ({result['news_score']}): {result['summary_ar']}"
    else:
        proof = f"ℹ️ NEWS NEUTRAL: {result['summary_ar']}"

    result['proof_string'] = proof
    result['ticker'] = ticker
    return result


# ═══════════════════════════════════════════════════════════════════════
# Self-test
# ═══════════════════════════════════════════════════════════════════════

if __name__ == '__main__':
    print("🧪 News Impact Scorer — Self Test")
    print("=" * 70)

    # Test 1: IPO news (should be BOOST strong)
    print("\n=== Test 1: IPO/اكتتاب news ===")
    ipo_articles = [
        {'title': 'شركة COMI تعلن بدء اكتتاب عام في أسهمها',
         'content': 'بدأت الشركة طرح عام للاكتتاب بقيمة 500 مليون جنيه',
         'published_at': datetime.now().strftime('%Y-%m-%dT%H:%M:%S')}
    ]
    r1 = score_news_articles(ipo_articles)
    print(f"  Score: {r1['news_score']:+d} | Verdict: {r1['verdict']}")
    print(f"  Events: {[e['event_type'] for e in r1['events']]}")
    print(f"  Summary: {r1['summary_ar']}")
    assert r1['verdict'] == 'BOOST', f"❌ IPO should BOOST, got {r1['verdict']}"
    assert r1['news_score'] >= 15, f"❌ IPO score should be ≥15, got {r1['news_score']}"
    print("  ✅ PASS")

    # Test 2: Dividend ex-date (should be REDUCE)
    print("\n=== Test 2: Dividend ex-date news ===")
    div_articles = [
        {'title': 'COMI: توزيع أرباح نقدية — ex-date غداً',
         'content': 'أعلنت الشركة توزيع أرباح بقيمة 1.5 جنيه للسهم',
         'published_at': datetime.now().strftime('%Y-%m-%dT%H:%M:%S')}
    ]
    r2 = score_news_articles(div_articles)
    print(f"  Score: {r2['news_score']:+d} | Verdict: {r2['verdict']}")
    print(f"  Events: {[e['event_type'] for e in r2['events']]}")
    # Note: DIVIDEND_EX_DATE (-12) + DIVIDEND_ANNOUNCE (+6) = -6 → REDUCE
    print(f"  Summary: {r2['summary_ar']}")
    assert r2['news_score'] < 0, f"❌ Dividend ex-date should be negative, got {r2['news_score']}"
    print("  ✅ PASS")

    # Test 3: Earnings beat
    print("\n=== Test 3: Earnings beat news ===")
    beat_articles = [
        {'title': 'HRHO تجاوزت توقعات الأرباح — أرباح قياسية',
         'content': 'Earnings beat estimates by 20%, record profit',
         'published_at': datetime.now().strftime('%Y-%m-%dT%H:%M:%S')}
    ]
    r3 = score_news_articles(beat_articles)
    print(f"  Score: {r3['news_score']:+d} | Verdict: {r3['verdict']}")
    print(f"  Summary: {r3['summary_ar']}")
    assert r3['verdict'] == 'BOOST', f"❌ Earnings beat should BOOST"
    print("  ✅ PASS")

    # Test 4: Investigation/fraud (should be VETO)
    print("\n=== Test 4: Investigation/fraud news ===")
    fraud_articles = [
        {'title': 'FRA يفتح تحقيق في شركة XYZ — قضايا احتيال',
         'content': 'Investigation launched, lawsuit filed, fraud suspected',
         'published_at': datetime.now().strftime('%Y-%m-%dT%H:%M:%S')}
    ]
    r4 = score_news_articles(fraud_articles)
    print(f"  Score: {r4['news_score']:+d} | Verdict: {r4['verdict']}")
    print(f"  Summary: {r4['summary_ar']}")
    assert r4['verdict'] == 'VETO', f"❌ Fraud should VETO, got {r4['verdict']}"
    assert r4['news_score'] <= VETO_THRESHOLD, f"❌ Fraud score ≤{VETO_THRESHOLD}, got {r4['news_score']}"
    print("  ✅ PASS")

    # Test 5: No news (NEUTRAL)
    print("\n=== Test 5: No news ===")
    r5 = score_news_articles([])
    print(f"  Score: {r5['news_score']:+d} | Verdict: {r5['verdict']}")
    assert r5['verdict'] == 'NEUTRAL'
    print("  ✅ PASS")

    # Test 6: Trading halt (VETO)
    print("\n=== Test 6: Trading halt news ===")
    halt_articles = [
        {'title': 'إيقاف تداول سهم ABUK — تعليق مؤقت',
         'content': 'Trading suspended pending announcement',
         'published_at': datetime.now().strftime('%Y-%m-%dT%H:%M:%S')}
    ]
    r6 = score_news_articles(halt_articles)
    print(f"  Score: {r6['news_score']:+d} | Verdict: {r6['verdict']}")
    assert r6['verdict'] == 'VETO', f"❌ Trading halt should VETO"
    print("  ✅ PASS")

    print("\n" + "=" * 70)
    print("✅ News Impact Scorer ready")
    print(f"\nIntegration: news_score ≥ {BOOST_THRESHOLD} → BOOST")
    print(f"            news_score ≤ {VETO_THRESHOLD} → VETO (hard reject)")
    print(f"            news_score ≤ {REDUCE_THRESHOLD} → REDUCE")
    print(f"\nToggle in V40.2: V40_2_NEWS_IMPACT=1 (default OFF for backtest)")
