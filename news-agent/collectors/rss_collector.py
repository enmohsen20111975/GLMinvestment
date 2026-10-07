"""
جامع أخبار من RSS Feeds
- بيستخرج الصور (من <img> جوه الـ description أو تاج <image> أو media/enclosure)
- enrichment اختياري: لو الـ feed本身 مفيهاش صور، بيجيب og:image من صفحة الخبر
"""

import os
import re
import json
import time
import logging
from datetime import datetime
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from config.sources import registry
from config.text_utils import strip_html
from collectors.keyword_filter import filter_instance

log = logging.getLogger('RSSCollector')

DEFAULT_FEEDS = [
    'https://hapijournal.com/feed/',
    'https://www.masrawy.com/rss/feed/206/%D8%A7%D9%82%D8%AA%D8%B5%D8%A7%D8%AF',
    'https://www.alborsaanews.com/rss',
]

IMAGE_EXT = ('.jpg', '.jpeg', '.png', '.webp', '.gif')
_UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36'


def encode_url(url: str) -> str:
    """يستخدم percent-encoding للمسار لو فيه حروف عربية أو رموز غير ASCII."""
    try:
        url.encode('ascii')
        return url
    except UnicodeEncodeError:
        from urllib.parse import quote, urlsplit, urlunsplit
        parts = urlsplit(url)
        return urlunsplit((
            parts.scheme, parts.netloc,
            quote(parts.path, safe='/'),
            quote(parts.query, safe='=&%+'),
            parts.fragment,
        ))


def _clean_html(text: str) -> str:
    return strip_html(text)


def extract_images(raw_entry: str) -> list[str]:
    """يستخرج كل روابط الصور من XML الخام بتاع الـ entry."""
    urls: list[str] = []

    def add(u: str):
        u = encode_url((u or '').strip())
        if not u or not u.lower().startswith('http'):
            return
        path = u.split('?')[0].lower()
        if path.endswith(IMAGE_EXT) and u not in urls:
            urls.append(u)

    for m in re.finditer(r'<img[^>]+src=["\']([^"\']+)["\']', raw_entry, re.I):
        add(m.group(1))
    for tag in ('media:content', 'media:thumbnail', 'enclosure'):
        for m in re.finditer(rf'<{tag}[^>]+url=["\']([^"\']+)["\']', raw_entry, re.I):
            add(m.group(1))
    for m in re.finditer(r'<image\b[^>]*>(.*?)</image>', raw_entry, re.I | re.S):
        for u in re.findall(r'<url>(.*?)</url>', m.group(1), re.I | re.S):
            add(u.strip())
    return urls


def fetch_og_image(url: str) -> str:
    """يجيب صورة المقال من og:image/twitter:image — '' لو مفيش."""
    if not url or not url.startswith('http'):
        return ''
    try:
        import requests
        from bs4 import BeautifulSoup
        actual = url
        if 'duckduckgo.com/l/' in url:
            from urllib.parse import unquote, urlparse, parse_qs
            params = parse_qs(urlparse(url).query)
            if 'uddg' in params:
                actual = unquote(params['uddg'][0])
        actual = encode_url(actual)
        resp = requests.get(actual, timeout=12, headers={'User-Agent': _UA})
        if resp.status_code != 200:
            return ''
        soup = BeautifulSoup(resp.text, 'html.parser')
        for sel, attr in (('meta[property="og:image"]', 'content'),
                          ('meta[name="twitter:image"]', 'content'),
                          ('link[rel="image_src"]', 'href')):
            tag = soup.select_one(sel)
            if tag and tag.get(attr, '').strip().lower().startswith('http'):
                return encode_url(tag.get(attr).strip())
        img = soup.find('img')
        if img and (img.get('src') or '').strip().lower().startswith('http'):
            return encode_url(img['src'].strip())
    except Exception:
        return ''
    return ''


class RSSCollector:
    """يجمع أخبار من RSS Feeds"""

    def __init__(self, store):
        self.store = store
        feeds_env = os.getenv('RSS_FEEDS', '')
        self.feeds = [f.strip() for f in feeds_env.split(',') if f.strip()] \
                     or DEFAULT_FEEDS
        self.entries_per_feed = int(os.getenv('RSS_ENTRIES_PER_FEED', '25'))
        self.enrich_images = os.getenv('RSS_ENRICH_IMAGES', '1').lower() in ('1', 'true', 'yes', 'on')
        self.enrich_max = int(os.getenv('RSS_ENRICH_MAX', '25'))
        self.enrich_delay = float(os.getenv('RSS_ENRICH_DELAY', '0.4'))
        self.min_body = int(os.getenv('RSS_MIN_BODY_CHARS', '30'))

    async def collect(self) -> int:
        total = 0
        for url in self.feeds:
            try:
                count = self._parse_feed(url)
                total += count
            except Exception as e:
                log.warning(f'RSS error {url}: {e}')
        return total

    def _parse_feed(self, url: str) -> int:
        import feedparser
        saved = 0
        enrich_budget = self.enrich_max
        try:
            feed = feedparser.parse(url)
            display_name = registry.get_rss_display(url, fallback_title=feed.feed.get('title', url))

            for entry in feed.entries[:self.entries_per_feed]:
                raw_html = (entry.get('summary')
                            or entry.get('description')
                            or _content_value(entry)
                            or '')
                title = entry.get('title', '')
                body = _clean_html(raw_html)
                if len(body) < self.min_body:
                    continue

                if not filter_instance.quick_match(f'{title}\n{body}'):
                    log.debug(f'RSS رفض: {title[:60]}')
                    continue

                link = entry.get('link', '') or ''
                images = extract_images(_raw_entry_text(entry, raw_html))
                if not images and self.enrich_images and enrich_budget > 0 and link:
                    og = fetch_og_image(link)
                    if og:
                        images = [og]
                    enrich_budget -= 1
                    if self.enrich_delay:
                        time.sleep(self.enrich_delay)

                published = entry.get('published') or entry.get('updated') or datetime.now().isoformat()

                news_id = self.store.add(
                    source=display_name,
                    source_type='rss',
                    body=body,
                    title=title,
                    url=link,
                    published_at=str(published),
                    image_urls=json.dumps(images[:3], ensure_ascii=False) if images else '',
                )
                if news_id:
                    saved += 1
        except Exception as e:
            log.debug(f'RSS parse error {url}: {e}')
        return saved


def _content_value(entry: dict) -> str:
    for blk in entry.get('content', []) or []:
        val = (blk or {}).get('value')
        if val:
            return str(val)
    return ''


def _raw_entry_text(entry: dict, raw_html: str) -> str:
    """يرجّع كل الحقول اللي ممكن تحتوي الصور."""
    parts = [raw_html or '']
    for key in ('summary', 'description'):
        parts.append(str(entry.get(key, '') or ''))
    for blk in entry.get('content', []) or []:
        parts.append(str(blk.get('value', '') or ''))
    for link in entry.get('links', []) or []:
        parts.append(str(link.get('href', '') or ''))
    return '\n'.join(parts)
