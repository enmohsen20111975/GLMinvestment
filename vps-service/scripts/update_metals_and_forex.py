#!/usr/bin/env python3
"""
update_metals_and_forex.py — تحديث المعادن + العملات من مصادر احترافية
================================================================================

FIX v2 (2026-10-08):
  - metals.dev: API key يعمل ✅ (gold $4124, silver $58, platinum $1631, copper $0.45)
  - frankfurter.dev: الـ URL الصحيح هو /v2/rates?base=USD (ليس /v1/latest)
  - frankfurter.dev: /v2/rate/USD/EGP يعطي EGP مباشرة

المصادر:
  1. metals.dev — الذهب/الفضة/البلاتين/النحاس (API key مفعّل)
  2. frankfurter.dev v2 — العملات (بنك مركزي أوروبي، مجاني)
  3. CoinGecko — الكريبتو (موجود بالفعل، هذا السكربت يضيف اختبار)

الاستخدام:
  cd ~/my_apps/GLMinvestment
  .venv/bin/python vps-service/scripts/update_metals_and_forex.py --dry-run
  .venv/bin/python vps-service/scripts/update_metals_and_forex.py

Cron (كل 15 دقيقة):
  */15 * * * * cd /root/GLMinvestment && .venv/bin/python vps-service/scripts/update_metals_and_forex.py >> logs/metals_forex.log 2>&1
================================================================================
"""

import sqlite3
import urllib.request
import urllib.error
import json
import sys
import os
from pathlib import Path
from datetime import datetime

PROJECT_ROOT = Path(__file__).resolve().parents[2]
DB_PATH = PROJECT_ROOT / 'db' / 'data_engine.db'
DRY_RUN = '--dry-run' in sys.argv

# === metals.dev ===
METALS_DEV_URL = 'https://api.metals.dev/v1/latest'
# API key من env أو hardcoded (المالك: PC38QRRLVNN1YENBR0UG389NBR0UG)
METALS_DEV_KEY = os.environ.get('METALS_DEV_KEY', 'PC38QRRLVNN1YENBR0UG389NBR0UG')
METALS = ['gold', 'silver', 'platinum', 'copper']

# === frankfurter.dev v2 ===
# الـ URL الصحيح: /v2/rates?base=USD (ليس /v1/latest)
FRANKFURTER_RATES_URL = 'https://api.frankfurter.dev/v2/rates'
FRANKFURTER_RATE_URL = 'https://api.frankfurter.dev/v2/rate'
FRANKFURTER_BASE = 'USD'
FRANKFURTER_TARGETS = ['EGP', 'SAR', 'KWD', 'QAR', 'AED']

# === CoinGecko ===
COINGECKO_URL = 'https://api.coingecko.com/api/v3/simple/price'
COINGECKO_COINS = ['bitcoin', 'ethereum', 'binancecoin']


def log(msg, level='INFO'):
    ts = datetime.now().strftime('%H:%M:%S')
    print(f"[{ts}] {level}: {msg}")


# ============================================================================
# 1. metals.dev — الذهب/الفضة/البلاتين/النحاس
# ============================================================================

def fetch_metals_from_metals_dev() -> list:
    """جلب أسعار المعادن من metals.dev (API key مفعّل)"""
    try:
        url = f"{METALS_DEV_URL}?api_key={METALS_DEV_KEY}&currency=USD&unit=toz"
        req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
        with urllib.request.urlopen(req, timeout=10) as resp:
            data = json.loads(resp.read().decode())

        results = []
        metals_data = data.get('metals', {})
        for metal in METALS:
            if metal in metals_data:
                price = float(metals_data[metal])
                if price and price > 0:
                    results.append({
                        'metal': metal,
                        'price_usd': price,
                        'currency': 'USD',
                        'unit': 'toz',
                    })
                    log(f"  ✅ {metal}: ${price:.2f}/toz")
        return results
    except Exception as e:
        log(f"  ❌ metals.dev خطأ: {e}", 'ERROR')
        return []


def save_metals_to_db(metals: list) -> int:
    """حفظ المعادن في data_engine.db (gold_prices + silver_prices)"""
    if not metals or DRY_RUN:
        return 0

    try:
        conn = sqlite3.connect(str(DB_PATH))
        cur = conn.cursor()
        now_iso = datetime.now().isoformat()
        saved = 0

        # auto-migration: تأكد من وجود الجداول بالـ schema الصحيح
        cur.execute('''CREATE TABLE IF NOT EXISTS gold_prices (
            id INTEGER PRIMARY KEY AUTOINCREMENT, timestamp TEXT, karat TEXT,
            price_per_gram REAL, price_per_ounce REAL, currency TEXT,
            UNIQUE(timestamp, karat))''')
        cur.execute('''CREATE TABLE IF NOT EXISTS silver_prices (
            id INTEGER PRIMARY KEY AUTOINCREMENT, timestamp TEXT,
            price_per_gram REAL, price_per_ounce REAL, currency TEXT,
            UNIQUE(timestamp))''')

        for m in metals:
            metal_name = m['metal']
            price_usd = m['price_usd']

            # تحويل من troy ounce إلى gram (1 toz = 31.1035g)
            price_per_gram_usd = price_usd / 31.1035

            if metal_name == 'gold':
                # حفظ في gold_prices (24k = price per gram)
                cur.execute("""
                    INSERT OR REPLACE INTO gold_prices (timestamp, karat, price_per_gram, price_per_ounce, currency)
                    VALUES (?, '24k', ?, ?, 'USD')
                """, (now_iso, price_per_gram_usd, price_usd))
                saved += 1
                log(f"  💾 ذهب محفوظ: {price_per_gram_usd:.2f} USD/جرام ({price_usd:.2f} USD/أونصة)")
            elif metal_name == 'silver':
                cur.execute("""
                    INSERT OR REPLACE INTO silver_prices (timestamp, price_per_gram, price_per_ounce, currency)
                    VALUES (?, ?, ?, 'USD')
                """, (now_iso, price_per_gram_usd, price_usd))
                saved += 1
                log(f"  💾 فضة محفوظة: {price_per_gram_usd:.4f} USD/جرام ({price_usd:.2f} USD/أونصة)")
            elif metal_name == 'platinum':
                # حفظ في gold_prices كـ platinum (نفس الجدول لكل المعادن)
                cur.execute("""
                    INSERT OR REPLACE INTO gold_prices (timestamp, karat, price_per_gram, price_per_ounce, currency)
                    VALUES (?, 'platinum', ?, ?, 'USD')
                """, (now_iso, price_per_gram_usd, price_usd))
                saved += 1
                log(f"  💾 بلاتين محفوظ: {price_per_gram_usd:.2f} USD/جرام")
            elif metal_name == 'copper':
                cur.execute("""
                    INSERT OR REPLACE INTO gold_prices (timestamp, karat, price_per_gram, price_per_ounce, currency)
                    VALUES (?, 'copper', ?, ?, 'USD')
                """, (now_iso, price_per_gram_usd, price_usd))
                saved += 1
                log(f"  💾 نحاس محفوظ: {price_per_gram_usd:.4f} USD/جرام")

        conn.commit()
        conn.close()
        return saved
    except Exception as e:
        log(f"  ❌ حفظ المعادن: {e}", 'ERROR')
        return 0


# ============================================================================
# 2. frankfurter.dev v2 — العملات
# ============================================================================

def fetch_forex_from_frankfurter() -> list:
    """جلب أسعار العملات من frankfurter.dev v2 API"""
    try:
        # v2 API: /v2/rates?base=USD
        url = f"{FRANKFURTER_RATES_URL}?base={FRANKFURTER_BASE}"
        req = urllib.request.Request(url, headers={
            'User-Agent': 'Mozilla/5.0',
            'Accept': 'application/json',
        })
        with urllib.request.urlopen(req, timeout=10) as resp:
            data = json.loads(resp.read().decode())

        # v2 يرجع قائمة: [{"date":"2026-10-08","base":"USD","quote":"AED","rate":3.6725}, ...]
        results = []
        if isinstance(data, list):
            for item in data:
                quote = item.get('quote', '')
                if quote in FRANKFURTER_TARGETS:
                    rate = float(item.get('rate', 0))
                    if rate > 0:
                        results.append({
                            'base': FRANKFURTER_BASE,
                            'target': quote,
                            'rate': rate,
                            'date': item.get('date', ''),
                        })
                        log(f"  ✅ {FRANKFURTER_BASE}/{quote}: {rate:.4f}")
        elif isinstance(data, dict):
            # fallback: لو v2 رجع dict بدل list
            rates = data.get('rates', {})
            for target in FRANKFURTER_TARGETS:
                if target in rates:
                    rate = float(rates[target])
                    if rate > 0:
                        results.append({
                            'base': FRANKFURTER_BASE,
                            'target': target,
                            'rate': rate,
                            'date': data.get('date', ''),
                        })
                        log(f"  ✅ {FRANKFURTER_BASE}/{target}: {rate:.4f}")

        return results
    except Exception as e:
        log(f"  ❌ frankfurter.dev خطأ: {e}", 'ERROR')
        return []


def fetch_single_rate(base: str, target: str) -> dict | None:
    """جلب سعر عملة واحد من frankfurter.dev /v2/rate/USD/EGP"""
    try:
        url = f"{FRANKFURTER_RATE_URL}/{base}/{target}"
        req = urllib.request.Request(url, headers={
            'User-Agent': 'Mozilla/5.0',
            'Accept': 'application/json',
        })
        with urllib.request.urlopen(req, timeout=10) as resp:
            data = json.loads(resp.read().decode())
        return data
    except Exception as e:
        log(f"  ❌ frankfurter /rate/{base}/{target}: {e}", 'ERROR')
        return None


def save_forex_to_db(forex: list) -> int:
    """حفظ العملات في data_engine.db.exchange_rates
    
    UNIFY-FIX (2026-10-08): schema الحقيقي = (timestamp, currency, rate_to_usd)
    وليس (base_currency, target_currency) كما كان في الكود القديم.
    """
    if not forex or DRY_RUN:
        return 0

    try:
        conn = sqlite3.connect(str(DB_PATH))
        cur = conn.cursor()
        now_iso = datetime.now().isoformat()
        saved = 0

        # auto-migration: تأكد من وجود الجدول بالـ schema الصحيح
        cur.execute('''
            CREATE TABLE IF NOT EXISTS exchange_rates (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                timestamp TEXT,
                currency TEXT,
                rate_to_usd REAL,
                UNIQUE(timestamp, currency)
            )
        ''')

        for f in forex:
            # frankfurter يعطي USD/EGP = 52.38 → يعني 1 USD = 52.38 EGP
            # نحفظ: currency=EGP, rate_to_usd=52.38 (سعر العملة مقابل الدولار)
            target = f.get('target', '')
            rate = f.get('rate', 0)
            if target and rate and float(rate) > 0:
                cur.execute('''
                    INSERT OR REPLACE INTO exchange_rates 
                    (timestamp, currency, rate_to_usd)
                    VALUES (?, ?, ?)
                ''', (now_iso, target, float(rate)))
                saved += 1
                log(f"  💾 {target}: {rate:.4f} محفوظ")

        conn.commit()
        conn.close()
        return saved
    except Exception as e:
        log(f"  ❌ حفظ العملات: {e}", 'ERROR')
        return 0


# ============================================================================
# 3. CoinGecko — الكريبتو (اختبار + تأكيد)
# ============================================================================

def test_coingecko() -> bool:
    """اختبار أن CoinGecko يعمل بشكل صحيح"""
    try:
        coins_str = ','.join(COINGECKO_COINS)
        url = f"{COINGECKO_URL}?ids={coins_str}&vs_currencies=usd"
        req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
        with urllib.request.urlopen(req, timeout=10) as resp:
            data = json.loads(resp.read().decode())

        all_ok = True
        for coin in COINGECKO_COINS:
            if coin in data:
                price = data[coin].get('usd', 0)
                if price and price > 0:
                    log(f"  ✅ CoinGecko {coin}: ${price:.2f}")
                else:
                    log(f"  ⚠️ CoinGecko {coin}: سعر = 0")
                    all_ok = False
            else:
                log(f"  ⚠️ CoinGecko {coin}: غير موجود")
                all_ok = False
        return all_ok
    except Exception as e:
        log(f"  ❌ CoinGecko خطأ: {e}", 'ERROR')
        return False


# ============================================================================
# Main
# ============================================================================

if __name__ == '__main__':
    log("=" * 60)
    log("💰 تحديث المعادن + العملات + اختبار الكريبتو")
    log(f"   Project: {PROJECT_ROOT}")
    log(f"   Mode: {'DRY-RUN' if DRY_RUN else 'LIVE'}")
    log("=" * 60)

    # 1. metals.dev
    log("")
    log("=" * 60)
    log("1️⃣ metals.dev — الذهب/الفضة/البلاتين/النحاس")
    log("=" * 60)
    metals = fetch_metals_from_metals_dev()
    if metals:
        saved = save_metals_to_db(metals)
        log(f"  ✅ تم حفظ {saved} معدن في data_engine.db")
    else:
        log("  ⚠️ لا توجد بيانات معادن")

    # 2. frankfurter.dev v2
    log("")
    log("=" * 60)
    log("2️⃣ frankfurter.dev v2 — العملات (بنك مركزي أوروبي)")
    log("=" * 60)
    forex = fetch_forex_from_frankfurter()
    if not forex:
        # Fallback: جرّب /v2/rate/USD/EGP مباشرة
        log("  🔄 محاولة fallback: /v2/rate/USD/EGP مباشرة...")
        for target in FRANKFURTER_TARGETS:
            single = fetch_single_rate(FRANKFURTER_BASE, target)
            if single and single.get('rate'):
                forex.append({
                    'base': single.get('base', FRANKFURTER_BASE),
                    'target': single.get('quote', target),
                    'rate': float(single['rate']),
                    'date': single.get('date', ''),
                })
                log(f"  ✅ {FRANKFURTER_BASE}/{target}: {single['rate']:.4f} (مباشر)")

    if forex:
        saved = save_forex_to_db(forex)
        log(f"  ✅ تم حفظ {saved} عملة في data_engine.db")

    # 3. CoinGecko (اختبار)
    log("")
    log("=" * 60)
    log("3️⃣ CoinGecko — اختبار الكريبتو")
    log("=" * 60)
    coingecko_ok = test_coingecko()
    if coingecko_ok:
        log("  ✅ CoinGecko يعمل بشكل صحيح — لا حاجة لتغيير")
    else:
        log("  ⚠️ CoinGecko يحتاج مراجعة")

    # تقرير نهائي
    log("")
    log("=" * 60)
    log("📋 تقرير نهائي:")
    log(f"  metals.dev: {len(metals)} معدن")
    log(f"  frankfurter.dev: {len(forex)} عملة")
    log(f"  CoinGecko: {'✅ يعمل' if coingecko_ok else '⚠️ يحتاج مراجعة'}")
    log("=" * 60)
    log("✅ اكتمل")
