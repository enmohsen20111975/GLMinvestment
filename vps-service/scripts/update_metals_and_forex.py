#!/usr/bin/env python3
"""
update_metals_and_forex.py — تحديث المعادن + العملات من مصادر احترافية
================================================================================

المصادر:
  1. metals.dev — الذهب/الفضة/البلاتين/النحاس (API مجاني، سريع، موثوق)
  2. frankfurter.dev — العملات الأجنبية (API مجاني، بنك مركزي أوروبي)
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
from pathlib import Path
from datetime import datetime

PROJECT_ROOT = Path(__file__).resolve().parents[2]
DB_PATH = PROJECT_ROOT / 'db' / 'data_engine.db'
DRY_RUN = '--dry-run' in sys.argv

# === metals.dev ===
# API مجاني: https://metals.dev/
# يتطلب API key مجاني (1000 طلب/شهر)
METALS_DEV_URL = 'https://api.metals.dev/v1/latest'
METALS_DEV_KEY = ''  # المالك يجب أن يحصل على مفتاح مجاني من metals.dev

# === frankfurter.dev ===
# API مجاني بالكامل بدون مفتاح (بنك مركزي أوروبي)
FRANKFURTER_URL = 'https://api.frankfurter.dev/v1/latest'
FRANKFURTER_BASE = 'USD'
FRANKFURTER_TARGETS = ['EGP', 'SAR', 'KWD', 'QAR', 'AED']

# === CoinGecko ===
COINGECKO_URL = 'https://api.coingecko.com/api/v3/simple/price'
COINGECKO_COINS = ['bitcoin', 'ethereum', 'binancecoin']

# المعادن المطلوبة من metals.dev
METALS = ['gold', 'silver', 'platinum', 'copper']


def log(msg, level='INFO'):
    ts = datetime.now().strftime('%H:%M:%S')
    print(f"[{ts}] {level}: {msg}")


# ============================================================================
# 1. metals.dev — الذهب/الفضة/البلاتين/النحاس
# ============================================================================

def fetch_metals_from_metals_dev() -> list:
    """جلب أسعار المعادن من metals.dev"""
    if not METALS_DEV_KEY:
        log("  ⚠️ metals.dev: لا يوجد API key — استخدم fallback من Daleelak")
        return []

    try:
        url = f"{METALS_DEV_URL}?api_key={METALS_DEV_KEY}&currency=USD&unit=toz"
        req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
        with urllib.request.urlopen(req, timeout=10) as resp:
            data = json.loads(resp.read().decode())

        results = []
        for metal in METALS:
            if metal in data.get('metals', {}):
                price = data['metals'][metal]
                if price and price > 0:
                    results.append({
                        'metal': metal,
                        'price_usd': float(price),
                        'currency': 'USD',
                        'unit': 'toz',
                    })
                    log(f"  ✅ {metal}: ${price:.2f}/toz")
        return results
    except Exception as e:
        log(f"  ❌ metals.dev خطأ: {e}", 'ERROR')
        return []


def fetch_gold_from_egksco_or_daleelak() -> dict | None:
    """Fallback: جلب الذهب من data_engine.db (البيانات الموجودة من Daleelak)"""
    try:
        conn = sqlite3.connect(str(DB_PATH))
        cur = conn.cursor()
        # آخر سعر ذهب من gold_prices
        row = cur.execute("""
            SELECT price_per_gram, karat, timestamp
            FROM gold_prices
            WHERE karat = '24k'
            ORDER BY timestamp DESC LIMIT 1
        """).fetchone()
        conn.close()

        if row and row[0]:
            return {
                'source': 'daleelak_fallback',
                'price_per_gram_24k': float(row[0]),
                'timestamp': row[2],
            }
        return None
    except Exception:
        return None


# ============================================================================
# 2. frankfurter.dev — العملات
# ============================================================================

def fetch_forex_from_frankfurter() -> list:
    """جلب أسعار العملات من frankfurter.dev (بنك مركزي أوروبي — موثوق 100%)"""
    try:
        targets_str = ','.join(FRANKFURTER_TARGETS)
        url = f"{FRANKFURTER_URL}?base={FRANKFURTER_BASE}&symbols={targets_str}"
        req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
        with urllib.request.urlopen(req, timeout=10) as resp:
            data = json.loads(resp.read().decode())

        results = []
        rates = data.get('rates', {})
        date = data.get('date', datetime.now().strftime('%Y-%m-%d'))

        for target in FRANKFURTER_TARGETS:
            if target in rates:
                rate = float(rates[target])
                if rate > 0:
                    results.append({
                        'base': FRANKFURTER_BASE,
                        'target': target,
                        'rate': rate,
                        'date': date,
                    })
                    log(f"  ✅ {FRANKFURTER_BASE}/{target}: {rate:.4f}")
        return results
    except Exception as e:
        log(f"  ❌ frankfurter.dev خطأ: {e}", 'ERROR')
        return []


# ============================================================================
# 3. CoinGecko — الكريبتو (اختبار)
# ============================================================================

def test_coingecko() -> bool:
    """اختبار أن CoinGecko يعمل بشكل صحيح"""
    try:
        coins_str = ','.join(COINGECKO_COINS)
        url = f"{COINGECKO_URL}?ids={coins_str}&vs_currencies=usd"
        req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
        with urllib.request.urlopen(req, timeout=10) as resp:
            data = json.loads(resp.read().decode())

        for coin in COINGECKO_COINS:
            if coin in data:
                price = data[coin].get('usd', 0)
                if price and price > 0:
                    log(f"  ✅ CoinGecko {coin}: ${price:.2f}")
                else:
                    log(f"  ⚠️ CoinGecko {coin}: سعر = 0")
                    return False
            else:
                log(f"  ⚠️ CoinGecko {coin}: غير موجود في الاستجابة")
                return False
        return True
    except Exception as e:
        log(f"  ❌ CoinGecko خطأ: {e}", 'ERROR')
        return False


# ============================================================================
# 4. كتابة البيانات في data_engine.db
# ============================================================================

def save_metals_to_db(metals: list):
    """حفظ المعادن في data_engine.db.gold_prices + silver_prices"""
    if not metals or DRY_RUN:
        return 0

    try:
        conn = sqlite3.connect(str(DB_PATH))
        cur = conn.cursor()
        now_iso = datetime.now().isoformat()

        saved = 0
        for m in metals:
            metal_name = m['metal']
            price_usd = m['price_usd']

            if metal_name == 'gold':
                # تحويل من troy ounce إلى gram (1 toz = 31.1035g)
                price_per_gram_usd = price_usd / 31.1035
                # حفظ في gold_prices
                cur.execute("""
                    INSERT OR REPLACE INTO gold_prices (timestamp, karat, price_per_gram, price_per_ounce, currency)
                    VALUES (?, '24k', ?, ?, 'USD')
                """, (now_iso, price_per_gram_usd, price_usd))
                saved += 1
            elif metal_name == 'silver':
                price_per_gram_usd = price_usd / 31.1035
                cur.execute("""
                    INSERT OR REPLACE INTO silver_prices (timestamp, price_per_gram, price_per_ounce, currency)
                    VALUES (?, ?, ?, 'USD')
                """, (now_iso, price_per_gram_usd, price_usd))
                saved += 1

        conn.commit()
        conn.close()
        return saved
    except Exception as e:
        log(f"  ❌ حفظ المعادن: {e}", 'ERROR')
        return 0


def save_forex_to_db(forex: list):
    """حفظ العملات في data_engine.db.exchange_rates"""
    if not forex or DRY_RUN:
        return 0

    try:
        conn = sqlite3.connect(str(DB_PATH))
        cur = conn.cursor()
        now_iso = datetime.now().isoformat()

        saved = 0
        for f in forex:
            cur.execute("""
                INSERT OR REPLACE INTO exchange_rates (timestamp, base_currency, target_currency, rate, date)
                VALUES (?, ?, ?, ?, ?)
            """, (now_iso, f['base'], f['target'], f['rate'], f['date']))
            saved += 1

        conn.commit()
        conn.close()
        return saved
    except Exception as e:
        log(f"  ❌ حفظ العملات: {e}", 'ERROR')
        return 0


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
    log("=" * 60)
    log("1️⃣ metals.dev — الذهب/الفضة/البلاتين/النحاس")
    log("=" * 60)
    metals = fetch_metals_from_metals_dev()
    if not metals:
        # Fallback: استخدم الذهب الموجود من Daleelak
        gold_data = fetch_gold_from_egksco_or_daleelak()
        if gold_data:
            log(f"  📋 Fallback: ذهب 24k من Daleelak: {gold_data['price_per_gram_24k']:.2f} ج.م/جرام")
        else:
            log("  ⚠️ لا توجد بيانات معادن إطلاقًا")
    else:
        saved = save_metals_to_db(metals)
        log(f"  ✅ تم حفظ {saved} معدن في data_engine.db")

    # 2. frankfurter.dev
    log("")
    log("=" * 60)
    log("2️⃣ frankfurter.dev — العملات (بنك مركزي أوروبي)")
    log("=" * 60)
    forex = fetch_forex_from_frankfurter()
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
