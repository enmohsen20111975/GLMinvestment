#!/usr/bin/env python3
"""
Daleelak API Fetcher — أسعار العملات + الذهب من مصادر مصرية مرخصة
==================================================================
الـ API: https://getdaleelak.com/api/v1/feed.json
- مجاني، من غير مفتاح، CORS مفتوح
- بيرجّع: عملات + معادن + أحسن جهة بيع/شرا + تقييم اليوم
- حد: 240 طلب/دقيقة
- محمي بـ Cloudflare (بس الـ API endpoint المفروض يكون مفتوح)

في الساندبوكس: Cloudflare challenge بيـ block الـ IP.
في الإنتاج: المفروض يشتغل لو الـ IP residential.

Fallback chain:
1. getdaleelak.com API (محاولة أولى — فيها الذهب + العملات)
2. Frankfurter.dev CBE (fallback للعملات)
3. isagha.com (fallback للذهب — شغّال في الساندبوكس)

الـ destination: db/data_engine.db (exchange_rates + gold_prices + silver_prices)
"""
from __future__ import annotations

import os
import sys
import json
import sqlite3
import urllib.request
import urllib.error
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Optional, Tuple, Any

# === Paths (Rule 29: UNIFIED-SYSTEM) ===
_THIS_DIR = Path(__file__).resolve().parent
_NEWS_AGENT = _THIS_DIR.parent.parent
_PROJECT_ROOT = _NEWS_AGENT.parent
sys.path.insert(0, str(_NEWS_AGENT / 'config'))
from paths import DATA_ENGINE_DB

DB_FILE = DATA_ENGINE_DB
DEFAULT_TIMEOUT = 20

# === Endpoints ===
DALEELAK_API = 'https://getdaleelak.com/api/v1/feed.json'
FRANKFURTER_API = 'https://api.frankfurter.dev/v2/rates?providers=CBE'


def log(msg: str, level: str = 'info') -> None:
    ts = datetime.now().strftime('%H:%M:%S')
    print(f'[{ts}] [DALEELAK-{level.upper()}] {msg}')


def _http_get_json(url: str, timeout: float = DEFAULT_TIMEOUT) -> Optional[Dict]:
    """HTTP GET وترجع JSON (مش هتعدي Cloudflare في الساندبوكس بس هتعدي في الإنتاج)."""
    try:
        req = urllib.request.Request(url, headers={
            'User-Agent': 'Mozilla/5.0 (compatible; DaleelakFetcher/1.0)',
            'Accept': 'application/json',
        })
        resp = urllib.request.urlopen(req, timeout=timeout)
        return json.loads(resp.read())
    except urllib.error.HTTPError as e:
        if e.code == 403:
            log(f'Cloudflare blocked (403) — likely sandbox IP. URL: {url}', 'warn')
        else:
            log(f'HTTP {e.code} from {url}: {e.reason}', 'warn')
        return None
    except Exception as e:
        log(f'Error fetching {url}: {e}', 'warn')
        return None


# ============================================================
# DALEELAK API (primary — Egypt licensed sources)
# ============================================================

def fetch_daleelak_feed() -> Optional[Dict]:
    """جلب feed كامل من getdaleelak.com (عملات + معادن)."""
    log(f'GET {DALEELAK_API}')
    data = _http_get_json(DALEELAK_API)
    if data is None:
        log('Daleelak API failed (likely Cloudflare). Will use fallback.', 'warn')
        return None
    log(f'✓ Daleelak API returned {len(data.get("assets", []))} assets')
    return data


def parse_daleelak_rates(feed: Dict) -> Tuple[List[Dict], List[Dict]]:
    """تحويل الـ feed لـ exchange_rates + gold_prices rows."""
    currencies = []
    metals = []
    for asset in feed.get('assets', []):
        category = asset.get('category')
        benchmark = asset.get('benchmark') or {}
        global_data = asset.get('global') or {}
        if category == 'currencies':
            # Format: id=USD-EGP, unit=EGP/USD
            asset_id = asset.get('id', '')
            parts = asset_id.split('-')
            if len(parts) != 2:
                continue
            from_ccy, to_ccy = parts
            global_rate = global_data.get('value')
            currencies.append({
                'currency': from_ccy,
                'rate_to_egp': benchmark.get('buy') or global_rate,
                'sell_rate': benchmark.get('sell'),
                'global_rate': global_rate,
                'source': 'daleelak',
                'timestamp': datetime.now().isoformat(timespec='seconds'),
            })
        elif category == 'metals':
            slug = asset.get('slug', '')
            metals.append({
                'metal': slug,
                'buy_egp': benchmark.get('buy'),
                'sell_egp': benchmark.get('sell'),
                'global_usd': global_data.get('value'),
                'source': 'daleelak',
                'timestamp': datetime.now().isoformat(timespec='seconds'),
            })
    return currencies, metals


# ============================================================
# FRANKFURTER FALLBACK (CBE — Central Bank of Egypt)
# ============================================================

def fetch_frankfurter_cbe() -> Optional[List[Dict]]:
    """Fallback: أسعار الصرف من البنك المركزي المصري عن طريق Frankfurter."""
    log(f'GET {FRANKFURTER_API} (CBE fallback)')
    data = _http_get_json(FRANKFURTER_API)
    if data is None:
        log('Frankfurter also failed', 'error')
        return None
    rates = []
    date = data[0].get('date') if data else datetime.now().strftime('%Y-%m-%d')
    for item in data:
        base = item.get('base')
        quote = item.get('quote')
        rate = item.get('rate')
        if base == 'EUR' and quote and rate:
            rates.append({
                'currency': quote,
                'rate_to_eur': rate,
                'source': 'cbe_frankfurter',
                'date': date,
                'timestamp': datetime.now().isoformat(timespec='seconds'),
            })
    log(f'✓ Frankfurter CBE returned {len(rates)} currencies (base=EUR)')
    return rates


# ============================================================
# ISAGHA FALLBACK (Gold — شغّال في الساندبوكس)
# ============================================================

def fetch_isagha_gold() -> Optional[Dict]:
    """Fallback: أسعار الذهب من isagha.com (شغّال في الساندبوكس)."""
    # isagha API endpoint (from news-agent/data/gold_prices.json)
    # Try the public API
    url = 'https://api.isagha.com/v1/gold/latest'
    log(f'GET isagha gold (fallback)')
    try:
        data = _http_get_json(url)
        if data:
            return data
    except Exception:
        pass
    # Fallback to local cached file
    cached = _NEWS_AGENT / 'data' / 'gold_prices.json'
    if cached.exists():
        with open(cached) as f:
            return json.load(f)
    return None


# ============================================================
# DB SAVE
# ============================================================

def save_exchange_rates(rates: List[Dict]) -> int:
    """حفظ أسعار الصرف في data_engine.db.exchange_rates.
    Schema: id, timestamp, currency, rate_to_usd
    """
    if not rates:
        return 0
    conn = sqlite3.connect(DB_FILE, timeout=10)
    conn.execute('PRAGMA busy_timeout = 10000')
    inserted = 0
    ts = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
    for r in rates:
        try:
            # rate_to_usd: إذا الـ currency هي USD، rate=1. لو غير كده، نحسب من rate_to_egp
            currency = r['currency']
            rate_to_egp = r.get('rate_to_egp')
            if currency == 'USD':
                rate_to_usd = 1.0
            elif rate_to_egp and rate_to_egp > 0:
                # لو الـ rate_to_egp هو سعر USD لهذه العملة، نحسب العكس
                rate_to_usd = 1.0 / rate_to_egp if rate_to_egp else None
            else:
                rate_to_usd = None
            if rate_to_usd is None:
                continue
            conn.execute('''
                INSERT INTO exchange_rates (timestamp, currency, rate_to_usd)
                VALUES (?, ?, ?)
            ''', (ts, currency, rate_to_usd))
            inserted += 1
        except Exception as e:
            log(f'Error inserting currency {r}: {e}', 'warn')
    conn.commit()
    conn.close()
    return inserted


def save_gold_prices(metals: List[Dict]) -> int:
    """حفظ أسعار الذهب في data_engine.db.gold_prices.
    Schema: id, timestamp, country, currency, karat, price_per_gram, price_per_ounce
    """
    if not metals:
        return 0
    conn = sqlite3.connect(DB_FILE, timeout=10)
    conn.execute('PRAGMA busy_timeout = 10000')
    inserted = 0
    ts = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
    for m in metals:
        try:
            metal_slug = m['metal']  # e.g. 'gold-21k', 'silver-999'
            # Parse: gold-21k → karat=21k, silver-999 → karat=999
            parts = metal_slug.split('-')
            metal_type = parts[0] if parts else metal_slug
            karat = parts[1] if len(parts) > 1 else ''
            global_usd = m.get('global_usd')  # هذا السعر بالدولار (per ounce or per gram)
            buy_egp = m.get('buy_egp')
            # لو مفيش buy_egp، استخدم global_usd (per ounce للذهب)
            price_per_ounce = None
            price_per_gram = None
            if metal_type == 'gold':
                price_per_ounce = global_usd  # global gold price is per ounce
                price_per_gram = buy_egp  # Egyptian price is per gram
            elif metal_type == 'silver':
                price_per_ounce = global_usd
                price_per_gram = buy_egp
            conn.execute('''
                INSERT INTO gold_prices (timestamp, country, currency, karat, price_per_gram, price_per_ounce)
                VALUES (?, ?, ?, ?, ?, ?)
            ''', (ts, 'Egypt', 'EGP', f'{metal_type}-{karat}' if karat else metal_type, price_per_gram, price_per_ounce))
            inserted += 1
        except Exception as e:
            log(f'Error inserting gold {m}: {e}', 'warn')
    conn.commit()
    conn.close()
    return inserted


# ============================================================
# MAIN ORCHESTRATION (fallback chain)
# ============================================================

def fetch_and_save() -> Dict:
    """الـ main: جرب Daleelak، fallback لـ Frankfurter + isagha."""
    log('='*60)
    log('Starting Daleelak/Frankfurter/isagha fetch')
    log('='*60)
    
    # 1. Try Daleelak (primary)
    feed = fetch_daleelak_feed()
    if feed:
        currencies, metals = parse_daleelak_rates(feed)
        cur_saved = save_exchange_rates(currencies)
        gold_saved = save_gold_prices(metals)
        return {
            'source': 'daleelak',
            'currencies': cur_saved,
            'metals': gold_saved,
            'success': True,
        }
    
    # 2. Fallback: Frankfurter for currencies + isagha for gold
    log('Using Frankfurter (CBE) for currencies + isagha for gold')
    frank_rates = fetch_frankfurter_cbe()
    cur_saved = save_exchange_rates(frank_rates or [])
    
    isagha_data = fetch_isagha_gold()
    metals = []
    if isagha_data and 'prices' in isagha_data:
        for karat, info in isagha_data['prices'].items():
            if isinstance(info, dict) and 'buy' in info:
                metals.append({
                    'metal': karat,
                    'buy_egp': float(info['buy']) if info['buy'] else None,
                    'sell_egp': float(info['sell']) if info['sell'] else None,
                    'source': 'isagha',
                    'timestamp': datetime.now().isoformat(timespec='seconds'),
                })
    gold_saved = save_gold_prices(metals)
    
    return {
        'source': 'frankfurter_isagha_fallback',
        'currencies': cur_saved,
        'metals': gold_saved,
        'success': cur_saved > 0 or gold_saved > 0,
    }


def main() -> int:
    result = fetch_and_save()
    log(f'Result: {result}')
    return 0 if result['success'] else 1


if __name__ == '__main__':
    sys.exit(main())
