#!/usr/bin/env python3
"""
Migrate news.db: create market_news table and copy data from news_articles.

The news.db from data/all.zip only has `news_articles` table.
The current code expects `market_news` table.
This script creates market_news and copies the data.
"""
import sqlite3
import os
import json
from datetime import datetime

import os as _os
DB_PATH = _os.path.join(_os.path.dirname(_os.path.dirname(_os.path.abspath(__file__))), 'db', 'news.db')

print('=' * 70)
print('News DB Migration — news_articles → market_news')
print('=' * 70)

# Phase 7.1: migrated to db_manager (writable=False)
from core.db_manager import db_manager
conn = db_manager.connection(DB_PATH, writable=False).__enter__()
conn.execute('PRAGMA busy_timeout = 10000')

# Step 1: Check if market_news already exists
cur = conn.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='market_news'")
exists = cur.fetchone()
if exists:
    count = conn.execute('SELECT COUNT(*) FROM market_news').fetchone()[0]
    print(f'\nmarket_news already exists with {count} rows. Skipping migration.')
    conn.close()
    exit(0)

# Step 2: Create market_news table (same schema as in src/app/api/news/route.ts)
print('\n=== Step 1: Create market_news table ===')
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
conn.commit()
print('  ✓ market_news table created')

# Step 3: Copy data from news_articles to market_news
print('\n=== Step 2: Copy data from news_articles → market_news ===')

# Get news_articles data
cur = conn.execute('''
    SELECT
        title, content, summary, source, source_url, image_url,
        market, market_code, symbol, category, language,
        published_at, fetched_at, created_at
    FROM news_articles
''')
rows = cur.fetchall()
print(f'  Found {len(rows)} articles in news_articles')

# Map and insert
migrated = 0
skipped = 0
for row in rows:
    (title, content, summary, source, source_url, image_url,
     market, market_code, symbol, category, language,
     published_at, fetched_at, created_at) = row

    if not title:
        skipped += 1
        continue

    # Map fields
    summary_ar = summary if language == 'ar' else None
    summary_en = summary if language == 'en' else None
    source_type = 'web'
    url = source_url
    tickers = json.dumps([symbol] if symbol else [])
    importance = 0
    sentiment = 'neutral'
    impact_type = category or 'general'
    market_val = market or market_code or 'EGX'
    image_paths = json.dumps([image_url] if image_url else [])
    ocr_text = ''
    raw_analysis = '{}'
    fetched_at_val = fetched_at or created_at or datetime.now().isoformat()

    try:
        conn.execute('''
            INSERT OR IGNORE INTO market_news
            (title, content, summary_ar, summary_en, source, source_type, url,
             tickers, importance, sentiment, impact_type, market, image_paths,
             ocr_text, raw_analysis, published_at, fetched_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ''', (title, content, summary_ar, summary_en, source, source_type, url,
              tickers, importance, sentiment, impact_type, market_val, image_paths,
              ocr_text, raw_analysis, published_at, fetched_at_val))
        migrated += 1
    except Exception as e:
        skipped += 1

conn.commit()
print(f'  ✓ Migrated {migrated} articles, skipped {skipped}')

# Step 4: Verify
count = conn.execute('SELECT COUNT(*) FROM market_news').fetchone()[0]
print(f'\n=== Step 3: Verify ===')
print(f'  market_news: {count} rows')
print(f'  news_articles: {len(rows)} rows (preserved)')

# Show sample
cur = conn.execute('SELECT title, source, market, published_at FROM market_news ORDER BY published_at DESC LIMIT 3')
print(f'\n  Sample (latest 3):')
for row in cur:
    print(f'    - [{row[1]}] {row[0][:80]}... (market={row[2]}, date={row[3]})')

conn.close()
print('\n' + '=' * 70)
print('Migration complete!')
print('=' * 70)
