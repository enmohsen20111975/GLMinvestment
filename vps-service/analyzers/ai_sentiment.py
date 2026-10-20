"""
AI Sentiment Analyzer — Uses local Ollama for news sentiment
============================================================
Provides keyword-based sentiment scoring (FAST, no network) 
and optional AI-enhanced scoring (Ollama, ~2s per stock).

Usage:
    from analyzers.ai_sentiment import get_sentiment_score, analyze_news_sentiment
    
    # Fast keyword-based (always available)
    score = get_sentiment_score("أرباح الشركة ارتفعت 20% والتوسع في السوق")
    # Returns: 72 (0-100 scale, 50=neutral)
    
    # AI-enhanced (requires Ollama running)
    result = await analyze_news_sentiment("COMI", news_list)
    # Returns: {score: 72, summary: "أخبار إيجابية - أرباح قوية", confidence: 0.8}
"""

import json
from typing import List, Dict, Optional, Any

# ============================================================================
# KEYWORD DICTIONARIES — Arabic + English
# ============================================================================

POSITIVE_WORDS_AR = [
    'أرباح', 'نمو', 'توسع', 'عقد', 'توزيع', 'صافي', 'زيادة', 'ارتفاع',
    'تحسن', 'نجاح', 'طلب', 'شراكة', 'استحواذ', 'ترقية', 'توصية', 'قيادي',
    'ربحية', 'منتظم', 'تاريخي', 'قمة', 'طفرة', 'انطلاق', 'طموح', 'فرصة',
    'إيجابي', 'قوي', 'صعود', 'ممتاز', 'استثنائي', 'تحقيق', 'منح', 'موافقة',
    'إدراج', 'تمويل', 'استثمار', 'أفضل', 'رائع', 'مشروع', 'خطة', 'استراتيجية',
]

NEGATIVE_WORDS_AR = [
    'خسارة', 'تراجع', 'ديون', 'إفلاس', 'تنظيم', 'غرامة', 'خسائر', 'انخفاض',
    'أزمة', 'سلب', 'خطر', 'هبوط', 'ضعف', 'تأخير', 'مشاكل', 'قضايا', 'تحقيق',
    'حجز', 'توقف', 'شيكات مرتجعة', 'ربحية منخفضة', 'سلبية', 'خسائر', 'ضغط',
    'تخفيض', 'فشل', 'احتيال', 'تلاعب', 'استبعاد', 'حذف', 'مخالفة', 'جزاء',
    'تحذير', 'مخاطرة', 'انهيار', 'أزمة', 'تضخم', 'ركود', 'بطالة', 'عجز',
]

POSITIVE_WORDS_EN = [
    'profit', 'growth', 'expansion', 'dividend', 'upgrade', 'buy', 'overweight',
    'record', 'beat', 'exceed', 'strong', 'bullish', 'surge', 'rally', 'gain',
    'positive', 'outperform', 'opportunity', 'breakthrough', 'innovative',
]

NEGATIVE_WORDS_EN = [
    'loss', 'decline', 'debt', 'downgrade', 'sell', 'fraud', 'investigation',
    'weak', 'bearish', 'miss', 'below', 'drop', 'crash', 'negative', 'risk',
    'warning', 'concern', 'slump', 'plunge', 'collapse', 'default', 'bankrupt',
]

# Combined lists for fast matching
POSITIVE_WORDS = POSITIVE_WORDS_AR + POSITIVE_WORDS_EN
NEGATIVE_WORDS = NEGATIVE_WORDS_AR + NEGATIVE_WORDS_EN


# ============================================================================
# KEYWORD-BASED SENTIMENT (always works, instant)
# ============================================================================

def get_sentiment_score(text: str) -> float:
    """
    Fast keyword-based sentiment. Returns 20-80 (50=neutral).
    
    Counts how many words in the text match positive/negative keywords,
    then computes a score with +5 per positive match and -5 per negative match,
    clamped to the 20-80 range.
    """
    if not text or not isinstance(text, str):
        # NEUTRAL DEFAULT (50.0) — semantic neutral, not fabrication (Rule 27 exception for scoring)
        return 50.0

    # Normalize: lowercase for English matching
    lower_text = text.lower()
    words = lower_text.split()

    pos_count = sum(
        1 for w in words
        if any(p in w for p in POSITIVE_WORDS)
    )
    neg_count = sum(
        1 for w in words
        if any(n in w for n in NEGATIVE_WORDS)
    )

    # Base 50, ±5 per keyword hit
    base = 50 + (pos_count - neg_count) * 5

    # Clamp to 20-80 range (never extreme from keywords alone)
    return max(20.0, min(80.0, float(base)))


# ============================================================================
# OLLAMA AI-ENHANCED SENTIMENT (optional, ~2s per stock)
# ============================================================================
# GLM-FAST-UNIFY: قراءة الموديل و URL من env (المصدر الموحّد في glm_finance_agent.py).
# أولوية OLLAMA_BASE_URL → OLLAMA_URL، و OLLAMA_MODEL → LOCAL_AI_MODEL → glm-fast:latest.
import os as _os
OLLAMA_URL = _os.environ.get("OLLAMA_BASE_URL") or _os.environ.get("OLLAMA_URL", "http://127.0.0.1:11434")
OLLAMA_MODEL = (
    _os.environ.get("OLLAMA_MODEL")
    or _os.environ.get("LOCAL_AI_MODEL")
    or "glm-fast:latest"
)


async def analyze_news_sentiment(ticker: str, news_list: list) -> dict:
    """
    Use Ollama to analyze news sentiment for a stock.
    
    Falls back to keyword-based sentiment if Ollama is unavailable.
    
    Args:
        ticker: Stock ticker symbol (e.g. "COMI")
        news_list: List of dicts with 'title' and 'summary' keys
    
    Returns:
        dict with keys: score (20-80), summary (str), confidence (0-1), source (str)
    """
    import httpx

    if not news_list:
        return {
            'score': 50,
            'summary': 'لا توجد أخبار',
            'confidence': 0.0,
            'source': 'none',
        }

    # Build news summary (max 500 chars)
    news_text = ' | '.join(
        f"- {n.get('title', '')}: {n.get('summary', '')[:100]}"
        for n in news_list[:10]
    )[:500]

    prompt = f"""حلل أخبار السهم {ticker} وحدد:
1. هل الأخبار إيجابية أم سلبية؟
2. ما نسبة الثقة (0-100)؟

الأخبار:
{news_text}

أجب بتنسيق JSON فقط:
{{"sentiment": "positive" أو "negative" أو "neutral", "score": 0-100, "confidence": 0-100, "reason": "سبب مختصر بالعربي"}}"""

    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.post(
                f"{OLLAMA_URL}/api/generate",
                json={
                    "model": OLLAMA_MODEL,
                    "prompt": prompt,
                    "stream": False,
                    "options": {"temperature": 0.1},
                },
            )
            result = response.json()
            text = result.get('response', '')

            # Parse JSON from response (model might wrap it in markdown)
            start = text.find('{')
            end = text.rfind('}') + 1
            if start >= 0 and end > start:
                data = json.loads(text[start:end])

                # Map sentiment + confidence to 20-80 score
                score = 50.0
                confidence_raw = data.get('confidence', 50)
                if data.get('sentiment') == 'positive':
                    score = 50 + confidence_raw * 0.3
                elif data.get('sentiment') == 'negative':
                    score = 50 - confidence_raw * 0.3

                return {
                    'score': max(20.0, min(80.0, score)),
                    'summary': data.get('reason', ''),
                    'confidence': confidence_raw / 100.0,
                    'source': 'ollama',
                }
    except Exception:
        pass  # Fall through to keyword-based

    # Fallback: keyword-based
    all_text = ' '.join(
        n.get('title', '') + ' ' + n.get('summary', '')
        for n in news_list
    )
    score = get_sentiment_score(all_text)
    return {
        'score': score,
        'summary': 'تحليل بالكلمات المفتاحية',
        'confidence': 0.5,
        'source': 'keywords',
    }


# ============================================================================
# INTEGRATION FUNCTION — reads from news.db.market_news (canonical)
# ============================================================================
# DATA-ENGINE-UNIFY-1 / News Stage 2: read from news.db.market_news (canonical)
# Was reading a phantom table in stocks.db (never existed there).

def get_market_news_sentiment(ticker: str, db=None) -> dict:
    """
    Get sentiment from news stored in news.db for a ticker.
    
    This is the synchronous entry point used by master_analyzer.py.
    It reads recent news from news.db.market_news and applies keyword-based
    sentiment scoring (fast, no network required).
    
    Args:
        ticker: Stock ticker symbol
        db: Optional DatabaseManager instance (will auto-create pointing at news.db)
    
    Returns:
        dict with keys: score (20-80), summary (str), confidence (0-1),
                        source (str), news_count (int)
    """
    if db is None:
        try:
            from core.database import DatabaseManager
            from utils.db_paths import DBPaths
            # DATA-ENGINE-UNIFY-1 / News Stage 2: point at news.db (canonical)
            db = DatabaseManager(db_path=DBPaths.NEWS_DB)
        except Exception:
            return {
                'score': 50,
                'summary': 'قاعدة البيانات غير متاحة',
                'confidence': 0.0,
                'source': 'none',
                'news_count': 0,
            }

    try:
        # DATA-ENGINE-UNIFY-1 / News Stage 2: read from news.db.market_news (canonical)
        # tickers column = JSON array (e.g. ["COMI"]) → filter with LIKE.
        # summary_ar is the canonical Arabic summary column.
        news = db.execute_query(
            "SELECT title, summary_ar AS summary FROM market_news "
            "WHERE tickers LIKE ? "
            "AND published_at > datetime('now', '-7 days') "
            "ORDER BY published_at DESC LIMIT 10",
            (f'%"{ticker}"%',),
        )

        if news:
            all_text = ' '.join(
                f"{n['title']} {n.get('summary', '')}"
                for n in news
            )
            score = get_sentiment_score(all_text)
            return {
                'score': score,
                'summary': f'تحليل {len(news)} خبر بالكلمات المفتاحية',
                'confidence': 0.6,
                'source': 'keywords',
                'news_count': len(news),
            }
    except Exception:
        pass

    return {
        'score': 50,
        'summary': 'لا توجد أخبار حديثة',
        'confidence': 0.0,
        'source': 'none',
        'news_count': 0,
    }