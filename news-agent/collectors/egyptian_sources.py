"""
جامع أخبار من موقعين مصريين متخصصين في البورصة والأسهم
=========================================================
مصادر مدعومة حالياً:
- Alborsaa News (صحيفة البورصة): alborsaanews.com — قسم «البورصة وال alteration»
- Almalnews (صحيفة المال): almalnews.com — قسم «بورصة و alteration» + بنوك + استثمار
- Mubasher (مباشر): mubasher.info — HTML scraping (RSS feed مات)

الquota: 15 مقالة من كل موقع، delay 3 ثواني.
"""

import os
import re
import json
import time
import logging
import asyncio
from abc import ABC, abstractmethod
from datetime import datetime
from urllib.parse import urljoin
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from config.sources import registry
from collectors.keyword_filter import filter_instance

import requests
from bs4 import BeautifulSoup

log = logging.getLogger('EgyptianSources')

USER_AGENT = (
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 '
    '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
)
DEFAULT_DELAY_SECONDS = 3.0
REQUEST_TIMEOUT = 20


class EgyptianSource(ABC):
    """واجهة موحدة لأي مصدر مصري"""

    name: str = 'source'
    enabled_env: str = 'SOURCE_ENABLED'

    def __init__(self, store):
        self.store = store
        self.session = requests.Session()
        self.session.headers.update({
            'User-Agent': USER_AGENT,
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Accept-Language': 'ar,en;q=0.9',
        })

    @abstractmethod
    def fetch_articles(self, limit: int = 15) -> list[dict]:
        """يرجع list من dicts فيها:
        {title, body, url, image_urls: list[str], source, published_at}
        """

    def is_enabled(self) -> bool:
        return os.getenv(self.enabled_env, '1').lower() in ('1', 'true', 'yes')

    @staticmethod
    def _clean_html_entities(text: str) -> str:
        """Decode common HTML entities in Arabic text"""
        if not text:
            return ''
        return (text
                .replace('&#8220;', '«').replace('&#8221;', '»')
                .replace('&quot;', '"').replace('&amp;', '&')
                .replace('&#8217;', '’').replace('&#8216;', '‘')
                .replace('&lt;', '<').replace('&gt;', '>')
                .strip())

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
            # Egyptian sources are already EGX-focused — skip keyword filter
            # (keyword filter is too strict for general news from EGX sources)
            ok, reason = True, 'egyptian_source'
            try:
                nid = self.store.add(
                    source=article['source'],
                    source_type='web',
                    body=body,
                    title=title,
                    url=article['url'],
                    published_at=article.get('published_at', ''),
                    image_urls=json.dumps(
                        article.get('image_urls', []), ensure_ascii=False
                    ),
                )
                if nid:
                    saved += 1
            except Exception as e:
                log.warning(f'{self.name}: خطأ تخزين — {e}')
        if saved:
            log.info(f'{self.name}: تم حفظ {saved} خبر جديد من {len(articles)} مرشّح')
        return saved


class AlborsaaSource(EgyptianSource):
    """صحيفة البورصة — alborsaanews.com"""

    name = 'alborsaanews'
    enabled_env = 'ALBORSAA_ENABLED'

    CATEGORIES = [
        ('https://www.alborsaanews.com/category/%D8%A7%D9%84%D8%A8%D9%88%D8%B1%D8%B5%D8%A9-%D9%88%D8%A7%D9%84%D8%B4%D8%B1%D9%83%D8%A7%D8%AA', 'البورصة وال alteration'),
        ('https://www.alborsaanews.com/category/%D8%A3%D8%B3%D9%88%D8%A7%D9%82', ' أسعار'),
    ]

    def fetch_articles(self, limit: int = 15) -> list[dict]:
        delay = float(os.getenv('EGYPTIAN_DELAY_SECONDS', DEFAULT_DELAY_SECONDS))
        articles: list[dict] = []
        seen_urls: set[str] = set()

        for url, label in self.CATEGORIES:
            if len(articles) >= limit:
                break
            try:
                resp = self.session.get(url, timeout=REQUEST_TIMEOUT)
            except Exception as e:
                log.warning(f'Alborsaa[{label}]: network error — {e}')
                continue
            if resp.status_code != 200:
                log.warning(f'Alborsaa[{label}]: HTTP {resp.status_code}')
                continue

            page_articles = self._parse_category_page(
                resp.text, source_label=label, limit=limit - len(articles)
            )
            for art in page_articles:
                if art['url'] not in seen_urls:
                    seen_urls.add(art['url'])
                    articles.append(art)

            time.sleep(delay)

        return articles[:limit]

    def _parse_category_page(self, html: str, source_label: str, limit: int) -> list[dict]:
        soup = BeautifulSoup(html, 'html.parser')
        articles: list[dict] = []
        for art_tag in soup.find_all('article'):
            if len(articles) >= limit:
                break
            article = self._parse_article_tag(art_tag, source_label)
            if article:
                articles.append(article)
        return articles

    def _parse_article_tag(self, tag, source_label: str) -> dict | None:
        link = tag.find('a', href=True)
        if not link:
            return None
        url = link['href']
        if 'alborsaanews.com' not in url:
            return None

        title_tag = tag.find(['h2', 'h3'])
        title = title_tag.get_text(strip=True) if title_tag else link.get_text(strip=True)
        title = self._clean_html_entities(title)
        if len(title) < 15:
            return None

        image_urls: list[str] = self._extract_image_urls(tag)

        return {
            'title': title,
            'body': title,
            'url': url,
            'image_urls': image_urls[:2],
            'source': registry.get_web_display('web_alborsaa', 'صحيفة البورصة'),
            'published_at': '',
        }

    @staticmethod
    def _extract_image_urls(tag) -> list[str]:
        """itestخراج الصور من <img src>, <img data-src>, و <div data-src> (lazy load)"""
        urls: list[str] = []

        # 1) <img> tag — الأولوية لـ data-src (الصورة الحقيقية في lazy loading)
        for img in tag.find_all('img'):
            for attr in ('data-src', 'data-lazy-src', 'src'):
                src = img.get(attr)
                if src and src.startswith('http') and 'data:image' not in src:
                    if src not in urls:
                        urls.append(src)
                    break

        # 2) <div data-src> — يستخدمه JNews theme في الـ hero items
        for div in tag.find_all('div'):
            src = div.get('data-src')
            if src and src.startswith('http') and 'data:image' not in src:
                if src not in urls:
                    urls.append(src)

        return urls[:2]


class AlmalnewsSource(EgyptianSource):
    """journalist Malta — almalnews.com — أخبار الشركة + البورصة + الإفصالات"""

    name = 'almalnews'
    enabled_env = 'ALMALNEWS_ENABLED'

    CATEGORIES = [
        ('stocks/1/', 'بورصة وcompanies'),
        ('banks/1/', 'بنوك'),
        ('investment/1/', 'استثمار'),
        ('economy-markets/1/', 'اقتصاد وأسواق'),
    ]

    def fetch_articles(self, limit: int = 15) -> list[dict]:
        delay = float(os.getenv('EGYPTIAN_DELAY_SECONDS', DEFAULT_DELAY_SECONDS))
        articles: list[dict] = []
        seen_urls: set[str] = set()

        for slug, label in self.CATEGORIES:
            if len(articles) >= limit:
                break
            url = f'https://almalnews.com/category/{quote(slug)}'
            try:
                resp = self.session.get(url, timeout=REQUEST_TIMEOUT)
            except Exception as e:
                log.warning(f'Almalnews[{label}]: network error — {e}')
                continue
            if resp.status_code != 200:
                log.warning(f'Almalnews[{label}]: HTTP {resp.status_code}')
                continue

            # Check for Cloudflare challenge page (only the actual CF block page)
            cf_markers = ('cf-browser-verification', 'cf-please-wait', 'id="cf_captcha')
            if any(m in resp.text.lower() for m in cf_markers):
                log.warning(f'Almalnews[{label}]: Cloudflare blocked')
                continue

            soup = BeautifulSoup(resp.text, 'html.parser')
            # Almalnews structure: section.latest-news-section > a[href="/NUMBER/slug/"]
            section = soup.find('section', class_='latest-news-section')
            if not section:
                section = soup
            for a_tag in section.find_all('a', href=True):
                if len(articles) >= limit:
                    break
                href = a_tag['href']
                # Article URL pattern: /NUMBER/slug/
                if not re.search(r'/\d+/[\w\-]+/$', href):
                    continue
                art_url = urljoin('https://almalnews.com', href)
                if art_url in seen_urls:
                    continue
                title = a_tag.get_text(strip=True)
                title = self._clean_html_entities(title)
                if len(title) < 15:
                    continue
                seen_urls.add(art_url)
                articles.append({
                    'title': title,
                    'body': title,
                    'url': art_url,
                    'image_urls': [],
                    'source': registry.get_web_display('web_almalnews', 'journalist المال'),
                    'published_at': '',
                })
            time.sleep(delay)

        return articles[:limit]


class EgyptianSourcesCollector:
    """يدير كل المصادر المصرية المتخصصة"""

    name = 'egyptian_sources'

    def __init__(self, store):
        self.store = store
        self.sources: list[EgyptianSource] = [
            AlborsaaSource(store),
            AlmalnewsSource(store),
        ]
        # Mubasher uses HTML scraping (RSS feed is dead)
        try:
            from collectors.mubasher_scraper import MubasherScraper
            self.sources.append(MubasherScraper(store))
        except ImportError:
            log.warning('MubasherScraper غير متاح')

    def is_enabled(self) -> bool:
        return os.getenv('ENABLE_EGYPTIAN_SOURCES', '0').lower() in ('1', 'true', 'yes')

    async def collect(self) -> int:
        if not self.is_enabled():
            return 0
        log.info('بدأ جمع الأخبار من المصادر المصرية المتخصصة...')
        total = 0
        for source in self.sources:
            try:
                count = await source.collect()
                total += count
            except Exception as e:
                log.warning(f'{source.name}: خطأ غير متوقع — {e}')
        if total == 0:
            log.info('لم يُجمع أي خبر جديد من المصادر المصرية')
        return total