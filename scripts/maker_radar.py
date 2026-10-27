#!/usr/bin/env python3
"""
maker_radar.py — رادار الميكرز اليومي
=====================================
يسحب بيانات كل أسهم EGX من db/production_snapshot.db ويشغل عليها 3 مسارات:

  مسار أ — Quiet Accumulation (التجميع الهادئ) → حجم 2%
  مسار ب — Explosive Surge (انفجار) → حجم 2%
  مسار ج — Early Break (اختراق مبكر) → حجم 2.5%

النتيجة: قائمة الأسهم اللي تحت الميكروسكوب + تصنيف كل سهم.

CLI:
  python3 scripts/maker_radar.py
  python3 scripts/maker_radar.py --json-only
  python3 scripts/maker_radar.py --limit 50   # فحص 50 سهم بس (للتجربة)
"""
from __future__ import annotations

import argparse
import json
import sqlite3
import statistics
import sys
from datetime import datetime, date
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent
OUTPUT_DIR = Path(__file__).resolve().parent / "output"
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

sys.path.insert(0, str(PROJECT_ROOT / "vps-service"))

from utils.shared_liquidity import (
    detect_quiet_accumulation,
    detect_pre_surge,
    detect_life_cycle,
    compute_money_flow,
    check_limit_up_trap,
    check_kill_switch,
    is_explosive_surge,
    classify_price_bucket,
    dynamic_min_turnover,
    QUIET_ACCUMULATION_POSITION_SIZE,
    PRE_SURGE_POSITION_SIZE,
    EXPLOSIVE_SURGE_POSITION_SIZE,
)


# ============================================================================
# PORTABLE + MARKET-AWARE DB DETECTION — يشتغل في sandbox + laptop + production
# ============================================================================
# Rule 67 (ROOT-CAUSE-FIRST, Task 35-A): the original `_find_radar_db()` was
# market-blind — it iterated an EGX-first candidate list and picked the first
# non-empty table, ignoring `--market`. On any system with EGX data this made
# `--market TADAWUL` queries silently return 0 rows because the radar scanned
# an EGX-only table for TADAWUL tickers.
#
# The fix: dispatch by market. Each market has its own candidate list, and the
# function NEVER crosses streams (no EGX table is ever returned for TADAWUL).
# The caller (main) passes `args.market` AFTER argparse — previously the call
# ran at module-load time before `--market` was parsed, so it was always EGX.
#
# Per-market source-of-truth:
#   - EGX       → data_engine.db.egksco_price_history  (fallback: stock_daily_prices)
#   - TADAWUL   → data_engine.db.historical_data       (filtered by stocks.db.stocks)
#   - KSE       → data_engine.db.historical_data       (filtered by stocks.db.stocks)
#   - QSE       → data_engine.db.historical_data       (filtered by stocks.db.stocks)
#   - US        → data_engine.db.historical_data       (filtered by stocks.db.stocks)
#   - CRYPTO    → data_engine.db.crypto_prices         (grouped by symbol)
#   - GOLD      → data_engine.db.gold_prices           (grouped by symbol)
def _find_radar_db(market: str = 'EGX'):
    """اكتشف الـ DB المتاح تلقائياً حسب السوق (Rule 67 — root-cause fix).

    المطلوب:
      market ∈ {'EGX', 'TADAWUL', 'KSE', 'QSE', 'US', 'CRYPTO', 'GOLD'}

    الإرجاع:
      (db_path, table_name, ticker_col, price_col, vol_col, turn_col,
       date_col, open_col, high_col, low_col)

      أو (None, None, ...) لو السوق مش معروف.

    ملاحظات مهمة:
      - لو الجدول المطلوب مش موجود على القرص (sandbox بدون db/data_engine.db)،
        بنرجّع الـ config بتاع أول candidate عشان الـ caller (main) يقدر
        يطبع رسالة خطأ واضحة. ده أهم من رجوع None — الـ caller بيتأكد
        من PROD_DB.exists() قبل ما يفتح الاتصال.
      - الترتيب داخل كل سوق عمداً: source-of-truth الأول، fallback بعده.
    """
    market = (market or 'EGX').strip().upper()

    # Per-market candidate lists — config tuples of
    # (db_rel, table, ticker_col, price_col, vol_col, turn_col,
    #  date_col, open_col, high_col, low_col)

    # ═══════════════════════════════════════════════════════════════════
    # Phase 3 (DATA-UNIFICATION): price_history.db as PRIMARY source
    # All markets now read from price_history.db FIRST (canonical source).
    # Legacy sources (stock_daily_prices, egksco, historical_data) kept
    # as fallback only. See DATA-UNIFICATION-PLAN.md
    # ═══════════════════════════════════════════════════════════════════
    PRICE_HISTORY_TUPLE = (
        'db/price_history.db', 'price_history',
        'ticker', 'close_price', 'volume', None,
        'date', 'open_price', 'high_price', 'low_price',
    )

    HISTORICAL_DATA_TUPLE = (
        'db/data_engine.db', 'historical_data',
        'symbol', 'close', 'volume', None, 'date', 'open', 'high', 'low',
    )
    CRYPTO_PRICES_TUPLE = (
        'db/data_engine.db', 'crypto_prices',
        'symbol', 'price_usd', 'total_volume', None, 'timestamp', 'price_usd', 'price_usd', 'price_usd',
    )
    GOLD_PRICES_TUPLE = (
        'db/data_engine.db', 'gold_prices',
        'karat', 'price_per_gram', 'price_per_ounce', None, 'timestamp', 'price_per_gram', 'price_per_gram', 'price_per_gram',
    )

    MARKET_CANDIDATES: dict = {
        'EGX': [
            # PREDICTIONS-CLEANUP-2 (2026-10-27): stocks.db FIRST (live data from
            # tradingview_scanner_live + daily_price_updater). price_history.db is
            # stale (last update 24 Sept 2026) — moved to LAST fallback only.
            # 1. stocks.db.stock_daily_prices — LIVE production source-of-truth
            (
                'db/stocks.db', 'stock_daily_prices',
                'ticker', 'close', 'volume', None,  # turnover computed from close × volume
                'price_date', 'open', 'high', 'low',
            ),
            # 2. data_engine.db.egksco_price_history — fallback (archive)
            (
                'db/data_engine.db', 'egksco_price_history',
                'symbol', 'close_price', 'volume', 'turnover',
                'price_date', 'open_price', 'high_price', 'low_price',
            ),
            # 3. data_engine.db.historical_data — last-resort (mixed markets)
            HISTORICAL_DATA_TUPLE,
            # 4. price_history.db — STALE ARCHIVE (last resort only, Sept 2026)
            PRICE_HISTORY_TUPLE,
            # 5. sandbox fallbacks
            (
                'db/production_snapshot.db', 'stock_daily_prices',
                'ticker', 'close', 'volume', 'turnover',
                'price_date', 'open', 'high', 'low',
            ),
            (
                'db/vps_real/stocks.db', 'stock_daily_prices',
                'ticker', 'close', 'volume', 'turnover',
                'price_date', 'open', 'high', 'low',
            ),
        ],
        # الأسواق الخليجية — stocks.db.stock_daily_prices الأول ثم historical_data
        'TADAWUL': [
            # PREDICTIONS-CLEANUP-2: stocks.db FIRST (live)
            (
                'db/stocks.db', 'stock_daily_prices',
                'ticker', 'close', 'volume', None,  # turnover computed from close × volume
                'price_date', 'open', 'high', 'low',
            ),
            HISTORICAL_DATA_TUPLE,
            # price_history.db — STALE ARCHIVE (last resort)
            PRICE_HISTORY_TUPLE,
        ],
        'KSE': [
            # PREDICTIONS-CLEANUP-2: stocks.db FIRST (live)
            (
                'db/stocks.db', 'stock_daily_prices',
                'ticker', 'close', 'volume', None,  # turnover computed from close × volume
                'price_date', 'open', 'high', 'low',
            ),
            HISTORICAL_DATA_TUPLE,
            # price_history.db — STALE ARCHIVE (last resort)
            PRICE_HISTORY_TUPLE,
        ],
        'QSE': [
            # PREDICTIONS-CLEANUP-2: stocks.db FIRST (live)
            (
                'db/stocks.db', 'stock_daily_prices',
                'ticker', 'close', 'volume', None,  # turnover computed from close × volume
                'price_date', 'open', 'high', 'low',
            ),
            HISTORICAL_DATA_TUPLE,
            # price_history.db — STALE ARCHIVE (last resort)
            PRICE_HISTORY_TUPLE,
        ],
        'US':      [
            # PREDICTIONS-CLEANUP-2: stocks.db FIRST (live US data from scanner)
            (
                'db/stocks.db', 'stock_daily_prices',
                'ticker', 'close', 'volume', None,  # turnover computed from close × volume
                'price_date', 'open', 'high', 'low',
            ),
            # price_history.db — fallback (US archive)
            PRICE_HISTORY_TUPLE,
            HISTORICAL_DATA_TUPLE,
        ],
        # CRYPTO + GOLD — جداول منفصلة في data_engine.db
        'CRYPTO':  [CRYPTO_PRICES_TUPLE],
        'GOLD':    [GOLD_PRICES_TUPLE],
    }

    candidates = MARKET_CANDIDATES.get(market, MARKET_CANDIDATES['EGX'])

    for cfg in candidates:
        db_rel, table, ticker_col, price_col, vol_col, turn_col, \
            date_col, open_col, high_col, low_col = cfg
        db_path = PROJECT_ROOT / db_rel
        if not db_path.exists():
            continue
        try:
            # Phase 7.1 / B3-fix: use get_connection() (raw, lifecycle managed by caller).
            # The previous `db_manager.connection(...).__enter__()` pattern leaks the
            # contextmanager object — Python GC closes the underlying conn before the
            # caller can use it ("Cannot operate on a closed database").
            from core.db_manager import db_manager
            conn = db_manager.get_connection(str(db_path), writable=False)
            # تحقق إن الـ table موجود
            cur = conn.execute(
                "SELECT name FROM sqlite_master WHERE type='table' AND name=?",
                (table,),
            )
            row = cur.fetchone()
            if not row:
                conn.close()
                continue
            # تحقق إن الجدول مش فاضي
            n = conn.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]
            conn.close()
            if n == 0:
                continue  # جرّب اللي بعده
            return (db_path, table, ticker_col, price_col, vol_col,
                    turn_col, date_col, open_col, high_col, low_col)
        except Exception:
            continue

    # Fallback (sandbox without data_engine.db, or all tables empty):
    # return the FIRST candidate config so the caller (main) can produce a
    # clear error message like "❌ مفيش DB متاح" — instead of silently
    # returning None which previously caused `_find_radar_db('TADAWUL')`
    # to print `(None, None, ...)` instead of the historical_data config.
    if candidates:
        db_rel, table, ticker_col, price_col, vol_col, turn_col, \
            date_col, open_col, high_col, low_col = candidates[0]
        return (PROJECT_ROOT / db_rel, table, ticker_col, price_col,
                vol_col, turn_col, date_col, open_col, high_col, low_col)

    return (None, None, None, None, None, None, None, None, None, None)


# Module-level globals — initialized to None. main() populates them AFTER
# argparse parses `--market` (Rule 67 fix). This was previously called at
# module-load time, which meant `--market TADAWUL` was always ignored because
# the function defaulted to EGX.
PROD_DB = None
PROD_TABLE = None
TICKER_COL = None
PRICE_COL = None
VOL_COL = None
TURN_COL = None
DATE_COL = None
OPEN_COL = None
HIGH_COL = None
LOW_COL = None
# DB source identifier — يكتب في الـ JSON output عشان الـ API يقدر يعرضه
DB_SOURCE_ID = None


def log(msg):
    print(msg, flush=True)


def parse_volume(v):
    if v is None: return 0.0
    if isinstance(v, (int, float)): return float(v)
    s = str(v).strip().upper().replace("\u202f", "").replace("\xa0", "").replace(" ", "")
    mult = 1.0
    for suffix, m in [("K", 1e3), ("M", 1e6), ("B", 1e9)]:
        if s.endswith(suffix):
            mult = m; s = s[:-1]; break
    try: return float(s) * mult
    except: return 0.0


def compute_turnover(row):
    """احسب turnover من row — portable (يدعم turnover/value field أو close × volume)."""
    t = None
    try:
        if TURN_COL and TURN_COL in row.keys():
            t = row[TURN_COL]
    except Exception:
        pass
    if t is not None:
        try:
            t_float = float(t)
            if t_float > 0: return t_float
        except (TypeError, ValueError):
            pass
    close = row.get(PRICE_COL) or row.get('close') or 0.0
    vol = parse_volume(row.get(VOL_COL) or row.get('volume'))
    return float(close) * float(vol)


# ============================================================================
# SCANNER-LIVE-2 (2026-10-27): Enrichment from stocks.db (unified scanner)
# ============================================================================
# Owner directive: use official `value_traded` (cash) + `relative_volume_10d`
# from the TradingView Scanner API (stored in stocks.db by tradingview_scanner_live.py)
# as the authoritative liquidity + volume-surge metrics, instead of computing
# them from historical close × volume (which is an approximation).
#
# The enrichment is OPTIONAL: if stocks.db doesn't have the columns or the
# ticker isn't found, we fall back to the computed values (backward compat).
# ============================================================================

# Cache: ticker → {value_traded, relative_volume_10d, ...} from stocks.db
_SCANNER_ENRICHMENT_CACHE: dict = {}  # keyed by market_code


def _load_scanner_enrichment(market_code: str = 'EGX'):
    """Load value_traded + relative_volume_10d from stocks.db for all tickers.

    Caches at module level PER MARKET (one DB read per market per radar run).
    Returns empty dict if stocks.db or columns don't exist (backward compat).
    """
    global _SCANNER_ENRICHMENT_CACHE
    if market_code in _SCANNER_ENRICHMENT_CACHE:
        return _SCANNER_ENRICHMENT_CACHE[market_code]

    cache: dict = {}
    db_path = PROJECT_ROOT / 'db' / 'stocks.db'
    if not db_path.exists():
        _SCANNER_ENRICHMENT_CACHE[market_code] = cache
        return cache

    try:
        conn = sqlite3.connect(str(db_path))
        # Check if the new columns exist
        cols = {r[1] for r in conn.execute("PRAGMA table_info(stocks)").fetchall()}
        needed = {'value_traded', 'relative_volume_10d', 'turnover_egp'}
        if not needed.issubset(cols):
            log(f"  ℹ️ stocks.db missing scanner columns {needed - cols}, skipping enrichment")
            conn.close()
            _SCANNER_ENRICHMENT_CACHE[market_code] = cache  # P2 FIX: per-market key
            return cache

        # Map market_code → scanner market slug
        market_slug_map = {'EGX': 'egypt', 'TADAWUL': 'saudi', 'KSE': 'kuwait',
                           'QSE': 'qatar', 'US': 'america', 'CRYPTO': None}
        market_slug = market_slug_map.get(market_code, 'egypt')

        # P2 FIX: CRYPTO maps to None — skip query (crypto not in stocks.db)
        if market_slug is None:
            conn.close()
            _SCANNER_ENRICHMENT_CACHE[market_code] = cache
            return cache

        rows = conn.execute(
            "SELECT symbol, value_traded, relative_volume_10d, turnover_egp, "
            "pe_ratio, roe, profit_margin, eps, dividend_yield, rsi, volume "
            "FROM stocks WHERE market = ?",
            (market_slug,)
        ).fetchall()
        for r in rows:
            ticker, vt, rv, te, pe, roe, pm, eps, dy, rsi, vol = r
            cache[ticker] = {
                'value_traded': vt,
                'relative_volume_10d': rv,
                'turnover_egp': te,
                'pe_ratio': pe,
                'roe': roe,
                'profit_margin': pm,
                'eps': eps,
                'dividend_yield': dy,
                'rsi_scanner': rsi,
                'volume': vol,
            }
        conn.close()
        log(f"  📊 scanner enrichment: {len(cache)} tickers from stocks.db (market={market_slug})")
    except Exception as e:
        log(f"  ⚠️ scanner enrichment failed: {e}")

    _SCANNER_ENRICHMENT_CACHE[market_code] = cache
    return cache


def _enrich_result_with_scanner(result: dict, ticker: str) -> dict:
    """Enrich a radar result dict with official value_traded + relative_volume_10d.

    Mutates + returns the result dict. If ticker not in cache, leaves computed
    values unchanged (backward compat).
    """
    cache = _load_scanner_enrichment(result.get('market', 'EGX'))
    if not cache or ticker not in cache:
        return result

    enrichment = cache[ticker]

    # Official cash value (overrides computed turnover_egp if available)
    official_vt = enrichment.get('value_traded')
    if official_vt and official_vt > 0:
        result['value_traded_official'] = round(official_vt, 2)
        result['turnover_egp_official'] = round(official_vt, 2)
        # Use the official value as the canonical turnover_egp
        result['turnover_egp'] = round(official_vt, 2)

    # Official relative volume (from TradingView, 10d calc)
    official_rv = enrichment.get('relative_volume_10d')
    if official_rv and official_rv > 0:
        result['relative_volume_10d_official'] = round(official_rv, 3)
        # Flag unusual volume surge if > 1.2 (per owner directive)
        result['volume_surge'] = official_rv > 1.2

    # Fundamentals (bonus — from scanner, may differ from computed)
    for field in ['pe_ratio', 'roe', 'profit_margin', 'eps', 'dividend_yield']:
        val = enrichment.get(field)
        if val is not None:
            result[f'{field}_scanner'] = val

    return result


# ============================================================================
# FRESHNESS GUARD (Task FIX-STALE-DTPP-2026-10-07 — Rule 71)
# ============================================================================
# ROOT CAUSE (DTPP case):
#   - egksco_price_history for DTPP had a GAP: latest row was 2026-09-24 close=326.01
#   - When radar ran on 2026-10-04, the DB was missing rows for Oct 1-4
#   - `closes[-1]` returned 326.01 (Sep 24 close, 10-day stale!)
#   - The radar stored entry_price=326.01 as if it were today's price
#   - Customer saw "buy at 326.01" while actual market price was ~290-306
#
# FIX: Track the date of closes[-1] and compute staleness. Mark stale signals
# explicitly so the customer is never shown a buy recommendation priced on
# stale data.
def _parse_date_str(s):
    """Parse YYYY-MM-DD or ISO datetime string → date object (or None)."""
    if not s:
        return None
    if isinstance(s, date):
        return s if not isinstance(s, datetime) else s.date()
    s = str(s).strip()
    if not s:
        return None
    # Try YYYY-MM-DD prefix
    for fmt in ("%Y-%m-%d", "%Y-%m-%dT%H:%M:%S", "%Y-%m-%d %H:%M:%S", "%Y/%m/%d", "%d-%m-%Y"):
        try:
            return datetime.strptime(s[:19] if 'T' in s or ' ' in s else s[:10], fmt).date()
        except ValueError:
            continue
    # Last resort: take first 10 chars
    try:
        return datetime.strptime(s[:10], "%Y-%m-%d").date()
    except Exception:
        return None


def _compute_staleness_days(price_date_str, today=None):
    """Return number of days between today and price_date_str. None if unparseable.

    For trading-day logic, a freshness of 1 day is acceptable (today's row may
    not yet be inserted after market close). 2+ days = stale.
    """
    pd = _parse_date_str(price_date_str)
    if pd is None:
        return None
    today = today or date.today()
    return (today - pd).days


def fetch_ticker_series(conn, ticker, days=40):
    """جلب بيانات سهم — portable (يستخدم column names المكتشفة)."""
    # استخدم column names المكتشفة بدلاً من hardcoded names
    cols = f"{DATE_COL}, {OPEN_COL} as open, {HIGH_COL} as high, {LOW_COL} as low, {PRICE_COL} as close, {VOL_COL} as volume"
    if TURN_COL:
        cols += f", {TURN_COL} as turnover"
    else:
        cols += ", NULL as turnover"
    query = f"""
        SELECT {cols}
        FROM {PROD_TABLE}
        WHERE {TICKER_COL} = ? AND {PRICE_COL} IS NOT NULL AND {PRICE_COL} > 0
        ORDER BY {DATE_COL} DESC
        LIMIT ?
    """
    rows = conn.execute(query, (ticker, days)).fetchall()
    # رجّع standardized keys عشان باقي الكود يشتغل
    normalized = []
    for r in rows:
        d = dict(r)
        # unify keys
        d['price_date'] = d.get(DATE_COL) or d.get('date') or d.get('price_date')
        d['close'] = d.get('close') or d.get(PRICE_COL)
        d['volume'] = d.get('volume') or d.get(VOL_COL)
        d['turnover'] = d.get('turnover') if TURN_COL else None
        d['open'] = d.get('open') or d.get(OPEN_COL)
        d['high'] = d.get('high') or d.get(HIGH_COL)
        d['low'] = d.get('low') or d.get(LOW_COL)
        normalized.append(d)
    return list(reversed(normalized))


def is_early_break(closes, volumes, highs=None):
    """مسار ج — Early Break: السهم طلع من النطاق الضيق بحجم.

    الشروط:
      1. آخر شمعة اخترقت max آخر 20 يوم (close > max(closes[-21:-1]))
      2. volume آخر شمعة > 1.5× avg_20d
      3. الـ 20 يوم قبلها كانت range < 15% (منضغطة)
    """
    if not closes or len(closes) < 21 or not volumes or len(volumes) < 21:
        return False, 'insufficient data'

    last_close = closes[-1]
    prev_20 = closes[-21:-1]
    max_20 = max(prev_20)
    min_20 = min(prev_20)

    # 1. اختراق القمة
    if last_close <= max_20:
        return False, f'close {last_close:.2f} ≤ max_20 {max_20:.2f}'

    # 2. volume > 1.5× avg
    avg_20_vol = sum(volumes[-21:-1]) / 20
    last_vol = volumes[-1]
    if avg_20_vol <= 0:
        return False, 'avg_20_vol = 0'
    vol_ratio = last_vol / avg_20_vol
    if vol_ratio < 1.5:
        return False, f'vol {vol_ratio:.2f}× < 1.5×'

    # 3. range 20d < 15%
    if min_20 <= 0:
        return False, 'min_20 = 0'
    range_pct = (max_20 - min_20) / min_20 * 100
    if range_pct >= 15.0:
        return False, f'range {range_pct:.1f}% ≥ 15%'

    return True, f'break: close {last_close:.2f} > max_20 {max_20:.2f}, vol {vol_ratio:.2f}×, range {range_pct:.1f}%'


def _scanner_fallback(ticker, regime='NORMAL', market_code='EGX'):
    """RADAR-FIX: Create a minimal radar result from scanner data when historical
    data is insufficient (< 15 rows). STANDALONE function — does NOT replace
    the 5 detection paths inside scan_ticker.

    Classification: SCANNER_ALERT (not a buy/sell recommendation).
    Returns None if no scanner data available.
    """
    cache = _load_scanner_enrichment(market_code)
    if not cache or ticker not in cache:
        return None

    e = cache[ticker]
    value_traded = e.get('value_traded')
    relvol = e.get('relative_volume_10d')
    rsi = e.get('rsi_scanner') or e.get('rsi')
    volume = e.get('volume')

    # P1 FIX: require current_price (not value_traded) — don't hide price movements
    # due to missing liquidity data
    try:
        conn = sqlite3.connect(str(PROJECT_ROOT / 'db' / 'stocks.db'))
        # P1 FIX: filter by market to avoid cross-market ticker collision
        market_slug_map = {'EGX': 'egypt', 'TADAWUL': 'saudi', 'KSE': 'kuwait',
                           'QSE': 'qatar', 'US': 'america'}
        market_slug = market_slug_map.get(market_code, 'egypt')
        r = conn.execute("SELECT current_price, change_percent, volume FROM stocks WHERE symbol = ? AND market = ?", (ticker, market_slug)).fetchone()
        conn.close()
        if r:
            current_price = r[0]
            change_pct = r[1] or 0
            volume = r[2] or volume or 0
        else:
            return None
    except Exception:
        return None

    if not current_price or current_price <= 0:
        return None

    vol_surge = relvol and relvol > 1.2
    is_bullish = change_pct > 0
    is_bearish = change_pct < 0

    if vol_surge and is_bullish:
        movement_type = 'SURGE_UP'
        movement_desc = f'ارتفاع +{change_pct:.1f}% مع حجم نسبي {relvol:.2f}x'
    elif vol_surge and is_bearish:
        movement_type = 'SURGE_DOWN'
        movement_desc = f'انخفاض {change_pct:.1f}% مع حجم نسبي {relvol:.2f}x'
    elif is_bullish:
        movement_type = 'UP'
        movement_desc = f'ارتفاع +{change_pct:.1f}% (حجم عادي)'
    elif is_bearish:
        movement_type = 'DOWN'
        movement_desc = f'انخفاض {change_pct:.1f}% (حجم عادي)'
    else:
        movement_type = 'FLAT'
        movement_desc = 'حركة محدودة'

    result = {
        'ticker': ticker,
        'current_price': round(current_price, 2),
        'path': 'F_scanner_alert',
        'classification': 'SCANNER_ALERT',
        'movement_type': movement_type,
        'movement_desc': movement_desc,
        'volume_surge': vol_surge or False,
        'relative_volume_10d_official': round(relvol, 3) if relvol else None,
        'value_traded_official': round(value_traded, 2) if value_traded else None,
        'turnover_egp': round(value_traded, 2) if value_traded else 0,
        'rsi_scanner': round(rsi, 1) if rsi else None,
        'change_percent': round(change_pct, 2),
        'readiness_pct': 0,
        'under_microscope': False,
        'reason': f'SCANNER_ALERT: {movement_desc} (بيانات تاريخية غير كافية للتحليل الكامل)',
        'data_quality': 'scanner_only',
        'stale_flag': False,
        'last_close_date': datetime.now().strftime('%Y-%m-%d'),
        'staleness_days': 0,
        'score': 0,
        'signal': 'HOLD',
        'signal_ar': 'مراقبة',
        'entry': None,
        'target': None,
        'stop_loss': None,
        'risk_reward': 0,
        'evidence': 0,
        'master_score': 0,
        'tech_score': 0,
        'money_flow': {'buy_pct': 0, 'sell_pct': 0, 'net_flow_egp': 0,
                       'buy_value_m': 0, 'sell_value_m': 0,
                       'liquidity_state': 'unknown', 'money_flow_state': 'unknown'},
        'life_cycle': 'unknown',
        'pre_surge_details': None,
        'quiet_details': None,
        'explosive_details': None,
        'break_reason': None,
        'distribution_flag': False,
        'avg_turnover_20d': 0,
        'avg_volume_20d': 0,
        'avg_volume_10d': 0,
        'volume_ratio_10d_vs_20d': 0,
        'volume': int(volume) if volume else 0,
        'price_bucket': classify_price_bucket(current_price),
        'price_stability': 0,
        'range_10d_pct': 0,
        'roc_10d': 0,
        'roc_30d': 0,
        'maker_activity': 'unknown',
        'accumulation': 'unknown',
        'correction_status': 'unknown',
        'drop_from_peak': 0,
        'expected': 0,
        'buy_days': 0,
        'sell_days': 0,
        'limit_up_trap': False,
        'kill_switch': False,
        'kill_reason': None,
        'position_size': 0,
        'final_reason': f'SCANNER_ALERT: {movement_desc}',
    }

    _add_intelligence_layers(
        result,
        closes=None, volumes=None,
        vol_ratio=relvol,
        value_traded=value_traded,
        change_percent=change_pct,
        staleness_days=0,
        last_close_date=datetime.now().strftime('%Y-%m-%d'),
        rows=None,
    )
    return result


# ============================================================================
# RADAR-INTELLIGENCE: Independent classification layers
# These describe what's happening — they do NOT change buy/sell signals.
# ============================================================================

def _classify_price_action(closes, volumes, highs=None, lows=None, change_percent=None):
    """Classify the price action into a movement type."""
    evidence = {'change_pct': change_percent, 'history_len': len(closes) if closes else 0}
    if not closes or len(closes) < 2:
        return 'INSUFFICIENT_DATA', evidence
    last_close = closes[-1]
    prev_close = closes[-2]
    daily_change = ((last_close - prev_close) / prev_close * 100) if prev_close > 0 else 0
    evidence['daily_change_pct'] = round(daily_change, 2)
    effective_change = change_percent if change_percent is not None else daily_change
    vol_ratio = 1.0
    if volumes and len(volumes) >= 20:
        avg_20 = sum(volumes[-20:]) / 20
        vol_ratio = volumes[-1] / avg_20 if avg_20 > 0 else 0
    elif volumes and len(volumes) >= 5:
        avg_5 = sum(volumes[-5:]) / 5
        vol_ratio = volumes[-1] / avg_5 if avg_5 > 0 else 0
    evidence['volume_ratio'] = round(vol_ratio, 2)
    if effective_change is not None and effective_change > 5 and vol_ratio > 1.5:
        return 'SURGE_UP', evidence
    if effective_change is not None and effective_change < -5 and vol_ratio > 1.5:
        return 'SURGE_DOWN', evidence
    if len(closes) < 5:
        if effective_change is not None and effective_change > 2:
            return 'BULLISH_WAVE_START', evidence
        if effective_change is not None and effective_change < -2:
            return 'BEARISH_WAVE_START', evidence
        return 'UNCONFIRMED', evidence
    last_7 = closes[-7:] if len(closes) >= 7 else closes
    roc_7d = ((last_close - last_7[0]) / last_7[0] * 100) if last_7[0] > 0 else 0
    evidence['roc_7d'] = round(roc_7d, 2)
    if len(closes) >= 10:
        prev_7 = closes[-10:-3]
        decline = ((prev_7[-1] - prev_7[0]) / prev_7[0] * 100) if prev_7[0] > 0 else 0
        recovery = ((closes[-1] - closes[-3]) / closes[-3] * 100) if closes[-3] > 0 else 0
        if decline < -5 and recovery > 2:
            evidence['bounce'] = True
            return 'BOUNCE_AFTER_DECLINE', evidence
        rally = ((prev_7[-1] - prev_7[0]) / prev_7[0] * 100) if prev_7[0] > 0 else 0
        pullback = ((closes[-1] - closes[-3]) / closes[-3] * 100) if closes[-3] > 0 else 0
        if rally > 5 and pullback < -2:
            evidence['pullback'] = True
            return 'PULLBACK_AFTER_RALLY', evidence
    if roc_7d > 3 and effective_change is not None and effective_change > 0:
        return 'BULLISH_CONTINUATION', evidence
    if roc_7d < -3 and effective_change is not None and effective_change < 0:
        return 'BEARISH_CONTINUATION', evidence
    if len(closes) >= 20:
        max_20 = max(closes[-21:-1]) if len(closes) >= 21 else max(closes[:-1])
        if last_close > max_20 and vol_ratio > 1.2:
            evidence['breakout_level'] = round(max_20, 2)
            return 'BREAKOUT', evidence
        min_20 = min(closes[-21:-1]) if len(closes) >= 21 else min(closes[:-1])
        if last_close < min_20 and vol_ratio > 1.2:
            evidence['breakdown_level'] = round(min_20, 2)
            return 'BREAKDOWN', evidence
    if len(closes) >= 7:
        range_7 = (max(last_7) - min(last_7)) / min(last_7) * 100 if min(last_7) > 0 else 0
        if range_7 < 3 and abs(effective_change or 0) < 1:
            evidence['range_7d'] = round(range_7, 2)
            return 'SIDEWAYS', evidence
    if len(closes) >= 10:
        prev_5 = ((closes[-5] - closes[-10]) / closes[-10] * 100) if closes[-10] > 0 else 0
        last_3 = ((closes[-1] - closes[-3]) / closes[-3] * 100) if closes[-3] > 0 else 0
        if prev_5 > 8 and last_3 < prev_5 * 0.3:
            evidence['exhaustion'] = True
            return 'MOMENTUM_EXHAUSTION', evidence
    return 'UNCONFIRMED', evidence


def _assess_participant_flow(volumes, closes, vol_ratio, value_traded, change_percent):
    """Assess institutional vs speculative participation. NO direct data available."""
    evidence = {'vol_ratio': vol_ratio, 'value_traded': value_traded}
    if not volumes or len(volumes) < 5:
        return 'UNAVAILABLE', 'UNAVAILABLE', evidence
    sustained_vol = False
    if len(volumes) >= 10:
        r5 = sum(volumes[-5:]) / 5
        p5 = sum(volumes[-10:-5]) / 5
        if p5 > 0 and r5 > p5 * 1.3:
            sustained_vol = True
            evidence['sustained_volume'] = True
    sharp_move = change_percent is not None and abs(change_percent) > 5
    one_day_spike = vol_ratio and vol_ratio > 2.0 and not sustained_vol
    if sharp_move and one_day_spike:
        return 'SPECULATIVE_PATTERN', 'INDIRECT', evidence
    if sustained_vol:
        return 'MIXED_PARTICIPATION', 'INDIRECT', evidence
    return 'UNCONFIRMED', 'WEAK', evidence


def _assess_continuation(closes, volumes, vol_ratio, price_action):
    """Assess continuation likelihood."""
    if not closes or len(closes) < 3:
        return 'INSUFFICIENT_DATA'
    signals = []
    if vol_ratio and vol_ratio > 1.5:
        signals.append('vol_support')
    if price_action in ('BULLISH_CONTINUATION', 'BREAKOUT'):
        signals.append('trend_aligned')
    if price_action == 'MOMENTUM_EXHAUSTION':
        signals.append('fading')
    if len(closes) >= 5:
        green = sum(1 for i in range(1, 5) if closes[-i] > closes[-i-1])
        if green >= 3:
            signals.append('majority_green')
        elif green <= 1:
            signals.append('majority_red')
    pos = sum(1 for s in signals if s in ('vol_support', 'trend_aligned', 'majority_green'))
    neg = sum(1 for s in signals if s in ('fading', 'majority_red'))
    if pos >= 2 and neg == 0:
        return 'SUPPORTIVE'
    if pos >= 1 and neg <= 1:
        return 'MIXED'
    if neg >= 2:
        return 'WEAK'
    return 'UNCONFIRMED'


def _assess_data_quality(rows, closes, volumes, staleness_days, last_close_date):
    """Assess data quality with specific reasons."""
    reasons = []
    if not rows or not closes:
        return 'UNAVAILABLE', ['no_price_data']
    if len(closes) < 15:
        reasons.append(f'insufficient_history:{len(closes)}<15')
        return 'INSUFFICIENT_HISTORY', reasons
    if staleness_days is not None and staleness_days > 3:
        reasons.append(f'very_stale:{staleness_days}d')
        return 'VERY_STALE', reasons
    if staleness_days is not None and staleness_days > 1:
        reasons.append(f'stale:{staleness_days}d')
    if not volumes or all(v == 0 for v in volumes[-5:]):
        reasons.append('volume_unavailable')
    if reasons:
        return 'STALE', reasons
    return 'FRESH', reasons


def _add_intelligence_layers(result, closes=None, volumes=None, highs=None, lows=None,
                              vol_ratio=None, value_traded=None, change_percent=None,
                              staleness_days=None, last_close_date=None, rows=None):
    """Add 4 intelligence layers to result dict. Does NOT change buy/sell signals."""
    try:
        pa, pa_ev = _classify_price_action(closes, volumes, highs, lows, change_percent)
        result['price_action'] = pa
        result['price_action_evidence'] = pa_ev
        pf, pfl, pf_ev = _assess_participant_flow(volumes, closes, vol_ratio, value_traded, change_percent)
        result['participant_flow_assessment'] = pf
        result['participant_evidence_level'] = pfl
        result['participant_evidence'] = pf_ev
        cont = _assess_continuation(closes, volumes, vol_ratio, pa)
        result['continuation_assessment'] = cont
        dq, dq_r = _assess_data_quality(rows, closes, volumes, staleness_days, last_close_date)
        result['data_quality_status'] = dq
        result['data_quality_reasons'] = dq_r
        result['classification_timestamp'] = datetime.now().isoformat()
    except Exception as e:
        import traceback
        print(f'[INTELLIGENCE-ERROR] {result.get("ticker", "?")}: {e}', flush=True)
        traceback.print_exc()
        result['price_action'] = 'ERROR'
        result['price_action_evidence'] = {'error': str(e)}
        result['participant_flow_assessment'] = 'UNAVAILABLE'
        result['participant_evidence_level'] = 'UNAVAILABLE'
        result['participant_evidence'] = {'error': str(e)}
        result['continuation_assessment'] = 'INSUFFICIENT_DATA'
        result['data_quality_status'] = 'ERROR'
        result['data_quality_reasons'] = [str(e)]
        result['classification_timestamp'] = datetime.now().isoformat()
    return result


def scan_ticker(rows, ticker, regime='NORMAL'):
    """يفحص سهم واحد على الـ 4 مسارات (مع Pre-Surge كأولوية أولى) مع تكييف وضع السوق."""
    # تخفيف الـ lookback من 25 لـ 15 يوم (قرار المالك 2026-09-05)
    if len(rows) < 15:
        return None  # historical analysis needs >= 15 rows — scanner_fallback handled by caller

    closes = [r['close'] for r in rows if r['close'] and r['close'] > 0]
    volumes = [parse_volume(r['volume']) for r in rows]
    highs = [r['high'] or r['close'] for r in rows]
    lows = [r['low'] or r['close'] for r in rows]
    turnovers = [compute_turnover(r) for r in rows]

    if len(closes) < 15 or len(volumes) < 15:
        return None

    current_price = closes[-1]
    # ─── FRESHNESS GUARD (Task FIX-STALE-DTPP-2026-10-07) ─────────────────
    # Capture the date of closes[-1] so we can:
    #   1. Compute staleness (days since last available close)
    #   2. Mark stale signals explicitly in radar_signal_tracking
    #   3. Warn loudly in the reason field
    last_close_date_str = ''
    for r in reversed(rows):
        d = r.get('price_date') or r.get(DATE_COL) or r.get('date')
        if d:
            last_close_date_str = str(d)[:10]
            break
    staleness_days = _compute_staleness_days(last_close_date_str)
    # quality labels: fresh (<=1d) / stale (2-3d) / very_stale (>3d)
    if staleness_days is None:
        data_quality = 'unknown'
        stale_flag = False
    elif staleness_days <= 1:
        data_quality = 'fresh'
        stale_flag = False
    elif staleness_days <= 3:
        data_quality = 'stale'
        stale_flag = True
    else:
        data_quality = 'very_stale'
        stale_flag = True

    avg_turnover_20d = statistics.mean(turnovers[-20:]) if len(turnovers) >= 20 else (statistics.mean(turnovers) if turnovers else 0)
    avg_volume_20d = statistics.mean(volumes[-20:]) if len(volumes) >= 20 else (statistics.mean(volumes) if volumes else 0)
    avg_volume_10d = statistics.mean(volumes[-10:]) if len(volumes) >= 10 else 0

    # مقاييس الترتيب: قوة الحجم النسبي + استقرار السعر
    volume_ratio_10d_vs_20d = (avg_volume_10d / avg_volume_20d) if avg_volume_20d > 0 else 0
    # استقرار السعر: 1 - (range_10d_pct / 20) → كل ما range أقل، كل ما stability أعلى
    min_10 = min(closes[-10:])
    max_10 = max(closes[-10:])
    range_10d_pct = ((max_10 - min_10) / min_10 * 100) if min_10 > 0 else 0
    price_stability = max(0.0, 1.0 - (range_10d_pct / 20.0))  # 0..1

    # PHASE-3: Pre-Surge (الأولوية الأولى — تجميع مبكر جداً) — متكيف مع الريجيم
    pre_surge, pre_surge_reason, pre_surge_details = detect_pre_surge(closes, volumes, highs, lows, regime=regime)

    # مسار أ: Quiet Accumulation — متكيف مع الريجيم
    quiet, quiet_reason, quiet_details = detect_quiet_accumulation(closes, volumes, highs, lows, regime=regime)

    # مسار ب: Explosive Surge
    explosive, explosive_reason, explosive_details = is_explosive_surge(volumes, closes)

    # مسار ج: Early Break
    early_break, break_reason = is_early_break(closes, volumes, highs)

    # تحديد المسار الفائز (ترتيب الأولوية الجديد):
    # 1. Pre-Surge (تجميع مبكر جدًا) → حجم 1.5%
    # 2. Quiet Accumulation 5-6/6 → حجم 2%
    # 3. Quiet Accumulation 4/6 → حجم 1.5%
    # 4. Explosive Surge → حجم 2%
    # 5. Early Break → حجم 2.5%
    winner_path = None
    winner_position_size = 0.0
    winner_reason = ''
    quiet_signals = quiet_details.get('signal_count', 0) if quiet else 0

    if pre_surge:
        winner_path = 'A_pre_surge'
        winner_position_size = PRE_SURGE_POSITION_SIZE  # 1.5%
        winner_reason = pre_surge_reason
    elif quiet and quiet_signals >= 5:
        winner_path = 'B_quiet_accumulation_strong'
        winner_position_size = QUIET_ACCUMULATION_POSITION_SIZE  # 1.5% (paper mode)
        winner_reason = quiet_reason
    elif quiet and quiet_signals >= 4:
        winner_path = 'C_quiet_accumulation_weak'
        winner_position_size = 0.015  # 1.5% (أضعف)
        winner_reason = quiet_reason
    elif explosive:
        winner_path = 'D_explosive_surge'
        winner_position_size = EXPLOSIVE_SURGE_POSITION_SIZE  # 2%
        winner_reason = explosive_reason
    elif early_break:
        winner_path = 'E_early_break'
        winner_position_size = 0.025  # 2.5%
        winner_reason = break_reason

    # ─── PHASE-4: Money Flow + Life Cycle + Kill Switch ──────────────────
    money_flow = compute_money_flow(closes, volumes, highs, lows)
    life_cycle = detect_life_cycle(closes, volumes, highs, lows)
    limit_up = check_limit_up_trap(closes, volumes)
    kill_triggered, kill_reason = check_kill_switch(closes, volumes, highs, lows)

    # BRAVO-FLOW-GATE-ALL (2026-10-20, owner directive — P0-RADAR-FLOW-GATE-ALL):
    # تعميم الـ flow gate على كل المسارات الصاعدة (مش quiet بس).
    # ممنوع منعاً باتاً أي سهم سيولته الـ 5 أيام سالبة (net_flow_egp < 0)
    # ياخد مسار صعود أو pre_surge أو explosive أو early_break.
    # السبب: POUL (-66.2M) و UEGC (-21.8M) و INFI (-10.2M) عدّوا كـ pre_surge
    # رغم إن سيولتهم خارجة — فضيحة.
    _net_flow = money_flow.get('net_flow_egp', 0) or 0
    _BULLISH_PATHS = ('A_pre_surge', 'B_quiet_accumulation_strong', 'C_quiet_accumulation_weak', 'D_explosive_surge', 'E_early_break')
    _distribution_flag = False  # عشان نـ markه في الـ output
    if winner_path in _BULLISH_PATHS and _net_flow < 0:
        _flow_m = _net_flow / 1_000_000
        _distribution_flag = True
        # BRAVO-FIX: خلي path='distribution' بدل None عشان الواجهة تـعرف إنه تصريف
        # (مش None اللي بـ يـسبب مشاكل في الـ filtering)
        winner_path = 'distribution'
        winner_position_size = 0.0
        winner_reason = f'تصريف صريح — السيولة خارجة ({_flow_m:+.1f}M EGP)'
        # mark under_microscope = False + clear all bullish flags
        quiet = False
        pre_surge = False
        explosive = False
        early_break = False

    # لو Kill Switch triggered → نقلل الحجم للنص أو نلغي
    if kill_triggered:
        winner_position_size = winner_position_size * 0.5  # نص الحجم
        winner_reason = f'⚠️ KILL SWITCH: {kill_reason} | {winner_reason}'

    # ─── بيانات الميكرز الإضافية (من التحليل الجنائي) ──────────────────
    # ROC10 (التغير القصير)
    roc_10d = round((closes[-1] - closes[-11]) / closes[-11] * 100, 2) if len(closes) >= 11 and closes[-11] > 0 else None
    # ROC30 (التغير الشهري) — P2-13 FIX: كان closes[-21] (ROC20) بدل closes[-31] (ROC30)
    roc_30d = round((closes[-1] - closes[-31]) / closes[-31] * 100, 2) if len(closes) >= 31 and closes[-31] > 0 else None

    # نشاط الميكرز: حجم آخر يوم vs متوسط 20 يوم
    last_vol = volumes[-1] if volumes else 0
    if last_vol > avg_volume_20d * 2.0:
        maker_activity = 'عالي'
    elif last_vol > avg_volume_20d * 1.2:
        maker_activity = 'متوسط'
    else:
        maker_activity = 'منخفض'

    # ─── CANONICAL-CALCULATIONS (Task CALC-DUP-1, Rule: CANONICAL) ───────
    # قبل كده: كان accumulation بيتحسب من "عدد أيام الإغلاق الأخضر في 10 أيام"
    # → كان بيعطي "تصريف قوي" لما buy_pct=75% (تناقض واضح مع money_flow_state)
    #
    # الحل: نستخدم canonical_signal.classify_accumulation(buy_pct) كمصدر واحد
    # كل الشاشات (توقعات + تحليل شامل + رادار) لازم تستخدم نفس الصيغة
    buy_days_count = sum(1 for i in range(-10, 0) if i > -len(closes) and closes[i] > closes[i-1])
    sell_days_count = 10 - buy_days_count
    try:
        from utils.canonical_signal import classify_accumulation as _canon_acc
        accumulation = _canon_acc(money_flow.get('buy_pct'))
    except ImportError:
        # Fallback لو canonical_signal غير متاح (مش مفروض يحدث)
        if buy_days_count >= 6:
            accumulation = 'تجميع قوي'
        elif sell_days_count >= 6:
            accumulation = 'تصريف قوي'
        elif buy_days_count >= sell_days_count:
            accumulation = 'تجميع خفيف'
        else:
            accumulation = 'تصريف خفيف'

    # حالة التصحيح: نزول من آخر قمة 20 يوم
    max_20_price = max(closes[-20:]) if len(closes) >= 20 else max(closes)
    drop_from_peak = round((current_price - max_20_price) / max_20_price * 100, 2) if max_20_price > 0 else 0
    if drop_from_peak < -5:
        correction_status = 'في تصحيح'
    elif drop_from_peak < -3:
        correction_status = 'قرب التصحيح'
    else:
        correction_status = 'صاعد'

    # المتوقع (توصية ديناميكية)
    if roc_10d is not None and roc_10d > 20:
        expected = 'مخترق — ممكن يصحح'
    elif roc_10d is not None and roc_10d > 10:
        expected = 'صاعد بقوة'
    elif volume_ratio_10d_vs_20d > 1.5 and range_10d_pct < 8:
        expected = 'تجميع — ممكن انفجار'
    elif drop_from_peak < -10:
        expected = 'في تصحيح'
    elif maker_activity == 'عالي' and money_flow.get('buy_pct', 0) >= 60:
        expected = 'ميكرز نشط'
    else:
        expected = 'عادي'
    change_1d = round((closes[-1] - closes[-2]) / closes[-2] * 100, 2) if len(closes) >= 2 and closes[-2] > 0 else 0.0

    # ─── FRESHNESS GUARD: prepend warning to reason if stale ──────────────
    # If data is stale, the entry_price based on closes[-1] is unreliable.
    # We still let the signal through (because the pattern may be valid),
    # but the customer MUST see a clear warning. The main loop also overrides
    # entry_price with the live price when available, which is the proper fix.
    final_reason = winner_reason or ''
    if stale_flag and staleness_days is not None:
        stale_warn = f'⚠️ DATA STALE — آخر إغلاق تاريخي = {last_close_date_str} ({staleness_days}d قديم). entry_price قد لا يعكس السعر الفعلي.'
        final_reason = f'{stale_warn} | {final_reason}' if final_reason else stale_warn

    # BRAVO-LEVELS (2026-10-20, owner directive): احسب entry/stop/target لكل سهم
    # بدل ما الواجهة تعرض "—" لـ stop/target.
    # entry = current_price, stop = entry - 1.5×ATR, target = entry + 2.7×ATR (R/R=1.8)
    _entry_price = round(current_price, 2)
    _atr_val = 0.0
    if len(closes) >= 15 and len(highs) >= 15 and len(lows) >= 15:
        _tr_list = []
        for _i in range(1, min(15, len(closes))):
            _h = highs[-_i] if _i <= len(highs) and highs[-_i] > 0 else closes[-_i]
            _l = lows[-_i] if _i <= len(lows) and lows[-_i] > 0 else closes[-_i]
            _pc = closes[-_i-1] if _i+1 <= len(closes) and closes[-_i-1] > 0 else closes[-_i]
            if _h > 0 and _l > 0 and _pc > 0 and _h >= _l:
                _tr = max(_h - _l, abs(_h - _pc), abs(_l - _pc))
                if 0 < _tr < closes[-1] * 0.20:  # skip TR > 20% (غلط)
                    _tr_list.append(_tr)
        _atr_val = sum(_tr_list) / len(_tr_list) if _tr_list else closes[-1] * 0.03
    if _atr_val <= 0:
        _atr_val = _entry_price * 0.03  # fallback 3%
    # clamp ATR لـ [2%, 10%]
    _atr_val = max(_entry_price * 0.02, min(_entry_price * 0.10, _atr_val))
    _stop_loss = round(_entry_price - (1.5 * _atr_val), 2)
    _target_price = round(_entry_price + (2.7 * _atr_val), 2)  # R/R = 2.7/1.5 = 1.8

    return {
        'ticker': ticker,
        'current_price': round(current_price, 2),
        'entry_price': _entry_price,
        'stop_loss': _stop_loss,
        'target_price': _target_price,
        'change_1d': change_1d,
        'change_percent': change_1d,
        'price_bucket': classify_price_bucket(current_price),
        # ─── FRESHNESS GUARD ─────────────────────────────────────────────
        'last_close_date': last_close_date_str,
        'staleness_days': staleness_days,
        'data_quality': data_quality,
        'data_stale': stale_flag,
        'avg_turnover_20d': round(avg_turnover_20d, 0),
        'avg_volume_20d': round(avg_volume_20d, 0),
        'avg_volume_10d': round(avg_volume_10d, 0),
        'volume_ratio_10d_vs_20d': round(volume_ratio_10d_vs_20d, 2),
        # RADAR-FIX-1 (2026-10-22): expose turnover_egp + volume (آخر يوم)
        # المشكلة: الـ frontend بـ filter بـ turnover_egp >= 1.5M بس الـ dict ما كانش بـ expose الـ value ده.
        # الحل: نحسب turnover_egp = آخر close × آخر volume (نفس logic price_history).
        'turnover_egp': round(closes[-1] * volumes[-1], 2) if closes and volumes and closes[-1] > 0 and volumes[-1] > 0 else 0,
        'volume': int(volumes[-1]) if volumes and volumes[-1] > 0 else 0,
        'price_stability': round(price_stability, 3),
        'range_10d_pct': round(range_10d_pct, 2),
        'roc_10d': roc_10d,
        'roc_30d': roc_30d,
        'maker_activity': maker_activity,
        'accumulation': accumulation,
        'correction_status': correction_status,
        'drop_from_peak': drop_from_peak,
        'expected': expected,
        'buy_days': buy_days_count,
        'sell_days': sell_days_count,
        # PHASE-4: Money Flow + Life Cycle
        'buy_pct': money_flow['buy_pct'],
        'sell_pct': money_flow['sell_pct'],
        'net_flow_egp': money_flow['net_flow_egp'],
        'buy_value_m': money_flow['buy_value_m'],
        'sell_value_m': money_flow['sell_value_m'],
        'liquidity_state': money_flow['liquidity_state'],
        'money_flow_state': money_flow['money_flow_state'],
        'life_cycle': life_cycle,
        'limit_up_trap': limit_up,
        'kill_switch': kill_triggered,
        'kill_reason': kill_reason if kill_triggered else None,
        'under_microscope': winner_path is not None and winner_path != 'distribution',
        'path': winner_path,
        'position_size': winner_position_size,
        'reason': final_reason,
        # BRAVO-FLOW-GATE-ALL: flag للأسهم اللي في تصريف صريح
        'distribution_flag': _distribution_flag,
        'pre_surge_details': pre_surge_details,  # BRAVO-INCUBATOR: always include for incubator scanning
        'quiet_details': quiet_details,  # BRAVO-INCUBATOR: always include for incubator scanning
        'explosive_details': explosive_details if explosive else None,
        'break_reason': break_reason if early_break else None,
    }

    # RADAR-INTELLIGENCE: add 4 independent classification layers
    _add_intelligence_layers(
        result,
        closes=closes, volumes=volumes, highs=highs, lows=lows,
        vol_ratio=volume_ratio_10d_vs_20d if volume_ratio_10d_vs_20d else None,
        value_traded=result.get('turnover_egp'),
        change_percent=result.get('change_percent') or result.get('change_1d'),
        staleness_days=staleness_days,
        last_close_date=last_close_date_str,
        rows=rows,
    )

    # SCANNER-LIVE-2 (2026-10-27): enrich with official value_traded +
    # relative_volume_10d from TradingView Scanner API (stored in stocks.db).
    # This overrides the computed turnover_egp with the authoritative cash value.
    result = _enrich_result_with_scanner(result, ticker)


# Task IMPROVEMENT-22-2026-10-07: تسجيل إشارات الرادار في DB
# يكتب كل سهم تحت الميكروسكوب في radar_signal_tracking table
# ============================================================================
def _track_signals_to_db(under_microscope: list, scan_date: str, market_code: str = 'EGX'):
    """تسجيل إشارات الرادار في radar_signal_tracking table في stocks.db.

    Args:
        under_microscope: قائمة الأسهم تحت الميكروسكوب
        scan_date: تاريخ الفحص (YYYY-MM-DD)
        market_code: كود السوق
    """
    if not under_microscope:
        return

    db_path = PROJECT_ROOT / 'db' / 'stocks.db'
    # Phase 7.1 / B3-fix: use get_connection() (raw). The previous
    # `db_manager.connection(...).__enter__()` pattern leaks the contextmanager
    # object → GC closes the conn mid-function ("Cannot operate on a closed database").
    from core.db_manager import db_manager
    conn = db_manager.get_connection(str(db_path), writable=True)

    # تأكد إن الجدول موجود
    conn.execute("""
        CREATE TABLE IF NOT EXISTS radar_signal_tracking (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            ticker TEXT NOT NULL,
            signal_date TEXT NOT NULL,
            signal_type TEXT NOT NULL,
            entry_price REAL NOT NULL,
            path TEXT,
            reason TEXT,
            status TEXT DEFAULT 'pending',
            outcome_7d REAL,
            outcome_14d REAL,
            outcome_30d REAL,
            max_price_after REAL,
            min_price_after REAL,
            verified_at TEXT,
            created_at TEXT DEFAULT (datetime('now'))
        )
    """)
    # Task FIX-STALE-DTPP-2026-10-07: إضافة أعمدة freshness
    # نضيفهم بـ ALTER TABLE ADD COLUMN عشان الجدول ممكن يكون موجود بالفعل
    new_cols = {
        'data_date': 'TEXT',          # تاريخ آخر إغلاق مستخدم لحساب entry_price
        'data_quality': 'TEXT',        # fresh / stale / very_stale / unknown
        'staleness_days': 'INTEGER',   # كم يوم قديم
        'price_source': 'TEXT',        # live / daily
        'live_price': 'REAL',          # السعر الحي إن وجد
        'daily_price': 'REAL',         # السعر التاريخي الأصلي قبل override
        # P0-DELETE-OWNERSHIP-FIX: source column for explicit record ownership.
        # Allows scoped DELETE (maker_radar only deletes its own rows).
        'source': "TEXT DEFAULT 'maker_radar'",
    }
    cur = conn.execute("PRAGMA table_info(radar_signal_tracking)")
    existing_cols = {row[1] for row in cur.fetchall()}
    for col_name, col_type in new_cols.items():
        if col_name not in existing_cols:
            try:
                conn.execute(f"ALTER TABLE radar_signal_tracking ADD COLUMN {col_name} {col_type}")
                log(f"  ✓ Added column {col_name} ({col_type}) to radar_signal_tracking")
            except Exception as e:
                log(f"  ⚠️ Could not add column {col_name}: {e}")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_radar_sig_ticker ON radar_signal_tracking(ticker)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_radar_sig_date ON radar_signal_tracking(signal_date)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_radar_sig_status ON radar_signal_tracking(status)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_radar_sig_quality ON radar_signal_tracking(data_quality)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_radar_sig_source ON radar_signal_tracking(source)")

    # P0-DELETE-OWNERSHIP-FIX: scoped DELETE — maker_radar only deletes its OWN rows.
    # Previously: DELETE WHERE signal_date=? (wiped ALL rows for the date, including
    # rows owned by state_history_tracker (canonical_state) and frontend picks).
    # Now: only rows with source='maker_radar' are deleted. Other writers' rows survive.
    # Backward compat: existing rows (before this fix) have source='maker_radar' (DEFAULT),
    # so they are still cleaned up correctly.
    conn.execute(
        "DELETE FROM radar_signal_tracking WHERE signal_date = ? AND source = 'maker_radar'",
        (scan_date,)
    )

    inserted = 0
    for stock in under_microscope:
        ticker = stock.get('ticker', '')
        if not ticker:
            continue

        path = stock.get('path', '')
        entry_price = stock.get('current_price', 0) or 0
        reason = stock.get('reason', '')[:500] if stock.get('reason') else ''

        # تحديد signal_type بناءً على path
        signal_type = path or 'unknown'

        # إضافة معلومات إضافية في reason
        money_flow = stock.get('money_flow_state', '')
        buy_pct = stock.get('buy_pct', 0)
        kill_switch = stock.get('kill_switch', False)
        kill_reason = stock.get('kill_reason', '')

        full_reason = reason
        if money_flow:
            full_reason += f' | {money_flow}'
        if buy_pct:
            full_reason += f' | buy={buy_pct:.0f}%'
        if kill_switch:
            full_reason += f' | ⚠️ KILL: {kill_reason}'

        # Task FIX-STALE-DTPP-2026-10-07: store freshness metadata
        data_date = stock.get('data_date', '') or ''
        data_quality = stock.get('data_quality', 'unknown') or 'unknown'
        staleness_days = stock.get('staleness_days')
        price_source = stock.get('price_source', 'daily') or 'daily'
        live_price = stock.get('live_price')
        daily_price = stock.get('daily_price')

        # لو البيانات قديمة جداً → نضيف تحذير صريح في reason + status = stale_data
        if stock.get('data_stale') and staleness_days and staleness_days > 1:
            stale_note = f' | ⚠️ DATA STALE ({staleness_days}d, src={price_source}, date={data_date})'
            full_reason = (full_reason + stale_note)[:500]
            # لو قديم جداً (>3 أيام) → status=stale_data بدلاً من pending
            initial_status = 'stale_data' if staleness_days > 3 else 'pending'
        else:
            initial_status = 'pending'

        conn.execute("""
            INSERT INTO radar_signal_tracking
                (ticker, signal_date, signal_type, entry_price, path, reason, status,
                 data_date, data_quality, staleness_days, price_source, live_price, daily_price,
                 source)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'maker_radar')
        """, (ticker, scan_date, signal_type, entry_price, path, full_reason[:500], initial_status,
              data_date, data_quality, staleness_days, price_source, live_price, daily_price))
        inserted += 1

    conn.commit()
    conn.close()
    log(f"📝 Signal tracking: {inserted} signals saved to radar_signal_tracking (date={scan_date})")


# ============================================================================
# BRAVO-INCUBATOR: محرك "رادار التربص والتحضير" (The Incubator & Stalking Engine)
# يكشف الأسهم التي حققت 4/6 أو 5/6 إشارات (قيد التسخين) ويستخرج الشرط الناقص
# ============================================================================
def extract_missing_trigger(stock_data: dict) -> dict:
    """استخراج وتوصيف الشرط الناقص لسهم قيد التسخين (Incubator candidate).

    Args:
        stock_data: نتيجة سهم من analyze_stock (تحتوي quiet_details أو pre_surge_details)

    Returns:
        dict: {type, condition_ar, trigger_price, distance_to_trigger_pct}
        - type: 'VOLUME_SURGE' | 'RESISTANCE_BREAK' | 'SUPPORT_CONFIRM' | None
        - condition_ar: وصف الشرط بالعربية
        - trigger_price: سعر التفعيل (None لـ VOLUME_SURGE)
        - distance_to_trigger_pct: المسافة للهدف %
    """
    path = stock_data.get('path', '')
    current_price = stock_data.get('current_price', 0) or 0

    # حدد أي details نستخدم
    details = None
    total_signals = 6  # quiet default
    if path in ('B_quiet_accumulation_strong', 'C_quiet_accumulation_weak', 'A_quiet_accumulation'):
        details = stock_data.get('quiet_details') or {}
        total_signals = 6
    elif path == 'A_pre_surge':
        details = stock_data.get('pre_surge_details') or {}
        total_signals = 4
    else:
        # محاولة fallback: نستخدم أي details متاحة
        details = stock_data.get('quiet_details') or stock_data.get('pre_surge_details') or {}
        total_signals = 6 if stock_data.get('quiet_details') else 4

    if not details:
        return {
            'type': None,
            'condition_ar': 'لا توجد بيانات إشارات كافية',
            'trigger_price': None,
            'distance_to_trigger_pct': None,
        }

    signals_failed = details.get('signals_failed', [])
    if not signals_failed:
        # كل الإشارات متحققة → مش incubator (سهم كامل)
        return {
            'type': None,
            'condition_ar': 'كل الإشارات متحققة — سهم جاهز للشراء',
            'trigger_price': None,
            'distance_to_trigger_pct': None,
        }

    # خذ أول إشارة ساقطة
    first_failed = signals_failed[0].lower()

    # حدد trigger_type بناءً على الإشارة الساقطة
    # Rule 2: لو الإشارة الناقصة هي no_distribution → مرفوض (سهم في تصريف)
    if 'no_distribution' in first_failed or 'distribution' in first_failed:
        return {
            'type': None,
            'condition_ar': 'مرفوض — السهم في مرحلة تصريف',
            'trigger_price': None,
            'distance_to_trigger_pct': None,
        }

    # Rule: لو not_explosive ساقطة → السهم انفجر بالفعل (مش incubator)
    if 'not_explosive' in first_failed or 'explosive' in first_failed:
        return {
            'type': None,
            'condition_ar': 'السهم انفجر بالفعل — انتقل لمسار الانفجار',
            'trigger_price': None,
            'distance_to_trigger_pct': None,
        }

    # 1. VOLUME_SURGE: لو الإشارة الناقصة volume_high_recurring أو volume_not_low أو volume_gradient
    if 'volume_high_recurring' in first_failed or 'volume_not_low' in first_failed or 'volume_gradient' in first_failed:
        return {
            'type': 'VOLUME_SURGE',
            'condition_ar': 'بانتظار شمعة فوليوم تأكيدية تخترق 1.5x متوسط 20 يوم',
            'trigger_price': None,
            'distance_to_trigger_pct': None,
        }

    # 2. RESISTANCE_BREAK: لو الإشارة الناقصة compressed أو range_compressed
    #    السهم محتاج يكسر المقاومة (أعلى قمة أخيرة)
    if 'compressed' in first_failed or 'range_compressed' in first_failed:
        # trigger_price = أعلى قمة في آخر 10 أيام (resistance)
        # نحاول نحسبها من البيانات المتاحة في stock_data
        trigger_price = None
        # لو عندنا range_10d_pct → نقدر نحسب تقريبي
        range_pct = details.get('range_10d_pct')
        if range_pct is not None and current_price > 0:
            # تقريبي: max_10 = current_price * (1 + range_pct/200)
            trigger_price = round(current_price * (1 + range_pct / 200), 2)
        if trigger_price is None or trigger_price <= current_price:
            trigger_price = round(current_price * 1.03, 2)  # fallback: +3%

        distance_pct = round(((trigger_price - current_price) / current_price) * 100, 2) if current_price > 0 else None
        return {
            'type': 'RESISTANCE_BREAK',
            'condition_ar': f'بانتظار اختراق وتأكيد أعلى {trigger_price}',
            'trigger_price': trigger_price,
            'distance_to_trigger_pct': distance_pct,
        }

    # 3. SUPPORT_CONFIRM: لو الإشارة الناقصة buy_pressure أو buy_days أو price_near_ma
    #    السهم محتاج يثبت فوق الدعم
    if 'buy_pressure' in first_failed or 'buy_days' in first_failed or 'price_near_ma' in first_failed:
        # trigger_price = أدنى قاع في آخر 10 أيام (support)
        trigger_price = None
        range_pct = details.get('range_10d_pct')
        if range_pct is not None and current_price > 0:
            # تقريبي: min_10 = current_price * (1 - range_pct/200)
            trigger_price = round(current_price * (1 - range_pct / 200), 2)
        if trigger_price is None or trigger_price >= current_price:
            trigger_price = round(current_price * 0.97, 2)  # fallback: -3%

        distance_pct = round(((trigger_price - current_price) / current_price) * 100, 2) if current_price > 0 else None
        return {
            'type': 'SUPPORT_CONFIRM',
            'condition_ar': f'بانتظار استقرار السعر أعلى دعم {trigger_price}',
            'trigger_price': trigger_price,
            'distance_to_trigger_pct': distance_pct,
        }

    # fallback: إشارة غير معروفة
    return {
        'type': 'VOLUME_SURGE',
        'condition_ar': f'بانتظار تأكيد إشارة إضافية ({first_failed})',
        'trigger_price': None,
        'distance_to_trigger_pct': None,
    }


def build_incubator_candidates(results: list) -> list:
    """بناء قائمة incubator_candidates من نتائج الفحص.

    incubator_candidates = أسهم حققت 4/6 أو 5/6 إشارات (قيد التسخين) في مسار
    B_quiet_accumulation_strong أو A_pre_surge، وغير في مرحلة تصريف.

    Rule 1 (no hardcoded readiness): readiness_pct = (passed / total) * 100
    Rule 2 (no distribution): ممنوع إدخال أسهم في مسار تصريف
    Rule 3 (real OHLCV): التريجر مرتبط بسعر/فوليوم حقيقي

    Args:
        results: قائمة كل نتائج الفحص (all_results)

    Returns:
        list of incubator candidate dicts matching the API Response Contract
    """
    candidates = []

    for stock in results:
        path = stock.get('path', '')

        # Rule 2: ممنوع أسهم في تصريف
        if stock.get('distribution_flag'):
            continue
        if path == 'distribution':
            continue

        # حدد details + total_signals
        details = None
        total_signals = 6
        if path in ('B_quiet_accumulation_strong', 'C_quiet_accumulation_weak', 'A_quiet_accumulation'):
            details = stock.get('quiet_details')
            total_signals = 6
        elif path == 'A_pre_surge':
            details = stock.get('pre_surge_details')
            total_signals = 4
        else:
            # fallback: نجرّب quiet_details الأول
            details = stock.get('quiet_details')
            if details:
                total_signals = 6
            else:
                details = stock.get('pre_surge_details')
                if details:
                    total_signals = 4

        if not details:
            continue

        signals_passed = details.get('signal_count', 0)
        if signals_passed < 4:
            continue  # محتاج على الأقل 4/6 أو 3/4

        # Rule 1: readiness_pct = (passed / total) * 100 — رياضي، مش hardcoded
        readiness_pct = round((signals_passed / total_signals) * 100)

        # لو 100% → سهم كامل (مش incubator)
        if readiness_pct >= 100:
            continue

        # استخرج الشرط الناقص
        trigger = extract_missing_trigger(stock)

        # لو trigger type = None (مرفوض أو سهم كامل) → skip
        if trigger.get('type') is None:
            continue

        # خذ passed_reasons من signals_met
        signals_met = details.get('signals_met', [])
        # حوّل لأسباب عربية مختصرة
        passed_reasons = []
        reason_map = {
            'volume_high_recurring': 'حجم متكرر فوق المتوسط',
            'volume_not_low': 'سيولة متدفقة مقبولة',
            'buy_pressure': 'ضغط شرائي مؤسسي',
            'compressed': 'انضغاط سعري (تجميع صامت)',
            'not_explosive': 'غياب الانفجار المبكر',
            'no_distribution': 'غياب تام لمظاهر التصريف',
            'volume_gradient': 'تدرج حجمي صاعد',
            'range_compressed': 'نطاق سعري محبوس',
            'buy_days': 'أيام شراء متماسكة',
            'price_near_ma': 'سعر قريب من المتوسط المتحرك',
        }
        for sig in signals_met:
            for key, reason_ar in reason_map.items():
                if key in sig.lower():
                    passed_reasons.append(reason_ar)
                    break

        # entry/stop/target من stock_data
        entry = stock.get('entry_price') or stock.get('current_price', 0)
        stop = stock.get('stop_loss', 0)
        target = stock.get('target_price', 0)

        # R/R calculation
        risk = entry - stop if entry > stop else 0
        reward = target - entry if target > entry else 0
        risk_reward = round(reward / risk, 1) if risk > 0 else 0

        candidate = {
            'ticker': stock.get('ticker', ''),
            'name_ar': stock.get('name_ar') or stock.get('ticker', ''),
            'current_price': stock.get('current_price', 0),
            'readiness_pct': readiness_pct,
            'signals_passed': signals_passed,
            'total_signals': total_signals,
            'passed_reasons': passed_reasons,
            'trigger': trigger,
            'target_if_promoted': target,
            'stop_loss_if_promoted': stop,
            'risk_reward': risk_reward,
            'stage': 'HEATING_UP',
            'path': path,
        }
        candidates.append(candidate)

    # ترتيب: أعلى readiness أول
    candidates.sort(key=lambda c: -c['readiness_pct'])
    return candidates


# ============================================================================
# B3 — JSON DATA CONTRACT (Task 2-a)
# ============================================================================
# Problem: the legacy scan loop dropped tickers whose scan_ticker() returned
# None (insufficient history) OR whose current_price was below --min-price.
# The final JSON carried only the categorized lists (quiet_list, etc.) plus
# `all_results` (which was already filtered by min_price). The API route
# (route.ts) read only the categorized lists — so ~316 of 347 scanned
# stocks vanished from the UI.
#
# Fix: every scanned ticker now produces a `contract_result` entry with:
#   - classification: one of
#       quiet_accumulation | distribution | dead_trap | liquidity_drought |
#       rule80_downtrend | unclassified | DATA_INVALID | INSUFFICIENT_DATA
#   - reasons: list[str] (machine+human readable)
#   - data_quality: lowercase enum (existing convention — backward compat
#       with src/modules/predictions/components/maker-radar/types.ts):
#       'fresh' | 'stale' | 'very_stale' | 'unknown'
#       extended with NEW values: 'invalid' | 'unavailable'
#   - data_quality_status: uppercase enum (NEW field — normalized):
#       'OK' | 'STALE' | 'INVALID' | 'UNAVAILABLE'
#   - scan_timestamp: ISO datetime
#   - ticker, company, market, currency, plus existing metric fields
# The legacy list keys (quiet_list, pre_surge_list, explosive_list,
# early_break_list, distribution_list, under_microscope, all_results) are
# PRESERVED as-is for backward compatibility.
# NEW list keys (dead_trap_list, liquidity_drought_list, rule80_downtrend_list)
# are subsets of `results` whose classification matches.
# ============================================================================

# Allowed classification values (B3 contract — Task 2-a)
B3_CLASSIFICATIONS = (
    'quiet_accumulation',
    'distribution',
    'dead_trap',
    'liquidity_drought',
    'rule80_downtrend',
    'unclassified',
    'DATA_INVALID',
    'INSUFFICIENT_DATA',
    'SCANNER_ALERT',  # RADAR-FIX: scanner-based detection (no historical analysis)
)

# Allowed data_quality (lowercase — backward compat with existing TS consumer)
B3_DATA_QUALITY_LEGACY = ('fresh', 'stale', 'very_stale', 'unknown', 'invalid', 'unavailable')

# Allowed data_quality_status (uppercase — new normalized enum)
B3_DATA_QUALITY_STATUS = ('OK', 'STALE', 'INVALID', 'UNAVAILABLE')


def _normalize_data_quality_status(legacy_dq: str) -> str:
    """Map the legacy lowercase data_quality value to the new uppercase enum."""
    if legacy_dq == 'fresh':
        return 'OK'
    if legacy_dq in ('stale', 'very_stale'):
        return 'STALE'
    if legacy_dq == 'invalid':
        return 'INVALID'
    if legacy_dq == 'unavailable':
        return 'UNAVAILABLE'
    # unknown / unmapped → OK (fail-open; do not fabricate invalidity)
    return 'OK'


def _build_insufficient_result(
    ticker: str,
    identity: dict,
    scan_timestamp: str,
    reason: str,
    *,
    data_quality: str = 'unavailable',
    data_quality_status: str = 'UNAVAILABLE',
    extra_reasons: list = None,
) -> dict:
    """Build a minimal result entry for a ticker that could NOT be classified
    (insufficient history, scan failure, or B1 price sanity failure).

    These entries surface as classification='INSUFFICIENT_DATA' or 'DATA_INVALID'
    so the UI can show "DATA UNAVAILABLE" instead of silently dropping the stock.
    """
    reasons = [reason] + (extra_reasons or [])
    return {
        'ticker': ticker,
        'company': identity.get('name_ar') or identity.get('name') or ticker,
        'name_ar': identity.get('name_ar') or identity.get('name') or ticker,
        'market': identity.get('market') or '',
        'currency': identity.get('currency') or '',
        'scan_timestamp': scan_timestamp,
        'classification': 'DATA_INVALID' if data_quality == 'invalid' else 'INSUFFICIENT_DATA',
        'reasons': reasons,
        'data_quality': data_quality,
        'data_quality_status': data_quality_status,
        # Existing metric fields set to None (so the shape is consistent)
        'current_price': None,
        'entry_price': None,
        'stop_loss': None,
        'target_price': None,
        'change_1d': None,
        'change_percent': None,
        'price_bucket': None,
        'last_close_date': '',
        'staleness_days': None,
        'data_stale': False,
        'avg_turnover_20d': 0,
        'avg_volume_20d': 0,
        'avg_volume_10d': 0,
        'volume_ratio_10d_vs_20d': 0,
        'turnover_egp': 0,
        'price_action': 'INSUFFICIENT_DATA',
        'price_action_evidence': {'reason': reason},
        'participant_flow_assessment': 'UNAVAILABLE',
        'participant_evidence_level': 'UNAVAILABLE',
        'participant_evidence': {'reason': 'no_data'},
        'continuation_assessment': 'INSUFFICIENT_DATA',
        'data_quality_status': data_quality_status,
        'data_quality_reasons': reasons,
        'classification_timestamp': scan_timestamp,
        'volume': 0,
        'price_stability': 0,
        'range_10d_pct': 0,
        'roc_10d': None,
        'roc_30d': None,
        'maker_activity': None,
        'accumulation': None,
        'correction_status': None,
        'drop_from_peak': None,
        'expected': None,
        'buy_days': 0,
        'sell_days': 0,
        'buy_pct': 0,
        'sell_pct': 0,
        'net_flow_egp': 0,
        'buy_value_m': 0,
        'sell_value_m': 0,
        'liquidity_state': None,
        'money_flow_state': None,
        'life_cycle': None,
        'limit_up_trap': False,
        'kill_switch': False,
        'kill_reason': None,
        'under_microscope': False,
        'path': None,
        'position_size': 0.0,
        'reason': reason,
        'distribution_flag': False,
        'pre_surge_details': None,
        'quiet_details': None,
        'explosive_details': None,
        'break_reason': None,
        'data_date': '',
        'price_source': None,
        'live_price': None,
        'live_change_percent': None,
        'live_last_update': None,
        'daily_price': None,
        'sanity_status': data_quality_status,
    }


def _classify_scanned_result(result: dict, args) -> str:
    """Assign a B3 classification to a successfully-scanned stock.

    Priority order (most severe first):
      1. distribution_flag / path=='distribution' → 'distribution'
      2. limit_up_trap → 'dead_trap'
      3. kill_switch → 'dead_trap'
      4. severe liquidity drought (avg_turnover_20d below floor) → 'liquidity_drought'
      5. strong downtrend (drop_from_peak < -20%) → 'rule80_downtrend'
      6. accumulation path (any of A_pre_surge, B/C/A_quiet_accumulation,
         D/B_explosive_surge, E/C_early_break) → 'quiet_accumulation'
      7. otherwise → 'unclassified'
    """
    path = result.get('path') or ''
    # 0. SCANNER_ALERT (radar-fix: scanner-based detection, no historical analysis)
    if path == 'F_scanner_alert' or result.get('classification') == 'SCANNER_ALERT':
        return 'SCANNER_ALERT'
    # 1. distribution
    if path == 'distribution' or result.get('distribution_flag'):
        return 'distribution'
    # 2. limit-up trap (pump-and-dump pattern)
    if result.get('limit_up_trap'):
        return 'dead_trap'
    # 3. kill switch (severe candle contamination)
    if result.get('kill_switch'):
        return 'dead_trap'
    # 4. liquidity drought — very low 20d turnover (below 100k EGP/USD floor)
    avg_turnover = result.get('avg_turnover_20d') or 0
    if avg_turnover < 100_000:
        return 'liquidity_drought'
    # 5. rule80 downtrend — fell > 20% from 20-day peak
    drop = result.get('drop_from_peak')
    if drop is not None and drop < -20:
        return 'rule80_downtrend'
    # 6. accumulation (any bullish path)
    if path in (
        'A_pre_surge',
        'B_quiet_accumulation_strong', 'C_quiet_accumulation_weak', 'A_quiet_accumulation',
        'D_explosive_surge', 'B_explosive_surge',
        'E_early_break', 'C_early_break',
    ):
        return 'quiet_accumulation'
    # 7. unclassified (scanned OK, no condition met)
    return 'unclassified'


def _enrich_result_with_b3_fields(
    result: dict,
    identity: dict,
    args,
    scan_timestamp: str,
) -> dict:
    """Add B3 fields (classification, reasons, data_quality_status, scan_timestamp,
    company, market, currency) to a scan_ticker result dict IN-PLACE.

    Returns the same dict (for chaining).
    """
    ticker = result.get('ticker', '')
    # Identity enrichment
    result['company'] = identity.get('name_ar') or identity.get('name') or ticker
    result['name_ar'] = identity.get('name_ar') or identity.get('name') or ticker
    result['market'] = identity.get('market') or (args.market.upper() if args else 'EGX')
    result['currency'] = identity.get('currency') or ''
    result['scan_timestamp'] = scan_timestamp
    # Classification
    classification = _classify_scanned_result(result, args)
    result['classification'] = classification
    # Reasons (array)
    reasons = []
    if result.get('reason'):
        reasons.append(str(result['reason']))
    if result.get('distribution_flag'):
        reasons.append(f'distribution_flag:net_flow_egp={result.get("net_flow_egp", 0):.0f}')
    if result.get('limit_up_trap'):
        reasons.append('limit_up_trap')
    if result.get('kill_switch'):
        reasons.append(f'kill_switch:{result.get("kill_reason", "") or "triggered"}')
    if classification == 'liquidity_drought':
        reasons.append(f'low_turnover_20d:{result.get("avg_turnover_20d", 0):.0f}')
    if classification == 'rule80_downtrend':
        reasons.append(f'drop_from_peak:{result.get("drop_from_peak", 0):.1f}%')
    if classification == 'quiet_accumulation':
        reasons.append(f'path:{result.get("path", "")}')
    if classification == 'unclassified':
        reasons.append('no_path_matched')
    result['reasons'] = reasons
    # data_quality_status (uppercase, normalized)
    legacy_dq = result.get('data_quality', 'unknown') or 'unknown'
    if legacy_dq not in B3_DATA_QUALITY_LEGACY:
        # Map new lowercase values too
        legacy_dq = legacy_dq.lower() if legacy_dq.lower() in B3_DATA_QUALITY_LEGACY else 'unknown'
    result['data_quality'] = legacy_dq
    result['data_quality_status'] = _normalize_data_quality_status(legacy_dq)
    return result


def _build_summary(
    results: list,
    source_count: int,
    scan_timestamp: str,
) -> dict:
    """Build the B3 `summary` block."""
    scanned_count = len(results)
    valid_data_count = sum(
        1 for r in results
        if r.get('classification') not in ('DATA_INVALID', 'INSUFFICIENT_DATA', 'SCANNER_ALERT')
    )
    data_error_count = sum(
        1 for r in results
        if r.get('classification') in ('DATA_INVALID', 'INSUFFICIENT_DATA')
    )
    classified_count = sum(
        1 for r in results
        if r.get('classification') not in ('unclassified', 'DATA_INVALID', 'INSUFFICIENT_DATA')
    )
    unclassified_count = sum(
        1 for r in results
        if r.get('classification') == 'unclassified'
    )
    return {
        'source_count': source_count,
        'scanned_count': scanned_count,
        'valid_data_count': valid_data_count,
        'classified_count': classified_count,
        'unclassified_count': unclassified_count,
        'data_error_count': data_error_count,
        'scan_timestamp': scan_timestamp,
    }


def main():
    parser = argparse.ArgumentParser(description='رادار الميكرز اليومي')
    parser.add_argument('--limit', type=int, default=0, help='0 = كل الأسهم')
    parser.add_argument('--market', type=str, default='EGX',
                        help='فلتر السوق (EGX, TADAWUL, KSE, QSE, US, CRYPTO, GOLD, ALL)')
    parser.add_argument('--tickers', type=str, default='',
                        help='قائمة tickers مفصولة بفواصل (مفيد للأسواق الكبيرة مثل US: AAPL,MSFT,NVDA)')
    parser.add_argument('--min-quiet-signals', type=int, default=5,
                        help='حد أدنى للإشارات في Quiet Accumulation (default 5/6)')
    parser.add_argument('--min-price', type=float, default=1.0,
                        help='استبعاد الأسهم تحت ده السعر (default 1.0)')
    parser.add_argument('--json-only', action='store_true')
    args = parser.parse_args()

    # Rule 67 (root-cause fix, Task 35-A): Discover the DB based on
    # `--market` AFTER argparse — previously the call ran at module-load
    # time and always defaulted to EGX. This was the root cause of the
    # multi-market radar showing "0 سهم" for TADAWUL/KSE/QSE/US/CRYPTO/GOLD.
    global PROD_DB, PROD_TABLE, TICKER_COL, PRICE_COL, VOL_COL, TURN_COL
    global DATE_COL, OPEN_COL, HIGH_COL, LOW_COL, DB_SOURCE_ID
    (
        PROD_DB, PROD_TABLE, TICKER_COL, PRICE_COL, VOL_COL, TURN_COL,
        DATE_COL, OPEN_COL, HIGH_COL, LOW_COL,
    ) = _find_radar_db(args.market)
    DB_SOURCE_ID = f"{PROD_DB.name}::{PROD_TABLE}" if PROD_DB else None

    log("═══ رادار الميكرز اليومي (نظيف) ═══")
    log(f"  Market filter: {args.market}")
    log(f"  DB config: {PROD_DB} (table={PROD_TABLE})")
    log(f"  Min Quiet signals: {args.min_quiet_signals}/6")
    log(f"  Min price: {args.min_price}")

    if not PROD_DB or not PROD_DB.exists():
        log("❌ مفيش DB متاح. جرّب:")
        log("   - sandbox: شغّل scripts/fetch_production_data.py")
        log("   - production: تأكد إن db/stocks.db أو db/data_engine.db موجود")
        log(f"   - للأسواق غير EGX: تأكد إن db/data_engine.db فيه الجدول المطلوب")
        return 1

    log(f"  DB: {PROD_DB.name} (table: {PROD_TABLE})")
    log(f"  DB source id: {DB_SOURCE_ID}")

    # Phase 7.1 / B3-fix: use get_connection() (raw). The previous
    # `db_manager.connection(...).__enter__()` pattern leaks the contextmanager
    # object → GC closes the conn mid-function ("Cannot operate on a closed database").
    from core.db_manager import db_manager
    conn = db_manager.get_connection(str(PROD_DB), writable=False)
    conn.row_factory = sqlite3.Row

    # Rule 67 (Task 35-A): تحقق إن الجدول المطلوب موجود فعلاً. ممكن الـ DB
    # file يكون موجود بس يكون ناقص جدول معين (مثلاً data_engine.db فيه
    # crypto_prices + gold_prices بس historical_data مش موجود). في الحالة
    # دي، نطبع رسالة خطأ واضحة بدل ما نـ crash في SELECT.
    table_exists = bool(conn.execute(
        "SELECT name FROM sqlite_master WHERE type='table' AND name=?",
        (PROD_TABLE,),
    ).fetchone())
    if not table_exists:
        log(f"❌ الجدول '{PROD_TABLE}' مش موجود في {PROD_DB.name}.")
        available_tables = [r[0] for r in conn.execute(
            "SELECT name FROM sqlite_master WHERE type='table'"
        ).fetchall()]
        log(f"   الجداول المتاحة: {available_tables}")
        log(f"   للسوق {args.market}: شغّل الـ scraper المناسب (مثلاً multi_market_scraper.py) لتعبئة الجدول.")
        conn.close()
        return 1

    # Rule 67 (Task 35-A): تأكد إن كل الأعمدة المطلوبة موجودة في الجدول.
    # في الإنتاج: crypto_prices / gold_prices / historical_data بـ يشتغلوا
    # بـ schema موحّد (symbol, date, open, high, low, close, volume).
    # في الساندبوكس: جداول بنفس الاسم بس schema مختلف — نطبع رسالة واضحة
    # بدل ما نـ crash في SELECT.
    expected_cols = [
        ('ticker_col', TICKER_COL), ('price_col', PRICE_COL),
        ('vol_col', VOL_COL), ('date_col', DATE_COL),
        ('open_col', OPEN_COL), ('high_col', HIGH_COL), ('low_col', LOW_COL),
    ]
    actual_cols = {r[1] for r in conn.execute(f"PRAGMA table_info({PROD_TABLE})").fetchall()}
    missing = [(label, c) for label, c in expected_cols if c and c not in actual_cols]
    if missing:
        log(f"❌ الجدول '{PROD_TABLE}' موجود بس ناقص أعمدة مطلوبة:")
        for label, c in missing:
            log(f"   - {label}={c!r} غير موجود")
        log(f"   الأعمدة الموجودة: {sorted(actual_cols)}")
        log(f"   للسوق {args.market}: الـ schema اللي بنتوقعّه = "
            f"(symbol, date, open, high, low, close, volume) — شغّل الـ scraper المناسب.")
        conn.close()
        return 1

    # تحقق من وجود index على (ticker, date) — لو مش موجود، حذّر في الـ log
    try:
        idx_rows = conn.execute(f"PRAGMA index_list({PROD_TABLE})").fetchall()
        idx_names = [r[1] for r in idx_rows]
        log(f"  Indexes on {PROD_TABLE}: {idx_names if idx_names else '(none — will be slow!)'}")
    except Exception:
        pass

    # فلتر السوق (EGX افتراضياً)
    # محاولة JOIN مع stocks table (لو موجود) — fallback لكل الأسهم لو مفيش stocks table
    has_stocks_table = bool(conn.execute(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='stocks'"
    ).fetchone())

    # ─── Rule 67 (Task 35-A): market-aware symbol filtering ──────────────
    # For CRYPTO/GOLD the price table (crypto_prices / gold_prices) is
    # market-specific — every row belongs to the requested market. We just
    # SELECT DISTINCT symbol and move on (no JOIN needed).
    #
    # For TADAWUL/KSE/QSE/US the price table is `historical_data` (a shared
    # multi-market table). We MUST filter symbols by market. Two strategies:
    #   (1) If the price DB itself has a `stocks` table → JOIN in-DB (fast).
    #   (2) Else, open db/stocks.db separately (cross-DB) and filter with
    #       `WHERE symbol IN (?,?,...)`. This is the case on production where
    #       historical_data lives in db/data_engine.db but the market→ticker
    #       mapping lives in db/stocks.db.stocks.
    market_upper = (args.market or '').strip().upper()
    is_market_specific_table = market_upper in ('CRYPTO', 'GOLD')

    def _lookup_market_tickers_cross_db(market_values):
        """افتح db/stocks.db بشكل منفصل عشان نجيب قائمة tickers لـ market.
        بـ يستخدم cross-DB lookup لأن JOIN cross-DB مش مدعوم في sqlite بدون ATTACH.
        بـ يدعم stocks table مع ticker_col اسمه 'ticker' أو 'symbol'.
        """
        stocks_db_path = PROJECT_ROOT / 'db' / 'stocks.db'
        if not stocks_db_path.exists():
            return []
        try:
            # Phase 7.1 / B3-fix: use get_connection() (raw).
            from core.db_manager import db_manager
            sconn = db_manager.get_connection(str(stocks_db_path), writable=False)
            sconn.row_factory = sqlite3.Row
            # اكتشف ticker col (ticker أو symbol)
            cols = [r[1] for r in sconn.execute("PRAGMA table_info(stocks)").fetchall()]
            ticker_col_name = None
            for cand in ('ticker', 'symbol'):
                if cand in cols:
                    ticker_col_name = cand
                    break
            if not ticker_col_name:
                sconn.close()
                return []
            placeholders = ','.join(['?' for _ in market_values])
            # PURGE-FIX (2026-10-22): filter is_active=1 — skip corrupted/deactivated tickers
            rows = sconn.execute(
                f"SELECT {ticker_col_name} FROM stocks WHERE market IN ({placeholders}) AND (is_active = 1 OR is_active IS NULL)",
                market_values,
            ).fetchall()
            sconn.close()
            return [r[0] for r in rows if r[0]]
        except Exception as e:
            log(f"  ⚠️ cross-DB lookup فشل ({e})")
            return []

    # ─── دعم --tickers: قائمة صريحة من tickers (مفيد للأسواق الكبيرة مثل US)
    if args.tickers:
        explicit_tickers = [t.strip().upper() for t in args.tickers.split(',') if t.strip()]
        log(f"  استخدام قائمة tickers صريحة: {len(explicit_tickers)} ticker")
        tickers = explicit_tickers
    elif args.market.upper() == 'ALL':
        tickers = [r[0] for r in conn.execute(f"""
            SELECT DISTINCT {TICKER_COL} FROM {PROD_TABLE}
        """).fetchall()]
    elif is_market_specific_table:
        # CRYPTO / GOLD — كل الأسطر بتنتمي للسوق. GROUP BY symbol عشان
        # نتجنب التكرار ونضمن إن كل coin/metal يتفحص مرة واحدة.
        tickers = [r[0] for r in conn.execute(f"""
            SELECT DISTINCT {TICKER_COL} FROM {PROD_TABLE}
            WHERE {TICKER_COL} IS NOT NULL AND {TICKER_COL} != ''
        """).fetchall()]
        log(f"  market-specific table ({PROD_TABLE}) — {len(tickers)} symbol (no JOIN needed)")
    elif has_stocks_table:
        # في نفس الـ DB فيه stocks table — JOIN محلي (EGX path).
        # الـ ticker column في stocks table اسمه 'symbol' (نفس الـ egksco_price_history)
        # ملاحظة: data_engine.db.stocks بـ يستخدم 'مصر' (عربي) بدل 'EGX'
        # فعشان كده بنعمل mapping للقيمتين
        market_variants = {
            'EGX': ['EGX', 'مصر'],
            'TADAWUL': ['TADAWUL', 'السعودية', 'KSA'],
            'KSE': ['KSE', 'الكويت'],
            'QSE': ['QSE', 'قطر'],
            'US': ['US', 'أمريكا', 'الولايات المتحدة'],
            'CRYPTO': ['CRYPTO', 'كريبتو'],
            'GOLD': ['GOLD', 'ذهب'],
        }
        market_values = market_variants.get(args.market.upper(), [args.market.upper()])
        placeholders = ','.join(['?' for _ in market_values])
        try:
            stock_cols = [c[1] for c in conn.execute("PRAGMA table_info(stocks)").fetchall()]
            stock_col = 'ticker' if 'ticker' in stock_cols else 'symbol'
            tickers = [r[0] for r in conn.execute(f"""
                SELECT DISTINCT p.{TICKER_COL} FROM {PROD_TABLE} p
                JOIN stocks s ON p.{TICKER_COL} = s.{stock_col}
                WHERE s.market IN ({placeholders})
            """, market_values).fetchall()]
            if not tickers:
                # If market filter yielded nothing from stocks table, try selecting directly from PROD_TABLE
                tickers = [r[0] for r in conn.execute(f"""
                    SELECT DISTINCT {TICKER_COL} FROM {PROD_TABLE}
                """).fetchall()]
        except Exception as e:
            log(f"  ⚠️ JOIN فشل ({e}) — fallback لكل الأسهم")
            tickers = [r[0] for r in conn.execute(f"""
                SELECT DISTINCT {TICKER_COL} FROM {PROD_TABLE}
            """).fetchall()]
            # RADAR-FIX: also include tickers from stocks table (scanner data)
            # This ensures newly-scanned stocks appear in the radar even if
            # they were just added to stock_daily_prices today.
            try:
                stocks_conn = sqlite3.connect(str(PROJECT_ROOT / 'db' / 'stocks.db'))
                scanner_tickers = [r[0] for r in stocks_conn.execute(
                    "SELECT DISTINCT symbol FROM stocks WHERE market = 'egypt'"
                ).fetchall()]
                stocks_conn.close()
                # Merge: add scanner tickers that aren't already in the list
                existing = set(tickers)
                for t in scanner_tickers:
                    if t not in existing:
                        tickers.append(t)
                        existing.add(t)
                if scanner_tickers:
                    log(f"  + {len(scanner_tickers)} tickers from stocks table (scanner)")
            except Exception:
                pass  # non-fatal — continue with PROD_TABLE tickers only
    else:
        # TADAWUL/KSE/QSE/US مع historical_data في db/data_engine.db —
        # مفيش stocks table في نفس الـ DB. اعمل cross-DB lookup في
        # db/stocks.db عشان نجيب قائمة tickers، ثم فلتر بـ IN (...).
        market_variants = {
            'EGX': ['EGX', 'مصر'],
            'TADAWUL': ['TADAWUL', 'السعودية', 'KSA'],
            'KSE': ['KSE', 'الكويت'],
            'QSE': ['QSE', 'قطر'],
            'US': ['US', 'أمريكا', 'الولايات المتحدة'],
            'CRYPTO': ['CRYPTO', 'كريبتو'],
            'GOLD': ['GOLD', 'ذهب'],
        }
        market_values = market_variants.get(args.market.upper(), [args.market.upper()])
        cross_db_tickers = _lookup_market_tickers_cross_db(market_values)
        if cross_db_tickers:
            log(f"  cross-DB lookup: {len(cross_db_tickers)} ticker من db/stocks.db للسوق {args.market}")
            # فلتر historical_data بـ symbol IN (?,?,...) — batch كل 900 عشان نتجنب
            # SQLite parameter limit (default 999).
            tickers = []
            batch_size = 900
            for i in range(0, len(cross_db_tickers), batch_size):
                batch = cross_db_tickers[i:i + batch_size]
                placeholders = ','.join(['?' for _ in batch])
                rows = conn.execute(
                    f"SELECT DISTINCT {TICKER_COL} FROM {PROD_TABLE} "
                    f"WHERE {TICKER_COL} IN ({placeholders})",
                    batch,
                ).fetchall()
                tickers.extend(r[0] for r in rows if r[0])
            # dedupe while preserving order
            seen_t = set()
            tickers = [t for t in tickers if not (t in seen_t or seen_t.add(t))]
        else:
            # مفيش stocks.db ولا عندنا ticker list — fallback لكل الأسهم
            # مع تحذير واضح (Rule 67 — no silent lie).
            log(f"  ⚠️ مفيش stocks.db ولا ticker list للسوق {args.market} — fallback لكل الأسهم في {PROD_TABLE}")
            log(f"  ⚠️ ده قد يرجّع نتائج من أسواق تانية. شغّل --tickers لتحديد دقيق.")
            tickers = [r[0] for r in conn.execute(f"""
                SELECT DISTINCT {TICKER_COL} FROM {PROD_TABLE}
            """).fetchall()]
            # RADAR-FIX: also include tickers from stocks table (scanner data)
            # This ensures newly-scanned stocks appear in the radar even if
            # they were just added to stock_daily_prices today.
            try:
                stocks_conn = sqlite3.connect(str(PROJECT_ROOT / 'db' / 'stocks.db'))
                scanner_tickers = [r[0] for r in stocks_conn.execute(
                    "SELECT DISTINCT symbol FROM stocks WHERE market = 'egypt'"
                ).fetchall()]
                stocks_conn.close()
                # Merge: add scanner tickers that aren't already in the list
                existing = set(tickers)
                for t in scanner_tickers:
                    if t not in existing:
                        tickers.append(t)
                        existing.add(t)
                if scanner_tickers:
                    log(f"  + {len(scanner_tickers)} tickers from stocks table (scanner)")
            except Exception:
                pass  # non-fatal — continue with PROD_TABLE tickers only
    if args.limit > 0:
        tickers = tickers[: args.limit]
    log(f"  فحص {len(tickers)} سهم (market={args.market})...")

    # ─── B3 (Task 2-a): capture the SOURCE count BEFORE any filtering. ──
    # The owner's hard constraint: "DO NOT assume 347 is fixed — the count
    # must come from the actual source scanned in the current run."
    source_count = len(tickers)
    scan_timestamp = datetime.now().isoformat()

    # ─── إحساس وضع السوق عبر MarketRegimeEngine الموجود ─────────────────
    regime_name = "NORMAL"
    regime_details = {}
    try:
        from analyzers.market_regime_engine import MarketRegimeEngine
        m_key = 'EGX' if args.market.upper() in ('EGX', 'ALL') else args.market.upper()
        engine = MarketRegimeEngine(market=m_key)
        reg_res = engine.update_regime()
        effective_regime = reg_res.raw_regime.value if reg_res.raw_regime.value == 'DEFENSIVE' else reg_res.regime.value
        regime_name = effective_regime
        regime_details = {
            'regime': reg_res.regime.value,
            'raw_regime': reg_res.raw_regime.value,
            'effective_regime': effective_regime,
            'candidate_regime': reg_res.candidate_regime.value,
            'candidate_days': reg_res.candidate_days,
            'breadth_pct': round((reg_res.indicators.breadth_pct or 0) * 100, 1) if reg_res.indicators else 0,
            'turnover_ratio': round(reg_res.indicators.turnover_ratio or 0, 2) if reg_res.indicators else 0,
            'index_daily_change_pct': round(reg_res.indicators.index_daily_change_pct or 0, 2) if reg_res.indicators else 0,
            'reasons': reg_res.reasons,
        }
        log(f"  🌐 وضع السوق المستشعر: {regime_name} (raw={reg_res.raw_regime.value}, candidate={reg_res.candidate_regime.value}/{reg_res.candidate_days}d)")
        if reg_res.reasons:
            for r in reg_res.reasons[:3]:
                log(f"     • {r}")
    except Exception as e:
        log(f"  ⚠️ تعذر استشعار وضع السوق ({e}) — افتراضي NORMAL")

    results = []
    # Task IMPROVEMENT-26-2026-10-07: جلب الأسعار الحية من stocks table
    # الرادار كان بيشوف أمس بس → دلوقتي بيجيب current_price + change_percent + last_update
    live_prices = {}
    try:
        # Phase 7.1 / B3-fix: use get_connection() (raw).
        from core.db_manager import db_manager
        live_conn = db_manager.get_connection(str(PROJECT_ROOT / 'db' / 'stocks.db'), writable=False)
        live_conn.row_factory = sqlite3.Row
        # PURGE-FIX (2026-10-22): filter is_active=1 — skip corrupted/deactivated tickers
        live_rows = live_conn.execute("""
            SELECT ticker, current_price, change_percent, last_update
            FROM stocks
            WHERE current_price IS NOT NULL AND current_price > 0
            AND (is_active = 1 OR is_active IS NULL)
        """).fetchall()
        for r in live_rows:
            live_prices[r['ticker']] = {
                'price': float(r['current_price']),
                'change_percent': float(r['change_percent'] or 0),
                'last_update': r['last_update'] or '',
            }
        live_conn.close()
        log(f"  💰 Live prices loaded: {len(live_prices)} stocks")
    except Exception as e:
        log(f"  ⚠️ Live prices not available: {e}")

    # Task IMPROVEMENT-26: آخر تاريخ في daily prices
    last_daily_date = ''
    try:
        # Phase 7.1 / B3-fix: use get_connection() (raw).
        from core.db_manager import db_manager
        date_conn = db_manager.get_connection(str(PROJECT_ROOT / 'db' / 'stocks.db'), writable=False)
        r = date_conn.execute("SELECT MAX(price_date) FROM stock_daily_prices").fetchone()
        last_daily_date = r[0] if r and r[0] else ''
        date_conn.close()
        log(f"  📅 Last daily price date: {last_daily_date}")
    except:
        pass

    # ─── B3 (Task 2-a): identity lookup (ticker → market/currency/name). ──
    # Used for (a) B1 price_sanity.validate_price_data market/currency check,
    # (b) the new `results[].company/market/currency` fields.
    identity_map: dict = {}
    try:
        from core.db_manager import db_manager
        ident_conn = db_manager.get_connection(str(PROJECT_ROOT / 'db' / 'stocks.db'), writable=False)
        ident_conn.row_factory = sqlite3.Row
        ident_rows = ident_conn.execute(
            "SELECT ticker, market, currency, name, name_ar FROM stocks"
        ).fetchall()
        for r in ident_rows:
            if r['ticker']:
                identity_map[r['ticker']] = {
                    'market': r['market'] or '',
                    'currency': r['currency'] or '',
                    'name': r['name'] or '',
                    'name_ar': r['name_ar'] or '',
                }
        ident_conn.close()
        log(f"  🪪 Identity lookup loaded: {len(identity_map)} tickers")
    except Exception as e:
        log(f"  ⚠️ Identity lookup failed (B1 sanity will skip market/currency checks): {e}")

    # ─── B3 (Task 2-a): contract_results — ALL scanned tickers (no drop). ──
    # The legacy `results` list (built below) drops tickers that fail scan_ticker
    # or fall below --min-price. The new `contract_results` list keeps EVERY
    # scanned ticker, marking failures as classification='INSUFFICIENT_DATA'
    # or 'DATA_INVALID'. The owner's hard constraint:
    #   "DO NOT restrict the final file to only stocks that meet certain conditions."
    contract_results: list = []

    for i, ticker in enumerate(tickers, 1):
        rows = fetch_ticker_series(conn, ticker, days=40)

        # ─── B3: insufficient history → try scanner fallback first ──
        # RADAR-FIX: if historical rows < 15, call scan_ticker which now
        # has _scanner_fallback. If scanner data is available, it returns
        # a SCANNER_ALERT result instead of None.
        if not rows or len(rows) < 15:
            result = _scanner_fallback(ticker, regime=regime_name, market_code=args.market.upper())
            if result and result.get('classification') == 'SCANNER_ALERT':
                # Scanner fallback worked — enrich + add to BOTH lists
                identity = identity_map.get(ticker, {})
                result = _enrich_result_with_scanner(result, ticker)
                result = _enrich_result_with_b3_fields(result, identity, args, scan_timestamp)
                contract_results.append(result)
                results.append(result)  # P1 FIX: also add to legacy results (UI reads this)
                continue
            # Scanner fallback also failed → truly insufficient
            identity = identity_map.get(ticker, {})
            contract_results.append(_build_insufficient_result(
                ticker=ticker,
                identity=identity,
                scan_timestamp=scan_timestamp,
                reason=f'insufficient_history:rows={len(rows) if rows else 0},min=15',
                data_quality='unavailable',
                data_quality_status='UNAVAILABLE',
            ))
            if i % 100 == 0:
                log(f"    {i}/{len(tickers)} — contract_results={len(contract_results)}")
            continue

        result = scan_ticker(rows, ticker, regime=regime_name)
        # ─── B3: scan_ticker returned None → INSUFFICIENT_DATA ──
        if not result:
            identity = identity_map.get(ticker, {})
            contract_results.append(_build_insufficient_result(
                ticker=ticker,
                identity=identity,
                scan_timestamp=scan_timestamp,
                reason='scan_ticker_returned_none:insufficient_valid_closes',
                data_quality='unavailable',
                data_quality_status='UNAVAILABLE',
            ))
            if i % 100 == 0:
                log(f"    {i}/{len(tickers)} — contract_results={len(contract_results)}")
            continue

        # Task IMPROVEMENT-26: إضافة data_date + live_price + price_source
        # Task FIX-STALE-DTPP-2026-10-07: use the FRESHEST source as
        # authoritative for current_price. Previously the radar always
        # trusted `closes[-1]` from the historical table — even when
        # that row was 10 days stale. Now we compare the date of the
        # last historical close vs the live price's last_update and
        # use whichever is more recent.
        result['data_date'] = result.get('last_close_date') or last_daily_date
        result['price_source'] = 'daily'

        # ─── FRESHNESS GUARD: compute live price freshness ─────────────
        live = live_prices.get(ticker)
        live_freshness_days = None
        if live and live['price'] > 0:
            result['live_price'] = round(live['price'], 2)
            result['live_change_percent'] = round(live['change_percent'], 2)
            result['live_last_update'] = live['last_update']
            live_freshness_days = _compute_staleness_days(live['last_update'])

        # Decide authoritative current_price + data_date + data_quality
        hist_price = result.get('current_price', 0) or 0
        hist_date = result.get('last_close_date', '')
        hist_stale_days = result.get('staleness_days')

        if live and live['price'] > 0:
            # Pick the freshest source by date comparison
            use_live = True
            if hist_date and live_freshness_days is not None and hist_stale_days is not None:
                # Use the source with the more recent date
                use_live = (live_freshness_days <= hist_stale_days)

            if use_live:
                result['price_source'] = 'live'
                result['data_date'] = live['last_update'][:10] if live['last_update'] else result['data_date']
                # Override current_price with live value
                if hist_price > 0 and abs(live['price'] - hist_price) > 0.01:
                    result['daily_price'] = round(hist_price, 2)  # حفظ القديم
                result['current_price'] = round(live['price'], 2)
                result['change_1d'] = round(live['change_percent'], 2)
                result['change_percent'] = round(live['change_percent'], 2)
                # Re-evaluate data_quality based on live freshness
                if live_freshness_days is not None:
                    result['staleness_days'] = live_freshness_days
                    if live_freshness_days <= 1:
                        result['data_quality'] = 'fresh'
                        result['data_stale'] = False
                    elif live_freshness_days <= 3:
                        result['data_quality'] = 'stale'
                        result['data_stale'] = True
                    else:
                        result['data_quality'] = 'very_stale'
                        result['data_stale'] = True
            else:
                # Historical is fresher than live (rare) — keep hist
                result['price_source'] = 'daily'
        else:
            result['live_price'] = None
            result['live_change_percent'] = None
            result['live_last_update'] = None
            # No live price → rely on historical; data_quality already set in scan_ticker

        # ─── STALE SIGNAL FILTER (Task FIX-STALE-DTPP) ────────────────
        # If BOTH sources are stale (>3 days), the entry_price is meaningless.
        # Drop the ticker from "under_microscope" so we never tell the customer
        # to "buy at" a stale price. NOTE (B3): we do NOT drop the ticker from
        # `contract_results` — only from the legacy `under_microscope` list.
        if result.get('data_stale') and result.get('staleness_days', 0) and result['staleness_days'] > 3:
            stale_drop_warn = (f'⛔ SKIPPED — بيانات قديمة جداً ({result["staleness_days"]}d). '
                                f'آخر تحديث: {result.get("data_date")}. لازم تتأكد إن data_engine محدث قبل التوصية.')
            log(f"  {stale_drop_warn}  [{ticker}]")
            result['under_microscope'] = False
            # BRAVO-FIX: لو السهم distribution_flag=True، خلي path='distribution' (مش None)
            # عشان الـ distribution_list تـ catchه صح.
            if result.get('distribution_flag'):
                result['path'] = 'distribution'
            else:
                result['path'] = None
            result['position_size'] = 0.0
            # keep result for diagnostics but exclude from microscope list

        # ─── B3 (Task 2-a): integrate B1 price_sanity.validate_price_data ──
        # Run the B1 sanity gate BEFORE classification. If DATA_INVALID →
        # classification='DATA_INVALID' (NO force-classification). If STALE
        # → classification='INSUFFICIENT_DATA'. The owner's hard constraint:
        #   "a stock with `DATA_INVALID` prices must NOT be force-classified;
        #    it must surface as `DATA_INVALID` in the radar output."
        identity = identity_map.get(ticker, {})
        sanity_status = 'OK'
        sanity_reasons: list = []
        try:
            from core.price_sanity import validate_price_data
            latest_row = rows[-1] if rows else {}
            ohlc_dict = {
                'open': latest_row.get('open'),
                'high': latest_row.get('high'),
                'low': latest_row.get('low'),
                'close': latest_row.get('close'),
            }
            prices_seq = [r.get('close') for r in rows if r.get('close') and r['close'] > 0]
            sanity = validate_price_data(
                prices=prices_seq,
                ohlc=ohlc_dict,
                ticker=ticker,
                market=identity.get('market') or args.market.upper(),
                currency=identity.get('currency') or None,
                latest_date=result.get('last_close_date') or None,
                max_age_days=4,
                entry_price=result.get('entry_price'),
                support=result.get('stop_loss'),
                resistance=result.get('target_price'),
            )
            sanity_status = sanity.status
            sanity_reasons = list(sanity.reasons or [])
            # B1 sanity gate — fail-closed for invalid data
            if sanity_status == 'DATA_INVALID':
                # Mark + append an insufficient-style entry (overrides any
                # path that scan_ticker might have set — do NOT classify
                # invalid-price stocks as quiet/distribution/etc.).
                insuf = _build_insufficient_result(
                    ticker=ticker,
                    identity=identity,
                    scan_timestamp=scan_timestamp,
                    reason=f'B1_price_sanity:DATA_INVALID',
                    data_quality='invalid',
                    data_quality_status='INVALID',
                    extra_reasons=sanity_reasons,
                )
                # Preserve scan_ticker metrics (current_price, etc.) so the
                # UI can show "DATA_INVALID" alongside the actual price (the
                # owner's UI may want to display the contaminated value with
                # a red flag rather than a blank).
                for k in ('current_price', 'entry_price', 'stop_loss', 'target_price',
                          'change_1d', 'change_percent', 'price_bucket', 'avg_turnover_20d',
                          'avg_volume_20d', 'last_close_date', 'staleness_days',
                          'live_price', 'live_change_percent', 'live_last_update',
                          'data_date', 'price_source'):
                    if k in result:
                        insuf[k] = result[k]
                insuf['sanity_status'] = 'DATA_INVALID'
                insuf['sanity_reasons'] = sanity_reasons
                contract_results.append(insuf)
                log(f"  ⛔ B1 DATA_INVALID [{ticker}]: {', '.join(sanity_reasons[:2])}")
                if i % 100 == 0:
                    log(f"    {i}/{len(tickers)} — contract_results={len(contract_results)}")
                continue
            elif sanity_status == 'STALE':
                # Stale data → INSUFFICIENT_DATA (not DATA_INVALID).
                insuf = _build_insufficient_result(
                    ticker=ticker,
                    identity=identity,
                    scan_timestamp=scan_timestamp,
                    reason=f'B1_price_sanity:STALE',
                    data_quality='stale' if (result.get('staleness_days') or 0) <= 3 else 'very_stale',
                    data_quality_status='STALE',
                    extra_reasons=sanity_reasons,
                )
                # Preserve metrics
                for k in ('current_price', 'entry_price', 'stop_loss', 'target_price',
                          'change_1d', 'change_percent', 'price_bucket', 'avg_turnover_20d',
                          'avg_volume_20d', 'last_close_date', 'staleness_days',
                          'live_price', 'live_change_percent', 'live_last_update',
                          'data_date', 'price_source', 'path', 'distribution_flag',
                          'under_microscope', 'position_size', 'net_flow_egp'):
                    if k in result:
                        insuf[k] = result[k]
                insuf['sanity_status'] = 'STALE'
                insuf['sanity_reasons'] = sanity_reasons
                contract_results.append(insuf)
                if i % 100 == 0:
                    log(f"    {i}/{len(tickers)} — contract_results={len(contract_results)}")
                continue
            elif sanity_status == 'DATA_UNAVAILABLE':
                insuf = _build_insufficient_result(
                    ticker=ticker,
                    identity=identity,
                    scan_timestamp=scan_timestamp,
                    reason=f'B1_price_sanity:DATA_UNAVAILABLE',
                    data_quality='unavailable',
                    data_quality_status='UNAVAILABLE',
                    extra_reasons=sanity_reasons,
                )
                insuf['sanity_status'] = 'DATA_UNAVAILABLE'
                insuf['sanity_reasons'] = sanity_reasons
                contract_results.append(insuf)
                if i % 100 == 0:
                    log(f"    {i}/{len(tickers)} — contract_results={len(contract_results)}")
                continue
            # else: sanity_status == 'OK' → fall through to classification
        except ImportError:
            # B1 price_sanity module not available — fail-open (log + continue
            # with normal classification). Do NOT break the radar.
            log(f"  ⚠️ B1 price_sanity module not available — skipping sanity gate for {ticker}")
        except Exception as sanity_err:
            # FAIL-OPEN: any sanity-gate crash → log + continue with classification.
            log(f"  ⚠️ B1 price_sanity crashed for {ticker}: {sanity_err}")

        # ─── B3 (Task 2-a): enrich with classification + reasons + data_quality_status ──
        _enrich_result_with_b3_fields(result, identity, args, scan_timestamp)
        result['sanity_status'] = sanity_status
        result['sanity_reasons'] = sanity_reasons

        # Append to BOTH the new contract_results (all scanned) AND the legacy
        # `results` list (which gets price-filtered below for the legacy list keys).
        contract_results.append(result)
        results.append(result)

        if i % 100 == 0:
            log(f"    {i}/{len(tickers)} — contract={len(contract_results)} legacy={len(results)}")
    conn.close()

    # ─── تصنيف + تنظيف النتايج ────────────────────────────────────────
    # 1. فلتر: السعر >= args.min_price (استبعاد penny stocks)
    #    US market: نطبّق حد أعلى من $5 لو ما حددش المستخدم قيمة غير الـ default (1.0)
    if args.market.upper() == 'US' and args.min_price <= 1.0:
        # US default — skip penny stocks < $5 (higher USD liquidity floor)
        results = [r for r in results if r['current_price'] >= 5.0]
    else:
        results = [r for r in results if r['current_price'] >= args.min_price]

    # 2. فلتر حسب المسار (مع Pre-Surge كمسار منفصل)
    under_microscope_raw = [r for r in results if r['under_microscope']]
    pre_surge_list = [r for r in under_microscope_raw if r['path'] == 'A_pre_surge']
    quiet_list = [
        r for r in under_microscope_raw
        if r['path'] in ('B_quiet_accumulation_strong', 'C_quiet_accumulation_weak', 'A_quiet_accumulation')
        and (r.get('quiet_details', {}) or {}).get('signal_count', 0) >= args.min_quiet_signals
    ]
    explosive_list = [r for r in under_microscope_raw if r['path'] in ('D_explosive_surge', 'B_explosive_surge')]
    early_break_list = [r for r in under_microscope_raw if r['path'] in ('E_early_break', 'C_early_break')]

    # BRAVO-FLOW-GATE-ALL: distribution_list = أسهم في تصريف صريح (سيولة سالبة قوية)
    # بـ تـ collect من كل results (مش بس under_microscope) عشان نـ عرضها للواجهة.
    distribution_list = [
        r for r in results
        if r.get('distribution_flag') and (r.get('net_flow_egp') or 0) < 0
    ]
    # ترتيب: أكتر سيولة خارجة أول (أكثر سلبية)
    distribution_list.sort(key=lambda r: (r.get('net_flow_egp') or 0))

    # 3. ترتيب حسب: signals → volume_ratio → price_stability (للـ quiet)
    def quiet_sort_key(r):
        qd = r.get('quiet_details', {}) or {}
        return (
            -qd.get('signal_count', 0),       # أكثر signals أول
            -r.get('volume_ratio_10d_vs_20d', 0),  # أعلى volume ratio
            -r.get('price_stability', 0),     # أعلى stability
        )
    quiet_list.sort(key=quiet_sort_key)

    # للـ explosive: حسب volume_ratio (أعلى surge أول)
    explosive_list.sort(key=lambda r: -r.get('volume_ratio_10d_vs_20d', 0))

    # للـ early_break: حسب ROC10 (أعلى ROC أول)
    early_break_list.sort(key=lambda r: -(r.get('roc_10d') or 0))

    under_microscope = pre_surge_list + quiet_list + explosive_list + early_break_list

    log(f"\n═══ النتايج النظيفة (market={args.market}, price≥{args.min_price}) ═══")
    log(f"  إجمالي المفحوصين (بعد فلتر السعر): {len(results)}")
    log(f"  🔬 تحت الميكروسكوب: {len(under_microscope)}")
    log(f"    🚀 Pre-Surge: {len(pre_surge_list)}")
    log(f"    🎯 Quiet Accumulation (≥{args.min_quiet_signals}/6): {len(quiet_list)}")
    log(f"    🔥 Explosive Surge: {len(explosive_list)}")
    log(f"    ⚡ Early Break: {len(early_break_list)}")

    # ─── عرض الأسهم تحت الميكروسكوب ────────────────────────────────────
    if quiet_list:
        log(f"\n═══ 🎯 مسار أ — Quiet Accumulation (≥{args.min_quiet_signals}/6) ═══\n")
        log(f"{'#':>3} {'Ticker':10s} {'Price':>8s} {'Bucket':>10s} {'Turnover':>12s} {'ROC10':>7s} {'VolRatio':>8s} {'Stability':>9s} {'Signals':>7s}")
        log("-" * 100)
        for i, r in enumerate(quiet_list, 1):
            qd = r.get('quiet_details', {}) or {}
            roc_str = f"{r['roc_10d']:+.1f}%" if r['roc_10d'] is not None else 'N/A'
            log(f"{i:>3} {r['ticker']:10s} {r['current_price']:>8.2f} {r['price_bucket']:>10s} "
                f"{r['avg_turnover_20d']:>12,.0f} {roc_str:>7s} {r['volume_ratio_10d_vs_20d']:>7.2f}x "
                f"{r['price_stability']:>8.2f} {qd.get('signal_count', 0):>5d}/6")

    if explosive_list:
        log(f"\n═══ 🔥 مسار ب — Explosive Surge ═══\n")
        log(f"{'#':>3} {'Ticker':10s} {'Price':>8s} {'Bucket':>10s} {'Turnover':>12s} {'ROC10':>7s} {'VolRatio':>8s} {'Range10':>8s}")
        log("-" * 90)
        for i, r in enumerate(explosive_list, 1):
            roc_str = f"{r['roc_10d']:+.1f}%" if r['roc_10d'] is not None else 'N/A'
            log(f"{i:>3} {r['ticker']:10s} {r['current_price']:>8.2f} {r['price_bucket']:>10s} "
                f"{r['avg_turnover_20d']:>12,.0f} {roc_str:>7s} {r['volume_ratio_10d_vs_20d']:>7.2f}x "
                f"{r['range_10d_pct']:>7.1f}%")

    if early_break_list:
        log(f"\n═══ ⚡ مسار ج — Early Break ═══\n")
        log(f"{'#':>3} {'Ticker':10s} {'Price':>8s} {'Bucket':>10s} {'Turnover':>12s} {'ROC10':>7s} {'VolRatio':>8s}")
        log("-" * 80)
        for i, r in enumerate(early_break_list, 1):
            roc_str = f"{r['roc_10d']:+.1f}%" if r['roc_10d'] is not None else 'N/A'
            log(f"{i:>3} {r['ticker']:10s} {r['current_price']:>8.2f} {r['price_bucket']:>10s} "
                f"{r['avg_turnover_20d']:>12,.0f} {roc_str:>7s} {r['volume_ratio_10d_vs_20d']:>7.2f}x")

    # تفاصيل Quiet Accumulation (لأعلى 5 بس)
    if quiet_list:
        log(f"\n══─ تفاصيل أعلى 5 Quiet Accumulation ══")
        for r in quiet_list[:5]:
            qd = r.get('quiet_details', {}) or {}
            log(f"\n  🎯 {r['ticker']} (price={r['current_price']:.2f}, turnover={r['avg_turnover_20d']:,.0f})")
            log(f"     {qd.get('signal_count', 0)}/6 إشارات متحققة:")
            for s in qd.get('signals_met', []):
                log(f"       ✅ {s}")
            for s in qd.get('signals_failed', []):
                log(f"       ❌ {s}")

    # ─── حفظ JSON ──────────────────────────────────────────────────────
    today_str = datetime.now().strftime("%Y%m%d")
    today_iso = datetime.now().strftime("%Y-%m-%d")  # Task IMPROVEMENT-22: ISO format for DB
    # FIX-P3-P5-P6 (Group P5 — Fix 5): cache filename now keys by market so
    # each market (EGX, TADAWUL, KSE, QSE, ...) gets its own cache file —
    # the radar-cache.ts reader looks for `maker_radar_{MARKET}_{DATE}.json`
    # first and only falls back to the legacy `maker_radar_{DATE}.json`
    # pattern for the EGX default.
    market_code = (args.market or "EGX").strip().upper()
    json_path = OUTPUT_DIR / f"maker_radar_{market_code}_{today_str}.json"

    # ─── B3 (Task 2-a): build new list keys (subsets of contract_results) ──
    # dead_trap_list / liquidity_drought_list / rule80_downtrend_list are NEW
    # keys. They are subsets of `results` (=contract_results) whose
    # classification matches. Legacy list keys (quiet_list, pre_surge_list,
    # explosive_list, early_break_list, distribution_list) keep their existing
    # shape — populated from the price-filtered `results` (legacy list).
    dead_trap_list = [
        r for r in contract_results
        if r.get('classification') == 'dead_trap'
    ]
    liquidity_drought_list = [
        r for r in contract_results
        if r.get('classification') == 'liquidity_drought'
    ]
    rule80_downtrend_list = [
        r for r in contract_results
        if r.get('classification') == 'rule80_downtrend'
    ]

    # ─── B3 (Task 2-a): build the summary block ──
    b3_summary = _build_summary(contract_results, source_count, scan_timestamp)

    # Sanity: contract_results MUST contain every scanned ticker (no vanishing).
    # If a ticker was dropped (defensive — should not happen given the loop
    # above appends to contract_results for every code path), log loudly.
    if len(contract_results) != source_count:
        log(f"  ⚠️ B3 CONTRACT VIOLATION: source_count={source_count} but "
            f"contract_results={len(contract_results)} — some tickers vanished!")

    with open(json_path, "w", encoding="utf-8") as f:
        json.dump({
            'generated_at': datetime.now().isoformat(),
            'market': args.market,
            'market_regime': regime_details or {'regime': regime_name, 'raw_regime': regime_name},
            'min_quiet_signals': args.min_quiet_signals,
            'min_price': args.min_price,
            'db_source': DB_SOURCE_ID,
            'db_file': PROD_DB.name if PROD_DB else None,
            'db_table': PROD_TABLE,
            'total_scanned': len(results),
            'under_microscope_count': len(under_microscope),
            'quiet_count': len(quiet_list),
            'pre_surge_count': len(pre_surge_list),
            'explosive_count': len(explosive_list),
            'early_break_count': len(early_break_list),
            'distribution_count': len(distribution_list),
            # ─── B3 (Task 2-a): NEW additive keys ──────────────────────
            'results': contract_results,            # ALL scanned tickers (no filter)
            'summary': b3_summary,                  # source/scanned/classified/...
            'dead_trap_list': dead_trap_list,       # NEW list key
            'liquidity_drought_list': liquidity_drought_list,  # NEW list key
            'rule80_downtrend_list': rule80_downtrend_list,     # NEW list key
            'dead_trap_count': len(dead_trap_list),
            'liquidity_drought_count': len(liquidity_drought_list),
            'rule80_downtrend_count': len(rule80_downtrend_list),
            # ─── Legacy keys (PRESERVED for backward compat) ───────────
            'quiet_list': quiet_list,
            'pre_surge_list': pre_surge_list,
            'explosive_list': explosive_list,
            'early_break_list': early_break_list,
            'distribution_list': distribution_list,
            'incubator_candidates': build_incubator_candidates(results),
            'under_microscope': under_microscope,
            'all_results': results,
        }, f, ensure_ascii=False, indent=2, default=str)
    log(f"\n✅ JSON saved: {json_path}")
    log(f"    📋 B3 contract: source={b3_summary['source_count']} "
        f"scanned={b3_summary['scanned_count']} "
        f"classified={b3_summary['classified_count']} "
        f"unclassified={b3_summary['unclassified_count']} "
        f"data_error={b3_summary['data_error_count']}")
    log(f"    🆕 B3 new lists: dead_trap={len(dead_trap_list)} "
        f"liquidity_drought={len(liquidity_drought_list)} "
        f"rule80_downtrend={len(rule80_downtrend_list)}")

    incubator_count = len(build_incubator_candidates(results))
    log(f"    🔭 Incubator Candidates (heating up): {incubator_count}")

    # ── Task IMPROVEMENT-22-2026-10-07: تسجيل الإشارات في radar_signal_tracking ──
    # بعد كل تشغيل، سجّل كل سهم تحت الميكروسكوب في DB عشان نقدر نتتبعها
    try:
        _track_signals_to_db(under_microscope, today_iso, market_code)
    except Exception as _track_err:
        log(f"⚠️ Signal tracking failed: {_track_err}")

    if args.json_only:
        return 0

    # تقرير عربي
    report = build_arabic_report(results, under_microscope, quiet_list, explosive_list, early_break_list)
    md_path = OUTPUT_DIR / f"maker_radar_{market_code}_{today_str}.md"
    with open(md_path, "w", encoding="utf-8") as f:
        f.write(report)
    log(f"✅ Report saved: {md_path}")
    print("\n" + "=" * 80)
    print(report)
    return 0


def build_arabic_report(results, under_microscope, quiet_list, explosive_list, early_break_list):
    today = datetime.now().strftime("%Y-%m-%d")
    lines = []
    lines.append(f"# 🎯 رادار الميكرز اليومي — {today}")
    lines.append("")
    lines.append(f"**إجمالي الأسهم المفحوصة:** {len(results)}")
    lines.append(f"**🔬 تحت الميكروسكوب:** {len(under_microscope)} ({len(under_microscope)/len(results)*100 if results else 0:.1f}%)")
    lines.append("")
    lines.append("## 📊 توزيع المسارات")
    lines.append("")
    lines.append("| المسار | العدد | Position Size |")
    lines.append("|-------|------|---------------|")
    lines.append(f"| 🎯 أ — Quiet Accumulation | {len(quiet_list)} | 2% |")
    lines.append(f"| 🔥 ب — Explosive Surge | {len(explosive_list)} | 2% |")
    lines.append(f"| ⚡ ج — Early Break | {len(early_break_list)} | 2.5% |")
    lines.append("")
    if under_microscope:
        lines.append("## 🔬 الأسهم تحت الميكروسكوب")
        lines.append("")
        lines.append("| # | Ticker | Price | Bucket | Turnover | ROC10 | المسار | الحجم |")
        lines.append("|---|--------|-------|--------|----------|-------|--------|------|")
        sorted_list = quiet_list + explosive_list + early_break_list
        for i, r in enumerate(sorted_list, 1):
            path_label = {
                'A_quiet_accumulation': '🎯 QUIET_ACC',
                'B_explosive_surge': '🔥 EXPLOSIVE',
                'C_early_break': '⚡ EARLY_BREAK',
            }.get(r['path'], r['path'])
            roc_str = f"{r['roc_10d']:+.1f}%" if r['roc_10d'] is not None else 'N/A'
            lines.append(f"| {i} | {r['ticker']} | {r['current_price']:.2f} | {r['price_bucket']} | {r['avg_turnover_20d']:,.0f} | {roc_str} | {path_label} | {r['position_size']*100:.1f}% |")
        lines.append("")

    if quiet_list:
        lines.append("## 🎯 تفاصيل Quiet Accumulation (الأولوية القصوى)")
        lines.append("")
        for r in quiet_list:
            qd = r.get('quiet_details', {})
            lines.append(f"### {r['ticker']} (price={r['current_price']:.2f}, turnover={r['avg_turnover_20d']:,.0f})")
            lines.append(f"**{qd.get('signal_count', 0)}/6 إشارات متحققة:**")
            lines.append("")
            for s in qd.get('signals_met', []):
                lines.append(f"- ✅ {s}")
            for s in qd.get('signals_failed', []):
                lines.append(f"- ❌ {s}")
            lines.append("")

    lines.append("## 📋 الخطوات القادمة")
    lines.append("")
    lines.append("1. أي سهم من القائمة دي → يتحط **paper** بحجم صغير (2-2.5%)")
    lines.append("2. مراجعة يومية: هل السهم فضل بـ يتجمع ولا بدأ يفرّغ؟")
    lines.append("3. لو ظهر توزيع واضح → خروج فوري")
    lines.append("4. لو وصل 1.5R → بيع جزء (partial)")
    lines.append("")
    lines.append("---")
    lines.append(f"*تم التوليد بواسطة `maker_radar.py` — {datetime.now().isoformat()}*")
    return "\n".join(lines)


if __name__ == "__main__":
    sys.exit(main())
