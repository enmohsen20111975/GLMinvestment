#!/usr/bin/env python3
"""
run_news_collector.py — سكريبت مستقل لجمع الأخبار
====================================================
يجمع من كل المصادر المتاحة بدون الاعتماد على news-agent/main.py

Usage:
  python3 scripts/run_news_collector.py
  python3 scripts/run_news_collector.py --daemon  # كل 30 دقيقة

يعمل على VPS والساندبوكس.
"""
import os, sys, sqlite3, time, re, argparse
from urllib.parse import quote, urlsplit, urlunsplit
import urllib.request
from html.parser import HTMLParser
from pathlib import Path
from datetime import datetime

PROJECT_ROOT = Path(__file__).resolve().parent.parent
DB_PATH = PROJECT_ROOT / 'db' / 'news.db'
UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'

class LExt(HTMLParser):
    def __init__(self):
        super().__init__()
        self.links = []
        self._in_a = False
        self._href = ''
        self._text = ''
    def handle_starttag(self, tag, attrs):
        if tag == 'a':
            d = dict(attrs)
            self._in_a = True
            self._href = d.get('href', '')
            self._text = ''
    def handle_data(self, data):
        if self._in_a: self._text += data.strip()
    def handle_endtag(self, tag):
        if tag == 'a' and self._in_a:
            if len(self._text) >= 15 and self._href:
                self.links.append({'url': self._href, 'title': self._text})
            self._in_a = False

class AExt(HTMLParser):
    def __init__(self):
        super().__init__()
        self.title = ''
        self.content = ''
        self._in_p = False
        self._ptext = ''
        self._in_title = False
    def handle_starttag(self, tag, attrs):
        if tag == 'title': self._in_title = True
        if tag == 'p': self._in_p = True; self._ptext = ''
    def handle_data(self, data):
        if self._in_title: self.title += data.strip()
        if self._in_p: self._ptext += data.strip()
    def handle_endtag(self, tag):
        if tag == 'title': self._in_title = False
        if tag == 'p' and self._in_p:
            if len(self._ptext) >= 30: self.content += self._ptext + '\n'
            self._in_p = False

def fetch(url, timeout=15):
    parsed = urlsplit(url)
    path = quote(parsed.path, safe='/%')
    query = quote(parsed.query, safe='=&%+')
    encoded = urlunsplit((parsed.scheme, parsed.netloc, path, query, ''))
    req = urllib.request.Request(encoded, headers={'User-Agent': UA, 'Accept-Language': 'ar,en;q=0.9'})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return resp.read().decode('utf-8', errors='replace')

def save_article(conn, title, content, url, source):
    """حفظ خبر في news.db مع شروط صارمة"""
    if len(title) < 15: return False
    if len(content) < 100: return False
    # مش رد شات
    if 'reply' in content.lower() or 'replied' in content.lower(): return False
    # مش إنجليزي (نسبة الأحرف الإنجليزية < 50%)
    if len(re.findall(r'[a-zA-Z]', content)) > len(content) * 0.5: return False
    
    try:
        conn.execute('''INSERT OR IGNORE INTO market_news 
            (title, content, url, source, source_type, fetched_at, market) 
            VALUES (?,?,?,?,\"web\",datetime(\"now\"),\"EGX\")''',
            (title[:500], content[:5000], url, source))
        return True
    except:
        return False

def collect_from_web(conn):
    """جمع من مواقع الأخبار عبر scraping"""
    sources = {
        'youm7': ('https://www.youm7.com/Tags/Index?id=56257&tag=%D8%B3%D9%88%D9%82-%D8%A7%D9%84%D9%85%D8%A7%D9%84', 'https://www.youm7.com'),
        'alborsaanews': ('https://www.alborsaanews.com/category/%D8%A7%D9%84%D8%A8%D9%88%D8%B1%D8%B5%D8%A9-%D9%88%D8%A7%D9%84%D8%B4%D8%B1%D9%83%D8%A7%D8%AA', 'https://www.alborsaanews.com'),
    }
    
    total = 0
    for source, (url, base) in sources.items():
        try:
            html = fetch(url)
            ext = LExt()
            ext.feed(html)
            
            arts = []
            seen = set()
            for l in ext.links:
                u = l['url']
                if not u.startswith('http'):
                    u = base + u if u.startswith('/') else base + '/' + u
                if u in seen: continue
                seen.add(u)
                if any(x in u for x in ['/Story/', '/article/', '/post/', '/news/', '/2026/']):
                    arts.append({'url': u, 'title': l['title']})
            
            for a in arts[:10]:
                try:
                    ah = fetch(a['url'])
                    ae = AExt()
                    ae.feed(ah)
                    title = ae.title or a['title']
                    content = ae.content.strip()
                    if save_article(conn, title, content, a['url'], source):
                        total += 1
                        print(f'  + [{source}] {title[:60]}')
                    time.sleep(1.5)
                except: pass
        except Exception as e:
            print(f'  {source}: {str(e)[:60]}')
    return total

def collect_from_rss(conn):
    """جمع من RSS/Atom feeds"""
    feeds = {
        'alborsaanews_rss': 'https://www.alborsaanews.com/feed',
        'amwalalghad_atom': 'https://amwalalghad.com/feed/atom/',
    }
    
    total = 0
    for source, url in feeds.items():
        try:
            xml = fetch(url)
            items = re.findall(r'<entry>(.*?)</entry>|<item>(.*?)</item>', xml, re.DOTALL)
            items = [i[0] or i[1] for i in items if i[0] or i[1]]
            
            for item in items[:10]:
                title_m = re.search(r'<title[^>]*>(?:!\[CDATA\[)?(.*?)(?:\]\]>)?</title>', item, re.DOTALL)
                link_m = re.search(r'<link[^>]*>(.*?)</link>|<link[^>]*href="([^"]*)"', item)
                desc_m = re.search(r'<summary[^>]*>(?:!\[CDATA\[)?(.*?)(?:\]\]>)?</summary>|<description[^>]*>(?:!\[CDATA\[)?(.*?)(?:\]\]>)?</description>', item, re.DOTALL)
                
                title = (title_m.group(1) if title_m else '').strip()
                # إزالة CDATA wrapper لو موجود
                title = title.replace('<![CDATA[', '').replace(']]>', '').strip()
                link = ''
                if link_m:
                    link = (link_m.group(1) or link_m.group(2) or '').strip()
                desc = ''
                if desc_m:
                    desc = (desc_m.group(1) or desc_m.group(2) or '').strip()
                content = re.sub(r'<[^>]+>', '', desc).strip()
                
                if save_article(conn, title, content, link, source):
                    total += 1
                    print(f'  + [{source}] {title[:60]}')
        except Exception as e:
            print(f'  {source}: {str(e)[:60]}')
    return total

def collect_from_telegram(conn):
    """جمع من Telegram عبر telethon"""
    try:
        from telethon import TelegramClient
    except ImportError:
        print('  Telegram: telethon not installed')
        return 0
    
    api_id = os.getenv('TELEGRAM_API_ID', '34557076')
    api_hash = os.getenv('TELEGRAM_API_HASH', 'fe604a9844bf753210acb4e648af4155')
    session_path = str(PROJECT_ROOT / 'news-agent' / 'data' / 'telegram_news_session')
    
    channels = ['sahmmisr', 'borsablarabi', 'easier_stock', 'ostoulcapital', 'BursaAcademy']
    total = 0
    
    import asyncio
    async def fetch_telegram():
        nonlocal total
        client = TelegramClient(session_path, int(api_id), api_hash)
        await client.connect()
        
        if not await client.is_user_authorized():
            print('  Telegram: needs login (run interactive login first)')
            await client.disconnect()
            return
        
        for ch in channels:
            try:
                entity = await client.get_entity(ch)
                messages = await client.get_messages(entity, limit=10)
                for msg in messages:
                    if not msg.text or len(msg.text) < 100: continue
                    # شروط: مش رد + نص كبير + عربي
                    if msg.reply_to_msg_id: continue  # skip replies
                    if len(re.findall(r'[a-zA-Z]', msg.text)) > len(msg.text) * 0.5: continue
                    
                    title = msg.text[:80] + '...' if len(msg.text) > 80 else msg.text
                    url = f'https://t.me/{ch}/{msg.id}'
                    try:
                        conn.execute('''INSERT OR IGNORE INTO market_news 
                            (title, content, url, source, source_type, fetched_at, market) 
                            VALUES (?,?,?,?,\"telegram\",datetime(\"now\"),\"EGX\")''',
                            (title[:500], msg.text[:5000], url, f'@{ch}'))
                        total += 1
                        print(f'  + [telegram:@{ch}] {title[:60]}')
                    except: pass
            except Exception as e:
                print(f'  telegram @{ch}: {str(e)[:40]}')
        
        await client.disconnect()
    
    try:
        asyncio.run(fetch_telegram())
    except Exception as e:
        print(f'  Telegram: {str(e)[:60]}')
    return total

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--daemon', action='store_true')
    parser.add_argument('--interval', type=int, default=30)
    args = parser.parse_args()
    
    while True:
        print(f'\n{"="*60}')
        print(f'📰 News Collector — {datetime.now().strftime("%Y-%m-%d %H:%M")}')
        print(f'{"="*60}')
        
        # Phase 7.1: migrated to db_manager (writable=False)
        from core.db_manager import db_manager
        conn = db_manager.connection(str(DB_PATH), writable=False).__enter__()
        
        print('\n📡 Web scraping:')
        web_count = collect_from_web(conn)
        
        print('\n📡 RSS/Atom feeds:')
        rss_count = collect_from_rss(conn)
        
        print('\n📡 Telegram:')
        tg_count = collect_from_telegram(conn)
        
        conn.commit()
        conn.close()
        
        total = web_count + rss_count + tg_count
        print(f'\n✅ Total new articles: {total}')
        print(f'   Web: {web_count} | RSS: {rss_count} | Telegram: {tg_count}')
        
        if not args.daemon:
            break
        
        print(f'\n💤 Next run in {args.interval} minutes...')
        time.sleep(args.interval * 60)

if __name__ == '__main__':
    main()
