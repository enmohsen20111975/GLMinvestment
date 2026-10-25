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

# Task 35-C (ROOT-CAUSE-FIRST — Rule 67):
# CoinGecko blocks requests without a User-Agent → silent failures + the
# scraper exited 0 even when 0 rows were fetched. Now: real browser UA +
# fallback chain (CoinGecko → Binance → CoinCap) + explicit sys.exit(1).
HEADERS = {
    'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 '
                  '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'application/json',
    'Accept-Language': 'en-US,en;q=0.9',
}

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

def _fetch_coingecko(limit=50):
    """Try 1 — CoinGecko /coins/markets endpoint."""
    url = "https://api.coingecko.com/api/v3/coins/markets"
    params = {
        'vs_currency': 'usd',
        'order': 'market_cap_desc',
        'per_page': limit,
        'page': 1,
        'sparkline': False,
        'price_change_percentage': '24h,7d'
    }
    try:
        response = requests.get(url, params=params, headers=HEADERS, timeout=30)
        if response.status_code == 200:
            data = response.json()
            if isinstance(data, list) and len(data) > 0:
                return data
        else:
            log_message(f"⚠️ CoinGecko HTTP {response.status_code}")
    except Exception as e:
        log_message(f"⚠️ CoinGecko API error: {str(e)[:80]}")
    return None


def _fetch_binance(limit=50):
    """Try 2 — Binance public API (no key needed).

    /api/v3/ticker/24hr returns all symbols; we filter to USDT pairs,
    sort by quoteVolume, take top `limit`, and map to the same shape as
    CoinGecko's /coins/markets so save_to_database + the rest of the
    pipeline work unchanged.
    """
    url = "https://api.binance.com/api/v3/ticker/24hr"
    try:
        response = requests.get(url, headers=HEADERS, timeout=30)
        if response.status_code != 200:
            log_message(f"⚠️ Binance HTTP {response.status_code}")
            return None
        tickers = response.json()
        if not isinstance(tickers, list):
            return None
        # Filter to USDT pairs (exclude leveraged tokens like UPUSDT/DOWNUSDT)
        usdt_pairs = [
            t for t in tickers
            if t.get('symbol', '').endswith('USDT')
            and not any(t['symbol'].endswith(s) for s in ('UPUSDT', 'DOWNUSDT', 'BULLUSDT', 'BEARUSDT'))
        ]
        # Sort by quoteVolume (24h volume in USDT) descending
        usdt_pairs.sort(
            key=lambda t: float(t.get('quoteVolume', 0) or 0),
            reverse=True,
        )
        top = usdt_pairs[:limit]
        # Map to CoinGecko shape
        mapped = []
        for i, t in enumerate(top):
            symbol = t.get('symbol', '')[:-4]  # strip 'USDT'
            price = float(t.get('lastPrice', 0) or 0)
            change_pct = float(t.get('priceChangePercent', 0) or 0)
            quote_vol = float(t.get('quoteVolume', 0) or 0)
            mapped.append({
                'symbol': symbol.lower(),
                'name': f"{symbol}/USDT",  # Binance doesn't return a name
                'current_price': price,
                'price_change_percentage_24h': change_pct,
                'price_change_percentage_7d_in_currency': None,  # not available
                'market_cap': None,
                'market_cap_rank': i + 1,
                'total_volume': quote_vol,
                'circulating_supply': None,
                'image': '',
            })
        return mapped if mapped else None
    except Exception as e:
        log_message(f"⚠️ Binance API error: {str(e)[:80]}")
    return None


def _fetch_coincap(limit=50):
    """Try 3 — CoinCap public API (no key needed for basic tier).

    /api/v2/assets returns top assets by market cap. We map to the same
    shape as CoinGecko's output.
    """
    url = f"https://api.coincap.io/v2/assets?limit={limit}"
    try:
        response = requests.get(url, headers=HEADERS, timeout=20)
        if response.status_code != 200:
            log_message(f"⚠️ CoinCap HTTP {response.status_code}")
            return None
        body = response.json()
        assets = body.get('data', []) if isinstance(body, dict) else []
        if not assets:
            return None
        mapped = []
        for i, a in enumerate(assets):
            try:
                price = float(a.get('priceUsd', 0) or 0)
                change_pct = float(a.get('changePercent24Hr', 0) or 0)
                supply = float(a.get('supply', 0) or 0)
                mcap = float(a.get('marketCapUsd', 0) or 0)
                vol = float(a.get('volumeUsd24Hr', 0) or 0)
            except (TypeError, ValueError):
                continue
            mapped.append({
                'symbol': a.get('symbol', '').lower(),
                'name': a.get('name', ''),
                'current_price': price,
                'price_change_percentage_24h': change_pct,
                'price_change_percentage_7d_in_currency': None,
                'market_cap': mcap,
                'market_cap_rank': i + 1,
                'total_volume': vol,
                'circulating_supply': supply,
                'image': '',
            })
        return mapped if mapped else None
    except Exception as e:
        log_message(f"⚠️ CoinCap API error: {str(e)[:80]}")
    return None


def fetch_top_cryptos(limit=50):
    """
    جلب أفضل العملات الرقمية — سلسلة fallback (Task 35-C — Rule 67):
      1) CoinGecko (primary)
      2) Binance public API
      3) CoinCap public API

    Returns: (list, source_name) — source_name is 'coingecko'|'binance'|'coincap'
    or (None, None) if all 3 sources failed.
    """
    # Try 1: CoinGecko
    data = _fetch_coingecko(limit)
    if data:
        return data, 'coingecko'
    log_message("↪️ CoinGecko فشل، جاري تجربة Binance...")

    # Try 2: Binance
    data = _fetch_binance(limit)
    if data:
        return data, 'binance'
    log_message("↪️ Binance فشل، جاري تجربة CoinCap...")

    # Try 3: CoinCap
    data = _fetch_coincap(limit)
    if data:
        return data, 'coincap'
    log_message("↪️ CoinCap فشل أيضاً")

    return None, None

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
        response = requests.get(url, params=params, headers=HEADERS, timeout=15)
        if response.status_code == 200:
            return response.json()
    except:
        pass
    
    return {}

def fetch_exchange_rates():
    """جلب أسعار الصرف"""
    try:
        url = "https://api.exchangerate-api.com/v4/latest/USD"
        response = requests.get(url, headers=HEADERS, timeout=10)
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
    
    # جلب العملات الرقمية — Task 35-C: fallback chain (CoinGecko → Binance → CoinCap)
    cryptos, source = fetch_top_cryptos(CRYPTO_COUNT)

    if not cryptos:
        # Rule 67: MUST exit 1 so the orchestrator (multi_market_scraper.py)
        # reports failures=1 instead of failures=0. Previously this returned
        # None and main() exited 0 → silent failure → cron reported success.
        log_message("❌ فشل في جلب البيانات من جميع المصادر (CoinGecko + Binance + CoinCap)!")
        update_status({
            'running': False,
            'error': 'all_sources_failed',
            'last_error': get_timestamp(),
        })
        sys.exit(1)

    log_message(f"✅ تم جلب {len(cryptos)} عملة من {source}")
    update_status({
        'progress': {'current': len(cryptos), 'total': CRYPTO_COUNT},
        'source': source,
    })
    
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
        result = fetch_all_crypto()
        # Task 35-C: defensive check — if fetch_all_crypto returned None
        # without sys.exit(1) (shouldn't happen now, but just in case),
        # treat it as a failure.
        if result is None:
            log_message("❌ fetch_all_crypto returned None — exiting 1")
            sys.exit(1)
    except SystemExit:
        # Re-raise sys.exit(1) calls from inside fetch_all_crypto so
        # they propagate to the shell (don't catch them as exceptions).
        raise
    except Exception as e:
        log_message(f"❌ خطأ: {str(e)}")
        update_status({'running': False})
        import traceback
        traceback.print_exc()
        sys.exit(1)
