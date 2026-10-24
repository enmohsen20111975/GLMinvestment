"""
جامع أخبار من الويب
- يستورد من GLMinvestment مباشرة
- يستخرج صور المقالات
- مكافحة تكرار تلقائية
"""

import os
import json
import logging
import asyncio
import importlib.util
from datetime import datetime
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from config.sources import registry
from config.paths import resolve_vps_service
from collectors.keyword_filter import filter_instance

log = logging.getLogger('WebScraper')

PROJECT_ROOT = Path(__file__).resolve().parents[1]
GLM_VPS = resolve_vps_service()

_GLM_AVAILABLE = False
_GLM_IMPORT_ERROR = ''
EGX_TICKER_NAMES = {}
_fetch_news_for_ticker = None
_fetch_egx_market_news = None

MARKET_MAX_RESULTS = int(os.getenv('WEB_MARKET_RESULTS', '20'))
TICKER_MAX_RESULTS = int(os.getenv('WEB_TICKER_RESULTS', '5'))
MAX_TICKERS = int(os.getenv('WEB_MAX_TICKERS', '20'))

if GLM_VPS is None:
    _GLM_IMPORT_ERROR = (
        'vps-service غير موجود — تم البحث في: '
        f'{PROJECT_ROOT.parent / "vps-service"} و {PROJECT_ROOT / "vps-service"}'
    )
else:
    try:
        sys.path.insert(0, str(GLM_VPS / "analyzers"))
        nfa_path = GLM_VPS / "analyzers" / "news_fetcher_analyzer.py"
        spec = importlib.util.spec_from_file_location("news_fetcher_analyzer", nfa_path)
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)
        EGX_TICKER_NAMES = mod.EGX_TICKER_NAMES
        _fetch_news_for_ticker = mod.fetch_news_for_ticker
        _fetch_egx_market_news = mod.fetch_egx_market_news
        _GLM_AVAILABLE = True
    except Exception as e:
        _GLM_IMPORT_ERROR = f'فشل استيراد news_fetcher_analyzer من {nfa_path}: {type(e).__name__}: {e}'


def _resolve_ddg_url(url: str) -> str:
    """يحوّل رابط إعادة توجيه DuckDuckGo (أو رابط protocol-relative) لرابط حقيقي."""
    if not url:
        return ''
    raw = url.replace('&amp;', '&').strip()
    if raw.startswith('//'):
        raw = 'https:' + raw
    if 'duckduckgo.com/l/' in raw:
        try:
            from urllib.parse import unquote, urlparse, parse_qs
            params = parse_qs(urlparse(raw).query)
            if params.get('uddg'):
                return unquote(params['uddg'][0])
        except Exception:
            return raw
    return raw


class WebScraper:
    """يبحث عن أخبار البورصة على الإنترنت"""

    def __init__(self, store):
        self.store = store

    async def collect(self) -> int:
        """جمع أخبار من DuckDuckGo عبر GLMinvestment analyzer"""
        if not _GLM_AVAILABLE:
            log.warning("GLMinvestment news_fetcher غير متاح — %s", _GLM_IMPORT_ERROR)
            return 0

        total = 0
        loop = asyncio.get_event_loop()

        try:
            count = await loop.run_in_executor(None, self._fetch_market_news)
            total += count
        except Exception as e:
            log.warning(f"خطأ في جلب أخبار السوق: {e}")

        try:
            top_tickers = list(EGX_TICKER_NAMES.keys())[:MAX_TICKERS] if MAX_TICKERS > 0 else list(EGX_TICKER_NAMES.keys())
            for ticker in top_tickers:
                try:
                    count = await loop.run_in_executor(None, self._fetch_ticker_news, ticker)
                    total += count
                except Exception as e:
                    log.debug(f"خطأ جلب أخبار {ticker}: {e}")
        except Exception as e:
            log.warning(f"خطأ في جلب أخبار الأسهم: {e}")

        return total

    def _fetch_market_news(self) -> int:
        """جلب أخبار السوق المصري مع الصور"""
        saved = 0
        try:
            articles = _fetch_egx_market_news(max_results=MARKET_MAX_RESULTS)
            for article in articles:
                title = article.get('title', '')
                body = article.get('snippet', '') or title
                if not filter_instance.quick_match(f'{title}\n{body}'):
                    log.debug(f'WebScraper رفض: {title[:60]}')
                    continue
                raw_url = _resolve_ddg_url(article.get('url', ''))
                if 'Arabian_investment_guide' in raw_url or 'invist.m2y.net' in raw_url:
                    continue
                image_urls = self._extract_image_urls(article.get('url', ''))
                news_id = self.store.add(
                    source=registry.get_web_display('web_duckduckgo', 'بحث ويب'),
                    source_type='web',
                    body=body,
                    title=title,
                    url=raw_url,
                    published_at=article.get('published_at', ''),
                    image_urls=json.dumps(image_urls, ensure_ascii=False),
                )
                if news_id:
                    saved += 1
        except Exception as e:
            log.debug(f'DuckDuckGo market news error: {e}')
        return saved

    def _fetch_ticker_news(self, ticker: str) -> int:
        """جلب أخبار سهم معين مع الصور"""
        saved = 0
        try:
            articles = _fetch_news_for_ticker(ticker, max_results=TICKER_MAX_RESULTS)
            for article in articles:
                title = article.get('title', '')
                body = article.get('snippet', '') or title
                if not filter_instance.quick_match(f'{title}\n{body}'):
                    log.debug(f'WebScraper[{ticker}] رفض: {title[:60]}')
                    continue
                raw_url = _resolve_ddg_url(article.get('url', ''))
                if 'Arabian_investment_guide' in raw_url or 'invist.m2y.net' in raw_url:
                    continue
                image_urls = self._extract_image_urls(article.get('url', ''))
                news_id = self.store.add(
                    source=registry.get_web_display('web_duckduckgo', 'بحث ويب'),
                    source_type='web',
                    body=body,
                    title=title,
                    url=raw_url,
                    published_at=article.get('published_at', ''),
                    image_urls=json.dumps(image_urls, ensure_ascii=False),
                )
                if news_id:
                    saved += 1
        except Exception as e:
            log.debug(f'DuckDuckGo ticker news error for {ticker}: {e}')
        return saved

    def _extract_image_urls(self, url: str) -> list[str]:
        """استخراج صور من المقال (og:image + أول صورة في HTML)"""
        actual_url = _resolve_ddg_url(url)
        if not actual_url:
            return []
        try:
            import requests
            from bs4 import BeautifulSoup

            resp = requests.get(actual_url, timeout=12, headers={
                'User-Agent': 'Mozilla/5.0 (compatible; NewsBot/1.0)'
            })
            if resp.status_code != 200:
                return []
            soup = BeautifulSoup(resp.text, 'html.parser')
            images = []
            og = soup.find('meta', property='og:image')
            if og and og.get('content'):
                images.append(og['content'])
            twitter = soup.find('meta', attrs={'name': 'twitter:image'})
            if twitter and twitter.get('content'):
                images.append(twitter['image'])
            if not images:
                img = soup.find('img')
                if img and img.get('src'):
                    images.append(img['src'])
            return images[:3]
        except Exception:
            return []
