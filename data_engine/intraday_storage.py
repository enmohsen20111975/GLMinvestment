#!/usr/bin/env python3
"""
Intraday Storage Module (v2 - Multi-Asset)
==========================================
نظام تخزين بيانات intraday للرسوم البيانية - يدعم 3 أنواع أصول.

قاعدة بيانات منفصلة: intraday.db (معزولة عن data_engine.db)

الجداول:
  1. stock_intraday      - أسهم (EGX, TADAWUL, KSE, QSE) - أثناء التداول فقط
  2. crypto_intraday     - عملات رقمية - 24/7
  3. commodity_intraday  - ذهب/فضة/نفط/فوركس - 24/5

Smart Dedup (معالجة تأخير المصدر 15 دقيقة):
  - نخزّن صف جديد فقط لما:
      * السعر يتغير >0.01%  OR
      * عدّت 15 دقيقة على آخر تخزين (checkpoint إجباري)
  - ده بيوفّر ~66% من المساحة وبيعطي بيانات أنظف

الاحتفاظ: 7 أيام لكل الجداول
الفترات: 1d (يوم), 1w (أسبوع), 1m (شهر - بيانات يومية fallback)
"""

import sqlite3
import os
import sys
from datetime import datetime, timedelta
from pathlib import Path

# ============================================================================
# PATHS - same resolution as data_engine/main.py
# ============================================================================
PROJECT_ROOT = Path(__file__).parent.parent  # resolved dynamically
DB_DIR = PROJECT_ROOT / 'db'
DB_DIR.mkdir(parents=True, exist_ok=True)

INTRADAY_DB = str(DB_DIR / 'intraday.db')          # NEW - separate database
DATA_ENGINE_DB = str(DB_DIR / 'data_engine.db')    # source: stocks + crypto + metals
STOCKS_DB = str(DB_DIR / 'stocks.db')              # source: daily history (fallback)

# ============================================================================
# CONFIG
# ============================================================================
RETENTION_DAYS = 30

# Smart dedup thresholds
DEDUP_MAX_GAP_SECONDS = 15 * 60      # 15 min checkpoint (matches source delay)
DEDUP_MIN_CHANGE_PCT = 0.01          # 0.01% - skip float noise

# Asset type detection by symbol patterns
CRYPTO_SYMBOLS = {'BTC', 'ETH', 'BNB', 'SOL', 'XRP', 'ADA', 'DOGE', 'DOT', 'AVAX',
                  'MATIC', 'LINK', 'TON', 'SHIB', 'LTC', 'BCH', 'UNI', 'ATOM',
                  'XLM', 'ETC', 'FIL', 'HBAR', 'ARB', 'OP', 'APT', 'NEAR', 'INJ',
                  'SUI', 'SEI', 'TIA', 'ORDI', 'PEPE', 'WLD', 'RNDR', 'GRT', 'AAVE'}
COMMODITY_SYMBOLS = {'GOLD', 'XAU', 'SILVER', 'XAG', 'OIL', 'WTI', 'BRENT',
                     'EUR_USD', 'GBP_USD', 'USD_JPY', 'USD_EGP', 'SAR_USD'}


_intraday_initialized = False

# ============================================================================
# DATABASE INITIALIZATION
# ============================================================================
def init_intraday_db():
    """إنشاء قاعدة بيانات intraday.db وجداولها الثلاثة (مرة واحدة فقط)"""
    global _intraday_initialized
    if _intraday_initialized:
        return
    conn = sqlite3.connect(INTRADAY_DB, timeout=30.0)
    try:
        conn.execute('PRAGMA journal_mode=WAL')
        conn.execute('PRAGMA busy_timeout=30000')
    except Exception:
        pass
    c = conn.cursor()

    # 1. STOCK INTRADAY - أسهم كل الأسواق
    c.execute('''
        CREATE TABLE IF NOT EXISTS stock_intraday (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            ticker TEXT NOT NULL,
            market TEXT,
            timestamp TEXT NOT NULL,
            price REAL NOT NULL,
            change_percent REAL DEFAULT 0,
            volume INTEGER DEFAULT 0,
            open REAL DEFAULT 0,
            high REAL DEFAULT 0,
            low REAL DEFAULT 0,
            buy_volume INTEGER DEFAULT 0,
            sell_volume INTEGER DEFAULT 0,
            delta_volume INTEGER DEFAULT 0,
            delta_pct REAL DEFAULT 0,
            pressure TEXT DEFAULT NULL,
            UNIQUE(ticker, timestamp)
        )
    ''')
    for _col, _ctype in [
        ('buy_volume', 'INTEGER DEFAULT 0'),
        ('sell_volume', 'INTEGER DEFAULT 0'),
        ('delta_volume', 'INTEGER DEFAULT 0'),
        ('delta_pct', 'REAL DEFAULT 0'),
        ('pressure', 'TEXT DEFAULT NULL'),
    ]:
        try:
            c.execute(f'ALTER TABLE stock_intraday ADD COLUMN {_col} {_ctype}')
        except Exception:
            pass
    c.execute('CREATE INDEX IF NOT EXISTS idx_stock_ticker_ts ON stock_intraday(ticker, timestamp)')
    c.execute('CREATE INDEX IF NOT EXISTS idx_stock_ts ON stock_intraday(timestamp)')
    c.execute('CREATE INDEX IF NOT EXISTS idx_stock_market ON stock_intraday(market)')

    # 2. CRYPTO INTRADAY - عملات رقمية (24/7)
    c.execute('''
        CREATE TABLE IF NOT EXISTS crypto_intraday (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            symbol TEXT NOT NULL,
            name TEXT,
            timestamp TEXT NOT NULL,
            price_usd REAL NOT NULL,
            change_24h REAL DEFAULT 0,
            volume_24h REAL DEFAULT 0,
            market_cap REAL DEFAULT 0,
            UNIQUE(symbol, timestamp)
        )
    ''')
    c.execute('CREATE INDEX IF NOT EXISTS idx_crypto_symbol_ts ON crypto_intraday(symbol, timestamp)')
    c.execute('CREATE INDEX IF NOT EXISTS idx_crypto_ts ON crypto_intraday(timestamp)')

    # 3. COMMODITY INTRADAY - ذهب/فضة/نفط/فوركس
    c.execute('''
        CREATE TABLE IF NOT EXISTS commodity_intraday (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            symbol TEXT NOT NULL,
            timestamp TEXT NOT NULL,
            price REAL NOT NULL,
            change_percent REAL DEFAULT 0,
            unit TEXT,
            UNIQUE(symbol, timestamp)
        )
    ''')
    c.execute('CREATE INDEX IF NOT EXISTS idx_comm_symbol_ts ON commodity_intraday(symbol, timestamp)')
    c.execute('CREATE INDEX IF NOT EXISTS idx_comm_ts ON commodity_intraday(timestamp)')

    # 4. META TABLE - tracking
    c.execute('''
        CREATE TABLE IF NOT EXISTS intraday_meta (
            key TEXT PRIMARY KEY,
            value TEXT
        )
    ''')

    # Set default meta
    c.execute('''INSERT OR IGNORE INTO intraday_meta (key, value) VALUES (?, ?)''',
              ('retention_days', str(RETENTION_DAYS)))
    c.execute('''INSERT OR IGNORE INTO intraday_meta (key, value) VALUES (?, ?)''',
              ('created_at', datetime.now().isoformat()))

    conn.commit()
    conn.close()


# ============================================================================
# SMART DEDUP - معالجة تأخير المصدر 15 دقيقة
# ============================================================================
def _should_store(conn, table, symbol_col, price_col, symbol, new_price, now_iso):
    """
    فحص ذكي: هل نخزّن صف جديد أم نتجاهله (duplicate)؟

    القاعدة:
      - نخزن لو السعر اتغير >0.01% من آخر قيمة
      - أو لو عدّت 15 دقيقة على آخر تخزين (checkpoint)
      - وإلا نتجاهل (السعر ثابت + أقل من 15 دقيقة = duplicate من تأخير المصدر)

    Args:
        conn: intraday db connection
        table: 'stock_intraday' | 'crypto_intraday' | 'commodity_intraday'
        symbol_col: 'ticker' | 'symbol'
        price_col: 'price' | 'price_usd'
        symbol: the ticker/symbol value
        new_price: the new price to potentially store
        now_iso: current ISO timestamp
    """
    c = conn.cursor()
    c.execute(f'''
        SELECT timestamp, {price_col} FROM {table}
        WHERE {symbol_col} = ?
        ORDER BY timestamp DESC LIMIT 1
    ''', (symbol,))
    row = c.fetchone()

    if not row:
        return True  # أول سجل لهذا الرمز

    try:
        last_ts = datetime.fromisoformat(row[0])
        last_price = float(row[1] or 0)
        now = datetime.fromisoformat(now_iso)
    except (ValueError, TypeError):
        return True  # لو في مشكلة في الـ parsing، خزّن

    # Checkpoint: لو عدّت 15 دقيقة، خزّن حتى لو السعر ثابت
    gap_seconds = (now - last_ts).total_seconds()
    if gap_seconds >= DEDUP_MAX_GAP_SECONDS:
        return True

    # Price change: لو السعر اتغير >0.01%
    if last_price > 0 and new_price > 0:
        change_pct = abs(new_price - last_price) / last_price * 100
        if change_pct >= DEDUP_MIN_CHANGE_PCT:
            return True

    return False  # duplicate - تجاهل


def _update_meta(conn, key, value):
    """تحديث مفتاح في جدول meta"""
    c = conn.cursor()
    c.execute('''INSERT OR REPLACE INTO intraday_meta (key, value) VALUES (?, ?)''',
              (key, str(value)))


# ============================================================================
# STOCKS SNAPSHOT - أسهم كل الأسواق
# ============================================================================
def store_stocks_snapshot():
    """
    حفظ لقطة أسعار الأسهم في stock_intraday.
    تُستدعى كل 5 دقائق أثناء التداول فقط (الـ scheduler بيحكم الميعاد).
    """
    init_intraday_db()
    if not os.path.exists(DATA_ENGINE_DB):
        print("[Intraday] data_engine.db not found - skipping stocks snapshot")
        return 0

    now_iso = datetime.now().isoformat()
    stored = 0
    skipped = 0

    # قراءة الأسعار من data_engine.db
    de_conn = sqlite3.connect(DATA_ENGINE_DB)
    de_conn.row_factory = sqlite3.Row
    de_c = de_conn.cursor()

    intraday_conn = sqlite3.connect(INTRADAY_DB)
    intraday_conn.row_factory = sqlite3.Row
    ic = intraday_conn.cursor()

    try:
        de_c.execute('''
            SELECT symbol, price, change_percent, volume, market
            FROM stocks
            WHERE price IS NOT NULL AND price > 0
        ''')
        stocks = de_c.fetchall()

        for stock in stocks:
            try:
                price = float(stock['price'] or 0)
                if price <= 0:
                    continue

                change = 0.0
                try:
                    change = float(stock['change_percent'] or 0)
                except (ValueError, TypeError):
                    pass

                volume = 0
                try:
                    vol_str = str(stock['volume'] or '0')
                    vol_str = vol_str.replace(',', '').replace('M', '').replace('B', '').strip()
                    volume = int(float(vol_str)) if vol_str else 0
                except (ValueError, TypeError):
                    pass

                # Smart dedup check
                if not _should_store(intraday_conn, 'stock_intraday', 'ticker', 'price',
                                     stock['symbol'], price, now_iso):
                    skipped += 1
                    continue

                # Delta Volume Calculation (DNA-WINNER: buy/sell pressure)
                # Calculated at write-time so it's always available
                _buy_vol = 0
                _sell_vol = 0
                _delta_vol = 0
                _delta_pct = 0.0
                _pressure = 'NEUTRAL'
                _stock_d = dict(stock)
                _open_val = float(_stock_d.get('open') or 0) or price
                _high_val = float(_stock_d.get('high') or 0) or price
                _low_val = float(_stock_d.get('low') or 0) or price
                if volume > 0 and _high_val > _low_val:
                    _buy_ratio = max(0.0, min(1.0, (price - _low_val) / (_high_val - _low_val)))
                    _buy_vol = int(volume * _buy_ratio)
                    _sell_vol = volume - _buy_vol
                    _delta_vol = _buy_vol - _sell_vol
                    _delta_pct = round((_delta_vol / volume) * 100, 2)
                    if _delta_pct > 30:
                        _pressure = 'STRONG_BUY'
                    elif _delta_pct > 10:
                        _pressure = 'BUY'
                    elif _delta_pct < -30:
                        _pressure = 'STRONG_SELL'
                    elif _delta_pct < -10:
                        _pressure = 'SELL'

                ic.execute('''
                    INSERT OR REPLACE INTO stock_intraday
                    (ticker, market, timestamp, price, change_percent, volume,
                     buy_volume, sell_volume, delta_volume, delta_pct, pressure)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ''', (
                    stock['symbol'],
                    stock['market'] or 'UNKNOWN',
                    now_iso,
                    price,
                    change,
                    volume,
                    _buy_vol,
                    _sell_vol,
                    _delta_vol,
                    _delta_pct,
                    _pressure,
                ))
                stored += 1
            except Exception as e:
                pass

        intraday_conn.commit()
        _update_meta(intraday_conn, 'last_stocks_snapshot', now_iso)
        _update_meta(intraday_conn, 'last_stocks_count', stored)
    except Exception as e:
        print(f"[Intraday] Stocks snapshot error: {e}")
    finally:
        de_conn.close()
        intraday_conn.close()

    print(f"[Intraday] Stocks: stored={stored}, skipped(dup)={skipped} at {now_iso}")
    return stored


# ============================================================================
# CRYPTO SNAPSHOT - عملات رقمية (24/7)
# ============================================================================
def store_crypto_snapshot():
    """
    حفظ لقطة العملات الرقمية في crypto_intraday.
    تُستدعى كل 10 دقائق طوال اليوم (24/7).
    """
    init_intraday_db()
    if not os.path.exists(DATA_ENGINE_DB):
        print("[Intraday] data_engine.db not found - skipping crypto snapshot")
        return 0

    now_iso = datetime.now().isoformat()
    stored = 0
    skipped = 0

    de_conn = sqlite3.connect(DATA_ENGINE_DB)
    de_conn.row_factory = sqlite3.Row
    intraday_conn = sqlite3.connect(INTRADAY_DB)

    try:
        de_c = de_conn.cursor()
        # Get only the LATEST snapshot (crypto_prices stores historical snapshots)
        de_c.execute('''
            SELECT symbol, name, price_usd, price_change_24h, total_volume, market_cap
            FROM crypto_prices
            WHERE timestamp = (SELECT MAX(timestamp) FROM crypto_prices)
              AND price_usd IS NOT NULL AND price_usd > 0
        ''')
        cryptos = de_c.fetchall()

        ic = intraday_conn.cursor()

        for crypto in cryptos:
            try:
                price = float(crypto['price_usd'] or 0)
                if price <= 0:
                    continue

                # Smart dedup check
                if not _should_store(intraday_conn, 'crypto_intraday', 'symbol', 'price_usd',
                                     crypto['symbol'], price, now_iso):
                    skipped += 1
                    continue

                ic.execute('''
                    INSERT OR REPLACE INTO crypto_intraday
                    (symbol, name, timestamp, price_usd, change_24h, volume_24h, market_cap)
                    VALUES (?, ?, ?, ?, ?, ?, ?)
                ''', (
                    crypto['symbol'],
                    crypto['name'] or crypto['symbol'],
                    now_iso,
                    price,
                    float(crypto['price_change_24h'] or 0),
                    float(crypto['total_volume'] or 0),
                    float(crypto['market_cap'] or 0),
                ))
                stored += 1
            except Exception:
                pass

        intraday_conn.commit()
        _update_meta(intraday_conn, 'last_crypto_snapshot', now_iso)
        _update_meta(intraday_conn, 'last_crypto_count', stored)
    except Exception as e:
        print(f"[Intraday] Crypto snapshot error: {e}")
    finally:
        de_conn.close()
        intraday_conn.close()

    print(f"[Intraday] Crypto: stored={stored}, skipped(dup)={skipped} at {now_iso}")
    return stored


# ============================================================================
# COMMODITIES SNAPSHOT - ذهب/فضة/نفط/فوركس
# ============================================================================
def store_commodities_snapshot():
    """
    حفظ لقطة المعادن والفوركس في commodity_intraday.
    تُستدعى كل 15 دقيقة.
    """
    init_intraday_db()
    if not os.path.exists(DATA_ENGINE_DB):
        print("[Intraday] data_engine.db not found - skipping commodities snapshot")
        return 0

    now_iso = datetime.now().isoformat()
    stored = 0
    skipped = 0

    de_conn = sqlite3.connect(DATA_ENGINE_DB)
    de_conn.row_factory = sqlite3.Row
    intraday_conn = sqlite3.connect(INTRADAY_DB)

    try:
        de_c = de_conn.cursor()
        ic = intraday_conn.cursor()

        # Country code mapping (Arabic → ISO code)
        COUNTRY_CODES = {
            'مصر': 'EG', 'السعودية': 'SA', 'الإمارات': 'AE', 'الأردن': 'JO',
            'الكويت': 'KW', 'قطر': 'QA', 'البحرين': 'BH', 'عمان': 'OM',
            'تركيا': 'TR', 'العراق': 'IQ', 'تونس': 'TN', 'لبنان': 'LB',
            'المغرب': 'MA', 'السودان': 'SD', 'اليمن': 'YE', 'سوريا': 'SY',
            'ليبيا': 'LY', 'فلسطين': 'PS', 'موريتانيا': 'MR', 'جيبوتي': 'DJ',
            'الصومال': 'SO', 'جزر القمر': 'KM',
        }
        # Karat normalization (Arabic → English)
        def _norm_karat(k):
            if not k:
                return '24K'
            k = str(k).strip()
            # Extract number from "عيار 21" or "21"
            import re
            m = re.search(r'(\d+)', k)
            return f'{m.group(1)}K' if m else '24K'

        # 1. GOLD - ذهب لكل دولة وعيار (بدون مصنعية/دمغة من gold_prices_clean)
        try:
            # Try clean prices first (بدون مصنعية/دمغة)
            de_c.execute('''
                SELECT country, karat, currency, price_per_gram, usd_rate_used, global_ounce_usd
                FROM gold_prices_clean
                WHERE timestamp = (SELECT MAX(timestamp) FROM gold_prices_clean)
                  AND price_per_gram IS NOT NULL AND price_per_gram > 0
            ''')
            gold_rows = de_c.fetchall()
            
            # Fallback: لو مفيش بيانات في gold_prices_clean, استخدم gold_prices القديم
            if not gold_rows:
                de_c.execute('''
                    SELECT country, karat, currency, price_per_gram, price_per_ounce
                    FROM gold_prices
                    WHERE timestamp = (SELECT MAX(timestamp) FROM gold_prices)
                      AND price_per_gram IS NOT NULL AND price_per_gram > 0
                ''')
                gold_rows = de_c.fetchall()
            
            for row in gold_rows:
                country = row['country'] or 'UNKNOWN'
                cc = COUNTRY_CODES.get(country, country[:2].upper())
                karat = _norm_karat(row['karat'])
                price = float(row['price_per_gram'] or 0)
                if price <= 0:
                    continue
                currency = row['currency'] or 'LOCAL'
                symbol = f'GOLD_{cc}_{karat}'

                if not _should_store(intraday_conn, 'commodity_intraday', 'symbol', 'price',
                                     symbol, price, now_iso):
                    skipped += 1
                    continue

                ic.execute('''
                    INSERT OR REPLACE INTO commodity_intraday
                    (symbol, timestamp, price, change_percent, unit)
                    VALUES (?, ?, ?, 0, ?)
                ''', (symbol, now_iso, price, f'{currency}/gram'))
                stored += 1
        except Exception as e:
            print(f"[Intraday] Gold error: {e}")

        # 2. SILVER - فضة (أحدث snapshot)
        try:
            de_c.execute('''
                SELECT country, currency, price_per_gram, price_per_ounce
                FROM silver_prices
                WHERE timestamp = (SELECT MAX(timestamp) FROM silver_prices)
                  AND price_per_gram IS NOT NULL AND price_per_gram > 0
            ''')
            for row in de_c.fetchall():
                country = row['country'] or 'UNKNOWN'
                cc = COUNTRY_CODES.get(country, country[:2].upper())
                price = float(row['price_per_ounce'] or row['price_per_gram'] or 0)
                if price <= 0:
                    continue
                currency = row['currency'] or 'LOCAL'
                symbol = f'SILVER_{cc}'

                if _should_store(intraday_conn, 'commodity_intraday', 'symbol', 'price',
                                 symbol, price, now_iso):
                    ic.execute('''
                        INSERT OR REPLACE INTO commodity_intraday
                        (symbol, timestamp, price, change_percent, unit)
                        VALUES (?, ?, ?, 0, ?)
                    ''', (symbol, now_iso, price, f'{currency}/oz'))
                    stored += 1
                else:
                    skipped += 1
        except Exception:
            pass

        # 4. EXCHANGE RATES - الفوركس (أحدث snapshot)
        try:
            # Get latest row from exchange_rates
            de_c.execute('''
                SELECT * FROM exchange_rates
                ORDER BY id DESC LIMIT 1
            ''')
            row = de_c.fetchone()
            if row:
                cols = [desc[0] for desc in de_c.description] if de_c.description else []
                for col in cols:
                    if col.lower() in ('id', 'timestamp', 'date', 'updated_at'):
                        continue
                    try:
                        price = float(row[col] or 0)
                        if price <= 0:
                            continue
                        symbol = col.upper()
                        if _should_store(intraday_conn, 'commodity_intraday', 'symbol', 'price',
                                         symbol, price, now_iso):
                            ic.execute('''
                                INSERT OR REPLACE INTO commodity_intraday
                                (symbol, timestamp, price, change_percent, unit)
                                VALUES (?, ?, ?, 0, ?)
                            ''', (symbol, now_iso, price, 'rate'))
                            stored += 1
                        else:
                            skipped += 1
                    except (ValueError, TypeError):
                        pass
        except Exception:
            pass

        intraday_conn.commit()
        _update_meta(intraday_conn, 'last_commodity_snapshot', now_iso)
        _update_meta(intraday_conn, 'last_commodity_count', stored)
    except Exception as e:
        print(f"[Intraday] Commodities snapshot error: {e}")
    finally:
        de_conn.close()
        intraday_conn.close()

    print(f"[Intraday] Commodities: stored={stored}, skipped(dup)={skipped} at {now_iso}")
    return stored


# ============================================================================
# MASTER SNAPSHOT - collects all 3 asset types
# ============================================================================
def store_intraday_snapshot():
    """
    حفظ لقطات الـ 3 أنواع أصول مرة واحدة.
    تُستدعى من الـ scheduler القديم (backward compatible).
    """
    total = 0
    total += store_stocks_snapshot()
    total += store_crypto_snapshot()
    total += store_commodities_snapshot()
    # Cleanup after each batch
    cleanup_old_data()
    return total


# ============================================================================
# CLEANUP - 7-day retention
# ============================================================================
def cleanup_old_data():
    """حذف البيانات الأقدم من RETENTION_DAYS من كل الجداول"""
    cutoff = (datetime.now() - timedelta(days=RETENTION_DAYS)).isoformat()
    total_deleted = 0

    try:
        conn = sqlite3.connect(INTRADAY_DB)
        c = conn.cursor()

        for table in ['stock_intraday', 'crypto_intraday', 'commodity_intraday']:
            c.execute(f'DELETE FROM {table} WHERE timestamp < ?', (cutoff,))
            total_deleted += c.rowcount

        conn.commit()
        conn.close()

        if total_deleted > 0:
            print(f"[Intraday] Cleaned up {total_deleted} old records (older than {RETENTION_DAYS} days)")
            # Vacuum occasionally to reclaim space
            try:
                conn = sqlite3.connect(INTRADAY_DB)
                conn.execute('PRAGMA optimize')
                conn.close()
            except Exception:
                pass

        _update_meta_safe('last_cleanup', datetime.now().isoformat())
    except Exception as e:
        print(f"[Intraday] Cleanup error: {e}")


def _update_meta_safe(key, value):
    """Update meta with error handling"""
    try:
        conn = sqlite3.connect(INTRADAY_DB)
        c = conn.cursor()
        c.execute('''INSERT OR REPLACE INTO intraday_meta (key, value) VALUES (?, ?)''',
                  (key, str(value)))
        conn.commit()
        conn.close()
    except Exception:
        pass


# ============================================================================
# DATA RETRIEVAL - for chart API
# ============================================================================
def _detect_asset_type(ticker):
    """كشف نوع الأصل من الرمز"""
    upper = ticker.upper()
    # Strip market suffixes (e.g., COMI.CA → COMI)
    base = upper.split('.')[0]

    if base in CRYPTO_SYMBOLS:
        return 'crypto'
    if base in COMMODITY_SYMBOLS or base.startswith('GOLD_') or base.startswith('SILVER_'):
        return 'commodity'
    return 'stock'


def _normalize_ticker(ticker, asset):
    """
    تطبيع الرمز للبحث في قاعدة البيانات.
    - الأسهم: نشيل suffixes زي .CA, .SR, .KW, .QA مع دعم الأسماء البديلة (مثل KORRA -> KORA)
    - العملات والسلع: بنستخدم الرمز كما هو
    """
    upper = ticker.upper().strip()
    if asset == 'stock':
        clean = upper.split('.')[0]
        aliases = {'KORRA': 'KORA', 'COMMI': 'COMI'}
        if clean in aliases:
            return aliases[clean]
        try:
            import re
            conn = sqlite3.connect(INTRADAY_DB)
            row = conn.execute("SELECT ticker FROM stock_intraday WHERE ticker = ? LIMIT 1", (clean,)).fetchone()
            if row:
                conn.close()
                return row[0]
            dedup = re.sub(r'(.)\1+', r'\1', clean)
            row = conn.execute("SELECT ticker FROM stock_intraday WHERE ticker = ? LIMIT 1", (dedup,)).fetchone()
            conn.close()
            if row:
                return row[0]
        except Exception:
            pass
        return clean
    return upper


def get_intraday_data(ticker, period='1w', asset=None):
    """
    الحصول على بيانات intraday لرمز معين.

    Args:
        ticker: رمز السهم/العملة/السلعة
        period: '1d' (يوم), '1w' (أسبوع), '1m' (شهر)
        asset: 'stock' | 'crypto' | 'commodity' (auto-detect if None)

    Returns:
        list of {timestamp, price, change_percent, volume, [open/high/low]}
    """
    if asset is None:
        asset = _detect_asset_type(ticker)

    lookup_ticker = _normalize_ticker(ticker, asset)

    # Per-asset table + column mapping (different schemas!)
    table_map = {
        'stock': {
            'table': 'stock_intraday',
            'sym_col': 'ticker',
            'price_col': 'price',
            'change_col': 'change_percent',
            'volume_col': 'volume',
        },
        'crypto': {
            'table': 'crypto_intraday',
            'sym_col': 'symbol',
            'price_col': 'price_usd',
            'change_col': 'change_24h',
            'volume_col': 'volume_24h',
        },
        'commodity': {
            'table': 'commodity_intraday',
            'sym_col': 'symbol',
            'price_col': 'price',
            'change_col': 'change_percent',
            'volume_col': None,  # no volume for commodities
        },
    }

    cfg = table_map.get(asset, table_map['stock'])
    table = cfg['table']
    sym_col = cfg['sym_col']
    price_col = cfg['price_col']
    change_col = cfg['change_col']
    volume_col = cfg['volume_col']

    # For 1d, 1w, 1m: Determine cutoff based on anchor timestamp (latest recorded
    # snapshot for the ticker) so that if market is closed, on weekend, or holiday,
    # we return the latest available trading session rather than an empty array.
    conn = sqlite3.connect(INTRADAY_DB, timeout=30.0)
    conn.row_factory = sqlite3.Row
    try:
        conn.execute('PRAGMA busy_timeout=30000')
    except Exception:
        pass
    c = conn.cursor()

    anchor_dt = datetime.now()
    try:
        max_row = c.execute(f"SELECT max(timestamp) FROM {table} WHERE {sym_col} = ?", (lookup_ticker,)).fetchone()
        if max_row and max_row[0]:
            clean_max = str(max_row[0]).replace('+00:00', '').replace('+03:00', '').split('+')[0].strip()
            for fmt in ('%Y-%m-%dT%H:%M:%S.%f', '%Y-%m-%dT%H:%M:%S', '%Y-%m-%d %H:%M:%S'):
                try:
                    anchor_dt = datetime.strptime(clean_max, fmt)
                    break
                except ValueError:
                    continue
    except Exception:
        pass

    if period == '1d':
        cutoff = (anchor_dt - timedelta(hours=24)).isoformat()
    elif period == '1w':
        cutoff = (anchor_dt - timedelta(days=7)).isoformat()
    else:  # 1m
        cutoff = (anchor_dt - timedelta(days=35)).isoformat()

    # Build SELECT with COALESCE for missing volume column
    volume_expr = f'{volume_col}' if volume_col else '0'
    result = []

    try:
        c = conn.cursor()
        # ANTI-GAP-056: For stocks, filter out weekends (Fri/Sat = 5,6 in strftime %w)
        # to eliminate chart gaps. Weekend filtering works regardless of timezone.
        # Hour filtering is done in Python below (SQLite strftime returns UTC hours
        # which shifts Cairo 9-14h to 6-11h, so we parse properly in Python).
        if asset == 'stock':
            c.execute(f'''
                SELECT timestamp, {price_col} as price, {change_col} as change_percent,
                       {volume_expr} as volume
                FROM {table}
                WHERE {sym_col} = ? AND timestamp >= ?
                  AND CAST(strftime('%w', timestamp) AS INTEGER) NOT IN (5, 6)
                ORDER BY timestamp ASC
            ''', (lookup_ticker, cutoff))
        else:
            c.execute(f'''
                SELECT timestamp, {price_col} as price, {change_col} as change_percent,
                       {volume_expr} as volume
                FROM {table}
                WHERE {sym_col} = ? AND timestamp >= ?
                ORDER BY timestamp ASC
            ''', (lookup_ticker, cutoff))

        for row in c.fetchall():
            # ANTI-GAP-056: Convert TEXT timestamp to UNIX seconds (int) so
            # lightweight-charts renders continuous candles without gaps.
            raw_ts = row['timestamp']
            unix_ts = _to_unix_seconds(raw_ts)

            # ANTI-GAP-056 + REAL-DB-060: For stocks, apply market-hours filter.
            # The DB has MIXED timezone formats:
            #   - '2026-07-20T10:00:00+03:00' → Cairo time (has tz)
            #   - '2026-07-20T06:05:48'       → ??? (naive, no tz)
            # Analysis of the data shows:
            #   - Timestamps WITH +03:00: hour in string IS Cairo (10:00 = 10AM Cairo)
            #   - Naive timestamps on 2026-07-20 start at 06:05 → if Cairo, that's before
            #     market open (9:00). If UTC, that's 9:05 Cairo = market open!
            #   → Naive timestamps are UTC! Convert +3 for Cairo hour.
            #   - But naive timestamps on 2026-07-21 start at 10:58 → if UTC, that's 13:58
            #     Cairo (1PM, market hours). If Cairo, that's 10:58 AM (also market hours).
            #   → Both interpretations overlap for midday, so UTC is the safer assumption.
            if asset == 'stock' and unix_ts > 0:
                _raw_str = str(raw_ts)
                _cairo_hour = None

                # Case 1: Timestamp with explicit timezone (e.g. +03:00)
                # → the hour in the string IS the Cairo hour
                if '+' in _raw_str and ('T' in _raw_str or ' ' in _raw_str):
                    try:
                        _time_part = _raw_str.split('T')[1].split(' ')[0][:8] if 'T' in _raw_str else _raw_str.split(' ')[1][:8]
                        _cairo_hour = int(_time_part[:2])
                    except (ValueError, IndexError):
                        pass
                # Case 2: Naive timestamp (no tz) → treat as UTC, convert +3 for Cairo
                else:
                    try:
                        _time_part = _raw_str.split('T')[1].split(' ')[0][:8] if 'T' in _raw_str else _raw_str.split(' ')[1][:8]
                        _utc_hour = int(_time_part[:2])
                        _cairo_hour = (_utc_hour + 3) % 24
                    except (ValueError, IndexError):
                        pass

                # Apply market-hours filter (Cairo 9:00-14:59)
                # DYNAMIC-061: Relax to 9-15 to include the 14:xx candles (market
                # closes at 14:30 but last candles can be at 14:50)
                if _cairo_hour is not None:
                    if _cairo_hour < 9 or _cairo_hour > 15:
                        continue
                # If we couldn't parse the hour, keep the candle (don't drop unknowns)

            result.append({
                'timestamp': unix_ts,
                'timestamp_raw': raw_ts,  # keep original for debugging
                'price': float(row['price'] or 0),
                'change_percent': float(row['change_percent'] or 0),
                'volume': int(row['volume'] or 0),
                'source': 'intraday',
            })
    except Exception as e:
        print(f"[Intraday] Read error: {e}")
    finally:
        conn.close()

    # ANTI-SILENT-FALLBACK-055: Do NOT silently fall back to daily data.
    # If there's no intraday data, return empty list so the frontend shows
    # a clear error instead of drawing daily candles disguised as intraday.
    if len(result) == 0:
        print(f"[Intraday] No intraday data for {ticker} ({asset}) — returning empty (no silent fallback)")
        return []

    return result


def _to_unix_seconds(raw_ts):
    """
    ANTI-GAP-056: Convert any timestamp format to UNIX seconds (int).
    Handles ISO format (2026-07-24 10:15:00), ISO with T, and already-numeric.
    Returns int seconds (UTC) — lightweight-charts expects this.
    """
    if raw_ts is None:
        return 0
    # Already numeric? return as int
    if isinstance(raw_ts, (int, float)):
        return int(raw_ts)
    s = str(raw_ts).strip()
    if not s:
        return 0
    # Try numeric string (already UNIX seconds)
    try:
        return int(float(s))
    except ValueError:
        pass
    # Try ISO formats
    # DYNAMIC-061: Treat naive timestamps (no timezone) as UTC explicitly,
    # so the conversion is consistent regardless of server timezone.
    from datetime import datetime as _dt, timezone as _tz
    for fmt in ('%Y-%m-%d %H:%M:%S', '%Y-%m-%dT%H:%M:%S', '%Y-%m-%d %H:%M:%S.%f', '%Y-%m-%dT%H:%M:%S.%f', '%Y-%m-%d'):
        try:
            _parsed = _dt.strptime(s, fmt)
            # If naive, assume UTC
            if _parsed.tzinfo is None:
                _parsed = _parsed.replace(tzinfo=_tz.utc)
            return int(_parsed.timestamp())
        except ValueError:
            continue
    # Last resort: try datetime.fromisoformat
    try:
        from datetime import datetime as _dt
        return int(_dt.fromisoformat(s.replace('Z', '+00:00')).timestamp())
    except Exception:
        return 0


def get_daily_data(ticker, days=30):
    """
    الحصول على بيانات يومية من price_history (fallback).
    يتم تطبيع الرمز تلقائياً (إزالة اللاحقات مثل .CA و .SR) قبل الاستعلام.
    """
    result = []
    
    # تطبيع الرمز: نشيل اللاحقات مثل .CA, .SR, .KW, .QA
    ticker_upper = ticker.upper().strip()
    normalized_ticker = ticker_upper.split('.')[0] if '.' in ticker_upper else ticker_upper
    
    # 1. Try price_history.db first (cleanest data)
    price_history_db = str(DB_DIR / 'price_history.db')
    if os.path.exists(price_history_db):
        try:
            conn = sqlite3.connect(price_history_db)
            conn.row_factory = sqlite3.Row
            c = conn.cursor()
            
            c.execute("PRAGMA table_info(price_history)")
            cols = [row['name'] for row in c.fetchall()]
            
            if cols:
                ticker_col = 'ticker' if 'ticker' in cols else ('symbol' if 'symbol' in cols else cols[0])
                date_col = 'date' if 'date' in cols else ('timestamp' if 'timestamp' in cols else 'date')
                
                # Check column mappings
                p_col = 'close_price' if 'close_price' in cols else ('close' if 'close' in cols else 'close_price')
                o_col = 'open_price' if 'open_price' in cols else ('open' if 'open' in cols else 'open_price')
                h_col = 'high_price' if 'high_price' in cols else ('high' if 'high' in cols else 'high_price')
                l_col = 'low_price' if 'low_price' in cols else ('low' if 'low' in cols else 'low_price')
                v_col = 'volume' if 'volume' in cols else 'volume'
                
                select_cols = [date_col]
                for col in [o_col, h_col, l_col, p_col, v_col]:
                    if col in cols:
                        select_cols.append(col)
                
                col_str = ', '.join(select_cols)
                # استخدام الرمز المطبّع (بدون لاحقة)
                c.execute(f'''
                    SELECT {col_str}
                    FROM price_history
                    WHERE {ticker_col} = ?
                    ORDER BY {date_col} DESC
                    LIMIT ?
                ''', (normalized_ticker, days))
                
                rows = c.fetchall()
                for row in reversed(rows):
                    entry = {
                        'timestamp': row[date_col],
                        'price': float(row[p_col] or 0) if p_col in cols else 0,
                        'open': float(row[o_col] or 0) if o_col in cols else 0,
                        'high': float(row[h_col] or 0) if h_col in cols else 0,
                        'low': float(row[l_col] or 0) if l_col in cols else 0,
                        'volume': int(row[v_col] or 0) if v_col in cols else 0,
                        'change_percent': 0,
                        'source': 'daily',
                    }
                    result.append(entry)
                
                conn.close()
                if result:
                    return result
        except Exception as e:
            print(f"[Intraday] Error reading from price_history.db: {e}")

    # 2. Fallback to stocks.db (stock_price_history table)
    stocks_db = str(DB_DIR / 'stocks.db')
    if os.path.exists(stocks_db):
        try:
            conn = sqlite3.connect(stocks_db)
            conn.row_factory = sqlite3.Row
            c = conn.cursor()
            
            c.execute("PRAGMA table_info(stock_price_history)")
            cols = [row['name'] for row in c.fetchall()]
            
            if cols:
                ticker_col = 'ticker' if 'ticker' in cols else ('symbol' if 'symbol' in cols else cols[0])
                date_col = 'date' if 'date' in cols else ('timestamp' if 'timestamp' in cols else 'date')
                
                p_col = 'close_price' if 'close_price' in cols else ('close' if 'close' in cols else 'close_price')
                o_col = 'open_price' if 'open_price' in cols else ('open' if 'open' in cols else 'open_price')
                h_col = 'high_price' if 'high_price' in cols else ('high' if 'high' in cols else 'high_price')
                l_col = 'low_price' if 'low_price' in cols else ('low' if 'low' in cols else 'low_price')
                v_col = 'volume' if 'volume' in cols else 'volume'
                
                select_cols = [date_col]
                for col in [o_col, h_col, l_col, p_col, v_col]:
                    if col in cols:
                        select_cols.append(col)
                
                col_str = ', '.join(select_cols)
                c.execute(f'''
                    SELECT {col_str}
                    FROM stock_price_history
                    WHERE {ticker_col} = ?
                    ORDER BY {date_col} DESC
                    LIMIT ?
                ''', (normalized_ticker, days))
                
                rows = c.fetchall()
                for row in reversed(rows):
                    entry = {
                        'timestamp': row[date_col],
                        'price': float(row[p_col] or 0) if p_col in cols else 0,
                        'open': float(row[o_col] or 0) if o_col in cols else 0,
                        'high': float(row[h_col] or 0) if h_col in cols else 0,
                        'low': float(row[l_col] or 0) if l_col in cols else 0,
                        'volume': int(row[v_col] or 0) if v_col in cols else 0,
                        'change_percent': 0,
                        'source': 'daily',
                    }
                    result.append(entry)
                conn.close()
        except Exception as e:
            print(f"[Intraday] Fallback stocks.db error: {e}")
            
    return result


# ============================================================================
# STATS - for monitoring
# ============================================================================
def get_intraday_stats():
    """إحصائيات قاعدة بيانات intraday"""
    init_intraday_db()
    stats = {
        'db_path': INTRADAY_DB,
        'retention_days': RETENTION_DAYS,
        'tables': {},
        'meta': {},
    }

    try:
        conn = sqlite3.connect(INTRADAY_DB)
        conn.row_factory = sqlite3.Row
        c = conn.cursor()

        for table in ['stock_intraday', 'crypto_intraday', 'commodity_intraday']:
            try:
                c.execute(f'SELECT COUNT(*) as cnt FROM {table}')
                stats['tables'][table] = c.fetchone()['cnt']

                # Latest timestamp
                c.execute(f'SELECT MAX(timestamp) as latest FROM {table}')
                row = c.fetchone()
                stats['tables'][f'{table}_latest'] = row['latest'] if row else None

                # Distinct symbols
                sym_col = 'ticker' if table == 'stock_intraday' else 'symbol'
                c.execute(f'SELECT COUNT(DISTINCT {sym_col}) as cnt FROM {table}')
                stats['tables'][f'{table}_symbols'] = c.fetchone()['cnt']
            except Exception as e:
                stats['tables'][table] = f'error: {e}'

        # Meta
        c.execute('SELECT key, value FROM intraday_meta')
        for row in c.fetchall():
            stats['meta'][row['key']] = row['value']

        conn.close()
    except Exception as e:
        stats['error'] = str(e)

    return stats


# ============================================================================
# CLI / TESTING
# ============================================================================
if __name__ == '__main__':
    import argparse
    parser = argparse.ArgumentParser(description='Intraday Storage Manager')
    parser.add_argument('--init', action='store_true', help='Initialize database')
    parser.add_argument('--stocks', action='store_true', help='Store stocks snapshot')
    parser.add_argument('--crypto', action='store_true', help='Store crypto snapshot')
    parser.add_argument('--commodities', action='store_true', help='Store commodities snapshot')
    parser.add_argument('--all', action='store_true', help='Store all snapshots')
    parser.add_argument('--cleanup', action='store_true', help='Run cleanup')
    parser.add_argument('--stats', action='store_true', help='Show stats')
    parser.add_argument('--get', help='Get data for ticker')
    parser.add_argument('--period', default='1w', help='Period: 1d|1w|1m')
    parser.add_argument('--asset', default=None, help='Asset: stock|crypto|commodity')

    args = parser.parse_args()

    if args.init or not any([args.stocks, args.crypto, args.commodities, args.all,
                              args.cleanup, args.stats, args.get]):
        init_intraday_db()
        print(f"✅ intraday.db initialized at {INTRADAY_DB}")

    if args.stocks:
        n = store_stocks_snapshot()
        print(f"✅ Stocks snapshot: {n} stored")

    if args.crypto:
        n = store_crypto_snapshot()
        print(f"✅ Crypto snapshot: {n} stored")

    if args.commodities:
        n = store_commodities_snapshot()
        print(f"✅ Commodities snapshot: {n} stored")

    if args.all:
        n = store_intraday_snapshot()
        print(f"✅ All snapshots: {n} total stored")

    if args.cleanup:
        cleanup_old_data()
        print("✅ Cleanup done")

    if args.stats:
        import json
        stats = get_intraday_stats()
        print(json.dumps(stats, indent=2, ensure_ascii=False, default=str))

    if args.get:
        data = get_intraday_data(args.get, args.period, args.asset)
        print(f"Found {len(data)} records for {args.get} ({args.period}):")
        for d in data[:5]:
            print(f"  {d.get('timestamp')} → {d.get('price')} ({d.get('source', '?')})")
        if len(data) > 5:
            print(f"  ... and {len(data) - 5} more")
