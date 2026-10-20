"""
db_writer.py — كاتب مباشر لـ db/news.db.market_news (بايثون، بدون Node)
=====================================================================
DATA-ENGINE-UNIFY-1 / News Stage 1: bypass Node.js
الـ news-agent بـ write مباشرة في news.db.market_news بـ UNIQUE(title, source).
ده الـ canonical store — مش محتاجين Node.js يتوسط.

الاستخدام:
  from sender.db_writer import NewsDBWriter
  writer = NewsDBWriter()
  await writer.write_batch(items)
"""
from __future__ import annotations

import json
import logging
import os
import sqlite3
from datetime import datetime
from pathlib import Path

log = logging.getLogger('NewsDBWriter')

# Canonical path: <project_root>/db/news.db
# news-agent في <project_root>/news-agent/، فـ parents[2] = project_root
PROJECT_ROOT = Path(__file__).resolve().parents[2]
NEWS_DB = PROJECT_ROOT / 'db' / 'news.db'

# fallback لو الـ env var موجود
_env_db = os.getenv('NEWS_DB_PATH', '').strip()
if _env_db:
    NEWS_DB = Path(_env_db)


class NewsDBWriter:
    """كاتب مباشر لـ news.db.market_news — بايثون، بدون Node.js."""

    def __init__(self):
        self.db_path = str(NEWS_DB)
        self._ensure_schema()

    def _ensure_schema(self):
        """تأكد إن market_news table موجودة بـ الـ schema الكنسوني."""
        try:
            conn = sqlite3.connect(self.db_path, timeout=30.0)
            conn.execute('PRAGMA journal_mode=WAL')
            conn.execute('PRAGMA busy_timeout=30000')
            conn.execute('''
                CREATE TABLE IF NOT EXISTS market_news (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    title TEXT NOT NULL,
                    content TEXT,
                    summary_ar TEXT,
                    summary_en TEXT,
                    source TEXT NOT NULL,
                    source_type TEXT DEFAULT 'news_agent',
                    url TEXT,
                    tickers TEXT DEFAULT '[]',
                    importance INTEGER DEFAULT 50,
                    sentiment TEXT DEFAULT 'neutral',
                    impact_type TEXT DEFAULT 'general',
                    market TEXT DEFAULT 'EGX',
                    image_paths TEXT DEFAULT '[]',
                    ocr_text TEXT,
                    raw_analysis TEXT,
                    published_at TEXT,
                    fetched_at TEXT,
                    sent_at TEXT,
                    is_sent INTEGER DEFAULT 0,
                    is_catalyst INTEGER DEFAULT 0,
                    UNIQUE(title, source)
                )
            ''')
            conn.execute('CREATE INDEX IF NOT EXISTS idx_market_news_market ON market_news(market)')
            conn.execute('CREATE INDEX IF NOT EXISTS idx_market_news_published ON market_news(published_at)')
            conn.execute('CREATE INDEX IF NOT EXISTS idx_market_news_tickers ON market_news(tickers)')
            conn.commit()
            conn.close()
        except Exception as e:
            log.error(f'_ensure_schema failed: {e}')

    def _format_for_db(self, news: dict) -> dict:
        """نظّف الخبر للـ DB schema."""
        raw = news.get('raw_analysis', '{}')
        if isinstance(raw, str):
            try:
                analysis = json.loads(raw)
            except Exception:
                analysis = {}
        elif isinstance(raw, dict):
            analysis = raw
        else:
            analysis = {}

        tickers = news.get('tickers', [])
        if isinstance(tickers, str):
            try:
                tickers = json.loads(tickers)
            except Exception:
                tickers = []
        if not isinstance(tickers, list):
            tickers = []

        image_paths = news.get('image_paths', [])
        if isinstance(image_paths, str):
            try:
                image_paths = json.loads(image_paths)
            except Exception:
                image_paths = []
        if not isinstance(image_paths, list):
            image_paths = []

        clean_news = analysis.get('news_text', '') or news.get('body', '')[:800] if news.get('body') else ''

        return {
            'title':       news.get('title', '') or (clean_news[:80] if clean_news else 'untitled'),
            'content':     clean_news or news.get('body', ''),
            'summary_ar':  analysis.get('summary_ar', '') or news.get('summary_ar', ''),
            'summary_en':  analysis.get('summary_en', '') or news.get('summary_en', ''),
            'source':      news.get('source', 'news_agent'),
            'source_type': news.get('source_type', 'telegram'),
            'url':         news.get('url', ''),
            'tickers':     json.dumps(tickers, ensure_ascii=False),
            'importance':  int(news.get('importance', 50) or 50),
            'sentiment':   news.get('sentiment', 'neutral'),
            'impact_type': news.get('impact_type', 'general'),
            'market':      news.get('market', 'EGX'),
            'image_paths': json.dumps(image_paths, ensure_ascii=False),
            'ocr_text':    news.get('ocr_text', ''),
            'raw_analysis': json.dumps(analysis, ensure_ascii=False) if analysis else '{}',
            'published_at': news.get('published_at', ''),
            'fetched_at':  datetime.now().strftime('%Y-%m-%d %H:%M:%S'),
        }

    async def write_batch(self, items: list[dict]) -> int:
        """اكتب batch من الأخبار في market_news. Returns عدد الـ rows الجديدة."""
        if not items:
            return 0

        written = 0
        duplicates = 0
        errors = 0

        try:
            conn = sqlite3.connect(self.db_path, timeout=30.0)
            conn.execute('PRAGMA journal_mode=WAL')
            conn.execute('PRAGMA busy_timeout=30000')

            for news in items:
                try:
                    data = self._format_for_db(news)
                    conn.execute('''
                        INSERT OR IGNORE INTO market_news
                        (title, content, summary_ar, summary_en, source, source_type, url,
                         tickers, importance, sentiment, impact_type, market, image_paths,
                         ocr_text, raw_analysis, published_at, fetched_at)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    ''', (
                        data['title'], data['content'], data['summary_ar'], data['summary_en'],
                        data['source'], data['source_type'], data['url'],
                        data['tickers'], data['importance'], data['sentiment'],
                        data['impact_type'], data['market'], data['image_paths'],
                        data['ocr_text'], data['raw_analysis'], data['published_at'],
                        data['fetched_at'],
                    ))
                    if conn.total_changes > 0:
                        written += 1
                    else:
                        duplicates += 1
                except sqlite3.IntegrityError:
                    duplicates += 1
                except Exception as e:
                    errors += 1
                    log.error(f'write item failed: {e}')

            conn.commit()
            conn.close()

            log.info(f'  📝 DB write: {written} new, {duplicates} dups, {errors} errors')
            return written

        except Exception as e:
            log.error(f'write_batch failed: {e}')
            return 0

    async def write_single(self, news: dict) -> bool:
        """اكتب خبر واحد. Returns True لو new, False لو duplicate."""
        result = await self.write_batch([news])
        return result > 0

    def get_stats(self) -> dict:
        """إحصائيات الـ DB."""
        try:
            conn = sqlite3.connect(self.db_path, timeout=10.0)
            total = conn.execute('SELECT COUNT(*) FROM market_news').fetchone()[0]
            distinct = conn.execute('SELECT COUNT(DISTINCT title || source) FROM market_news').fetchone()[0]
            last = conn.execute('SELECT MAX(fetched_at) FROM market_news').fetchone()[0]
            conn.close()
            return {
                'total': total,
                'distinct': distinct,
                'duplicates': total - distinct,
                'last_fetched': last,
            }
        except Exception as e:
            return {'error': str(e)}
