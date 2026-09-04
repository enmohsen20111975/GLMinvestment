#!/usr/bin/env python3
"""
Unified Price Fetcher — الذهب + الفضة + العملات
=================================================
المصادر الأساسية (شغّالة بثبات):
  1. Frankfurter.dev CBE — للعملات (Central Bank of Egypt)
  2. isagha.com — للذهب بكل العيارات (EGP)

المصدر الاحتياطي (لو اشتغل):
  3. Daleelak API — للعملات + المعادن (محجوب بـ Cloudflare في الساندبوكس)

الـ destination: db/data_engine.db (gold_prices + exchange_rates)
"""
import os, sys, json, sqlite3, urllib.request, urllib.error
from datetime import datetime
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
sys.path.insert(0, str(PROJECT_ROOT / 'news-agent' / 'config'))
try:
    from paths import DATA_ENGINE_DB
except ImportError:
    DATA_ENGINE_DB = str(PROJECT_ROOT / 'db' / 'data_engine.db')

DB_FILE = DATA_ENGINE_DB
FRANKFURTER_URL = 'https://api.frankfurter.dev/v2/rates?providers=CBE'
ISAGHA_GOLD_FILE = str(PROJECT_ROOT / 'db' / 'gold_prices.json')
# Fallback: also check news-agent path
if not os.path.exists(ISAGHA_GOLD_FILE):
    ISAGHA_GOLD_FILE = str(PROJECT_ROOT / 'news-agent' / 'data' / 'gold_prices.json')
DALEELAK_URL = 'https://getdaleelak.com/api/v1/feed.json'

UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'


def log(msg, level='INFO'):
    ts = datetime.now().strftime('%H:%M:%S')
    print(f'[{ts}] [PRICES-{level}] {msg}')


def http_get_json(url, timeout=15):
    try:
        req = urllib.request.Request(url, headers={'User-Agent': UA, 'Accept': 'application/json'})
        resp = urllib.request.urlopen(req, timeout=timeout)
        return json.loads(resp.read())
    except Exception as e:
        log(f'HTTP error: {e}', 'WARN')
        return None


# ============================================================
# 1. FRANKFURTER CBE — العملات (مصدر أساسي)
# ============================================================

def fetch_frankfurter_currencies():
    """جلب 19 عملة من البنك المركزي المصري."""
    log('Fetching currencies from Frankfurter CBE...')
    data = http_get_json(FRANKFURTER_URL)
    if not data:
        log('Frankfurter failed', 'ERROR')
        return []

    rates = []
    ts = datetime.now().strftime('%Y-%m-%d %H:%M:%S')

    # بيجيب rates vs EUR، نحول لـ USD
    usd_rate = None
    for item in data:
        if item.get('base') == 'EUR' and item.get('quote') == 'USD':
            usd_rate = item.get('rate')
            break

    for item in data:
        quote = item.get('quote')
        rate_vs_eur = item.get('rate')
        if not quote or not rate_vs_eur:
            continue

        # تحويل لـ rate_to_usd (كم وحدة من العملة = 1 USD)
        if quote == 'USD':
            rate_to_usd = 1.0
        elif usd_rate and rate_vs_eur:
            # rate_to_usd = rate_vs_eur / usd_rate
            rate_to_usd = rate_vs_eur / usd_rate
        else:
            continue

        rates.append({
            'currency': quote,
            'rate_to_usd': round(rate_to_usd, 8),
            'source': 'frankfurter_cbe',
            'timestamp': ts,
        })

    log(f'✓ Frankfurter: {len(rates)} currencies (USD/EGP={next((r["rate_to_usd"] for r in rates if r["currency"]=="EGP"), 0):.2f})')
    return rates


# ============================================================
# 2. ISAGHA — الذهب (مصدر أساسي)
# ============================================================

def fetch_isagha_gold():
    """جلب أسعار الذهب من isagha.com (cached JSON)."""
    log('Fetching gold from isagha...')
    if not os.path.exists(ISAGHA_GOLD_FILE):
        log(f'isagha file not found: {ISAGHA_GOLD_FILE}', 'WARN')
        return []

    try:
        with open(ISAGHA_GOLD_FILE) as f:
            data = json.load(f)
    except Exception as e:
        log(f'isagha read error: {e}', 'ERROR')
        return []

    prices = data.get('prices', {})
    metals = []
    ts = datetime.now().strftime('%Y-%m-%d %H:%M:%S')

    # تحويل أسعار isagha لـ gold_prices format
    karat_map = {
        '24K': 'gold-24k',
        '22K': 'gold-22k',
        '21K': 'gold-21k',
        '18K': 'gold-18k',
        '14K': 'gold-14k',
        'Oz': 'gold-ounce',
    }

    for isagha_key, db_karat in karat_map.items():
        price_data = prices.get(isagha_key)
        if not price_data or not isinstance(price_data, dict):
            continue

        buy = float(price_data.get('buy') or 0)
        sell = float(price_data.get('sell') or 0)
        mid = (buy + sell) / 2 if buy and sell else buy or sell

        metals.append({
            'karat': db_karat,
            'price_per_gram': mid if 'Oz' not in isagha_key else None,
            'price_per_ounce': mid if 'Oz' in isagha_key else None,
            'buy_egp': buy,
            'sell_egp': sell,
            'source': 'isagha',
            'timestamp': ts,
        })

    log(f'✓ isagha: {len(metals)} gold prices (24K buy={prices.get("24K",{}).get("buy")} EGP)')
    return metals


# ============================================================
# 3. DALEELAK — fallback (لو اشتغل)
# ============================================================

def fetch_daleelak():
    """محاولة جلب من Daleelak (محجوب في الساندبوكس بس ممكن يشتغل على الإنتاج)."""
    log('Trying Daleelak (fallback)...')
    data = http_get_json(DALEELAK_URL, timeout=10)
    if not data:
        log('Daleelak: Cloudflare blocked (expected in sandbox)', 'WARN')
        return None
    log(f'✓ Daleelak: {len(data.get("assets",[]))} assets')
    return data


# ============================================================
# SAVE TO DB
# ============================================================

def save_currencies(rates):
    if not rates:
        return 0
    conn = sqlite3.connect(DB_FILE, timeout=10)
    conn.execute('PRAGMA busy_timeout = 10000')
    inserted = 0
    for r in rates:
        try:
            conn.execute('''
                INSERT INTO exchange_rates (timestamp, currency, rate_to_usd)
                VALUES (?, ?, ?)
            ''', (r['timestamp'], r['currency'], r['rate_to_usd']))
            inserted += 1
        except Exception as e:
            log(f'Error inserting {r["currency"]}: {e}', 'WARN')
    conn.commit()
    conn.close()
    return inserted


def save_gold(metals):
    if not metals:
        return 0
    conn = sqlite3.connect(DB_FILE, timeout=10)
    conn.execute('PRAGMA busy_timeout = 10000')
    inserted = 0
    for m in metals:
        try:
            conn.execute('''
                INSERT INTO gold_prices (timestamp, country, currency, karat, price_per_gram, price_per_ounce)
                VALUES (?, 'Egypt', 'EGP', ?, ?, ?)
            ''', (m['timestamp'], m['karat'], m.get('price_per_gram'), m.get('price_per_ounce')))
            inserted += 1
        except Exception as e:
            log(f'Error inserting {m["karat"]}: {e}', 'WARN')
    conn.commit()
    conn.close()
    return inserted


# ============================================================
# MAIN
# ============================================================

def fetch_and_save():
    log('='*60)
    log('Unified Price Fetcher — Gold + Currencies')
    log('='*60)

    # 1. العملات من Frankfurter CBE (أساسي)
    currencies = fetch_frankfurter_currencies()
    cur_saved = save_currencies(currencies)

    # 2. الذهب من isagha (أساسي)
    gold = fetch_isagha_gold()
    gold_saved = save_gold(gold)

    # 3. Daleelak (fallback — لو اشتغل)
    daleelak = fetch_daleelak()
    if daleelak:
        # Daleelak ممكن يدي بيانات أحدث — نحفظها كمان
        ts = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
        for asset in daleelak.get('assets', []):
            cat = asset.get('category')
            benchmark = asset.get('benchmark') or {}
            global_data = asset.get('global') or {}

            if cat == 'currencies':
                aid = asset.get('id', '')
                parts = aid.split('-')
                if len(parts) == 2:
                    currency = parts[0]
                    buy = benchmark.get('buy')
                    if buy and buy > 0:
                        rate_to_usd = 1.0 / buy if currency != 'USD' else 1.0
                        try:
                            conn = sqlite3.connect(DB_FILE, timeout=10)
                            conn.execute('INSERT INTO exchange_rates (timestamp, currency, rate_to_usd) VALUES (?, ?, ?)',
                                        (ts, currency, rate_to_usd))
                            conn.commit()
                            conn.close()
                        except:
                            pass

            elif cat == 'metals':
                slug = asset.get('slug', '')
                global_val = global_data.get('value')
                if global_val and slug:
                    try:
                        conn = sqlite3.connect(DB_FILE, timeout=10)
                        conn.execute('INSERT INTO gold_prices (timestamp, country, currency, karat, price_per_ounce) VALUES (?, "Egypt", "EGP", ?, ?)',
                                    (ts, slug, global_val))
                        conn.commit()
                        conn.close()
                    except:
                        pass

    log(f'\n=== SUMMARY ===')
    log(f'Currencies saved: {cur_saved}')
    log(f'Gold prices saved: {gold_saved}')
    log(f'Sources: Frankfurter CBE + isagha' + (' + Daleelak' if daleelak else ' (Daleelak blocked)'))

    return {
        'currencies': cur_saved,
        'gold': gold_saved,
        'daleelak_used': daleelak is not None,
    }


if __name__ == '__main__':
    result = fetch_and_save()
    log(f'Result: {result}')
