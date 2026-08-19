#!/usr/bin/env python3
"""
🔥 crypto_fetcher.py - العملات الرقمية الشامل
================================================
يسحب 50 عملة رقمية متداولة من CoinGecko

البيانات:
- السعر الحالي
- التغير في 24 ساعة
- القيمة السوقية
- حجم التداول
- الترتيب العالمي
- سعر Bitcoin بجميع العملات العربية

كل البيانات مع timestamp دقيق (تاريخ + وقت)
"""

import json
import sys
import os
import sqlite3
import requests
from datetime import datetime
from pathlib import Path

# Paths - all unified in /db folder
DATA_DIR = Path(__file__).parent.parent.parent / 'db'
STATUS_FILE = DATA_DIR / 'crypto_status.json'
# Database path - unified in /db folder
DB_PATH = DATA_DIR / 'data_engine.db'

# عدد العملات المراد سحبها
CRYPTO_COUNT = 50

# الدول العربية وعملاتها
ARAB_CURRENCIES = {
    'EGP': {'name': 'جنيه مصري', 'country': 'مصر', 'flag': '🇪🇬'},
    'SAR': {'name': 'ريال سعودي', 'country': 'السعودية', 'flag': '🇸🇦'},
    'KWD': {'name': 'دينار كويتي', 'country': 'الكويت', 'flag': '🇰🇼'},
    'QAR': {'name': 'ريال قطري', 'country': 'قطر', 'flag': '🇶🇦'},
    'AED': {'name': 'درهم إماراتي', 'country': 'الإمارات', 'flag': '🇦🇪'},
    'BHD': {'name': 'دينار بحريني', 'country': 'البحرين', 'flag': '🇧🇭'},
    'OMR': {'name': 'ريال عماني', 'country': 'عمان', 'flag': '🇴🇲'},
    'JOD': {'name': 'دينار أردني', 'country': 'الأردن', 'flag': '🇯🇴'},
}

def get_timestamp():
    """الحصول على timestamp دقيق"""
    return datetime.now().strftime('%Y-%m-%d %H:%M:%S')

def update_status(status_update):
    """تحديث ملف الحالة"""
    try:
        with open(STATUS_FILE, 'r') as f:
            status = json.load(f)
    except:
        status = {'running': False, 'progress': {}, 'logs': [], 'results': []}
    
    status.update(status_update)
    if len(status.get('logs', [])) > 100:
        status['logs'] = status['logs'][-100:]
    
    with open(STATUS_FILE, 'w') as f:
        json.dump(status, f, indent=2, ensure_ascii=False)

def log_message(message):
    """طباعة وتسجيل رسالة"""
    timestamp = get_timestamp()
    print(f"[{timestamp}] {message}")
    update_status({'logs': [f"[{timestamp}] {message}"]})

def fetch_top_cryptos(limit=50):
    """جلب أفضل 50 عملة رقمية من CoinGecko"""
    url = f"https://api.coingecko.com/api/v3/coins/markets"
    params = {
        'vs_currency': 'usd',
        'order': 'market_cap_desc',
        'per_page': limit,
        'page': 1,
        'sparkline': False,
        'price_change_percentage': '24h,7d'
    }
    
    try:
        response = requests.get(url, params=params, timeout=30)
        if response.status_code == 200:
            return response.json()
    except Exception as e:
        log_message(f"⚠️ CoinGecko API error: {str(e)[:50]}")
    
    return []

def fetch_btc_prices_in_arab_currencies():
    """جلب سعر Bitcoin بجميع العملات العربية"""
    currencies = ','.join(ARAB_CURRENCIES.keys())
    url = f"https://api.coingecko.com/api/v3/simple/price"
    params = {
        'ids': 'bitcoin,ethereum',
        'vs_currencies': f'usd,{currencies.lower()}',
        'include_24hr_change': 'true'
    }
    
    try:
        response = requests.get(url, params=params, timeout=15)
        if response.status_code == 200:
            return response.json()
    except:
        pass
    
    return {}

def fetch_exchange_rates():
    """جلب أسعار الصرف"""
    try:
        url = "https://api.exchangerate-api.com/v4/latest/USD"
        response = requests.get(url, timeout=10)
        if response.status_code == 200:
            return response.json().get('rates', {})
    except:
        pass
    
    # أسعار تقريبية
    return {
        'EGP': 48.5, 'SAR': 3.75, 'KWD': 0.31, 'QAR': 3.64,
        'AED': 3.67, 'BHD': 0.38, 'OMR': 0.38, 'JOD': 0.71
    }

def save_to_database(cryptos, btc_prices, timestamp):
    """حفظ البيانات في قاعدة البيانات"""
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    
    # جدول أسعار العملات الرقمية
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS crypto_prices (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            timestamp TEXT,
            rank INTEGER,
            symbol TEXT,
            name TEXT,
            price_usd REAL,
            price_change_24h REAL,
            price_change_7d REAL,
            market_cap REAL,
            market_cap_rank INTEGER,
            total_volume REAL,
            circulating_supply REAL,
            UNIQUE(timestamp, symbol)
        )
    ''')
    
    # إدراج البيانات
    for crypto in cryptos:
        cursor.execute('''
            INSERT OR REPLACE INTO crypto_prices 
            (timestamp, rank, symbol, name, price_usd, price_change_24h, price_change_7d, 
             market_cap, market_cap_rank, total_volume, circulating_supply)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ''', (
            timestamp,
            crypto.get('market_cap_rank', 0),
            crypto.get('symbol', '').upper(),
            crypto.get('name', ''),
            crypto.get('current_price', 0),
            crypto.get('price_change_percentage_24h', 0),
            crypto.get('price_change_percentage_7d_in_currency', 0),
            crypto.get('market_cap', 0),
            crypto.get('market_cap_rank', 0),
            crypto.get('total_volume', 0),
            crypto.get('circulating_supply', 0)
        ))
    
    # جدول أسعار BTC بالعملات العربية
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS btc_local_prices (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            timestamp TEXT,
            currency TEXT,
            price REAL,
            change_24h REAL,
            UNIQUE(timestamp, currency)
        )
    ''')
    
    if btc_prices and 'bitcoin' in btc_prices:
        for currency, info in ARAB_CURRENCIES.items():
            price = btc_prices['bitcoin'].get(currency.lower(), 0)
            change = btc_prices['bitcoin'].get(f'{currency.lower()}_24h_change', 0)
            if price:
                cursor.execute('''
                    INSERT OR REPLACE INTO btc_local_prices 
                    (timestamp, currency, price, change_24h)
                    VALUES (?, ?, ?, ?)
                ''', (timestamp, currency, price, change))
    
    conn.commit()
    conn.close()

def fetch_all_crypto():
    """جلب جميع بيانات العملات الرقمية"""
    os.makedirs(DATA_DIR, exist_ok=True)
    os.makedirs(os.path.dirname(STATUS_FILE), exist_ok=True)
    
    update_status({
        'running': True,
        'progress': {'current': 0, 'total': CRYPTO_COUNT},
        'logs': [],
        'results': []
    })
    
    log_message(f"🚀 بدء سحب {CRYPTO_COUNT} عملة رقمية...")
    
    # جلب العملات الرقمية
    log_message("📊 جلب البيانات من CoinGecko...")
    cryptos = fetch_top_cryptos(CRYPTO_COUNT)
    
    if not cryptos:
        log_message("❌ فشل في جلب البيانات!")
        update_status({'running': False})
        return None
    
    log_message(f"   تم جلب {len(cryptos)} عملة")
    update_status({'progress': {'current': len(cryptos), 'total': CRYPTO_COUNT}})
    
    # جلب أسعار BTC بالعملات العربية
    log_message("💱 جلب أسعار Bitcoin بالعملات العربية...")
    btc_prices = fetch_btc_prices_in_arab_currencies()
    
    # جلب أسعار الصرف
    exchange_rates = fetch_exchange_rates()
    
    timestamp = get_timestamp()
    
    # تجهيز النتائج
    results = []
    for crypto in cryptos:
        results.append({
            'rank': crypto.get('market_cap_rank', 0),
            'symbol': crypto.get('symbol', '').upper(),
            'name': crypto.get('name', ''),
            'price_usd': crypto.get('current_price', 0),
            'price_change_24h': crypto.get('price_change_percentage_24h', 0),
            'price_change_7d': crypto.get('price_change_percentage_7d_in_currency', 0),
            'market_cap': crypto.get('market_cap', 0),
            'total_volume': crypto.get('total_volume', 0),
            'circulating_supply': crypto.get('circulating_supply', 0),
            'image': crypto.get('image', '')
        })
    
    # حساب أسعار Bitcoin في الدول العربية
    btc_local = {}
    if btc_prices and 'bitcoin' in btc_prices:
        btc_usd = btc_prices['bitcoin'].get('usd', 0)
        for currency, info in ARAB_CURRENCIES.items():
            price = btc_prices['bitcoin'].get(currency.lower(), 0)
            if not price and btc_usd:
                rate = exchange_rates.get(currency, 1)
                price = btc_usd * rate
            
            btc_local[currency] = {
                'country': info['country'],
                'currency_name': info['name'],
                'flag': info['flag'],
                'btc_price': price,
                'btc_change_24h': btc_prices['bitcoin'].get(f'{currency.lower()}_24h_change', 0)
            }
    
    # حفظ في قاعدة البيانات
    log_message("💾 حفظ البيانات...")
    save_to_database(cryptos, btc_prices, timestamp)
    
    # تجهيز الإخراج
    output = {
        'timestamp': timestamp,
        'total_cryptos': len(cryptos),
        'top_10': results[:10],
        'all_cryptos': results,
        'btc_local_prices': btc_local,
        'exchange_rates': exchange_rates
    }
    
    # حفظ في ملف JSON
    output_file = DATA_DIR / 'crypto_latest.json'
    with open(output_file, 'w', encoding='utf-8') as f:
        json.dump(output, f, indent=2, ensure_ascii=False)
    
    log_message(f"✅ تم! {len(cryptos)} عملة رقمية")
    log_message(f"   Bitcoin: ${cryptos[0]['current_price']:,.2f}" if cryptos else "")
    log_message(f"   Ethereum: ${cryptos[1]['current_price']:,.2f}" if len(cryptos) > 1 else "")
    
    update_status({
        'running': False,
        'results': results,
        'last_update': timestamp
    })
    
    return output

if __name__ == '__main__':
    try:
        fetch_all_crypto()
    except Exception as e:
        log_message(f"❌ خطأ: {str(e)}")
        update_status({'running': False})
        import traceback
        traceback.print_exc()
        sys.exit(1)
