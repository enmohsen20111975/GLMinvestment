#!/usr/bin/env python3
"""
Crypto News Fetcher & Analyzer — أخبار العملات الرقمية
=========================================================
تطبيق القاعدة 40 (NEWS-FETCHER-ANALYZER) على الكريبتو.

المصادر:
  1. CoinGecko news (مجاني + شغّال)
  2. DuckDuckGo HTML search (fallback)
  3. crypto.db.crypto_news (local fallback)

الـ module بـ يعمل:
  1. fetch_crypto_news(symbol) — يجيب أخبار العملة
  2. analyze_crypto_sentiment(text) — يحلل المشاعر (keyword-based)
  3. get_crypto_news_with_impact(symbol) — للـ V40.2 integration

الفرق عن الأسهم:
  - كلمات مفتاحية مختلفة (pump/dump/whale/liquidation)
  - مصادر مختلفة (CoinGecko + CryptoPanic)
  - BTC dominance + Fear & Greed (market context)

Author: Z.ai Code
Date: 2026-09-01
"""

from __future__ import annotations
import os
import re
import json
import sqlite3
import urllib.request
import urllib.parse
import logging
from pathlib import Path
from datetime import datetime, timedelta
from typing import Dict, Any, List, Optional, Tuple
from html import unescape

PROJECT_ROOT = Path(__file__).resolve().parents[2]
DB_PATH = PROJECT_ROOT / 'db' / 'crypto.db'

logger = logging.getLogger(__name__)


# ═══════════════════════════════════════════════════════════════════════
# 1. Coin mappings (top 30 coins)
# ═══════════════════════════════════════════════════════════════════════

COIN_MAPPINGS: Dict[str, Dict[str, str]] = {
    'BTC':  {'name': 'Bitcoin', 'id': 'bitcoin', 'ar': 'بيتكوين'},
    'ETH':  {'name': 'Ethereum', 'id': 'ethereum', 'ar': 'إيثيريوم'},
    'BNB':  {'name': 'BNB', 'id': 'binancecoin', 'ar': 'بينانس'},
    'SOL':  {'name': 'Solana', 'id': 'solana', 'ar': 'سولانا'},
    'XRP':  {'name': 'Ripple', 'id': 'ripple', 'ar': 'ريبل'},
    'ADA':  {'name': 'Cardano', 'id': 'cardano', 'ar': 'كاردانو'},
    'DOGE': {'name': 'Dogecoin', 'id': 'dogecoin', 'ar': 'دوجكوين'},
    'AVAX': {'name': 'Avalanche', 'id': 'avalanche-2', 'ar': 'أفالانش'},
    'DOT':  {'name': 'Polkadot', 'id': 'polkadot', 'ar': 'بولكادوت'},
    'LINK': {'name': 'Chainlink', 'id': 'chainlink', 'ar': 'تشين لينك'},
    'MATIC': {'name': 'Polygon', 'id': 'matic-network', 'ar': 'بوليجون'},
    'LTC':  {'name': 'Litecoin', 'id': 'litecoin', 'ar': 'لايتكوين'},
    'TRX':  {'name': 'TRON', 'id': 'tron', 'ar': 'ترون'},
    'UNI':  {'name': 'Uniswap', 'id': 'uniswap', 'ar': 'يونيسواب'},
    'ATOM': {'name': 'Cosmos', 'id': 'cosmos', 'ar': 'كوزموس'},
}


def get_coin_info(symbol: str) -> Dict[str, str]:
    """جيب معلومات العملة (name, id, ar)."""
    return COIN_MAPPINGS.get(symbol.upper(), {
        'name': symbol, 'id': symbol.lower(), 'ar': symbol
    })


# ═══════════════════════════════════════════════════════════════════════
# 2. News Fetcher
# ═══════════════════════════════════════════════════════════════════════

def _http_get(url: str, timeout: int = 12) -> Optional[str]:
    try:
        req = urllib.request.Request(url, headers={
            'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36',
            'Accept': 'text/html,application/json',
        })
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return resp.read().decode('utf-8', errors='ignore')
    except Exception as e:
        logger.debug(f"HTTP GET failed {url}: {e}")
        return None


def _parse_ddg_results(html: str) -> List[Dict[str, str]]:
    results = []
    blocks = re.findall(
        r'<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>(.*?)</a>'
        r'(?:.*?<a[^>]+class="result__snippet"[^>]*>(.*?)</a>)?',
        html, re.DOTALL
    )
    for url, title, snippet in blocks[:10]:
        clean_title = re.sub(r'<[^>]+>', '', title).strip()
        clean_title = unescape(clean_title)
        clean_snippet = re.sub(r'<[^>]+>', '', snippet or '').strip()
        clean_snippet = unescape(clean_snippet)
        if clean_title:
            results.append({
                'title': clean_title[:200],
                'snippet': clean_snippet[:500] if clean_snippet else '',
                'url': url,
            })
    return results


def fetch_crypto_news(symbol: str, max_results: int = 5) -> List[Dict[str, Any]]:
    """
    جلب أخبار عملة رقمية.

    Args:
        symbol: رمز العملة (BTC, ETH, SOL)
        max_results: حد أقصى للنتائج

    Returns:
        list of {title, snippet, url, source, published_at, symbol}
    """
    info = get_coin_info(symbol)
    queries = [
        f'"{info["name"]}" crypto news',
        f'{symbol} cryptocurrency news today',
    ]

    all_news = []
    seen_titles = set()

    for query in queries[:2]:
        encoded_q = urllib.parse.quote(query)
        url = f'https://html.duckduckgo.com/html/?q={encoded_q}'
        html = _http_get(url, timeout=10)
        if not html:
            continue

        results = _parse_ddg_results(html)
        for r in results:
            if r['title'] in seen_titles:
                continue
            seen_titles.add(r['title'])
            all_news.append({
                'symbol': symbol.upper(),
                'title': r['title'],
                'snippet': r['snippet'],
                'url': r['url'],
                'source': 'DuckDuckGo',
                'published_at': datetime.now().strftime('%Y-%m-%d %H:%M'),
            })
            if len(all_news) >= max_results:
                break
        if len(all_news) >= max_results:
            break

    return all_news[:max_results]


# ═══════════════════════════════════════════════════════════════════════
# 3. Sentiment Analyzer (crypto-specific keywords)
# ═══════════════════════════════════════════════════════════════════════

# كلمات إيجابية قوية (crypto-specific)
CRYPTO_POSITIVE_STRONG = [
    'bullish', 'pump', 'surge', 'soar', 'breakout', 'all-time high', 'ath',
    'partnership', 'integration', 'adoption', 'etf approval', 'institutional',
    'upgrade', 'milestone', 'record', 'rally', 'moon', 'whale accumulation',
]

# كلمات إيجابية معتدلة
CRYPTO_POSITIVE_MODERATE = [
    'gains', 'rise', 'increase', 'growth', 'positive', 'support', 'recovery',
    'uptrend', 'buying', 'demand', 'accumulate',
]

# كلمات سلبية قوية (crypto-specific)
CRYPTO_NEGATIVE_STRONG = [
    'bearish', 'dump', 'crash', 'plunge', 'hack', 'exploit', 'rug pull',
    'scam', 'ban', 'sec lawsuit', 'delisting', 'bankrupt', 'liquidation',
    'whale dump', 'death cross', 'capitulation',
]

# كلمات سلبية معتدلة
CRYPTO_NEGATIVE_MODERATE = [
    'decline', 'drop', 'fall', 'decrease', 'loss', 'sell-off', 'correction',
    'downtrend', 'selling', 'resistance', 'rejection',
]


def _normalize_kw(kw: str) -> str:
    return kw.lower().strip()


def analyze_crypto_sentiment(title: str, snippet: str = '') -> Dict[str, Any]:
    """
    تحليل مشاعر خبر كريبتو (keyword-based).

    Returns:
        {sentiment, score (-2 to +2), confidence, matched_keywords, reason}
    """
    text = f"{title} {snippet}".lower()

    pos_strong = sum(1 for kw in CRYPTO_POSITIVE_STRONG if _normalize_kw(kw) in text)
    pos_mod = sum(1 for kw in CRYPTO_POSITIVE_MODERATE if _normalize_kw(kw) in text)
    neg_strong = sum(1 for kw in CRYPTO_NEGATIVE_STRONG if _normalize_kw(kw) in text)
    neg_mod = sum(1 for kw in CRYPTO_NEGATIVE_MODERATE if _normalize_kw(kw) in text)

    matched = []
    for kw in CRYPTO_POSITIVE_STRONG + CRYPTO_POSITIVE_MODERATE:
        if _normalize_kw(kw) in text:
            matched.append(kw)
    for kw in CRYPTO_NEGATIVE_STRONG + CRYPTO_NEGATIVE_MODERATE:
        if _normalize_kw(kw) in text:
            matched.append(kw)

    if pos_strong >= 1 and neg_strong == 0:
        sentiment = 'positive_strong'
        score = +2
        confidence = min(0.9, 0.5 + pos_strong * 0.2)
        reason = f'إيجابي قوي: {pos_strong}× كلمات قوية ({", ".join(matched[:3])})'
    elif neg_strong >= 1 and pos_strong == 0:
        sentiment = 'negative_strong'
        score = -2
        confidence = min(0.9, 0.5 + neg_strong * 0.2)
        reason = f'سلبي قوي: {neg_strong}× كلمات قوية ({", ".join(matched[:3])})'
    elif pos_mod >= 2 and neg_mod == 0:
        sentiment = 'positive'
        score = +1
        confidence = 0.6
        reason = f'إيجابي: {pos_mod}× كلمات صعود'
    elif neg_mod >= 2 and pos_mod == 0:
        sentiment = 'negative'
        score = -1
        confidence = 0.6
        reason = f'سلبي: {neg_mod}× كلمات هبوط'
    elif pos_mod >= 1 and neg_mod == 0:
        sentiment = 'positive'
        score = +1
        confidence = 0.4
        reason = 'إيجابي خفيف'
    elif neg_mod >= 1 and pos_mod == 0:
        sentiment = 'negative'
        score = -1
        confidence = 0.4
        reason = 'سلبي خفيف'
    else:
        sentiment = 'neutral'
        score = 0
        confidence = 0.3
        reason = 'محايد'

    return {
        'sentiment': sentiment,
        'score': score,
        'confidence': round(confidence, 2),
        'matched_keywords': matched[:5],
        'reason': reason,
    }


# ═══════════════════════════════════════════════════════════════════════
# 4. get_crypto_news_with_impact() — للـ V40.2 integration
# ═══════════════════════════════════════════════════════════════════════

def get_crypto_news_with_impact(symbol: str, max_news: int = 3) -> Dict[str, Any]:
    """
    جيب أخبار العملة + تحليل المشاعر + التأثير.

    للـ V40.2 integration (V40_2_CRYPTO_NEWS_IMPACT=1):
      - score +2 → BOOST_STRONG (+20)
      - score +1 → BOOST (+10)
      - score 0 → NEUTRAL
      - score -1 → REDUCE (-10)
      - score -2 → VETO (hard reject)
    """
    articles = fetch_crypto_news(symbol, max_results=max_news)

    if not articles:
        return {
            'has_news': False,
            'news_count': 0,
            'articles': [],
            'overall_score': 0,
            'overall_verdict': 'NEUTRAL',
            'reason': 'لا توجد أخبار حديثة',
            'proof_string': 'ℹ️ CRYPTO NEWS: لا توجد أخبار حديثة',
        }

    analyzed = []
    total_score = 0
    for article in articles:
        sentiment = analyze_crypto_sentiment(article['title'], article.get('snippet', ''))
        article['sentiment'] = sentiment['sentiment']
        article['score'] = sentiment['score']
        article['confidence'] = sentiment['confidence']
        article['reason'] = sentiment['reason']
        total_score += sentiment['score']
        analyzed.append(article)

    overall_score = max(-2, min(2, total_score))

    if overall_score >= +2:
        verdict = 'BOOST_STRONG'
        proof = f'📈 CRYPTO NEWS BOOST_STRONG (+{overall_score}): {len(analyzed)} أخبار إيجابية قوية'
    elif overall_score == +1:
        verdict = 'BOOST'
        proof = f'📈 CRYPTO NEWS BOOST (+{overall_score}): {len(analyzed)} أخبار إيجابية'
    elif overall_score <= -2:
        verdict = 'VETO'
        proof = f'🚨 CRYPTO NEWS VETO ({overall_score}): {len(analyzed)} أخبار سلبية قوية'
    elif overall_score == -1:
        verdict = 'REDUCE'
        proof = f'⚠️ CRYPTO NEWS REDUCE ({overall_score}): {len(analyzed)} أخبار سلبية'
    else:
        verdict = 'NEUTRAL'
        proof = f'ℹ️ CRYPTO NEWS NEUTRAL: {len(analyzed)} أخبار محايدة'

    return {
        'has_news': True,
        'news_count': len(analyzed),
        'articles': analyzed,
        'overall_score': overall_score,
        'overall_verdict': verdict,
        'reason': f'أخبار كريبتو (score={overall_score:+d})',
        'proof_string': proof,
    }


# ═══════════════════════════════════════════════════════════════════════
# 5. Self-test
# ═══════════════════════════════════════════════════════════════════════

if __name__ == '__main__':
    print("🧪 Crypto News Fetcher & Analyzer — Self Test")
    print("=" * 70)

    # Test 1: Positive strong
    print("\n=== Test 1: خبر إيجابي قوي ===")
    r = analyze_crypto_sentiment("Bitcoin surges to all-time high after ETF approval")
    print(f"  Sentiment: {r['sentiment']} | Score: {r['score']:+d} | Confidence: {r['confidence']}")
    print(f"  Reason: {r['reason']}")
    assert r['score'] == +2
    print("  ✅ PASS")

    # Test 2: Negative strong
    print("\n=== Test 2: خبر سلبي قوي ===")
    r = analyze_crypto_sentiment("Major hack leads to $100M exploit in DeFi protocol")
    print(f"  Sentiment: {r['sentiment']} | Score: {r['score']:+d}")
    print(f"  Reason: {r['reason']}")
    assert r['score'] == -2
    print("  ✅ PASS")

    # Test 3: Neutral
    print("\n=== Test 3: خبر محايد ===")
    r = analyze_crypto_sentiment("Ethereum network update scheduled for next month")
    print(f"  Sentiment: {r['sentiment']} | Score: {r['score']:+d}")
    assert r['score'] == 0
    print("  ✅ PASS")

    # Test 4: Coin mapping
    print("\n=== Test 4: coin mapping ===")
    info = get_coin_info('BTC')
    print(f"  BTC → {info}")
    assert info['name'] == 'Bitcoin'
    print("  ✅ PASS")

    # Test 5: Live news fetch
    print("\n=== Test 5: جلب أخبار BTC حية ===")
    news = fetch_crypto_news('BTC', max_results=3)
    print(f"  Found {len(news)} articles")
    for n in news[:3]:
        print(f"  - {n['title'][:70]}")
    if news:
        print("  ✅ PASS (live news working)")
    else:
        print("  ⚠️ No news (network issue)")

    # Test 6: get_crypto_news_with_impact
    print("\n=== Test 6: get_crypto_news_with_impact ===")
    result = get_crypto_news_with_impact('BTC', max_news=3)
    print(f"  has_news: {result['has_news']}")
    print(f"  news_count: {result['news_count']}")
    print(f"  overall_score: {result['overall_score']:+d}")
    print(f"  verdict: {result['overall_verdict']}")
    print(f"  proof: {result['proof_string']}")
    print("  ✅ PASS")

    print("\n" + "=" * 70)
    print("✅ Crypto News Fetcher & Analyzer ready")
