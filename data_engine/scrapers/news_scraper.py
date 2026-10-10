#!/usr/bin/env python3
"""
📰 News Scraper - Arabic Financial News Aggregator
====================================================
Collects financial news from multiple sources with round-robin API key distribution

Sources:
- NewsAPI (newsapi.org)
- GNews (gnews.io)
- AlphaVantage (alphavantage.co)
- MediaStack (mediastack.com)
- CurrentsAPI (currentsapi.services)

Schedule: Every 6 hours
Markets: مصر، السعودية، الكويت، قطر
"""

import os
import sys
import json
import sqlite3
import requests
from pathlib import Path
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Tuple
import random

# Add config to path
sys.path.insert(0, str(Path(__file__).parent.parent / 'config'))

# Directories
BASE_DIR = Path(__file__).parent.parent
DATA_DIR = BASE_DIR.parent / 'db'
NEWS_DB = str(DATA_DIR / 'news.db')

# News keywords for each market
MARKET_KEYWORDS = {
    'EGX': {
        'country': 'eg',
        'keywords': ['EGX', 'مصر', 'البورصة المصرية', 'جنيه مصري', 'البنك المركزي', 
                     'EGP', 'سوق المال المصري', 'بورصة القاهرة'],
        'sources': ['newsapi', 'gnews', 'currentsapi']
    },
    'TADAWUL': {
        'country': 'sa',
        'keywords': ['TADAWUL', 'السعودية', 'السوق المالية السعودية', 'ريال سعودي',
                     'SAR', 'أرامكو', 'البنك المركزي السعودي'],
        'sources': ['newsapi', 'gnews', 'currentsapi']
    },
    'KSE': {
        'country': 'kw',
        'keywords': ['KSE', 'الكويت', 'بورصة الكويت', 'دينار كويتي', 'KWD',
                     'سوق الكويت للأوراق المالية'],
        'sources': ['newsapi', 'gnews', 'currentsapi']
    },
    'QSE': {
        'country': 'qa',
        'keywords': ['QSE', 'قطر', 'بورصة قطر', 'ريال قطري', 'QAR',
                     'سوق الدوحة للأوراق المالية'],
        'sources': ['newsapi', 'gnews', 'currentsapi']
    },
    'GENERAL': {
        'country': None,
        'keywords': ['أسهم', 'بورصة', 'اقتصاد', 'ذهب', 'نفط', 'عملات رقمية',
                     'بيتكوين', 'ايثيريوم', 'سوق المال', 'الأسواق المالية'],
        'sources': ['newsapi', 'gnews', 'alphavantage', 'mediastack', 'currentsapi']
    }
}

# Market holidays for scheduling
MARKET_HOLIDAYS = {
    'EGX': [
        '2025-01-07', '2025-01-25', '2025-03-30', '2025-03-31', '2025-04-01',
        '2025-04-25', '2025-05-01', '2025-06-06', '2025-06-07', '2025-06-08',
        '2025-06-09', '2025-06-26', '2025-07-23', '2025-09-04', '2025-10-06'
    ],
    'TADAWUL': [
        '2025-02-22', '2025-03-30', '2025-03-31', '2025-04-01', '2025-04-02',
        '2025-04-03', '2025-09-23', '2025-06-06', '2025-06-07', '2025-06-08',
        '2025-06-09', '2025-06-10', '2025-06-11', '2025-06-26'
    ],
    'KSE': [
        '2025-02-25', '2025-02-26', '2025-03-30', '2025-03-31', '2025-04-01',
        '2025-06-06', '2025-06-07', '2025-06-08', '2025-06-26', '2025-09-04'
    ],
    'QSE': [
        '2025-02-11', '2025-03-30', '2025-03-31', '2025-04-01',
        '2025-06-06', '2025-06-07', '2025-06-08', '2025-06-26',
        '2025-09-04', '2025-12-18'
    ]
}


class NewsScraper:
    def __init__(self):
        self.api_keys = self.load_api_keys()
        self.key_usage = {k: 0 for k in self.api_keys.keys()}
        self.session = requests.Session()
        self.session.headers.update({
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        })
        
    def load_api_keys(self) -> Dict:
        """Load API keys from database or environment"""
        keys = {}
        
        # Try to load from database first
        try:
            conn = sqlite3.connect(NEWS_DB)
            cursor = conn.cursor()
            cursor.execute('SELECT service, api_key, api_url, dashboard_url, is_active FROM news_api_keys WHERE is_active = 1')
            for row in cursor.fetchall():
                keys[row[0].lower()] = {
                    'key': row[1],
                    'url': row[2],
                    'dashboard': row[3],
                    'active': row[4]
                }
            conn.close()
        except:
            pass
        
        # Fallback to environment variables
        env_keys = {
            'newsapi': os.getenv('NEWSAPI_KEY'),
            'gnews': os.getenv('GNEWS_KEY'),
            'alphavantage': os.getenv('ALPHAVANTAGE_KEY'),
            'mediastack': os.getenv('MEDIASTACK_KEY'),
            'currentsapi': os.getenv('CURRENTSAPI_KEY')
        }
        
        for service, key in env_keys.items():
            if key and service not in keys:
                keys[service] = {'key': key, 'url': None, 'dashboard': None, 'active': True}
        
        return keys
    
    def get_next_key(self, service: str) -> Optional[str]:
        """Get next available key using round-robin"""
        service = service.lower()
        if service not in self.api_keys:
            return None
        return self.api_keys[service]['key']
    
    def init_database(self):
        """Initialize news database"""
        conn = sqlite3.connect(NEWS_DB)
        cursor = conn.cursor()
        
        # News articles table
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS news_articles (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                title TEXT NOT NULL,
                content TEXT,
                summary TEXT,
                source TEXT,
                source_url TEXT,
                image_url TEXT,
                market TEXT,
                market_code TEXT,
                symbol TEXT,
                category TEXT,
                language TEXT DEFAULT 'ar',
                published_at TEXT,
                fetched_at TEXT DEFAULT CURRENT_TIMESTAMP,
                created_at TEXT DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(title, source, published_at)
            )
        ''')
        
        # API keys table
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS news_api_keys (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                service TEXT UNIQUE,
                api_key TEXT,
                api_url TEXT,
                dashboard_url TEXT,
                is_active INTEGER DEFAULT 1,
                daily_limit INTEGER,
                daily_used INTEGER DEFAULT 0,
                last_used TEXT,
                last_error TEXT,
                status TEXT DEFAULT 'active',
                created_at TEXT DEFAULT CURRENT_TIMESTAMP,
                updated_at TEXT DEFAULT CURRENT_TIMESTAMP
            )
        ''')
        
        # Create indexes
        cursor.execute('CREATE INDEX IF NOT EXISTS idx_news_market ON news_articles(market_code)')
        cursor.execute('CREATE INDEX IF NOT EXISTS idx_news_symbol ON news_articles(symbol)')
        cursor.execute('CREATE INDEX IF NOT EXISTS idx_news_published ON news_articles(published_at)')
        cursor.execute('CREATE INDEX IF NOT EXISTS idx_news_source ON news_articles(source)')
        
        conn.commit()
        conn.close()
        print(f"✅ Database initialized: {NEWS_DB}")
    
    def fetch_from_newsapi(self, market_code: str, keywords: List[str]) -> List[Dict]:
        """Fetch news from NewsAPI"""
        key = self.get_next_key('newsapi')
        if not key:
            return []
        
        articles = []
        try:
            # Build query
            query = ' OR '.join(keywords[:3])  # Use top 3 keywords
            
            url = f"https://newsapi.org/v2/everything"
            params = {
                'q': query,
                'language': 'ar',
                'sortBy': 'publishedAt',
                'pageSize': 20,
                'apiKey': key
            }
            
            # Add country if available
            country = MARKET_KEYWORDS.get(market_code, {}).get('country')
            if country:
                params['country'] = country
            
            response = self.session.get(url, params=params, timeout=30)
            data = response.json()
            
            if data.get('status') == 'ok':
                for article in data.get('articles', []):
                    articles.append({
                        'title': article.get('title', ''),
                        'content': article.get('content', '') or article.get('description', ''),
                        'summary': article.get('description', ''),
                        'source': 'NewsAPI',
                        'source_url': article.get('url', ''),
                        'image_url': article.get('urlToImage', ''),
                        'market_code': market_code,
                        'published_at': article.get('publishedAt', ''),
                        'language': 'ar'
                    })
                self.key_usage['newsapi'] += 1
                print(f"  📰 NewsAPI: {len(articles)} articles")
            
        except Exception as e:
            print(f"  ❌ NewsAPI error: {str(e)[:50]}")
            self.update_key_status('newsapi', 'error', str(e)[:100])
        
        return articles
    
    def fetch_from_gnews(self, market_code: str, keywords: List[str]) -> List[Dict]:
        """Fetch news from GNews"""
        key = self.get_next_key('gnews')
        if not key:
            return []
        
        articles = []
        try:
            query = ' OR '.join(keywords[:3])
            
            url = "https://gnews.io/api/v4/search"
            params = {
                'q': query,
                'lang': 'ar',
                'max': 20,
                'token': key
            }
            
            response = self.session.get(url, params=params, timeout=30)
            data = response.json()
            
            if 'articles' in data:
                for article in data['articles']:
                    articles.append({
                        'title': article.get('title', ''),
                        'content': article.get('content', ''),
                        'summary': article.get('description', ''),
                        'source': 'GNews',
                        'source_url': article.get('url', ''),
                        'image_url': article.get('image', ''),
                        'market_code': market_code,
                        'published_at': article.get('publishedAt', ''),
                        'language': 'ar'
                    })
                self.key_usage['gnews'] += 1
                print(f"  📰 GNews: {len(articles)} articles")
            
        except Exception as e:
            print(f"  ❌ GNews error: {str(e)[:50]}")
            self.update_key_status('gnews', 'error', str(e)[:100])
        
        return articles
    
    def fetch_from_alphavantage(self, market_code: str) -> List[Dict]:
        """Fetch news from AlphaVantage"""
        key = self.get_next_key('alphavantage')
        if not key:
            return []
        
        articles = []
        try:
            url = "https://www.alphavantage.co/query"
            params = {
                'function': 'NEWS_SENTIMENT',
                'apikey': key,
                'limit': 20
            }
            
            response = self.session.get(url, params=params, timeout=30)
            data = response.json()
            
            if 'feed' in data:
                for article in data['feed']:
                    articles.append({
                        'title': article.get('title', ''),
                        'content': article.get('summary', ''),
                        'summary': article.get('summary', '')[:500] if article.get('summary') else '',
                        'source': 'AlphaVantage',
                        'source_url': article.get('url', ''),
                        'image_url': article.get('banner_image', ''),
                        'market_code': market_code,
                        'published_at': article.get('time_published', ''),
                        'language': 'en'
                    })
                self.key_usage['alphavantage'] += 1
                print(f"  📰 AlphaVantage: {len(articles)} articles")
            
        except Exception as e:
            print(f"  ❌ AlphaVantage error: {str(e)[:50]}")
            self.update_key_status('alphavantage', 'error', str(e)[:100])
        
        return articles
    
    def fetch_from_mediastack(self, market_code: str, keywords: List[str]) -> List[Dict]:
        """Fetch news from MediaStack"""
        key = self.get_next_key('mediastack')
        if not key:
            return []
        
        articles = []
        try:
            url = "http://api.mediastack.com/v1/news"
            params = {
                'access_key': key,
                'languages': 'ar',
                'limit': 20,
                'keywords': ','.join(keywords[:3])
            }
            
            country = MARKET_KEYWORDS.get(market_code, {}).get('country')
            if country:
                params['countries'] = country
            
            response = self.session.get(url, params=params, timeout=30)
            data = response.json()
            
            if 'data' in data:
                for article in data['data']:
                    articles.append({
                        'title': article.get('title', ''),
                        'content': article.get('description', ''),
                        'summary': article.get('description', '')[:500] if article.get('description') else '',
                        'source': 'MediaStack',
                        'source_url': article.get('url', ''),
                        'image_url': article.get('image', ''),
                        'market_code': market_code,
                        'published_at': article.get('published_at', ''),
                        'language': 'ar'
                    })
                self.key_usage['mediastack'] += 1
                print(f"  📰 MediaStack: {len(articles)} articles")
            
        except Exception as e:
            print(f"  ❌ MediaStack error: {str(e)[:50]}")
            self.update_key_status('mediastack', 'error', str(e)[:100])
        
        return articles
    
    def fetch_from_currentsapi(self, market_code: str, keywords: List[str]) -> List[Dict]:
        """Fetch news from CurrentsAPI"""
        key = self.get_next_key('currentsapi')
        if not key:
            return []
        
        articles = []
        try:
            url = "https://api.currentsapi.services/v1/search"
            params = {
                'keywords': ','.join(keywords[:3]),
                'language': 'ar',
                'apiKey': key
            }
            
            response = self.session.get(url, params=params, timeout=30)
            data = response.json()
            
            if 'news' in data:
                for article in data['news']:
                    articles.append({
                        'title': article.get('title', ''),
                        'content': article.get('description', ''),
                        'summary': article.get('description', '')[:500] if article.get('description') else '',
                        'source': 'CurrentsAPI',
                        'source_url': article.get('url', ''),
                        'image_url': article.get('image', ''),
                        'market_code': market_code,
                        'published_at': article.get('published', ''),
                        'language': 'ar'
                    })
                self.key_usage['currentsapi'] += 1
                print(f"  📰 CurrentsAPI: {len(articles)} articles")
            
        except Exception as e:
            print(f"  ❌ CurrentsAPI error: {str(e)[:50]}")
            self.update_key_status('currentsapi', 'error', str(e)[:100])
        
        return articles
    
    def update_key_status(self, service: str, status: str, error: str = None):
        """Update API key status in database"""
        try:
            conn = sqlite3.connect(NEWS_DB)
            cursor = conn.cursor()
            cursor.execute('''
                UPDATE news_api_keys 
                SET status = ?, last_error = ?, last_used = ?, updated_at = ?
                WHERE service = ?
            ''', (status, error, datetime.now().isoformat(), datetime.now().isoformat(), service))
            conn.commit()
            conn.close()
        except:
            pass
    
    def save_articles(self, articles: List[Dict]) -> int:
        """Save articles to database"""
        if not articles:
            return 0
        
        conn = sqlite3.connect(NEWS_DB)
        cursor = conn.cursor()
        saved = 0
        
        for article in articles:
            try:
                cursor.execute('''
                    INSERT OR IGNORE INTO news_articles 
                    (title, content, summary, source, source_url, image_url, 
                     market_code, published_at, language)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                ''', (
                    article.get('title', ''),
                    article.get('content', ''),
                    article.get('summary', ''),
                    article.get('source', ''),
                    article.get('source_url', ''),
                    article.get('image_url', ''),
                    article.get('market_code', ''),
                    article.get('published_at', ''),
                    article.get('language', 'ar')
                ))
                if cursor.rowcount > 0:
                    saved += 1
            except Exception as e:
                pass
        
        conn.commit()
        conn.close()
        return saved
    
    def run(self, market_code: str = None) -> Dict:
        """Run news scraper for all markets or specific market"""
        print("\n" + "=" * 60)
        print("📰 News Scraper Started")
        print("=" * 60)
        
        self.init_database()
        
        markets = [market_code] if market_code else list(MARKET_KEYWORDS.keys())
        total_articles = 0
        total_saved = 0
        
        for market in markets:
            print(f"\n📊 Fetching news for {market}...")
            
            config = MARKET_KEYWORDS.get(market, MARKET_KEYWORDS['GENERAL'])
            keywords = config['keywords']
            sources = config['sources']
            
            # Shuffle sources for round-robin distribution
            random.shuffle(sources)
            
            market_articles = []
            
            # Fetch from each source
            for source in sources:
                if len(market_articles) >= 30:  # Limit per market
                    break
                
                try:
                    if source == 'newsapi':
                        articles = self.fetch_from_newsapi(market, keywords)
                    elif source == 'gnews':
                        articles = self.fetch_from_gnews(market, keywords)
                    elif source == 'alphavantage':
                        articles = self.fetch_from_alphavantage(market)
                    elif source == 'mediastack':
                        articles = self.fetch_from_mediastack(market, keywords)
                    elif source == 'currentsapi':
                        articles = self.fetch_from_currentsapi(market, keywords)
                    else:
                        continue
                    
                    market_articles.extend(articles)
                    
                    # Small delay between API calls
                    import time
                    time.sleep(1)
                    
                except Exception as e:
                    print(f"  ⚠️ {source} error: {str(e)[:30]}")
            
            # Save articles
            saved = self.save_articles(market_articles)
            total_articles += len(market_articles)
            total_saved += saved
            print(f"  💾 Saved {saved} new articles for {market}")
        
        print("\n" + "=" * 60)
        print(f"✅ News Scraper Complete")
        print(f"   Total fetched: {total_articles}")
        print(f"   Total saved: {total_saved}")
        print(f"   Key usage: {self.key_usage}")
        print("=" * 60)
        
        return {
            'fetched': total_articles,
            'saved': total_saved,
            'key_usage': self.key_usage
        }


def main():
    """Main entry point"""
    scraper = NewsScraper()
    result = scraper.run()
    return result


if __name__ == '__main__':
    main()
