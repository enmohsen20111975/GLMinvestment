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

def fetch_gold_price_usd():
    """جلب سعر الذهب بالدولار (للأوقية)"""
    try:
        # استخدام API مجاني
        url = "https://api.metals.live/v1/spot/gold"
        response = requests.get(url, timeout=10)
        if response.status_code == 200:
            data = response.json()
            return float(data.get('price', data[0].get('price', 0)))
    except:
        pass
    
    # محاولة بديلة
    try:
        url = "https://forex-data.p.rapidapi.com/metal/gold"
        headers = {'X-RapidAPI-Key': 'demo'}
        response = requests.get(url, headers=headers, timeout=10)
        if response.status_code == 200:
            return float(response.json().get('price', 0))
    except:
        pass
    
    # سعر تقريبي كfallback
    return 2340.0  # سعر تقريبي للأوقية

def fetch_silver_price_usd():
    """جلب سعر الفضة بالدولار (للأوقية)"""
    try:
        url = "https://api.metals.live/v1/spot/silver"
        response = requests.get(url, timeout=10)
        if response.status_code == 200:
            data = response.json()
            return float(data.get('price', data[0].get('price', 0)))
    except:
        pass
    return 28.0  # سعر تقريبي

def fetch_exchange_rates():
    """جلب أسعار صرف العملات العربية مقابل الدولار"""
    rates = {}
    
    try:
        # استخدام exchangerate API
        url = "https://api.exchangerate-api.com/v4/latest/USD"
        response = requests.get(url, timeout=10)
        if response.status_code == 200:
            data = response.json()
            rates_data = data.get('rates', {})
            
            for country, info in ARAB_COUNTRIES.items():
                currency = info['currency']
                if currency in rates_data:
                    rates[currency] = rates_data[currency]
                elif currency == 'KWD':
                    rates['KWD'] = 0.31  # fallback
                elif currency == 'BHD':
                    rates['BHD'] = 0.38  # fallback
                elif currency == 'OMR':
                    rates['OMR'] = 0.38  # fallback
    except:
        # أسعار تقريبية كfallback
        rates = {
            'EGP': 48.5, 'SAR': 3.75, 'KWD': 0.31, 'QAR': 3.64,
            'AED': 3.67, 'BHD': 0.38, 'OMR': 0.38, 'JOD': 0.71,
            'MAD': 10.0, 'TND': 3.1, 'DZD': 135.0, 'SDG': 600.0,
            'IQD': 1310.0, 'LBP': 89500.0
        }
    
    return rates

def calculate_gold_prices_by_karat(gold_price_per_ounce_usd, exchange_rates):
    """حساب أسعار الذهب بجميع العيارات لكل دولة"""
    timestamp = get_timestamp()
    
    # سعر الجرام من الأوقية (31.1035 جرام)
    gold_price_per_gram_usd = gold_price_per_ounce_usd / 31.1035
    
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
        rate = exchange_rates.get(currency, 1)
        
        # سعر الجرام بالعملة المحلية
        price_per_gram_local = gold_price_per_gram_usd * rate
        
        results['countries'][country] = {
            'currency': currency,
            'symbol': symbol,
            'flag': flag,
            'exchange_rate_to_usd': rate,
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
    
    results = {
        'timestamp': timestamp,
        'silver_usd_per_ounce': silver_price_per_ounce_usd,
        'silver_usd_per_gram': round(silver_price_per_gram_usd, 4),
        'countries': {}
    }
    
    for country, info in ARAB_COUNTRIES.items():
        currency = info['currency']
        rate = exchange_rates.get(currency, 1)
        
        results['countries'][country] = {
            'currency': currency,
            'symbol': info['symbol'],
            'flag': info['flag'],
            'silver_per_gram_local': round(silver_price_per_gram_usd * rate, 4),
            'silver_per_ounce_local': round(silver_price_per_ounce_usd * rate, 2)
        }
    
    return results

def _get_egypt_usd_rate(exchange_rates):
    """
    الحصول على سعر الدولار المناسب لمصر:
    1. S24K من iSagha (لو موجود في exchange_rates كـ EGP_GOLD_SOUGH)
    2. دولار السوق السوداء (لو موجود كـ EGP_BLACK)
    3. سعر البنك * 1.03 كـ fallback
    """
    # 1. دولار الصاغة (معكوس من سعر 24K لو كان متاح)
    if 'EGP_GOLD_SOUGH' in exchange_rates:
        return exchange_rates['EGP_GOLD_SOUGH']
    
    # 2. دولار السوق السوداء
    if 'EGP_BLACK' in exchange_rates:
        return exchange_rates['EGP_BLACK']
    
    # 3. Fallback: سعر البنك * 1.03
    bank_rate = exchange_rates.get('EGP', 48.5)
    return round(bank_rate * 1.03, 2)


def _get_target_usd_rate(country, exchange_rates):
    """
    الحصول على سعر الدولار المناسب للدولة المستهدفة.
    - مصر: سعر السوق السوداء/دولار الصاغة
    - السعودية/الكويت/قطر: سعر الصرف الرسمي
    """
    if country == 'مصر':
        return _get_egypt_usd_rate(exchange_rates)
    
    # الدول الخليجية: سعر الصرف الرسمي
    currency_map = {
        'السعودية': 'SAR',
        'الكويت': 'KWD',
        'قطر': 'QAR',
    }
    currency = currency_map.get(country, 'SAR')
    return exchange_rates.get(currency, 3.75)


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
    
    # 1. جلب سعر الذهب
    log_message("🥇 جلب سعر الذهب...")
    gold_price_usd = fetch_gold_price_usd()
    log_message(f"   سعر الأوقية: ${gold_price_usd:.2f}")
    update_status({'progress': {'current': 1, 'total': 4}})
    
    # 2. جلب سعر الفضة
    log_message("🥈 جلب سعر الفضة...")
    silver_price_usd = fetch_silver_price_usd()
    log_message(f"   سعر الأوقية: ${silver_price_usd:.2f}")
    update_status({'progress': {'current': 2, 'total': 4}})
    
    # 3. جلب أسعار الصرف
    log_message("💱 جلب أسعار الصرف...")
    exchange_rates = fetch_exchange_rates()
    log_message(f"   تم جلب {len(exchange_rates)} عملة")
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
