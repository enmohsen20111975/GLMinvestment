"""
news_signals_reader.py — يقرأ الأخبار المحقونة من Local News Agent
=====================================================================
يُستخدم من V40.2 لاسترجاع الأخبار ذات الصلة بسهم معين
وإضافة درجة تعديل (news_bias) على قرار التداول
"""

import sqlite3
import json
import logging
from pathlib import Path
from datetime import datetime, timedelta

log = logging.getLogger(__name__)

PREDICTIONS_DB = Path(__file__).parent.parent.parent / 'db' / 'predictions.db'

# وزن تأثير الأخبار على القرار النهائي (−15 → +15)
NEWS_WEIGHT_MAP = {
    'bullish':  {'high': +15, 'medium': +10, 'low': +5},
    'bearish':  {'high': -15, 'medium': -10, 'low': -5},
    'neutral':  {'high': 0,   'medium': 0,   'low':  0},
}


def _importance_tier(score: int) -> str:
    if score >= 75:
        return 'high'
    elif score >= 50:
        return 'medium'
    return 'low'


def get_news_bias(ticker: str, hours_back: int = 12) -> dict:
    """
    ارجع تحيز الأخبار لسهم معين خلال الـ N ساعات الأخيرة.

    Returns:
        {
            'bias':         -15 → +15,
            'sentiment':    'bullish'|'bearish'|'neutral',
            'importance':   0-100,
            'news_count':   int,
            'top_news':     [{'summary_ar', 'importance', 'sentiment', 'impact_type'}],
            'has_news':     bool,
        }
    """
    default = {
        'bias': 0, 'sentiment': 'neutral', 'importance': 0,
        'news_count': 0, 'top_news': [], 'has_news': False,
    }

    if not PREDICTIONS_DB.exists():
        return default

    try:
        conn = sqlite3.connect(str(PREDICTIONS_DB), timeout=10.0)
        conn.row_factory = sqlite3.Row
        cur = conn.cursor()

        # تأكد إن الجدول موجود
        cur.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='news_signals'")
        if not cur.fetchone():
            conn.close()
            return default

        cutoff_modifier = f"-{hours_back} hours"

        # ابحث عن أخبار السهم
        cur.execute('''
            SELECT id, summary_ar, importance, sentiment, impact_type, tickers
            FROM news_signals
            WHERE (received_at >= datetime('now', ?) OR published_at >= datetime('now', ?))
              AND importance > 0
            ORDER BY importance DESC
            LIMIT 30
        ''', (cutoff_modifier, cutoff_modifier))
        rows = cur.fetchall()
        conn.close()

        # فلتر الأسهم المتعلقة
        relevant = []
        for row in rows:
            tickers_raw = row['tickers'] or '[]'
            try:
                tickers_list = json.loads(tickers_raw)
            except Exception:
                tickers_list = []

            # تطابق لو السهم في القائمة أو EGX عام
            if ticker.upper() in [t.upper() for t in tickers_list] \
               or 'EGX' in tickers_list \
               or 'EGX30' in tickers_list:
                relevant.append(dict(row))

        if not relevant:
            return default

        # احسب التحيز الإجمالي
        total_bias   = 0
        max_importance = 0
        sentiment_votes = {'bullish': 0, 'bearish': 0, 'neutral': 0}

        for r in relevant:
            tier   = _importance_tier(r['importance'])
            sent   = r['sentiment'] if r['sentiment'] in NEWS_WEIGHT_MAP else 'neutral'
            weight = NEWS_WEIGHT_MAP[sent][tier]
            total_bias += weight
            sentiment_votes[sent] += r['importance']
            max_importance = max(max_importance, r['importance'])

        # التحيز المُقيَّد (−15 → +15)
        bias = max(-15, min(15, total_bias))

        # السنتيمنت الغالب
        dominant_sentiment = max(sentiment_votes, key=sentiment_votes.get)

        top_news = [{
            'summary_ar':  r.get('summary_ar', ''),
            'importance':  r.get('importance', 0),
            'sentiment':   r.get('sentiment', 'neutral'),
            'impact_type': r.get('impact_type', 'general'),
        } for r in relevant[:3]]

        return {
            'bias':        bias,
            'sentiment':   dominant_sentiment,
            'importance':  max_importance,
            'news_count':  len(relevant),
            'top_news':    top_news,
            'has_news':    True,
        }

    except Exception as e:
        log.warning(f"[NewsSignals] Error reading for {ticker}: {e}")
        return default


def apply_news_bias_to_score(base_score: float, ticker: str) -> tuple[float, dict]:
    """
    طبّق تحيز الأخبار على الـ score النهائي لـ V40.2.

    Args:
        base_score: الدرجة الأصلية (0-100)
        ticker:     رمز السهم

    Returns:
        (adjusted_score, news_context)
    """
    news = get_news_bias(ticker)
    if not news['has_news']:
        return base_score, news

    adjusted = base_score + news['bias']
    adjusted = max(0.0, min(100.0, adjusted))

    log.info(
        f"[NewsSignals] {ticker}: score {base_score:.1f} → {adjusted:.1f} "
        f"(bias={news['bias']:+d}, {news['news_count']} news, {news['sentiment']})"
    )
    return adjusted, news
