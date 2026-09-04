#!/usr/bin/env python3
"""
Mubasher News Fetcher — يجيب أخبار البورصة المصرية من mubasher.info
====================================================================
للمدير: بيجيب title + link + date + description + image ويدمجها في news.db.

المصادر المدعومة:
1. RSS feed: https://www.mubasher.info/api/news/ar/feed/EG (محتاج feedparser)
2. HTML scraping fallback (لو RSS محجوب بـ Cloudflare)
3. JSON API (لو متاح)

Usage:
    python3 mubasher_news_fetcher.py
    python3 mubasher_news_fetcher.py --limit 10
    python3 mubasher_news_fetcher.py --dry-run  # عرض بدون حفظ
"""
import os, sys, json, sqlite3, hashlib, re
from datetime import datetime
from pathlib import Path
from typing import List, Dict, Optional
import urllib.request
import urllib.error

# === Paths (Rule 29: UNIFIED-SYSTEM) ===
PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
sys.path.insert(0, str(PROJECT_ROOT / 'news-agent' / 'config'))
try:
    from paths import NEWS_DB
except ImportError:
    # Fallback if paths module not available
    NEWS_DB = str(PROJECT_ROOT / 'db' / 'news.db')

DB_PATH = NEWS_DB
DEFAULT_LIMIT = 20
MUBASHER_RSS = 'https://www.mubasher.info/api/news/ar/feed/EG'
MUBASHER_BASE = 'https://www.mubasher.info'

USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'


def log(msg: str, level: str = 'info') -> None:
    ts = datetime.now().strftime('%H:%M:%S')
    print(f'[{ts}] [MUBASHER-{level.upper()}] {msg}')


# ============================================================
# METHOD 1: RSS feed (الأبسط — لو feedparser مثبت)
# ============================================================

def fetch_via_rss(limit: int = DEFAULT_LIMIT) -> List[Dict]:
    """جلب الأخبار عن طريق RSS feed (محتاج feedparser).
    
    mubasher.info RSS فيه HTML entities مش مظبوطة (مثل &nbsp;).
    بنـ sanitize الـ XML قبل ما نـ parse."""
    try:
        import feedparser
    except ImportError:
        log('feedparser مش مثبت. جرّب: pip install feedparser', 'warn')
        return []
    
    log(f'GET {MUBASHER_RSS}')
    try:
        # Fetch raw XML first (مشان نصلح entities)
        req = urllib.request.Request(MUBASHER_RSS, headers={'User-Agent': USER_AGENT})
        resp = urllib.request.urlopen(req, timeout=15)
        raw_xml = resp.read().decode('utf-8', errors='replace')
        
        # Sanitize: fix common HTML entities that break XML parsing
        entity_fixes = {
            '&nbsp;': ' ',
            '&copy;': '©',
            '&reg;': '®',
            '&trade;': '™',
            '&hellip;': '…',
            '&mdash;': '—',
            '&ndash;': '–',
            '&lsquo;': "'",
            '&rsquo;': "'",
            '&ldquo;': '"',
            '&rdquo;': '"',
        }
        for bad, good in entity_fixes.items():
            raw_xml = raw_xml.replace(bad, good)
        
        # Parse sanitized XML
        feed = feedparser.parse(raw_xml)
        
        # feedparser بيرجع entries حتى لو bozo=True (XML فيه errors بس parse اشتغل)
        if not feed.entries:
            log(f'RSS: 0 entries (bozo={feed.bozo}, exc={feed.bozo_exception})', 'warn')
            return []
        
        news = []
        for entry in feed.entries[:limit]:
            news.append({
                'title': entry.get('title', '').strip(),
                'link': entry.get('link', ''),
                'date': entry.get('published', entry.get('updated', '')),
                'description': entry.get('summary', entry.get('description', '')).strip(),
                'image': _extract_image_from_entry(entry),
                'source': 'mubasher',
                'source_type': 'rss',
            })
        log(f'✓ RSS: {len(news)} خبر')
        return news
    except urllib.error.HTTPError as e:
        log(f'RSS HTTP {e.code}: {e.reason}', 'warn')
        return []
    except Exception as e:
        log(f'RSS fetch failed: {e}', 'warn')
        return []


def _extract_image_from_entry(entry) -> Optional[str]:
    """استخراج رابط الصورة من entry."""
    # 1. media_content
    if hasattr(entry, 'media_content') and entry.media_content:
        for media in entry.media_content:
            if 'url' in media:
                return media['url']
    # 2. media_thumbnail
    if hasattr(entry, 'media_thumbnail') and entry.media_thumbnail:
        return entry.media_thumbnail[0].get('url')
    # 3. enclosures
    if hasattr(entry, 'enclosures') and entry.enclosures:
        for enc in entry.enclosures:
            if 'href' in enc and 'image' in enc.get('type', ''):
                return enc['href']
    # 4. from summary HTML
    summary = entry.get('summary', '')
    if summary:
        img_match = re.search(r'<img[^>]+src=["\']([^"\']+)["\']', summary)
        if img_match:
            return img_match.group(1)
    return None


# ============================================================
# METHOD 2: HTML scraping fallback (لو Cloudflare حاجب RSS)
# ============================================================

def fetch_via_html(limit: int = DEFAULT_LIMIT) -> List[Dict]:
    """جلب الأخبار عن طريق HTML scraping (محتاج requests + bs4)."""
    try:
        import requests
        from bs4 import BeautifulSoup
    except ImportError:
        log('requests/beautifulsoup4 مش مثبت', 'warn')
        return []
    
    log(f'GET {MUBASHER_BASE}/news/countries/EG (HTML fallback)')
    try:
        resp = requests.get(
            f'{MUBASHER_BASE}/news/countries/EG',
            headers={'User-Agent': USER_AGENT, 'Accept-Language': 'ar'},
            timeout=15,
        )
        if resp.status_code != 200:
            log(f'HTTP {resp.status_code}', 'warn')
            return []
        
        soup = BeautifulSoup(resp.text, 'html.parser')
        news = []
        
        # mubasher uses various card patterns — try multiple selectors
        cards = (
            soup.select('article.news-card') or
            soup.select('div[class*="news-item"]') or
            soup.select('li[class*="news"]') or
            soup.select('a[href*="/news/"]')
        )
        
        seen = set()
        for card in cards[:limit * 2]:  # fetch more, dedupe later
            title_el = card.find(['h2', 'h3', 'h4']) or card
            title = title_el.get_text(strip=True) if title_el else ''
            link = card.get('href') or (card.find('a') or {}).get('href', '')
            
            if not title or len(title) < 10:
                continue
            if link and not link.startswith('http'):
                link = f'{MUBASHER_BASE}{link}'
            
            # Dedupe
            key = hashlib.md5(title.encode()).hexdigest()
            if key in seen:
                continue
            seen.add(key)
            
            # Try to extract image
            img_el = card.find('img')
            image = img_el.get('src') or img_el.get('data-src') if img_el else None
            
            # Try to extract date
            time_el = card.find('time')
            date = time_el.get('datetime') or time_el.get_text(strip=True) if time_el else ''
            
            # Description
            desc_el = card.find('p')
            description = desc_el.get_text(strip=True) if desc_el else ''
            
            news.append({
                'title': title,
                'link': link,
                'date': date,
                'description': description,
                'image': image,
                'source': 'mubasher',
                'source_type': 'html_scrape',
            })
            
            if len(news) >= limit:
                break
        
        log(f'✓ HTML: {len(news)} خبر')
        return news
    except Exception as e:
        log(f'HTML fetch failed: {e}', 'warn')
        return []


# ============================================================
# METHOD 3: JSON API (لو متاح)
# ============================================================

def fetch_via_json_api(limit: int = DEFAULT_LIMIT) -> List[Dict]:
    """محاولة جلب عن طريق JSON API (mubasher ممكن يكون عنده API سري)."""
    api_urls = [
        f'{MUBASHER_BASE}/api/news/ar/EG?limit={limit}',
        f'{MUBASHER_BASE}/api/v1/news?country=EG&limit={limit}',
    ]
    
    for url in api_urls:
        log(f'GET {url}')
        try:
            req = urllib.request.Request(url, headers={
                'User-Agent': USER_AGENT,
                'Accept': 'application/json',
            })
            resp = urllib.request.urlopen(req, timeout=10)
            data = json.loads(resp.read())
            
            # Handle different response shapes
            items = data if isinstance(data, list) else data.get('data', data.get('news', data.get('items', [])))
            if not items:
                continue
            
            news = []
            for item in items[:limit]:
                news.append({
                    'title': item.get('title', '').strip(),
                    'link': item.get('link') or item.get('url', ''),
                    'date': item.get('published_at') or item.get('date', ''),
                    'description': item.get('summary') or item.get('description', '').strip(),
                    'image': item.get('image') or item.get('image_url'),
                    'source': 'mubasher',
                    'source_type': 'json_api',
                })
            log(f'✓ JSON API: {len(news)} خبر')
            return news
        except urllib.error.HTTPError as e:
            log(f'JSON API {url}: HTTP {e.code}', 'warn')
        except Exception as e:
            log(f'JSON API {url}: {e}', 'warn')
    
    return []


# ============================================================
# SAVE TO news.db.market_news
# ============================================================

def save_to_db(news: List[Dict]) -> int:
    """حفظ الأخبار في news.db.market_news (Rule 28: NO-DUPLICATION)."""
    if not news:
        return 0
    
    conn = sqlite3.connect(DB_PATH, timeout=10)
    conn.execute('PRAGMA busy_timeout = 10000')
    
    # Ensure table exists
    conn.executescript('''
        CREATE TABLE IF NOT EXISTS market_news (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            title TEXT NOT NULL,
            content TEXT,
            summary_ar TEXT,
            summary_en TEXT,
            source TEXT DEFAULT 'news_agent',
            source_type TEXT DEFAULT 'telegram',
            url TEXT,
            tickers TEXT DEFAULT '[]',
            importance INTEGER DEFAULT 0,
            sentiment TEXT DEFAULT 'neutral',
            impact_type TEXT DEFAULT 'general',
            market TEXT DEFAULT 'EGX',
            image_paths TEXT DEFAULT '[]',
            ocr_text TEXT DEFAULT '',
            raw_analysis TEXT DEFAULT '{}',
            published_at TEXT,
            fetched_at TEXT DEFAULT (datetime('now')),
            sent_at TEXT,
            is_sent INTEGER DEFAULT 0,
            UNIQUE(title, source)
        );
    ''')
    
    inserted = 0
    skipped = 0
    ts = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
    
    for item in news:
        if not item['title']:
            skipped += 1
            continue
        try:
            image_paths = json.dumps([item['image']] if item['image'] else [])
            conn.execute('''
                INSERT OR IGNORE INTO market_news
                (title, content, summary_ar, source, source_type, url,
                 image_paths, published_at, fetched_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            ''', (
                item['title'],
                item.get('description', ''),
                item.get('description', ''),  # summary_ar
                item['source'],
                item['source_type'],
                item['link'],
                image_paths,
                item.get('date', ''),
                ts,
            ))
            if conn.total_changes > 0:
                inserted += 1
            else:
                skipped += 1
        except Exception as e:
            log(f'Error inserting: {e}', 'warn')
            skipped += 1
    
    conn.commit()
    total = conn.execute('SELECT COUNT(*) FROM market_news').fetchone()[0]
    conn.close()
    
    log(f'✓ Saved: {inserted} inserted, {skipped} skipped. Total in DB: {total}')
    return inserted


# ============================================================
# MAIN
# ============================================================

def fetch_mubasher_news(limit: int = DEFAULT_LIMIT) -> List[Dict]:
    """الـ main: جرّب RSS → JSON API → HTML scraping."""
    log('='*60)
    log(f'Fetching {limit} news from mubasher.info')
    log('='*60)
    
    # Method 1: RSS (primary)
    news = fetch_via_rss(limit)
    
    # Method 2: JSON API (if RSS failed)
    if not news:
        news = fetch_via_json_api(limit)
    
    # Method 3: HTML scraping (last resort)
    if not news:
        news = fetch_via_html(limit)
    
    if not news:
        log('❌ All methods failed — mubasher.info likely Cloudflare-protected', 'error')
        log('💡 In production (residential IP), RSS should work.', 'info')
        return []
    
    return news


def main():
    import argparse
    parser = argparse.ArgumentParser(description='Mubasher News Fetcher')
    parser.add_argument('--limit', type=int, default=DEFAULT_LIMIT, help=f'Max news (default: {DEFAULT_LIMIT})')
    parser.add_argument('--dry-run', action='store_true', help='عرض بدون حفظ في DB')
    args = parser.parse_args()
    
    news = fetch_mubasher_news(args.limit)
    
    if args.dry_run:
        print('\n' + '='*60)
        print('DRY RUN — عرض الأخبار بدون حفظ')
        print('='*60)
        for i, item in enumerate(news, 1):
            print(f'\n--- خبر {i} ---')
            print(f'  title:       {item["title"][:80]}')
            print(f'  link:        {item["link"][:80]}')
            print(f'  date:        {item["date"]}')
            print(f'  description: {item["description"][:80]}')
            print(f'  image:       {item["image"]}')
            print(f'  source:      {item["source"]} ({item["source_type"]})')
    else:
        saved = save_to_db(news)
        print(f'\n✓ تم حفظ {saved} خبر في news.db.market_news')


if __name__ == '__main__':
    main()
