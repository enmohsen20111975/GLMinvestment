#!/usr/bin/env python3
"""
🔥 metals_forex_fetcher.py - الذهب والعملات الشامل
====================================================
يجمع:
1. أسعار الذهب بجميع العيارات (24، 22، 21، 18، 14، 10)
2. أسعار الذهب في كل دولة عربية بعملتها المحلية
3. سبائك الذهب (1جم، 5جم، 10جم، أوقية)
4. أسعار الفضة
5. أسعار صرف العملات العربية

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
STATUS_FILE = DATA_DIR / 'metals_forex_status.json'
# Database path - unified in /db folder
DB_PATH = DATA_DIR / 'data_engine.db'

# الدول العربية وعملاتها
ARAB_COUNTRIES = {
    'مصر': {'currency': 'EGP', 'symbol': 'ج.م', 'flag': '🇪🇬'},
    'السعودية': {'currency': 'SAR', 'symbol': 'ر.س', 'flag': '🇸🇦'},
    'الكويت': {'currency': 'KWD', 'symbol': 'د.ك', 'flag': '🇰🇼'},
    'قطر': {'currency': 'QAR', 'symbol': 'ر.ق', 'flag': '🇶🇦'},
    'الإمارات': {'currency': 'AED', 'symbol': 'د.إ', 'flag': '🇦🇪'},
    'البحرين': {'currency': 'BHD', 'symbol': 'د.ب', 'flag': '🇧🇭'},
    'عمان': {'currency': 'OMR', 'symbol': 'ر.ع', 'flag': '🇴🇲'},
    'الأردن': {'currency': 'JOD', 'symbol': 'د.أ', 'flag': '🇯🇴'},
    'المغرب': {'currency': 'MAD', 'symbol': 'د.م', 'flag': '🇲🇦'},
    'تونس': {'currency': 'TND', 'symbol': 'د.ت', 'flag': '🇹🇳'},
    'الجزائر': {'currency': 'DZD', 'symbol': 'د.ج', 'flag': '🇩🇿'},
    'السودان': {'currency': 'SDG', 'symbol': 'ج.س', 'flag': '🇸🇩'},
    'العراق': {'currency': 'IQD', 'symbol': 'د.ع', 'flag': '🇮🇶'},
    'لبنان': {'currency': 'LBP', 'symbol': 'ل.ل', 'flag': '🇱🇧'},
}

# عيارات الذهب
GOLD_KARATS = {
    'عيار 24': {'purity': 1.0, 'name': 'ذهب عيار 24 (999)'},
    'عيار 22': {'purity': 0.9167, 'name': 'ذهب عيار 22'},
    'عيار 21': {'purity': 0.875, 'name': 'ذهب عيار 21'},
    'عيار 18': {'purity': 0.75, 'name': 'ذهب عيار 18'},
    'عيار 16': {'purity': 0.6667, 'name': 'ذهب عيار 16'},
    'عيار 14': {'purity': 0.5833, 'name': 'ذهب عيار 14'},
    'عيار 10': {'purity': 0.4167, 'name': 'ذهب عيار 10'},
}

# الدول المستهدفة لجدول gold_prices (4 دول بأسعار دولار محددة)
TARGET_GOLD_COUNTRIES = {
    'مصر': {'currency': 'EGP', 'usd_source': 'black_market'},
    'السعودية': {'currency': 'SAR', 'usd_source': 'official'},
    'الكويت': {'currency': 'KWD', 'usd_source': 'official'},
    'قطر': {'currency': 'QAR', 'usd_source': 'official'},
}

# العيارات المستهدفة لجدول gold_prices (بدون مصنعية/دمغة)
TARGET_GOLD_KARATS = {
    '24': {'purity': 1.0},
    '21': {'purity': 0.875},
    '18': {'purity': 0.75},
    '16': {'purity': 0.6667},
}

# أحجام السبائك
GOLD_BARS = {
    '1 جرام': {'grams': 1},
    '5 جرام': {'grams': 5},
    '10 جرام': {'grams': 10},
    '20 جرام': {'grams': 20},
    '31.1 جرام (أوقية)': {'grams': 31.1035},
    '50 جرام': {'grams': 50},
    '100 جرام': {'grams': 100},
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
        status = {'running': False, 'progress': {}, 'logs': [], 'results': {}}
    
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

def fetch_gold_price_usd(usd_egp_rate=50.70):
    """جلب سعر الذهب بالدولار (للأوقية) — من Daleelak API (مصادر مصرية مرخصة)
    
    Daleelak يعطي سعر الذهب عيار 24 بالجنيه المصري لكل جرام (EGP/g).
    نقوم بتحويله إلى دولار لكل أوقية:
    (سعر الجرام بالجنيه / سعر الدولار) × 31.1035 جرام للأوقية
    """
    import urllib.request
    import json as _json
    
    try:
        url = "https://getdaleelak.com/api/v1/feed.json?category=metals"
        req = urllib.request.Request(url, headers={
            'User-Agent': 'Mozilla/5.0 (compatible; MetalsFetcher/2.0)',
            'Accept': 'application/json',
        })
        resp = urllib.request.urlopen(req, timeout=10)
        data = _json.loads(resp.read())
        for asset in data.get('assets', []):
            if asset.get('slug') == 'gold-24k' or asset.get('id') == 'GOLD-24K-EGP':
                # Daleelak returns EGP per gram
                global_val = (asset.get('global') or {}).get('value')
                buy_val = (asset.get('directions', {}).get('buy', {}).get('best') or {}).get('value')
                val_egp_per_gram = float(global_val or buy_val or 0)
                if val_egp_per_gram > 0:
                    rate = usd_egp_rate if usd_egp_rate > 0 else 50.70
                    ounce_usd = (val_egp_per_gram / rate) * 31.1035
                    return round(ounce_usd, 2)
    except Exception as e:
        log_message(f"⚠️ خطأ في جلب الذهب من دليلَك: {e}")
    
    # 2. Fallback: isagha cached (from news-agent/data/gold_prices.json)
    try:
        import os
        cached_path = os.path.join(os.path.dirname(__file__).parent.parent, 
                                   'news-agent', 'data', 'gold_prices.json')
        if os.path.exists(cached_path):
            with open(cached_path) as f:
                gold_data = _json.load(f)
            oz_data = gold_data.get('prices', {}).get('Oz', {})
            if oz_data.get('buy'):
                return float(oz_data['buy'])
    except Exception:
        pass
    
    # Last resort: approximate gold ounce USD price
    return 4495.0

def fetch_silver_price_usd(usd_egp_rate=50.70):
    """جلب سعر الفضة بالدولار (للأوقية) — من Daleelak API
    Daleelak يعطي سعر الفضة عيار 999 بالجنيه المصري لكل جرام.
    """
    import urllib.request
    import json as _json
    
    try:
        url = "https://getdaleelak.com/api/v1/feed.json?category=metals"
        req = urllib.request.Request(url, headers={
            'User-Agent': 'Mozilla/5.0 (compatible; MetalsFetcher/2.0)',
            'Accept': 'application/json',
        })
        resp = urllib.request.urlopen(req, timeout=10)
        data = _json.loads(resp.read())
        for asset in data.get('assets', []):
            if asset.get('slug') == 'silver-999':
                global_val = (asset.get('global') or {}).get('value')
                buy_val = (asset.get('directions', {}).get('buy', {}).get('best') or {}).get('value')
                val_egp_per_gram = float(global_val or buy_val or 0)
                if val_egp_per_gram > 0:
                    rate = usd_egp_rate if usd_egp_rate > 0 else 50.70
                    ounce_usd = (val_egp_per_gram / rate) * 31.1035
                    return round(ounce_usd, 2)
    except Exception as e:
        log_message(f"⚠️ خطأ في جلب الفضة من دليلَك: {e}")
    
    return 60.0

def fetch_exchange_rates():
    """جلب أسعار صرف العملات العربية مقابل الدولار — من Daleelak API (primary)
    
    Migration (2026-09-03, Rule 48): استبدال api.exchangerate-api.com بـ Daleelak.
    Fallback: Frankfurter.dev (CBE — Central Bank of Egypt).
    """
    import urllib.request
    import json as _json
    
    rates = {}
    
    # 1. Primary: Daleelak API
    try:
        url = "https://getdaleelak.com/api/v1/feed.json?category=currencies"
        req = urllib.request.Request(url, headers={
            'User-Agent': 'Mozilla/5.0 (compatible; MetalsFetcher/2.0)',
            'Accept': 'application/json',
        })
        resp = urllib.request.urlopen(req, timeout=10)
        data = _json.loads(resp.read())
        for asset in data.get('assets', []):
            if asset.get('category') != 'currencies':
                continue
            asset_id = asset.get('id', '')
            parts = asset_id.split('-')
            if len(parts) != 2:
                continue
            currency = parts[0]  # e.g. USD, EUR, SAR, ...
            benchmark = asset.get('benchmark') or {}
            # benchmark.buy = rate in EGP for 1 unit of currency
            buy_egp = benchmark.get('buy')
            if buy_egp and buy_egp > 0:
                # rate_to_usd = (1 / buy_egp) × usd_egp_rate
                # but Daleelak gives us direct rate, so:
                rates[currency] = buy_egp  # store as EGP per 1 unit
    except Exception:
        pass
    
    # 2. Fallback: Frankfurter.dev (CBE) — for currencies not in Daleelak
    if not rates or len(rates) < 5:
        try:
            url = "https://api.frankfurter.dev/v2/rates?providers=CBE"
            req = urllib.request.Request(url, headers={
                'User-Agent': 'Mozilla/5.0 (compatible; MetalsFetcher/2.0)',
                'Accept': 'application/json',
            })
            resp = urllib.request.urlopen(req, timeout=10)
            data = _json.loads(resp.read())
            for item in data:
                base = item.get('base')
                quote = item.get('quote')
                rate = item.get('rate')
                if base == 'EUR' and quote and rate:
                    # Convert EUR-based rate to USD-based
                    if 'EUR' not in rates:
                        rates['EUR'] = rate
                    if quote not in rates and 'EUR' in rates:
                        rates[quote] = rate / rates['EUR']
        except Exception:
            pass
    
    # 3. Hardcoded fallbacks for Gulf currencies (if all APIs fail)
    fallback_hardcoded = {
        'KWD': 0.31, 'BHD': 0.38, 'OMR': 0.38, 'JOD': 0.71, 'QAR': 3.64,
        'SAR': 3.75, 'AED': 3.67, 'EGP': 50.0, 'USD': 1.0,
    }
    for currency, rate in fallback_hardcoded.items():
        if currency not in rates:
            rates[currency] = rate
    
    return rates

def calculate_gold_prices_by_karat(gold_price_per_ounce_usd, exchange_rates):
    """حساب أسعار الذهب بجميع العيارات لكل دولة"""
    timestamp = get_timestamp()
    
    # سعر الجرام من الأوقية (31.1035 جرام) بالدولار
    gold_price_per_gram_usd = gold_price_per_ounce_usd / 31.1035
    usd_egp = exchange_rates.get('USD') or exchange_rates.get('EGP') or 50.70
    
    results = {
        'timestamp': timestamp,
        'gold_usd_per_ounce': gold_price_per_ounce_usd,
        'gold_usd_per_gram': gold_price_per_gram_usd,
        'countries': {},
        'karats': {},
        'bars': {}
    }
    
    # حساب أسعار الذهب لكل دولة بعملتها المحلية
    for country, info in ARAB_COUNTRIES.items():
        currency = info['currency']
        symbol = info['symbol']
        flag = info['flag']
        
        # سعر صرف العملة مقابل الدولار (كم وحدة من العملة لكل 1 دولار)
        if currency == 'EGP':
            rate_to_usd = usd_egp
        elif currency == 'USD':
            rate_to_usd = 1.0
        else:
            # exchange_rates يحتوي على سعر العملة بالجنيه (مثلاً الريال = 13.52 جنيه)
            # بالتالي سعر الدولار بالريال = سعر الدولار بالجنيه / سعر الريال بالجنيه
            curr_in_egp = exchange_rates.get(currency)
            if curr_in_egp and curr_in_egp > 0:
                rate_to_usd = usd_egp / curr_in_egp
            else:
                pegs = {'SAR': 3.75, 'AED': 3.67, 'KWD': 0.307, 'QAR': 3.64, 'BHD': 0.376, 'OMR': 0.385, 'JOD': 0.709}
                rate_to_usd = pegs.get(currency, 1.0)
        
        # سعر الجرام بالعملة المحلية
        price_per_gram_local = gold_price_per_gram_usd * rate_to_usd
        
        results['countries'][country] = {
            'currency': currency,
            'symbol': symbol,
            'flag': flag,
            'exchange_rate_to_usd': round(rate_to_usd, 4),
            'gold_per_gram_local': round(price_per_gram_local, 2),
            'gold_per_ounce_local': round(price_per_gram_local * 31.1035, 2),
            'prices_by_karat': {}
        }
        
        # حساب سعر كل عيار
        for karat_name, karat_info in GOLD_KARATS.items():
            purity = karat_info['purity']
            price = round(price_per_gram_local * purity, 2)
            results['countries'][country]['prices_by_karat'][karat_name] = price
    
    # حساب أسعار العيارات بالدولار
    for karat_name, karat_info in GOLD_KARATS.items():
        purity = karat_info['purity']
        results['karats'][karat_name] = {
            'purity': purity,
            'name': karat_info['name'],
            'price_usd_per_gram': round(gold_price_per_gram_usd * purity, 2),
            'price_usd_per_ounce': round(gold_price_per_ounce_usd * purity, 2)
        }
    
    # حساب أسعار السبائك
    for bar_name, bar_info in GOLD_BARS.items():
        grams = bar_info['grams']
        results['bars'][bar_name] = {
            'grams': grams,
            'price_usd': round(gold_price_per_gram_usd * grams, 2)
        }
    
    return results

def calculate_silver_prices(silver_price_per_ounce_usd, exchange_rates):
    """حساب أسعار الفضة لكل دولة"""
    timestamp = get_timestamp()
    
    silver_price_per_gram_usd = silver_price_per_ounce_usd / 31.1035
    usd_egp = exchange_rates.get('USD') or exchange_rates.get('EGP') or 50.70
    
    results = {
        'timestamp': timestamp,
        'silver_usd_per_ounce': silver_price_per_ounce_usd,
        'silver_usd_per_gram': round(silver_price_per_gram_usd, 4),
        'countries': {}
    }
    
    for country, info in ARAB_COUNTRIES.items():
        currency = info['currency']
        if currency == 'EGP':
            rate_to_usd = usd_egp
        elif currency == 'USD':
            rate_to_usd = 1.0
        else:
            curr_in_egp = exchange_rates.get(currency)
            if curr_in_egp and curr_in_egp > 0:
                rate_to_usd = usd_egp / curr_in_egp
            else:
                pegs = {'SAR': 3.75, 'AED': 3.67, 'KWD': 0.307, 'QAR': 3.64, 'BHD': 0.376, 'OMR': 0.385, 'JOD': 0.709}
                rate_to_usd = pegs.get(currency, 1.0)
        
        results['countries'][country] = {
            'currency': currency,
            'symbol': info['symbol'],
            'flag': info['flag'],
            'silver_per_gram_local': round(silver_price_per_gram_usd * rate_to_usd, 4),
            'silver_per_ounce_local': round(silver_price_per_ounce_usd * rate_to_usd, 2)
        }
    
    return results

def _get_egypt_usd_rate(exchange_rates):
    """
    الحصول على سعر الدولار المناسب لمصر:
    1. S24K من iSagha (لو موجود في exchange_rates كـ EGP_GOLD_SOUGH)
    2. دولار السوق السوداء (لو موجود كـ EGP_BLACK)
    3. سعر البنك كـ fallback
    """
    if 'EGP_GOLD_SOUGH' in exchange_rates:
        return exchange_rates['EGP_GOLD_SOUGH']
    if 'EGP_BLACK' in exchange_rates:
        return exchange_rates['EGP_BLACK']
    bank_rate = exchange_rates.get('USD') or exchange_rates.get('EGP', 50.70)
    return round(bank_rate, 2)


def _get_target_usd_rate(country, exchange_rates):
    """
    الحصول على سعر الدولار المناسب للدولة المستهدفة.
    - مصر: سعر الدولار بالجنيه
    - السعودية/الكويت/قطر: سعر الصرف الرسمي مقابل الدولار
    """
    if country == 'مصر':
        return _get_egypt_usd_rate(exchange_rates)
    
    usd_egp = exchange_rates.get('USD') or exchange_rates.get('EGP') or 50.70
    currency_map = {
        'السعودية': 'SAR',
        'الكويت': 'KWD',
        'قطر': 'QAR',
        'الإمارات': 'AED',
    }
    currency = currency_map.get(country, 'SAR')
    curr_in_egp = exchange_rates.get(currency)
    if curr_in_egp and curr_in_egp > 0 and curr_in_egp != usd_egp:
        return round(usd_egp / curr_in_egp, 4)
    
    pegs = {'SAR': 3.75, 'KWD': 0.307, 'QAR': 3.64, 'AED': 3.67}
    return pegs.get(currency, 3.75)


def store_clean_gold_prices(timestamp, gold_price_per_ounce_usd, exchange_rates, existing_conn=None):
    """
    تخزين أسعار الذهب النظيفة (بدون مصنعية/دمغة) في جدول gold_prices_clean.
    
    لكل دولة من الـ 4 دول المستهدفة:
      - 24K: (global_ounce / 31.1035) * usd_rate
      - 21K: 24K * 0.875
      - 18K: 24K * 0.75
      - 16K: 24K * 0.6667
    
    المجموع: 4 دول × 4 عيارات = 16 صف لكل snapshot.
    
    لا توجد مصنعية أو دمغة — السعر = الذهب الخالص × سعر الدولار.
    """
    if existing_conn:
        conn = existing_conn
        cursor = conn.cursor()
    else:
        conn = sqlite3.connect(str(DB_PATH), timeout=30.0)
        cursor = conn.cursor()
        try:
            cursor.execute("PRAGMA journal_mode=WAL")
            cursor.execute("PRAGMA busy_timeout=30000")
            cursor.execute("PRAGMA synchronous=NORMAL")
        except Exception:
            pass
    
    _should_close = existing_conn is None
    # إنشاء جدول gold_prices_clean بال schema الجديد (بدون price_per_ounce)
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS gold_prices_clean (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            timestamp TEXT,
            country TEXT,
            currency TEXT,
            karat TEXT,
            price_per_gram REAL,
            usd_rate_used REAL,
            global_ounce_usd REAL,
            UNIQUE(timestamp, country, karat)
        )
    ''')
    
    # سعر الجرام 24K بالدولار
    gram_24k_usd = gold_price_per_ounce_usd / 31.1035
    
    for country, info in TARGET_GOLD_COUNTRIES.items():
        currency = info['currency']
        usd_rate = _get_target_usd_rate(country, exchange_rates)
        
        # سعر الجرام 24K بالعملة المحلية
        gram_24k_local = gram_24k_usd * usd_rate
        
        # حساب العيارات الأقل (نسبة الذهب: 21/24=0.875, 18/24=0.75, 16/24=0.6667)
        for karat, karat_info in TARGET_GOLD_KARATS.items():
            purity = karat_info['purity']
            price_per_gram = round(gram_24k_local * purity, 2)
            
            cursor.execute('''
                INSERT OR REPLACE INTO gold_prices_clean 
                (timestamp, country, currency, karat, price_per_gram, usd_rate_used, global_ounce_usd)
                VALUES (?, ?, ?, ?, ?, ?, ?)
            ''', (timestamp, country, currency, karat, price_per_gram, usd_rate, gold_price_per_ounce_usd))
    
    if _should_close:
        conn.commit()
        conn.close()
    
    return len(TARGET_GOLD_COUNTRIES) * len(TARGET_GOLD_KARATS)


def save_to_database(gold_data, silver_data, currencies_data):
    """حفظ البيانات في قاعدة البيانات مع timestamp"""
    conn = sqlite3.connect(str(DB_PATH), timeout=30.0)
    cursor = conn.cursor()
    try:
        cursor.execute("PRAGMA journal_mode=WAL")
        cursor.execute("PRAGMA busy_timeout=30000")
        cursor.execute("PRAGMA synchronous=NORMAL")
    except Exception:
        pass
    
    timestamp = gold_data['timestamp']
    
    # ════════════════════════════════════════════
    # 1. جدول gold_prices القديم (للتوافقية)
    # ════════════════════════════════════════════
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS gold_prices (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            timestamp TEXT,
            country TEXT,
            currency TEXT,
            karat TEXT,
            price_per_gram REAL,
            price_per_ounce REAL,
            UNIQUE(timestamp, country, karat)
        )
    ''')
    
    # إدراج بيانات الذهب
    for country, data in gold_data['countries'].items():
        for karat, price in data['prices_by_karat'].items():
            cursor.execute('''
                INSERT OR REPLACE INTO gold_prices 
                (timestamp, country, currency, karat, price_per_gram, price_per_ounce)
                VALUES (?, ?, ?, ?, ?, ?)
            ''', (timestamp, country, data['currency'], karat, price, price * 31.1035))
    
    # ════════════════════════════════════════════
    # 2. تخزين الأسعار النظيفة (بدون مصنعية/دمغة)
    # ════════════════════════════════════════════
    store_clean_gold_prices(
        timestamp=timestamp,
        gold_price_per_ounce_usd=gold_data['gold_usd_per_ounce'],
        exchange_rates=currencies_data,
        existing_conn=conn
    )
    
    # ════════════════════════════════════════════
    # 3. جدول أسعار الفضة
    # ════════════════════════════════════════════
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS silver_prices (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            timestamp TEXT,
            country TEXT,
            currency TEXT,
            price_per_gram REAL,
            price_per_ounce REAL,
            UNIQUE(timestamp, country)
        )
    ''')
    
    for country, data in silver_data['countries'].items():
        cursor.execute('''
            INSERT OR REPLACE INTO silver_prices 
            (timestamp, country, currency, price_per_gram, price_per_ounce)
            VALUES (?, ?, ?, ?, ?)
        ''', (timestamp, country, data['currency'], data['silver_per_gram_local'], data['silver_per_ounce_local']))
    
    # ════════════════════════════════════════════
    # 4. جدول أسعار الصرف
    # ════════════════════════════════════════════
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS exchange_rates (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            timestamp TEXT,
            currency TEXT,
            rate_to_usd REAL,
            UNIQUE(timestamp, currency)
        )
    ''')
    
    for currency, rate in currencies_data.items():
        cursor.execute('''
            INSERT OR REPLACE INTO exchange_rates 
            (timestamp, currency, rate_to_usd)
            VALUES (?, ?, ?)
        ''', (timestamp, currency, rate))
    
    conn.commit()
    conn.close()

def fetch_all_metals_forex():
    """جلب جميع بيانات الذهب والعملات"""
    os.makedirs(DATA_DIR, exist_ok=True)
    os.makedirs(os.path.dirname(STATUS_FILE), exist_ok=True)
    
    update_status({
        'running': True,
        'progress': {'current': 0, 'total': 4},
        'logs': [],
        'results': {}
    })
    
    log_message("🚀 بدء سحب بيانات الذهب والعملات...")
    
    # 1. جلب أسعار الصرف أولاً لحساب سعر الدولار
    log_message("💱 جلب أسعار الصرف...")
    exchange_rates = fetch_exchange_rates()
    usd_egp = exchange_rates.get('USD') or exchange_rates.get('EGP') or 50.70
    log_message(f"   تم جلب {len(exchange_rates)} عملة (الدولار = {usd_egp:.2f} ج.م)")
    update_status({'progress': {'current': 1, 'total': 4}})
    
    # 2. جلب سعر الذهب
    log_message("🥇 جلب سعر الذهب...")
    gold_price_usd = fetch_gold_price_usd(usd_egp)
    log_message(f"   سعر الأوقية: ${gold_price_usd:.2f}")
    update_status({'progress': {'current': 2, 'total': 4}})
    
    # 3. جلب سعر الفضة
    log_message("🥈 جلب سعر الفضة...")
    silver_price_usd = fetch_silver_price_usd(usd_egp)
    log_message(f"   سعر الأوقية: ${silver_price_usd:.2f}")
    update_status({'progress': {'current': 3, 'total': 4}})
    
    # 4. حساب الأسعار لكل دولة
    log_message("📊 حساب الأسعار المحلية...")
    gold_data = calculate_gold_prices_by_karat(gold_price_usd, exchange_rates)
    silver_data = calculate_silver_prices(silver_price_usd, exchange_rates)
    update_status({'progress': {'current': 4, 'total': 4}})
    
    # حفظ في قاعدة البيانات
    log_message("💾 حفظ البيانات...")
    save_to_database(gold_data, silver_data, exchange_rates)
    
    # حفظ في ملف JSON
    output = {
        'timestamp': gold_data['timestamp'],
        'gold': gold_data,
        'silver': silver_data,
        'exchange_rates': exchange_rates,
        'countries_count': len(ARAB_COUNTRIES),
        'karats_count': len(GOLD_KARATS),
        'bars_count': len(GOLD_BARS)
    }
    
    output_file = DATA_DIR / 'metals_forex_latest.json'
    with open(output_file, 'w', encoding='utf-8') as f:
        json.dump(output, f, indent=2, ensure_ascii=False)
    
    log_message(f"✅ تم! الذهب: ${gold_price_usd:.2f}/أوقية | الفضة: ${silver_price_usd:.2f}/أوقية")
    log_message(f"   الدول: {len(ARAB_COUNTRIES)} | العيارات: {len(GOLD_KARATS)} | السبائك: {len(GOLD_BARS)}")
    
    update_status({
        'running': False,
        'results': output,
        'last_update': gold_data['timestamp']
    })
    
    return output

if __name__ == '__main__':
    try:
        fetch_all_metals_forex()
    except Exception as e:
        log_message(f"❌ خطأ: {str(e)}")
        update_status({'running': False})
        sys.exit(1)
