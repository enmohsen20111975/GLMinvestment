#!/usr/bin/env python3
"""
Live News Integration Module — ربط الأخبار الحية بالتوقعات
=============================================================
توجيه المالك (2026-09-02): "اربط مصدر الأخبار الحالي بالنظام (التوقعات + متابعة الصفقات).
تصنيف تأثير الخبر على السهم (إيجابي قوي / إيجابي / محايد / سلبي / سلبي قوي).

الـ module ده بيوفر:
1. get_news_impact_for_live_prediction(ticker) — تأثير الأخبار على توقع جديد.
2. check_news_for_open_position(ticker, entry_date) — متابعة صفقة مفتوحة.
3. format_news_for_client_display(ticker, news_data) — شرح التوصية للعميل.
4. generate_news_aware_recommendation(ticker, v40_2_result, news_result) — توصية شاملة.

القواعد (من توجيه المالك):
- خبر إيجابي قوي → يرفع تقييم السهم / يدعم الشراء / يقلل الرغبة في البيع.
- خبر سلبي قوي → يخلي النظام أكثر حذرًا / يفضل التخفيف/الخروج.
- ممنوع تعتمد على الخبر لوحده — عامل إضافي قوي، مش بديل عن التحليل الفني.

Author: Z.ai Code
Date: 2026-09-02
"""
from __future__ import annotations
import os
import logging
from typing import Dict, Any, List, Optional
from datetime import datetime, timedelta

logger = logging.getLogger(__name__)


# ═══════════════════════════════════════════════════════════════════════
# 1. Live Prediction News Impact
# ═══════════════════════════════════════════════════════════════════════

def get_news_impact_for_live_prediction(ticker: str) -> Dict[str, Any]:
    """
    تأثير الأخبار الحية على توقع جديد للسهم.

    بيقرأ من الإنتاج عبر /api/proxy-prod/news-feed + يحللها بـ news_impact_scorer.

    Returns:
        {
            'has_news': bool,
            'news_count': int,
            'news_score': int,
            'level': str (STRONG_POSITIVE / POSITIVE / NEUTRAL / NEGATIVE / STRONG_NEGATIVE),
            'score_delta': int (للتطبيق على V40.2 score),
            'action_recommendation': str,
            'client_message': str,
            'articles': list,
            'news_summary_ar': str,
        }
    """
    try:
        # Import here to avoid circular imports
        from analyzers.news_fetcher_analyzer import _get_news_from_production
        from analyzers.news_impact_scorer import (
            score_news_articles, get_live_prediction_impact,
            classify_news_impact_level,
        )

        # Fetch fresh news from production
        articles = _get_news_from_production(ticker, max_results=5)
        if not articles:
            return {
                'has_news': False,
                'news_count': 0,
                'news_score': 0,
                'level': 'NEUTRAL',
                'score_delta': 0,
                'action_recommendation': 'محايد',
                'client_message': '',
                'articles': [],
                'news_summary_ar': 'لا توجد أخبار حديثة',
            }

        # Score the articles
        scored_articles = [
            {
                'title': a.get('title', ''),
                'content': a.get('snippet', ''),
                'published_at': a.get('published_at', ''),
                'source': a.get('source', ''),
            }
            for a in articles
        ]
        score_result = score_news_articles(scored_articles, days_window=7)
        news_score = score_result.get('news_score', 0)
        summary = score_result.get('summary_ar', '')

        # Get the impact for live prediction
        impact = get_live_prediction_impact(news_score, ticker, summary)

        return {
            'has_news': True,
            'news_count': len(articles),
            'news_score': news_score,
            'level': impact['level'],
            'score_delta': impact['score_delta'],
            'action_recommendation': impact['action_recommendation'],
            'client_message': impact['client_message'],
            'articles': articles[:3],  # top 3 for UI
            'news_summary_ar': summary,
            'emoji': impact['emoji'],
            'label_ar': impact['label_ar'],
            'color': impact['color'],
            'description_ar': impact['description_ar'],
            'action_ar': impact['action_ar'],
        }

    except Exception as e:
        logger.warning(f"get_news_impact_for_live_prediction error for {ticker}: {e}")
        return {
            'has_news': False,
            'news_count': 0,
            'news_score': 0,
            'level': 'NEUTRAL',
            'score_delta': 0,
            'action_recommendation': 'محايد',
            'client_message': '',
            'articles': [],
            'news_summary_ar': f'خطأ في جلب الأخبار: {e}',
        }


# ═══════════════════════════════════════════════════════════════════════
# 2. Open Position News Monitoring
# ═══════════════════════════════════════════════════════════════════════

def check_news_for_open_position(ticker: str, entry_date: str) -> Dict[str, Any]:
    """
    متابعة صفقة مفتوحة — فحص الأخبار الجديدة منذ تاريخ الدخول.

    Owner directive: "منطق متابعة الصفقات المفتوحة (لو فيه خبر جديد على سهم مفتوح)."

    Args:
        ticker: رمز السهم.
        entry_date: تاريخ الدخول (ISO format).

    Returns:
        {
            'has_new_news': bool,
            'new_news_count': int,
            'action': 'HOLD' | 'ADD' | 'REDUCE' | 'EXIT',
            'reason_ar': str,
            'client_alert': str,  # رسالة تنبيه للعميل
            'articles': list,
        }
    """
    try:
        from analyzers.news_fetcher_analyzer import _get_news_from_production
        from analyzers.news_impact_scorer import score_news_articles, get_live_prediction_impact

        # Fetch news since entry_date
        articles = _get_news_from_production(ticker, max_results=10)

        # Filter: only news published AFTER entry_date
        try:
            entry_dt = datetime.fromisoformat(entry_date.split('T')[0]) if entry_date else datetime.now() - timedelta(days=7)
        except Exception:
            entry_dt = datetime.now() - timedelta(days=7)

        new_articles = []
        for a in articles:
            pub_str = a.get('published_at', '')
            try:
                # Try to parse the date
                pub_dt = None
                for fmt in ['%Y-%m-%dT%H:%M:%S', '%Y-%m-%d %H:%M:%S', '%Y-%m-%d', '%Y%m%dT%H%M%S']:
                    try:
                        pub_dt = datetime.strptime(pub_str[:19], fmt[:19] if '%f' not in fmt else fmt)
                        break
                    except ValueError:
                        continue
                if pub_dt and pub_dt >= entry_dt:
                    new_articles.append(a)
                elif not pub_dt:
                    # Can't parse date → include (conservative)
                    new_articles.append(a)
            except Exception:
                continue

        if not new_articles:
            return {
                'has_new_news': False,
                'new_news_count': 0,
                'action': 'HOLD',
                'reason_ar': 'لا توجد أخبار جديدة منذ الدخول',
                'client_alert': '',
                'articles': [],
            }

        # Score the new news
        scored_articles = [
            {
                'title': a.get('title', ''),
                'content': a.get('snippet', ''),
                'published_at': a.get('published_at', ''),
                'source': a.get('source', ''),
            }
            for a in new_articles
        ]
        score_result = score_news_articles(scored_articles, days_window=30)
        news_score = score_result.get('news_score', 0)
        impact = get_live_prediction_impact(news_score, ticker, score_result.get('summary_ar', ''))

        # Determine action based on news level
        level = impact['level']
        if level == 'STRONG_POSITIVE':
            action = 'ADD'  # زود الحجم
            reason = f'خبر إيجابي قوي جديد: {score_result.get("summary_ar", "")}'
            client_alert = f'🚀 خبر إيجابي قوي على {ticker}!\n{score_result.get("summary_ar", "")}\nالتوصية: ممكن تزيد الحجم — الخبر بيدعم استمرار الصفقة.'
        elif level == 'POSITIVE':
            action = 'HOLD'  # استمر
            reason = f'خبر إيجابي جديد: {score_result.get("summary_ar", "")}'
            client_alert = f'📈 خبر إيجابي على {ticker}.\nالتوصية: استمر في الصفقة — الخبر بيدعمها.'
        elif level == 'NEUTRAL':
            action = 'HOLD'
            reason = f'أخبار محايدة جديدة ({len(new_articles)} خبر)'
            client_alert = f'➖ أخبار محايدة على {ticker}.\nالتوصية: استمر — التحليل الفني هو المرجع.'
        elif level == 'NEGATIVE':
            action = 'REDUCE'  # خفف
            reason = f'خبر سلبي جديد: {score_result.get("summary_ar", "")}'
            client_alert = f'📉 خبر سلبي على {ticker}!\n{score_result.get("summary_ar", "")}\nالتوصية: خفّف الحجم — حذر.'
        else:  # STRONG_NEGATIVE
            action = 'EXIT'  # اخرج
            reason = f'خبر سلبي قوي جديد: {score_result.get("summary_ar", "")}'
            client_alert = f'🚨 خبر سلبي قوي على {ticker}!\n{score_result.get("summary_ar", "")}\nالتوصية: اخروج فوري — الخبر خطر.'

        return {
            'has_new_news': True,
            'new_news_count': len(new_articles),
            'action': action,
            'reason_ar': reason,
            'client_alert': client_alert,
            'articles': new_articles[:3],
            'news_score': news_score,
            'level': level,
            'emoji': impact['emoji'],
            'label_ar': impact['label_ar'],
        }

    except Exception as e:
        logger.warning(f"check_news_for_open_position error for {ticker}: {e}")
        return {
            'has_new_news': False,
            'new_news_count': 0,
            'action': 'HOLD',
            'reason_ar': f'خطأ: {e}',
            'client_alert': '',
            'articles': [],
        }


# ═══════════════════════════════════════════════════════════════════════
# 3. Client Display Formatting
# ═══════════════════════════════════════════════════════════════════════

def format_news_for_client_display(ticker: str, news_data: Dict[str, Any]) -> str:
    """
    تنسيق الأخبار لعرضها في شاشة التوصية للعميل.

    Owner directive: "إضافة تأثير الخبر في شاشة التوصية (يظهر الخبر + تقييم تأثيره)."
    """
    if not news_data.get('has_news'):
        return '➖ لا توجد أخبار حديثة مؤثرة على هذا السهم.'

    lines = []
    level = news_data.get('level', 'NEUTRAL')
    emoji = news_data.get('emoji', '➖')
    label = news_data.get('label_ar', 'محايد')
    news_count = news_data.get('news_count', 0)
    summary = news_data.get('news_summary_ar', '')

    lines.append(f'{emoji} تأثير الأخبار: {label} ({news_count} خبر)')
    if summary:
        lines.append(f'📋 {summary}')

    # Show top 2 articles
    articles = news_data.get('articles', [])
    if articles:
        lines.append('')
        lines.append('📰 آخر الأخبار:')
        for i, a in enumerate(articles[:2], 1):
            title = a.get('title', '')[:60]
            source = a.get('source', '')
            lines.append(f'  {i}. {title}... ({source})')

    # Add action recommendation
    action = news_data.get('action_ar', '')
    if action and level != 'NEUTRAL':
        lines.append('')
        lines.append(f'💡 التأثير على القرار: {action}')

    return '\n'.join(lines)


# ═══════════════════════════════════════════════════════════════════════
# 4. News-Aware Recommendation (combines V40.2 + News)
# ═══════════════════════════════════════════════════════════════════════

def generate_news_aware_recommendation(
    ticker: str,
    v40_2_score: int,
    v40_2_signal: str,
    v40_2_proofs: Dict[str, str] = None,
) -> Dict[str, Any]:
    """
    توليد توصية شاملة تدمج V40.2 + الأخبار الحية.

    Owner directive: "ممنوع تعتمد على الخبر لوحده. الخبر يُعتبر عامل إضافي قوي،
    مش بديل عن التحليل الفني والـ Regime والـ R/R."

    Args:
        ticker: رمز السهم.
        v40_2_score: النتيجة من V40.2 (0-100).
        v40_2_signal: الإشارة من V40.2 (BUY/STRONG_BUY/HOLD/SELL).
        v40_2_proofs: الأدلة من V40.2.

    Returns:
        {
            'ticker': str,
            'v40_2_score': int,
            'v40_2_signal': str,
            'news_score': int,
            'news_level': str,
            'combined_score': int,  # V40.2 + news delta
            'combined_signal': str,  # final signal after news adjustment
            'recommendation_ar': str,  # شرح كامل للعميل
            'client_display': str,  # للـ UI
        }
    """
    # Get news impact
    news_data = get_news_impact_for_live_prediction(ticker)
    news_delta = news_data.get('score_delta', 0)
    news_level = news_data.get('level', 'NEUTRAL')

    # Combine scores (with clamping 0-100)
    combined_score = max(0, min(100, v40_2_score + news_delta))

    # Adjust signal based on news
    combined_signal = v40_2_signal
    if news_level == 'STRONG_POSITIVE':
        if v40_2_signal == 'HOLD':
            combined_signal = 'BUY'  # الخبر الإيجابي القوي بيقلب HOLD لـ BUY
        elif v40_2_signal == 'BUY':
            combined_signal = 'STRONG_BUY'
    elif news_level == 'STRONG_NEGATIVE':
        if v40_2_signal in ('BUY', 'STRONG_BUY'):
            combined_signal = 'HOLD'  # الخبر السلبي القوي بيوقف الشراء
        elif v40_2_signal == 'HOLD':
            combined_signal = 'SELL'

    # Generate recommendation text
    proofs_str = ''
    if v40_2_proofs:
        proofs_str = '\n'.join(f'  • {k}: {v}' for k, v in list(v40_2_proofs.items())[:3])

    news_display = format_news_for_client_display(ticker, news_data)

    recommendation_ar = f"""
📊 توصية شاملة لـ {ticker}
{'=' * 50}

🎯 التحليل الفني (V40.2):
  Score: {v40_2_score}/100
  Signal: {v40_2_signal}
  Combined Score (بعد الأخبار): {combined_score}/100
  Final Signal: {combined_signal}

{news_display}

📋 الأدلة الفنية:
{proofs_str if proofs_str else '  (لا توجد أدلة إضافية)'}

⚠️ ملاحظة: الخبر يُعتبر عامل إضافي قوي، مش بديل عن التحليل الفني.
""".strip()

    return {
        'ticker': ticker,
        'v40_2_score': v40_2_score,
        'v40_2_signal': v40_2_signal,
        'news_score': news_data.get('news_score', 0),
        'news_level': news_level,
        'combined_score': combined_score,
        'combined_signal': combined_signal,
        'recommendation_ar': recommendation_ar,
        'client_display': news_display,
        'news_data': news_data,
    }


# ═══════════════════════════════════════════════════════════════════════
# Self-test
# ═══════════════════════════════════════════════════════════════════════

if __name__ == '__main__':
    print("🧪 Live News Integration Module — Self Test")
    print("=" * 70)

    # Test 1: Live prediction impact (uses production news)
    print("\n=== Test 1: get_news_impact_for_live_prediction ===")
    for ticker in ['COMI', 'TMGH', 'KORA', 'NILE']:
        result = get_news_impact_for_live_prediction(ticker)
        print(f"\n  {ticker}:")
        print(f"    has_news: {result['has_news']}")
        print(f"    news_count: {result['news_count']}")
        print(f"    level: {result.get('emoji', '')} {result.get('label_ar', '')}")
        print(f"    score_delta: {result['score_delta']:+d}")
        print(f"    action: {result['action_recommendation']}")

    # Test 2: Open position monitoring
    print("\n\n=== Test 2: check_news_for_open_position ===")
    result = check_news_for_open_position('COMI', '2026-08-25')
    print(f"  has_new_news: {result['has_new_news']}")
    print(f"  new_news_count: {result['new_news_count']}")
    print(f"  action: {result['action']}")
    if result.get('client_alert'):
        print(f"  client_alert: {result['client_alert'][:100]}...")

    # Test 3: News-aware recommendation
    print("\n\n=== Test 3: generate_news_aware_recommendation ===")
    rec = generate_news_aware_recommendation(
        ticker='COMI',
        v40_2_score=65,
        v40_2_signal='BUY',
        v40_2_proofs={'momentum': 'قوي', 'volume': 'متصاعد'},
    )
    print(f"\n{rec['recommendation_ar']}")

    print("\n" + "=" * 70)
    print("✓ Live News Integration Module ready")
