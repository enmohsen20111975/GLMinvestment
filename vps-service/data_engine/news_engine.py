#!/usr/bin/env python3
"""
news_engine.py — محرك الأخبار الموحد لمنصة دليل الاستثمار
==========================================================

يجمع الأخبار من 5 مصادر مصرية + Telegram channels:

المصادر:
  1. جريدة المال (almalnews.com) — أخبار الشركات + البورصة + الإفصاحات
  2. أموال الغد (amwalalghad.com) — أسواق المال + الشركات + الاقتصاد
  3. حابي (hapijournal.com) — سوق المال + البنوك + الاستثمار
  4. اليوم السابع (youm7.com) — أخبار البورصة (سوق المال tag)
  5. مصراوي (masrawy.com) — اقتصاد + عملات + بورصة

شروط الأخبار:
  - الخبر لازم يكون فيه رابط للموقع الأصلي
  - نص كبير (مش رد داخل الشات ولا خبر صغير)
  - من Telegram: الخبر لازم يكون فيه رابط للموقع الأصلي + نص كبير

الـ DB: db/news.db.market_news + news_articles

Usage:
  python3 vps-service/data_engine/news_engine.py
  python3 vps-service/data_engine/news_engine.py --source=almalnews
  python3 vps-service/data_engine/news_engine.py --daemon
"""

from __future__ import annotations

import os
import sys
import re
import json
import time
import sqlite3
import logging
import argparse
import urllib.request
import urllib.error
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, List, Optional, Any
from html.parser import HTMLParser

# ============================================================================
# Configuration
# ============================================================================

PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
NEWS_DB = PROJECT_ROOT / "db" / "news.db"

USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/120.0.0.0 Safari/537.36"
)

logging.basicConfig(
    level=logging.INFO,
    format="[%(asctime)s] [%(name)s] %(levelname)s: %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger("news_engine")

# مصادر الأخبار
NEWS_SOURCES = {
    "almalnews": {
        "name": "جريدة المال",
        "base_url": "https://almalnews.com",
        "list_urls": [
            "https://almalnews.com/category/الأسواق/",
            "https://almalnews.com/category/الشركات/",
        ],
        "priority": 5,  # ⭐⭐⭐⭐⭐
    },
    "amwalalghad": {
        "name": "أموال الغد",
        "base_url": "https://amwalalghad.com",
        "list_urls": [
            "https://amwalalghad.com/category/stock-markets/",
            "https://amwalalghad.com/category/companies-news/",
        ],
        "priority": 5,
    },
    "hapijournal": {
        "name": "حابي",
        "base_url": "https://hapijournal.com",
        "list_urls": [
            "https://hapijournal.com/new/category/stock-market/",
            "https://hapijournal.com/new/category/banks/",
        ],
        "priority": 5,
    },
    "youm7": {
        "name": "اليوم السابع",
        "base_url": "https://www.youm7.com",
        "list_urls": [
            "https://www.youm7.com/Tags/Index?id=56257&tag=%D8%B3%D9%88%D9%82-%D8%A7%D9%84%D9%85%D8%A7%D9%84",
        ],
        "priority": 4,
    },
    "masrawy": {
        "name": "مصراوي",
        "base_url": "https://www.masrawy.com",
        "list_urls": [
            "https://www.masrawy.com/channel/economy",
        ],
        "priority": 4,
    },
}


# ============================================================================
# HTTP Helpers
# ============================================================================

def fetch_html(url: str, timeout: int = 15) -> Optional[str]:
    """Fetch HTML content from URL."""
    try:
        # encode Arabic/Unicode characters in URL path
        import urllib.parse
        parsed = urllib.parse.urlsplit(url)
        encoded_path = urllib.parse.quote(parsed.path, safe="/%")
        encoded_query = urllib.parse.quote(parsed.query, safe="=&%+")
        encoded_url = urllib.parse.urlunsplit((
            parsed.scheme, parsed.netloc, encoded_path, encoded_query, parsed.fragment
        ))

        req = urllib.request.Request(
            encoded_url,
            headers={
                "User-Agent": USER_AGENT,
                "Accept": "text/html,application/xhtml+xml",
                "Accept-Language": "ar,en;q=0.9",
            },
        )
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return resp.read().decode("utf-8", errors="replace")
    except Exception as e:
        log.warning(f"HTML fetch error from {url}: {e}")
        return None


# ============================================================================
# HTML Parsing (stdlib only — no external deps)
# ============================================================================

class ArticleLinkExtractor(HTMLParser):
    """Extract article links from HTML pages."""

    def __init__(self, base_url: str):
        super().__init__()
        self.base_url = base_url
        self.links: List[Dict[str, str]] = []
        self._in_link = False
        self._current_url = ""
        self._current_text = ""

    def handle_starttag(self, tag: str, attrs: List[tuple]):
        if tag == "a":
            href = dict(attrs).get("href", "")
            if href and not href.startswith("#") and not href.startswith("javascript:"):
                self._in_link = True
                self._current_url = href
                self._current_text = ""

    def handle_data(self, data: str):
        if self._in_link:
            self._current_text += data.strip()

    def handle_endtag(self, tag: str):
        if tag == "a" and self._in_link:
            url = self._current_url
            if url and not url.startswith("http"):
                if url.startswith("/"):
                    url = self.base_url + url
                else:
                    url = self.base_url + "/" + url

            text = self._current_text.strip()
            # شروط: نص كبير (>= 20 chars) + يبدو كأنه مقال
            if len(text) >= 20 and "/news/" in url or "/article/" in url or "/story/" in url or "/Tags/" not in url:
                self.links.append({"url": url, "title": text})
            self._in_link = False
            self._current_url = ""
            self._current_text = ""


class ArticleContentExtractor(HTMLParser):
    """Extract article content (title + body) from HTML."""

    def __init__(self):
        super().__init__()
        self.title = ""
        self.content = ""
        self._in_title = False
        self._in_article = False
        self._in_p = False
        self._current_text = ""
        self._article_depth = 0

    def handle_starttag(self, tag: str, attrs: List[tuple]):
        attrs_dict = dict(attrs)

        if tag == "title":
            self._in_title = True
        elif tag == "h1":
            cls = attrs_dict.get("class", "")
            if "title" in cls.lower() or "headline" in cls.lower() or not self.title:
                self._in_title = True

        if tag in ("article",) or (tag == "div" and
                                    any(x in attrs_dict.get("class", "").lower()
                                        for x in ["article-content", "entry-content", "post-content",
                                                  "article-body", "story-body", "news-content"])):
            self._in_article = True
            self._article_depth = 0

        if self._in_article and tag == "div":
            self._article_depth += 1

        if self._in_article and tag == "p":
            self._in_p = True
            self._current_text = ""

    def handle_data(self, data: str):
        if self._in_title:
            self.title += data.strip()
        if self._in_p:
            self._current_text += data.strip()

    def handle_endtag(self, tag: str):
        if tag == "title" and self._in_title:
            self._in_title = False
        if tag == "h1" and self._in_title:
            self._in_title = False
        if self._in_article and tag == "p" and self._in_p:
            text = self._current_text.strip()
            if len(text) >= 30:  # شروط: نص كبير
                self.content += text + "\n\n"
            self._in_p = False
        if self._in_article and tag == "div":
            self._article_depth -= 1
            if self._article_depth <= 0:
                self._in_article = False


def extract_article_links(html: str, base_url: str) -> List[Dict[str, str]]:
    """Extract article links from a listing page."""
    parser = ArticleLinkExtractor(base_url)
    parser.feed(html)
    # deduplicate
    seen = set()
    unique = []
    for link in parser.links:
        if link["url"] not in seen:
            seen.add(link["url"])
            unique.append(link)
    return unique


def extract_article_content(html: str) -> Dict[str, str]:
    """Extract title and content from an article page."""
    parser = ArticleContentExtractor()
    parser.feed(html)
    return {"title": parser.title.strip(), "content": parser.content.strip()}


# ============================================================================
# DB Helpers
# ============================================================================

def get_news_db() -> sqlite3.Connection:
    """Open news.db with WAL."""
    NEWS_DB.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(NEWS_DB), timeout=30)
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA busy_timeout=30000")
    return conn


def ensure_market_news_table(conn: sqlite3.Connection):
    """Ensure market_news table exists (uses existing schema)."""
    # الـ table موجود مسبقاً بـ schema مختلف — نتأكد إنه موجود فقط
    conn.execute("""
        CREATE TABLE IF NOT EXISTS market_news (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            title TEXT NOT NULL,
            content TEXT,
            summary_ar TEXT,
            source TEXT DEFAULT 'news_agent',
            source_type TEXT DEFAULT 'web',
            url TEXT,
            tickers TEXT DEFAULT '[]',
            importance INTEGER DEFAULT 0,
            sentiment TEXT DEFAULT 'neutral',
            impact_type TEXT DEFAULT 'general',
            market TEXT DEFAULT 'EGX',
            published_at TEXT,
            fetched_at TEXT DEFAULT (datetime('now')),
            is_sent INTEGER DEFAULT 0,
            UNIQUE(title, source)
        )
    """)
    conn.execute("CREATE INDEX IF NOT EXISTS idx_mn_published ON market_news (published_at)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_mn_source ON market_news (source)")


# ============================================================================
# News Fetchers
# ============================================================================

def fetch_source_news(source_key: str) -> List[Dict]:
    """Fetch news from a single source."""
    source = NEWS_SOURCES[source_key]
    log.info(f"[News] Fetching from {source['name']} ({source_key})...")

    all_articles = []

    for list_url in source["list_urls"]:
        html = fetch_html(list_url, timeout=15)
        if not html:
            continue

        links = extract_article_links(html, source["base_url"])
        log.info(f"[News] Found {len(links)} links from {list_url}")

        # Fetch first 10 articles per page (to avoid rate limiting)
        for link in links[:10]:
            article_html = fetch_html(link["url"], timeout=15)
            if not article_html:
                continue

            content_data = extract_article_content(article_html)
            title = content_data["title"] or link["title"]
            content = content_data["content"]

            # شروط: نص كبير (>= 100 chars)
            if len(content) < 100:
                continue

            # شروط: عنوان كافٍ (>= 15 chars)
            if len(title) < 15:
                continue

            all_articles.append({
                "title": title,
                "content": content,
                "url": link["url"],
                "source": source_key,
                "source_name": source["name"],
                "priority": source["priority"],
                "published_at": datetime.now(timezone.utc).isoformat(),
            })

            # Rate limiting: 2 seconds between requests
            time.sleep(2)

    log.info(f"[News] Fetched {len(all_articles)} articles from {source['name']}")
    return all_articles


def save_articles(articles: List[Dict]):
    """Save articles to news.db.market_news."""
    if not articles:
        return 0

    conn = get_news_db()
    ensure_market_news_table(conn)

    saved = 0
    for article in articles:
        try:
            conn.execute("""
                INSERT OR IGNORE INTO market_news
                    (title, content, url, source, source_type, published_at, importance, market)
                VALUES (?, ?, ?, ?, 'web', ?, ?, 'EGX')
            """, (
                article["title"],
                article["content"],
                article["url"],
                article["source"],
                article["published_at"],
                article["priority"],
            ))
            saved += 1
        except Exception as e:
            log.error(f"[News] Error saving article: {e}")

    conn.commit()
    conn.close()
    log.info(f"[News] Saved {saved} articles to news.db")
    return saved


# ============================================================================
# Main
# ============================================================================

def run_all_sources():
    """Fetch news from all sources."""
    total = 0
    for source_key in NEWS_SOURCES:
        try:
            articles = fetch_source_news(source_key)
            saved = save_articles(articles)
            total += saved
        except Exception as e:
            log.error(f"[News] Error with source {source_key}: {e}")

    log.info(f"[News] Total articles saved: {total}")
    return total


def run_daemon(interval_minutes: int = 30):
    """Run as daemon — fetches news every 30 minutes."""
    log.info(f"Starting News Engine daemon (interval: {interval_minutes}m)")
    while True:
        try:
            run_all_sources()
        except Exception as e:
            log.error(f"Daemon error: {e}")

        log.info(f"Sleeping {interval_minutes}m...")
        time.sleep(interval_minutes * 60)


def main():
    parser = argparse.ArgumentParser(description="News Engine — unified news collector")
    parser.add_argument("--source", choices=list(NEWS_SOURCES.keys()),
                        help="Fetch from a specific source only")
    parser.add_argument("--daemon", action="store_true",
                        help="Run as background daemon")
    parser.add_argument("--interval", type=int, default=30,
                        help="Daemon update interval in minutes (default: 30)")
    args = parser.parse_args()

    if args.daemon:
        run_daemon(args.interval)
    elif args.source:
        articles = fetch_source_news(args.source)
        save_articles(articles)
    else:
        run_all_sources()


if __name__ == "__main__":
    main()
