#!/usr/bin/env python3
"""
Crypto Database Module
======================
قاعدة بيانات منفصلة للعملات الرقمية

Features:
- تخزين أسعار العملات الرقمية
- تخزين توقعات التليجرام للكريبتو
- تخزين الأخبار المتعلقة بالعملات
- سجل الأسعار اليومي
"""

import os
import sqlite3
import json
from datetime import datetime
from typing import List, Dict, Optional, Any
from contextlib import contextmanager

# Database path - من vps-service/core/ إلى db/crypto.db
# vps-service/core/crypto_database.py -> vps-service/ -> my-project/ -> db/crypto.db
BASE_DIR = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
DB_DIR = os.path.join(BASE_DIR, 'db')
CRYPTO_DB = os.path.join(DB_DIR, 'crypto.db')


class CryptoDatabase:
    """مدير قاعدة بيانات العملات الرقمية"""
    
    def __init__(self, db_path: str = CRYPTO_DB):
        self.db_path = db_path
        self._init_database()
    
    @contextmanager
    def get_connection(self):
        """الحصول على اتصال بقاعدة البيانات
        
        FIX (Aug 2026): Use safe_connect to enforce timeout=30 + busy_timeout=30000
        so concurrent crypto writes don't cause 'database is locked'.
        """
        try:
            from core.database import safe_connect
            conn = safe_connect(self.db_path, readonly=False)
        except ImportError:
            conn = sqlite3.connect(self.db_path, timeout=30.0)
            try:
                conn.execute('PRAGMA busy_timeout=30000')
                conn.execute('PRAGMA journal_mode=WAL')
            except Exception:
                pass
        conn.row_factory = sqlite3.Row
        try:
            yield conn
        finally:
            try:
                conn.close()
            except Exception:
                pass
    
    def _init_database(self):
        """إنشاء الجداول"""
        with self.get_connection() as conn:
            cursor = conn.cursor()
            
            # جدول العملات الأساسي
            cursor.execute('''
                CREATE TABLE IF NOT EXISTS cryptos (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    coin_id TEXT UNIQUE NOT NULL,
                    symbol TEXT NOT NULL,
                    name TEXT NOT NULL,
                    rank INTEGER DEFAULT 0,
                    current_price_usd REAL DEFAULT 0,
                    price_change_24h REAL DEFAULT 0,
                    price_change_7d REAL DEFAULT 0,
                    high_24h REAL DEFAULT 0,
                    low_24h REAL DEFAULT 0,
                    volume_24h REAL DEFAULT 0,
                    market_cap REAL DEFAULT 0,
                    circulating_supply REAL DEFAULT 0,
                    total_supply REAL DEFAULT 0,
                    max_supply REAL DEFAULT 0,
                    ath REAL DEFAULT 0,
                    atl REAL DEFAULT 0,
                    image_url TEXT,
                    last_update TEXT,
                    source TEXT DEFAULT 'coingecko',
                    is_active INTEGER DEFAULT 1,
                    created_at TEXT DEFAULT CURRENT_TIMESTAMP
                )
            ''')
            
            # جدول الأسعار المحلية (BTC بعملات عربية)
            cursor.execute('''
                CREATE TABLE IF NOT EXISTS btc_local_prices (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    currency TEXT UNIQUE NOT NULL,
                    country TEXT,
                    flag TEXT,
                    price_local REAL DEFAULT 0,
                    exchange_rate REAL DEFAULT 0,
                    last_update TEXT DEFAULT CURRENT_TIMESTAMP
                )
            ''')
            
            # جدول سجل الأسعار اليومي
            cursor.execute('''
                CREATE TABLE IF NOT EXISTS crypto_price_history (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    coin_id TEXT NOT NULL,
                    symbol TEXT NOT NULL,
                    date TEXT NOT NULL,
                    open REAL,
                    high REAL,
                    low REAL,
                    close REAL,
                    volume REAL,
                    market_cap REAL,
                    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
                    UNIQUE(coin_id, date)
                )
            ''')
            
            # جدول توقعات الكريبتو من التليجرام
            cursor.execute('''
                CREATE TABLE IF NOT EXISTS crypto_recommendations (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    message_id INTEGER,
                    channel_id TEXT,
                    channel_name TEXT,
                    symbol TEXT NOT NULL,
                    action TEXT,
                    entry_price REAL,
                    target_price REAL,
                    stop_loss REAL,
                    timeframe TEXT,
                    confidence REAL DEFAULT 0,
                    reasoning TEXT,
                    original_text TEXT,
                    expert_name TEXT,
                    is_verified INTEGER DEFAULT 0,
                    created_at TEXT DEFAULT CURRENT_TIMESTAMP
                )
            ''')
            
            # جدول أخبار الكريبتو
            cursor.execute('''
                CREATE TABLE IF NOT EXISTS crypto_news (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    message_id INTEGER,
                    channel_id TEXT,
                    channel_name TEXT,
                    title TEXT,
                    content TEXT,
                    sentiment TEXT DEFAULT 'neutral',
                    importance INTEGER DEFAULT 1,
                    symbols_mentioned TEXT,
                    original_text TEXT,
                    created_at TEXT DEFAULT CURRENT_TIMESTAMP
                )
            ''')
            
            # جدول حالة المزامنة
            cursor.execute('''
                CREATE TABLE IF NOT EXISTS sync_status (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    sync_type TEXT UNIQUE NOT NULL,
                    last_sync TEXT,
                    status TEXT DEFAULT 'idle',
                    records_updated INTEGER DEFAULT 0,
                    error_message TEXT
                )
            ''')
            
            # إضافة عملات عربية محلية
            local_currencies = [
                ('EGP', 'مصر', '🇪🇬'),
                ('SAR', 'السعودية', '🇸🇦'),
                ('KWD', 'الكويت', '🇰🇼'),
                ('QAR', 'قطر', '🇶🇦'),
                ('AED', 'الإمارات', '🇦🇪'),
                ('BHD', 'البحرين', '🇧🇭'),
                ('OMR', 'عمان', '🇴🇲'),
                ('JOD', 'الأردن', '🇯🇴')
            ]
            
            for currency, country, flag in local_currencies:
                cursor.execute('''
                    INSERT OR IGNORE INTO btc_local_prices (currency, country, flag)
                    VALUES (?, ?, ?)
                ''', (currency, country, flag))
            
            conn.commit()
            print(f"✅ Crypto database initialized at {self.db_path}")
    
    # ==================== CRYPTOS ====================
    
    def save_crypto(self, crypto_data: Dict) -> bool:
        """حفظ أو تحديث عملة"""
        with self.get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute('''
                INSERT OR REPLACE INTO cryptos
                (coin_id, symbol, name, rank, current_price_usd, price_change_24h,
                 price_change_7d, high_24h, low_24h, volume_24h, market_cap,
                 circulating_supply, total_supply, max_supply, ath, atl,
                 image_url, last_update, source, is_active)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
            ''', (
                crypto_data.get('coin_id'),
                crypto_data.get('symbol'),
                crypto_data.get('name'),
                crypto_data.get('rank', 0),
                crypto_data.get('current_price_usd', 0),
                crypto_data.get('price_change_24h', 0),
                crypto_data.get('price_change_7d', 0),
                crypto_data.get('high_24h', 0),
                crypto_data.get('low_24h', 0),
                crypto_data.get('volume_24h', 0),
                crypto_data.get('market_cap', 0),
                crypto_data.get('circulating_supply', 0),
                crypto_data.get('total_supply', 0),
                crypto_data.get('max_supply', 0),
                crypto_data.get('ath', 0),
                crypto_data.get('atl', 0),
                crypto_data.get('image_url', ''),
                datetime.now().isoformat(),
                crypto_data.get('source', 'coingecko')
            ))
            conn.commit()
            return True
    
    def save_cryptos_batch(self, cryptos: List[Dict]) -> int:
        """حفظ مجموعة عملات دفعة واحدة"""
        count = 0
        with self.get_connection() as conn:
            cursor = conn.cursor()
            for c in cryptos:
                try:
                    cursor.execute('''
                        INSERT OR REPLACE INTO cryptos
                        (coin_id, symbol, name, rank, current_price_usd, price_change_24h,
                         price_change_7d, high_24h, low_24h, volume_24h, market_cap,
                         circulating_supply, total_supply, max_supply, ath, atl,
                         image_url, last_update, source, is_active)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
                    ''', (
                        c.get('coin_id'),
                        c.get('symbol'),
                        c.get('name'),
                        c.get('rank', 0),
                        c.get('current_price_usd', 0),
                        c.get('price_change_24h', 0),
                        c.get('price_change_7d', 0),
                        c.get('high_24h', 0),
                        c.get('low_24h', 0),
                        c.get('volume_24h', 0),
                        c.get('market_cap', 0),
                        c.get('circulating_supply', 0),
                        c.get('total_supply', 0),
                        c.get('max_supply', 0),
                        c.get('ath', 0),
                        c.get('atl', 0),
                        c.get('image_url', ''),
                        datetime.now().isoformat(),
                        c.get('source', 'coingecko')
                    ))
                    count += 1
                except Exception as e:
                    print(f"Error saving crypto {c.get('symbol')}: {e}")
            conn.commit()
        return count
    
    def get_all_cryptos(self, active_only: bool = True, limit: int = 100) -> List[Dict]:
        """الحصول على كل العملات"""
        with self.get_connection() as conn:
            cursor = conn.cursor()
            if active_only:
                cursor.execute('''
                    SELECT * FROM cryptos 
                    WHERE is_active = 1 
                    ORDER BY rank ASC 
                    LIMIT ?
                ''', (limit,))
            else:
                cursor.execute('SELECT * FROM cryptos ORDER BY rank ASC LIMIT ?', (limit,))
            return [dict(row) for row in cursor.fetchall()]
    
    def get_crypto(self, symbol: str) -> Optional[Dict]:
        """الحصول على عملة محددة"""
        with self.get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute('''
                SELECT * FROM cryptos 
                WHERE symbol = ? OR coin_id = ?
            ''', (symbol.upper(), symbol.lower()))
            row = cursor.fetchone()
            return dict(row) if row else None
    
    def get_top_cryptos(self, limit: int = 10) -> List[Dict]:
        """الحصول على أهم العملات"""
        with self.get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute('''
                SELECT * FROM cryptos 
                WHERE is_active = 1 
                ORDER BY market_cap DESC 
                LIMIT ?
            ''', (limit,))
            return [dict(row) for row in cursor.fetchall()]
    
    # ==================== LOCAL PRICES ====================
    
    def update_btc_local_price(self, currency: str, price: float) -> bool:
        """تحديث سعر BTC بالعملة المحلية"""
        with self.get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute('''
                UPDATE btc_local_prices 
                SET price_local = ?, last_update = ?
                WHERE currency = ?
            ''', (price, datetime.now().isoformat(), currency))
            conn.commit()
            return cursor.rowcount > 0
    
    def get_btc_local_prices(self) -> Dict[str, Dict]:
        """الحصول على أسعار BTC بالعملات المحلية"""
        with self.get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute('SELECT * FROM btc_local_prices')
            return {row['currency']: dict(row) for row in cursor.fetchall()}
    
    # ==================== PRICE HISTORY ====================
    
    def save_price_history(self, coin_id: str, symbol: str, price_data: Dict) -> bool:
        """حفظ سجل السعر اليومي"""
        with self.get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute('''
                INSERT OR REPLACE INTO crypto_price_history
                (coin_id, symbol, date, open, high, low, close, volume, market_cap)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            ''', (
                coin_id,
                symbol,
                price_data.get('date'),
                price_data.get('open'),
                price_data.get('high'),
                price_data.get('low'),
                price_data.get('close'),
                price_data.get('volume'),
                price_data.get('market_cap')
            ))
            conn.commit()
            return True
    
    def get_price_history(self, coin_id: str, days: int = 30) -> List[Dict]:
        """الحصول على سجل الأسعار"""
        with self.get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute('''
                SELECT * FROM crypto_price_history
                WHERE coin_id = ?
                ORDER BY date DESC
                LIMIT ?
            ''', (coin_id, days))
            results = [dict(row) for row in cursor.fetchall()]
            return list(reversed(results))  # Return oldest first
    
    # ==================== RECOMMENDATIONS ====================
    
    def save_recommendation(self, rec_data: Dict) -> int:
        """حفظ توقعة كريبتو"""
        with self.get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute('''
                INSERT INTO crypto_recommendations
                (message_id, channel_id, channel_name, symbol, action,
                 entry_price, target_price, stop_loss, timeframe, confidence,
                 reasoning, original_text, expert_name)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ''', (
                rec_data.get('message_id'),
                rec_data.get('channel_id'),
                rec_data.get('channel_name'),
                rec_data.get('symbol'),
                rec_data.get('action'),
                rec_data.get('entry_price'),
                rec_data.get('target_price'),
                rec_data.get('stop_loss'),
                rec_data.get('timeframe'),
                rec_data.get('confidence', 0),
                rec_data.get('reasoning'),
                rec_data.get('original_text'),
                rec_data.get('expert_name')
            ))
            conn.commit()
            return cursor.lastrowid
    
    def get_recommendations(self, symbol: str = None, limit: int = 50) -> List[Dict]:
        """الحصول على التوقعات"""
        with self.get_connection() as conn:
            cursor = conn.cursor()
            if symbol:
                cursor.execute('''
                    SELECT * FROM crypto_recommendations
                    WHERE symbol = ?
                    ORDER BY created_at DESC
                    LIMIT ?
                ''', (symbol.upper(), limit))
            else:
                cursor.execute('''
                    SELECT * FROM crypto_recommendations
                    ORDER BY created_at DESC
                    LIMIT ?
                ''', (limit,))
            return [dict(row) for row in cursor.fetchall()]
    
    # ==================== NEWS ====================
    
    def save_news(self, news_data: Dict) -> int:
        """حفظ خبر كريبتو"""
        with self.get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute('''
                INSERT INTO crypto_news
                (message_id, channel_id, channel_name, title, content,
                 sentiment, importance, symbols_mentioned, original_text)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            ''', (
                news_data.get('message_id'),
                news_data.get('channel_id'),
                news_data.get('channel_name'),
                news_data.get('title'),
                news_data.get('content'),
                news_data.get('sentiment', 'neutral'),
                news_data.get('importance', 1),
                json.dumps(news_data.get('symbols_mentioned', [])),
                news_data.get('original_text')
            ))
            conn.commit()
            return cursor.lastrowid
    
    def get_news(self, limit: int = 50) -> List[Dict]:
        """الحصول على أخبار الكريبتو"""
        with self.get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute('''
                SELECT * FROM crypto_news
                ORDER BY created_at DESC
                LIMIT ?
            ''', (limit,))
            return [dict(row) for row in cursor.fetchall()]
    
    # ==================== SYNC STATUS ====================
    
    def update_sync_status(self, sync_type: str, status: str, records: int = 0, error: str = None):
        """تحديث حالة المزامنة"""
        with self.get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute('''
                INSERT INTO sync_status (sync_type, last_sync, status, records_updated, error_message)
                VALUES (?, ?, ?, ?, ?)
                ON CONFLICT(sync_type) DO UPDATE SET
                    last_sync = excluded.last_sync,
                    status = excluded.status,
                    records_updated = excluded.records_updated,
                    error_message = excluded.error_message
            ''', (sync_type, datetime.now().isoformat(), status, records, error))
            conn.commit()
    
    def get_sync_status(self) -> Dict[str, Dict]:
        """الحصول على حالة المزامنة"""
        with self.get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute('SELECT * FROM sync_status')
            return {row['sync_type']: dict(row) for row in cursor.fetchall()}
    
    # ==================== STATISTICS ====================
    
    def get_stats(self) -> Dict:
        """إحصائيات قاعدة البيانات"""
        with self.get_connection() as conn:
            cursor = conn.cursor()
            
            stats = {}
            
            cursor.execute('SELECT COUNT(*) FROM cryptos WHERE is_active = 1')
            stats['total_cryptos'] = cursor.fetchone()[0]
            
            cursor.execute('SELECT COUNT(*) FROM crypto_price_history')
            stats['price_history_count'] = cursor.fetchone()[0]
            
            cursor.execute('SELECT COUNT(*) FROM crypto_recommendations')
            stats['total_recommendations'] = cursor.fetchone()[0]
            
            cursor.execute('SELECT COUNT(*) FROM crypto_news')
            stats['total_news'] = cursor.fetchone()[0]
            
            cursor.execute('SELECT MAX(last_update) FROM cryptos')
            stats['last_crypto_update'] = cursor.fetchone()[0]
            
            # Top gainers
            cursor.execute('''
                SELECT symbol, name, current_price_usd, price_change_24h
                FROM cryptos
                WHERE price_change_24h > 0
                ORDER BY price_change_24h DESC
                LIMIT 5
            ''')
            stats['top_gainers'] = [dict(row) for row in cursor.fetchall()]
            
            # Top losers
            cursor.execute('''
                SELECT symbol, name, current_price_usd, price_change_24h
                FROM cryptos
                WHERE price_change_24h < 0
                ORDER BY price_change_24h ASC
                LIMIT 5
            ''')
            stats['top_losers'] = [dict(row) for row in cursor.fetchall()]
            
            return stats


# Singleton instance
crypto_db = CryptoDatabase()


# ==========================================
# SYNC FUNCTION
# ==========================================

def sync_crypto_from_coincap(limit: int = 50) -> Dict:
    """
    مزامنة بيانات الكريبتو من CoinCap API (بديل CoinGecko)
    
    Args:
        limit: عدد العملات المراد جلبها
    
    Returns:
        Dict with sync results
    """
    import urllib.request
    import urllib.error
    
    COINCAP_API = "https://api.coincap.io/v2"
    results = {
        'success': False,
        'timestamp': datetime.now().isoformat(),
        'cryptos_updated': 0,
        'local_prices_updated': 0,
        'errors': [],
        'source': 'coincap'
    }
    
    try:
        crypto_db.update_sync_status('crypto_prices', 'running')
        
        # جلب العملات من CoinCap
        url = f"{COINCAP_API}/assets?limit={limit}"
        req = urllib.request.Request(url, headers={
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            'Accept': 'application/json'
        })
        
        with urllib.request.urlopen(req, timeout=30) as response:
            data = json.loads(response.read().decode())
        
        if data.get('data'):
            cryptos_to_save = []
            for item in data['data']:
                # تحويل الرمز لـ lowercase لـ coin_id
                symbol = item.get('symbol', '').lower()
                name = item.get('name', '')
                
                cryptos_to_save.append({
                    'coin_id': item.get('id', symbol),
                    'symbol': item.get('symbol', '').upper(),
                    'name': name,
                    'rank': int(item.get('rank', 0) or 0),
                    'current_price_usd': float(item.get('priceUsd', 0) or 0),
                    'price_change_24h': float(item.get('changePercent24Hr', 0) or 0),
                    'price_change_7d': 0,  # CoinCap doesn't provide 7d
                    'high_24h': 0,
                    'low_24h': 0,
                    'volume_24h': float(item.get('volumeUsd24Hr', 0) or 0),
                    'market_cap': float(item.get('marketCapUsd', 0) or 0),
                    'circulating_supply': float(item.get('supply', 0) or 0),
                    'total_supply': 0,
                    'max_supply': 0,
                    'ath': 0,
                    'atl': 0,
                    'image_url': f"https://assets.coincap.io/assets/icons/{symbol}@2x.png",
                    'source': 'coincap'
                })
            
            results['cryptos_updated'] = crypto_db.save_cryptos_batch(cryptos_to_save)
        
        crypto_db.update_sync_status('crypto_prices', 'completed', results['cryptos_updated'])
        results['success'] = True
        
    except Exception as e:
        error_msg = str(e)
        results['errors'].append(error_msg)
        crypto_db.update_sync_status('crypto_prices', 'error', 0, error_msg)
    
    return results


def sync_crypto_from_coingecko(limit: int = 50) -> Dict:
    """
    مزامنة بيانات الكريبتو من CoinGecko (مع fallback إلى CoinCap)
    
    Args:
        limit: عدد العملات المراد جلبها
    
    Returns:
        Dict with sync results
    """
    import urllib.request
    import urllib.error
    
    COINGECKO_API = "https://api.coingecko.com/api/v3"
    results = {
        'success': False,
        'timestamp': datetime.now().isoformat(),
        'cryptos_updated': 0,
        'local_prices_updated': 0,
        'errors': [],
        'source': 'coingecko'
    }
    
    try:
        # تحديث حالة المزامنة
        crypto_db.update_sync_status('crypto_prices', 'running')
        
        # جلب العملات
        url = f"{COINGECKO_API}/coins/markets?vs_currency=usd&order=market_cap_desc&per_page={limit}&sparkline=false"
        req = urllib.request.Request(url, headers={
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            'Accept': 'application/json'
        })
        
        with urllib.request.urlopen(req, timeout=30) as response:
            data = json.loads(response.read().decode())
        
        # حفظ العملات
        cryptos_to_save = []
        for item in data:
            cryptos_to_save.append({
                'coin_id': item.get('id', ''),
                'symbol': item.get('symbol', '').upper(),
                'name': item.get('name', ''),
                'rank': item.get('market_cap_rank', 0),
                'current_price_usd': item.get('current_price', 0),
                'price_change_24h': item.get('price_change_percentage_24h', 0) or 0,
                'price_change_7d': item.get('price_change_percentage_7d_in_currency', 0) or 0,
                'high_24h': item.get('high_24h', 0) or 0,
                'low_24h': item.get('low_24h', 0) or 0,
                'volume_24h': item.get('total_volume', 0) or 0,
                'market_cap': item.get('market_cap', 0) or 0,
                'circulating_supply': item.get('circulating_supply', 0) or 0,
                'total_supply': item.get('total_supply', 0) or 0,
                'max_supply': item.get('max_supply', 0) or 0,
                'ath': item.get('ath', 0) or 0,
                'atl': item.get('atl', 0) or 0,
                'image_url': item.get('image', ''),
                'source': 'coingecko'
            })
        
        results['cryptos_updated'] = crypto_db.save_cryptos_batch(cryptos_to_save)
        
        # جلب أسعار BTC بالعملات المحلية
        local_currencies = ['egp', 'sar', 'kwd', 'qar', 'aed', 'bhd', 'omr', 'jod']
        for currency in local_currencies:
            try:
                url = f"{COINGECKO_API}/simple/price?ids=bitcoin&vs_currencies={currency}"
                req = urllib.request.Request(url, headers={
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                    'Accept': 'application/json'
                })
                with urllib.request.urlopen(req, timeout=10) as response:
                    data = json.loads(response.read().decode())
                    if data and 'bitcoin' in data:
                        price = data['bitcoin'].get(currency, 0)
                        crypto_db.update_btc_local_price(currency.upper(), price)
                        results['local_prices_updated'] += 1
            except Exception as e:
                results['errors'].append(f"BTC/{currency}: {str(e)}")
        
        # تحديث حالة المزامنة
        crypto_db.update_sync_status('crypto_prices', 'completed', results['cryptos_updated'])
        
        results['success'] = True
        
    except urllib.error.HTTPError as e:
        if e.code == 429:
            # Rate limited - جرب CoinCap كبديل
            results['errors'].append("CoinGecko rate limited, trying CoinCap...")
            coincap_result = sync_crypto_from_coincap(limit)
            return coincap_result
        else:
            error_msg = f"HTTP Error: {e.code}"
            results['errors'].append(error_msg)
            crypto_db.update_sync_status('crypto_prices', 'error', 0, error_msg)
        
    except Exception as e:
        error_msg = str(e)
        results['errors'].append(error_msg)
        # جرب CoinCap كبديل
        results['errors'].append("Trying CoinCap as fallback...")
        coincap_result = sync_crypto_from_coincap(limit)
        return coincap_result
    
    return results


# ==========================================
# MAIN
# ==========================================

if __name__ == "__main__":
    print("\n₿ Crypto Database Test")
    print("=" * 50)
    
    # Test database
    print("\n📊 Database Stats:")
    stats = crypto_db.get_stats()
    for key, value in stats.items():
        if key not in ['top_gainers', 'top_losers']:
            print(f"  {key}: {value}")
    
    # Test sync
    print("\n🔄 Testing Sync from CoinGecko...")
    result = sync_crypto_from_coingecko(10)
    print(f"  Success: {result['success']}")
    print(f"  Cryptos Updated: {result['cryptos_updated']}")
    print(f"  Local Prices Updated: {result['local_prices_updated']}")
    
    if result['errors']:
        print(f"  Errors: {result['errors']}")
    
    # Show top cryptos
    print("\n🏆 Top 5 Cryptos:")
    top = crypto_db.get_top_cryptos(5)
    for c in top:
        print(f"  {c['rank']}. {c['symbol']}: ${c['current_price_usd']:,.2f} ({c['price_change_24h']:+.2f}%)")
    
    print("\n✅ Done!")
