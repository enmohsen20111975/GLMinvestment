"""
جامع أخبار تيليجرام عبر الويب العام (t.me/s/<channel>)
=========================================================
ليه هذا الملف موجود؟
- Telethon (MTProto) بيقرأ القنوات بس بـ user session (تسجيل دخول برقم الموبايل).
- البوت **مش** بيقدر يقرأ تاريخ القناة: Telegram بيرجّع
  `BotMethodInvalidError: The API access for bot users is restricted`.
- t.me/s/<channel> معاينة عامة HTML — **مش محتاجة أي login** وبترجّع
  نص الرسالة + لينك الرسالة + رابط الصورة.

فعشان كده المصادر دي مستقلة في ملف لوحدها، ومفيش تعارض مع
collectors/telegram_collector.py (اللي بيحتاج user session).
"""

import os
import re
import json
import time
import logging
import asyncio
from datetime import datetime, timedelta, timezone
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from config.sources import registry
from config.text_utils import strip_html
from collectors.keyword_filter import filter_instance
from collectors.rss_collector import encode_url

log = logging.getLogger('TelegramWebCollector')

DEFAULT_CHANNELS = [
    'ostoulcapital',
    'elelhamy',
    'BorsaBelArabi96',
    'sahmmisr',
]

_UA = ('Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 '
       '(KHTML, like Gecko) Chrome/120 Safari/537.36')

POST_RE = re.compile(r'<div class="tgme_widget_message[^"]*"[^>]*data-post="([^"]+)"(.*?)(?=<div class="tgme_widget_message[^"]*"[^>]*data-post=|</section>)', re.S)
TIME_RE = re.compile(r'<time[^>]*datetime="([^"]+)"')
TEXT_RE = re.compile(r'<div class="tgme_widget_message_text[^"]*"[^>]*>(.*?)</div>', re.S)
BG_RE = re.compile(r'background-image:url\(([^)]+)\)')
LINK_RE = re.compile(r'<a class="tgme_widget_message_owner_name"[^>]*>|<a[^>]*href="(https://t\.me/[^"]+/\d+)"')


def _clean(text: str) -> str:
    return strip_html(text)


class TelegramWebCollector:
    """يجمع رسائل القنوات العامة من t.me/s بدون أي مصادقة"""

    def __init__(self, store):
        self.store = store
        channels_env = os.getenv('TELEGRAM_WEB_CHANNELS', '')
        env_channels = [c.strip().lstrip('@') for c in channels_env.split(',') if c.strip()]
        self.channels = env_channels or DEFAULT_CHANNELS
        self.hours = int(os.getenv('TELEGRAM_WEB_HOURS', '48'))
        self.max_per_channel = int(os.getenv('TELEGRAM_WEB_MAX_PER_CHANNEL', '25'))
        self.delay = float(os.getenv('TELEGRAM_WEB_DELAY', '1.0'))
        self.min_body = int(os.getenv('TELEGRAM_WEB_MIN_BODY', '20'))
        self.display_name = registry.get_telegram_display('__any__')

    async def collect(self) -> int:
        total = 0
        loop = asyncio.get_event_loop()
        for channel in self.channels:
            try:
                articles = await loop.run_in_executor(None, self._fetch_channel_articles, channel)
            except Exception as e:
                log.warning(f'TelegramWeb[{channel}]: {type(e).__name__}: {e}')
                continue
            if not articles:
                log.info(f'TelegramWeb[{channel}]: لا توجد رسائل عامة (قناة مجموعة/مغلقة أو فارغة)')
            for art in articles:
                if self.store.exists_body(art['body']):
                    continue
                ok, reason = await self._is_relevant(art['body'], channel)
                if not ok:
                    log.debug(f'TelegramWeb[{channel}] مرفوض ({reason}): {art["body"][:50]}')
                    continue
                news_id = self.store.add(
                    source=self.display_name,
                    source_type='telegram',
                    body=art['body'],
                    title=art['title'],
                    url=art['url'],
                    published_at=art['published_at'],
                    image_urls=json.dumps(art['images'][:3], ensure_ascii=False) if art['images'] else '',
                )
                if news_id:
                    total += 1
            if self.delay:
                await asyncio.sleep(self.delay)
        if total:
            log.info(f'TelegramWeb: تم حفظ {total} خبر من {len(self.channels)} قناة')
        return total

    def _fetch_channel_articles(self, channel: str) -> list[dict]:
        import requests
        from bs4 import BeautifulSoup

        url = f'https://t.me/s/{channel}'
        resp = requests.get(url, timeout=20, headers={'User-Agent': _UA})
        if resp.status_code != 200:
            log.debug(f'TelegramWeb[{channel}]: HTTP {resp.status_code}')
            return []

        soup = BeautifulSoup(resp.text, 'html.parser')
        cutoff = datetime.now(timezone.utc) - timedelta(hours=self.hours)
        articles: list[dict] = []
        seen_posts: set[str] = set()

        for widget in soup.select('div.tgme_widget_message[data-post]'):
            if len(articles) >= self.max_per_channel:
                break
            post = widget.get('data-post', '')
            if not post or post in seen_posts:
                continue
            seen_posts.add(post)

            time_tag = widget.select_one('time[datetime]')
            published = ''
            if time_tag:
                published = time_tag.get('datetime', '')
                try:
                    dt = datetime.fromisoformat(published.replace('Z', '+00:00'))
                    if dt < cutoff:
                        continue
                except ValueError:
                    pass

            text_node = widget.select_one('div.tgme_widget_message_text')
            body = _clean(str(text_node)) if text_node else ''
            if len(body) < self.min_body:
                caption = widget.select_one('.tgme_widget_message_caption')
                if caption:
                    extra = _clean(str(caption))
                    body = extra.split('\n')[-1].strip() if extra else body
            if len(body) < self.min_body:
                continue

            images: list[str] = []
            for node in widget.select('.tgme_widget_message_photo_wrap, .tgme_widget_message_video_thumb'):
                style = node.get('style', '') or ''
                bg = BG_RE.search(style)
                if bg:
                    candidate = encode_url(bg.group(1).strip().strip('\'"'))
                    if candidate.lower().startswith('http') and candidate not in images:
                        images.append(candidate)

            articles.append({
                'body': body,
                'title': body[:80].replace('\n', ' ').strip(),
                'url': f'https://t.me/{post}',
                'published_at': published or datetime.now(timezone.utc).isoformat(),
                'images': images,
            })
        return articles

    async def _is_relevant(self, body: str, channel: str) -> tuple[bool, str]:
        try:
            return await asyncio.wait_for(
                filter_instance.is_relevant(body, title=body[:80]), timeout=45
            )
        except asyncio.TimeoutError:
            return filter_instance.quick_match(body), 'timeout_fallback'
        except Exception as e:
            log.debug(f'TelegramWeb[{channel}] filter error: {e}')
            return filter_instance.quick_match(body), 'filter_error_fallback'
