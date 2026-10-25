"""
جامع مباشر (Mubasher) — HTML scraping
========================================
mubasher.info ممنوعة بـ Cloudflare على الساندبوكس،
الـ RSS feed القديم (api/news/ar/feed/EG) رجع 404.
الحل: scraping HTML لـ /news/eg/now/latest (لا Cloudflare).

ال scraping method:
- GET https://www.mubasher.info/news/eg/now/latest
- Parse <a href="/news/<id>/<slug>"> + data-title attribute
- Title مخزّن في data-title (أحيانًا HTML-encoded)

الquota: 15 مقالة من page واحدة، delay 3 ثواني.
"""

import os
import re
import html
import logging
import asyncio
from datetime import datetime
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from config.sources import registry
from collectors.keyword_filter import filter_instance

import requests
from bs4 import BeautifulSoup

log = logging.getLogger('MubasherScraper')

USER_AGENT = (
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 '
    '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
)
DEFAULT_DELAY_SECONDS = 3.0
REQUEST_TIMEOUT = 20
PAGE_URL = 'https://www.mubasher.info/news/eg/now/latest'


class MubasherScraper:
    """يجمع أخبار من mubasher.info عبر HTML scraping"""

    name = 'mubasher'
    enabled_env = 'MUBASHER_ENABLED'

    def __init__(self, store):
        self.store = store
        self.session = requests.Session()
        self.session.headers.update({
            'User-Agent': USER_AGENT,
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Accept-Language': 'ar,en;q=0.9',
        })

    def is_enabled(self) -> bool:
        return os.getenv(self.enabled_env, '1').lower() in ('1', 'true', 'yes')

    async def collect(self) -> int:
        if not self.is_enabled():
            log.debug(f'{self.name}: معطّل عبر {self.enabled_env}')
            return 0
        try:
            articles = await asyncio.get_event_loop().run_in_executor(
                None, self.fetch_articles
            )
        except Exception as e:
            log.warning(f'{self.name}: خطأ في الجلب — {e}')
            return 0

        saved = 0
        for article in articles:
            title = article.get('title', '')
            body = article.get('body', '')
            ok, reason = await filter_instance.is_relevant(body, title=title)
            if not ok:
                log.debug(f'{self.name} رفض: {title[:60]} ({reason})')
                continue
            try:
                nid = self.store.add(
                    source=article['source'],
                    source_type='web',
                    body=body,
                    title=title,
                    url=article['url'],
                    published_at=article.get('published_at', ''),
                    image_urls='[]',
                )
                if nid:
                    saved += 1
            except Exception as e:
                log.warning(f'{self.name}: خطأ تخزين — {e}')
        if saved:
            log.info(f'{self.name}: تم حفظ {saved} خبر جديد من {len(articles)} مرشّح')
        return saved

    def fetch_articles(self, limit: int = 15) -> list[dict]:
        delay = float(os.getenv('EGYPTIAN_DELAY_SECONDS', DEFAULT_DELAY_SECONDS))
        articles: list[dict] = []
        seen_urls: set[str] = set()

        try:
            resp = self.session.get(PAGE_URL, timeout=REQUEST_TIMEOUT)
        except Exception as e:
            log.warning(f'Mubasher: network error — {e}')
            return []

        if resp.status_code != 200:
            log.warning(f'Mubasher: HTTP {resp.status_code}')
            return []

        page_articles = self._parse_page(resp.text, limit=limit)
        for art in page_articles:
            if art['url'] not in seen_urls:
                seen_urls.add(art['url'])
                articles.append(art)

        return articles[:limit]

    def _parse_page(self, html_text: str, limit: int) -> list[dict]:
        soup = BeautifulSoup(html_text, 'html.parser')
        articles: list[dict] = []

        # Strategy 1: <a href="/news/<id>/<slug>" data-title="..."> — Mubasher's actual structure
        for a_tag in soup.find_all('a', href=True):
            if len(articles) >= limit:
                break
            href = a_tag['href']
            if not re.match(r'/news/\d+/', href):
                continue
            url = 'https://www.mubasher.info' + href
            if url in [a['url'] for a in articles]:
                continue

            title = a_tag.get('data-title', '').strip()
            if not title:
                title = a_tag.get_text(strip=True)
            title = self._clean_html_entities(html.unescape(title))
            if len(title) < 15:
                continue

            articles.append({
                'title': title,
                'body': title,
                'url': url,
                'image_urls': [],
                'source': registry.get_web_display('web_mubasher', 'مباشر'),
                'published_at': '',
            })

        return articles

    @staticmethod
    def _clean_html_entities(text: str) -> str:
        if not text:
            return ''
        return (text
                .replace('&#8220;', '«').replace('&#8221;', '»')
                .replace('&quot;', '"').replace('&amp;', '&')
                .replace('&#8217;', '’').replace('&#8216;', '‘')
                .replace('&lt;', '<').replace('&gt;', '>')
                .strip())