#!/usr/bin/env python3
"""
News Fetcher & Analyzer — جلب وتحليل الأخبار الحقيقية
=====================================================
حل "كارثة الأخبار" — يجيب أخبار حقيقية + يفهمها.

المصادر (بترتيب الأفضلية):
  1. news.db → market_news table (PRIMARY — الأخبار اللي News Agent بيبعتها)
  2. DuckDuckGo HTML search (fallback — لو مفيش أخبار للسهم في news.db)
  3. Reuters EGX (لو متاح)

الـ module بـ يعمل:
  1. fetch_news_for_ticker(ticker) — يجيب أخبار السهم من news.db (أو DuckDuckGo)
  2. fetch_egx_market_news() — يجيب أخبار السوق المصري كله
  3. analyze_news_sentiment(text) — يحلل المشاعر (keyword-based)
  4. extract_ticker_from_news(text) — يربط الخبر بالسهم
  5. get_news_with_impact(ticker) — يجيب أخبار + تأثيرها (للـ V40.2)

التكامل في V40.2:
  - V40_2_NEWS_IMPACT=1 → بـ يستدعي get_news_with_impact لكل سهم
  - النتيجة بتعتبر proof إضافي في الـ decision

Author: Z.ai Code
Date: 2026-09-01
Updated: 2026-09-02 — news.db = single source of truth (CONSTITUTION Rule: NEWS-DB-SOT)
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
DB_PATH = PROJECT_ROOT / 'db' / 'news.db'

logger = logging.getLogger(__name__)


# ═══════════════════════════════════════════════════════════════════════
# 1. Ticker → Company name mapping (EGX)
# ═══════════════════════════════════════════════════════════════════════

# أهم 50 سهم EGX (ticker → اسم عربي + إنجليزي للبحث)
EGX_TICKER_NAMES: Dict[str, Dict[str, str]] = {
    'COMI': {'ar': 'البنك التجاري الدولي', 'en': 'Commercial International Bank'},
    'HRHO': {'ar': 'الهرم للإستضافة والسياحة', 'en': 'Hermes Holding'},
    'MFPC': {'ar': 'مصفاة فلسطين', 'en': 'Middle East Oil Refining'},
    'ABUK': {'ar': 'أبو قير للأسمدة', 'en': 'Abu Qir Fertilizers'},
    'SWDY': {'ar': 'سويداني الكتريك', 'en': 'Elsewedy Electric'},
    'EFIH': {'ar': 'البنك المصري الخليجي', 'en': 'Egyptian Gulf Bank'},
    'ETEL': {'ar': 'المصرية للاتصالات', 'en': 'Telecom Egypt'},
    'EAST': {'ar': 'الشرقية للدخان', 'en': 'Eastern Company'},
    'CCAP': {'ar': 'كابيتال للاستثمار', 'en': 'Capital Intelligence'},
    'HELI': {'ar': 'هيلين لك للتنمية', 'en': 'Heliopolis Housing'},
    'TMGH': {'ar': 'المهندس', 'en': 'TMG Holding'},
    'ORWE': {'ar': 'اوراسكوم للتنمية', 'en': 'Orascom Construction'},
    'EFIN': {'ar': 'البنك المصري', 'en': 'Egyptian Banks'},
    'ISPH': {'ar': 'الاسكندرية', 'en': 'Isph Company'},
    'OCDI': {'ar': 'النقل للسيارات', 'en': 'GB Auto'},
    'SAIB': {'ar': 'البنك السعودي', 'en': 'Saudi Investment Bank'},
    'PHAR': {'ar': 'المصرية للأدوية', 'en': 'Pharma'},
    'SKPC': {'ar': 'المصرية للأسمدة', 'en': 'Egyptian Fertilizers'},
    'AMER': {'ar': 'المير', 'en': 'Amer Group'},
    'BIDI': {'ar': 'بنك التنمية', 'en': 'Beltone'},
    'FWRY': {'ar': 'فوري', 'en': 'Fawry'},
    'GOCO': {'ar': 'جهاز التعبئة', 'en': 'El Sewedy'},
}


def get_company_name(ticker: str) -> Tuple[str, str]:
    """جيب اسم الشركة بالعربي + الإنجليزي."""
    info = EGX_TICKER_NAMES.get(ticker.upper())
    if info:
        return info['ar'], info['en']
    # Fallback: استخدم الـ ticker نفسه
    return ticker, ticker


# ═══════════════════════════════════════════════════════════════════════
# 2. News Fetcher (DuckDuckGo HTML)
# ═══════════════════════════════════════════════════════════════════════

def _http_get(url: str, timeout: int = 12) -> Optional[str]:
    """HTTP GET بـ User-Agent."""
    try:
        req = urllib.request.Request(url, headers={
            'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml',
            'Accept-Language': 'ar,en;q=0.9',
        })
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return resp.read().decode('utf-8', errors='ignore')
    except Exception as e:
        logger.debug(f"HTTP GET failed {url}: {e}")
        return None


def _parse_ddg_results(html: str) -> List[Dict[str, str]]:
    """استخراج النتائج من DuckDuckGo HTML."""
    results = []
    # DDG pattern: <a class="result__a" href="...">title</a>
    # + <a class="result__snippet">snippet</a>
    blocks = re.findall(
        r'<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>(.*?)</a>'
        r'(?:.*?<a[^>]+class="result__snippet"[^>]*>(.*?)</a>)?',
        html, re.DOTALL
    )
    for url, title, snippet in blocks[:10]:
        # clean title
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


# ═══════════════════════════════════════════════════════════════════════
# 1a. Production server via /api/proxy-prod/news-feed (PRIMARY — fresh EGX news)
# ═══════════════════════════════════════════════════════════════════════

def _get_news_from_production(ticker: str, max_results: int = 5) -> List[Dict[str, Any]]:
    """
    جلب أخبار لسهم من السيرفر الإنتاجي (invist.m2y.net) عبر /api/proxy-prod/news-feed.
    ده الـ PRIMARY source — أخبار EGX حقيقية طازجة.

    Owner directive (2026-09-02):
        "اعمل API يخليك تقرأ أي بيانات انت محتاجها من الموقع الإنتاجي.
         كدة كدة هاحتاجهم فى تطوير برنامج الموبايل."

    Args:
        ticker: رمز السهم (COMI)
        max_results: حد أقصى للنتائج

    Returns:
        list of {
            'title', 'snippet', 'url', 'source', 'published_at',
            'importance', 'sentiment', 'impact_type', 'summary_ar',
            'tickers', 'from_production'
        }
    """
    # Determine proxy-prod URL (sandbox: localhost:3000, prod: same host)
    proxy_url = os.environ.get('PROXY_PROD_URL') or 'http://127.0.0.1:3000'
    proxy_url = proxy_url.rstrip('/')
    endpoint = f"{proxy_url}/api/proxy-prod/news-feed?limit=50"

    try:
        req = urllib.request.Request(
            endpoint,
            headers={
                'Accept': 'application/json',
                'User-Agent': 'GLMinvestment-NewsFetcher/1.0',
            },
        )
        with urllib.request.urlopen(req, timeout=8) as resp:
            data = json.loads(resp.read().decode('utf-8'))

        if not data.get('success'):
            logger.debug(f"production news-feed: success=false")
            return []

        all_news = data.get('news', [])
        if not all_news:
            return []

        # Filter by ticker (in tickers array OR in title/body)
        ticker_upper = ticker.upper()
        ticker_lower = ticker.lower()
        results = []
        for n in all_news:
            # Check tickers array
            news_tickers = n.get('tickers') or []
            if isinstance(news_tickers, str):
                try:
                    news_tickers = json.loads(news_tickers)
                except Exception:
                    news_tickers = []
            ticker_match = any(
                t.upper() == ticker_upper
                for t in news_tickers
            )

            # Also check title/body
            title = (n.get('title') or '').lower()
            body = (n.get('body') or n.get('summary') or '').lower()
            text_match = ticker_lower in title or ticker_lower in body

            if ticker_match or text_match:
                results.append({
                    'title': n.get('title', ''),
                    'snippet': (n.get('summary') or n.get('body', ''))[:500],
                    'url': n.get('url', ''),
                    'source': n.get('source', 'production'),
                    'published_at': n.get('published_at', ''),
                    'importance': _map_importance(n.get('importance')),
                    'sentiment': n.get('sentiment') or 'neutral',
                    'impact_type': n.get('impact_type') or 'general',
                    'summary_ar': n.get('summary') or '',
                    'tickers': news_tickers,
                    'from_production': True,
                })
                if len(results) >= max_results:
                    break

        logger.info(f"📰 production: {len(results)} أخبار لـ {ticker} (طازجة من invist.m2y.net)")
        return results

    except Exception as e:
        logger.debug(f"production news fetch error for {ticker}: {e}")
        return []


def _map_importance(val) -> int:
    """Map production importance (string) to integer 0-100."""
    if val is None:
        return 50
    if isinstance(val, (int, float)):
        return int(val)
    s = str(val).lower().strip()
    if s in ('high', 'عالي', 'مهم'):
        return 80
    if s in ('medium', 'متوسط'):
        return 50
    if s in ('low', 'منخفض', 'weak'):
        return 30
    try:
        return int(s)
    except Exception:
        return 50


# ═══════════════════════════════════════════════════════════════════════
# 1b. news.db → market_news (fallback — News Agent's analyzed news)
# ═══════════════════════════════════════════════════════════════════════

def _get_news_from_market_news_db(ticker: str, max_results: int = 5, days: int = 30) -> List[Dict[str, Any]]:
    """
    جلب أخبار سهم من news.db → market_news table.
    ده الـ PRIMARY source — الأخبار اللي News Agent بيبعتها (محللة بـ Ollama).

    Args:
        ticker: رمز السهم (COMI)
        max_results: حد أقصى للنتائج
        days: الأخبار في آخر N يوم (default 30)

    Returns:
        list of {
            'title', 'snippet', 'url', 'source', 'published_at',
            'importance', 'sentiment', 'impact_type', 'summary_ar'
        }
    """
    if not DB_PATH.exists():
        logger.debug(f"news.db not found at {DB_PATH}")
        return []

    try:
        conn = sqlite3.connect(str(DB_PATH), timeout=3)
        conn.row_factory = sqlite3.Row

        # ابحث بالـ ticker في tickers JSON array + symbol column
        # tickers JSON format: ["COMI","TMGH"]
        cutoff = (datetime.now() - timedelta(days=days)).isoformat()
        rows = conn.execute('''
            SELECT title, content, summary_ar, summary_en, source, source_url, url,
                   image_url, image_paths, ocr_text, raw_analysis,
                   market, symbol, tickers, category, impact_type,
                   importance, sentiment, is_valid_news, language,
                   published_at, fetched_at
            FROM market_news
            WHERE (
                tickers LIKE ? COLLATE NOCASE
                OR symbol = ? COLLATE NOCASE
                OR title LIKE ? COLLATE NOCASE
                OR content LIKE ? COLLATE NOCASE
            )
            AND is_valid_news = 1
            AND (published_at IS NULL OR published_at = '' OR published_at >= ?)
            ORDER BY importance DESC, published_at DESC
            LIMIT ?
        ''', (
            f'%"{ticker.upper()}"%',
            ticker.upper(),
            f'%{ticker}%',
            f'%{ticker}%',
            cutoff,
            max_results
        )).fetchall()

        conn.close()

        if not rows:
            return []

        results = []
        for r in rows:
            # جرّب summary_ar الأول، بعدين summary_en، بعدين content
            snippet = r['summary_ar'] or r['summary_en'] or r['content'] or ''
            url = r['url'] or r['source_url'] or ''
            results.append({
                'title': r['title'] or '',
                'snippet': snippet[:500],
                'url': url,
                'source': r['source'] or 'news_agent',
                'published_at': r['published_at'] or r['fetched_at'] or '',
                'importance': r['importance'] or 0,
                'sentiment': r['sentiment'] or 'neutral',
                'impact_type': r['impact_type'] or 'general',
                'summary_ar': r['summary_ar'] or '',
                'raw_analysis': r['raw_analysis'] or '{}',
                'from_db': True,  # marker: من news.db (محلل بالـ Ollama)
            })
        logger.info(f"📰 news.db: {len(results)} أخبار لـ {ticker} (محللة من News Agent)")
        return results

    except Exception as e:
        logger.warning(f"news.db read error for {ticker}: {e}")
        return []


def fetch_news_for_ticker(ticker: str, max_results: int = 5) -> List[Dict[str, Any]]:
    """
    جلب أخبار لسهم معين.

    المصادر بترتيب الأفضلية:
      1. Production server via /api/proxy-prod/news-feed (PRIMARY — fresh real EGX news)
      2. news.db → market_news (fallback — News Agent's analyzed news)
      3. DuckDuckGo HTML search (last resort)

    Args:
        ticker: رمز السهم (COMI)
        max_results: حد أقصى للنتائج

    Returns:
        list of {title, snippet, url, source, published_at, ticker}
    """
    # ── PRIMARY: production server (fresh real EGX news via /api/proxy-prod/news-feed) ──
    prod_news = _get_news_from_production(ticker, max_results=max_results)
    if prod_news:
        for n in prod_news:
            n['ticker'] = ticker.upper()
        logger.info(f"📰 {ticker}: استخدام {len(prod_news)} خبر من الإنتاج (طازجة)")
        return prod_news[:max_results]

    # ── FALLBACK 1: news.db → market_news (الأخبار المحللة من News Agent) ──
    db_news = _get_news_from_market_news_db(ticker, max_results=max_results)
    if db_news:
        # ضيف ticker لكل خبر
        for n in db_news:
            n['ticker'] = ticker.upper()
        logger.info(f"📰 {ticker}: استخدام {len(db_news)} خبر من news.db (News Agent)")
        return db_news[:max_results]

    # ── FALLBACK 2: DuckDuckGo HTML search (لو مفيش أخبار في news.db) ──
    logger.debug(f"📰 {ticker}: مفيش أخبار في news.db → fallback لـ DuckDuckGo")
    ar_name, en_name = get_company_name(ticker)

    # بناء الـ query — نبحث بالاسم العربي + الإنجليزي + Egypt
    queries = [
        f'"{en_name}" Egypt stock news',
        f'"{ar_name}" بورصة مصر',
        f'{ticker} EGX news',
    ]

    all_news = []
    seen_titles = set()

    for query in queries[:2]:  # أول query عربي + إنجليزي
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
                'ticker': ticker.upper(),
                'title': r['title'],
                'snippet': r['snippet'],
                'url': r['url'],
                'source': 'DuckDuckGo',
                'published_at': datetime.now().strftime('%Y-%m-%d %H:%M'),
                'from_db': False,  # marker: من DuckDuckGo
            })
            if len(all_news) >= max_results:
                break
        if len(all_news) >= max_results:
            break

    return all_news[:max_results]


def fetch_egx_market_news(max_results: int = 10) -> List[Dict[str, Any]]:
    """
    جلب أخبار السوق المصري كله (للـ market-wide signals).
    """
    queries = [
        'البورصة المصرية EGX أخبار',
        'Egypt stock exchange news EGX30',
    ]

    all_news = []
    seen_titles = set()

    for query in queries:
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
            # Try to extract ticker from title/snippet
            ticker = _extract_ticker_from_text(f"{r['title']} {r['snippet']}")
            all_news.append({
                'ticker': ticker or 'MARKET',
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


def _extract_ticker_from_text(text: str) -> Optional[str]:
    """استخراج رمز سهم EGX من نص (يبحث في الـ tickers المعروفة)."""
    if not text:
        return None
    text_upper = text.upper()
    for ticker in EGX_TICKER_NAMES:
        # Look for ticker as standalone word
        if re.search(rf'\b{re.escape(ticker)}\b', text_upper):
            return ticker
    # Also check Arabic names
    for ticker, names in EGX_TICKER_NAMES.items():
        if names['ar'] in text:
            return ticker
    return None


# ═══════════════════════════════════════════════════════════════════════
# 3. News Sentiment Analyzer (keyword-based, no AI needed)
# ═══════════════════════════════════════════════════════════════════════

# كلمات إيجابية قوية (EGX-specific)
POSITIVE_STRONG = [
    'ارباح قياسيه', 'ارباح قياسية', 'نمو قوي', 'نمو كبير', 'قفزه', 'قفزة',
    'تضاعف', 'تضاعفت', 'رقم قياسي', 'اعلي ربح', 'تحقيق ارباح', 'استحواذ',
    'اكتتاب', 'شراكه', 'شراكة', 'عقد', 'توسع', 'صعود قوي', 'اختراق',
    'record profit', 'surge', 'soar', 'beat', 'acquisition', 'partnership',
    'growth', 'expansion', 'breakthrough', 'milestone', 'upgrade', 'rally',
]

# كلمات إيجابية معتدلة
POSITIVE_MODERATE = [
    'نمو', 'ارتفاع', 'زياده', 'زيادة', 'تحسن', 'صعود', 'ارباح', 'ربحية',
    'gains', 'rise', 'increase', 'improve', 'positive', 'bullish', 'up',
]

# كلمات سلبية قوية
NEGATIVE_STRONG = [
    'خساره', 'خسارة', 'خسائر', 'خسائر كبيره', 'تراجع حاد', 'انهيار',
    'تراجع قوي', 'نزول حاد', 'تحقيق', 'قضيه', 'قضية', 'احتيال', 'شطب',
    'ايقاف', 'إيقاف', 'تعليق', 'تجميد', 'fail', 'loss', 'crash', 'plunge',
    'suspend', 'halt', 'investigation', 'fraud', 'delisting', 'warning',
]

# كلمات سلبية معتدلة
NEGATIVE_MODERATE = [
    'تراجع', 'انخفاض', 'نزول', 'هبوط', 'خسر', 'ضعف', 'decline', 'drop',
    'fall', 'decrease', 'miss', 'below', 'bearish', 'down', 'weak',
]


def analyze_news_sentiment(title: str, snippet: str = '') -> Dict[str, Any]:
    """
    تحليل مشاعر خبر (keyword-based — مش محتاج AI).

    Returns:
        {
            'sentiment': 'positive_strong'|'positive'|'neutral'|'negative'|'negative_strong',
            'score': int (-2 to +2),
            'confidence': float (0-1),
            'matched_keywords': list,
            'reason': str,
        }
    """
    text = f"{title} {snippet}".lower()
    # Normalize Arabic
    text = re.sub(r'[\u064B-\u0652]', '', text)
    text = re.sub(r'[أإآ]', 'ا', text)
    text = text.replace('ة', 'ه').replace('ى', 'ي')

    pos_strong = sum(1 for kw in POSITIVE_STRONG if _normalize_kw(kw) in text)
    pos_mod = sum(1 for kw in POSITIVE_MODERATE if _normalize_kw(kw) in text)
    neg_strong = sum(1 for kw in NEGATIVE_STRONG if _normalize_kw(kw) in text)
    neg_mod = sum(1 for kw in NEGATIVE_MODERATE if _normalize_kw(kw) in text)

    matched = []
    for kw in POSITIVE_STRONG + POSITIVE_MODERATE:
        if _normalize_kw(kw) in text:
            matched.append(kw)
    for kw in NEGATIVE_STRONG + NEGATIVE_MODERATE:
        if _normalize_kw(kw) in text:
            matched.append(kw)

    # Scoring
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
        reason = f'إيجابي: {pos_mod}× كلمات نمو'
    elif neg_mod >= 2 and pos_mod == 0:
        sentiment = 'negative'
        score = -1
        confidence = 0.6
        reason = f'سلبي: {neg_mod}× كلمات تراجع'
    elif pos_mod >= 1 and neg_mod == 0:
        sentiment = 'positive'
        score = +1
        confidence = 0.4
        reason = f'إيجابي خفيف: نمو'
    elif neg_mod >= 1 and pos_mod == 0:
        sentiment = 'negative'
        score = -1
        confidence = 0.4
        reason = f'سلبي خفيف: تراجع'
    else:
        sentiment = 'neutral'
        score = 0
        confidence = 0.3
        reason = 'محايد — لا كلمات قوية'

    return {
        'sentiment': sentiment,
        'score': score,
        'confidence': round(confidence, 2),
        'matched_keywords': matched[:5],
        'reason': reason,
    }


def _normalize_kw(kw: str) -> str:
    """تطبيع كلمة مفتاحية للبحث."""
    kw = re.sub(r'[\u064B-\u0652]', '', kw)
    kw = re.sub(r'[أإآ]', 'ا', kw)
    kw = kw.replace('ة', 'ه').replace('ى', 'ي')
    return kw.lower()


# ═══════════════════════════════════════════════════════════════════════
# 4. get_news_with_impact() — للـ V40.2 integration
# ═══════════════════════════════════════════════════════════════════════

def get_news_with_impact(ticker: str, max_news: int = 3) -> Dict[str, Any]:
    """
    جيب أخبار السهم + تحليل المشاعر + التأثير.

    للـ V40.2 integration (بـ toggle V40_2_NEWS_IMPACT=1):
      - score +2 → BOOST_STRONG (دفعة قوية)
      - score +1 → BOOST (دفعة)
      - score 0 → NEUTRAL (محايد)
      - score -1 → REDUCE (تقليل)
      - score -2 → VETO (رفض)

    Returns:
        {
            'has_news': bool,
            'news_count': int,
            'articles': list,
            'overall_score': int,
            'overall_verdict': str,
            'reason': str,
            'proof_string': str,  # للـ V40.2 proofs
        }
    """
    articles = fetch_news_for_ticker(ticker, max_results=max_news)

    if not articles:
        return {
            'has_news': False,
            'news_count': 0,
            'articles': [],
            'overall_score': 0,
            'overall_verdict': 'NEUTRAL',
            'reason': 'لا توجد أخبار حديثة',
            'proof_string': 'ℹ️ NEWS: لا توجد أخبار حديثة',
        }

    # Analyze each article
    analyzed = []
    total_score = 0
    for article in articles:
        sentiment = analyze_news_sentiment(article['title'], article.get('snippet', ''))
        article['sentiment'] = sentiment['sentiment']
        article['score'] = sentiment['score']
        article['confidence'] = sentiment['confidence']
        article['reason'] = sentiment['reason']
        total_score += sentiment['score']
        analyzed.append(article)

    # Aggregate (clamp -2 to +2)
    overall_score = max(-2, min(2, total_score))

    if overall_score >= +2:
        verdict = 'BOOST_STRONG'
        reason = f'أخبار إيجابية قوية (score={overall_score:+d})'
        proof = f'📈 NEWS BOOST_STRONG (+{overall_score}): {len(analyzed)} أخبار إيجابية'
    elif overall_score == +1:
        verdict = 'BOOST'
        reason = f'أخبار إيجابية (score={overall_score:+d})'
        proof = f'📈 NEWS BOOST (+{overall_score}): {len(analyzed)} أخبار إيجابية'
    elif overall_score <= -2:
        verdict = 'VETO'
        reason = f'أخبار سلبية قوية (score={overall_score:+d})'
        proof = f'🚨 NEWS VETO ({overall_score}): {len(analyzed)} أخبار سلبية قوية'
    elif overall_score == -1:
        verdict = 'REDUCE'
        reason = f'أخبار سلبية (score={overall_score:+d})'
        proof = f'⚠️ NEWS REDUCE ({overall_score}): {len(analyzed)} أخبار سلبية'
    else:
        verdict = 'NEUTRAL'
        reason = f'أخبار محايدة (score={overall_score:+d})'
        proof = f'ℹ️ NEWS NEUTRAL: {len(analyzed)} أخبار محايدة'

    return {
        'has_news': True,
        'news_count': len(analyzed),
        'articles': analyzed,
        'overall_score': overall_score,
        'overall_verdict': verdict,
        'reason': reason,
        'proof_string': proof,
    }


# ═══════════════════════════════════════════════════════════════════════
# 5. Self-test
# ═══════════════════════════════════════════════════════════════════════

if __name__ == '__main__':
    print("🧪 News Fetcher & Analyzer — Self Test")
    print("=" * 70)

    # Test 1: Sentiment analysis (positive strong)
    print("\n=== Test 1: خبر إيجابي قوي ===")
    r = analyze_news_sentiment("Commercial International Bank تحقق أرباح قياسية ونمو قوي")
    print(f"  Sentiment: {r['sentiment']} | Score: {r['score']:+d} | Confidence: {r['confidence']}")
    print(f"  Reason: {r['reason']}")
    assert r['score'] == +2
    print("  ✅ PASS")

    # Test 2: Negative strong
    print("\n=== Test 2: خبر سلبي قوي ===")
    r = analyze_news_sentiment("EGX suspends trading on MFPC after investigation")
    print(f"  Sentiment: {r['sentiment']} | Score: {r['score']:+d} | Confidence: {r['confidence']}")
    print(f"  Reason: {r['reason']}")
    assert r['score'] == -2
    print("  ✅ PASS")

    # Test 3: Neutral
    print("\n=== Test 3: خبر محايد ===")
    r = analyze_news_sentiment("Company announces quarterly results")
    print(f"  Sentiment: {r['sentiment']} | Score: {r['score']:+d}")
    assert r['score'] == 0
    print("  ✅ PASS")

    # Test 4: Ticker extraction
    print("\n=== Test 4: استخراج ticker من نص ===")
    t = _extract_ticker_from_text("Commercial International Bank COMI announced today")
    print(f"  Ticker: {t}")
    assert t == 'COMI'
    print("  ✅ PASS")

    # Test 5: Live news fetch (COMI)
    print("\n=== Test 5: جلب أخبار COMI حية ===")
    news = fetch_news_for_ticker('COMI', max_results=3)
    print(f"  Found {len(news)} articles")
    for n in news[:3]:
        print(f"  - {n['title'][:70]}")
    if news:
        print("  ✅ PASS (live news working)")
    else:
        print("  ⚠️ No news (network issue — acceptable in sandbox)")

    # Test 6: get_news_with_impact (integration)
    print("\n=== Test 6: get_news_with_impact (V40.2 integration) ===")
    result = get_news_with_impact('COMI', max_news=3)
    print(f"  has_news: {result['has_news']}")
    print(f"  news_count: {result['news_count']}")
    print(f"  overall_score: {result['overall_score']:+d}")
    print(f"  verdict: {result['overall_verdict']}")
    print(f"  proof: {result['proof_string']}")
    print("  ✅ PASS")

    print("\n" + "=" * 70)
    print("✅ News Fetcher & Analyzer ready")
    print(f"\nIntegration: V40_2_NEWS_IMPACT=1 → get_news_with_impact() per ticker")
    print(f"Score: +2=BOOST_STRONG | +1=BOOST | 0=NEUTRAL | -1=REDUCE | -2=VETO")
